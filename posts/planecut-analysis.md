# UE MeshModelingToolset — PlaneCut 平面切割分析

## 概述

PlaneCut 用一个无限平面将网格切割，保留负侧（或两侧），并可在切割截面填充封口面。
相比 CutThrough（多边形穿透），PlaneCut 是全局平面操作，适合将网格一分为二或切掉一侧。

---

## 涉及文件（三层结构）

| 层次 | 文件 | 职责 |
|---|---|---|
| 编辑器工具层 | [PlaneCutTool.h/.cpp](../../Experimental/MeshModelingToolsetExp/Source/MeshModelingToolsExp/Public/PlaneCutTool.h) | 交互工具，管理平面 Gizmo、多组件支持、Keep Both Halves |
| Op 层 | [PlaneCutOp.h/.cpp](../Source/ModelingOperators/Public/CuttingOps/PlaneCutOp.h) | 异步 Operator，参数封装，调用底层算法 |
| 几何算法层 | [MeshPlaneCut.h/.cpp](../../GeometryProcessing/Source/DynamicMesh/Public/Operations/MeshPlaneCut.h) | 核心切割算法：边分裂、删顶点、补洞 |

---

## 算法总览（MeshPlaneCut）

头文件注释给出了完整算法步骤（MeshPlaneCut.h:39）：

```
1. 计算所有顶点到切割平面的有符号距离
2. 可选：删除所有顶点距离 < epsilon 的平面共面三角形
3. 对穿越平面的边执行 Edge Split（插入交点顶点）
4a. 删除正侧所有顶点（普通切割）
4b. 或：断开正侧三角形连接（保留两半）
4c. 或：什么都不做（仅分裂边）
5. 可选：塌陷退化边
6. 可选：为正侧三角形打新的 Attribute 标签
7. 沿有效边界提取切割环（loops）和切割段（spans）
```

**关键约定**：正侧 `(p - Origin) · Normal > 0` 被删除（或被分离）。

---

## 核心方法

### `Cut()`
标准单侧切割，最常用路径：

```cpp
// MeshPlaneCut.cpp:398
bool FMeshPlaneCut::Cut()
{
    SplitCrossingEdges(...);         // Step 3：分裂穿越边
    // 删除正侧所有顶点（及其三角形）
    for (int VID : ...) {
        if (Signs[VID] > PlaneTolerance)
            Mesh->RemoveVertex(VID, bPreserveManifold=false);
    }
    CollapseDegenerateEdges(...);    // Step 5
    SimplifyAlongEdges(...);         // 可选简化
    return ExtractBoundaryLoops(...); // Step 7
}
```

### `CutWithoutDelete()`
保留两半路径（`bKeepBothHalves=true`）。厚平面时需要调用两次：

```cpp
// PlaneCutOp.cpp:52
if (CutPlaneLocalThickness <= Cut.PlaneTolerance)
{
    Cut.CutWithoutDelete(true, 0, SubObjectAttrib, MaxSubObjectID+1);
}
else // 厚平面：两次切割 + 删除中间夹层
{
    Cut.PlaneOrigin -= Cut.PlaneNormal * CutPlaneLocalThickness;
    Cut.CutWithoutDelete(..., true, false);   // 第一刀，只要第一半的边界

    Cut.PlaneOrigin += Cut.PlaneNormal * (2.0 * CutPlaneLocalThickness);
    Cut.CutWithoutDelete(..., false, true);   // 第二刀，只要第二半的边界

    // 删除 SubObjectID 在两次切割之间的三角形（即被夹在两平面间的部分）
    for (int TID : ...) {
        if (SubObjectID > MaxSubObjectID && SubObjectID <= SecondCutMaxID)
            ResultMesh->RemoveTriangle(TID);
    }
}
```

`CutWithoutDelete` 内部还会把平面上的顶点 Split（`bSplitVerticesAtPlane=true`），让两侧网格真正断开为独立拓扑。

### `SplitEdgesOnly()`
只分裂边、不删除任何三角形，可选重新分配 Group ID。用于 PolyEdit 的插边/插边环操作。

---

## `SplitCrossingEdges` 详解

这是整个算法的基础，所有切割路径都先调它。

```
输入：Mesh、PlaneOrigin、PlaneNormal
输出：AlreadyOnPlaneEdges（原本就在平面上的边）
      CutPlaneEdges（新分裂后位于平面上的边）
      可选：SplitEdges、OnPlaneVertices
```

**流程：**

1. `ComputeVertexSignedDistances`：并行计算所有顶点有符号距离（`ParallelFor`）
2. 可选删除共面三角形（`bDeleteTrisOnPlane`）
3. 遍历所有原始边（`EID < MaxEID`，跳过新增边）：
   - 两端同侧（`DistA * DistB > 0`）→ 跳过
   - 一端在平面上 → 加入 `AlreadyOnPlaneEdges`，不分裂
   - 两端异侧 → 按距离比例插值 `Param = DistA / (DistA - DistB)`，调用 `Mesh->SplitEdge`

```cpp
double Param = DistA / (DistA - DistB);
EMeshResult SplitResult = Mesh->SplitEdge(EID, SplitInfo, Param);
```

新生成的交点顶点精确落在平面上，其相关边加入 `CutPlaneEdges`。

---

## 孔洞填充（HoleFill）

### Loop 与 Span 的区别

`ExtractBoundaryLoops` 调用 `FMeshBoundaryLoops::Compute()` 提取切割边界，结果分为两类：

- **`CutLoops`（闭合环）**：切割线首尾相接，形成完整的封闭边界，是正常情况
- **`CutSpans`（开放段）**：切割线两端悬空，无法闭合

```cpp
// MeshPlaneCut.cpp:587
Boundary.CutLoops = Loops.Loops;
Boundary.CutSpans = Loops.Spans;
Boundary.FoundOpenSpans = Boundary.CutSpans.Num() > 0;
```

**`HoleFill` 默认只处理 `CutLoops`**，`bFillSpans=false` 时 `CutSpans` 被完全忽略。

### bFillSpans 的真实含义

`bFillSpans` **不是"补预先存在的洞"**，而是控制是否将 `CutSpans` 也纳入 `FPlanarHoleFiller` 的输入参与三角化：

```cpp
// MeshPlaneCut.cpp:731
if (bFillSpans)
{
    for (const FEdgeSpan& Span : Boundary.CutSpans)
        LoopVertices.Add(Span.Vertices);
}
```

### 为什么封闭网格切割后也可能出现 Span

`FMeshBoundaryLoops::Compute()` 返回 true（无 abort）并不代表所有边界都形成了 Loop。遇到以下情况时，走不通的 loop 会按 `FailureBehavior = ConvertToOpenSpan` 降级为 Span：

- 切割线在某处经过**蝴蝶结顶点（bowtie vertex）**
- 切割平面附近有**退化边或共面三角形**，`CollapseDegenerateEdges` 后顶点重合导致无法走完一圈
- 网格在切面处存在**轻微拓扑问题**（非流形边等）

因此，**即使输入是封闭网格，`bFillCutHole=true` 却补不上截面，通常是切割边界被分类为 Span 而非 Loop 导致的**，此时需要开启 `bFillSpans=true`。

调试方法：切割后检查 `OpenBoundaries[0].CutLoops.Num()` 和 `CutSpans.Num()`，即可确认实际分类结果。

### 三种填充策略

| 方法 | 类 | 特点 |
|---|---|---|
| `SimpleHoleFill` | `FSimpleHoleFiller` | Fan 形三角化，最快 |
| `MinimalHoleFill` | `FMinimalHoleFiller` | 最小化三角形数量 |
| `HoleFill`（默认） | `FPlanarHoleFiller` | 约束 Delaunay 三角化，质量最好 |

`PlaneCutOp.cpp` 调用方式：
```cpp
// PlaneCutOp.cpp:93
if (bFillCutHole)
{
    Cut.HoleFill(ConstrainedDelaunayTriangulate<double>, bFillSpans);
}
```

填充后自动设置法线（沿平面法线）和 UV（平面投影，`UVScaleFactor` 控制密度）。

**Keep Both Halves 的特殊处理：**  
两半各有独立的 `FOpenBoundary`（`NormalSign` 分别为 +1 和 -1），填充时法线方向相反，保证两侧封口面都朝外。填充后调用 `TransferTriangleLabelsToHoleFillTriangles` 将 SubObjectID 写入封口三角形，以便后续分离为独立资产。

---

## 退化边塌陷

切割后切割线上可能出现极短边（两端距离 < `DegenerateEdgeTol`），不处理会影响后续拓扑。

`CollapseDegenerateEdges` 反复遍历切割边集合，对满足条件的边执行 `CollapseEdge`，将 Seam 顶点优先保留（`IsSeamVertex` 检查），直到没有可塌陷的边为止。

---

## 编辑器工具层（UPlaneCutTool）

位于 `MeshModelingToolsetExp` 插件（Experimental）。

**关键功能：**
- 支持多组件同时切割（`MultiSelectionMeshEditingTool`）
- 平面交互通过 `UConstructionPlaneMechanic` 实现（支持拖拽、对齐）
- `bKeepBothHalves` + `bExportSeparatedPiecesAsNewMeshAssets`：切割后可将两半输出为独立静态网格资产
- `SpacingBetweenHalves`：切割后两半之间留出间距（通过厚平面的偏移距离实现）
- 热键：`T` = 执行切割，`R` = 翻转平面法线
- UV Scale 在工具启动时根据网格包围盒缓存，多次连切时 UV 密度一致

---

## Op 层参数（FPlaneCutOp）

```cpp
// PlaneCutOp.h
FVector3d LocalPlaneOrigin, LocalPlaneNormal; // 平面（网格局部空间）
bool bFillCutHole = true;           // 是否填充截面
bool bFillSpans = false;            // 是否将 CutSpans 也纳入填充；封闭网格切割后若补不上截面，先检查边界是否被降级为 Span
bool bKeepBothHalves = false;       // 是否保留两半
bool bSimplifyAlongNewEdges = true; // 是否简化切割线附近的细碎三角形
double CutPlaneLocalThickness = 0;  // 厚平面宽度（0 = 无厚度）
double UVScaleFactor = 0;           // 封口面 UV 缩放
```

---

## 与 CutThrough 的对比

| 维度 | PlaneCut | CutThrough |
|---|---|---|
| 切割形状 | 无限平面 | 用户绘制的任意多边形 |
| 结果 | 一侧（或两侧）被保留 | 网格上开孔，孔洞内壁被缝合 |
| 底层算法 | 边分裂 + 顶点删除 | 布尔差集（默认）或曲面路径投影 |
| 封口 | 平面 Delaunay 填充 | 内壁由 StitchVertexLoops 缝合 |
| 多边形支持 | 单平面（无限） | 任意凸/凹多边形 |
| 厚度支持 | 有（两次切割） | 无 |
| 所在插件 | `MeshModelingToolsetExp`（Experimental） | `MeshModelingToolset`（稳定） |
