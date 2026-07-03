---
title: "Nanite LOD 选择逻辑"
cat: 渲染管线
date: 2026-05-27
mins: 22
---

> Nanite 的 LOD（Level of Detail）选择是完全 GPU 驱动的，通过 BVH 层次遍历动态决定每个 Cluster 的可见性和细节层级。

---

## 1. 核心概念

### 1.1 传统 LOD vs Nanite LOD

| 对比项 | 传统 Mesh LOD | Nanite LOD |
|--------|--------------|------------|
| 决策位置 | CPU | GPU |
| 切换粒度 | 整个 Mesh | 单个 Cluster（~128三角形） |
| LOD 层级 | 固定几级（LOD0-LOD4） | 连续无缝（数百万级别） |
| 切换时机 | 基于距离阈值 | 基于投影边长 |
| 过渡方式 | 可能有跳变 | 完全平滑（同一网格不同区域可以不同 LOD） |

### 1.2 核心思想

Nanite 的 LOD 选择基于一个简单原则：**让屏幕上每条三角形边都保持在目标像素长度附近**。

```
目标：每条边的屏幕像素长度 ≈ r.Nanite.MaxPixelsPerEdge（默认 1.0）
```

---

## 2. 控制参数

### 2.1 核心 CVars

`NaniteCullRaster.cpp:143-169`:

| CVar | 默认值 | 说明 |
|------|--------|------|
| `r.Nanite.MaxPixelsPerEdge` | 1.0 | 目标三角形边长（像素），**值越小质量越高** |
| `r.Nanite.MinPixelsPerEdgeHW` | 32.0 | 切换到硬件光栅化的边长阈值（像素） |
| `r.Nanite.DicingRate` | 2.0 | Tessellation 细分目标大小（像素） |

```cpp
// NaniteCullRaster.cpp:143-148
TAutoConsoleVariable<float> CVarNaniteMaxPixelsPerEdge(
    TEXT("r.Nanite.MaxPixelsPerEdge"),
    1.0f,
    TEXT("The triangle edge length that the Nanite runtime targets, measured in pixels."),
    ECVF_RenderThreadSafe
);

// NaniteCullRaster.cpp:157-162
TAutoConsoleVariable<float> CVarNaniteMinPixelsPerEdgeHW(
    TEXT("r.Nanite.MinPixelsPerEdgeHW"),
    32.0f,
    TEXT("The triangle edge length in pixels at which Nanite starts using the hardware rasterizer."),
    ECVF_RenderThreadSafe
);
```

### 2.2 参数影响

```
MaxPixelsPerEdge 影响：
├─ 值 = 1.0（默认）  → 每三角形边约 1 像素，最高质量
├─ 值 = 2.0         → 每三角形边约 2 像素，性能提升，质量略降
└─ 值 = 0.5         → 每三角形边约 0.5 像素，超高质量，性能下降

MinPixelsPerEdgeHW 影响：
├─ 值 = 32.0（默认）→ 边长 > 32 像素时用硬件光栅化
├─ 值 = 64.0        → 更早切换到硬件光栅化，减少软件光栅开销
└─ 值 = 16.0        → 更晚切换，更多软件光栅化
```

---

## 3. LOD Scale 计算

### 3.1 CPU 端计算

`NaniteShared.cpp:90-98`:

```cpp
void FPackedView::UpdateLODScales(const float NaniteMaxPixelsPerEdge, const float MinPixelsPerEdgeHW)
{
    // ViewToPixels = 投影矩阵纵向分量 × 视图高度的一半
    // 这是将世界空间单位长度投影到屏幕像素的缩放因子
    const float ViewToPixels = 0.5f * ViewToClip.M[1][1] * ViewSizeAndInvSize.Y;

    // LODScale：用于 LOD 选择判断
    const float LODScale = ViewToPixels / NaniteMaxPixelsPerEdge;

    // LODScaleHW：用于硬件/软件光栅化切换判断
    const float LODScaleHW = ViewToPixels / MinPixelsPerEdgeHW;

    LODScales = FVector2f(LODScale, LODScaleHW);
}
```

### 3.2 公式推导

$$
\text{ViewToPixels} = \frac{1}{2} \times M[1][1] \times \text{ViewHeight} = \frac{\text{ViewHeight}}{2 \cdot \tan(\text{FOV}/2)}
$$

$$
\text{LODScale} = \frac{\text{ViewToPixels}}{\text{MaxPixelsPerEdge}}
$$

含义：
- LODScale 越大，说明同样的世界空间长度在屏幕上占据更多像素
- 用于后续判断：边长 × LODScale > 阈值 → 需要更细的 LOD

### 3.3 额外缩放因子

`NaniteShared.cpp:133-140`:

```cpp
// 从 CVar 读取并应用乘数
const float NaniteMaxPixelsPerEdge = CVarNaniteMaxPixelsPerEdge.GetValueOnRenderThread()
                                     * Params.MaxPixelsPerEdgeMultipler;

// 视图距离 LOD 缩放（来自 Scalability 设置）
const float ViewDistanceLODScale = GetCachedScalabilityCVars().StaticMeshLODDistanceScale
                                   * Params.ViewLODDistanceFactor;

// 屏幕投影倍数
const float ScreenMultiple = FMath::Max(
    Params.ViewMatrices.GetProjectionMatrix().M[0][0],
    Params.ViewMatrices.GetProjectionMatrix().M[1][1]
) / ViewDistanceLODScale;
```

---

## 4. GPU 端 LOD 判断

### 4.1 数据结构

`NaniteDataDecode.ush`:

```hlsl
// 行 157-171：层次节点切片
struct FHierarchyNodeSlice
{
    float4 LODBounds;              // LOD 边界球（xyz=中心, w=半径）
    float3 BoxBoundsCenter;        // 包围盒中心
    float3 BoxBoundsExtent;        // 包围盒半扩展
    float  MinLODError;            // 该节点的最小 LOD 误差
    float  MaxParentLODError;      // 父节点的最大 LOD 误差（用于判断是否遍历）
    uint   ChildStartReference;    // 子节点起始索引
    uint   NumChildren;            // 子节点数量
    bool   bEnabled;               // 是否启用
    bool   bLoaded;                // 是否已加载
    bool   bLeaf;                  // 是否为叶节点
};

// 行 67-94：Cluster 数据
struct FCluster
{
    float4 LODBounds;              // LOD 边界球
    float  LODError;               // 该 Cluster 的 LOD 误差
    float  EdgeLength;             // 代表性边长
    // ...
};

// 行 180-230：视图数据
struct FNaniteView
{
    float LODScale;                // LOD 判断缩放因子
    float LODScaleHW;              // 硬件光栅化阈值缩放因子
    // ...
};
```

### 4.2 投影边长计算

`NaniteClusterCulling.usf:233-279`:

```hlsl
float2 GetProjectedEdgeScales(
    FNaniteView NaniteView,
    FInstanceSceneData InstanceData,
    FInstanceDynamicData DynamicData,
    float4 Bounds  // xyz=中心, w=半径
)
{
    // 正交投影直接返回 1（无透视缩放）
    if(NaniteView.ViewToClip[3][3] >= 1.0f)
    {
        return float2(1, 1);
    }

    // 1. 将边界球心变换到相机空间
    float3 Center = mul(float4(Bounds.xyz, 1.0f), DynamicData.LocalToTranslatedWorld).xyz;
    float Radius = Bounds.w * InstanceData.NonUniformScale.w;

    // 2. 计算球心到相机的距离
    float ZNear = NaniteView.NearPlane;
    float DistToClusterSq = length2(Center);  // 相机在原点

    // 3. 计算球在视图方向的深度
    float Z = dot(NaniteView.ViewForward.xyz, Center);

    // 4. 复杂的几何计算：求球的投影圆锥角
    // ... （圆锥几何，处理球体部分在近平面前的情况）

    // 5. 返回 (最小投影深度 × 最小余弦角, 最大投影深度 × 最大余弦角)
    float MinZ = max(Z - Radius, ZNear);
    float MaxZ = max(Z + Radius, ZNear);

    return float2(MinZ * MinCosAngle, MaxZ * MaxCosAngle);
}
```

**几何含义：**
```
                    近平面
                      │
    相机 ────────────┼─────── 视线方向 ───────→
      ◉              │
       \             │         ○ 边界球
        \            │        ╱│╲
         \           │       ╱ │ ╲
          ─ 视锥角 ──│──────╱──┼──╲
                     │     ╱   │   ╲
                     │    ╱    │    ╲

返回值含义：
  .x = MinZ × MinCosAngle → 球最近点的"有效深度"
  .y = MaxZ × MaxCosAngle → 球最远点的"有效深度"

ProjectedEdgeScale 越小 → 物体越远/越小 → 需要更粗的 LOD
```

### 4.3 核心判断函数 1：ShouldVisitChild

`NaniteClusterCulling.usf:281-308`:

```hlsl
bool ShouldVisitChildInternal(
    FNaniteView NaniteView,
    FInstanceSceneData InstanceData,
    FInstanceDynamicData DynamicData,
    FNodeCullingBounds Bounds,
    FHierarchyNodeSlice HierarchyNodeSlice,
    inout float Priority
)
{
    // 1. 获取投影边长（最小值和最大值）
    float2 ProjectedEdgeScales = GetProjectedEdgeScales(
        NaniteView, InstanceData, DynamicData, Bounds.Sphere
    );

    // 2. 计算统一缩放（取实例缩放的最小分量）
    float UniformScale = Bounds.MeshMinDeformScale * min3(
        InstanceData.NonUniformScale.x,
        InstanceData.NonUniformScale.y,
        InstanceData.NonUniformScale.z
    );

    // 3. 计算阈值：LODScale × 缩放 × 父节点最大误差
    float Threshold = NaniteView.LODScale * UniformScale * HierarchyNodeSlice.MaxParentLODError;

    // 4. 核心判断：投影边长 ≤ 阈值 → 需要访问子节点
    if(ProjectedEdgeScales.x <= Threshold)
    {
        // 计算优先级（用于流媒体调度）
        Priority = Threshold / ProjectedEdgeScales.x;

        // MinLOD 约束检查
        bool bSkipMinLODCulling = false;
        #if DEBUG_FLAGS
            bSkipMinLODCulling |= (DebugFlags & NANITE_DEBUG_FLAG_DISABLE_CULL_MIN_LOD) != 0u;
        #endif

        // 叶节点需要额外检查 MinLODError
        return bSkipMinLODCulling ||
               !HierarchyNodeSlice.bLeaf ||
               (ProjectedEdgeScales.y >= NaniteView.LODScale * UniformScale * HierarchyNodeSlice.MinLODError);
    }
    else
    {
        return false;  // 当前节点已足够细，不需要继续遍历
    }
}
```

**判断逻辑图：**

```
┌─────────────────────────────────────────────────────────────────┐
│                     ShouldVisitChild 决策流程                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  输入：                                                          │
│    • ProjectedEdgeScales.x = 投影边长（最小值）                  │
│    • LODScale = ViewToPixels / MaxPixelsPerEdge                 │
│    • UniformScale = 实例缩放                                     │
│    • MaxParentLODError = 父节点 LOD 误差                        │
│                                                                  │
│  计算：                                                          │
│    Threshold = LODScale × UniformScale × MaxParentLODError      │
│                                                                  │
│  判断：                                                          │
│                                                                  │
│    ProjectedEdgeScales.x ≤ Threshold ?                          │
│           │                                                      │
│     ┌─────┴─────┐                                                │
│     │           │                                                │
│     v           v                                                │
│    YES         NO                                                │
│     │           │                                                │
│     │           └──→ return false                                │
│     │                (当前节点足够细，停止遍历)                   │
│     │                                                            │
│     v                                                            │
│    是叶节点？                                                    │
│     │                                                            │
│   ┌─┴─┐                                                          │
│   │   │                                                          │
│   v   v                                                          │
│  YES  NO ──→ return true (继续访问子节点)                       │
│   │                                                              │
│   v                                                              │
│  ProjectedEdgeScales.y ≥ LODScale × UniformScale × MinLODError? │
│   │                                                              │
│ ┌─┴─┐                                                            │
│ │   │                                                            │
│ v   v                                                            │
│YES  NO ──→ return false (达到 MinLOD 限制)                      │
│ │                                                                │
│ └──→ return true (绘制此叶节点)                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.4 核心判断函数 2：SmallEnoughToDraw

`NaniteClusterCulling.usf:310-335`:

```hlsl
bool SmallEnoughToDraw(
    FNaniteView NaniteView,
    FInstanceSceneData InstanceData,
    FInstanceDynamicData DynamicData,
    FNodeCullingBounds Bounds,
    float LODError,           // Cluster 的 LOD 误差
    float EdgeLength,         // Cluster 的代表性边长
    inout bool bUseHWRaster   // 输出：是否使用硬件光栅化
)
{
    // 1. 获取投影边长
    float ProjectedEdgeScale = GetProjectedEdgeScales(
        NaniteView, InstanceData, DynamicData, Bounds.Sphere
    ).x;  // 取最小值

    // 2. 计算统一缩放
    float UniformScale = Bounds.MeshMinDeformScale * min3(
        InstanceData.NonUniformScale.x,
        InstanceData.NonUniformScale.y,
        InstanceData.NonUniformScale.z
    );

    // 3. 可见性判断：投影边长 > LODError × LODScale → 可见
    bool bVisible = ProjectedEdgeScale > UniformScale * LODError * NaniteView.LODScale;

    // 4. 光栅化模式选择
    if (RenderFlags & NANITE_RENDER_FLAG_FORCE_HW_RASTER)
    {
        bUseHWRaster = true;
    }
    else
    {
        float HWEdgeScale = InstanceData.NonUniformScale.w * Bounds.NodeMaxDeformScale;
        // 投影边长 < 边长 × LODScaleHW → 三角形太小，用软件光栅化
        bUseHWRaster |= ProjectedEdgeScale < HWEdgeScale * abs(EdgeLength) * NaniteView.LODScaleHW;
    }

    return bVisible;
}
```

**光栅化选择逻辑：**

```
┌─────────────────────────────────────────────────────────────────┐
│                    软件/硬件光栅化选择                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  计算：                                                          │
│    ScreenEdgeLength = ProjectedEdgeScale × EdgeLength            │
│                     ≈ 三角形边在屏幕上的像素长度                 │
│                                                                  │
│    HWThreshold = LODScaleHW                                      │
│                = ViewToPixels / MinPixelsPerEdgeHW               │
│                                                                  │
│  判断：                                                          │
│                                                                  │
│    ScreenEdgeLength 与 MinPixelsPerEdgeHW(32像素) 比较          │
│           │                                                      │
│     ┌─────┴─────┐                                                │
│     │           │                                                │
│     v           v                                                │
│   > 32px      ≤ 32px                                            │
│     │           │                                                │
│     v           v                                                │
│  硬件光栅化    软件光栅化                                        │
│  (HW Raster)   (SW Raster)                                       │
│     │           │                                                │
│     │           │                                                │
│     v           v                                                │
│  • 使用传统    • 使用 Compute Shader                            │
│    图形管线    • 精确亚像素处理                                  │
│  • 三角形大    • 适合密集微多边形                                │
│  • 效率高      • 避免硬件光栅化的 overhead                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. 完整 LOD 选择流程

### 5.1 流程总图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Nanite LOD 选择完整流程                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                          1. CPU 准备阶段                              │   │
│  │                                                                       │   │
│  │   读取 CVars                          计算 LOD Scales                │   │
│  │   ┌──────────────────┐               ┌──────────────────────────┐    │   │
│  │   │ MaxPixelsPerEdge │               │ ViewToPixels = 0.5 ×     │    │   │
│  │   │ = 1.0            │ ───────────→  │   M[1][1] × ViewHeight   │    │   │
│  │   │ MinPixelsPerEdgeHW│              │                          │    │   │
│  │   │ = 32.0           │               │ LODScale = ViewToPixels  │    │   │
│  │   └──────────────────┘               │           / MaxPixelsPerEdge│  │   │
│  │                                      │                          │    │   │
│  │                                      │ LODScaleHW = ViewToPixels│    │   │
│  │                                      │           / MinPixelsPerEdgeHW│ │   │
│  │                                      └──────────────────────────┘    │   │
│  │                                               │                       │   │
│  │                                               v                       │   │
│  │                                      ┌──────────────────────────┐    │   │
│  │                                      │ 打包到 FPackedView       │    │   │
│  │                                      │ 上传到 GPU               │    │   │
│  │                                      └──────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                               │                              │
│                                               v                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                          2. GPU 遍历阶段                              │   │
│  │                                                                       │   │
│  │   BVH 根节点                                                         │   │
│  │       │                                                               │   │
│  │       v                                                               │   │
│  │   ┌─────────────────────────────────────────────────────────────┐    │   │
│  │   │              对每个节点调用 ShouldVisitChild()               │    │   │
│  │   │                                                              │    │   │
│  │   │   ProjectedEdge ≤ LODScale × Scale × MaxParentLODError ?    │    │   │
│  │   │                          │                                   │    │   │
│  │   │                    ┌─────┴─────┐                             │    │   │
│  │   │                    │           │                             │    │   │
│  │   │                   YES         NO                             │    │   │
│  │   │                    │           │                             │    │   │
│  │   │                    v           v                             │    │   │
│  │   │              访问子节点    停止（此分支足够细）              │    │   │
│  │   │                    │                                         │    │   │
│  │   │                    v                                         │    │   │
│  │   │              递归遍历...                                     │    │   │
│  │   └─────────────────────────────────────────────────────────────┘    │   │
│  │                                               │                       │   │
│  │                                               v                       │   │
│  │   ┌─────────────────────────────────────────────────────────────┐    │   │
│  │   │                     到达叶节点(Cluster)                      │    │   │
│  │   │                                                              │    │   │
│  │   │              调用 SmallEnoughToDraw()                        │    │   │
│  │   │                                                              │    │   │
│  │   │   ProjectedEdge > LODError × LODScale ?                     │    │   │
│  │   │                          │                                   │    │   │
│  │   │                    ┌─────┴─────┐                             │    │   │
│  │   │                    │           │                             │    │   │
│  │   │                   YES         NO                             │    │   │
│  │   │                    │           │                             │    │   │
│  │   │                    v           v                             │    │   │
│  │   │              此 Cluster     此 Cluster                       │    │   │
│  │   │              可见          不可见（太粗）                     │    │   │
│  │   │                    │                                         │    │   │
│  │   │                    v                                         │    │   │
│  │   │              判断光栅化模式                                   │    │   │
│  │   │              ScreenEdge < 32px ? SW : HW                     │    │   │
│  │   └─────────────────────────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                               │                              │
│                                               v                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                          3. 输出结果                                  │   │
│  │                                                                       │   │
│  │   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐  │   │
│  │   │VisibleClustersSW│    │VisibleClustersHW│    │ 流媒体请求队列  │  │   │
│  │   │ (软件光栅化列表)│    │ (硬件光栅化列表)│    │ (需要加载的页面)│  │   │
│  │   └─────────────────┘    └─────────────────┘    └─────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 关键公式汇总

| 公式 | 含义 | 用途 |
|------|------|------|
| `ViewToPixels = 0.5 × M[1][1] × ViewHeight` | 世界单位到像素的转换因子 | 基础投影计算 |
| `LODScale = ViewToPixels / MaxPixelsPerEdge` | LOD 判断缩放因子 | 乘以误差后与投影边长比较 |
| `LODScaleHW = ViewToPixels / MinPixelsPerEdgeHW` | HW/SW 切换缩放因子 | 判断光栅化模式 |
| `Threshold = LODScale × UniformScale × MaxParentLODError` | 遍历阈值 | ShouldVisitChild 判断 |
| `bVisible = ProjectedEdge > LODError × LODScale` | 可见性条件 | SmallEnoughToDraw 判断 |
| `bUseHWRaster = ProjectedEdge < EdgeLength × LODScaleHW` | 软件光栅化条件 | 光栅化模式选择 |

---

## 6. LOD Error 的含义

### 6.1 什么是 LODError

`LODError` 是 Nanite 构建时为每个 Cluster 和 HierarchyNode 计算的**几何简化误差**。

```
LODError 表示：
  如果用这个 Cluster 替代其更细的子 Cluster，
  在屏幕上最多会产生多大的视觉误差（以世界单位计）。

例如：
  LODError = 0.5 表示简化误差最多为 0.5 个世界单位

当 ProjectedEdge > LODError × LODScale 时：
  说明这个误差投影到屏幕上会小于 MaxPixelsPerEdge
  因此可以使用这个 Cluster，不需要更细的 LOD
```

### 6.2 MinLODError 和 MaxParentLODError

```
MaxParentLODError（父节点最大 LOD 误差）：
  - 存储在 HierarchyNode 中
  - 用于判断是否需要继续向下遍历
  - 如果 ProjectedEdge > MaxParentLODError × LODScale，
    说明父节点已经足够细，不需要访问子节点

MinLODError（最小 LOD 误差）：
  - 存储在叶节点中
  - 用于实现 MinLOD 限制
  - 防止过度细化超出资源数据精度
```

---

## 7. 动态分辨率与 LOD

### 7.1 DRS（Dynamic Resolution Scaling）集成

Nanite 支持通过调整 `MaxPixelsPerEdgeMultipler` 参数来配合动态分辨率缩放：

`NaniteShared.h:163`:

```cpp
struct FPackedViewParams
{
    // ...
    float MaxPixelsPerEdgeMultipler = 1.0f;  // DRS 乘数
    // ...
};
```

```
DRS 工作原理：
  当帧率下降时：
    1. 引擎降低渲染分辨率
    2. 同时增大 MaxPixelsPerEdgeMultipler（如 1.5）
    3. 结果：MaxPixelsPerEdge 有效值变为 1.0 × 1.5 = 1.5 像素
    4. LOD 变粗，三角形数量减少

  当帧率恢复时：
    1. 渲染分辨率恢复
    2. MaxPixelsPerEdgeMultipler 恢复为 1.0
    3. LOD 恢复正常精度
```

### 7.2 性能与质量平衡

```
┌────────────────────────────────────────────────────────────────┐
│              MaxPixelsPerEdge 对性能的影响                      │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  MaxPixelsPerEdge = 0.5                                        │
│  ├─ 每边 0.5 像素 → 亚像素三角形                               │
│  ├─ 三角形数量：极多                                           │
│  ├─ 质量：最高（超采样效果）                                   │
│  └─ 性能：最差                                                 │
│                                                                 │
│  MaxPixelsPerEdge = 1.0（默认）                                │
│  ├─ 每边 1 像素 → 像素级三角形                                 │
│  ├─ 三角形数量：适中                                           │
│  ├─ 质量：高                                                   │
│  └─ 性能：良好                                                 │
│                                                                 │
│  MaxPixelsPerEdge = 2.0                                        │
│  ├─ 每边 2 像素 → 小三角形                                     │
│  ├─ 三角形数量：较少                                           │
│  ├─ 质量：中等                                                 │
│  └─ 性能：较好                                                 │
│                                                                 │
│  MaxPixelsPerEdge = 4.0                                        │
│  ├─ 每边 4 像素 → 可见三角形                                   │
│  ├─ 三角形数量：少                                             │
│  ├─ 质量：较低（可能看到锯齿）                                 │
│  └─ 性能：最好                                                 │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 8. 调试与可视化

### 8.1 调试 CVars

```cpp
// 禁用 MinLOD 剔除
r.Nanite.Debug.Flags 1  // NANITE_DEBUG_FLAG_DISABLE_CULL_MIN_LOD

// 只绘制根数据（最粗 LOD）
r.Nanite.Debug.Flags 2  // NANITE_DEBUG_FLAG_DRAW_ONLY_ROOT_DATA

// 可视化 LOD 级别
r.Nanite.Visualize.LODLevel 1
```

### 8.2 RenderDoc 调试

在 RenderDoc 中查看：
1. `Nanite.ClusterCulling` Pass → 查看 LOD 遍历
2. `VisibleClustersSW` / `VisibleClustersHW` Buffer → 查看输出的 Cluster 列表
3. Shader 调试 → 单步跟踪 `ShouldVisitChild` 和 `SmallEnoughToDraw`

---

## 9. 源码参考索引

| 功能 | 文件 | 行号 | 关键内容 |
|------|------|------|---------|
| CVars 定义 | `NaniteCullRaster.cpp` | 143-169 | `MaxPixelsPerEdge`, `MinPixelsPerEdgeHW` |
| LOD Scale 计算 | `NaniteShared.cpp` | 90-98 | `UpdateLODScales()` |
| PackedView 创建 | `NaniteShared.cpp` | 119-237 | `CreatePackedView()` |
| 投影边长计算 | `NaniteClusterCulling.usf` | 233-279 | `GetProjectedEdgeScales()` |
| 遍历判断 | `NaniteClusterCulling.usf` | 281-308 | `ShouldVisitChildInternal()` |
| 可见性判断 | `NaniteClusterCulling.usf` | 310-335 | `SmallEnoughToDraw()` |
| 数据结构 | `NaniteDataDecode.ush` | 157-230 | `FHierarchyNodeSlice`, `FNaniteView` |
| 层次遍历 | `NaniteHierarchyTraversal.ush` | 68-130 | BVH 遍历框架 |

---

## 更新日志

| 日期 | 修改内容 |
|------|---------|
| 2026-01-20 | 初始版本，基于 UE 5.7 源码分析 |
