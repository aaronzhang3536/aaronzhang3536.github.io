---
title: "MegaLights 完整逻辑"
cat: UE 剖析
date: 2026-06-10
mins: 20
tags: [MegaLights, 光照]
---

> MegaLights 是 UE5 的随机采样直接光照系统。核心思想是把"对每盏灯独立计算"的传统模型，转换为"每像素从所有灯中随机抽几盏来追踪"，让 GPU 开销与灯光数量解耦。

基于 UE 5.7.3 源码（`D:\WorkSpace\UnrealEngine`，`release` 分支）。

---

## 1. 核心思想

### 与传统 Deferred Lighting 的开销对比

**传统 Deferred**：每盏带阴影的灯都要渲染一张 Shadow Map + 一次 Light Pass。N 盏灯 ≈ O(N) 开销。

**MegaLights**：每像素只采样固定数量的灯（默认 4 盏），无论场景里有多少灯，每像素的射线数恒定。N 盏灯 ≈ O(1) 开销。

代价：灯光太多时**质量下降**（噪点增加），而非帧率下降。在上百盏阴影灯的场景中这个权衡通常成立——传统路径在那个量级已经不可行。

### 三个技术支点

1. **加权水库采样（Weighted Reservoir Sampling）**：从 Light Grid 候选灯中按"无阴影亮度贡献"的权重选 N 盏
2. **射线引导（帧间反馈）**：用上帧的可见性 hash 调整本帧采样权重，避免浪费射线在被遮挡的灯上
3. **时空降噪**：从稀疏随机结果重建平滑光照

---

## 2. 完整时序

MegaLights 不是一个连续的代码块——它被切成两段穿插在帧渲染中，中间夹着 VSM 的渲染：

```
帧渲染流程（DeferredShadingRenderer.cpp 中的实际位置）:

  ① GenerateMegaLightsSamples()                    [行 3129]
       ├─ Setup
       │   ├─ TileClassificationMark(0)            ← Pass 0 的分类在 Setup 里
       │   └─ BuildLists                           ← 生成各 Tile 类型的 dispatch 列表
       ├─ GenerateSamples(0)                       ← 每像素选 N 盏灯，生成射线参数
       └─ MarkVSMPages                             ← 告诉 VSM 需要哪些页

  ② RenderShadowDepthMaps()                        [行 3139]
       └─ ShadowSceneRenderer->RenderVirtualShadowMaps()
            └─ Nanite 光栅化被标记的脏页 → 写入物理页池

  ③ RenderMegaLights()                             [行 3327]
       └─ RenderMegaLightsViewContext()
            for ShadingPassIndex in [0, ReferencePassCount):
                if (ShadingPassIndex > 0):
                    TileClassificationMark(N)      ← Reference 模式后续 pass 重做
                    GenerateSamples(N)
                RayTrace                            ← VSM 页已渲染好，可查询
                Resolve
            DenoiseLighting
```

**为什么必须切两段**：`MarkVSMPages` 输出的"需要哪些页"是 VSM 渲染的输入。如果 Sampling 不提前完成，VSM 不知道该渲染哪些页；如果 RayTrace 不延后，VSM Trace 就查不到深度数据。

源码注释（DeferredShadingRenderer.cpp:3124）：

```
// Do MegaLights sampling before VSM pages are marked and rendered so they can be specialized
// based on the selected samples.
```

---

## 3. TileClassificationMark 阶段

### 目的

按材质复杂度和光源类型给 8×8 像素 Tile 分桶，让后续 Sampling/Resolve 可以分类型 dispatch 不同的 shader permutation——避免 wave 内分支发散。

### Tile 类型 Bitmask

```cpp
#define MEGALIGHTS_TILE_BITMASK_SIMPLE              0x01  // Lambertian + GGX
#define MEGALIGHTS_TILE_BITMASK_SINGLE              0x02  // Substrate 单层
#define MEGALIGHTS_TILE_BITMASK_COMPLEX             0x04  // 各向异性/Clearcoat/Cloth
#define MEGALIGHTS_TILE_BITMASK_COMPLEX_SPECIAL     0x08  // 更特殊的复杂材质
#define MEGALIGHTS_TILE_BITMASK_RECT_LIGHT          0x10  // 有矩形光影响
#define MEGALIGHTS_TILE_BITMASK_TEXTURED_RECT_LIGHT 0x20  // 有纹理矩形光
```

### Mark 阶段流程

扫描 Tile 中每个像素，把像素材质类型和影响该像素的光源类型 OR 到 bitmask 中：

```
TileBitmask = 0
for pixel in 8x8 tile:
    if pixel uses Complex BSDF:    TileBitmask |= COMPLEX
    if pixel covered by RectLight: TileBitmask |= RECT_LIGHT
    ...
```

输出：`MegaLights.TileBitmask` 纹理（每 Tile 一个 uint8）。

### BuildLists 阶段（紧随其后）

把 Tile 按类型分类到不同的列表，并生成 Indirect Dispatch 参数。判定优先级**从高到低取最复杂的**：

```hlsl
if      (bitmask & COMPLEX_SPECIAL)  → ComplexSpecial shader
else if (bitmask & COMPLEX)          → Complex shader
else if (bitmask & SINGLE)           → Single shader
else if (bitmask & SIMPLE)           → Simple shader
```

光源类型同理：有一个像素被 Textured Rect 影响，整个 Tile 走 Textured Rect 变体。

### 多种材质的处理

8×8 Tile 中如果有 Simple + Complex 像素混合，整个 Tile 走 Complex shader——Complex 是 Simple 的超集，能正确处理两种像素，代价是 Simple 像素多花一点指令。这个粒度让 GPU wave（32-64 线程）保持指令一致性，避免 divergence。

### 附带工作

`ShadingPassIndex == 0` 时还顺便做：
- 拷贝深度/法线到历史缓冲（供时域降噪）
- 降采样深度/法线（2×1 或 2×2，供 GenerateSamples 使用）
- 历史重投影坐标（供 Ray Guiding 读取上帧 hash）

### 普通 vs Reference 模式

- 普通模式：仅 `Setup` 中调用一次 `TileClassificationMark(0)`
- Reference 模式：每个 ShadingPassIndex > 0 的 pass 都重新调用，因为不同 pass 用不同 `StateFrameIndex`，stochastic jitter 不同

源码：`MegaLights.cpp:1163` `FMegaLightsViewContext::TileClassificationMark()`

---

## 4. GenerateSamples 阶段

### 目的

为每像素从所有候选灯中**用加权水库采样选出 N 盏灯**，并生成对应的阴影射线参数（方向、距离、面积光 UV）。

### 输入

- 来自 BuildLists 的 Tile 列表 + Indirect Args
- GBuffer（材质、法线、深度）
- Light Grid（空间剔除后的候选灯列表）
- `VisibleLightHashHistory`（上帧 Ray Guiding 历史）
- Blue Noise 纹理

### 详细步骤

#### Step 1：准备 per-pixel 数据

```hlsl
const FMegaLightsMaterial Material = LoadMaterial(ScreenUV, ScreenCoord);
float3 TranslatedWorldPosition = GetTranslatedWorldPositionFromScreenUV(...);
const uint GridIndex = ComputeLightGridCellIndex(ScreenCoord, SceneDepth);
```

通过 Light Grid 找到当前像素所属的 cell，获取候选灯光列表。

#### Step 2：初始化 LightSampler

普通模式用 Blue Noise 分层初始化：

```hlsl
const float RandomScalar = BlueNoiseScalar(DownsampledScreenCoord, FrameIndex);
FLightSampler LightSampler = InitLightSamplerStratified(RandomScalar);
// 每个 slot 的初始随机值 = (Noise + slotIndex) / N
```

Reference 模式用纯随机序列：

```hlsl
InitLightSamplerFromSequence(LightSampler, ScreenCoord, FrameIndex);
```

#### Step 3：遍历候选灯，调用 SampleLight

对 cell 中每盏灯：

**1. 计算 Target PDF**（`GetLocalLightTargetPDF`）：

无阴影地完整算一遍 Deferred Lighting，得到该灯对当前像素的亮度估计：

```hlsl
FDeferredLightingSplit Lighting = GetMegaLightsSplitLighting(...);
float Lum = Lighting.LightingLuminance * View.PreExposure;
LightTargetPDF.Weight = log2(Lum + 1.0f);  // tone mapping 压缩
```

**2. 历史引导降权**：

```hlsl
if (上帧不可见)
    LightTargetPDF.Weight *= 0.1;  // LightHiddenPDFWeight
```

**3. 加权水库采样**（`AddLightSample`）：

```hlsl
float Tau = WeightSum / (WeightSum + SampleWeight);
WeightSum += SampleWeight;
for each slot:
    if (random < Tau) → 保持当前选择，random /= Tau
    else              → 替换为这盏灯，random = (random - Tau) / (1 - Tau)
```

经典单遍加权水库采样：每个槽位最终被选中的概率正比于其权重，且只需一次遍历。

#### Step 4：方向光特殊处理

```hlsl
for (Index in DirectionalLights)
    SampleDirectionalLight(...);  // 方向光权重上限 = WeightSum * 0.5
```

防止太阳光霸占所有采样槽位。

#### Step 5：最终化每个 Sample

对 N 个选中的灯：

- **面积光**：用 Blue Noise 在灯光表面上选 UV 采样点；如果上帧记录了 2×2 区域可见性 mask，把 UV 概率分布 warp 到可见象限
- **非面积光**：相邻 slot 选了同一盏灯则合并（跳过重复射线）
- 计算最终权重：`Weight = WeightSum / SampleWeight`（重要性采样修正）
- 不投阴影的灯标记 `bCompleted = true`（跳过后续 RayTrace）
- 写入两张纹理：
  - `LightSamples`：灯光索引 + 权重 + bVisible 初始 true
  - `LightSampleRays`：射线 UV + bCompleted + bHair 等标志

### 重要：Sampling 不发射射线

Sampling 阶段只做数学运算（亮度估计、采样、权重计算），**没有任何射线追踪**。射线参数只是数据，等待 RayTrace 阶段去实际追踪。

### HairStrands 特殊处理

```hlsl
#if INPUT_TYPE == INPUT_TYPE_HAIRSTRANDS || USE_HAIR_COMPLEX_TRANSMITTANCE
    LightData.HairTransmittance = EvaluateDualScattering(...);
#endif

#define HAIR_BSDF_BACKLIT 0  // 关闭 backlit 避免 TT term 假阳性
```

毛发的 R/TT/TRT 多散射 lobe 在采样阶段考虑透射估计，但禁用 backlit（TT 项很强但通常被身体几何挡住，会浪费采样）。

源码：`MegaLightsSampling.cpp:310` `FMegaLightsViewContext::GenerateSamples()`
Shader：`MegaLightsSampling.usf` `GenerateLightSamplesCS`

---

## 5. MarkVSMPages 阶段

### 目的

告诉 VSM 子系统"哪些物理页需要被渲染"，让 VSM 只光栅化 MegaLights 实际需要查询的页。

### 为什么在 Sampling 之后、RayTrace 之前

VSM 的物理页池有限（默认 2048 页），不会预渲染所有灯的所有页。只有被标记为 Requested 的页才会被 Nanite 光栅化写入深度。

时序依赖：
```
GenerateSamples → 知道每像素选了哪盏灯
MarkVSMPages   → 根据选中的灯标记 VSM 页
VSM 渲染       → Nanite 光栅化填充被标记的页
RayTrace       → VSM Trace 查询已填充的页
```

如果标记放在 RayTrace 里，VSM 页还没被渲染，查不到深度数据。

### 流程

```
CompactMegaLightsTraces()
    → 只保留 bCompleted=false 的射线（需要阴影查询的）

VirtualShadowMapMarkLightSamplesCS（每条射线一个线程）:
    1. 从 LightSample 取出 LocalLightIndex
    2. 查 ForwardLightData.VirtualShadowMapId → 找到对应 VSM
    3. 从 DownsampledSceneDepth 恢复像素世界坐标
    4. 方向光 → MarkPageDirectional(VsmHandle, WorldPos)
       局部光 → MarkPageLocal(LightData, VsmHandle, WorldPos, Depth)
```

### 效果

- 传统 VSM 标记：100 盏灯 × 所有可见像素 → 大量页被渲染
- MegaLights 标记：4 盏灯/像素 × 可见像素 → 极少页被渲染

CVar：`r.MegaLights.VSM.MarkPages`（默认 1，精确标记；0 退回保守标记所有页）

### 标记之后：VSM 渲染填充深度

MarkVSMPages 只是"提需求"——标记完之后，物理页里还没有深度数据。真正的渲染发生在帧的下一个阶段：

```
[行 3129] GenerateMegaLightsSamples()
            ├─ GenerateSamples()          ← 选灯
            └─ MarkVSMPages()             ← 标记需要的页（仅标记，页内无数据）

[行 3139] RenderShadowDepthMaps()
            └─ ShadowSceneRenderer->RenderVirtualShadowMaps()
                  └─ Nanite 光栅化 dispatch
                       ├─ 为每个被标记的页生成 Packed View（灯光视角）
                       ├─ 单次 dispatch 同时处理所有页的 culling + 光栅化
                       ├─ Depth-only 模式写入物理页池纹理
                       └─ 静态页缓存复用，仅脏页重新渲染
                       ↓
                  物理页池纹理被填充深度数据

[行 3327] RenderMegaLights()
            └─ RayTrace()
                  └─ VSM Trace             ← 把像素投影到灯的 VSM 空间，
                                              查物理页中的深度做比较，
                                              d_pixel > d_shadowmap → 被遮挡
```

Nanite 光栅化时，每个物理页对应一个从灯光视角看场景的 view。多个页打包成一组 Packed Views，在单次 GPU dispatch 中完成实例剔除 → 集群剔除 → 三角形光栅化，输出结果直接写入物理页池的对应位置。LOD 选择独立于主相机——由 VSM 虚拟纹理的 texel 覆盖面积决定，高分辨率页用精细集群，低分辨率页用粗糙集群。

已渲染且场景未变化的页下一帧直接复用（帧间缓存），只有动态物体移动导致的脏页才需要重新渲染。

源码：`MegaLights.cpp:1777` `FMegaLightsViewContext::MarkVSMPages()`
Shader：`MegaLightsVSMMarking.usf`

---

## 6. RayTrace 阶段

### 目的

对每条已生成的阴影射线（表面 → 灯光）做遮挡测试，输出 `bVisible` 标志。**只判定可见性，不计算光照**。

### 多级追踪管线

```
RayTraceLightSamples()
│
├─ ① VSM Trace（如果 VSM 模式）
│     查 Virtual Shadow Map 深度页
│
├─ ② Screen Space Trace（屏幕空间追踪）
│     用 HZB 在屏幕空间步进
│
├─ ③ World Space Trace（世界空间追踪）
│     ├─ Hardware RT（DXR vs TLAS）
│     └─ Software RT（Global SDF 球步进）
│
├─ ④ Hair Voxel Trace（可选，毛发遮挡）
│
└─ ⑤ Distant Screen Trace（远距线性屏幕追踪）
```

### Compact + 逐级消解

每级追踪之前都有一次 `CompactMegaLightsTraces`，剔除 `bCompleted = true` 的射线，只对剩余射线发起更贵的下一级追踪：

```
N 条射线
   ↓ Compact
N1 条射线 → VSM Trace → 部分命中（bCompleted=true）
   ↓ Compact
N2 条射线 → Screen Trace → 部分命中
   ↓ Compact
N3 条射线 → World Space Trace（HW/SW RT）→ 最终判定
```

实际中大部分射线在前两级廉价方法中就解决了，只有少量进入硬件光追。

### 各级追踪特点

| 方法 | 开销 | 精度 | 适用 |
|---|---|---|---|
| VSM Trace | 极低 | VSM 页分辨率 | 仅 VSM 模式灯光 |
| Screen Space Trace | 低 | 屏幕内可见几何 | 短距离 |
| Hardware RT | 高 | 三角形精度 | 全场景 |
| Software RT (SDF) | 中 | 体素精度（3-40cm） | 全场景，无 HWRT 时 |

### Hardware RT 的两种模式

- **Inline（Compute Shader + RayQuery）**：内联发射射线，无 RayGen/Closest/AnyHit 切换，更高效但不支持材质 alpha test
- **RayGen（传统 DXR 管线）**：支持 Any-Hit Shader 处理 alpha mask 材质，dispatch 开销更大

```cpp
if (UseInlineHardwareRayTracing() && !EvaluateMaterials)
    → Inline Compute Shader
else
    → RayGen Pipeline
```

### Software RT（Global SDF）原理

不用 BVH，用**距离场球步进**：

```
当前位置 → 查询 SDF → 得到"离最近表面的距离 d"
        → 沿射线前进 d（保证不穿过几何）
        → 重复直到命中（d < 阈值）或 miss
```

Global SDF 用 4 级 Clipmap，跟随相机移动：
- Clipmap 0（最近）~100m，体素 ~3-5cm
- Clipmap 3（最远）~800m+，体素 ~40cm+
- 稀疏存储（page table + 3D 纹理 atlas）

### 关键术语

- **TLAS**（Top-Level Acceleration Structure）：DXR 顶层 BVH，存所有实例的包围盒，每帧重建
- **BLAS**（Bottom-Level Acceleration Structure）：单网格的三角形 BVH，构建一次实例共享
- **AHS**（Any-Hit Shader）：DXR 中可选的命中确认 shader，用于 alpha mask 材质判定

### 输出

只修改 `LightSample.bVisible`：任一级追踪命中遮挡物 → false，否则保持 true。
不计算光照贡献。

源码：`MegaLightsRayTracing.cpp:1428` `MegaLights::RayTraceLightSamples()`
Shader：`MegaLightsRayTracing.usf`、`MegaLightsHardwareRayTracing.usf`、`MegaLightsVSMTracing.usf`

---

## 7. Resolve 阶段

### 目的

对每个可见的采样（`bVisible == true`），计算完整的 BRDF 光照着色，累积到帧缓冲。同时更新 Visible Light Hash 供下帧 Ray Guiding 使用。

### 着色逻辑

```hlsl
for each pixel:
    for each sample (N 盏灯):
        if (!bVisible) continue;  // 被遮挡，贡献为 0
        
        // 完整 Deferred Lighting 计算
        lighting = EvaluateBRDF(Material, LightData) * LightSample.Weight;
        
        DiffuseLighting  += lighting.Diffuse;
        SpecularLighting += lighting.Specular;
```

Weight 是重要性采样修正值：`WeightSum / SampleWeight`，确保蒙特卡洛估计无偏。

### 按 Tile 类型分派

利用 TileClassification 阶段的结果，不同 Tile 类型走不同的 shader permutation：

- **SimpleShading**：Lambertian + GGX（最快）
- **ComplexShading**：各向异性、Clearcoat、Cloth、Substrate
- **Rect / Rect_Textured**：矩形光、IES/纹理矩形光（需要额外采样）

### Visible Light Hash 更新

每个可见采样在此步骤把灯光 ID 写入 **VisibleLightHash**（128-bit bloom filter per 8×8 tile）：

```hlsl
if (bVisible)
{
    uint BitIndex = PCGHash(LocalLightIndex) >> 16 % 128;
    InterlockedOr(RWVisibleLightHash[tileBase + BitIndex/32], 1 << (BitIndex%32));
    // 同时写入面积光的 2x2 可见象限 mask
    InterlockedOr(RWVisibleLightMaskHash[...], quadrantMask);
}
```

随后 `FilterVisibleLightHash` 做空间过滤（邻居 tile 的 hash 合并），防止单 tile 漏报。

这个 hash 就是下帧 Ray Guiding 的输入——形成闭环反馈。

### HairStrands 透射率

对毛发像素，在 Shading 时应用之前 `HairTransmittanceCS` 计算的透射 mask：

```hlsl
FHairTransmittanceMask mask = UnpackTransmittanceMask(PackedTransmittanceMasks[SampleIndex]);
LightData.HairTransmittance = GetTransmittanceDataFromTransmitttanceMask(...);
```

毛发不是 0/1 的硬阴影，而是连续衰减的透射率。

### Reference 模式的累积

```hlsl
#if REFERENCE_MODE
if (ShadingPassIndex > 0)
{
    float BlendFactor = 1.0 / (ShadingPassIndex + 1.0);
    DiffuseLighting = PrevDiffuse * (1 - BlendFactor) + NewDiffuse * BlendFactor;
}
#endif
```

多 pass 等权平均，pass 数足够多时自然收敛到无噪点。

源码：`MegaLightsResolve.cpp:586`
Shader：`MegaLightsShading.usf` `FShadeLightSamplesCS`

---

## 8. DenoiseLighting 阶段

### 目的

Resolve 输出的单帧结果噪点极高（每像素只有 4 个采样），降噪器利用**时域累积 + 空间滤波**重建平滑的光照。

### 两阶段结构

```
Resolve 输出 → Temporal Denoiser → Spatial Denoiser → 写回 SceneColor
```

### Temporal Denoiser（时域累积）

核心思想：重投影上帧结果到当前帧位置，和当前帧的新采样混合。

1. **Motion Vector 重投影**：把当前像素映射到上帧位置，读取历史光照
2. **Neighborhood Clamp**：3×3 邻域计算 Mean/Variance，把历史值钳制到当前邻域范围（防 ghosting）
3. **混合**：`Result = lerp(History, Current, 1/AccumulatedFrames)`
   - 最大累积帧数 12（`r.MegaLights.Temporal.MaxFramesAccumulated`）
   - 历史缺失时降为 4 帧
4. **钳制强度**：`r.MegaLights.Temporal.NeighborhoodClampScale`（默认 1.0，越小越防 ghosting 但更糊）

### Spatial Denoiser（空间滤波）

Cross-Bilateral 滤波，在保持边缘的同时平滑噪点：

```hlsl
for each sample in kernel:
    depthWeight  = exp(-depthDiff * 10000.0)  // 深度差异权重
    normalWeight = dot(N1, N2)                 // 法线差异权重
    spatialWeight = kernelShape[distance]      // 空间距离权重
    
    totalWeight = depthWeight * normalWeight * spatialWeight;
    result += neighborLighting * totalWeight;
```

参数：
- 核半径 8 像素（`r.MegaLights.Spatial.KernelRadius`）
- 4 个样本
- 历史缺失区域扩大核半径补偿噪声

### 开关 CVar

| CVar | 默认 | 作用 |
|---|---|---|
| `r.MegaLights.Temporal` | 1 | 时域累积开关 |
| `r.MegaLights.Temporal.MaxFramesAccumulated` | 12 | 最大累积帧数 |
| `r.MegaLights.Temporal.NeighborhoodClampScale` | 1.0 | 邻域钳制强度 |
| `r.MegaLights.Spatial` | 1 | 空间滤波开关 |
| `r.MegaLights.Spatial.KernelRadius` | 8.0 | 空间核半径 |

### 最终输出

Diffuse + Specular 加回 `SceneColor`（或 HairStrands 的 `SampleLightingTexture`）。

源码：`MegaLightsDenoising.cpp:101` `FDenoiserTemporalCS`、`MegaLightsDenoising.cpp:354` `FDenoiserSpatialCS`
Shader：`MegaLightsDenoiserTemporal.usf`、`MegaLightsDenoiserSpatial.usf`

---

## 9. Ray Guiding 反馈循环

Ray Guiding 不是一个独立的 pass，而是跨帧的数据流动：

```
帧 N-1:
  Resolve → 写入 VisibleLightHash（哪些灯可见）
  Filter  → 空间扩散到邻居 tile
          → 存为历史

帧 N:
  Sampling → 读 VisibleLightHashHistory
          → 对上帧不可见的灯：权重 × 0.1
          → 水库采样选灯
  RayTrace → 忠实执行 Sampling 给的方向（不参与引导）
  Resolve  → 更新本帧 VisibleLightHash（循环继续）
```

### 关键设计

- **10% 探索率**：被遮挡的灯不是完全禁止采样，而是概率降到 1/10。确保遮挡解除时能在 1-2 帧内恢复。
- **Bloom Filter**：128 bit hash 会有冲突（不同灯映射到同一 bit），但只用于权重调整，不需精确。
- **空间 Filter**：邻居 tile 看到了某盏灯 → 当前 tile 也认为可见，加速恢复。
- **面积光 2×2 mask**：记录面积光 4 个象限的可见性，下帧把采样 UV 概率 warp 到可见象限。

CVar：`r.MegaLights.GuideByHistory`（0=禁用 / 1=灯级引导 / 2=面积光区域级引导）

---

## 10. 阴影方法：RT vs VSM

通过 `r.MegaLights.DefaultShadowMethod`（0=RT，1=VSM）控制，可在单个灯光上覆盖。

### RT 路径

- 固定开销，与灯光数无关
- 正确面积光软阴影
- Nanite 需 stream out 简化代理网格构建 BVH，精度有损
- 推荐：灯光数量多的场景

### VSM 路径

- 逐灯光开销（每盏灯需要渲染阴影页）
- 直接用 Nanite 集群光栅化，几何精度和屏幕一致
- 帧间缓存：静态页只渲染一次
- 推荐：灯光少 + Nanite 为主的场景

### VSM 与 Nanite 联动

Shadow Map 是"从光源渲染深度图"——光栅化天然适配。Nanite 的 GPU-Driven Pipeline 可以**单次 dispatch 同时渲染几百个 VSM 页**，每页只是不同的 Packed View。

不用 BVH 的原因：
- 光栅化 O(三角形数) vs BVH 追踪 O(射线 × 遍历深度)
- 顺序写入 vs 随机散射读取
- 零额外存储（复用 Nanite 集群数据）vs BVH 显存开销
- 精度和屏幕渲染完全一致 vs stream out 代理有损

---

## 11. 开销模型总结

| 步骤 | 灯光数增加时 | 说明 |
|---|---|---|
| TileClassification | 不变 | 只看材质类型 |
| Sampling 遍历 | 线性增长 | 但单次迭代极便宜（数学运算） |
| MarkVSMPages | 不变 | 固定 N 条射线 |
| RayTrace | 不变 | 固定 N 条射线 |
| Resolve | 不变 | 固定 N 次着色 |
| Denoise | 不变 | 与灯光数无关 |

**真正恒定的是 RayTrace + Resolve + Denoise**（占总开销大头）。Sampling 的遍历虽然理论上线性增长，但 Light Grid 已经做了空间剔除，每个格子通常只有个位数灯光。

---

## 12. Volume Lighting 体积光照路径

MegaLights 不只处理屏幕空间像素的直接光照，还独立处理两个体积系统：**Volumetric Fog**（体积雾）和 **Translucency Volume Lighting**（半透明体积光照）。这两个系统传统上各自有独立的逐光源处理 pass，MegaLights 把它们也统一替代。

### 12.0 传统做法 vs MegaLights

#### 传统 Volumetric Fog：逐灯注入

体积雾把视锥体切成 3D froxel 网格（默认 Tile=16 像素，Z=64 层），**对每盏带阴影的灯单独跑一个 pass**，把贡献注入到网格：

```
for each shadowed local light:
    FInjectShadowedLocalLightPS（一个完整的体积光栅化 pass）
        → 对灯光包围球覆盖的 Z-slice 区域
        → 每个 voxel 算：衰减 × 阴影 × 相函数（Phase Function）
        → 累加到 LocalShadowedLightScattering 体积纹理
```

最终的 `FVolumetricFogLightScatteringCS` 读取已注入的体积纹理，加上方向光、无阴影灯、天光、Lightmap 后做前向散射积分。

**开销模型**：N 盏阴影灯 = N 次体积光栅化 pass，灯多时不可行。

#### 传统 Translucency Volume：逐灯注入到低分辨率体积

类似但更简化：低分辨率 3D 纹理（2 级 Cascade），逐灯注入。半透明材质/粒子在渲染时采样这个体积纹理获取近似光照。

#### MegaLights 的替代方式

不再逐灯注入，而是**为每个 voxel 随机选几盏灯追踪**，结果预存到一张 3D 纹理中：

```
VolumeGenerateLightSamplesCS
  → 每个 voxel 水库采样选 2 盏灯（默认）
  → 生成射线参数

VolumeHardwareRayTrace / VolumeSoftwareRayTrace
  → 对每条射线做遮挡测试

VolumeShadeLightSamplesCS
  → 对可见的灯做 Phase Function 着色
  → 写入 MegaLightsVolume 3D 纹理
```

#### 注入到传统管线

在传统 `LightScatteringCS` shader 中通过 permutation 加入 MegaLights：

```hlsl
#if USE_MEGA_LIGHTS
    // MegaLights 贡献已预计算好，直接加上
    LightScattering += MegaLightsVolume[GridCoordinate] * View.OneOverPreExposure;
#endif
```

同时，传统的 per-light 循环跳过被 MegaLights 接管的灯：

```hlsl
#if USE_MEGA_LIGHTS
    const uint NumLights = CulledLightsGridHeader.NumLights - CulledLightsGridHeader.NumMegaLights;
#else
    const uint NumLights = CulledLightsGridHeader.NumLights;
#endif
```

方向光同理：被 MegaLights 接管时跳过传统评估。

#### 混合使用

场景中可同时存在 MegaLights 灯和非 MegaLights 灯。非 MegaLights 灯走传统逐灯注入，MegaLights 灯走随机采样路径，最终在 `LightScatteringCS` 中叠加。引擎通过 `NumMegaLights` 计数区分两套路径。

#### 开销对比

| | 传统 | MegaLights |
|---|---|---|
| 10 盏阴影灯 | 10 次体积光栅化 pass | 1 次采样 + 1 次追踪 + 1 次着色 |
| 100 盏阴影灯 | 不可行 | 同上（恒定） |
| 每 voxel 精度 | 精确 | 2 盏灯随机采样，靠时域累积收敛 |
| Shadow 来源 | Shadow Map / VSM | 硬件/软件光追 |

### 12.1 Volumetric Fog 路径

#### Grid 配置

体积雾本质是一个 3D Frustum-aligned Grid（视锥体对齐的 froxel 网格）：

- **像素大小**：8 像素（XY 方向每个 froxel 覆盖 8×8 屏幕像素）
- **Z 分辨率**：128 层（深度方向切片）
- **下采样**：2×2×2 减少采样工作量
- **每体素采样数**：默认 2 盏灯（可选 4）

#### 流程

完全镜像主路径，但维度变成 3D：

```
VolumeSampling → VolumeRayTracing → VolumeShading
   ↓                ↓                  ↓
3D 网格采样      3D 体积光追        体积着色
```

每个 froxel 用同样的加权水库采样从灯光列表中选 N 盏，向各自方向发射射线，命中即写入 0。

#### HZB 遮挡剔除

体积雾路径会复用 HZB 做整列剔除——如果某条 Z 列上方的 froxel 都不可见（在 GBuffer 之外），整列跳过，避免对空气中的 froxel 浪费射线。

#### CVar

| CVar | 默认 | 作用 |
|---|---|---|
| `r.MegaLights.Volume` | 1 | 体积雾 MegaLights 开关 |
| `r.MegaLights.Volume.NumSamplesPerVoxel` | 2 | 每体素采样数（2 或 4） |
| `r.MegaLights.Volume.HZBOcclusionTest` | 1 | HZB 整列剔除 |

源码：`MegaLightsVolume.cpp`
Shader：`MegaLightsVolumeSampling.usf`、`MegaLightsVolumeRayTracing.usf`、`MegaLightsVolumeShading.usf`

<!-- VOL_CONT -->

### 12.2 Translucency Volume Lighting 路径

独立于 Volumetric Fog，专门服务半透明材质和粒子。

- **控制**：`r.MegaLights.TranslucencyVolume = 1`
- **结构**：2 级 Cascade（`TVC_MAX`），下采样因子 2
- **独立降噪**：有自己的空间/时域滤波（`r.MegaLights.TranslucencyVolume.Spatial/Temporal`）

### 12.3 Unified 模式

`r.MegaLights.Volume.Unified = 1`（默认启用）时，体积雾和半透明体积共用采样与 RayTracing Pass，减少 shader 编译和切换开销。两者只在 Shading 阶段分开处理。

---

## 13. HairStrands 交互

### 独立 ViewContext

毛发有独立的 `ViewContextHairStrands`，输出到 `HairStrandsViewData.VisibilityData.SampleLightingTexture`，而不是 SceneColor。

```cpp
// DeferredShadingRenderer.cpp:3327
RenderMegaLightsViewContext(ViewContext, SceneColor);             // GBuffer 路径
RenderMegaLightsViewContext(ViewContextHairStrands, HairTarget);  // 毛发路径
```

毛发路径不跑 Volumetric Fog 和 Translucency Volume。

### HairTransmittanceCS

在 GenerateSamples 之后、RayTrace 之前运行的独立 compute pass：

```
对每条毛发像素的采样射线 → 穿过 Hair Voxel Page 结构
  → ComputeHairCountVirtualVoxel() 统计射线穿过了多少根发丝
  → 输出 TransmittanceMask（HairCount + Visibility）
```

毛发是半透明遮挡物，需要连续透射率值而非 0/1 二值阴影。Resolve 阶段把这个 mask 乘到光照上。

### Hair Voxel Trace

RayTrace 阶段的第 4 级追踪，对**非毛发像素**检测是否被毛发遮挡：

```
if (InputType != HairStrands && HasHairVoxelData)
    → 在 World Space Trace 中加入 Hair Voxel 步进
```

---

## 14. 与其他系统的耦合点

| 子系统 | 耦合方式 |
|---|---|
| **Lumen** | 共享 Global SDF + HZB 用于 Software RT；推荐搭配 Lumen HWRT 共享 RT Scene 开销 |
| **Virtual Shadow Map** | 双向交互：Page Marking（写）+ Shadow Sampling（读） |
| **Nanite** | RT Scene 由 Nanite Fallback Mesh 自动简化构建 BVH；使用 NaniteShadingMask 确定像素范围 |
| **Substrate** | Tile 分类增加 Single/ComplexSpecial 变体，着色 permutation 扩展 |
| **Niagara** | Light Renderer 模块中启用 "Allow Mega Lights" + "Mega Lights Cast Shadows" |
| **Path Tracer** | 互斥，PathTracer 启用时 MegaLights 不跑 |
| **Forward+** | 不支持，仅 Deferred |
| **HLOD / World Partition** | Far Field Trace 使用 HLOD1 简化合并网格延伸阴影射线 |

### RT Scene 质量

MegaLights RT 模式的阴影质量直接取决于 RT Scene 的几何精度（Nanite stream out 的简化代理）。提升方法：

1. 降低 Static Mesh → Nanite Settings → `Fallback Relative Error`
2. 调整 `r.RayTracing.Culling.Radius/SolidAngle`
3. 使用 "Ray Tracing Group Id" 合并小物体
4. `r.RayTracing.Nanite.CutError` 控制 BVH 代理精度

### Far Field Trace

`r.MegaLights.HardwareRayTracing.FarField` 启用后，使用极度简化的 HLOD1 合并网格将阴影射线延伸到 TLAS 剔除范围之外（需 World Partition 项目中构建 HLOD1）。

---

## 15. Reference 模式

用于验证普通模式结果正确性的离线 ground truth 生成器。

| 维度 | 普通模式 | Reference 模式 |
|---|---|---|
| Pass 数 | 1 | 最多 10240（`r.MegaLights.Reference.NumShadingPass`） |
| 随机策略 | Blue Noise 分层 | 纯随机序列 |
| 降采样 | 可 2×1/2×2 | 强制 1×1 全分辨率 |
| 降噪 | 时域+空间 | 无（靠累积收敛） |
| 平台 | 全平台 | 仅 PC |
| Shader 预编译 | 是 | 按需编译 |

典型用法：对比 Reference 和普通模式的结果差异，验证降噪器有没有吃掉细节或引入 bias。
