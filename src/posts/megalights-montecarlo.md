---
title: "MegaLights 蒙特卡洛估计"
cat: UE 剖析
sub: 渲染
date: 2026-05-27
mins: 12
tags: [MegaLights, 蒙特卡洛]
---

> 在大量光源场景中，通过 Reservoir Importance Sampling (RIS) 以极低开销选取少量光源，结合时域引导和光追验证，得到无偏的直接光照估计。

> 📖 **前置知识**：本文涉及 PDF、重要性采样、RIS、ReSTIR 等概念。如不熟悉，建议先阅读 [蒙特卡洛与重要性采样基础](/posts/montecarlo-importance-sampling/)。

---

## 1. 控制层级

### 运行时 CVar（MegaLightsSampling.cpp:8-41）

| CVar | 默认值 | 作用 |
|------|--------|------|
| `r.MegaLights.MinSampleClampingWeight` | 0.01 | 样本权重钳制下限 |
| `r.MegaLights.DirectionalLightSampleFraction` | 0.5 | 方向光最大采样占比 |
| `r.MegaLights.GuideByHistory.LightHiddenWeight` | 0.1 | 上帧被遮挡光源的 PDF 缩放 |
| `r.MegaLights.GuideByHistory.LightHiddenWeightForHistoryMiss` | 0.4 | 无有效历史时被遮挡光源的 PDF 缩放 |
| `r.MegaLights.GuideByHistory.AreaLightHiddenWeight` | 0.25 | 面光源被遮挡区域的 PDF 缩放 |

### 方向光采样比率计算（MegaLightsSampling.cpp:45-56）

```cpp
float GetDirectionalLightSampleRatio()
{
    float Fraction = CVarMegaLightsDirectionalLightSampleFraction.GetValueOnRenderThread();
    if (Fraction < 1.0f)
        return Fraction / (1.0f - Fraction);
    else
        return 0.0f;  // 禁用钳制
}
```

---

## 2. 整体流程

```
┌─────────────────────────────────────────────────────────────────┐
│                     MegaLights Pipeline                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ① 构建目标 PDF        ② RIS 采样选光       ③ 光追验证可见性    │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
│  │ 遍历所有光源  │ ──→ │ Reservoir    │ ──→ │ Shadow Ray   │    │
│  │ 计算 log2(L+1)│     │ 保留 k 个样本│     │ 验证遮挡     │    │
│  └──────────────┘     └──────────────┘     └──────────────┘    │
│                                                    │             │
│  ⑤ 降噪输出            ④ 加权着色                  │             │
│  ┌──────────────┐     ┌──────────────┐            │             │
│  │ 置信度驱动    │ ←── │ 1/PDF 无偏加权│ ←──────────┘             │
│  │ 空间滤波      │     │ BRDF 评估    │                          │
│  └──────────────┘     └──────────────┘                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 目标 PDF 构建

### 核心思想

对每个光源计算其对当前像素的"重要性"，作为 RIS 的采样权重。权重越高的光源越可能被选中。

**注意：权重不是光源本身的亮度，而是该光源对当前像素的完整无阴影光照贡献。** 每个像素的 PDF 分布都不同。

### 权重的实际组成

$$
w_i = \log_2\!\Big(\underbrace{f_r(\mathbf{x}, \omega_i) \cdot L_i \cdot G(\mathbf{x}, \omega_i)}_{\text{无阴影光照贡献}} \cdot \text{PreExposure} + 1\Big)
$$

`GetMegaLightsSplitLighting()` 计算的 `Lum` 包含以下所有因素：

| 因素 | 说明 | 为什么需要 |
|------|------|-----------|
| 光源强度 | Intensity × Color | 基础亮度 |
| 距离衰减 | $1/r^2$ 或自定义曲线 | 远处光源贡献小 |
| 角度衰减 | Spot light cone falloff | 锥形边缘贡献小 |
| BRDF 响应 | 当前像素材质对该光源方向的反射率 | 背对光源的面贡献为 0 |
| IES 光域网 | `ComputeLightProfileMultiplier(...)` | 光域网暗区贡献小 |
| 曝光补偿 | `View.PreExposure` | 统一到感知空间 |

**唯一没包含的是阴影（Visibility）**—— 因为阴影需要光追验证，正是采样要确定的东西。

### 为什么不能只用光源亮度？

```
场景：一个 10000 lux 的点光源在你背后，一个 100 lux 的点光源正对你的镜面法线

如果只按光源亮度采样：
  10000 lux 光源被选中概率 ≈ 99%
  但它在你背后 → BRDF = 0 → 实际贡献 = 0 → 浪费采样！

按完整贡献采样：
  背后光源：Lum = 10000 × (1/r²) × cos(θ) × BRDF ≈ 0（cos > 90°）
  正面光源：Lum = 100 × (1/r²) × cos(θ) × BRDF = 很大（镜面高光）
  → 正面光源被优先采样 ✓
```

所以采样阶段必须读 GBuffer（法线、粗糙度、位置）来评估 BRDF，才能做出正确的采样决策。

### 实现（MegaLightsSampling.usf:65-112）

```hlsl
struct FLightTargetPDF
{
    float Weight;
};

FLightTargetPDF GetLocalLightTargetPDF(
    FDeferredLightData LightData, 
    float3 TranslatedWorldPosition, 
    FMegaLightsMaterial Material, 
    uint2 ScreenCoord, 
    inout FShaderPrintContext DebugContext)
{
    float3 CameraVector = normalize(TranslatedWorldPosition - View.TranslatedWorldCameraOrigin);
    
    // 计算完整的光照贡献（含衰减、BRDF）
    FDeferredLightingSplit SplitLighting = GetMegaLightsSplitLighting(
        TranslatedWorldPosition, CameraVector, Material, AmbientOcclusion, 
        LightData, LightAttenuation, Dither, ScreenCoord, SurfaceShadow);

    float Lum = SplitLighting.LightingLuminance * View.PreExposure;

    // IES 光域网修正
    if (LightData.IESAtlasIndex >= 0 && Lum > 0.01f)
    {
        Lum *= ComputeLightProfileMultiplier(...);
    }

    // log 空间权重 —— 模拟 tonemapping 后的感知重要性
    FLightTargetPDF LightTargetPDF = InitLightTargetPDF();
    LightTargetPDF.Weight = log2(Lum + 1.0f);
    return LightTargetPDF;
}
```

### 为什么用 log2(L+1)？

| 方案 | 问题 |
|------|------|
| 直接用亮度 L | 极亮光源（如太阳）会垄断所有样本 |
| 用 L^0.5 | 仍然偏向高亮度 |
| **log2(L+1)** | 压缩动态范围，接近人眼感知，各光源获得更均匀的采样机会 |

---

## 4. Reservoir Importance Sampling (RIS)

### 数据结构（MegaLightsSampling.ush:47-52）

```hlsl
struct FLightSampler
{
    uint PackedSamples[NUM_SAMPLES_1D];   // 压缩存储的候选样本
    float LightIndexRandom[NUM_SAMPLES_1D]; // 每个槽位的随机数（用于决定替换）
    float WeightSum;                       // 已遍历候选的权重总和
};
```

### RIS 核心算法（MegaLightsSampling.ush:84-115）

```hlsl
void AddLightSample(inout FLightSampler LightSampler, float SampleWeight, 
                    uint ForwardLightIndex, bool bWasVisibleInLastFrame, bool bRadialLight)
{
    // 防止方向光独占采样预算
    if (!bRadialLight && DirectionalLightSampleRatio > 0.0f)
    {
        SampleWeight = min(SampleWeight, 
            max(LightSampler.WeightSum, MinSampleClampingWeight) * DirectionalLightSampleRatio);
    }

    // τ = 保留旧样本的概率
    float Tau = LightSampler.WeightSum / (LightSampler.WeightSum + SampleWeight);
    LightSampler.WeightSum += SampleWeight;

    for (uint LightSampleIndex = 0; LightSampleIndex < NUM_SAMPLES_1D; ++LightSampleIndex)
    {
        if (LightSampler.LightIndexRandom[LightSampleIndex] < Tau)
        {
            // 保留旧样本：重新缩放随机数到 [0, Tau) → [0, 1)
            LightSampler.LightIndexRandom[LightSampleIndex] /= Tau;
        }
        else
        {
            // 替换为新样本：重新缩放随机数到 [Tau, 1) → [0, 1)
            LightSampler.LightIndexRandom[LightSampleIndex] = 
                (LightSampler.LightIndexRandom[LightSampleIndex] - Tau) / (1.0f - Tau);

            FCandidateLightSample LightSample = InitCandidateLightSample();
            LightSample.LocalLightIndex = ForwardLightIndex;
            LightSample.bLightWasVisible = bWasVisibleInLastFrame;
            LightSample.Weight = SampleWeight;
            LightSampler.PackedSamples[LightSampleIndex] = PackCandidateLightSample(LightSample);
        }
        LightSampler.LightIndexRandom[LightSampleIndex] = clamp(..., 0, 0.9999f);
    }
}
```

### 算法解析

$$
\tau = \frac{W}{W + w} \quad \text{（保留旧样本概率）}, \quad 1 - \tau = \frac{w}{W + w} \quad \text{（选择新样本概率）}
$$

- 每个候选被最终选中的概率 $\propto$ 其权重
- 单次遍历，$O(1)$ 空间保留 $k$ 个样本
- 无偏性由概率比例保证

**随机数重用技巧**：每个样本槽位使用同一个随机数，通过 rescaling 在每次决策后将其映射回 [0,1)，避免为每个候选生成新随机数。

---

## 5. 时域引导（类 ReSTIR）

### 可见性历史查询（MegaLightsSampling.usf:211-222）

```hlsl
bool bWasVisibleInLastFrame = true;

#if GUIDE_BY_HISTORY
    if (LightTargetPDF.Weight > MinSampleWeight && PrevForwardLightIndex >= 0)
    {
        // 查询上帧该光源对当前像素是否可见
        bWasVisibleInLastFrame = GetLightVisibility(VisibleLightHash, PrevForwardLightIndex);
    }
    else
    {
        bWasVisibleInLastFrame = false;
    }
#endif
```

### 权重调整

```hlsl
if (LightTargetPDF.Weight > MinSampleWeight)
{
    if (!bWasVisibleInLastFrame)
    {
        // 被遮挡的光源降低采样权重，但不完全排除
        LightTargetPDF.Weight *= bHasValidHistory 
            ? LightHiddenPDFWeight           // 0.1：有历史，高置信度降权
            : LightHiddenPDFWeightForHistoryMiss;  // 0.4：无历史，保守降权
    }
    AddLightSample(LightSampler, LightTargetPDF.Weight, ...);
}
```

### 设计权衡

```
完全排除被遮挡光源（Weight = 0）
  ✗ 动态场景中光源突然可见时会产生明显 pop-in
  ✗ 引入偏差

保留但降权（Weight *= 0.1）
  ✓ 仍有概率被采样，保证无偏性
  ✓ 动态场景过渡平滑
  ✓ 大部分采样预算仍分配给可见光源
```

---

## 6. 无偏估计器的最终权重

### 蒙特卡洛估计公式

对于 RIS 选出的样本，最终的直接光照估计为：

$$
L_d \approx \frac{1}{N}\sum_{i=1}^{N}\frac{f(x_i) \cdot V(x_i)}{p(x_i)}
$$

其中：
- $f(x_i)$ = BRDF × 光照强度 × 几何项
- $V(x_i)$ = 可见性（光追结果，0 或 1）
- $p(x_i)$ = 该光源被 RIS 选中的概率 $\propto$ Weight
- $N$ = 每像素样本数 (NUM_SAMPLES_PER_PIXEL_1D)

### 逆 PDF 权重（MegaLightsShading.usf:91-94）

```hlsl
float GetLightSampleWeightRatio(FLightSample LightSample)
{
    // 1/p(x) —— 无偏估计的关键
    return LightSample.bGuidedAsVisible ? 1.0f / LightSample.Weight : 0.0f;
}
```

### 样本累积（MegaLightsShading.usf:108-145）

```hlsl
void AccumulateLightSample(uint PackedLightSamples[NUM_SAMPLES_PER_PIXEL_1D], 
    uint LocalLightIndex, inout uint NextLocalLightIndex, 
    inout float SampleWeightSum, inout float WeightRatioSum, 
    inout uint ValidSampleMask, ...)
{
    uint NumMergedSamples = 1;

    for (uint SampleIndex = 0; SampleIndex < NUM_SAMPLES_PER_PIXEL_1D; ++SampleIndex)
    {
        FLightSample LightSample = UnpackLightSample(PackedLightSamples[SampleIndex]);

        if (LightSample.LocalLightIndex == LocalLightIndex)
        {
            if (LightSample.Weight == 0.0f)
            {
                ++NumMergedSamples;  // 相同光线合并计数
            }
            else
            {
                if (LightSample.bVisible)
                {
                    // 可见：累积权重和置信度
                    SampleWeightSum += LightSample.Weight * NumMergedSamples;
                    WeightRatioSum += GetLightSampleWeightRatio(LightSample) * NumMergedSamples;
                    ValidSampleMask |= 1u << SampleIndex;
                    NumMergedSamples = 1;
                }
                else
                {
                    // 不可见：降低置信度
                    WeightRatioSum -= GetLightSampleWeightRatio(LightSample) * NumMergedSamples;
                }
            }
        }
    }
}
```

### 最终归一化（MegaLightsShading.usf:273-280, 375-376）

```hlsl
// 按样本数归一化
SampleWeight /= float(NUM_SAMPLES_PER_PIXEL_1D);
SampleWeight = min(SampleWeight, MaxShadingWeight);  // 钳制防止极端值

WeightRatioSum /= float(NUM_SAMPLES_PER_PIXEL_1D);  // 置信度也归一化
```

---

## 7. 体积光照的蒙特卡洛估计

### 差异（MegaLightsVolumeSampling.usf）

体积采样与表面采样使用相同的 RIS 框架，但有几个关键差异：

| 维度 | 表面采样 | 体积采样 |
|------|---------|---------|
| 坐标系 | 2D 屏幕空间 | 3D 体素空间 |
| 样本数 | NUM_SAMPLES_PER_PIXEL | NUM_SAMPLES_PER_VOXEL |
| 权重来源 | BRDF × 光照 | 散射 × 光照 |
| 最终权重 | `1.0 / Weight` | `WeightSum / (N × Weight)` |

### 体积无偏权重（MegaLightsVolumeSampling.usf:374-376）

```hlsl
// 体积中的最终权重计算
LightSample.Weight = LightSampler.WeightSum / (NUM_SAMPLES_PER_VOXEL_1D * LightSample.Weight);
```

这等价于 $\frac{W_{\text{sum}}}{N} \times \frac{1}{w_{\text{candidate}}}$，其中：
- $W_{\text{sum}} / N$ = 所有候选的平均权重（归一化常数）
- $1 / w_{\text{candidate}}$ = 逆 PDF

---

## 8. 置信度与降噪

### WeightRatioSum 的双重角色

`WeightRatioSum` 不仅参与无偏估计，还作为置信度信号传递给降噪器：

```
WeightRatioSum 高 → 样本质量好（多数可见）→ 降噪器信任像素本身
WeightRatioSum 低 → 样本质量差（多数被遮挡）→ 降噪器依赖邻域
WeightRatioSum 负 → 遮挡严重 → 降噪器几乎完全依赖空间滤波
```

### 遮挡对置信度的影响

```hlsl
if (LightSample.bVisible)
    WeightRatioSum += 1.0/Weight * NumMergedSamples;  // 可见：增加置信度
else
    WeightRatioSum -= 1.0/Weight * NumMergedSamples;  // 不可见：降低置信度
```

这个设计让降噪器在阴影边缘（样本可见性不确定的区域）自动增加滤波强度，减少噪点。

---

## 9. 性能特征

### 复杂度分析

| 阶段 | 复杂度 | 说明 |
|------|--------|------|
| PDF 构建 + RIS | O(L) per pixel | L = 光源数，单次遍历 |
| 光追验证 | O(k) rays per pixel | k = 样本数（2-4） |
| 着色加权 | O(k) per pixel | 简单累加 |
| **总计** | O(L + k) | 远优于朴素的 O(L×raycast) |

### 样本数 vs 质量

```
NUM_SAMPLES_PER_PIXEL = 1  → 噪点高，适合配合强降噪
NUM_SAMPLES_PER_PIXEL = 2  → 默认配置，平衡点
NUM_SAMPLES_PER_PIXEL = 4  → 高质量，2x 光追开销
```

---

## 10. 使用建议

### 调参指南

| 场景 | 建议 |
|------|------|
| 光源数量 < 10 | MegaLights 收益有限，可考虑传统阴影 |
| 光源数量 > 50 | MegaLights 核心优势区间 |
| 动态场景（光源频繁出入视野）| 适当提高 `LightHiddenPDFWeight`（如 0.2-0.3） |
| 阴影边缘闪烁 | 增加样本数或调强降噪 |
| 方向光过度主导 | 降低 `DirectionalLightSampleFraction` |

### 核心原理总结

```
┌────────────────────────────────────────────────────────┐
│              MegaLights 蒙特卡洛估计核心               │
├────────────────────────────────────────────────────────┤
│                                                        │
│  问题：N 个光源，不能全部计算                          │
│                                                        │
│  解法：                                                │
│  1. 为每个光源算重要性权重 w_i = log2(L_i + 1)        │
│  2. RIS 以概率 ∝ w_i 选 k 个样本（k << N）           │
│  3. 光追验证选中光源的可见性                           │
│  4. 用 1/p(x_i) 加权得到无偏结果                      │
│                                                        │
│  关键保证：                                            │
│  • 无偏性：E[估计] = 真实值（概率论保证）              │
│  • 效率：O(N+k) vs O(N×raycast)                       │
│  • 稳定性：时域引导 + 降噪                            │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 源码文件索引

| 文件 | 职责 |
|------|------|
| `Engine/Shaders/Private/MegaLights/MegaLightsSampling.ush` | RIS 数据结构与核心算法 |
| `Engine/Shaders/Private/MegaLights/MegaLightsSampling.usf` | 目标 PDF 构建、光源遍历、时域引导 |
| `Engine/Shaders/Private/MegaLights/MegaLightsShading.usf` | 无偏加权、样本累积、置信度计算 |
| `Engine/Shaders/Private/MegaLights/MegaLightsVolumeSampling.usf` | 体积光照的蒙特卡洛采样 |
| `Engine/Source/Runtime/Renderer/Private/MegaLights/MegaLightsSampling.cpp` | CVar 定义、参数传递 |
| `Engine/Source/Runtime/Renderer/Private/MegaLights/MegaLightsRayTracing.cpp` | 光追 Pass 调度 |
| `Engine/Source/Runtime/Renderer/Private/MegaLights/MegaLightsDenoising.cpp` | 降噪 Pass |

---

## 更新日志

| 日期 | 内容 |
|------|------|
| 2026-05-27 | 初始版本：RIS 采样、时域引导、无偏估计、体积采样 |