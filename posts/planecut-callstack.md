# PlaneCut 调用堆栈

## 架构概览

PlaneCut 采用**异步后台计算**模式，用户交互与几何计算完全分离：

```
用户操作 (Game Thread)
    │
    ▼
UPlaneCutTool                          [编辑器工具层，Experimental 插件]
    │  InvalidateResult() 触发后台任务
    ▼
UMeshOpPreviewWithBackgroundCompute    [预览+后台调度层]
    │  StartNewCompute() → 线程池
    ▼
TModelingOpTask<FPlaneCutOp>           [后台线程]
    │  DoWork()
    ▼
FPlaneCutOp::CalculateResult()         [Op 层，ModelingOperators 插件]
    │
    ▼
FMeshPlaneCut                          [几何算法层，GeometryProcessing 插件]
```

---

## 完整调用链

### 1. 用户触发切割

```
用户按 T 键 / 点击 Cut 按钮
  └─> UPlaneCutTool::Cut()                         PlaneCutTool.h:149
        └─> PendingAction = EPlaneCutToolActions::Cut

UPlaneCutTool::OnTick()                            PlaneCutTool.cpp:~320
  └─> DoCut()
```

### 2. DoCut() — 提交结果、开始新计算

```
UPlaneCutTool::DoCut()                             PlaneCutTool.cpp:209
  ├─> Preview->PreviewMesh->ExtractPreviewMesh()   // 从预览 Mesh 取出当前结果作为新的原始输入
  ├─> GetToolManager()->EmitObjectChange()          // 记录 Undo
  └─> InvalidatePreviews()
        └─> Preview->InvalidateResult()            MeshOpPreviewHelpers.cpp:209
              └─> BackgroundCompute->NotifyActiveComputeInvalidated()
```

### 3. 后台计算调度

```
TBackgroundModelingComputeSource::NotifyActiveComputeInvalidated()
  └─> StartNewCompute()                            BackgroundModelingComputeSource.h:285
        ├─> NewOp = OperatorSource->MakeNewOperator()
        │     └─> UPlaneCutOperatorFactory::MakeNewOperator()    PlaneCutTool.cpp:262
        │           ├─> new FPlaneCutOp
        │           └─> 填充参数：
        │               bFillCutHole / bFillSpans / bSimplifyAlongNewEdges
        │               LocalPlaneOrigin / LocalPlaneNormal
        │               bKeepBothHalves / CutPlaneLocalThickness / UVScaleFactor
        │               OriginalMesh
        └─> ActiveBackgroundTask->StartBackgroundTask()   // 提交到线程池
```

### 4. 后台线程执行

```
TModelingOpTask<FPlaneCutOp>::DoWork()             BackgroundModelingComputeSource.h:49
  └─> FPlaneCutOp::CalculateResult(Progress)       PlaneCutOp.cpp:20
        ├─> ResultMesh->Copy(*OriginalMesh)
        ├─> FMeshPlaneCut Cut(ResultMesh, Origin, Normal)
        ├─> [if bKeepBothHalves]
        │     ├─> [薄平面] Cut.CutWithoutDelete(true, 0, ...)       PlaneCutOp.cpp:54
        │     └─> [厚平面] 
        │           ├─> Cut.PlaneOrigin -= Normal * Thickness
        │           ├─> Cut.CutWithoutDelete(..., true, false)      PlaneCutOp.cpp:59
        │           ├─> Cut.PlaneOrigin += Normal * 2*Thickness
        │           ├─> Cut.CutWithoutDelete(..., false, true)      PlaneCutOp.cpp:67
        │           └─> 删除夹层三角形（SubObjectID 在两次切割之间）
        ├─> [else]
        │     └─> Cut.Cut()                                         PlaneCutOp.cpp:83
        ├─> [if bFillCutHole]
        │     └─> Cut.HoleFill(ConstrainedDelaunayTriangulate, bFillSpans)   PlaneCutOp.cpp:93
        └─> [if bFillCutHole && bKeepBothHalves]
              └─> Cut.TransferTriangleLabelsToHoleFillTriangles()
```

### 5. FMeshPlaneCut::Cut()（单侧切割）

```
FMeshPlaneCut::Cut()                               MeshPlaneCut.cpp:398
  ├─> SplitCrossingEdges(bDeleteTrisOnPlane=true, ...)
  │     ├─> ComputeVertexSignedDistances()          // ParallelFor，计算每顶点到平面有符号距离
  │     ├─> 删除共面三角形（所有顶点距离 < PlaneTolerance）
  │     └─> 遍历所有原始边：
  │           ├─> 两端同侧 → 跳过
  │           ├─> 一端在平面上 → 加入 AlreadyOnPlaneEdges
  │           └─> 两端异侧 → SplitEdge(EID, Param=DistA/(DistA-DistB))
  ├─> RemoveVertex() for all VID where Signs[VID] > PlaneTolerance
  ├─> CollapseDegenerateEdges(OnCutEdges)
  ├─> [if bSimplifyAlongNewEdges] SimplifyAlongEdges()
  └─> ExtractBoundaryLoops(OnCutEdges, ZeroEdges, Boundary)
        └─> FMeshBoundaryLoops::Compute()
              ├─> 成功闭合 → Boundary.CutLoops
              └─> 走不通（bowtie/退化） → ConvertToOpenSpan → Boundary.CutSpans
```

### 6. FMeshPlaneCut::CutWithoutDelete()（保留两半）

```
FMeshPlaneCut::CutWithoutDelete(bSplitVerticesAtPlane, Offset, TriLabels, ...)   MeshPlaneCut.cpp:203
  ├─> SplitCrossingEdges(...)                      // 同上，只分裂不删除
  ├─> CollapseDegenerateEdges() / SimplifyAlongEdges()
  ├─> 为正侧三角形分配新 SubObjectID，并沿法线偏移顶点
  ├─> SplitVertex() for 切割线上的每个顶点         // 让两侧拓扑真正断开
  └─> ExtractBoundaryLoops() for 每个 Label        // 分别提取两侧边界环
```

### 7. FMeshPlaneCut::HoleFill()（Delaunay 填孔）

```
FMeshPlaneCut::HoleFill(PlanarTriangulationFunc, bFillSpans)   MeshPlaneCut.cpp:719
  └─> for each FOpenBoundary:
        ├─> 收集 CutLoops 的顶点列表
        ├─> [if bFillSpans] 追加 CutSpans 的顶点列表  ← 封闭网格补不上截面时需开启
        ├─> FPlanarHoleFiller::Fill(GID)             // 约束 Delaunay 三角化
        └─> SetTriangleNormals() / SetTriangleUVsFromProjection()
```

### 8. Game Thread 轮询结果

```
UMeshOpPreviewWithBackgroundCompute::Tick()        MeshOpPreviewHelpers.cpp:113
  └─> UpdateResults()                              MeshOpPreviewHelpers.cpp:159
        ├─> BackgroundCompute->CheckStatus()
        ├─> [ValidResultAvailable]
        │     ├─> MeshOp = BackgroundCompute->ExtractResult()
        │     ├─> OnOpCompleted.Broadcast(MeshOp.Get())
        │     ├─> ResultMesh = MeshOp->ExtractResult()
        │     └─> PreviewMesh->UpdatePreview(MoveTemp(ResultMesh))  // 更新可见预览
        └─> OnMeshUpdated.Broadcast(this)
```

### 9. 用户 Accept — 提交资产

```
UPlaneCutTool::OnShutdown(Accept)                  PlaneCutTool.cpp:240
  └─> for each Preview:
        └─> Results.Emplace(Preview->Shutdown())   // 提取最终 Mesh
  └─> GenerateAsset(Results)                       PlaneCutTool.cpp:396
        ├─> [单块] CommitDynamicMeshUpdate()        // 写回原始 StaticMesh 资产
        └─> [bExportSeparatedPiecesAsNewMeshAssets]
              ├─> 按 SubObjectID 拆分 Mesh
              ├─> 原块 → CommitDynamicMeshUpdate()
              └─> 新块 → CreateMeshObject()         // 创建新 Actor
```

---

## 关键接口

| 接口/类 | 文件 | 作用 |
|---|---|---|
| `IDynamicMeshOperatorFactory` | ModelingOperators.h | 定义 `MakeNewOperator()`，工厂抽象 |
| `FDynamicMeshOperator` | ModelingOperators.h | 定义 `CalculateResult()`，Op 基类 |
| `TBackgroundModelingComputeSource` | BackgroundModelingComputeSource.h | 后台线程调度，管理 Op 生命周期 |
| `UMeshOpPreviewWithBackgroundCompute` | MeshOpPreviewHelpers.h | 预览 Mesh + 后台计算的桥接层 |
| `FPlaneCutOp` | PlaneCutOp.h | 参数封装，调用 FMeshPlaneCut |
| `FMeshPlaneCut` | MeshPlaneCut.h | 核心几何算法 |

---

## 线程模型

```
Game Thread                          Worker Thread (线程池)
─────────────────────────────────────────────────────────
UPlaneCutTool::OnTick()
  │
  ├─ InvalidateResult()
  │    └─ StartNewCompute()
  │         └─ StartBackgroundTask() ──────────────────> TModelingOpTask::DoWork()
  │                                                            └─ FPlaneCutOp::CalculateResult()
  │                                                                  └─ FMeshPlaneCut::Cut()
  │                                                                       └─ ...（几何计算）
  │
  └─ Tick() → UpdateResults()
       └─ CheckStatus() ←─────────────────────────────── 任务完成，状态变为 ValidResult
            └─ ExtractResult()
                 └─ PreviewMesh->UpdatePreview()         (回到 Game Thread 更新渲染)
```

DoCut() 每次执行时先把当前预览 Mesh 作为下一次的输入（`ExtractPreviewMesh`），因此可以在不退出工具的情况下连续多刀切割，每次切割都基于上次的结果。
