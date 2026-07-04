---
title: "HairStrands 体素化"
cat: UE 剖析
sub: 渲染
date: 2026-01-26
mins: 14
tags: [Groom, HairStrands]
---

> 毛发体素化系统：将毛发几何体转换为 3D 体素密度体积，用于计算毛发的阴影、透射、AO 和环境光照。

---

## 1. 控制层级

### 1.1 全局开关

```cpp
// HairStrandsVoxelization.cpp:32-33
static int32 GHairVoxelizationEnable = 1;
static FAutoConsoleVariableRef CVarGHairVoxelizationEnable(
    TEXT("r.HairStrands.Voxelization"),
    GHairVoxelizationEnable,
    TEXT("Enable hair voxelization for transmittance evaluation"));

// HairStrandsVoxelization.cpp:142-145
bool IsHairStrandsVoxelizationEnable(EShaderPlatform ShaderPlatform)
{
    return RHISupportsVolumeTextureAtomics(ShaderPlatform) && GHairVoxelizationEnable > 0;
}
```

| CVar | 默认值 | 说明 |
|------|--------|------|
| `r.HairStrands.Voxelization` | 1 | 总开关 |
| `r.HairStrands.Voxelization.Virtual` | 1 | 启用虚拟体素层级 |
| `r.HairStrands.Voxelization.GPUDriven` | 1 | GPU 驱动的体素分配 |

**平台要求：** 需要支持 Volume Texture Atomics（`RHISupportsVolumeTextureAtomics`）

### 1.2 体素参数

```cpp
// HairStrandsVoxelization.cpp:93-99
static float GHairVirtualVoxel_VoxelWorldSize = 0.3f;  // 3mm
static int32 GHairVirtualVoxel_PageResolution = 32;
static int32 GHairVirtualVoxel_PageCountPerDim = 14;
```

| CVar | 默认值 | 说明 |
|------|--------|------|
| `r.HairStrands.Voxelization.Virtual.VoxelWorldSize` | 0.3 | 单个体素的世界尺寸 (cm) |
| `r.HairStrands.Voxelization.Virtual.VoxelPageResolution` | 32 | 每个体素页的分辨率 |
| `r.HairStrands.Voxelization.Virtual.VoxelPageCountPerDim` | 14 | 3D 纹理每维的页数 |

**内存计算：**
```
单页体素数 = 32³ = 32,768
总页数 = 14³ = 2,744 页
总体素数 = 32,768 × 2,744 ≈ 9000 万
最大内存 = 2,744 × 32³ × 4 bytes ≈ 359 MB
```

### 1.3 自适应分配参数

```cpp
// HairStrandsVoxelization.cpp:121-126
static int32 GHairVirtualVoxelAdaptive_Enable = 1;
static float GHairVirtualVoxelAdaptive_CorrectionSpeed = 0.1f;
static float GHairVirtualVoxelAdaptive_CorrectionThreshold = 0.90f;
```

| CVar | 默认值 | 说明 |
|------|--------|------|
| `r.HairStrands.Voxelization.Virtual.Adaptive` | 1 | 启用自适应体素分配 |
| `r.HairStrands.Voxelization.Virtual.Adaptive.CorrectionSpeed` | 0.1 | 适应速度 (0-1)，越大越快但可能震荡 |
| `r.HairStrands.Voxelization.Virtual.Adaptive.CorrectionThreshold` | 0.9 | 分配阈值，防止过度分配 |

### 1.4 密度缩放

```cpp
// HairStrandsVoxelization.cpp:38-56
static float GHairVoxelizationDensityScale = 2.0f;
static float GHairVoxelizationDensityScale_AO = -1;
static float GHairVoxelizationDensityScale_Shadow = -1;
static float GHairVoxelizationDensityScale_Transmittance = -1;
static float GHairVoxelizationDensityScale_Environment = -1;
static float GHairVoxelizationDensityScale_Raytracing = -1;

// 获取实际密度值的逻辑：-1 表示使用全局值
static float GetHairStrandsVoxelizationDensityScale_Shadow()
{
    return GHairVoxelizationDensityScale_Shadow >= 0
        ? FMath::Max(0.0f, GHairVoxelizationDensityScale_Shadow)
        : GetHairStrandsVoxelizationDensityScale();
}
```

| CVar | 默认值 | 说明 |
|------|--------|------|
| `r.HairStrands.Voxelization.DensityScale` | 2.0 | 全局密度缩放 |
| `r.HairStrands.Voxelization.DensityScale.AO` | -1 | AO 密度缩放 (-1 使用全局值) |
| `r.HairStrands.Voxelization.DensityScale.Shadow` | -1 | 阴影密度缩放 |
| `r.HairStrands.Voxelization.DensityScale.Transmittance` | -1 | 透射密度缩放 |
| `r.HairStrands.Voxelization.DensityScale.Environment` | -1 | 环境光密度缩放 |
| `r.HairStrands.Voxelization.DensityScale.Raytracing` | -1 | 光追密度缩放 |

### 1.5 Ray Marching 参数

```cpp
// HairStrandsVoxelization.cpp:58-83
static float GHairVoxelizationDepthBiasScale_Shadow = 2.0f;
static float GHairVoxelizationDepthBiasScale_Transmittance = 3.0f;
static float GHairVoxelizationDepthBiasScale_Environment = 1.8f;

static float GHairStransVoxelRaymarchingSteppingScale = 1.15f;
```

| CVar | 默认值 | 说明 |
|------|--------|------|
| `r.HairStrands.Voxelization.DepthBiasScale.Shadow` | 2.0 | 阴影深度偏移 |
| `r.HairStrands.Voxelization.DepthBiasScale.Transmittance` | 3.0 | 透射深度偏移 |
| `r.HairStrands.Voxelization.DepthBiasScale.Environment` | 1.8 | 环境光深度偏移 |
| `r.HairStrands.Voxelization.Raymarching.SteppingScale` | 1.15 | Ray marching 步进缩放 |
| `r.HairStrands.Voxelization.Raymarching.SteppingScale.Shadow` | -1 | 阴影步进（-1 使用全局）|
| `r.HairStrands.Voxelization.Raymarching.SteppingScale.Transmission` | -1 | 透射步进 |
| `r.HairStrands.Voxelization.Raymarching.SteppingScale.Environment` | -1 | 环境光步进 |
| `r.HairStrands.Voxelization.Raymarching.SteppingScale.Raytracing` | -1 | 光追步进 |

### 1.6 不透明物体注入

```cpp
// HairStrandsVoxelization.cpp:66-72
static int32 GHairVoxelInjectOpaqueDepthEnable = 1;
static int32 GHairStransVoxelInjectOpaqueBiasCount = 3;
static int32 GHairStransVoxelInjectOpaqueMarkCount = 6;
```

| CVar | 默认值 | 说明 |
|------|--------|------|
| `r.HairStrands.Voxelization.InjectOpaqueDepth` | 1 | 将不透明几何深度注入体素 |
| `r.HairStrands.Voxelization.InjectOpaque.BiasCount` | 3 | 注入偏移（体素数） |
| `r.HairStrands.Voxelization.InjectOpaque.MarkCount` | 6 | 标记为不透明的体素数 |

---

## 2. 虚拟体素架构

### 2.1 两层体素结构

```
┌─────────────────────────────────────────────────────────────┐
│                    Virtual Voxel Hierarchy                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Level 0: Page Index (稀疏)                                  │
│  ┌───┬───┬───┬───┐                                          │
│  │ P │ - │ P │ - │   P = 已分配页                            │
│  ├───┼───┼───┼───┤   - = 空页                               │
│  │ - │ P │ - │ P │                                          │
│  └───┴───┴───┴───┘                                          │
│          ↓                                                   │
│  Level 1: Voxel Page (密集)                                  │
│  ┌────────────────┐                                         │
│  │ 32×32×32 体素  │  每页 32,768 个体素                      │
│  │ 存储密度值     │                                          │
│  └────────────────┘                                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 页分配流程

```
┌──────────────────┐
│ 计算 MacroGroup  │
│ 的世界空间 AABB  │
└────────┬─────────┘
         ↓
┌──────────────────┐
│ 根据 VoxelSize   │
│ 计算 PageIndex   │
│ 分辨率           │
└────────┬─────────┘
         ↓
┌──────────────────┐
│ 标记有毛发覆盖   │
│ 的 PageIndex     │
└────────┬─────────┘
         ↓
┌──────────────────┐
│ 压缩分配实际     │
│ 体素页           │
└────────┬─────────┘
         ↓
┌──────────────────┐
│ 栅格化毛发到     │
│ 体素页           │
└──────────────────┘
```

---

## 3. 执行流程

### 3.1 主入口函数

```cpp
// HairStrandsVoxelization.cpp:1287-1395
void VoxelizeHairStrands(
    FRDGBuilder& GraphBuilder,
    const FScene* Scene,
    FViewInfo& View,
    FInstanceCullingManager& InstanceCullingManager,
    const FVector& PreViewStereoCorrection)
{
    // 1. 检查是否需要体素化
    if (!IsHairStrandsVoxelizationEnable(View.GetShaderPlatform()) || MacroGroupDatas.Num() == 0)
    {
        VirtualVoxelResources = AllocateDummyVirtualVoxelResources(...);
        return;
    }

    // 2. 检查是否有支持体素化的元素
    bool bHasValidElementToVoxelize = false;
    for (const FHairStrandsMacroGroupData& MacroGroup : MacroGroupDatas)
    {
        if (MacroGroup.bSupportVoxelization)
        {
            bHasValidElementToVoxelize = true;
            break;
        }
    }

    // 3. 收集需要体素化的实例
    for (FHairStrandsMacroGroupData& MacroGroup : MacroGroupDatas)
    {
        if (MacroGroup.bSupportVoxelization)
        {
            for (const auto& PrimitiveInfo : MacroGroup.PrimitivesInfos)
            {
                if (HairGroupPublicData->DoesSupportVoxelization())
                {
                    // 收集实例数据
                }
            }
        }
    }

    // 4. 分配虚拟体素资源
    VirtualVoxelResources = AllocateVirtualVoxelResources(...);

    // 5. 清空体素页
    IndirectVoxelPageClear(GraphBuilder, View, VirtualVoxelResources);

    // 6. 栅格化毛发到体素
    AddVirtualVoxelizationRasterPass(GraphBuilder, &View, VirtualVoxelResources, InstanceDatas);

    // 7. 注入不透明深度
    if (GHairVoxelInjectOpaqueDepthEnable > 0)
    {
        for (uint32 MacroGroupId : ValidMacroGroupIDs)
        {
            AddVirtualVoxelInjectOpaquePass(...);
        }
    }

    // 8. 生成 Mip 链
    AddVirtualVoxelGenerateMipPass(GraphBuilder, View, VirtualVoxelResources, PageToPageIndexBuffer);
}
```

### 3.2 GPU Pass 流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                     HairStrandsVoxelization                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Pass 1: AllocatePageIndex                                          │
│  ├─ 计算每个 MacroGroup 的 PageIndex 分辨率                          │
│  ├─ 对齐 AABB 到体素页边界                                           │
│  └─ 分配 PageIndex 缓冲区                                            │
│                              ↓                                       │
│  Pass 2: MarkValidPageIndex_Prepare                                  │
│  ├─ 遍历毛发 Cluster/Group                                           │
│  └─ 标记有毛发覆盖的 PageIndex                                       │
│                              ↓                                       │
│  Pass 3: AllocateVoxelPage                                           │
│  ├─ 压缩有效的 PageIndex                                             │
│  ├─ 分配实际的体素页                                                 │
│  └─ 建立 PageIndex → Page 映射                                       │
│                              ↓                                       │
│  Pass 4: VoxelIndPageClear                                           │
│  └─ 清空所有已分配的体素页                                           │
│                              ↓                                       │
│  Pass 5: VoxelRasterCompute                                          │
│  ├─ 遍历每根毛发的每个线段                                           │
│  ├─ 计算线段覆盖的体素                                               │
│  └─ 原子累加密度到体素                                               │
│                              ↓                                       │
│  Pass 6: InjectOpaqueDepth (可选)                                    │
│  ├─ 读取场景深度                                                     │
│  └─ 在不透明表面下方标记体素为遮挡                                   │
│                              ↓                                       │
│  Pass 7: GenerateMip                                                 │
│  └─ 生成体素 Mip 链用于加速 Ray Marching                             │
│                              ↓                                       │
│  Pass 8: AdaptiveFeedback (可选)                                     │
│  └─ 根据实际分配调整下一帧的体素大小                                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. 自适应体素分配

### 4.1 问题：耗时不稳定

自适应分配会导致体素化耗时在高低之间波动。

**原因分析：**

```hlsl
// HairStrandsVoxelRasterCompute.usf:547-590
void FeedbackCS(...)
{
    const float CurrVoxelWorldSize = RoundHairVoxelSize(CurrGPUMinVoxelWorldSize[0]);

    // 计算当前分配比例（体积比 → 线性比）
    const uint GPUAllocatedPageCount = PageIndexGlobalCounter[GLOBAL_PAGE_COUNTER_INDEX];
    const float VolumeRatio = float(GPUAllocatedPageCount) / float(CPUAllocatedPageCount);
    const float LinearRatio = pow(VolumeRatio, 1.f / 3.f);

    // 带阈值的比例（用于减小体素）
    const float VolumeRatio_Thres = float(GPUAllocatedPageCount) / float(CPUAllocatedPageCount * AdaptiveCorrectionThreshold);
    const float LinearRatio_Thres = pow(max(VolumeRatio_Thres, 0.f), 1.f / 3.f);

    float NextVoxelWorldSize = CPUMinVoxelWorldSize;

    // 如果分配超出池大小，增大体素尺寸
    if (GPUAllocatedPageCount > CPUAllocatedPageCount)
    {
        NextVoxelWorldSize = lerp(CurrVoxelWorldSize, CurrVoxelWorldSize * LinearRatio, AdaptiveCorrectionSpeed);
    }
    // 如果分配未满且体素过大，减小体素尺寸
    else if (CurrVoxelWorldSize > CPUMinVoxelWorldSize && LinearRatio_Thres < 1.f)
    {
        NextVoxelWorldSize = lerp(CurrVoxelWorldSize, CurrVoxelWorldSize * LinearRatio_Thres, AdaptiveCorrectionSpeed);
    }
}
```

**震荡周期：**
```
帧 N:   页分配过多 → 增大 VoxelSize → 体素变粗 → 分配减少
帧 N+1: 页分配过少 → 减小 VoxelSize → 体素变细 → 分配增加
帧 N+2: 页分配过多 → ...（循环）
```

### 4.2 解决方案

**方案 1：禁用自适应分配**
```cpp
r.HairStrands.Voxelization.Virtual.Adaptive 0
```
使用固定的 `VoxelWorldSize`，耗时稳定但可能不够精细或浪费内存。

**方案 2：降低校正速度**
```cpp
r.HairStrands.Voxelization.Virtual.Adaptive.CorrectionSpeed 0.05
```
减缓适应速度，减少震荡幅度。

**方案 3：增大阈值**
```cpp
r.HairStrands.Voxelization.Virtual.Adaptive.CorrectionThreshold 0.80
```
保留更多分配余量，减少减小体素的频率。

---

## 5. 可视化调试

### 5.1 ViewMode

```cpp
r.HairStrands.ViewMode VoxelsDensity
```

可用的调试模式（来自 `GroomVisualizationData.h:10-50`）：

| 模式 | 说明 |
|------|------|
| `VoxelsDensity` | 显示体素密度分布 |
| `MacroGroups` | 显示 MacroGroup 划分 |
| `ClusterAABB` | 显示 Cluster 包围盒 |
| `Group` | 显示毛发组 |

### 5.2 性能统计

```cpp
stat gpu  // 查看 HairStrandsVoxelization 耗时
```

GPU Profiler 中的相关事件：
- `HairStrandsIndVoxelPageClear`
- `HairStrandsVoxelize`
- `HairStrandsDensityMipGen`

---

## 6. 体素用途

体素化后的密度体积用于多种光照计算：

| 用途 | 说明 | 相关 CVar |
|------|------|-----------|
| **Shadow** | 毛发自阴影 | `DensityScale.Shadow`, `DepthBiasScale.Shadow` |
| **Transmittance** | 光线透射（半透明效果）| `DensityScale.Transmittance`, `DepthBiasScale.Transmittance` |
| **AO** | 环境遮蔽 | `DensityScale.AO` |
| **Environment** | 环境光/天光 | `DensityScale.Environment`, `DepthBiasScale.Environment` |
| **Raytracing** | 光追中的毛发遮挡 | `DensityScale.Raytracing` |

---

## 7. 性能影响

### 7.1 主要性能因素

| 因素 | 影响 |
|------|------|
| 毛发数量 | 更多毛发 → 更多栅格化工作 |
| VoxelWorldSize | 越小越精细，但页数更多 |
| PageCountPerDim | 越大内存越多，但覆盖范围更大 |
| 自适应分配 | 可能导致帧间波动 |

### 7.2 典型耗时

| 场景 | 耗时范围 |
|------|----------|
| 单角色毛发 | 1-3 ms |
| 多角色毛发 | 3-8 ms |
| 大量毛发 + 自适应震荡 | 可能飙升到 10+ ms |

### 7.3 优化建议

**减少体素化开销：**
```cpp
// 增大体素尺寸（减少精度换取性能）
r.HairStrands.Voxelization.Virtual.VoxelWorldSize 0.5

// 减少页分辨率
r.HairStrands.Voxelization.Virtual.VoxelPageResolution 16

// 禁用不透明深度注入
r.HairStrands.Voxelization.InjectOpaqueDepth 0
```

**稳定帧率：**
```cpp
// 禁用自适应分配
r.HairStrands.Voxelization.Virtual.Adaptive 0

// 或降低适应速度
r.HairStrands.Voxelization.Virtual.Adaptive.CorrectionSpeed 0.02
```

---

## 8. 完整 CVar 列表

| CVar | 默认值 | 说明 |
|------|--------|------|
| `r.HairStrands.Voxelization` | 1 | 总开关 |
| `r.HairStrands.Voxelization.AABBScale` | 1.0 | AABB 缩放 |
| `r.HairStrands.Voxelization.DensityScale` | 2.0 | 全局密度缩放 |
| `r.HairStrands.Voxelization.DensityScale.AO` | -1 | AO 密度 |
| `r.HairStrands.Voxelization.DensityScale.Shadow` | -1 | 阴影密度 |
| `r.HairStrands.Voxelization.DensityScale.Transmittance` | -1 | 透射密度 |
| `r.HairStrands.Voxelization.DensityScale.Environment` | -1 | 环境光密度 |
| `r.HairStrands.Voxelization.DensityScale.Raytracing` | -1 | 光追密度 |
| `r.HairStrands.Voxelization.DepthBiasScale.Shadow` | 2.0 | 阴影深度偏移 |
| `r.HairStrands.Voxelization.DepthBiasScale.Transmittance` | 3.0 | 透射深度偏移 |
| `r.HairStrands.Voxelization.DepthBiasScale.Environment` | 1.8 | 环境光深度偏移 |
| `r.HairStrands.Voxelization.ForceTransmittanceAndShadow` | 0 | 强制使用体素计算透射和阴影 |
| `r.HairStrands.Voxelization.InjectOpaqueDepth` | 1 | 注入不透明深度 |
| `r.HairStrands.Voxelization.InjectOpaque.BiasCount` | 3 | 注入偏移 |
| `r.HairStrands.Voxelization.InjectOpaque.MarkCount` | 6 | 标记体素数 |
| `r.HairStrands.Voxelization.Virtual` | 1 | 启用虚拟体素 |
| `r.HairStrands.Voxelization.Virtual.VoxelWorldSize` | 0.3 | 体素世界尺寸 (cm) |
| `r.HairStrands.Voxelization.Virtual.VoxelPageResolution` | 32 | 页分辨率 |
| `r.HairStrands.Voxelization.Virtual.VoxelPageCountPerDim` | 14 | 每维页数 |
| `r.HairStrands.Voxelization.Virtual.Adaptive` | 1 | 启用自适应分配 |
| `r.HairStrands.Voxelization.Virtual.Adaptive.CorrectionSpeed` | 0.1 | 适应速度 |
| `r.HairStrands.Voxelization.Virtual.Adaptive.CorrectionThreshold` | 0.9 | 分配阈值 |
| `r.HairStrands.Voxelization.Virtual.Jitter` | 1 | 抖动模式 (0=无, 1=随机, 2=固定) |
| `r.HairStrands.Voxelization.Virtual.InvalidateEmptyPageIndex` | 1 | 清除空页索引 |
| `r.HairStrands.Voxelization.Virtual.ComputeRasterMaxVoxelCount` | 32 | 最大栅格化体素数 |
| `r.HairStrands.Voxelization.GPUDriven` | 1 | GPU 驱动分配 |
| `r.HairStrands.Voxelization.GPUDriven.MinPageIndexResolution` | 32 | 最小页索引分辨率 |
| `r.HairStrands.Voxelization.GPUDriven.MaxPageIndexResolution` | 64 | 最大页索引分辨率 |
| `r.HairStrands.Voxelization.Raymarching.SteppingScale` | 1.15 | Ray marching 步进 |
| `r.HairStrands.Voxelization.Raymarching.SteppingScale.Shadow` | -1 | 阴影步进 |
| `r.HairStrands.Voxelization.Raymarching.SteppingScale.Transmission` | -1 | 透射步进 |
| `r.HairStrands.Voxelization.Raymarching.SteppingScale.Environment` | -1 | 环境光步进 |
| `r.HairStrands.Voxelization.Raymarching.SteppingScale.Raytracing` | -1 | 光追步进 |
| `r.RayTracing.Shadows.HairOcclusionThreshold` | 1 | 光追阴影毛发遮挡阈值 |
| `r.RayTracing.Sky.HairOcclusionThreshold` | 1 | 天光毛发遮挡阈值 |

---

## 9. 源码参考

| 功能 | 文件 | 行号 |
|------|------|------|
| CVars 定义 | `HairStrandsVoxelization.cpp` | 32-130 |
| 启用检查 | `HairStrandsVoxelization.cpp` | 142-145 |
| 主入口 VoxelizeHairStrands | `HairStrandsVoxelization.cpp` | 1287-1395 |
| 页分配 AllocatePageIndex | `HairStrandsVoxelRasterCompute.usf` | 59-165 |
| 自适应反馈 FeedbackCS | `HairStrandsVoxelRasterCompute.usf` | 547-590 |
| 光栅化 MainCS | `HairStrandsVoxelRasterCompute.usf` | 675-750 |
| 页面清除 VoxelIndPageClearCS | `HairStrandsVoxelization.cpp` | 405-428 |
| Mip 生成 | `HairStrandsVoxelization.cpp` | 1204+ |
| ViewMode 枚举 | `GroomVisualizationData.h` | 10-50 |

---

## 更新日志

| 日期 | 内容 |
|------|------|
| 2026-01-26 | 更新完整 CVar 列表，添加自适应分配算法细节 |
| 2026-01-23 | 初始版本，基于 UE 5.7 源码分析 |
