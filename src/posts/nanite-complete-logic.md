---
title: "Nanite 完整逻辑"
cat: UE 剖析
sub: 渲染
date: 2026-01-20
mins: 26
tags: [Nanite, 几何管线]
---

> Nanite 是 UE5 的虚拟几何体系统，通过 GPU 驱动的细节层级选择和软件光栅化实现数十亿多边形的实时渲染。

---

## 1. 控制层级

### 1.1 项目设置（编译时）

Nanite 的启用首先在项目设置中控制：

```cpp
// Project Settings → Engine → Rendering → Nanite
// 对应 DefaultEngine.ini:
[/Script/Engine.RendererSettings]
r.Nanite.ProjectEnabled=True
```

平台支持检测函数定义在 `NaniteShared.h:367-370`:
```cpp
static bool ShouldCompilePermutation(const FGlobalShaderPermutationParameters& Parameters)
{
    return DoesPlatformSupportNanite(Parameters.Platform);
}
```

### 1.2 全局开关（运行时 CVar）

#### 核心 CVars

| CVar | 默认值 | 说明 | 源文件位置 |
|------|--------|------|-----------|
| `r.Nanite.MaxPixelsPerEdge` | 1.0 | 目标三角形边长（像素），越小质量越高 | `NaniteCullRaster.cpp:143-148` |
| `r.Nanite.MinPixelsPerEdgeHW` | 32.0 | 切换到硬件光栅化的阈值 | `NaniteCullRaster.cpp:157-162` |
| `r.Nanite.ComputeRasterization` | 1 | 是否允许计算着色器光栅化 | `NaniteCullRaster.cpp:75-80` |
| `r.Nanite.ProgrammableRaster` | 1 | 是否允许可编程光栅化 | `NaniteCullRaster.cpp:82-87` |
| `r.Nanite.Tessellation` | 1 | 是否启用运行时曲面细分 | `NaniteCullRaster.cpp:89-98` |
| `r.Nanite.AsyncRasterization` | 1 | 是否使用异步计算光栅化 | `NaniteCullRaster.cpp:47-52` |

#### 剔除相关 CVars

```cpp
// NaniteCullRaster.cpp:268-324
r.Nanite.Culling.HZB          = 1   // HZB 遮挡剔除
r.Nanite.Culling.Frustum      = 1   // 视锥体剔除
r.Nanite.Culling.GlobalClipPlane = 1   // 全局裁剪平面
r.Nanite.Culling.DrawDistance = 1   // 绘制距离剔除
r.Nanite.Culling.TwoPass      = 1   // 两遍遮挡剔除
```

#### 流媒体 CVars

| CVar | 默认值 | 说明 |
|------|--------|------|
| `r.Nanite.Streaming.StreamingPoolSize` | 512 MB | GPU 流媒体池大小 |
| `r.Nanite.Streaming.NumInitialRootPages` | 2048 | 初始根页面数量 |
| `r.Nanite.Streaming.MaxPendingPages` | 128 | 每帧最大待处理页面 |
| `r.Nanite.Streaming.BandwidthLimit` | -1.0 | 带宽限制（-1=无限） |

#### 资源限制 CVars

```cpp
// NaniteShared.cpp
r.Nanite.MaxNodes              = 2*1024*1024    // 最大节点数
r.Nanite.MaxCandidateClusters  = 16*1024*1024   // 最大候选集群
r.Nanite.MaxVisibleClusters    = 4*1024*1024    // 最大可见集群
r.Nanite.MaxCandidatePatches   = 2*1024*1024    // 最大候选补丁（曲面细分）
r.Nanite.MaxVisiblePatches     = 2*1024*1024    // 最大可见补丁
```

### 1.3 资产设置（Per-Asset）

在 Static Mesh Editor 中启用 Nanite：
- **Enable Nanite Support**：启用 Nanite 几何体构建
- **Nanite Settings**：
  - Position Precision：位置精度（0=自动）
  - Normal Precision：法线精度
  - Tangent Precision：切线精度
  - Max Edge Length Factor：最大边长因子

---

## 2. 核心数据结构

### 2.1 FPackedView - 打包视图

GPU 端最核心的视图数据结构，定义在 `NaniteShared.h:34-96`:

```cpp
struct FPackedView
{
    // 变换矩阵
    FMatrix44f  SVPositionToTranslatedWorld;
    FMatrix44f  ViewToTranslatedWorld;
    FMatrix44f  TranslatedWorldToView;
    FMatrix44f  TranslatedWorldToClip;
    FMatrix44f  ViewToClip;
    FMatrix44f  ClipToRelativeWorld;

    // 前一帧矩阵（用于运动矢量）
    FMatrix44f  PrevTranslatedWorldToView;
    FMatrix44f  PrevTranslatedWorldToClip;
    // ...

    // 视图参数
    FIntVector4 ViewRect;
    FVector4f   ViewSizeAndInvSize;
    FVector4f   ClipSpaceScaleOffset;

    // LOD 关键参数
    FVector2f   LODScales;  // x = LODScale, y = LODScaleHW

    // 剔除参数
    FVector3f   CullingViewOriginTranslatedWorld;
    float       RangeBasedCullingDistance;
    float       NearPlane;
    FVector4f   TranslatedGlobalClipPlane;

    // 方法
    void UpdateLODScales(float NaniteMaxPixelsPerEdge, float MinPixelsPerEdgeHW);
};
```

### 2.2 FHierarchyNodeSlice - 层级节点切片

定义在 Shader 端 `NaniteDataDecode.ush:157-171`:

```glsl
struct FHierarchyNodeSlice
{
    float4  LODBounds;              // LOD 边界球
    float3  BoxBoundsCenter;        // 包围盒中心
    float3  BoxBoundsExtent;        // 包围盒扩展
    float   MinLODError;            // 最小 LOD 误差（叶节点）
    float   MaxParentLODError;      // 父节点最大 LOD 误差
    uint    ChildStartReference;    // 子节点/集群引用
    uint    NumChildren;            // 子节点数量
    uint    ResourcePageRangeKey;   // 资源页范围键
    uint    AssemblyTransformIndex; // 装配体变换索引
    bool    bEnabled;               // 是否启用
    bool    bLoaded;                // 是否已加载
    bool    bLeaf;                  // 是否为叶节点（集群）
};
```

### 2.3 FRasterContext - 光栅化上下文

定义在 `NaniteCullRaster.h:65-83`:

```cpp
struct FRasterContext
{
    FVector2f         RcpViewSize;       // 1/视图大小
    FIntPoint         TextureSize;       // 纹理大小
    EOutputBufferMode RasterMode;        // 输出模式（VisBuffer/DepthOnly）
    ERasterScheduling RasterScheduling;  // 调度模式

    FRasterParameters Parameters;        // 输出参数

    FRDGTextureRef    DepthBuffer;       // 深度缓冲
    FRDGTextureRef    VisBuffer64;       // 可见性缓冲（64位）
    FRDGTextureRef    DbgBuffer64;       // 调试缓冲
    FRDGTextureRef    DbgBuffer32;

    bool              VisualizeActive;
    bool              bCustomPass;
    bool              bEnableAssemblyMeta;
};
```

### 2.4 VisBuffer64 - 可见性缓冲（核心）

Visibility Buffer 是 Nanite 渲染的核心概念，**每个像素仅存储 64 位数据**，而非传统 G-Buffer 的几十字节。

#### 完整数据流图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Nanite Visibility Buffer 渲染流程                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     1. 光栅化阶段 (写入)                             │    │
│  │                                                                      │    │
│  │   可见集群列表                      屏幕像素                         │    │
│  │   VisibleClustersSWHW              VisBuffer64                       │    │
│  │   ┌─────────────────┐              ┌─────────────────────────┐      │    │
│  │   │ [0] Cluster A   │              │  每像素 64 位:           │      │    │
│  │   │ [1] Cluster B   │   光栅化     │  ┌─────────┬───────────┐│      │    │
│  │   │ [2] Cluster C   │ ──────────>  │  │PixelVal │ DepthInt  ││      │    │
│  │   │ [3] ...         │   三角形     │  │ 32 bit  │  32 bit   ││      │    │
│  │   └─────────────────┘              │  └─────────┴───────────┘│      │    │
│  │                                    └─────────────────────────┘      │    │
│  │                                                                      │    │
│  │   PixelValue 编码:                                                   │    │
│  │   ┌────────────────────────────────────────────────────────┐        │    │
│  │   │ bit 31    │ bit 30-7 (24位)      │ bit 6-0 (7位)       │        │    │
│  │   │ Imposter  │ VisibleClusterIndex+1│ TriIndex (0-127)    │        │    │
│  │   │ 标志      │ (集群在列表中的索引) │ (三角形在集群中索引)│        │    │
│  │   └────────────────────────────────────────────────────────┘        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                        │                                     │
│                                        v                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     2. 着色阶段 (读取)                               │    │
│  │                                                                      │    │
│  │   VisBuffer64              UnpackVisPixel()              查找数据    │    │
│  │   ┌───────────┐            ┌─────────────┐            ┌───────────┐ │    │
│  │   │PixelValue │ ─────────> │ClusterIdx=2 │ ─────────> │Cluster C  │ │    │
│  │   │DepthInt   │  解码      │TriIndex=15  │  索引      │InstanceID │ │    │
│  │   └───────────┘            │Depth        │            │PageIndex  │ │    │
│  │                            └─────────────┘            │ClusterIdx │ │    │
│  │                                                       └───────────┘ │    │
│  │                                        │                             │    │
│  │                                        v                             │    │
│  │                            ┌─────────────────────────────────┐      │    │
│  │                            │ 从 ClusterPageData 读取:         │      │    │
│  │                            │ • 顶点位置 (Position)           │      │    │
│  │                            │ • 法线 (Normal)                 │      │    │
│  │                            │ • UV 坐标                       │      │    │
│  │                            │ • 材质索引                      │      │    │
│  │                            └─────────────────────────────────┘      │    │
│  │                                        │                             │    │
│  │                                        v                             │    │
│  │                            ┌─────────────────────────────────┐      │    │
│  │                            │ 重建顶点属性 + 材质着色          │      │    │
│  │                            │           │                     │      │    │
│  │                            │           v                     │      │    │
│  │                            │    ┌─────────────┐              │      │    │
│  │                            │    │  G-Buffer   │              │      │    │
│  │                            │    │ BaseColor   │              │      │    │
│  │                            │    │ Normal      │              │      │    │
│  │                            │    │ Metallic    │              │      │    │
│  │                            │    │ Roughness   │              │      │    │
│  │                            │    └─────────────┘              │      │    │
│  │                            └─────────────────────────────────┘      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 数据布局详解

```
                              VisBuffer64 单像素 (64 bits)
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│    低 32 位 (uint.x) - PixelValue          高 32 位 (uint.y) - DepthInt     │
│   ┌───────────────────────────────────┐   ┌───────────────────────────────┐ │
│   │31│30      ...       7│6    ...   0│   │31          ...              0│ │
│   ├──┼──────────────────┼────────────┤   ├─────────────────────────────────┤ │
│   │I │VisibleClusterIdx │  TriIndex  │   │        Depth (as uint)         │ │
│   │m │    (24 bits)     │  (7 bits)  │   │         asuint(z)              │ │
│   │p │                  │            │   │                                 │ │
│   └──┴──────────────────┴────────────┘   └───────────────────────────────┘ │
│    │         │                │                        │                    │
│    │         │                │                        │                    │
│    v         v                v                        v                    │
│  是否为    可见集群列表     三角形在集群          用于深度测试              │
│  Imposter  中的索引+1      中的索引              (原子 Max 比较)           │
│  (远景     (0=空像素)      (0-127)                                         │
│   替代)                                                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 为什么 ClusterIndex 要 +1？

```
PixelValue = 0  →  表示该像素没有被 Nanite 几何体覆盖（空像素/天空）
PixelValue > 0  →  表示有效的 Nanite 像素

写入时: PixelValue = (VisibleIndex + 1) << 7 | TriIndex
读取时: VisibleClusterIndex = (PixelValue >> 7) - 1
```

#### 纹理创建

`NaniteCullRaster.cpp:6178-6181`:

```cpp
FRDGTextureDesc NaniteVisBuffer64Desc = FRDGTextureDesc::Create2D(
    RasterContext.TextureSize,
    PixelFormat64,                              // PF_R32G32_UINT
    FClearValueBinding::None,
    TexCreate_ShaderResource | TexCreate_UAV | ETextureCreateFlags::Atomic64Compatible
);
RasterContext.VisBuffer64 = GraphBuilder.CreateTexture(NaniteVisBuffer64Desc, TEXT("Nanite.VisBuffer64"));
```

#### 写入（光栅化阶段）

`NaniteRasterizer.usf:652-653`:

```hlsl
// VisibleIndex + 1 是因为 0 表示空像素
uint PixelValue = (VisibleIndex + 1) << 7;   // 集群索引左移 7 位
PixelValue |= TriIndex;                       // 三角形索引占低 7 位
// 然后与深度一起原子写入
WritePixel(OutVisBuffer64, PixelValue, PixelPos, asuint(Depth));
```

`NaniteWritePixel.ush:20-35`:

```hlsl
void WritePixel(RWTexture2D<UlongType> OutBuffer, uint PixelValue, uint2 PixelPos, uint DepthInt)
{
#if DEPTH_ONLY
    InterlockedMax(OutDepthBuffer[PixelPos], DepthInt);
#elif COMPILER_SUPPORTS_UINT64_IMAGE_ATOMICS
    // 打包为 64 位并原子写入（深度测试 + 写入合一）
    const UlongType Pixel = PackUlongType(uint2(PixelValue, DepthInt));
    ImageInterlockedMaxUInt64(OutBuffer, PixelPos, Pixel);
#endif
}
```

#### 读取（着色阶段）

`NaniteDataDecode.ush:846-859`:

```hlsl
void UnpackVisPixel(
    UlongType Pixel,
    out uint DepthInt,
    out uint VisibleClusterIndex,
    out uint TriIndex
)
{
    const uint2 Unpacked = UnpackUlongType(Pixel);
    VisibleClusterIndex = Unpacked.x >> 7;      // 高 25 位
    TriIndex = Unpacked.x & 0x7F;               // 低 7 位
    DepthInt = Unpacked.y;                      // 完整 32 位深度
    VisibleClusterIndex--;                      // 还原 +1 偏移
}
```

#### 设计优势

| 对比项 | 传统延迟渲染 | Nanite Visibility Buffer |
|--------|-------------|-------------------------|
| 每像素存储 | 几十字节 (G-Buffer) | 8 字节 (64位) |
| 光栅化输出 | 完整材质属性 | 仅三角形引用 |
| 带宽消耗 | 高 | 极低 |
| 着色方式 | 逐像素 | 按材质分箱批量 |
| 属性重建 | 无需 | 着色时从集群数据重建 |

#### 相关结构 FVisibleCluster

通过 VisibleClusterIndex 可以从 `VisibleClustersSWHW` 缓冲获取完整信息：

`NaniteDataDecode.ush:47-58`:

```hlsl
struct FVisibleCluster
{
    uint    Flags;                  // 剔除标志
    uint    ViewId;                 // 视图 ID
    uint    InstanceId;             // 实例 ID
    uint    PageIndex;              // 页面索引
    uint    ClusterIndex;           // 集群索引
    uint    AssemblyTransformIndex; // 装配体变换
    uint    DepthBucket;            // 深度桶
    uint2   vPage;                  // 虚拟页起始
    uint2   vPageEnd;               // 虚拟页结束
};
```

---

## 3. 渲染执行流程

### 3.1 整体流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                     每帧 Nanite 渲染流程                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │ 1. 初始化    │ -> │ 2. 实例剔除  │ -> │ 3. 层级遍历  │       │
│  │ RasterContext│    │ PrimitiveFilter │   │ NodeCulling  │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                   │                    │               │
│         v                   v                    v               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │ 4. 集群剔除  │ <- │ 5. 两遍遮挡  │ <- │ HZB 构建     │       │
│  │ ClusterCull  │    │ Main + Post  │    │ (上一帧)     │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                                                        │
│         v                                                        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │ 6. 光栅化    │ -> │ 7. 材质分箱  │ -> │ 8. 着色      │       │
│  │ HW/SW Raster │    │ Bin Sorting  │    │ G-Buffer     │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 初始化阶段

入口函数 `InitRasterContext`（`NaniteCullRaster.cpp`）:

```cpp
FRasterContext InitRasterContext(
    FRDGBuilder& GraphBuilder,
    const FSharedContext& SharedContext,
    const FViewFamilyInfo& ViewFamily,
    FIntPoint TextureSize,
    FIntRect TextureRect,
    EOutputBufferMode RasterMode,
    bool bClearTarget,
    bool bAsyncCompute,
    // ...
);
```

创建必要的缓冲：
- **DepthBuffer**: `PF_R32_UINT` 深度缓冲
- **VisBuffer64**: `PF_R32G32_UINT` 可见性缓冲（三角形ID + 深度）
- **DbgBuffer64/32**: 调试缓冲（可选）

### 3.3 实例剔除（Primitive Filter）

对场景中的所有 Nanite 基元进行初步过滤：

```cpp
// NaniteCullRaster.cpp - FPrimitiveFilter_CS
class FPrimitiveFilter_CS : public FNaniteGlobalShader
{
    // 权限维度
    class FHiddenPrimitivesListDim : SHADER_PERMUTATION_BOOL("HAS_HIDDEN_PRIMITIVES_LIST");
    class FShowOnlyPrimitivesListDim : SHADER_PERMUTATION_BOOL("HAS_SHOW_ONLY_PRIMITIVES_LIST");

    BEGIN_SHADER_PARAMETER_STRUCT(FParameters, )
        SHADER_PARAMETER(uint32, NumPrimitives)
        SHADER_PARAMETER(uint32, HiddenFilterFlags)
        SHADER_PARAMETER_RDG_BUFFER_UAV(RWStructuredBuffer<uint>, PrimitiveFilterBuffer)
        SHADER_PARAMETER_RDG_BUFFER_SRV(Buffer<uint>, HiddenPrimitivesList)
        SHADER_PARAMETER_RDG_BUFFER_SRV(Buffer<uint>, ShowOnlyPrimitivesList)
    END_SHADER_PARAMETER_STRUCT()
};
```

### 3.4 层级遍历与 LOD 选择

#### LOD 尺度计算

`NaniteShared.cpp:90-98`:

```cpp
void FPackedView::UpdateLODScales(const float NaniteMaxPixelsPerEdge, const float MinPixelsPerEdgeHW)
{
    // ViewToPixels = 0.5 * 投影矩阵[1][1] * 视图高度
    const float ViewToPixels = 0.5f * ViewToClip.M[1][1] * ViewSizeAndInvSize.Y;

    // LODScale 用于 LOD 选择决策
    const float LODScale = ViewToPixels / NaniteMaxPixelsPerEdge;

    // LODScaleHW 用于硬件光栅化判定
    const float LODScaleHW = ViewToPixels / MinPixelsPerEdgeHW;

    LODScales = FVector2f(LODScale, LODScaleHW);
}
```

#### GPU 端节点遍历

`NaniteClusterCulling.usf:281-308`:

```glsl
bool ShouldVisitChildInternal(
    FNaniteView NaniteView,
    FInstanceSceneData InstanceData,
    FInstanceDynamicData DynamicData,
    FNodeCullingBounds Bounds,
    FHierarchyNodeSlice HierarchyNodeSlice,
    inout float Priority
)
{
    // 计算投影边缘尺度
    float2 ProjectedEdgeScales = GetProjectedEdgeScales(
        NaniteView, InstanceData, DynamicData, Bounds.Sphere
    );

    // 统一缩放
    float UniformScale = Bounds.MeshMinDeformScale * min3(
        InstanceData.NonUniformScale.x,
        InstanceData.NonUniformScale.y,
        InstanceData.NonUniformScale.z
    );

    // 判断阈值 = LODScale × 网格缩放 × 父节点最大 LOD 误差
    float Threshold = NaniteView.LODScale * UniformScale * HierarchyNodeSlice.MaxParentLODError;

    // 投影边缘 ≤ 阈值 → 继续细分
    if (ProjectedEdgeScales.x <= Threshold)
    {
        // 计算流媒体优先级
        Priority = Threshold / ProjectedEdgeScales.x;
        return true;  // 访问子节点
    }
    return false;  // 停止细分
}
```

#### 集群可见性判定

`NaniteClusterCulling.usf:310-335`:

```glsl
bool SmallEnoughToDraw(
    FNaniteView NaniteView,
    FInstanceSceneData InstanceData,
    FInstanceDynamicData DynamicData,
    FNodeCullingBounds Bounds,
    float LODError,
    float EdgeLength,
    inout bool bUseHWRaster
)
{
    float ProjectedEdgeScale = GetProjectedEdgeScales(...).x;
    float UniformScale = ...;

    // 集群可见条件：投影边缘 > LODScale × 缩放 × LOD 误差
    bool bVisible = ProjectedEdgeScale > UniformScale * LODError * NaniteView.LODScale;

    // 硬件光栅化判定
    if (!(RenderFlags & NANITE_RENDER_FLAG_FORCE_HW_RASTER))
    {
        float HWEdgeScale = InstanceData.NonUniformScale.w * Bounds.NodeMaxDeformScale;
        // 投影边缘 < HWEdgeScale × 边长 × LODScaleHW → 使用硬件光栅化
        bUseHWRaster |= ProjectedEdgeScale < HWEdgeScale * abs(EdgeLength) * NaniteView.LODScaleHW;
    }

    return bVisible;
}
```

### 3.5 两遍遮挡剔除

```
┌─────────────────────────────────────────────────────────────┐
│                    两遍遮挡剔除流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  第一遍 (Main Pass)                                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │ 使用上一帧  │ -> │ 剔除明显    │ -> │ 光栅化可见  │      │
│  │ HZB        │    │ 被遮挡物体  │    │ 几何体      │      │
│  └─────────────┘    └─────────────┘    └─────────────┘      │
│                              │                               │
│                              v                               │
│  第二遍 (Post Pass)                                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │ 构建当前帧  │ -> │ 重新测试    │ -> │ 光栅化额外  │      │
│  │ HZB        │    │ 被剔除物体  │    │ 可见几何体  │      │
│  └─────────────┘    └─────────────┘    └─────────────┘      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

剔除类型定义（`NaniteCullRaster.cpp:37-40`）:

```cpp
#define CULLING_PASS_NO_OCCLUSION     0   // 无遮挡剔除
#define CULLING_PASS_OCCLUSION_MAIN   1   // 主遍（使用上一帧 HZB）
#define CULLING_PASS_OCCLUSION_POST   2   // 后遍（使用当前帧 HZB）
#define CULLING_PASS_EXPLICIT_LIST    3   // 显式列表
```

### 3.6 光栅化调度

三种光栅化路径（`NaniteCullRaster.h:25-35`）:

```cpp
enum class ERasterScheduling : uint8
{
    // 仅使用硬件光栅化
    HardwareOnly = 0,

    // 大三角形用硬件，小三角形用软件（串行）
    HardwareThenSoftware = 1,

    // 大三角形用硬件，小三角形用软件（并行）
    HardwareAndSoftwareOverlap = 2,
};
```

硬件路径选择（`NaniteCullRaster.cpp:531-568`）:

```cpp
enum class ERasterHardwarePath : uint8
{
    VertexShader,       // 传统顶点着色器
    PrimitiveShader,    // 原始着色器
    MeshShaderWrapped,  // Mesh Shader（包装模式）
    MeshShaderNV,       // Mesh Shader（NVIDIA 扩展）
    MeshShader,         // Mesh Shader（标准）
};
```

---

## 4. 流媒体系统

### 4.1 流媒体管理器架构

```
┌─────────────────────────────────────────────────────────────┐
│                   FStreamingManager                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐   ┌─────────────────┐                  │
│  │ RootPageInfos   │   │ ClusterPageData │  GPU 缓冲        │
│  │ (根页面信息)     │   │ (集群页面数据)   │                  │
│  └─────────────────┘   └─────────────────┘                  │
│                                                              │
│  ┌─────────────────────────────────────────┐                │
│  │ Virtual Page Management                  │                │
│  │ ├─ RegisteredVirtualPages (已注册虚拟页) │                │
│  │ ├─ ResidentVirtualPages (驻留虚拟页)     │                │
│  │ └─ VirtualPageAllocator (虚拟页分配器)   │                │
│  └─────────────────────────────────────────┘                │
│                                                              │
│  ┌─────────────────────────────────────────┐                │
│  │ LRU Management                           │                │
│  │ ├─ RegisteredPageIndexToLRU             │                │
│  │ └─ LRUToRegisteredPageIndex             │                │
│  └─────────────────────────────────────────┘                │
│                                                              │
│  ┌─────────────────────────────────────────┐                │
│  │ Pending Pages                            │                │
│  │ ├─ PendingPages[] (待处理页面队列)       │                │
│  │ └─ MaxPendingPages (最大待处理数)        │                │
│  └─────────────────────────────────────────┘                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 GPU 端流请求生成

`NaniteStreaming.ush:19-49`:

```glsl
void RequestPageRange(
    RWStructuredBuffer<FStreamingRequest> RequestsBuffer,
    uint RuntimeResourceID,
    uint ResourcePageRangeKey,
    uint PriorityCategory,
    float Priority
)
{
    const uint NumPagesOrPageRanges = ResourcePageRangeKey & NANITE_PAGE_RANGE_KEY_COUNT_MASK;
    const bool bHasStreamingPages = (ResourcePageRangeKey & NANITE_PAGE_RANGE_KEY_FLAG_HAS_STREAMING_PAGES) != 0;

    if ((RenderFlags & NANITE_RENDER_FLAG_OUTPUT_STREAMING_REQUESTS) &&
        NumPagesOrPageRanges > 0 && bHasStreamingPages)
    {
        // 原子增加请求计数
        uint Index;
        WaveInterlockedAddScalar_(RequestsBuffer[0].RuntimeResourceID_Magic, 1, Index);

        if (Index < StreamingRequestsBufferSize - 1)
        {
            // 编码优先级：高 2 位 = Category，低 30 位 = Priority
            const uint UIntPriority = (PriorityCategory << 30) | (asuint(Priority) >> 2);

            FStreamingRequest Request;
            Request.RuntimeResourceID_Magic = RuntimeResourceID;
            Request.ResourcePageRangeKey = ResourcePageRangeKey;
            Request.Priority_Magic = UIntPriority;
            RequestsBuffer[Index + 1] = Request;
        }
    }
}
```

### 4.3 CPU 端流请求处理

完整处理流程 (`NaniteStreamingManager.cpp`):

```
GPU 请求 → AddPendingGPURequests() → AddParentRequests()
         → SelectHighestPriorityPagesAndUpdateLRU()
         → InstallReadyPages() / UninstallResidentPage()
```

关键函数：

1. **AddPendingGPURequests** (行号 2456-2610)：处理 GPU 生成的流请求
2. **AddParentRequests** (行号 2636-2686)：递归添加父页依赖
3. **SelectHighestPriorityPagesAndUpdateLRU** (行号 2745-2839)：选择最高优先级页面
4. **InstallReadyPages** (行号 1468-1599)：安装已加载的页面
5. **UninstallResidentPage** (行号 1310-1402)：卸载页面释放空间

### 4.4 LRU 淘汰策略

```cpp
// 当需要驱逐页面时，从 LRU 列表头部选择
// 最近被请求的页面会移到列表尾部

void FStreamingManager::MoveToEndOfLRUList(uint32 RegisteredPageIndex)
{
    uint32& LRUIndex = RegisteredPageIndexToLRU[RegisteredPageIndex];
    // 标记当前位置为空
    LRUToRegisteredPageIndex[LRUIndex] = INDEX_NONE;
    // 添加到列表末尾
    LRUIndex = LRUToRegisteredPageIndex.Num();
    LRUToRegisteredPageIndex.Add(RegisteredPageIndex | LRU_FLAG_REFERENCED_THIS_UPDATE);
}
```

---

## 5. 材质系统

### 5.1 光栅化管线

Nanite 支持两种光栅化路径：

1. **Fixed Function Path**：不透明材质，无 PDO/WPO，使用固定功能光栅
2. **Programmable Path**：遮罩/特殊材质，使用可编程光栅

判断逻辑 (`NaniteShared.h:397-418`):

```cpp
static bool IsVertexProgrammable(const FMaterialShaderParameters& MaterialParameters, bool bHWRasterShader)
{
    const bool bPixelProgrammable = IsPixelProgrammable(MaterialParameters);
    const bool bHasVertexUVs = bPixelProgrammable &&
        (MaterialParameters.bHasVertexInterpolator || MaterialParameters.NumCustomizedUVs > 0);
    const bool bHasTessellation = (!bHWRasterShader && MaterialParameters.bIsTessellationEnabled);
    return MaterialParameters.bHasVertexPositionOffsetConnected ||
           bHasVertexUVs || bHasTessellation ||
           MaterialParameters.bHasMaterialCacheOutput ||
           MaterialParameters.bHasFirstPersonInterpolation;
}

static bool IsPixelProgrammable(const FMaterialShaderParameters& MaterialParameters)
{
    return MaterialParameters.bIsMasked || MaterialParameters.bHasPixelDepthOffsetConnected;
}
```

### 5.2 材质分箱

Nanite 使用材质分箱系统对像素进行分类，然后批量着色：

```cpp
struct FNaniteShadingBin
{
    uint32 BinIndex;
    uint32 MaterialSlot;
    // ...
};
```

---

## 6. 性能影响

### 6.1 不同配置的性能对比

| 配置 | MaxPixelsPerEdge | 三角形数量 | GPU 时间 | 适用场景 |
|------|-----------------|-----------|---------|---------|
| 高质量 | 0.5 | 最多 | 最长 | 电影级渲染 |
| 默认 | 1.0 | 标准 | 标准 | 一般游戏 |
| 性能优先 | 2.0 | 较少 | 较短 | 低端设备 |
| 极限性能 | 4.0+ | 最少 | 最短 | 超低端/VR |

### 6.2 关键性能因素

1. **可见集群数量**：直接影响光栅化工作量
2. **流媒体带宽**：影响 LOD 切换延迟
3. **材质复杂度**：可编程光栅比固定功能慢
4. **两遍剔除开销**：额外的 HZB 构建和剔除 Pass

### 6.3 动态分辨率缩放

Nanite 支持动态调整 LOD 精度以维持帧率：

```cpp
// NaniteCullRaster.cpp:409-423
DynamicRenderScaling::FHeuristicSettings GetDynamicNaniteScalingPrimarySettings()
{
    BucketSetting.MinResolutionFraction = PixelsPerEdgeScalingPercentage / 100.0f;
    BucketSetting.MaxResolutionFraction = 1.0f;
    BucketSetting.BudgetMs = CVarNanitePrimaryTimeBudgetMs.GetValueOnAnyThread();
    // ...
}
```

---

## 7. 使用建议

### 7.1 适用场景

| 场景 | 是否推荐 | 原因 |
|------|---------|------|
| 大规模静态环境 | ✅ 强烈推荐 | Nanite 的核心优势 |
| 高精度硬表面 | ✅ 推荐 | 法线贴图可以被实际几何体替代 |
| 中远距离物体 | ✅ 推荐 | LOD 自动管理 |
| 近距离角色 | ⚠️ 视情况 | WPO/骨骼动画支持有限 |
| 动态变形几何 | ⚠️ 谨慎使用 | 需要曲面细分支持 |
| 半透明物体 | ❌ 不支持 | Nanite 仅支持不透明/遮罩 |
| 植被/粒子 | ❌ 不推荐 | 考虑使用 Foliage/Niagara |

### 7.2 推荐配置

**高端 PC (RTX 3080+)**:
```ini
r.Nanite.MaxPixelsPerEdge=1.0
r.Nanite.MinPixelsPerEdgeHW=32.0
r.Nanite.Streaming.StreamingPoolSize=1024
```

**中端 PC (RTX 2070)**:
```ini
r.Nanite.MaxPixelsPerEdge=1.5
r.Nanite.MinPixelsPerEdgeHW=48.0
r.Nanite.Streaming.StreamingPoolSize=512
```

**主机 (PS5/XSX)**:
```ini
r.Nanite.MaxPixelsPerEdge=1.0
r.Nanite.MinPixelsPerEdgeHW=32.0
r.Nanite.Streaming.StreamingPoolSize=768
```

### 7.3 调试命令

```bash
# 显示统计信息
r.Nanite.ShowStats 1

# 过滤统计
NaniteStats Primary
NaniteStats VirtualShadowMaps

# 可视化模式（在视口中切换）
ViewMode Nanite Triangles
ViewMode Nanite Clusters
ViewMode Nanite Primitives
ViewMode Nanite Instances
```

---

## 8. 源码参考索引

| 功能模块 | 主要文件 | 关键函数/类 |
|---------|---------|------------|
| 核心定义 | `NaniteShared.h` | `FPackedView`, `FGlobalResources` |
| 剔除光栅 | `NaniteCullRaster.cpp/h` | `IRenderer::DrawGeometry` |
| 材质管理 | `NaniteMaterials.cpp/h` | `FNaniteRasterPipelines` |
| 着色系统 | `NaniteShading.cpp/h` | `FShadeBinning` |
| 流媒体 | `NaniteStreamingManager.cpp/h` | `FStreamingManager` |
| GPU 剔除 | `NaniteClusterCulling.usf` | `ShouldVisitChildInternal` |
| GPU 光栅 | `NaniteRasterizer.usf` | `RasterizeMicroTriangle` |
| 流请求 | `NaniteStreaming.ush` | `RequestPageRange` |
| **VisBuffer 写入** | `NaniteWritePixel.ush` | `WritePixel`, `FVisBufferPixel` |
| **VisBuffer 解码** | `NaniteDataDecode.ush` | `UnpackVisPixel`, `FVisibleCluster` |
| **G-Buffer 导出** | `NaniteExportGBuffer.usf` | `ExportGBufferPS` |

---

## 更新日志

| 日期 | 修改内容 |
|------|---------|
| 2026-01-20 | 添加 VisBuffer64 完整数据流图和详细位布局说明 |
| 2026-01-20 | 添加 Visibility Buffer (VisBuffer64) 详细说明 |
| 2026-01-19 | 初始版本，基于 UE 5.7 源码分析 |
