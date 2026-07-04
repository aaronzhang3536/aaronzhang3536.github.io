---
title: "UE MeshModelingToolset — CutThrough 网格穿透切割分析"
cat: UE 剖析
date: 2026-05-20
mins: 8
tags: [几何处理, 网格切割]
---

## 概述

CutThrough 是 MeshModelingToolset 插件中 **PolygonOnMesh 工具**提供的一种网格切割操作。它沿指定平面将一个多边形形状完整地切穿网格，在两侧表面各留下切割边，并在两侧边缘之间缝合出内壁面（tunnel wall）。

---

## 涉及文件

| 文件 | 职责 |
|---|---|
| [EmbedPolygonsOp.h](../Source/ModelingOperatorsEditorOnly/Public/CuttingOps/EmbedPolygonsOp.h) | 操作枚举定义、Op 类声明 |
| [EmbedPolygonsOp.cpp](../Source/ModelingOperatorsEditorOnly/Private/CuttingOps/EmbedPolygonsOp.cpp) | 核心切割逻辑实现 |
| [PolygonOnMeshTool.h](../Source/MeshModelingToolsEditorOnly/Public/PolygonOnMeshTool.h) | 编辑器工具入口，默认操作为 CutThrough |

---

## 操作枚举

```cpp
// EmbedPolygonsOp.h:17
enum class EEmbeddedPolygonOpMethod : uint8
{
    TrimOutside,    // 保留多边形外部，删除内部
    TrimInside,     // 保留多边形内部，删除外部
    InsertPolygon,  // 仅嵌入多边形边缘，不删除面
    CutThrough,     // 完整穿透切割，缝合内壁
    CutOutside      // 穿透切割，保留外部部分
};
```

编辑器工具默认使用 `CutThrough`（见 [PolygonOnMeshTool.h:70](../Source/MeshModelingToolsEditorOnly/Public/PolygonOnMeshTool.h)）。

---

## 两种实现路径

`FEmbedPolygonsOp::CalculateResult` 根据 `bCutWithBoolean` 标志选择两条完全不同的实现路径。

```
CalculateResult()
├── bCutWithBoolean == true  →  BooleanPath()   (CSG 布尔差集)
└── bCutWithBoolean == false →  Surface Embed   (曲面路径投影)
```

### 路径 A：BooleanPath（布尔路径，默认）

**流程：**

1. 计算多边形帧（`PolygonFrame`）在网格包围盒方向上的投影范围 `Range`
2. 将输入多边形沿法线方向拉伸为一个封闭柱体（`FGeneralizedCylinderGenerator`），高度超出网格包围盒
3. 对原始网格与柱体执行布尔运算

```cpp
// EmbedPolygonsOp.cpp:209
case EEmbeddedPolygonOpMethod::CutThrough:
    BoolOp = FMeshBoolean::EBooleanOp::Difference;   // 差集 = 挖孔
    break;
case EEmbeddedPolygonOpMethod::CutOutside:
    BoolOp = FMeshBoolean::EBooleanOp::Intersect;    // 交集 = 保留外部
    break;
```

4. 布尔完成后，通过 Group ID 变化检测嵌入边（`EmbeddedEdges`），用于视觉高亮

**孔洞修复（bAttemptFixHolesOnBoolean）：**  
布尔运算可能因数值误差留下开放边界（boundary edges）。开启后会用 `FMinimalHoleFiller` 对每条开放边界环填充三角形，并计算法线和 UV。

---

### 路径 B：Surface Embed（曲面嵌入路径）

**流程：**

1. **射线检测**：从多边形帧上方向下发射射线，收集命中三角形列表 `SortedHitTriangles`（按深度排序）

2. **找第二层表面**：CutThrough 需要穿透两层表面。代码跳过与第一次命中深度相同的三角形（共面情况），找到真正的第二个表面：

```cpp
// EmbedPolygonsOp.cpp:364
if (Operation == EEmbeddedPolygonOpMethod::CutThrough || Operation == EEmbeddedPolygonOpMethod::CutOutside)
{
    while (SecondHit < SortedHitTriangles.Num() &&
           FMath::IsNearlyEqual(SortedHitTriangles[SecondHit].Key, SortedHitTriangles[0].Key))
    {
        SecondHit++;
    }
    if (SecondHit >= SortedHitTriangles.Num())
    {
        SecondHit = -1;  // 找不到第二层，退化为单面切割
    }
}
```

3. **切割两个面**：`CutAllHoles` 同时在正面和背面嵌入多边形路径，删除内部三角形（`DeleteInside`）

4. **缝合内壁**（CutThrough 的核心步骤）：

```cpp
// EmbedPolygonsOp.cpp:559
bool bStitched = MeshEditor.StitchSparselyCorrespondedVertexLoops(
    AllPathVertIDs[0], AllPathVertCorrespond[0],   // 正面切割环
    AllPathVertIDs[1], AllPathVertCorrespond[1],   // 背面切割环
    ResultOut, bReverseOrientation
);
```

`StitchSparselyCorrespondedVertexLoops` 将两条顶点环（前后两个切割路径）对应缝合，生成内壁三角形。

5. **设置法线和 UV**：为内壁三角形计算管道法线（`SetTubeNormals`）和 UV（`SetGeneralTubeUVs`），UV 沿多边形周长展开。

---

## 辅助函数

### `CleanPolygon`
对输入多边形执行自相交清理。通过与空集合做 Union 来消除自相交，返回清理后的多边形数组。布尔路径支持多多边形，曲面路径只取第一个。

### `CollapseDegenerateEdgesOnVertexPath`（文件级函数）
在曲面嵌入后，将切割路径上距离过近（默认阈值 0.1）的顶点塌陷合并，避免退化边影响后续缝合。同时维护路径顶点的 ID 对应关系以保证缝合正确。

### `RecordEmbeddedEdges`
将切割路径的顶点序列转换为边 ID，记录到 `EmbeddedEdges` 数组，供编辑器工具高亮显示切割轮廓。

---

## 删除方向对照

| Operation | DeleteMethod | BooleanOp |
|---|---|---|
| TrimOutside | DeleteOutside | TrimOutside |
| TrimInside | DeleteInside | TrimInside |
| InsertPolygon | DeleteNone | NewGroupInside |
| **CutThrough** | **DeleteInside** | **Difference** |
| CutOutside | DeleteOutside | Intersect |

---

## 关键数据结构

```cpp
class FEmbedPolygonsOp : public FDynamicMeshOperator
{
    // 输入
    FFrame3d PolygonFrame;          // 切割平面（位置 + 朝向）
    FPolygon2d EmbedPolygon;        // 切割多边形形状（2D）
    bool bCutWithBoolean;           // true=布尔路径, false=曲面路径
    bool bAttemptFixHolesOnBoolean; // 布尔后是否自动补洞
    EEmbeddedPolygonOpMethod Operation;

    // 输出
    TArray<int> EdgesOnFailure;     // 失败时高亮的边（帮助诊断）
    TArray<int> EmbeddedEdges;      // 成功切割的嵌入边
    bool bOperationSucceeded;
};
```

---

## 注意事项

- `FMeshBoolean::Compute()` 在非 Trim 操作产生 boundary edges 时返回 false，但这对开放网格（如矩形面片）是正常现象，因此 `bOperationSucceeded` 不依赖其返回值（见 EmbedPolygonsOp.cpp:237 注释）。
- 曲面路径不支持多多边形（`CleanPolygon` 分割自交后只取 `[0]`），布尔路径支持。
- `CutOutside` 与 `CutThrough` 共用大部分代码路径，区别在于 `bReverseOrientation=true`（内壁法线翻转）和布尔操作为 Intersect 而非 Difference。
