---
title: "GPU Skin Cache：Recompute Tangents"
cat: UE 剖析
sub: 角色
date: 2026-01-19
mins: 11
tags: [SkinCache, 切线]
---

> GPU 蒙皮缓存的切线重算机制
>
> 前置知识：[GPU Skin Cache 概述](/posts/skincache-overview/)

---

## 1. 控制层级

```
控制层级：

├── 项目设置（编译时）
│   └── r.SkinCache.CompileShaders = 1  ← 编译 Skin Cache Shader
│
├── 全局开关（运行时）
│   ├── r.SkinCache.Mode = 1            ← 启用 Skin Cache
│   ├── r.SkinCache.Allow = 1           ← 允许使用
│   └── r.SkinCache.RecomputeTangents   ← 切线重算模式
│       ├── 0: 关闭
│       ├── 1: 强制所有蒙皮对象重算
│       └── 2: 仅重算勾选的 Section（默认）
│
└── 资产设置（Per-Section）
    └── Skeletal Mesh → LOD → Section → Recompute Tangent ✅
```

**CVar 定义位置**: `GPUSkinCache.cpp:126-133`

```cpp
// GPUSkinCache.cpp:126-133
static TAutoConsoleVariable<int32> CVarGPUSkinCacheRecomputeTangents(
    TEXT("r.SkinCache.RecomputeTangents"),
    2,
    TEXT("0: off, 1: on, 2: on (per section, default)"),
    ...
);
```

**资产设置数据结构**: `SkeletalMeshLODRenderData.h:39`

```cpp
// SkeletalMeshLODRenderData.h
struct FSkelMeshRenderSection
{
    bool bRecomputeTangent;  // 是否启用运行时重算
    ESkinVertexColorChannel RecomputeTangentsVertexMaskChannel;  // 顶点色遮罩通道
};
```

**编辑器设置位置**: Skeletal Mesh → LOD → Section → Recompute Tangents

![Recompute Tangents 设置](/images/image_1768804208762.png)

选项说明：
- **Disabled**: 不重算切线
- **Enabled with no mask**: 整个 Section 全部重算
- **Enabled using red/green/blue mask**: 使用对应顶点色通道作为混合权重

---

## 2. 判断与启用逻辑

### 2.1 判断条件真值表

| `r.SkinCache.RecomputeTangents` | `Section.bRecomputeTangent` | 结果 |
|--------------------------------|----------------------------|------|
| 0 | 任意 | ❌ 不重算 |
| 1 | 任意 | ✅ 重算 |
| 2 (默认) | false | ❌ 不重算 |
| 2 (默认) | true | ✅ 重算 |

### 2.2 CPU 端启用流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ProcessEntry() - GPUSkinCache.cpp                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 阶段 1: 遍历 Section，判断是否需要重算 (:2117-2141)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   if (GSkinCacheRecomputeTangents > 0)                                      │
│   {                                                                         │
│       for (每个 RenderSection)                                              │
│       {                                                                     │
│           ┌─────────────────────────────────────────────────────────────┐   │
│           │ 核心判断 (:2126)                                            │   │
│           │                                                             │   │
│           │ if (有 IndexBuffer &&                                       │   │
│           │     (GSkinCacheRecomputeTangents == 1 ||                    │   │
│           │      RenderSection.bRecomputeTangent))                      │   │
│           │ {                                                           │   │
│           │     RecomputeTangentSection.bEnable = true;                 │   │
│           │ }                                                           │   │
│           └─────────────────────────────────────────────────────────────┘   │
│       }                                                                     │
│   }                                                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 阶段 2: SetupSection() - 设置 Section 的重算数据 (:779-822)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   if (RecomputeTangentSection.bEnable)                                      │
│   {                                                                         │
│       Data.RecomputeTangents.IndexBuffer = IndexBuffer->GetSRV();           │
│       Data.RecomputeTangents.NumTriangles = Section->NumTriangles;          │
│       Data.RecomputeTangents.IndexBufferOffsetValue = Section->BaseIndex;   │
│       Data.RecomputeTangents.Section = RecomputeTangentSection;             │
│   }                                                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 阶段 3: DispatchPassSetup() - 添加到重算队列 (:1730-1758)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   if (RecomputeTangents.Section.bEnable)                                    │
│   {                                                                         │
│       DispatchFlags |= EGPUSkinCacheDispatchFlags::RecomputeTangents;       │
│       TangentDispatches.Add(DispatchItem);  // 加入重算队列                 │
│   }                                                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 阶段 4: DispatchPassExecute() - 执行 Compute Shader (:2006-2033)            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   for (每个 TangentDispatches 中的 Section)                                 │
│   {                                                                         │
│       DispatchUpdateSkinTangentsTrianglePass(...);  // Pass 1 (:1310-1412)  │
│       DispatchUpdateSkinTangentsVertexPass(...);    // Pass 2 (:1264-1308)  │
│   }                                                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 关键数据结构

```cpp
// GPUSkinCache.cpp:604-609 - 标记 Section 是否需要重算
struct FRecomputeTangentSection
{
    uint32 bEnable                  : 1  = 0;  // 是否启用重算
    uint32 bEnableIntermediate      : 1  = 0;  // 是否使用中间 Buffer（顶点色混合）
    uint32 IntermediateBufferOffset : 30 = 0;  // 中间 Buffer 偏移
};

// GPUSkinCache.cpp:650-662 - Section 的 Dispatch 数据
struct FSectionDispatchData
{
    struct
    {
        FRecomputeTangentSection Section;           // 重算设置
        uint32 IndexBufferOffsetValue = 0;          // 索引缓冲偏移（用于读取三角形）
        uint32 NumTriangles = 0;                    // 三角形数量
        FRHIShaderResourceView* IndexBuffer = nullptr; // 索引缓冲 SRV
        FSkinCacheRWBuffer* IntermediateTangentBuffer = nullptr;
        FSkinCacheRWBuffer* IntermediateAccumulatedTangentBuffer = nullptr;
    } RecomputeTangents;
};
```

---

## 3. 执行流程

```
┌─────────────────────┐
│ Pass 0: 蒙皮计算     │  始终执行
│ (GpuSkinCache...usf)│
├─────────────────────┤
│ • 计算蒙皮位置       │ → PositionBufferUAV
│ • 矩阵旋转切线(默认) │ → TangentBufferUAV
└─────────────────────┘
           │
           ▼ 如果 RecomputeTangents 启用
┌─────────────────────┐
│ Pass 1: 三角形遍历   │
│ (PerTrianglePass)   │
├─────────────────────┤
│ • 读取变形后位置     │
│ • 计算三角形切线     │
│ • 原子累加          │ → IntermediateAccumBuffer
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│ Pass 2: 顶点归一化   │
│ (PerVertexPass)     │
├─────────────────────┤
│ • 归一化累加值       │
│ • 正交化            │
│ • 覆盖默认切线       │ → TangentBufferUAV
└─────────────────────┘
```

### 3.1 Pass 0: 蒙皮计算

**Shader**: `GpuSkinCacheComputeShader.usf`

计算蒙皮后的顶点位置和默认切线值：

```hlsl
// GpuSkinCacheComputeShader.usf:359-360 - 默认矩阵旋转切线
TangentX = normalize(mul(BlendMatrix, float4(LocalTangentX, 0)));
TangentZ = normalize(mul(BlendMatrix, float4(LocalTangentZ, 0)));

// :367-369 - 写入位置
PositionBufferUAV[VertexIndex] = Position;

// :384-385 - 写入切线
TangentBufferUAV[2 * VertexIndex] = TangentX_And_Sign;
TangentBufferUAV[2 * VertexIndex + 1] = TangentZ;
```

### 3.2 Pass 1: 三角形遍历（如果 RecomputeTangents 启用）

**Shader**: `RecomputeTangentsPerTrianglePass.usf`

遍历每个三角形，根据变形后的位置和 UV 计算切线，原子累加到中间缓冲：

```hlsl
// RecomputeTangentsPerTrianglePass.usf:105-108 - 计算三角形边和法线
float3 EdgeA = Corner[1].Position - Corner[0].Position;
float3 EdgeB = Corner[2].Position - Corner[0].Position;
float3 TriangleNormal = cross(EdgeB, EdgeA);

// :121-148 - 根据 UV 梯度计算切线
float2 UVEdgeA = Corner[1].UV - Corner[0].UV;
float2 UVEdgeB = Corner[2].UV - Corner[0].UV;
float3 Tangent = (UVEdgeB.y * EdgeA - UVEdgeA.y * EdgeB);

// :177-185 - 原子累加到 Buffer
InterlockedAdd(IntermediateAccumBufferUAV[...], WeightedTangent);
InterlockedAdd(IntermediateAccumBufferUAV[...], WeightedNormal);
```

### 3.3 Pass 2: 顶点归一化

**Shader**: `RecomputeTangentsPerVertexPass.usf`

读取累加的切线值，归一化并正交化后写入最终切线缓冲：

```hlsl
// RecomputeTangentsPerVertexPass.usf:141-142 - 归一化
TangentZ = normalize(AccumTangentZ);
TangentX = normalize(AccumTangentX);

// :148 - 正交化
TangentX = normalize(TangentX - dot(TangentX, TangentZ) * TangentZ);

// :172-173 - 写入最终切线（覆盖 Pass 0 的默认值）
TangentBufferUAV[2 * VertexIndex] = TangentX_And_Sign;
TangentBufferUAV[2 * VertexIndex + 1] = TangentZ;
```

---

## 4. 顶点色遮罩（可选）

当选择 `Enabled using red/green/blue mask` 时，使用顶点色通道控制混合权重：

| 顶点色值 | 效果 |
|----------|------|
| 0.0 | 使用 Pass 0 的矩阵旋转切线 |
| 1.0 | 使用 Pass 1+2 重算的切线 |
| 0~1 | 两者混合 |

```hlsl
// RecomputeTangentsPerVertexPass.usf:163-168
#if BLEND_USING_VERTEX_COLOR
    float BlendFactor = VertexColor[VertexColorChannel];
    TangentX = lerp(InputTangentX.xyz, TangentX, BlendFactor);
    TangentZ = lerp(InputTangentZ.xyz, TangentZ, BlendFactor);
#endif
```

**使用场景**：只有局部区域需要重算时（如肩膀、肘部），可以用顶点色标记，减少不必要的计算。

---

## 5. 与 BuildSettings.bRecomputeTangents 的区别

| 设置 | 阶段 | 位置 | 作用 |
|------|------|------|------|
| `BuildSettings.bRecomputeTangents` | **构建时** | Skeletal Mesh Asset LOD 设置 | 导入/构建时重算切线，结果保存到资产 |
| `Section.bRecomputeTangent` + Skin Cache | **运行时** | GPU Compute Shader | 每帧根据变形后顶点重算切线 |

```
构建时 (BuildSettings.bRecomputeTangents):
  - 一次性计算，结果保存到资产
  - 基于原始静态顶点位置
  - 不消耗运行时性能

运行时 (Skin Cache RecomputeTangents):
  - 每帧计算
  - 基于蒙皮/Morph 变形后的顶点位置
  - 消耗 GPU 性能
  - 用于极端变形场景
```

---

## 6. 性能影响

```
性能消耗对比：

RecomputeTangents = 0 (关闭)
└── 只执行 Pass 0，最快

RecomputeTangents = 2 (按需)
└── 只对标记的 Section 执行 Pass 1 + Pass 2

RecomputeTangents = 1 (全部)
└── 所有 Section 都执行 Pass 1 + Pass 2，最慢
```

---

## 7. 使用建议

### 7.1 何时需要开启

| 场景 | 推荐设置 |
|------|----------|
| 极端 Morph Target（表情、体型） | 勾选受影响的 Section |
| 肌肉/脂肪变形 | 勾选变形区域 |
| 布料模拟区域 | 勾选 |
| World Position Offset 变形 | 勾选 |

### 7.2 何时不需要开启

| 场景 | 原因 |
|------|------|
| 普通骨骼动画 | 矩阵旋转切线已足够准确 |
| 轻微 Morph Target | 变形量小，视觉差异不明显 |
| 远距离角色 | 看不出差异，白白消耗性能 |
| 移动端/低端设备 | 性能敏感，优先关闭 |

### 7.3 调试技巧

```
// 控制台命令：强制所有蒙皮对象重算，用于对比效果
r.SkinCache.RecomputeTangents 1

// 恢复默认（按 Section 设置）
r.SkinCache.RecomputeTangents 2

// 完全关闭，用于性能对比
r.SkinCache.RecomputeTangents 0
```

**原则**：只在变形导致明显法线/光照错误时才启用，避免不必要的 GPU 开销。

---

## 更新日志

- **2026-01-19**：创建文档，整理 RecomputeTangents 完整逻辑和源码位置
- **2026-01-19**：将源码位置融入各章节，删除单独的源码位置模块
- **2026-01-19**：添加执行流程总览图，精简顶点色遮罩章节，补充调试技巧
