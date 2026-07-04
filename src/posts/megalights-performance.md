---
title: "MegaLights 性能分析与优化"
cat: UE 剖析
date: 2026-05-27
mins: 9
tags: [MegaLights, 性能优化]
---

> 基于 MegaLights 完整逻辑、渲染管线技术详解、蒙特卡洛估计三份文档的综合性能分析。聚焦性能瓶颈定位、实用调参建议和优化方案。

> 📖 前置文档：[MegaLights完整逻辑](MegaLights完整逻辑.md) | [MegaLights渲染管线技术详解](MegaLights渲染管线技术详解.md) | [MegaLights蒙特卡洛估计](MegaLights蒙特卡洛估计.md)

---

## 1. 开销模型

### 1.1 核心优势

MegaLights 的开销**几乎恒定，与光源数量无关**：

$$
\text{传统 Deferred}: \quad \text{Cost} = O(N) \quad \text{（N = 光源数）}
$$

$$
\text{MegaLights}: \quad \text{Cost} = O(L + K) \quad \text{（L = 遍历光源列表，K = 固定射线数）}
$$

其中 $L$ 是轻量的 PDF 计算（无光追），$K$ 是固定的射线追踪开销（默认 4 条/像素）。

### 1.2 各 Pass 开销占比

```
┌─────────────────────────────────────────────────────────────────┐
│              MegaLights 典型帧开销分布                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  GenerateSamples (采样)     ████░░░░░░░░░░░░░░░░  ~15%          │
│  Screen Traces (HZB)        ██░░░░░░░░░░░░░░░░░░  ~8%           │
│  Hardware Ray Tracing       ████████████░░░░░░░░  ~45%  ← 瓶颈  │
│  Resolve (着色)             ███░░░░░░░░░░░░░░░░░  ~12%          │
│  Temporal Denoise           ██░░░░░░░░░░░░░░░░░░  ~8%           │
│  Spatial Denoise            ██░░░░░░░░░░░░░░░░░░  ~7%           │
│  Volume Lighting            █░░░░░░░░░░░░░░░░░░░  ~5%           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**结论：光线追踪是绝对瓶颈**，占总开销近一半。

### 1.3 性能对比

| 场景 | 传统 Deferred | MegaLights | 说明 |
|------|---------------|------------|------|
| 10 个带阴影光源 | 基准 ×1.0 | 基准 ×1.2 | MegaLights 略高（固定开销） |
| 100 个带阴影光源 | 基准 ×10+ | 基准 ×1.3 | MegaLights 优势显现 |
| 1000 个带阴影光源 | 不可行 | 基准 ×1.5 | 传统方案已崩溃 |

**拐点**：约 20-30 个带阴影光源时，MegaLights 开始比传统方案便宜。

---

## 2. 性能关键点分析

### 2.1 光线追踪（最大瓶颈）

**影响因素：**

| 因素 | 影响程度 | 说明 |
|------|---------|------|
| RT Scene 实例数 | ★★★★★ | TLAS 遍历复杂度直接相关 |
| 重叠实例 | ★★★★☆ | 射线穿过多层几何体，多次 Any-Hit |
| 动态物体数量 | ★★★★☆ | 每帧 BLAS 重建开销 |
| 射线长度 | ★★★☆☆ | 长射线遍历更多 BVH 节点 |
| Alpha Masking | ★★★☆☆ | Any-Hit shader 评估开销 |

**Screen Trace 的缓解作用：**

HZB 屏幕空间追踪在光追之前执行，能以极低开销解决近距离遮挡（家具、墙角），减少约 30-50% 的 HWRT 调用。

### 2.2 采样阶段（GenerateSamples）

**影响因素：**

| 因素 | 影响程度 | 说明 |
|------|---------|------|
| 光源总数 $N$ | ★★★★☆ | 需遍历所有光源计算 PDF |
| BRDF 复杂度 | ★★☆☆☆ | 每光源都要评估一次无阴影光照 |
| Tile 类型数量 | ★★☆☆☆ | 每种 TileType 一次 Indirect Dispatch |

**关键洞察**：虽然遍历是 $O(N)$，但每个光源只做轻量的光照评估（无光追），所以即使 1000 个光源，采样阶段也只占总开销 ~15%。

### 2.3 降噪阶段

**影响因素：**

| 因素 | 影响程度 | 说明 |
|------|---------|------|
| 分辨率 | ★★★★☆ | 全分辨率像素级操作 |
| 核半径 | ★★★☆☆ | Spatial 默认 8 像素，4 样本 |
| Disocclusion 区域 | ★★☆☆☆ | 历史缺失时扩大核半径 |

降噪开销相对固定，约占总开销 15%。

### 2.4 体积光照

**影响因素：**

| 因素 | 影响程度 | 说明 |
|------|---------|------|
| 体积分辨率 | ★★★★☆ | 像素大小 8，Z 分辨率 128 |
| 每体素采样数 | ★★★☆☆ | 默认 2，可选 4 |
| 体积雾范围 | ★★☆☆☆ | 范围越大体素越多 |

体积光照是可选的，关闭后可节省约 5-10% 总开销。

---

## 3. 实用调参建议

### 3.1 性能优先配置

适用场景：主机 30fps、大量光源、性能敏感

```
r.MegaLights.NumSamplesPerPixel 2          // 最少射线数
r.MegaLights.DownsampleMode 2              // 半分辨率（默认）
r.MegaLights.Volume 0                      // 关闭体积光照
r.MegaLights.TranslucencyVolume 0          // 关闭半透明体积
r.MegaLights.HairStrands 0                 // 关闭毛发支持（如不需要）
r.MegaLights.Temporal.MaxFramesAccumulated 16  // 更多时间累积补偿低采样
```

### 3.2 质量优先配置

适用场景：高端 PC、过场动画、截图模式

```
r.MegaLights.NumSamplesPerPixel 16         // 最多射线数
r.MegaLights.DownsampleMode 0             // 全分辨率
r.MegaLights.LightingDataFormat 1          // Float16 精度
r.MegaLights.Temporal.MaxFramesAccumulated 12
r.MegaLights.Spatial.KernelRadius 8
```

### 3.3 平衡配置（推荐默认）

```
r.MegaLights.NumSamplesPerPixel 4          // 默认
r.MegaLights.DownsampleMode 2             // 半分辨率
r.MegaLights.Volume 1                      // 体积光照开
r.MegaLights.GuideByHistory 2             // 可见部分引导
r.MegaLights.MaxShadingWeight 20           // 默认钳制
```

### 3.4 问题诊断速查

| 现象 | 原因 | 解决方案 |
|------|------|----------|
| Fireflies（亮点闪烁） | 低概率样本权重过大 | 降低 `MaxShadingWeight`（20→10） |
| Ghosting（拖影） | 时间累积过度信任历史 | 降低 `Temporal.NeighborhoodClampScale`（1.0→0.5） |
| 光照模糊 | 降噪器过度平滑 | 减少光源范围 / 增加样本数 |
| 噪点明显 | 采样不足 | 增加 `NumSamplesPerPixel` / 检查光源配置 |
| 阴影漏光 | RT Scene 几何不精确 | 降低 Nanite Fallback Relative Error |
| 阴影缺失 | 物体不在 RT Scene 中 | 检查 `r.RayTracing.Culling.*` |
| 室内噪声增加 | 方向光抢占采样预算 | 降低 `DirectionalLightSampleFraction` |
| 动态物体阴影延迟 | 历史引导滞后 | 提高 `LightHiddenPDFWeight`（0.1→0.3） |

---

## 4. 优化方案

### 4.1 光线追踪优化（最大收益）

#### 减少 RT Scene 复杂度

```
// 剔除远处/小物体
r.RayTracing.Culling.Mode 1
r.RayTracing.Culling.Radius 20000          // 剔除半径（cm）
r.RayTracing.Culling.SolidAngle 0.001      // 立体角阈值

// 合并小物体
使用 "Ray Tracing Group Id" 合并相邻小物体为统一剔除包围盒
```

#### 减少动态 BLAS 重建

```
策略：
  - 远处骨骼网格使用 Static 模式（不更新 BLAS）
  - 使用 LOD 降低远处物体三角形数
  - 对不投射阴影的物体关闭 "Visible in Ray Tracing"
```

#### Screen Trace 最大化利用

```
// Screen Trace 能解决的遮挡越多，HWRT 压力越小
r.MegaLights.ScreenTraces 1               // 确保开启
r.MegaLights.ScreenTraces.MaxIterations 50 // 默认足够
```

### 4.2 采样效率优化

#### 光源配置优化

```
问题：大范围光源 → 大量像素都要评估它 → 浪费采样预算

优化：
  1. 收紧光源 Attenuation Radius（只覆盖实际需要的范围）
  2. 使用 IES Profile 限制光照方向
  3. 避免大量重叠的大范围光源
```

#### 方向光预算控制

```
// 方向光默认占 50% 采样预算，室内场景可降低
r.MegaLights.DirectionalLightSampleFraction 0.3  // 室内为主
r.MegaLights.DirectionalLightSampleFraction 0.7  // 室外为主
```

#### 历史引导调优

```
// 动态场景（光源频繁出入视野）
r.MegaLights.GuideByHistory.LightHiddenWeight 0.2      // 默认 0.1，提高探索
r.MegaLights.GuideByHistory.LightHiddenWeightForHistoryMiss 0.5

// 静态场景（光源稳定）
r.MegaLights.GuideByHistory.LightHiddenWeight 0.05     // 更激进降权
```

### 4.3 降噪优化

#### 时间降噪

```
// 快速运动场景（FPS/赛车）
r.MegaLights.Temporal.MaxFramesAccumulated 6   // 减少累积，降低拖影
r.MegaLights.Temporal.NeighborhoodClampScale 0.5

// 慢节奏场景（RPG/步行模拟）
r.MegaLights.Temporal.MaxFramesAccumulated 16  // 更多累积，更干净
r.MegaLights.Temporal.NeighborhoodClampScale 1.5
```

#### 空间降噪

```
// 性能优先
r.MegaLights.Spatial.KernelRadius 4        // 缩小核
r.MegaLights.Spatial.NumSamples 2          // 减少样本

// 质量优先
r.MegaLights.Spatial.KernelRadius 12       // 扩大核
```

### 4.4 体积光照优化

```
// 完全关闭（最大节省）
r.MegaLights.Volume 0
r.MegaLights.TranslucencyVolume 0

// 降低质量
r.MegaLights.Volume.NumSamplesPerVoxel 2   // 最少（默认）

// Unified 模式（减少 Shader 切换）
r.MegaLights.Volume.Unified 1             // 默认开启
```

### 4.5 CPU 端优化

```
// 移除遗留的 Primitive Interaction 追踪（MegaLights RT 模式下无用）
r.Visibility.LocalLightPrimitiveInteraction 0

// 减少 CPU 端光源管理开销
合理使用 Lighting Channels 限制光源影响范围
```

### 4.6 VSM vs RT 选择策略

| 场景 | 推荐 | 原因 |
|------|------|------|
| 大多数光源 | **RT**（默认） | 无额外 per-light 开销，正确面积阴影 |
| 关键主光源（需精确阴影） | **VSM** | 直接光栅化完整 Nanite 几何 |
| 大量小光源 | **RT** | VSM 每光源有固定开销，会累积 |
| 性能受限平台 | **RT** | VSM 需要额外显存和 GPU 深度渲染 |

```
// 默认全部 RT
r.MegaLights.DefaultShadowMethod 0

// 仅对关键光源单独设置 VSM
Light Component → MegaLights Shadow Method = Virtual Shadow Map
```

---

## 5. Scalability 分级建议

| 画质等级 | NumSamples | Downsample | Volume | Spatial | 目标 |
|---------|-----------|-----------|--------|---------|------|
| Low | 2 | 2 (半分辨率) | Off | Off | 主机 30fps |
| Medium | 2 | 2 | On (2 spp) | On (r=4) | 主机 60fps |
| High | 4 | 2 | On (2 spp) | On (r=8) | PC 中端 |
| Epic | 4 | 1 (棋盘格) | On (4 spp) | On (r=8) | PC 高端 |
| Cinematic | 16 | 0 (全分辨率) | On (4 spp) | On (r=12) | 离线/截图 |

---

## 6. 性能分析方法

### 6.1 GPU Profiling

```
// 基础计时
stat GPU                                    // 查看 MegaLights 总耗时

// 详细 Pass 分析
ProfileGPU                                  // 内置 GPU Profiler
// 或使用 RenderDoc / PIX / NSight

// 重要：Async Compute 会扭曲计时
r.RDG.AsyncCompute 0                       // 分析前先关闭
```

### 6.2 关键指标

```
观察重点：
  1. MegaLights.RayTrace 耗时 → 光追是否是瓶颈
  2. MegaLights.GenerateSamples 耗时 → 光源数量是否过多
  3. MegaLights.Denoise 耗时 → 降噪是否过重
  4. Screen Trace Hit Rate → HZB 命中率越高越好
```

### 6.3 可视化调试

```
// 查看采样分布
r.MegaLights.Debug.Mode 1                  // 可视化采样权重

// 查看降噪置信度
r.MegaLights.Debug.Mode 2                  // 可视化 ShadingConfidence
```

---

## 7. 常见陷阱

### 7.1 光源配置陷阱

```
❌ 大量 Attenuation Radius 很大的光源
   → 每个像素都要评估所有这些光源的 PDF
   → 采样预算被稀释，噪点增加

✓ 收紧 Attenuation Radius 到实际需要的范围
✓ 使用 IES Profile 限制方向
```

### 7.2 RT Scene 陷阱

```
❌ Nanite Fallback Mesh 过于简化
   → 阴影形状不准确，漏光

❌ 大量 Alpha Masked 材质
   → Any-Hit shader 频繁触发，光追变慢

✓ 对关键遮挡物提高 Fallback 精度
✓ 远处物体使用 Opaque 替代 Masked
```

### 7.3 降噪陷阱

```
❌ 快速移动场景使用高 MaxFramesAccumulated
   → 严重 ghosting

❌ 静态场景使用低 MaxFramesAccumulated
   → 不必要的噪点

✓ 根据游戏类型调整时间累积参数
```

---

## 更新日志

| 日期 | 内容 |
|------|------|
| 2026-05-27 | 初始版本：性能模型、调参建议、优化方案、Scalability 分级 |
