---
title: "Nanite 材质缓存"
cat: 渲染管线
date: 2026-01-20
mins: 17
---

> Nanite Material Cache 是 UE5 中用于缓存着色器编译结果和材质属性数据的多层次优化系统，避免重复编译着色器并加速材质处理。

---

## 1. 控制层级

### 1.1 项目设置（编译时）

材质缓存通常与 Nanite 一起启用，材质需要勾选 **Used with Nanite** 才会参与缓存：

```cpp
// Material Editor → Usage → Used with Nanite
// 对应材质参数：
MaterialParameters.bIsUsedWithNanite = true;
```

### 1.2 全局开关（运行时 CVar）

主要 CVars 定义在 `MaterialCacheRenderer.cpp:33-58`:

| CVar | 默认值 | 说明 |
|------|--------|------|
| `r.MaterialCache.StaticMesh.EnableViewportFromVS` | true | 启用从顶点着色器设置渲染目标数组索引的切片渲染 |
| `r.MaterialCache.VertexInvariant.Enable` | true | 启用仅使用 UV 派生数据的材质的计算着色 |
| `r.MaterialCache.CommandCaching` | false | 启用网格命令和层着色命令的缓存 |

```cpp
// MaterialCacheRenderer.cpp:33-58
bool GMaterialCacheStaticMeshEnableViewportFromVS = true;
static FAutoConsoleVariableRef CVarMaterialCacheStaticMeshEnableViewportFromVS(
    TEXT("r.MaterialCache.StaticMesh.EnableViewportFromVS"),
    GMaterialCacheStaticMeshEnableViewportFromVS,
    TEXT("Enable sliced rendering of static unwrapping..."),
    ECVF_RenderThreadSafe | ECVF_Scalability
);

bool GMaterialCacheVertexInvariantEnable = true;
static FAutoConsoleVariableRef CVarMaterialCacheEnableVertexInvariant(
    TEXT("r.MaterialCache.VertexInvariant.Enable"),
    GMaterialCacheVertexInvariantEnable,
    TEXT("Enable compute-only shading of materials that only use UV-derived data"),
    ECVF_RenderThreadSafe | ECVF_Scalability
);
```

Nanite 光栅缓存相关（`NaniteCullRaster.cpp:136-141`）:

```cpp
static TAutoConsoleVariable<int32> CVarNaniteRasterSetupCache(
    TEXT("r.Nanite.RasterSetupCache"),
    1,
    TEXT(""),
    ECVF_RenderThreadSafe
);
```

**注意**：编辑器中会禁用光栅设置缓存，因为着色器映射可能失效（`NaniteCullRaster.cpp:455-462`）:

```cpp
static bool UseRasterSetupCache()
{
#if WITH_EDITOR
    return false;  // 编辑器中禁用
#else
    return CVarNaniteRasterSetupCache.GetValueOnRenderThread() > 0;
#endif
}
```

### 1.3 管线类型（Per-Pipeline）

Nanite 管线配置中包含材质缓存标志（`NaniteCullRaster.h:49-56`）:

```cpp
enum class EPipeline : uint8
{
    Primary,      // 主渲染
    Shadows,      // 阴影
    Lumen,        // Lumen 光照
    HitProxy,     // 拾取代理
    MaterialCache // 材质缓存专用管线
};
```

---

## 2. 核心数据结构

### 2.1 FNaniteRasterMaterialCacheKey - 缓存键

32 位紧凑编码的缓存键，定义在 `NaniteShared.h:592-643`:

```cpp
struct FNaniteRasterMaterialCacheKey
{
    union {
        struct {
            uint32 FeatureLevel                 : 3;  // 特性级别 (0-7)
            uint32 bWPOEnabled                  : 1;  // 世界位置偏移
            uint32 bPerPixelEval                : 1;  // 逐像素计算
            uint32 bUseMeshShader               : 1;  // 使用 Mesh Shader
            uint32 bUsePrimitiveShader          : 1;  // 使用 Primitive Shader
            uint32 bDisplacementEnabled         : 1;  // 位移贴图
            uint32 bVisualizeActive             : 1;  // 可视化模式
            uint32 bHasVirtualShadowMap         : 1;  // 虚拟阴影贴图
            uint32 bIsDepthOnly                 : 1;  // 仅深度模式
            uint32 bIsTwoSided                  : 1;  // 双面材质
            uint32 bCastShadow                  : 1;  // 投射阴影
            uint32 bVoxel                       : 1;  // 体素渲染
            uint32 bSplineMesh                  : 1;  // 样条网格
            uint32 bSkinnedMesh                 : 1;  // 蒙皮网格
            uint32 bFixedDisplacementFallback   : 1;  // 位移回退
            uint32 bUseWorkGraphSW              : 1;  // 软件工作图
            uint32 bUseWorkGraphHW              : 1;  // 硬件工作图
            uint32 Unused                       : 13; // 保留位
        };
        uint32 Packed = 0;  // 作为 uint32 访问
    };
};
```

**设计要点**：
- 所有影响着色器编译的参数被压缩到 32 位
- 支持快速哈希比较，作为 `TMap` 的键
- 相同键 = 相同的着色器编译结果

### 2.2 FNaniteRasterMaterialCache - 缓存值

存储编译后的着色器和材质数据（`NaniteShared.h:645-665`）:

```cpp
struct FNaniteRasterMaterialCache
{
    // 材质引用
    const FMaterial* VertexMaterial = nullptr;
    const FMaterial* PixelMaterial = nullptr;
    const FMaterial* ComputeMaterial = nullptr;
    const FMaterialRenderProxy* VertexMaterialProxy = nullptr;
    const FMaterialRenderProxy* PixelMaterialProxy = nullptr;
    const FMaterialRenderProxy* ComputeMaterialProxy = nullptr;

    // 编译的着色器（核心缓存内容）
    TShaderRef<FHWRasterizePS> RasterPixelShader;       // 硬件光栅像素着色器
    TShaderRef<FHWRasterizeVS> RasterVertexShader;      // 硬件光栅顶点着色器
    TShaderRef<FHWRasterizeMS> RasterMeshShader;        // Mesh Shader
    TShaderRef<FMicropolyRasterizeCS> ClusterComputeShader;  // 集群计算着色器
    TShaderRef<FMicropolyRasterizeCS> PatchComputeShader;    // 补丁计算着色器

    // 缓存的材质参数
    TOptional<uint32> MaterialBitFlags;
    TOptional<FDisplacementScaling> DisplacementScaling;
    TOptional<FDisplacementFadeRange> DisplacementFadeRange;

    bool bFinalized = false;  // 标记缓存是否已完成
};
```

### 2.3 FNaniteRasterEntry - 缓存条目

将光栅管线映射到缓存集合（`NaniteShared.h:667-674`）:

```cpp
struct FNaniteRasterEntry
{
    // 键值对缓存映射
    mutable TMap<FNaniteRasterMaterialCacheKey, FNaniteRasterMaterialCache> CacheMap;

    FNaniteRasterPipeline RasterPipeline{};  // 光栅管线配置
    uint32 ReferenceCount = 0;               // 引用计数
    uint16 BinIndex = 0xFFFFu;               // 分箱索引
};
```

### 2.4 FMaterialCacheBinData - GPU 端数据

Shader 中使用的绑定数据（`MaterialCacheDefinitions.h:17-28`）:

```cpp
struct FMaterialCacheBinData
{
    // DW0
    uint3 ABufferPhysicalPosition;  // A-缓冲物理位置
    uint  PrimitiveData;            // 基元数据索引

    // DW4
    float4 UVMinAndThreadAdvance;   // UV 最小值和线程步长

    // DW8
    float4 UVMinAndInvSize;         // UV 映射参数

    // DW12
    uint4 Pad16;                    // 对齐填充
};
```

### 2.5 A-Buffer 参数

8 层 A-Buffer 支持（`MaterialCacheRenderer.cpp:62-72`）:

```cpp
BEGIN_SHADER_PARAMETER_STRUCT(FMaterialCacheABufferParameters, )
    SHADER_PARAMETER_RDG_TEXTURE_UAV(RWTexture2DArray<float4>, RWABuffer_0)
    SHADER_PARAMETER_RDG_TEXTURE_UAV(RWTexture2DArray<float4>, RWABuffer_1)
    SHADER_PARAMETER_RDG_TEXTURE_UAV(RWTexture2DArray<float4>, RWABuffer_2)
    SHADER_PARAMETER_RDG_TEXTURE_UAV(RWTexture2DArray<float4>, RWABuffer_3)
    SHADER_PARAMETER_RDG_TEXTURE_UAV(RWTexture2DArray<float4>, RWABuffer_4)
    SHADER_PARAMETER_RDG_TEXTURE_UAV(RWTexture2DArray<float4>, RWABuffer_5)
    SHADER_PARAMETER_RDG_TEXTURE_UAV(RWTexture2DArray<float4>, RWABuffer_6)
    SHADER_PARAMETER_RDG_TEXTURE_UAV(RWTexture2DArray<float4>, RWABuffer_7)
END_SHADER_PARAMETER_STRUCT()
```

---

## 3. 渲染路径

### 3.1 三种渲染路径

定义在 `MaterialCacheRenderer.cpp:117-138`:

```cpp
enum class EMaterialCacheRenderPath
{
    /**
     * 标准硬件光栅化路径
     * - 用于一般材质
     * - 每层一个网格命令集
     */
    HardwareRaster,

    /**
     * Nanite 光栅化路径
     * - 用于 Nanite 对象
     * - 共享光栅化上下文/VisBuffer
     * - 按材质和基元并行着色
     */
    NaniteRaster,

    /**
     * 仅着色路径
     * - 用于仅使用 UV 派生数据的材质
     * - 无需顶点处理
     */
    VertexInvariant,

    Count
};
```

### 3.2 路径选择流程

```
┌─────────────────────────────────────────────────────────────┐
│                   渲染路径选择                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   材质是否仅使用 UV 派生数据？                              │
│        │                                                     │
│        ├─ 是 ─→ VertexInvariant（计算着色器路径）           │
│        │        └─ 跳过顶点处理，直接着色                   │
│        │                                                     │
│        └─ 否 ─→ 对象是否为 Nanite？                         │
│                  │                                           │
│                  ├─ 是 ─→ NaniteRaster                       │
│                  │        ├─ 使用 Nanite VisBuffer          │
│                  │        └─ 按材质分箱着色                  │
│                  │                                           │
│                  └─ 否 ─→ HardwareRaster                     │
│                           └─ 标准网格渲染                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 缓存写入流程

### 4.1 整体流程图

```
┌─────────────────────────────────────────────────────────────┐
│                   材质缓存写入流程                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 创建缓存键                                               │
│  ┌────────────────────────────────────────────┐             │
│  │ FNaniteRasterMaterialCacheKey               │             │
│  │ ├─ FeatureLevel                             │             │
│  │ ├─ bWPOEnabled                              │             │
│  │ ├─ bUseMeshShader                           │             │
│  │ └─ ... (其他 18 个标志位)                   │             │
│  └────────────────────────────────────────────┘             │
│         │                                                    │
│         v                                                    │
│  2. 查询缓存                                                 │
│  ┌────────────────────────────────────────────┐             │
│  │ RasterEntry.CacheMap.FindOrAdd(Key)        │             │
│  │ ├─ 命中 → 直接使用已缓存的着色器           │             │
│  │ └─ 未命中 → 继续编译流程                   │             │
│  └────────────────────────────────────────────┘             │
│         │                                                    │
│         v                                                    │
│  3. 编译着色器（如未命中）                                   │
│  ┌────────────────────────────────────────────┐             │
│  │ GetHWRasterizeVertexShader()               │             │
│  │ GetHWRasterizePixelShader()                │             │
│  │ GetHWRasterizeMeshShader()                 │             │
│  │ GetMicropolyRasterizeComputeShader()       │             │
│  └────────────────────────────────────────────┘             │
│         │                                                    │
│         v                                                    │
│  4. 写入缓存                                                 │
│  ┌────────────────────────────────────────────┐             │
│  │ RasterMaterialCache.RasterVertexShader =   │             │
│  │ RasterMaterialCache.RasterPixelShader  =   │             │
│  │ RasterMaterialCache.RasterMeshShader   =   │             │
│  │ RasterMaterialCache.bFinalized = true      │             │
│  └────────────────────────────────────────────┘             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 缓存键创建代码

`NaniteCullRaster.cpp:5379-5402`:

```cpp
// 创建缓存键
FNaniteRasterMaterialCacheKey RasterMaterialCacheKey;
if (bUseSetupCache)
{
    RasterMaterialCacheKey.FeatureLevel = FeatureLevel;
    RasterMaterialCacheKey.bWPOEnabled = RasterEntry.RasterPipeline.bWPOEnabled;
    RasterMaterialCacheKey.bPerPixelEval = RasterEntry.RasterPipeline.bPerPixelEval;
    RasterMaterialCacheKey.bUseMeshShader = bUseMeshShader;
    RasterMaterialCacheKey.bUsePrimitiveShader = bUsePrimitiveShader;
    RasterMaterialCacheKey.bDisplacementEnabled = RasterEntry.RasterPipeline.bDisplacementEnabled;
    RasterMaterialCacheKey.bVisualizeActive = VisualizeActive;
    RasterMaterialCacheKey.bHasVirtualShadowMap = bHasVirtualShadowMap;
    RasterMaterialCacheKey.bIsDepthOnly = bDepthOnly;
    RasterMaterialCacheKey.bIsTwoSided = RasterEntry.RasterPipeline.bIsTwoSided;
    RasterMaterialCacheKey.bCastShadow = RasterEntry.RasterPipeline.bCastShadow;
    RasterMaterialCacheKey.bVoxel = bVoxel;
    RasterMaterialCacheKey.bSplineMesh = RasterEntry.RasterPipeline.bSplineMesh;
    RasterMaterialCacheKey.bSkinnedMesh = RasterEntry.RasterPipeline.bSkinnedMesh;
    RasterMaterialCacheKey.bFixedDisplacementFallback = bFixedDisplacementFallback;
    RasterMaterialCacheKey.bUseWorkGraphSW = bUseWorkGraphForSW;
    RasterMaterialCacheKey.bUseWorkGraphHW = bUseWorkGraphForHW;
}

// 查询或创建缓存
FNaniteRasterMaterialCache& RasterMaterialCache =
    bUseSetupCache ? RasterEntry.CacheMap.FindOrAdd(RasterMaterialCacheKey) : EmptyCache;
```

### 4.3 缓存填充代码

`NaniteCullRaster.cpp:5537-5551`:

```cpp
if (bUseSetupCache && RasterizerPass.RasterMaterialCache &&
    !RasterizerPass.RasterMaterialCache->bFinalized)
{
    // 缓存材质代理
    RasterizerPass.RasterMaterialCache->VertexMaterialProxy = RasterizerPass.VertexMaterialProxy;
    RasterizerPass.RasterMaterialCache->PixelMaterialProxy = RasterizerPass.PixelMaterialProxy;
    RasterizerPass.RasterMaterialCache->ComputeMaterialProxy = RasterizerPass.ComputeMaterialProxy;

    // 缓存编译的着色器
    RasterizerPass.RasterMaterialCache->RasterVertexShader = RasterizerPass.RasterVertexShader;
    RasterizerPass.RasterMaterialCache->RasterPixelShader = RasterizerPass.RasterPixelShader;
    RasterizerPass.RasterMaterialCache->RasterMeshShader = RasterizerPass.RasterMeshShader;
    RasterizerPass.RasterMaterialCache->ClusterComputeShader = RasterizerPass.ClusterComputeShader;
    RasterizerPass.RasterMaterialCache->PatchComputeShader = RasterizerPass.PatchComputeShader;

    // 缓存材质数据
    RasterizerPass.RasterMaterialCache->VertexMaterial = RasterizerPass.VertexMaterial;
    RasterizerPass.RasterMaterialCache->PixelMaterial = RasterizerPass.PixelMaterial;
    RasterizerPass.RasterMaterialCache->ComputeMaterial = RasterizerPass.ComputeMaterial;

    // 标记缓存完成
    RasterizerPass.RasterMaterialCache->bFinalized = true;
}
```

---

## 5. 缓存读取流程

### 5.1 着色器排列维度

着色器支持材质缓存维度（`NaniteCullRaster.cpp:5064-5098`）:

```cpp
// Mesh Shader
PermutationVectorMS.Set<FHWRasterizeMS::FMaterialCacheDim>(bIsMaterialCache);
RasterizerPass.RasterMeshShader = GetHWRasterizeMeshShader(
    FixedMaterialShaderMap, PermutationVectorMS, ShaderFrequencyMS
);

// 顶点着色器
PermutationVectorVS.Set<FHWRasterizeVS::FMaterialCacheDim>(bIsMaterialCache);

// 像素着色器
PermutationVectorPS.Set<FHWRasterizePS::FMaterialCacheDim>(bIsMaterialCache);

// 计算着色器
PermutationVectorCS_Cluster.Set<FMicropolyRasterizeCS::FMaterialCacheDim>(bIsMaterialCache);
```

### 5.2 Shader 端读取

`MaterialCacheCommon.ush:26-41`:

```hlsl
FMaterialCacheBinData GetMaterialCacheShadingData(uint Index)
{
    // 从结构化缓冲读取数据
    const uint Stride = (uint)(sizeof(FMaterialCacheBinData) / sizeof(uint4));

    uint4 DW0 = MaterialCachePass.ShadingBinData[Stride * Index + 0];
    uint4 DW4 = MaterialCachePass.ShadingBinData[Stride * Index + 1];
    uint4 DW8 = MaterialCachePass.ShadingBinData[Stride * Index + 2];

    FMaterialCacheBinData Data;
    Data.ABufferPhysicalPosition = DW0.xyz;
    Data.PrimitiveData = DW0.w;
    Data.UVMinAndThreadAdvance = asfloat(DW4);
    Data.UVMinAndInvSize = asfloat(DW8);

    return Data;
}
```

### 5.3 A-Buffer 读取和混合

`MaterialCacheShadeCommon.ush:49-68`:

```hlsl
// 读取下层 A-Buffer
FMaterialCacheABufferTag GetMaterialBottomABuffer(
    EMaterialCacheFlag Flags,
    uint3 ABufferPhysicalPosition,
    uint2 PagePixelPos
)
{
    if (Flags & MatCache_DefaultBottomLayer)
    {
        // 使用默认下层
        return TAG_NAME(DefaultMaterialCacheABuffer_)();
    }
    else
    {
        // 从缓存读取下层
        return TAG_NAME(LoadMaterialCacheABufferPixel_)(ABufferPhysicalPosition, PagePixelPos);
    }
}

// 存储混合后的结果
void StoreMaterialABufferPixel(
    FMaterialCacheABufferTag Top,
    EMaterialCacheFlag Flags,
    uint3 ABufferPhysicalPosition,
    uint2 PagePixelPos
)
{
    FMaterialCacheABufferTag Bottom = GetMaterialBottomABuffer(
        Flags, ABufferPhysicalPosition, PagePixelPos
    );
    // 混合上下层
    Top = BlendMaterialCacheFixedFunctionLerp(Bottom, Top, Top.Weight);
    // 写回缓存
    TAG_NAME(StoreMaterialCacheABufferPixel_)(Top, ABufferPhysicalPosition, PagePixelPos);
}
```

---

## 6. A-Buffer 压缩写入

### 6.1 虚拟纹理写入

`MaterialCacheABufferPages.usf:22-97`:

```hlsl
[numthreads(MATERIAL_CACHE_PAGE_SIZE, MATERIAL_CACHE_PAGE_SIZE, 1)]
void WritePagesMain(uint3 DTid : SV_DispatchThreadID)
{
    const FMaterialCachePageWriteData Data = PageWriteData[DTid.z];

    uint3 ABufferPhysicalLocation = Data.ABufferPhysicalPosition;
    ABufferPhysicalLocation.xy += DTid.xy;

    uint2 VTPhysicalLocation = Data.VTPhysicalPosition + DTid.xy;

    // 根据压缩模式写入
#if COMPRESS_MODE == BC_NONE
    // 无压缩：直接写入 float4
    RWVTLayerUncompressed[VTPhysicalLocation] = ABuffer[ABufferPhysicalLocation];

#elif COMPRESS_MODE == BC1
    // BC1 压缩：RGB 565 + 1位 Alpha
    float3 BlockRGB[16];
    // ... 收集块数据
    RWVTLayerCompressed[VTPhysicalLocation] = CompressBC1Block(BlockRGB);

#elif COMPRESS_MODE == BC7
    // BC7 压缩：高质量 RGBA
    float3 BlockRGB[16];
    // ... 收集块数据
    RWVTLayerCompressed[VTPhysicalLocation] = CompressBC7Block(BlockRGB);
#endif
}
```

### 6.2 压缩格式对比

| 格式 | 每像素位数 | 质量 | 适用场景 |
|------|-----------|------|---------|
| BC_NONE | 128 | 最高 | 调试/需要完整精度 |
| BC1 | 4 | 低 | 简单材质/不需要 Alpha |
| BC3 | 8 | 中 | 带 Alpha 的材质 |
| BC7 | 8 | 高 | 高质量材质缓存 |

---

## 7. 缓存系统架构

### 7.1 三层缓存策略

```
┌─────────────────────────────────────────────────────────────┐
│                   材质缓存三层架构                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────┐               │
│  │ 第一层：Raster Material Cache             │               │
│  │ ├─ 键：FNaniteRasterMaterialCacheKey     │               │
│  │ │      (32位编码的着色器参数)             │               │
│  │ └─ 值：FNaniteRasterMaterialCache        │               │
│  │        (编译的着色器引用)                 │               │
│  │                                           │               │
│  │ 作用：避免重复着色器编译                  │               │
│  └──────────────────────────────────────────┘               │
│         │                                                    │
│         v                                                    │
│  ┌──────────────────────────────────────────┐               │
│  │ 第二层：A-Buffer（像素属性缓冲）          │               │
│  │ ├─ 8 个独立的 Texture2DArray 层          │               │
│  │ ├─ 每层格式：float4                       │               │
│  │ └─ 支持混合和分层                         │               │
│  │                                           │               │
│  │ 作用：缓存材质属性计算结果                │               │
│  └──────────────────────────────────────────┘               │
│         │                                                    │
│         v                                                    │
│  ┌──────────────────────────────────────────┐               │
│  │ 第三层：虚拟纹理缓存                      │               │
│  │ ├─ 压缩格式：BC1/BC3/BC7                  │               │
│  │ └─ 持久化存储                             │               │
│  │                                           │               │
│  │ 作用：长期缓存，减少内存占用              │               │
│  └──────────────────────────────────────────┘               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 数据流向

```
材质参数变化
      │
      v
创建 CacheKey (32位)
      │
      ├─ 缓存命中 ─→ 直接使用已编译着色器
      │
      └─ 缓存未命中 ─→ 编译着色器 ─→ 写入 CacheMap
                                          │
                                          v
                              执行着色 ─→ 写入 A-Buffer
                                          │
                                          v
                              压缩 ─→ 写入虚拟纹理
```

---

## 8. 性能影响

### 8.1 缓存命中率对性能的影响

| 场景 | 缓存命中率 | 性能影响 |
|------|-----------|---------|
| 静态场景首帧 | 0% | 大量着色器编译，明显卡顿 |
| 静态场景稳定帧 | 99%+ | 几乎无编译开销 |
| 材质参数动态变化 | 视变化频率 | 每次参数变化可能触发重编译 |
| 编辑器中 | N/A | 缓存禁用 |

### 8.2 内存开销

```
FNaniteRasterMaterialCache 每个实例约：
├─ 着色器引用：5 × 8 = 40 bytes
├─ 材质引用：6 × 8 = 48 bytes
├─ 可选参数：~32 bytes
└─ 总计：~120 bytes per entry

A-Buffer:
├─ 每层：Texture2DArray<float4>
├─ 典型尺寸：1024×1024×8 层
└─ 内存：1024×1024×8×16 = 128 MB
```

### 8.3 优化建议

1. **减少材质变体**：
   - 尽量使用材质实例而非材质参数
   - 避免运行时修改影响着色器编译的参数

2. **合理使用 A-Buffer**：
   - 简单材质使用 VertexInvariant 路径
   - 复杂材质才使用完整 A-Buffer

3. **压缩格式选择**：
   - BC1：简单材质，最小内存
   - BC7：需要高质量的复杂材质

---

## 9. 使用建议

### 9.1 适用场景

| 场景 | 是否推荐 | 原因 |
|------|---------|------|
| 大量相似 Nanite 材质 | ✅ 推荐 | 缓存命中率高 |
| 静态材质参数 | ✅ 推荐 | 编译一次，多次复用 |
| 动态材质参数 | ⚠️ 谨慎 | 可能频繁重编译 |
| 编辑器预览 | ❌ 自动禁用 | 需要实时响应材质变化 |

### 9.2 调试命令

```bash
# 查看材质缓存状态
stat MaterialCache

# 禁用材质缓存
r.Nanite.RasterSetupCache 0

# 禁用 VertexInvariant 优化
r.MaterialCache.VertexInvariant.Enable 0

# 启用命令缓存
r.MaterialCache.CommandCaching 1
```

---

## 10. 源码参考索引

| 组件 | 文件 | 关键行号 |
|------|------|---------|
| 缓存键定义 | `NaniteShared.h` | 592-643 |
| 缓存结构 | `NaniteShared.h` | 645-674 |
| 缓存启用判断 | `NaniteCullRaster.cpp` | 455-462 |
| 缓存键创建 | `NaniteCullRaster.cpp` | 5379-5402 |
| 缓存填充 | `NaniteCullRaster.cpp` | 5537-5551 |
| CVars 定义 | `MaterialCacheRenderer.cpp` | 28-58 |
| 渲染路径枚举 | `MaterialCacheRenderer.cpp` | 117-138 |
| A-Buffer 参数 | `MaterialCacheRenderer.cpp` | 62-72 |
| GPU 数据结构 | `MaterialCacheDefinitions.h` | 17-38 |
| Shader 读取 | `MaterialCacheCommon.ush` | 26-41 |
| A-Buffer 混合 | `MaterialCacheShadeCommon.ush` | 49-68 |
| 压缩写入 | `MaterialCacheABufferPages.usf` | 22-97 |

---

## 更新日志

| 日期 | 修改内容 |
|------|---------|
| 2026-01-19 | 初始版本，基于 UE 5.7 源码分析 |
