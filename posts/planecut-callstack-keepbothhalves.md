# PlaneCut 调用堆栈（Keep Both Halves 配置）

## 参数快照

| 参数 | 值 | 对应字段 |
|---|---|---|
| Keep Both Halves | ✓ | `bKeepBothHalves = true` |
| Spacing Between Halves | 0.0 | `CutPlaneLocalThickness = 0` |
| Export Separated Pieces as New | ✓ | `bExportSeparatedPiecesAsNewMeshAssets = true` |
| Show Preview | ✓ | `bShowPreview = true` |
| Fill Cut Hole | ✓ | `bFillCutHole = true` |
| Fill Spans | ✓ | `bFillSpans = true` |
| Simplify Along Cut | ✓ | `bSimplifyAlongNewEdges = true` |

`SpacingBetweenHalves = 0.0` → `CutPlaneLocalThickness = 0`，走**薄平面单次 `CutWithoutDelete` 路径**。

---

## 完整调用堆栈

### Phase 1：用户触发（Game Thread）

```
用户按 T 键
  └─> UPlaneCutTool::Cut()                                   PlaneCutTool.h:149
        └─> PendingAction = EPlaneCutToolActions::Cut

UPlaneCutTool::OnTick()                                      PlaneCutTool.cpp:312
  └─> PendingAction == Cut → DoCut()                         PlaneCutTool.cpp:320

UPlaneCutTool::DoCut()                                       PlaneCutTool.cpp:209
  ├─> [CanAccept() 检查所有 Preview->HaveValidResult()]
  ├─> for each MeshesToCut[Idx]:
  │     └─> Preview->PreviewMesh->ExtractPreviewMesh()
  │           // 将当前预览结果设为新的原始输入，支持连续多刀
  │           └─> MeshesToCut[Idx]->ReplaceMesh(ResultMesh)
  ├─> GetToolManager()->EmitObjectChange()                    // 记录 Undo
  └─> for each Preview:
        └─> Preview->InvalidateResult()                       PlaneCutTool.cpp:234
```

### Phase 2：后台任务调度（Game Thread）

```
UMeshOpPreviewWithBackgroundCompute::InvalidateResult()      MeshOpPreviewHelpers.cpp:209
  └─> BackgroundCompute->NotifyActiveComputeInvalidated()

TBackgroundModelingComputeSource::NotifyActiveComputeInvalidated()
  └─> StartNewCompute()
        ├─> NewOp = OperatorSource->MakeNewOperator()
        │     └─> UPlaneCutOperatorFactory::MakeNewOperator() PlaneCutTool.cpp:262
        │           ├─> new FPlaneCutOp
        │           ├─> bFillCutHole      = true
        │           ├─> bFillSpans        = true
        │           ├─> bSimplifyAlongNewEdges = true
        │           ├─> LocalPlaneOrigin  = InverseTransform(CutPlaneWorld.Origin)
        │           ├─> LocalPlaneNormal  = InverseTransformNormal(CutPlaneWorld.Z)
        │           ├─> OriginalMesh      = MeshesToCut[Idx]->GetMesh()
        │           ├─> bKeepBothHalves   = true
        │           ├─> CutPlaneLocalThickness = 0.0 * NormalScaleFactor = 0
        │           └─> UVScaleFactor     = 1.0 / OriginalMesh.Bounds.MaxDim()
        └─> ActiveBackgroundTask->StartBackgroundTask()       // 提交线程池
```

### Phase 3：几何计算（Worker Thread）

```
TModelingOpTask<FPlaneCutOp>::DoWork()
  └─> FPlaneCutOp::CalculateResult(Progress)                 PlaneCutOp.cpp:20
        ├─> ResultMesh->Copy(*OriginalMesh)                   // 拷贝原始网格
        ├─> FMeshPlaneCut Cut(ResultMesh, LocalPlaneOrigin, LocalPlaneNormal)
        ├─> Cut.UVScaleFactor          = UVScaleFactor
        ├─> Cut.bSimplifyAlongNewEdges = true
        │
        ├─> [bKeepBothHalves=true, CutPlaneLocalThickness=0 ≤ Cut.PlaneTolerance]
        │     └─> Cut.CutWithoutDelete(                       PlaneCutOp.cpp:54
        │               bSplitVerticesAtPlane = true,
        │               OffsetSeparatedPortion = 0,
        │               SubObjectAttrib,
        │               NewLabelStartID = MaxSubObjectID+1
        │         )
        │
        ├─> [bFillCutHole=true]
        │     └─> Cut.HoleFill(                               PlaneCutOp.cpp:93
        │               ConstrainedDelaunayTriangulate<double>,
        │               bFillSpans = true
        │         )
        │
        └─> [bFillCutHole=true && bKeepBothHalves=true]
              └─> Cut.TransferTriangleLabelsToHoleFillTriangles(SubObjectAttrib)
                    // 让封口三角形继承所属半边的 SubObjectID，
                    // 以便后续 SplitMesh 能把封口面分到正确的那一半
```

### Phase 3a：CutWithoutDelete 展开

```
FMeshPlaneCut::CutWithoutDelete(bSplitVerticesAtPlane=true, Offset=0, ...)
                                                             MeshPlaneCut.cpp:203
  │
  ├─> SplitCrossingEdges(bDeleteTrisOnPlane=true, Signs, AlreadyOnPlaneEdges, OnCutEdges)
  │     ├─> ComputeVertexSignedDistances()                   // ParallelFor
  │     │     └─> Signs[VID] = (Vertex - PlaneOrigin) · PlaneNormal
  │     ├─> 删除所有三个顶点均在平面上（|dist| < PlaneTolerance）的三角形
  │     └─> for each edge EID < MaxEID（跳过本轮新增边）:
  │           ├─> 两端同侧（DistA * DistB > 0）→ 跳过
  │           ├─> 一端在平面（|dist| < PlaneTolerance）→ AlreadyOnPlaneEdges.Add
  │           └─> 两端异侧 →
  │                 Param = DistA / (DistA - DistB)
  │                 Mesh->SplitEdge(EID, SplitInfo, Param)   // 插入交点顶点
  │                 CutPlaneEdges.Add(SplitInfo.NewEdges)
  │
  ├─> CollapseDegenerateEdges(OnCutEdges, false)             // 塌陷切割线上极短边
  │
  ├─> [bSimplifyAlongNewEdges=true]
  │     └─> SimplifySettings.SimplifyAlongEdges(*Mesh, OnCutEdges)
  │           // 消除切割线附近不改变形状/UV/PolyGroup 的细碎三角形
  │
  ├─> [bSplitVerticesAtPlane=true，Offset=0 → VertexOffsetVec=(0,0,0)]
  │     ├─> 为正侧三角形重新分配 SubObjectID（从 MaxSubObjectID+1 开始）
  │     │     // 负侧保留原 ID（通常为 0），正侧获得新 ID
  │     └─> for each 切割线顶点 VID:
  │           └─> Mesh->SplitVertex(VID, 正侧三角形列表, SplitInfo)
  │                 // 在切割线上每个顶点处复制一份，两侧拓扑真正断开
  │                 // Offset=0 所以两份顶点位置完全重合（无间距）
  │
  └─> ExtractBoundaryLoops(bAddBoundariesFirstHalf=true, bAddBoundariesSecondHalf=true)
        └─> 按 SubObjectID 分组，分别提取两侧边界：
              ├─> 负侧（ID=原值）  → OpenBoundaries[0]，NormalSign=+1
              └─> 正侧（ID=新值）  → OpenBoundaries[1]，NormalSign=-1
                    └─> FMeshBoundaryLoops::Compute()
                          ├─> 正常 → CutLoops（闭合环）
                          └─> 遇 bowtie/退化 → ConvertToOpenSpan → CutSpans
```

### Phase 3b：HoleFill 展开

```
FMeshPlaneCut::HoleFill(ConstrainedDelaunayTriangulate, bFillSpans=true)
                                                             MeshPlaneCut.cpp:719
  └─> for each FOpenBoundary（负侧一次，正侧一次）:
        ├─> LoopVertices ← CutLoops 的顶点列表
        ├─> [bFillSpans=true] LoopVertices 追加 CutSpans 的顶点列表
        │     // 即使边界被降级为 Span 也能填充，封闭网格出现 Span 的常见场景
        ├─> SignedPlaneNormal = PlaneNormal * NormalSign
        │     // 负侧 NormalSign=+1 → 法线朝上；正侧 NormalSign=-1 → 法线朝下
        │     // 保证两侧封口面法线均朝外
        ├─> FPlanarHoleFiller::Fill(GID)
        │     └─> ConstrainedDelaunayTriangulate()            // Delaunay 三角化
        └─> SetTriangleNormals(SignedPlaneNormal)
            SetTriangleUVsFromProjection(ProjectionFrame, UVScaleFactor)
```

### Phase 4：结果返回 Game Thread

```
UMeshOpPreviewWithBackgroundCompute::Tick()                  MeshOpPreviewHelpers.cpp:113
  └─> UpdateResults()
        ├─> BackgroundCompute->CheckStatus() == ValidResultAvailable
        ├─> MeshOp = BackgroundCompute->ExtractResult()
        ├─> OnOpCompleted.Broadcast(MeshOp.Get())
        ├─> ResultMesh = MeshOp->ExtractResult()
        └─> PreviewMesh->UpdatePreview(MoveTemp(ResultMesh))  // 刷新视口预览
```

### Phase 5：用户 Accept — 提交资产

```
UPlaneCutTool::OnShutdown(EToolShutdownType::Accept)         PlaneCutTool.cpp:240
  ├─> for each Preview:
  │     └─> Results.Emplace(Preview->Shutdown())             // 提取最终 Mesh
  └─> GenerateAsset(Results)                                 PlaneCutTool.cpp:396

GenerateAsset()
  ├─> [bExportSeparatedPiecesAsNewMeshAssets=true]
  │     └─> for each Result Mesh:
  │           ├─> 读取每个三角形的 SubObjectID（由 TransferTriangleLabelsToHoleFillTriangles 填入）
  │           └─> FDynamicMeshEditor::SplitMesh(UseMesh, SplitMeshes, SubObjectIDFunc)
  │                 // 按 SubObjectID 拆分为两块：
  │                 // SplitMeshes[0] = 负侧（原 ID）+ 其封口面
  │                 // SplitMeshes[1] = 正侧（新 ID）+ 其封口面
  │
  ├─> SplitMeshes[0] → CommitDynamicMeshUpdate()             // 写回原 StaticMesh 资产
  └─> SplitMeshes[1..N] → CreateMeshObject()                 // 创建新 Actor
        └─> NewSelection.Actors.Add(Result.NewActor)
              └─> GetToolManager()->RequestSelectionChange()  // 选中新 Actor
```

---

## 数据流图

```
原始网格
    │ Copy
    ▼
ResultMesh
    │
    ├─ SplitCrossingEdges()
    │   └─ 切割线上新增顶点，两侧拓扑未变
    │
    ├─ CollapseDegenerateEdges()
    │   └─ 清理极短边
    │
    ├─ SimplifyAlongEdges()           ← bSimplifyAlongCut=true
    │   └─ 消除切割线附近细碎三角形
    │
    ├─ SplitVertex() × N             ← bSplitVerticesAtPlane=true
    │   └─ 切割线顶点复制，两侧完全断开
    │   └─ SubObjectID: 负侧=0，正侧=1
    │
    ├─ HoleFill() × 2                ← bFillCutHole=true
    │   ├─ 负侧封口面（NormalSign=+1），含 CutSpans  ← bFillSpans=true
    │   └─ 正侧封口面（NormalSign=-1），含 CutSpans
    │
    ├─ TransferTriangleLabelsToHoleFillTriangles()
    │   └─ 封口三角形继承 SubObjectID
    │
    └─ SplitMesh() by SubObjectID    ← bExportSeparatedPiecesAsNewMeshAssets=true
        ├─ Mesh_0（负侧 + 封口）→ 写回原资产
        └─ Mesh_1（正侧 + 封口）→ 新建 Actor
```

---

## 关键细节

**为什么 Spacing=0 时两半不分离**：`CutWithoutDelete` 的 `OffsetSeparatedPortion=0`，`VertexOffsetVec=(0,0,0)`，`SplitVertex` 复制出的新顶点与原顶点位置完全重合。两半在空间上贴合，仅拓扑断开。

**为什么 bFillSpans=true 在这里尤为重要**：`SplitVertex` 在切割线顶点处创建重合顶点，可能导致 `FMeshBoundaryLoops` 在走边界环时遇到蝴蝶结顶点（同一位置两个顶点），从而把部分边界降级为 `CutSpans`。`bFillSpans=true` 确保这些 Span 也被填充，截面完整。

**SubObjectID 的作用链**：`CutWithoutDelete` 写入 → `TransferTriangleLabelsToHoleFillTriangles` 补全封口面 → `SplitMesh` 按 ID 拆分 → `CommitDynamicMeshUpdate` / `CreateMeshObject` 分别提交。ID 贯穿整个流程，是两半分离的唯一依据。
