---
title: "MegaLights 渲染管线技术详解"
cat: UE 剖析
sub: 渲染
date: 2026-05-27
mins: 16
tags: [MegaLights, 渲染管线]
---

> 纯技术向文档，聚焦 MegaLights 的算法原理、数据流、GPU Pass 调度和 Shader 实现细节。

源码版本：UE 5.7.3 (`D:\WorkSpace\UnrealEngine`, branch `release`)

---

## 1. 算法基础

### 1.1 随机直接光照（Stochastic Direct Lighting）

传统 Deferred Shading 对每个像素逐光源求解：

$$
L_{\text{total}}(x) = \sum_{i=1}^{N} f(x, \omega_i) \cdot L_i \cdot V(x, \omega_i) \cdot G(x, \omega_i)
$$

当 N 很大时，开销线性增长。MegaLights 将其转化为蒙特卡洛估计：

$$
L_{\text{total}}(x) \approx \frac{1}{K}\sum_{k=1}^{K}\frac{f(x, \omega_k) \cdot L_k \cdot V(x, \omega_k) \cdot G(x, \omega_k)}{p(k|x)}
$$

其中：
- $K$ = 固定采样数（默认 4）
- $p(k|x)$ = 光源 k 对像素 x 的采样概率（PDF）
- $V(x, \omega_k)$ = 可见性（0 或 1，通过射线追踪确定）

关键洞察：**开销只取决于 K，与光源总数 N 无关**。

### 1.2 重要性采样策略

MegaLights 使用 **Weighted Reservoir Sampling (WRS)** 的变体进行光源选择。

核心思想：遍历所有光源，为每个光源计算权重 w_i（基于对当前像素的预估贡献），然后从中随机选择 K 个样本，选中概率正比于权重。

PDF 计算（`MegaLightsSampling.usf:77-111`）：

```hlsl
FLightTargetPDF GetLocalLightTargetPDF(LightData, WorldPos, Material, ...)
{
    // 完整计算光照（含衰减、BRDF、IES）但不含阴影
    FDeferredLightingSplit SplitLighting = GetMegaLightsSplitLighting(...);
    float Lum = SplitLighting.LightingLuminance * View.PreExposure;

    // IES Profile 调制
    if (LightData.IESAtlasIndex >= 0 && Lum > 0.01f)
        Lum *= ComputeLightProfileMultiplier(...);

    // 模拟 Tonemapping 压缩动态范围，避免极亮光源垄断所有采样
    LightTargetPDF.Weight = log2(Lum + 1.0f);
    return LightTargetPDF;
}
```

**为什么用 log2(Lum+1)?**  
直接用亮度作为权重会导致一个极亮光源吃掉所有采样预算。log 压缩让暗光源也有机会被采样到，减少方差。

### 1.3 Reservoir Sampling 实现

`MegaLightsSampling.ush:84-114` 实现了流式 WRS：

```hlsl
void AddLightSample(inout FLightSampler Sampler, float Weight, uint LightIndex, ...)
{
    // 方向光预算钳制：防止方向光独占所有采样
    if (!bRadialLight && DirectionalLightSampleRatio > 0)
        Weight = min(Weight, max(Sampler.WeightSum, MinClamp) * Ratio);

    // Reservoir 更新
    float Tau = Sampler.WeightSum / (Sampler.WeightSum + Weight);
    Sampler.WeightSum += Weight;

    for (each sample slot k)
    {
        if (Random[k] < Tau)
            Random[k] /= Tau;          // 保留旧样本，重新归一化随机数
        else
        {
            // 替换为新光源
            Random[k] = (Random[k] - Tau) / (1 - Tau);
            Samples[k] = {LightIndex, Weight, bWasVisible};
        }
    }
}
```

这是 **A-Res (Algorithm R with weights)** 的 GPU 友好变体：
- 单次遍历所有光源，$O(N)$ 时间
- 每个 slot 独立决策，天然并行
- 最终每个 slot 选中光源 $i$ 的概率 $= w_i / \sum w$

### 1.4 射线引导（Ray Guiding / GuideByHistory）

上一帧的可见性信息存储在 `VisibleLightHash` 中。当前帧采样时：

```
对被遮挡的光源: Weight *= LightHiddenPDFWeight (默认 0.1)
对面光源被遮挡部分: Weight *= AreaLightHiddenPDFWeight (默认 0.25)
无历史时: Weight *= LightHiddenPDFWeightForHistoryMiss (默认 0.4)
```

效果：将更多射线集中到可见光源，减少浪费在被遮挡光源上的采样。

---

## 2. 数据结构与 Buffer 布局

### 2.1 核心 Buffer

| Buffer | 格式 | 尺寸 | 内容 |
|--------|------|------|------|
| `LightSamples` | `R32_UINT` | SampleBufferSize | 每采样点的候选光源（PackedCandidateLightSample） |
| `LightSampleRays` | `R32_UINT` | SampleBufferSize | 每采样点的射线追踪坐标（PackedTraceTexel） |
| `ResolvedDiffuseLighting` | R11G11B10 / RGBA16F | ViewSize | 解析后的漫反射光照 |
| `ResolvedSpecularLighting` | R11G11B10 / RGBA16F | ViewSize | 解析后的镜面反射光照 |
| `ShadingConfidence` | R16F | ViewSize | 采样置信度（控制降噪强度） |
| `VisibleLightHash` | `R32_UINT × 4` | TileCount | 每 Tile 的可见光 bitmask |
| `VisibleLightMaskHash` | `R32_UINT × 4` | TileCount | 每 Tile 的可见光区域 mask |

### 2.2 PackedCandidateLightSample 编码

```hlsl
// MegaLightsSampling.ush:29-35
uint PackCandidateLightSample(FCandidateLightSample Sample)
{
    // [15:0]  = LocalLightIndex (最多 65536 个光源)
    // [30:16] = Weight (float16, 仅正数，复用符号位)
    // [31]    = bLightWasVisible (历史可见性)
    uint Packed = Sample.LocalLightIndex & 0xFFFF;
    Packed |= (f32tof16(Sample.Weight) & 0x7FFF) << 16;
    Packed |= Sample.bLightWasVisible ? (1U << 31) : 0U;
    return Packed;
}
```

### 2.3 SampleBuffer 坐标映射

```
ScreenPixel (ViewSize)
    ↓ ÷ DownsampleFactor (默认 2x2)
DownsampledPixel (DownsampledViewSize)
    ↓ × NumSamplesPerPixel2d (默认 2x2)
SampleCoord (SampleBufferSize)
```

即：每个降采样像素对应 4 个采样槽位（2x2 布局），每个槽位存储一个候选光源。

### 2.4 Tile 结构

```
Tile Size = 8×8 像素
TileData: StructuredBuffer<uint>
    - 每个 Tile 一个 entry
    - 按 ETileType 分类后存入不同的 TileData 列表
    - TileAllocator 记录每种类型的 Tile 数量
    - 用于 Indirect Dispatch
```

### 2.5 VisibleLightHash 编码

```hlsl
// MegaLightsSampling.usf:161-167
uint GetLightVisibilityMask(uint Hash[4], uint LightIndex)
{
    uint h = PCGHash(LightIndex);
    uint slot = (h >> 16) % 32;  // 32 个槽位
    uint mask = (Hash[slot / 8] >> (4 * (slot % 8))) & 0xF;
    return mask;  // 4-bit visibility mask (面光源的 4 个象限)
}
```

每个 Tile 用 128 bits (4×uint32) 存储可见光信息。通过 hash 映射光源 ID 到 32 个 4-bit 槽位。面光源的 4 bit 分别代表光源面积的 4 个象限的可见性。

---

## 3. GPU Pass 完整流程

### 3.1 帧时序图

```
BeginRenderMegaLights (早期，在 Shadow Rendering 之前)
│
├── ViewContext.Setup()
│   ├── 读取 CVar，计算 Buffer 尺寸
│   ├── 创建 RDG Texture/Buffer
│   ├── 获取历史 Buffer（Temporal Reprojection 用）
│   └── 设置 MegaLightsParameters / VolumeParameters
│
├── ViewContext.TileClassificationMark(Pass=0)
│   ├── StochasticLighting::Run()  ← 共享的 Tile 分类基础设施
│   │   ├── 写入 SceneDepth/Normal History
│   │   ├── 降采样 Depth/Normal (2x1 或 2x2)
│   │   ├── 计算 HistoryScreenCoord (Motion Reprojection)
│   │   └── 输出 MegaLightsTileBitmask
│   │
│   └── MegaLightsTileClassificationBuildListsCS
│       ├── 读取 TileBitmask
│       ├── 按 ETileType 分类
│       └── 写入 TileAllocator + TileData (Indirect Args)
│
├── ViewContext.GenerateSamples(Pass=0)
│   ├── GenerateLightSamplesCS (per TileType)
│   │   ├── 遍历 ForwardLightData 中所有光源
│   │   ├── 计算 TargetPDF (无阴影光照亮度)
│   │   ├── GuideByHistory: 查询 VisibleLightHash 降权
│   │   ├── Reservoir Sampling → 选出 K 个候选光源
│   │   └── 写入 LightSamples + LightSampleRays
│   │
│   └── (Volume) GenerateVolumeLightSamplesCS
│       └── 同上，但在 3D Froxel Grid 上操作
│
├── ViewContext.MarkVSMPages() [仅 VSM 模式]
│   └── MegaLightsVSMMarkingCS
│       ├── 读取 LightSamples 中的光源 ID
│       ├── 计算 World Position → Shadow Space
│       └── 标记 VSM Page 为 Requested
│
└── [返回主渲染流程，VSM/Shadow 渲染发生在此之后]

─────────────────────────────────────────────────────

RenderMegaLights (在 Shadow Rendering 之后)
│
├── for ShadingPassIndex = 0..N-1 (普通模式 N=1)
│   │
│   ├── [Pass > 0 时重做 TileClassification + GenerateSamples]
│   │
│   ├── ViewContext.RayTrace()
│   │   │
│   │   ├── ScreenTracesCS (HZB 屏幕空间追踪)
│   │   │   ├── 从像素出发沿射线方向步进 HZB
│   │   │   ├── MaxIterations=50, MaxDistance=100
│   │   │   ├── 命中 → 标记为 Occluded
│   │   │   └── 未命中 → 写入 LightSampleRays 供后续追踪
│   │   │
│   │   ├── [可选] DistantScreenTracesCS
│   │   │   └── 线性屏幕追踪，处理 RT Scene 之外的远距离阴影
│   │   │
│   │   ├── HardwareRayTracingCS / SoftwareRayTracingCS
│   │   │   ├── 从 Screen Trace 终点继续
│   │   │   ├── HWRT: TraceRayInline → TLAS/BLAS 遍历
│   │   │   ├── SWRT: Global SDF 步进
│   │   │   └── 输出: 遮蔽 0/1 写回 LightSamples
│   │   │
│   │   ├── [可选] VSMTracingCS
│   │   │   └── 对 VSM 模式的光源采样 Shadow Depth
│   │   │
│   │   └── [可选] FarFieldRayTracingCS
│   │       └── 使用 HLOD1 BVH 延伸射线
│   │
│   └── ViewContext.Resolve()
│       │
│       ├── ShadeLightSamplesCS (per TileType)
│       │   ├── 读取 LightSamples (光源 ID + 可见性)
│       │   ├── 完整 BRDF 评估 (Diffuse + Specular)
│       │   ├── MIS 权重: Contribution / PDF
│       │   ├── MaxShadingWeight 钳制 (防 firefly)
│       │   ├── 累加到 ResolvedDiffuse/Specular
│       │   └── 更新 VisibleLightHash
│       │
│       ├── [Volume] VolumeShading
│       │   └── 同上，输出到 VolumeResolvedLighting
│       │
│       └── FilterVisibleLightHashCS [可选]
│           └── 在相邻 Tile 间共享可见性信息
│
├── ViewContext.DenoiseLighting()
│   │
│   ├── DenoiserTemporalCS
│   │   ├── Reproject 历史 (Motion Vector)
│   │   ├── 3x3 Neighborhood Clamp (Mean ± Scale*StdDev)
│   │   ├── 混合: lerp(History, Current, 1/AccumulatedFrames)
│   │   └── 输出: 降噪后 Diffuse/Specular + Moments + FrameCount
│   │
│   └── DenoiserSpatialCS
│       ├── Cross-Bilateral Filter
│       ├── 权重: Depth + Normal + 距离
│       ├── KernelRadius=8, NumSamples=4
│       └── 对 Disocclusion 区域增强滤波
│
└── 最终结果加回 SceneColor
```

---

### 3.2 Pass 详解: GenerateLightSamplesCS

**入口**: `MegaLightsSampling.usf` -> `GenerateLightSamplesCS`  
**Dispatch**: Indirect, 按 TileType 分派 (每种 TileType 一次 Dispatch)  
**ThreadGroup**: 8x8 = 64 threads, 每 thread 处理一个降采样像素

**算法流程**:

```
1. 加载像素材质 (GBuffer / HairStrands)
   -> FMegaLightsMaterial: WorldNormal, Roughness, DiffuseColor, SpecularColor, Depth

2. 初始化 FLightSampler (K 个 slot, 分层随机数)
   -> InitLightSamplerStratified(BlueNoiseScalar)

3. 遍历 ForwardLightData 中所有本地光源:
   for (uint i = 0; i < NumLocalLights; ++i)
   {
       a. 快速剔除: Attenuation 范围外 -> skip
       b. Lighting Channel 不匹配 -> skip
       c. 计算 TargetPDF: GetLocalLightTargetPDF()
          - 完整光照评估 (无阴影)
          - log2(Luminance + 1) 作为权重
       d. GuideByHistory:
          - 查询 VisibleLightHash 历史
          - 被遮挡光源: Weight *= 0.1
          - 面光源被遮挡象限: Weight *= 0.25
       e. MinSampleWeight 剔除: Weight < 0.001 -> skip
       f. AddLightSample() -> Reservoir 更新
   }

4. 对每个选中的光源生成阴影射线参数:
   for (k = 0; k < K; ++k)
   {
       a. 读取候选光源 ID
       b. GenerateShadowRay():
          - 球光源 -> 立体角采样
          - 胶囊光源 -> 胶囊立体角采样
          - 矩形光源 -> 矩形面积采样
          - 方向光 -> 圆盘采样
       c. 写入 LightSamples[SampleCoord] = PackedCandidateLightSample
       d. 写入 LightSampleRays[SampleCoord] = PackedTraceTexel
   }
```

**Shader Permutation 维度**:
- `TILE_TYPE`: 0-12 (不同材质/光源组合)
- `NUM_SAMPLES_PER_PIXEL_1D`: 2, 4, 16
- `GUIDE_BY_HISTORY`: bool
- `INPUT_TYPE`: GBuffer / HairStrands
- `DEBUG_MODE`: bool
- `REFERENCE_MODE`: bool
- `USE_HAIR_COMPLEX_TRANSMITTANCE`: bool

### 3.3 Pass 详解: Screen Traces

**入口**: `MegaLightsRayTracing.cpp` -> `ScreenTracesCS`  
**原理**: 利用 HZB (Hierarchical Z-Buffer) 进行快速屏幕空间射线步进

```
算法:
1. 读取射线起点 (像素 World Position) 和方向 (指向光源)
2. 将射线投影到屏幕空间
3. HZB 层级步进:
   - 从最粗 mip 开始
   - 如果射线 Z < HZB Z -> 可能命中, 降低 mip
   - 如果射线 Z > HZB Z -> 未命中, 步进到下一个 cell
   - 到达 mip 0 且 Z 差 < RelativeDepthThickness -> 确认命中
4. 命中 -> 标记 Occluded, 不需要后续 RT
5. 未命中/出屏 -> 记录终点, 传递给 World Space Trace
```

**关键参数**:
- `MaxIterations = 50`: HZB 步进最大次数
- `RelativeDepthThickness = 0.005`: 命中判定的相对深度阈值
- `MaxDistance = 100`: 世界空间最大追踪距离
- `MinimumOccupancy = 0`: Wave 内最少活跃线程数 (可用于 scalability 提前终止)

**优势**: 极低开销捕捉近距离遮挡 (家具、墙角等), 减少昂贵的 HWRT 调用。

### 3.4 Pass 详解: Hardware Ray Tracing

**入口**: `MegaLightsHardwareRayTracing.usf`  
**模式**: Inline Ray Tracing (默认) 或 RayGen Pipeline

```
算法:
1. 读取 Screen Trace 未解决的射线
2. 计算射线偏移 (Bias/NormalBias/PullbackBias)
3. TraceRayInline():
   - 遍历 TLAS -> BLAS
   - Any-Hit: 可选 Alpha Masking 评估
   - 命中 -> Occluded
   - 未命中 -> Visible
4. [可选] Far Field:
   - 如果主 TLAS 未命中且启用 FarField
   - 在 HLOD1 的独立 TLAS 中继续追踪
5. 写回可见性结果到 LightSamples
```

**Inline vs RayGen**:
- Inline (`r.MegaLights.HardwareRayTracing.Inline=1`): 在 Compute Shader 中直接调用 `TraceRayInline`, 无需切换 Pipeline State, 更适合短射线
- RayGen: 使用完整的 RT Pipeline, 支持递归, 但切换开销更大

### 3.5 Pass 详解: ShadeLightSamplesCS (Resolve)

**入口**: `MegaLightsShading.usf` -> `ShadeLightSamplesCS`  
**Dispatch**: Indirect, 按 TileType x DownsampleFactor 分派

```
算法:
1. 读取像素材质 (与 GenerateSamples 相同)
2. for (k = 0; k < K; ++k):
   a. 读取 LightSamples[k]: LightIndex + Visibility
   b. if (Occluded) -> skip
   c. 完整 BRDF 评估:
      - GetMegaLightsSplitLighting() -> Diffuse + Specular
      - Substrate: SubstrateDeferredLighting()
      - Legacy: GetDynamicLighting()
   d. MIS 权重计算:
      Weight = 1.0 / max(Sample.PDF, MinSampleWeight)
      Weight = min(Weight, MaxShadingWeight)  // 防 firefly
   e. 累加:
      DiffuseAccum += DiffuseLighting * Weight
      SpecularAccum += SpecularLighting * Weight

3. 写入 ResolvedDiffuseLighting / ResolvedSpecularLighting
4. 计算 ShadingConfidence (采样充分度)
5. 更新 VisibleLightHash:
   - 对每个可见光源, 设置对应 hash 位
   - 面光源: 根据射线方向设置象限 bit
```

**Light Index Scalarization** (`r.MegaLights.LightIndexScalarizationThreshold=1.0`):
- 当 Wave 内唯一光源数量 <= threshold x K 时
- 将光源索引提升为 Uniform (标量化)
- 所有 lane 共享同一光源数据加载 -> 减少 VGPR 压力和内存带宽

### 3.6 Pass 详解: Temporal Denoiser

**入口**: `MegaLightsDenoiserTemporal.usf` -> `DenoiserTemporalCS`  
**ThreadGroup**: 8x8, 使用 GroupShared Memory 缓存邻域数据

```
算法:
1. 加载当前帧 Resolved Lighting (Diffuse + Specular)
2. 转换到 YCoCg 色彩空间 (更好的亮度/色度分离)
3. 写入 GroupShared Memory

4. 计算邻域统计 (5x5 kernel, 跳过角落):
   Mean = Sum(Neighbor) / Count
   Variance = Sum((Neighbor - Mean)^2) / Count
   StdDev = sqrt(Variance)

5. Reproject 历史:
   a. 使用 EncodedHistoryScreenCoord (Motion Vector)
   b. 双线性采样历史 Diffuse/Specular
   c. 深度/法线验证: 拒绝不一致的历史

6. Neighborhood Clamp:
   ClampedHistory = clamp(History, Mean - Scale*StdDev, Mean + Scale*StdDev)
   // Scale = NeighborhoodClampScale (默认 1.0)

7. 时间混合:
   Alpha = 1.0 / min(n, MaxFramesAccumulated)
   Output = lerp(ClampedHistory, Current, Alpha)

8. 更新 Moments (Mean^2 + Variance) 用于下一帧
9. 更新 NumFramesAccumulated:
   - 正常: +1 (最大 12)
   - History Miss: 重置到 MinFramesForHistoryMiss (4)
   - High Confidence: 限制到 MinFramesForHighConfidence (2)
```

**ShadingConfidence 机制**:
- 当像素采样充分 (所有光源都被采样到且可见性确定) 时, Confidence 高
- 高 Confidence 像素跳过降噪, 直接传递原始信号给 TSR
- 避免降噪器对已经干净的信号引入不必要的模糊

### 3.7 Pass 详解: Spatial Denoiser

**入口**: `MegaLightsDenoiserSpatial.usf` -> `DenoiserSpatialCS`

```
算法:
1. 加载中心像素: Lighting, Depth, Normal
2. 确定滤波强度:
   - 正常: KernelRadius = 8, NumSamples = 4
   - Disocclusion (AccumulatedFrames < MaxDisocclusionFrames):
     增大 KernelRadius 补偿时间信息不足

3. for (s = 0; s < NumSamples; ++s):
   a. 生成采样偏移 (Blue Noise + 旋转)
   b. 计算 Bilateral 权重:
      W_depth = exp(-|DepthDiff| * DepthWeightScale)  // 10000.0
      W_normal = max(0, dot(N_center, N_sample))^8
      W_distance = 1.0 / (1.0 + dist^2)
      W_total = W_depth * W_normal * W_distance
   c. 累加: WeightedSum += Sample * W_total

4. 输出: WeightedSum / TotalWeight
5. 加回 SceneColor (OutputColorTarget)
```

---

## 4. Volume 光照管线

### 4.1 Froxel Grid 结构

```
Grid 参数:
- XY: ViewSize / GridPixelSize (默认 8)
- Z: GridSizeZ (默认 128)
- 深度分布: 非线性 (DepthDistributionScale=32)
  -> 近处密集、远处稀疏

Z 参数计算 (MegaLights.cpp:1037-1042):
  ZParams = CalculateGridZParams(NearPlane, FarPlane, DistScale, GridSizeZ)
  // 指数分布: Depth = NearPlane * exp(z * log(FarPlane/NearPlane) / GridSizeZ)
```

### 4.2 Volume 采样流程

```
VolumeSampling -> VolumeRayTracing -> VolumeShading

1. GenerateVolumeLightSamplesCS:
   - 每体素 2 个采样 (可选 4)
   - 下采样 2x2x2 (默认)
   - HZB Occlusion Test: 跳过被遮挡体素
   - 同样使用 Reservoir Sampling 选择光源

2. VolumeRayTracing (HWRT/SWRT):
   - 从体素中心出发追踪
   - 与表面路径共享追踪基础设施

3. VolumeShading:
   - 相函数评估 (Henyey-Greenstein, PhaseG)
   - 输出到 3D Texture (VolumeResolvedLighting)
   - 供 VolumetricFog LightScattering 使用
```

### 4.3 Unified Volume 模式

`r.MegaLights.Volume.Unified=1` 时:
- Volumetric Fog 和 Translucency Volume 共享同一套采样/追踪结果
- 减少 Shader 编译变体和 GPU 切换开销
- 两者使用相同的 Froxel Grid 参数

---

## 5. 关键优化技术

### 5.1 Tile-Based Dispatch

- 屏幕划分为 8x8 Tile
- 按材质复杂度 + 光源类型分类
- 简单 Tile 用简单 Shader (更少 VGPR、更高占用率)
- 空 Tile 完全跳过
- Indirect Dispatch 避免 CPU 回读

### 5.2 降采样策略

| 模式 | 采样分辨率 | 追踪分辨率 | 重建 |
|------|-----------|-----------|------|
| 0 (Full) | 1:1 | 1:1 | 无需 |
| 1 (Checkerboard) | 2:1 | 2:1 | 棋盘格插值 |
| 2 (Half-res) | 2:2 | 2:2 | 双线性上采样 + 深度感知 |

降采样在 TileClassificationMark 阶段完成, 同时生成降采样的 Depth/Normal 供后续使用。

### 5.3 Wave Operations

`r.MegaLights.WaveOps=1` 启用:
- `WaveActiveCountBits`: 统计 Wave 内活跃线程
- `WaveReadLaneFirst`: 广播标量数据
- `WaveActiveBallot`: 快速投票
- 用于 Light Index Scalarization 和 MinimumOccupancy 提前终止

### 5.4 Blue Noise 时空分布

- 使用 `FBlueNoise` 统一缓冲区提供低差异随机序列
- `StateFrameIndex` 每帧递增, 驱动时间维度的采样偏移
- 结合分层采样 (Stratified): 每个 slot 的随机数在 [k/K, (k+1)/K) 范围内
- 效果: 相邻像素和相邻帧的采样模式互补, 加速时间累积收敛

### 5.5 History-Guided Sampling 收益分析

```
无引导 (GuideByHistory=0):
  所有光源等概率采样 -> 大量射线浪费在被遮挡光源上

光源级引导 (GuideByHistory=1):
  被遮挡光源降权 10x -> 可见光源获得更多射线
  问题: 面光源部分可见时仍然浪费

区域级引导 (GuideByHistory=2, 默认):
  面光源的 4 个象限独立追踪可见性
  被遮挡象限降权 4x -> 射线集中到可见区域
  代价: 额外 4-bit/光源/Tile 的历史存储
```

---

## 6. 与 TSR 的协作

MegaLights 的输出经过降噪后加入 SceneColor, 随后进入 TSR。两者的协作点:

1. **ShadingConfidence -> TSR**:
   - 高置信度像素: MegaLights 告诉 TSR "这个像素已经干净了"
   - TSR 对这些像素减少时间混合, 保留锐度

2. **Motion Vector 共享**:
   - MegaLights Temporal Denoiser 和 TSR 使用相同的 Motion Vector
   - 确保两者的 Reprojection 一致

3. **Reference Mode + TSR**:
   - 多 Pass 累积时, 每 Pass 使用不同的 StateFrameIndex
   - TSR 的时间累积进一步平滑残余噪声

---

## 7. 源码文件映射

| 渲染阶段 | C++ 源码 | Shader |
|----------|----------|--------|
| 入口/调度 | `MegaLights.cpp:1920` | - |
| Tile 分类 | `MegaLights.cpp:933` | `MegaLights.usf` |
| 光源采样 | `MegaLightsSampling.cpp:59` | `MegaLightsSampling.usf/.ush` |
| Screen Trace | `MegaLightsRayTracing.cpp:300` | `MegaLightsRayTracing.usf` |
| Hardware RT | `MegaLightsRayTracing.cpp:600` | `MegaLightsHardwareRayTracing.usf` |
| VSM Marking | `MegaLightsRayTracing.cpp:900` | `MegaLightsVSMMarking.usf` |
| VSM Tracing | `MegaLightsRayTracing.cpp:1000` | `MegaLightsVSMTracing.usf` |
| 着色解析 | `MegaLightsResolve.cpp:60` | `MegaLightsShading.usf/.ush` |
| 可见光 Hash | `MegaLightsResolve.cpp:400` | `MegaLightsVisibleLightHash.usf` |
| Hash 滤波 | `MegaLightsResolve.cpp:450` | `MegaLightsFilterVisibleLightHash.usf` |
| 时间降噪 | `MegaLightsDenoising.cpp:101` | `MegaLightsDenoiserTemporal.usf` |
| 空间降噪 | `MegaLightsDenoising.cpp:354` | `MegaLightsDenoiserSpatial.usf` |
| 体积采样 | `MegaLights.cpp:1400` | `MegaLightsVolumeSampling.usf` |
| 体积追踪 | `MegaLightsRayTracing.cpp:1200` | `MegaLightsVolumeRayTracing.usf` |
| 体积着色 | `MegaLights.cpp:1500` | `MegaLightsVolumeShading.usf` |

---

## 8. 数学附录

### 8.1 MIS 权重推导

对于 Reservoir Sampling 选出的样本 k, 其 PDF 为:

```
p(k) = w_k / Sum(w_i)
```

无偏估计量:

```
L_estimate = (1/K) * Sum_{k=1}^{K} [ L_k * V_k / p(k) ]
           = (1/K) * Sum_{k=1}^{K} [ L_k * V_k * Sum(w_i) / w_k ]
```

由于 `w_k ~ L_k` (PDF 近似目标分布), 理想情况下:

```
L_k / w_k ~ 1  (方差最小化)
```

实际中 `w_k = log2(L_k + 1)`, 所以:

```
MIS_Weight = L_k / w_k = L_k / log2(L_k + 1)
```

`MaxShadingWeight` 钳制防止 `w_k -> 0` 时权重爆炸 (firefly)。

### 8.2 Temporal Accumulation 收敛速度

指数移动平均:

```
Output_n = (1 - alpha) * Output_{n-1} + alpha * Sample_n
alpha = 1 / min(n, MaxFrames)
```

方差衰减: `Var(Output_n) ~ Var(Sample) / min(n, MaxFrames)`

MaxFramesAccumulated=12 时, 稳态方差 = 单帧方差 / 12, 约 -10.8 dB 噪声抑制。

### 8.3 Reservoir Sampling 正确性证明

对于流式 WRS, 在处理完第 i 个元素后, 元素 j (j <= i) 被选中的概率为:

```
P(j selected after i) = w_j / Sum_{m=1}^{i} w_m
```

证明 (归纳法):
- Base: i=1, P(1) = w_1/w_1 = 1 (正确)
- Step: 假设处理第 i 个元素前, P(j) = w_j / Sum_{m=1}^{i-1} w_m
  - 第 i 个元素替换概率: Tau_i = w_i / Sum_{m=1}^{i} w_m
  - j 保留概率: 1 - Tau_i = Sum_{m=1}^{i-1} w_m / Sum_{m=1}^{i} w_m
  - P(j after i) = P(j before) * (1 - Tau_i)
                 = (w_j / Sum_{1..i-1}) * (Sum_{1..i-1} / Sum_{1..i})
                 = w_j / Sum_{1..i}  (QED)

MegaLights 的实现通过随机数重归一化 (`Random /= Tau`) 实现等价效果, 避免了显式的概率比较。

---

*文档生成日期: 2026-05-27*