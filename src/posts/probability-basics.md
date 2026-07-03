---
title: "概率论基础"
cat: AI 与认知
date: 2026-05-27
mins: 5
tags: [数学基础, 概率论]
---

> 渲染中蒙特卡洛方法的数学前置知识。覆盖概率函数、概率密度函数、期望、方差等核心概念。

> 📖 本文档被 [蒙特卡洛与重要性采样基础](蒙特卡洛与重要性采样基础.md) 引用。

---

## 1. 随机变量

### 什么是随机变量

随机变量是一个"结果不确定"的量。每次"实验"产生一个值，但具体是哪个值由概率决定。

$$
X : \Omega \rightarrow \mathbb{R}
$$

- $\Omega$ = 样本空间（所有可能结果的集合）
- $X$ = 随机变量（把结果映射到数值）

### 离散 vs 连续

| 类型 | 取值 | 例子 |
|------|------|------|
| **离散** | 有限或可数个值 | 骰子点数、光源编号 |
| **连续** | 某区间内任意实数 | 采样方向角度、光线长度 |

---

## 2. 概率质量函数 (PMF)

### 定义

离散随机变量 $X$ 取某个值的概率：

$$
p(x) = P(X = x)
$$

### 性质

$$
p(x) \geq 0, \quad \sum_{\text{all } x} p(x) = 1
$$

### 例子：均匀选光源

从 $N$ 个光源中等概率选一个：

$$
p(i) = \frac{1}{N}, \quad i = 1, 2, \ldots, N
$$

### 例子：按权重选光源（MegaLights）

$$
p(i) = \frac{w_i}{\sum_{j=1}^{N} w_j}
$$

权重越大的光源被选中概率越高。

---

## 3. 概率密度函数 (PDF)

### 定义

连续随机变量 $X$ 落在某区间的概率由密度函数的积分给出：

$$
P(a \leq X \leq b) = \int_a^b f(x) \, dx
$$

$f(x)$ 就是 PDF（Probability Density Function）。

### 性质

$$
f(x) \geq 0, \quad \int_{-\infty}^{+\infty} f(x) \, dx = 1
$$

### 关键区别：PDF 不是概率

$$
f(x) \text{ 可以大于 1}
$$

PDF 是**密度**，不是概率本身。只有积分后才是概率。

```
类比：
  质量密度 ρ(x) 可以很大（铅的密度 > 1 kg/cm³）
  但体积积分后才是质量

  概率密度 f(x) 可以很大
  但区间积分后才是概率（≤ 1）
```

### 例子：均匀分布

$$
f(x) = \begin{cases} \frac{1}{b-a} & x \in [a, b] \\ 0 & \text{otherwise} \end{cases}
$$

当 $b - a < 1$ 时，$f(x) = \frac{1}{b-a} > 1$，这完全合法。

### 例子：余弦加权半球采样

渲染中最常见的 PDF —— 漫反射表面的方向采样：

$$
f(\omega) = \frac{\cos\theta}{\pi}
$$

验证归一化：$\int_{\text{hemisphere}} \frac{\cos\theta}{\pi} \, d\omega = 1$ ✓

---

## 4. 累积分布函数 (CDF)

### 定义

$X$ 小于等于某个值的概率：

$$
F(x) = P(X \leq x) = \int_{-\infty}^{x} f(t) \, dt
$$

### 性质

$$
F(-\infty) = 0, \quad F(+\infty) = 1, \quad F \text{ 单调递增}
$$

$$
f(x) = F'(x) \quad \text{（PDF 是 CDF 的导数）}
$$

### 图形对照

```
PDF f(x):                    CDF F(x):

    ╱╲                           ┌──── 1.0
   ╱  ╲                         ╱
  ╱    ╲                       ╱
 ╱      ╲                    ╱
╱────────╲───── 0       ────╱──────── 0
  a    b                  a    b

面积 = 概率                高度 = 累积概率
```

### 在渲染中的用途：反演采样（Inverse CDF Sampling）

要从 PDF $f(x)$ 中采样，步骤：

$$
\xi \sim \text{Uniform}(0, 1) \quad \Rightarrow \quad x = F^{-1}(\xi)
$$

1. 生成均匀随机数 $\xi \in [0, 1)$
2. 求 CDF 的反函数 $F^{-1}$
3. $x = F^{-1}(\xi)$ 就服从分布 $f(x)$

```
例：均匀分布 [a, b]
  CDF: F(x) = (x - a) / (b - a)
  反函数: F⁻¹(ξ) = a + ξ(b - a)
  → 这就是 lerp(a, b, ξ)
```

---

## 5. 期望（均值）

### 定义

随机变量的"平均值"：

$$
E[X] = \begin{cases}
\sum_x x \cdot p(x) & \text{离散} \\[6pt]
\int_{-\infty}^{+\infty} x \cdot f(x) \, dx & \text{连续}
\end{cases}
$$

### 函数的期望

$$
E[g(X)] = \int g(x) \cdot f(x) \, dx
$$

这是蒙特卡洛方法的理论基础 —— 用采样均值估计期望。

### 线性性

$$
E[aX + bY] = aE[X] + bE[Y]
$$

无论 $X$, $Y$ 是否独立，线性性都成立。

### 渲染中的含义

$$
\text{像素颜色} = E[L(\omega)] = \int_{\Omega} L(\omega) \cdot f(\omega) \, d\omega
$$

我们无法精确计算这个积分，所以用 N 个样本的均值来估计：

$$
\text{像素颜色} \approx \frac{1}{N}\sum_{i=1}^{N} \frac{L(\omega_i)}{p(\omega_i)}
$$

---

## 6. 方差与标准差

### 定义

方差衡量随机变量偏离均值的程度：

$$
\text{Var}[X] = E[(X - E[X])^2] = E[X^2] - (E[X])^2
$$

标准差：

$$
\sigma = \sqrt{\text{Var}[X]}
$$

### 性质

$$
\text{Var}[aX + b] = a^2 \cdot \text{Var}[X]
$$

$$
\text{Var}[X + Y] = \text{Var}[X] + \text{Var}[Y] \quad \text{（X, Y 独立时）}
$$

### N 个独立样本均值的方差

$$
\text{Var}\left[\frac{1}{N}\sum_{i=1}^{N} X_i\right] = \frac{\text{Var}[X]}{N}
$$

**这就是为什么样本越多噪点越少**：方差按 $1/N$ 下降，标准差按 $1/\sqrt{N}$ 下降。

### 渲染中的含义

```
方差 高 → 像素间亮度波动大 → 画面噪点多
方差 低 → 像素间亮度稳定   → 画面干净

降低方差的手段：
  1. 增加样本数 N（暴力，但 O(1/√N) 收敛慢）
  2. 重要性采样（让 PDF 接近被积函数形状）
  3. 时空复用（ReSTIR，等效增加 N）
  4. 降噪器（后处理，不改变估计本身）
```

---

## 7. 条件概率与贝叶斯定理

### 条件概率

已知事件 $B$ 发生时，$A$ 发生的概率：

$$
P(A|B) = \frac{P(A \cap B)}{P(B)}
$$

### 贝叶斯定理

$$
P(A|B) = \frac{P(B|A) \cdot P(A)}{P(B)}
$$

### 渲染中的应用

MegaLights 的时域引导本质上是条件概率：

$$
P(\text{光源可见} | \text{上帧可见}) \gg P(\text{光源可见} | \text{上帧被遮挡})
$$

所以对上帧被遮挡的光源降低采样权重是合理的。

---

## 8. 联合分布与边缘分布

### 联合 PDF

两个随机变量 $(X, Y)$ 的联合密度：

$$
P(X \in A, Y \in B) = \int_A \int_B f_{XY}(x, y) \, dy \, dx
$$

### 边缘 PDF

从联合分布中"积掉"一个变量：

$$
f_X(x) = \int_{-\infty}^{+\infty} f_{XY}(x, y) \, dy
$$

### 独立性

$X$, $Y$ 独立 $\Leftrightarrow$ $f_{XY}(x, y) = f_X(x) \cdot f_Y(y)$

### 渲染中的应用

半球面采样通常分解为两个独立的 1D 采样：

$$
f(\theta, \phi) = f_\theta(\theta) \cdot f_\phi(\phi)
$$

例如余弦加权采样：$\theta$ 按 $\sin(2\theta)$ 分布，$\phi$ 按均匀分布。

---

## 9. 大数定律与中心极限定理

### 大数定律

样本均值趋近于期望：

$$
\frac{1}{N}\sum_{i=1}^{N} X_i \xrightarrow{N \to \infty} E[X]
$$

**渲染含义**：采样越多，像素颜色越接近真实值。

### 中心极限定理

无论原始分布是什么形状，样本均值的分布趋近正态分布：

$$
\frac{\bar{X} - \mu}{\sigma / \sqrt{N}} \xrightarrow{d} \mathcal{N}(0, 1)
$$

**渲染含义**：蒙特卡洛噪点近似高斯分布，这就是为什么高斯降噪器效果好。

---

## 10. PMF vs PDF vs CDF 对照表

| | PMF $p(x)$ | PDF $f(x)$ | CDF $F(x)$ |
|---|---|---|---|
| **适用** | 离散 | 连续 | 两者 |
| **含义** | $P(X = x)$ | 密度（非概率） | $P(X \leq x)$ |
| **值域** | $[0, 1]$ | $[0, +\infty)$ | $[0, 1]$ |
| **归一化** | $\sum p = 1$ | $\int f = 1$ | $F(\infty) = 1$ |
| **求概率** | 直接读值 | 积分 | 差值 $F(b) - F(a)$ |

---

## 11. 渲染常用分布速查

| 分布 | PDF | 用途 |
|------|-----|------|
| 均匀 $U(a,b)$ | $\frac{1}{b-a}$ | 基础随机数生成 |
| 余弦加权 | $\frac{\cos\theta}{\pi}$ | 漫反射方向采样 |
| GGX | $\frac{\alpha^2}{\pi(\cos^2\theta(\alpha^2-1)+1)^2}$ | 镜面反射方向采样 |
| 指数 $\text{Exp}(\lambda)$ | $\lambda e^{-\lambda x}$ | 介质散射距离 |
| 正态 $\mathcal{N}(\mu, \sigma^2)$ | $\frac{1}{\sigma\sqrt{2\pi}}e^{-\frac{(x-\mu)^2}{2\sigma^2}}$ | 噪点分布、降噪核 |

---

## 引用本文档的其他文档

- [[蒙特卡洛与重要性采样基础]] —— 基于本文概念构建的采样理论
- [[MegaLights蒙特卡洛估计]] —— 实际应用

---

## 更新日志

| 日期 | 内容 |
|------|------|
| 2026-05-27 | 初始版本：PMF/PDF/CDF、期望、方差、条件概率、大数定律 |
