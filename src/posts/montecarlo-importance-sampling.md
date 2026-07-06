---
title: "蒙特卡洛与重要性采样基础"
cat: 基础知识
date: 2026-05-27
mins: 7
tags: [数学基础, 蒙特卡洛]
---

> 渲染中所有"采样估计"算法（路径追踪、Lumen、MegaLights、ReSTIR）的共同数学基础。本文档为通用前置知识，被多个 UE 渲染主题文档引用。

> 📖 **前置知识**：本文涉及 PDF、期望、方差等概念。如不熟悉，建议先阅读 [概率论基础](/posts/probability-basics/)。

---

## 1. 为什么需要蒙特卡洛

### 渲染方程的困境

物理正确的光照计算需要解渲染方程：

$$
L_o(p, \omega_o) = \int_{\Omega} f_r(p, \omega_i, \omega_o) \cdot L_i(p, \omega_i) \cdot \cos\theta_i \, d\omega_i
$$

**问题**：这个积分没有解析解。
- 半球面无限多方向 → 不能枚举
- 被积函数复杂（BRDF × 入射光 × 几何） → 不能符号求解
- 还嵌套了递归（间接光照） → 维度爆炸

### 蒙特卡洛的答案

不算精确积分，用随机采样估计期望。样本越多，估计越准。

$$
\int_{\Omega} f(x) \, dx \;\approx\; \frac{1}{N}\sum_{i=1}^{N}\frac{f(x_i)}{p(x_i)}
$$

---

## 2. 蒙特卡洛积分

### 基本公式

要估计 $\int f(x) \, dx$，从分布 $p(x)$ 中独立抽 N 个样本 $x_1, x_2, \ldots, x_N$：

$$
F_N = \frac{1}{N}\sum_{i=1}^{N}\frac{f(x_i)}{p(x_i)}
$$

**核心性质**：

$$
\begin{aligned}
E[F_N] &= \int f(x) \, dx & \leftarrow \text{无偏：期望等于真实积分} \\
\text{Var}[F_N] &= O(1/N) & \leftarrow \text{方差按 } 1/N \text{ 收敛} \\
\text{StdDev}[F_N] &= O(1/\sqrt{N}) & \leftarrow \text{误差按 } 1/\sqrt{N} \text{ 收敛}
\end{aligned}
$$

### 收敛速度

```
N = 1       → 误差 ~100%（1 个样本）
N = 100     → 误差 ~10%   （样本 100 倍 → 误差 1/10）
N = 10000   → 误差 ~1%    （样本 10000 倍 → 误差 1/100）
```

**坏消息**：要让误差降到原来的 1/10，样本数要增加 100 倍。
**好消息**：与维度无关。10 维积分和 1 维积分收敛速度一样（这是蒙特卡洛"打败"传统数值积分的原因）。

---

## 3. 概率密度函数 (PDF)

### 离散版本

$N$ 个候选，权重 $w_i$：

$$
P(\text{选中候选 } i) = \frac{w_i}{\sum_j w_j}
$$

例：3 个光源权重 [1, 2, 3]，总和 6

$$
p(\text{光源 1}) = \frac{1}{6} \approx 17\%, \quad
p(\text{光源 2}) = \frac{2}{6} \approx 33\%, \quad
p(\text{光源 3}) = \frac{3}{6} = 50\%
$$

### 连续版本

$$
p(x) \geq 0, \quad \int p(x) \, dx = 1, \quad P(x \in [a,b]) = \int_a^b p(x) \, dx
$$

注意：**p(x) 可以大于 1**（密度，不是概率本身）。

---

## 4. 为什么要除以 PDF（无偏性的来源）

### 直觉解释

```
假设有 100 个光源，光源 A 很亮（PDF 高），光源 B 很暗（PDF 低）

不除 PDF：
  采样 100 次 → A 被选 90 次，B 被选 10 次
  直接平均贡献 → 结果严重偏向 A（有偏！）

除以 PDF：
  A 的贡献 / 0.9 ≈ 等比例缩小
  B 的贡献 / 0.1 ≈ 等比例放大
  → 高频采样的样本权重小，低频采样的样本权重大
  → 总和恰好等于真实值（无偏！）
```

### 数学证明

$$
E\left[\frac{f(x)}{p(x)}\right] = \int \frac{f(x)}{p(x)} \cdot p(x) \, dx = \int f(x) \, dx
$$

> 无论用什么 PDF $p(x)$（只要 $f(x) \neq 0$ 处 $p(x) > 0$），估计都是无偏的。
> 选 PDF 的自由度 = 重要性采样的发挥空间。

### 具体例子

```
3 个光源，亮度 [100, 10, 1]，权重 [6.66, 3.46, 1.00]，WeightSum = 11.12

PDF：
  p(A) = 6.66/11.12 = 60%
  p(B) = 3.46/11.12 = 31%
  p(C) = 1.00/11.12 =  9%

期望：100×60% + 10×31% + 1×9% = 60 + 3.1 + 0.09 = 63.19

蒙特卡洛估计（除 PDF）：
  抽到 A：100/0.60 = 166.67
  抽到 B：10/0.31  = 32.26
  抽到 C：1/0.09   = 11.11

对所有 N 次采样取平均：
  60% × 166.67 + 31% × 32.26 + 9% × 11.11
  = 100 + 10 + 1
  = 111
  
等等？真实积分是各光源亮度之和 = 111 ✓
（不是 63.19，那是"加权平均"，不是"积分"）
```

**关键洞察**：除以 PDF 把"按概率出现的频率"还原成"原始的、未被概率扭曲的真实值"。

---

## 5. 重要性采样

### 核心思想

$$
\text{PDF 选得好} \rightarrow \text{方差低} \rightarrow \text{同样样本数下结果更准}
$$

最优 PDF：$p(x) \propto |f(x)|$，此时方差为零（每次估计都是真实值）。但需要先知道 $f$ 的积分（鸡生蛋），实际是用近似 $p \approx f$ 的形状。

### 直观图解

```
被积函数 f(x)：

      ▂▆█▆▂
     ▂█████▂                   <- 亮度集中在中间区域
   ▂▂███████▂▂
═══════════════════════
   x=0          x=1

均匀采样（差）：
  x x x x x x x x x x x        <- 大量样本浪费在低亮度区域
  
重要性采样（好）：
        x x x x x              <- 样本集中在高亮度区域
        x x x x x
═══════════════════════
   p(x) ∝ f(x) 的形状
```

### 渲染中的常见重要性采样

| 采样目标 | 经典 PDF |
|---------|---------|
| 半球面方向 | $\cos\theta$ —— 余弦加权（漫反射） |
| GGX 镜面反射 | $D(h) \cdot \cos\theta_h$ —— 法线分布 |
| 光源 | $L / r^2$ |
| MegaLights 选光 | $\log_2(L+1)$ |
| 路径追踪下一次反弹 | BRDF 形状 |

---

## 6. 多重重要性采样 (MIS)

### 问题

```
有时一个 PDF 不够好。

例：渲染镜面高光 + 大面光源
  - BRDF 采样：擅长锐利高光，但难命中大光源
  - 光源采样：擅长大光源，但镜面高光会变模糊

单独用任意一个都有方差爆炸的角度。
```

### MIS 解决方案

同时用多个 PDF，按 "balance heuristic" 加权融合：

$$
F_{\text{MIS}} = \frac{f(x_a) \cdot w_a}{p_a(x_a)} + \frac{f(x_b) \cdot w_b}{p_b(x_b)}
$$

$$
w_a = \frac{p_a}{p_a + p_b}, \quad w_b = \frac{p_b}{p_a + p_b}
$$

每种采样策略在自己擅长的区域贡献多，不擅长的区域贡献少，互相补足。

---

## 7. Reservoir Sampling（水库采样）

### 等概率版

从未知长度的数据流中等概率选 1 个：对第 $i$ 个元素，以 $1/i$ 的概率替换当前样本。每个元素最终概率都是 $1/N$。

### 加权版（WRS）

对每个候选 $x_i$，权重 $w_i$：

$$
\tau = \frac{W}{W + w_i} \quad \text{（保留旧样本的概率）}
$$

$$
W \leftarrow W + w_i
$$

```
if (Random < τ):
    保留旧样本
else:
    用 x_i 替换
```

每个候选最终被选中的概率 $\propto$ 其权重。**单次遍历，O(1) 空间。**

### 验证

$$
\text{3 个候选，权重 } w_1=1,\; w_2=2,\; w_3=3
$$

$$
P(x_j) = \frac{w_j}{\sum_k w_k} \quad \Rightarrow \quad P(x_1)=\frac{1}{6},\; P(x_2)=\frac{2}{6},\; P(x_3)=\frac{3}{6} \;\checkmark
$$

---

## 8. RIS（Reservoir Importance Sampling）

### 把 WRS 升级成"重要性采样"

在 WRS 中，权重 $w_i$ 可以是任意值。如果把权重定义为：

$$
w_i = \frac{f(x_i)}{p_{\text{source}}(x_i)}
$$

其中 $f(x_i)$ 是目标分布（理想 PDF，难直接采样），$p_{\text{source}}(x_i)$ 是源分布（容易采样的 PDF，如均匀），那么 RIS 选出的样本近似服从分布 $f(x)$。

### 直观理解

```
你想采样目标分布 f，但 f 太难直接采样。

RIS 策略：
  1. 从简单的 p_source 大量采样（candidates）
  2. 给每个 candidate 打分 w = f / p_source
  3. 用 WRS 按分数选 k 个

→ 最终样本近似服从 f
→ 用便宜的采样模拟昂贵的目标分布
```

### MegaLights 的应用

$$
\begin{aligned}
\text{源分布} &: \text{均匀枚举光源列表} \\
\text{目标分布} &: \text{每光源对像素的实际亮度贡献} \propto \log_2(L+1) \\
w_i &= \frac{\log_2(L_i + 1)}{1} = \log_2(L_i + 1)
\end{aligned}
$$

RIS 选出的光源 → 近似按"亮度感知重要性"分布。

---

## 9. ReSTIR（Reservoir Spatio-Temporal Resampling）

### 在 RIS 基础上加两层复用

```
RIS    = 单像素水库采样
ReSTIR = RIS + 时域复用 + 空间复用

时域复用：把上一帧像素的 reservoir 拿过来"二次 RIS"
空间复用：把邻居像素的 reservoir 拿过来"二次 RIS"

→ 等效样本数指数增长（每复用一次，等效样本数 ×N）
→ 极少的实际采样，得到接近无噪点的结果
```

### MegaLights 的取舍

```
完整 ReSTIR：实现复杂、需要持久化 reservoir、有偏差控制问题
MegaLights：只借鉴时域思想（可见性历史引导），跳过完整空间复用

→ 简单稳定，性能好
→ 牺牲一些方差降低，靠降噪器补回来
```

---

## 10. 术语速查

| 术语 | 含义 |
|------|------|
| **PDF** | Probability Density Function，候选被采样的概率密度 |
| **CDF** | Cumulative Distribution Function，PDF 的积分（用于反演采样） |
| **无偏估计** | E[估计] = 真值 |
| **方差** | 估计的波动程度，对应"噪点" |
| **重要性采样** | 让 PDF 接近被积函数形状，降低方差 |
| **MIS** | Multiple Importance Sampling，多 PDF 融合 |
| **WRS** | Weighted Reservoir Sampling，加权水库采样 |
| **RIS** | Reservoir Importance Sampling，水库重要性采样 |
| **ReSTIR** | RIS + 时空复用 |
| **target PDF** | 想要模仿的目标分布 |
| **source PDF** | 实际采样用的简单分布 |

---

## 11. 在 UE 渲染中的应用对照

| 系统 | 采样对象 | PDF 形式 | 备注 |
|------|---------|---------|------|
| Path Tracer | 半球方向 + 光源 | BRDF + 光源 + MIS | 离线质量 |
| Lumen | 屏幕探针方向 | BRDF + 重要性引导 | 实时全局光 |
| **MegaLights** | 光源选择 | $\log_2(L+1)$ + RIS | 大量灯光直接照明 |
| Volumetric Cloud | 单次/多次散射 | 相位函数 | 体积渲染 |
| ReSTIR DI/GI | 光源/路径 | 完整 ReSTIR | UE 中暂未默认启用 |

---

## 引用本文档的其他文档

- [[MegaLights蒙特卡洛估计]] —— RIS 在大量光源采样中的具体应用

---

## 更新日志

| 日期 | 内容 |
|------|------|
| 2026-05-27 | 初始版本：基础概念 + RIS / ReSTIR 介绍 |
