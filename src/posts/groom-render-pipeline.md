---
title: "UE Groom 渲染流程"
cat: 渲染管线
date: 2026-01-10
mins: 17
tags: [Groom, 毛发渲染]
---

## 一、系统概述

Groom是Unreal Engine的毛发/皮毛渲染系统，支持三种几何表示方式：
- **Strands（发束）**：高精度曲线渲染，适合近景
- **Cards（卡片）**：贴图纹理卡片，中等精度
- **Meshes（网格）**：最低精度，适合远景

---

## 二、核心类和数据结构

### 2.1 资源层
| 类 | 路径 | 职责 |
|---|---|---|
| `UGroomAsset` | `Engine/Plugins/Runtime/HairStrands/Source/HairStrandsCore/Public/GroomAsset.h` | 毛发资产，包含所有组数据 |
| `UGroomBindingAsset` | `.../Public/GroomBindingAsset.h` | 绑定到骨骼网格的数据 |
| `FHairStrandsBulkData` | `.../Public/HairStrandsDatas.h` | 毛发曲线的CPU数据 |
| `FHairCardsBulkData` | `.../Public/HairCardsDatas.h` | 卡片几何的CPU数据 |

### 2.2 运行时层
| 类 | 路径 | 职责 |
|---|---|---|
| `UGroomComponent` | `.../Public/GroomComponent.h` | 场景中的毛发组件 |
| `FHairGroupInstance` | `.../Public/GroomInstance.h` | 毛发组运行时实例 |
| `FHairStrandsSceneProxy` | `.../Private/GroomComponent.cpp:434` | 渲染线程场景代理 |

### 2.3 GPU资源层
| 类 | 职责 |
|---|---|
| `FHairStrandsRestResource` | 静止状态GPU缓冲区（位置、切线、属性） |
| `FHairStrandsDeformedResource` | 变形后GPU缓冲区（双缓冲用于运动模糊） |
| `FHairStrandsInterpolationResource` | 导引到渲染曲线的插值数据 |
| `FHairStrandsClusterResource` | LOD聚类和剔除数据 |

---

## 三、渲染管线流程

### 3.1 整体流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         每帧渲染流程                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. LOD选择 (ProcessLODSelection)                                   │
│     ├─ 计算屏幕覆盖率                                                │
│     └─ 选择几何类型: Strands/Cards/Meshes                           │
│                                                                     │
│  2. 绑定表面更新 (ProcessBindingSurfaceUpdate)                       │
│     ├─ 从骨骼网格获取变形位置                                         │
│     └─ 更新根部投影数据                                              │
│                                                                     │
│  3. 导引插值 (ProcessGuideInterpolation)                             │
│     ├─ 从物理模拟获取导引曲线位置                                     │
│     └─ 或从绑定网格变形导引                                          │
│                                                                     │
│  4. 渲染曲线插值 (ProcessStrandsInterpolation)                       │
│     ├─ 基于导引曲线插值渲染曲线                                       │
│     └─ 计算最终世界空间位置                                          │
│                                                                     │
│  5. 卡片/网格插值 (ProcessCardsAndMeshesInterpolation)               │
│     └─ 如果当前LOD使用Cards/Meshes                                  │
│                                                                     │
│  6. 可见性渲染 (RenderHairStrandsVisibilityBuffer)                   │
│     ├─ Pre-Pass: 深度预渲染                                         │
│     ├─ 构建每像素样本列表(PPLL)                                      │
│     └─ 计算覆盖率和透射                                              │
│                                                                     │
│  7. 深度阴影 (RenderHairStrandsDeepShadows)                          │
│     ├─ 渲染DOM(深度正交映射)                                         │
│     └─ 4层深度用于透射计算                                           │
│                                                                     │
│  8. 材质评估 (HairStrandsMaterialPS)                                 │
│     ├─ 评估Hair材质属性                                              │
│     └─ 写入GBuffer或样本缓冲                                         │
│                                                                     │
│  9. 光照合成 (RenderHairComposition)                                 │
│     ├─ Hair BSDF着色(R/TT/TRT三分量)                                │
│     ├─ 环境光照                                                     │
│     └─ 与场景合成                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 关键渲染入口点

位置：`Engine/Source/Runtime/Renderer/Private/HairStrands/HairStrandsRendering.h`

```cpp
// 主要渲染函数
void RenderHairPrePass(...);           // 深度预通道
void RenderHairBasePass(...);          // 基础通道
void RunHairStrandsBookmark(...);      // 书签系统调度
FHairTransientResources* AllocateHairTransientResources(...); // 分配临时资源
```

### 3.3 书签系统（阶段调度）

```cpp
enum class EHairStrandsBookmark : uint8 {
    ProcessTasks,                               // 处理任务队列
    ProcessLODSelection,                        // LOD选择
    ProcessBindingSurfaceUpdate,                // 绑定表面更新
    ProcessGuideInterpolation,                  // 导引插值
    ProcessCardsAndMeshesInterpolation_PrimaryView,  // 卡片/网格插值(主视图)
    ProcessCardsAndMeshesInterpolation_ShadowView,   // 卡片/网格插值(阴影视图)
    ProcessStrandsInterpolation,                // 发束插值
    ProcessDebug,                               // 调试
    ProcessEndOfFrame,                          // 帧末清理
    ProcessGuideDeformation                     // 导引变形
};
```

---

## 四、着色器系统

### 4.1 着色器文件位置

`Engine/Shaders/Private/HairStrands/`

### 4.2 关键着色器文件

| 文件 | 用途 |
|---|---|
| `HairStrandsVisibilityVS/PS.usf` | 可见性渲染 |
| `HairStrandsMaterialVS/PS.usf` | 材质评估 |
| `HairStrandsDeepShadowVS/PS.usf` | 深度阴影 |
| `HairStrandsComposition.usf` | 最终合成 |
| `HairStrandsEnvironmentLighting.usf` | 环境光照 |
| `HairBsdf.ush` | Hair BSDF实现 |
| `HairStrandsVertexFactory.ush` | 发束顶点工厂 |
| `HairCardsVertexFactory.ush` | 卡片顶点工厂 |

### 4.3 Hair BSDF光照模型

基于Marschner模型的三分量系统：

```
R   - Primary Reflection (一次反射/高光)
TT  - Transmission (透射/背光散射)
TRT - Double Transmission (双透射/深层反射)
```

关键函数（`HairBsdf.ush`）：
```hlsl
float3 HairShading(
    FGBufferData GBuffer,
    float3 L,                          // 光线方向
    float3 V,                          // 视线方向
    half3 N,                           // 毛发切线
    float Shadow,
    FHairTransmittanceData HairTransmittance,
    float InBacklit,
    float Area,
    uint2 Random);
```

### 4.4 渲染模式

```hlsl
#define RENDER_MODE_TRANSMITTANCE               0  // 仅透射
#define RENDER_MODE_PPLL                        1  // 像素链表(OIT)
#define RENDER_MODE_MSAA_VISIBILITY             2  // MSAA可见性
#define RENDER_MODE_TRANSMITTANCE_AND_HAIRCOUNT 3  // 透射+毛发计数
#define RENDER_MODE_COMPUTE_RASTER              4  // 计算着色器光栅化
```

---

## 五、数据流

### 5.1 导引→渲染曲线插值

```
导引曲线(Guides) - 少量曲线，用于物理模拟
       ↓
插值数据(InterpolationResource)
       ↓
渲染曲线(Strands) - 大量曲线，用于渲染
```

插值数据结构：
```cpp
struct FHairStrandsInterpolationDatas {
    FIntVector2 CurveSimIndices;    // 最近的两条导引曲线
    FVector2f CurveSimWeights;      // 对应权重
    FIntVector2 PointSimIndices;    // 局部点索引
    FVector2f PointSimLerps;        // 点间插值因子
};
```

### 5.2 可见性数据流

```
每像素样本列表(PPLL)
       ↓
FPackedHairSample {
    float Depth;                    // 深度
    uint ControlPointID_MacroGroupID;
    uint Tangent_Coverage8bit;      // 切线+覆盖率
    uint BaseColor_Roughness;       // 颜色+粗糙度
}
       ↓
排序和合成
```

---

## 六、LOD系统

### 6.1 LOD配置

```cpp
struct FHairLODSettings {
    float CurveDecimation;      // 曲线抽稀 [0..1]
    float VertexDecimation;     // 顶点抽稀 [0..1]
    float ScreenSize;           // 屏幕占比阈值
    float ThicknessScale;       // 粗细缩放
    EHairGeometryType GeometryType;  // Strands/Cards/Meshes
    EHairBindingType BindingType;    // Rigid/Skinning
};
```

### 6.2 几何类型切换

```
近景 (高屏幕占比) → Strands (发束渲染)
中景              → Cards (卡片渲染)
远景 (低屏幕占比) → Meshes (网格渲染)
```

---

## 七、物理模拟与渲染交互

### 7.1 模拟架构

```
UGroomComponent
       ↓
Niagara物理模拟 (Cosserat Rods / Angular Springs)
       ↓
导引曲线变形位置 (FHairStrandsDeformedResource)
       ↓
渲染曲线插值
```

### 7.2 约束类型

- **弯曲约束** (BendConstraint)
- **拉伸约束** (StretchConstraint)
- **碰撞约束** (CollisionConstraint)

---

## 八、关键代码路径

### 8.1 场景代理创建
```
UGroomComponent::CreateSceneProxy()
  └─> new FHairStrandsSceneProxy(this)
        └─> 收集HairGroupInstances
```

### 8.2 渲染注册
```
FHairStrandsSceneProxy::CreateRenderThreadResources()
  └─> LocalScene.AddHairStrands(Instance)
```

### 8.3 动态网格元素生成
```
FHairStrandsSceneProxy::GetDynamicMeshElements()
  └─> CreateMeshBatch()
        └─> 设置顶点工厂、材质、着色器绑定
```

---

## 九、重要控制台变量

| 变量 | 用途 |
|---|---|
| `r.HairStrands.Enable` | 全局开关 |
| `r.HairStrands.Visibility` | 可见性渲染模式 |
| `r.HairStrands.DeepShadow` | 深度阴影开关 |
| `r.HairStrands.Voxelization` | 体素化开关 |
| `r.HairStrands.Strands.Visibility` | 发束可见性 |
| `r.HairStrands.Cards.Visibility` | 卡片可见性 |

---

## 十、关键文件索引

### 插件代码
- `Engine/Plugins/Runtime/HairStrands/Source/HairStrandsCore/`
  - `Public/GroomAsset.h` - 资产定义
  - `Public/GroomComponent.h` - 组件定义
  - `Public/GroomInstance.h` - 实例定义
  - `Public/HairStrandsDatas.h` - 数据结构
  - `Public/GroomResources.h` - GPU资源
  - `Private/GroomComponent.cpp` - 场景代理实现

### 渲染器代码
- `Engine/Source/Runtime/Renderer/Private/HairStrands/`
  - `HairStrandsRendering.h/cpp` - 主渲染函数
  - `HairStrandsVisibility.h/cpp` - 可见性计算
  - `HairStrandsDeepShadow.h/cpp` - 深度阴影
  - `HairStrandsComposition.h/cpp` - 合成
  - `HairStrandsEnvironment.h/cpp` - 环境光照
  - `HairStrandsVoxelization.h/cpp` - 体素化

### 着色器
- `Engine/Shaders/Private/HairStrands/` - 所有Hair相关着色器
- `Engine/Shaders/Private/HairBsdf.ush` - BSDF实现

---

## 十一、发束四边形展开原理详解

发束渲染的核心技术是将1D曲线展开为2D的视图对齐四边形条带（View-Aligned Quad Strip），而非使用图形API的Line绘制。

### 11.1 为什么不用DrawLine？

| 问题 | Line绘制 | 四边形展开 |
|------|----------|-----------|
| 线宽控制 | 固定1像素，无法变粗细 | 任意宽度，支持根粗尖细 |
| 抗锯齿 | AA效果差 | 标准三角形AA |
| 光照计算 | 无表面法线 | 有完整TBN矩阵 |
| 覆盖率 | 无法精确计算 | 片元着色器可精确计算Alpha |

### 11.2 数据结构

每个控制点存储以下信息（压缩为8字节）：

```cpp
struct FHairControlPoint {
    float3 Position;      // 世界坐标位置
    float  WorldRadius;   // 发束半径（根据位置插值）
    float  UCoord;        // 沿发束的参数坐标 [0,1]
    uint   Type;          // 控制点类型: START(1), INSIDE(0), END(2)
};
```

### 11.3 顶点ID到控制点的映射

引擎通过 `SV_VertexID` 自动提供顶点索引，然后在着色器中映射到控制点：

**三角形列表模式（默认）**：每个控制点生成6个顶点（2个三角形）
```
四边形拓扑结构：
  0__2    4      顶点0,2,4 → IsTip=0（靠近根部）
  | /    /|      顶点1,3,5 → IsTip=1（靠近尖端）
  |/    /_|      顶点0,1,5 → IsLeft=1（左侧）
  1    5  3      顶点2,3,4 → IsLeft=0（右侧）
```

```hlsl
// HairStrandsVertexFactory.ush:127-132
uint QuadIndex = VertexId % 6;
uint BaseIndex = VertexId / 6;
VertexInfo.IsTip   = (QuadIndex == 0 || QuadIndex == 2 || QuadIndex == 4) ? 0 : 1;
VertexInfo.IsLeft  = (QuadIndex == 0 || QuadIndex == 1 || QuadIndex == 5) ? 1 : 0;
VertexInfo.VertexIndex = BaseIndex + VertexInfo.IsTip;  // 实际读取的控制点索引
```

**三角形条带模式**：每个控制点生成2个顶点（更高效）
```hlsl
uint QuadIndex = VertexId % 2;
uint BaseIndex = VertexId / 2;
VertexInfo.IsLeft = (QuadIndex == 0) ? 1 : 0;
```

### 11.4 四边形展开核心算法

关键函数 `ComputeViewAlignedWorldPosition`（`HairStrandsVertexFactory.ush:714-727`）：

```hlsl
float4 ComputeViewAlignedWorldPosition(
    FVertexFactoryInput Input,
    float3 WorldTangent,        // 发束切线方向（从TangentBuffer读取）
    float4 WorldPosition,       // 控制点世界位置
    float WorldStrandRadius,    // 发束半径
    FHairViewInfo HairViewInfo)
{
    FVertexInfo VertexInfo = GetVertexInfo(Input);

    // 1. 计算最小半径（防止走样）
    float DistanceToCamera = length(HairViewInfo.TranslatedWorldCameraOrigin - WorldPosition.xyz);
    float MinStrandHairRadius = ConvertGivenDepthRadiusForProjectionType(
        HairViewInfo.RadiusAtDepth1,
        DistanceToCamera,
        HairViewInfo.bIsOrthoView);

    // 2. 计算视图方向
    float3 ViewDir = -HairViewInfo.ViewForward;

    // 3. 计算右向量（垂直于切线和视线）
    float3 Right = normalize(cross(WorldTangent, ViewDir));

    // 4. 根据IsLeft标志向左或右偏移
    float3 OutWorldPosition = WorldPosition.xyz
        + (VertexInfo.IsLeft ? -Right : Right)
        * max(WorldStrandRadius, MinStrandHairRadius);

    return float4(OutWorldPosition, 1);
}
```

### 11.5 几何展开示意图

```
俯视图（从上往下看发束）：

        视线方向 (ViewDir)
             ↓
    ─────────●─────────    ← 相机位置
             |
             |
     Left    |    Right
       ←─────T─────→       ← 发束切线 (Tangent)
             ↑
          Right向量 = cross(Tangent, ViewDir)


侧视图（发束展开后）：

    控制点0          控制点1          控制点2
       ●───────────────●───────────────●      ← 中心线（原始曲线）
      /|              /|              /|
     / |             / |             / |
    ●──┼────────────●──┼────────────●  |      ← 左侧顶点 (IsLeft=1)
    |  |            |  |            |  |
    |  ●────────────|──●────────────|──●      ← 右侧顶点 (IsLeft=0)
    | /             | /             | /
    |/              |/              |/
    ●───────────────●───────────────●

    ←── 段0(2个三角形) ──→←── 段1(2个三角形) ──→
```

### 11.6 发束宽度计算

发束半径根据沿曲线的位置（UCoord）在根部和尖端之间插值：

```hlsl
// HairStrandsPack.ush
Out.WorldRadius = UnpackR6(BitFieldExtractU32(In.y, 6, 24));
Out.WorldRadius *= InVF_Radius * lerp(InVF_RootScale, InVF_TipScale, Out.UCoord);
```

示意：
```
根部 (UCoord=0)                              尖端 (UCoord=1)
    ████████                                      ▌
    ████████████                              ████
    ████████████████                      ████████
    ████████████████████              ████████████
    ████████████████████████      ████████████████
    ════════════════════════════════════════════════  ← 中心线
    ████████████████████████      ████████████████
    ████████████████████              ████████████
    ████████████████                      ████████
    ████████████                              ████
    ████████                                      ▌

    RootScale=1.0                          TipScale=0.1
```

### 11.7 发束间断处理（退化四边形原理）

#### 问题：如何在一次DrawCall中分隔多条发束？

所有发束的控制点存储在一个连续缓冲区中，GPU会尝试将相邻点连接成四边形。
如果不处理，**发束0的末端会错误地连接到发束1的起点**。

#### 解决方案：退化四边形

在发束交界处，将某些顶点位置设为**无穷大**，形成面积为零的三角形，GPU会自动剔除。

```hlsl
// HairStrandsVertexFactory.ush:220-223
const bool bIsInvalidQuad =
    (Out.Type == HAIR_CONTROLPOINT_START && VertexInfo.IsTip == 1) ||  // 起点的"下一个"
    (Out.Type == HAIR_CONTROLPOINT_END && VertexInfo.IsTip == 0);      // 终点的"当前"

// 将位置设为无穷大，GPU会剔除这些三角形
Out.Position = bIsInvalidQuad ? float3(INFINITE_FLOAT, INFINITE_FLOAT, INFINITE_FLOAT) : Out.Position;
```

#### 详细图解（发束竖向，从根部向下到尖端）

**缓冲区中的控制点排列：**
```
索引:     0        1        2        3        4
类型:   START   INSIDE    END     START     END
        ├────── 发束0 ──────┤      ├── 发束1 ──┤
```

**四边形生成过程：**

每个四边形需要读取**两个相邻控制点**（通过IsTip区分）：
- `IsTip=0` → 读取 `BaseIndex` 位置的控制点（四边形上边）
- `IsTip=1` → 读取 `BaseIndex+1` 位置的控制点（四边形下边）

```
                    Left        Right
                      │           │
    ════════════════════════════════════════════  头皮位置
                      ▼           ▼

    ┌─────────────────────────────────────────┐
    │               发 束 0                    │
    └─────────────────────────────────────────┘

    BaseIndex=0 时，读取 P0 和 P1：

         P0.L ●─────────────● P0.R     ← IsTip=0 读P0 (START) ✓正常
              │ ╲         ╱ │
              │   ╲ △0  ╱   │            四边形0
              │     ╲ ╱     │            2个三角形
              │  △1  ╳      │            正常绘制 ✓
              │    ╱   ╲    │
              │  ╱       ╲  │
         P1.L ●─────────────● P1.R     ← IsTip=1 读P1 (INSIDE) ✓正常


    BaseIndex=1 时，读取 P1 和 P2：

         P1.L ●─────────────● P1.R     ← IsTip=0 读P1 (INSIDE) ✓正常
              │ ╲         ╱ │
              │   ╲ △2  ╱   │            四边形1
              │     ╲ ╱     │            2个三角形
              │  △3  ╳      │            正常绘制 ✓
              │    ╱   ╲    │
              │  ╱       ╲  │
         P2.L ●─────────────● P2.R     ← IsTip=1 读P2 (END) ✓正常


    BaseIndex=2 时，读取 P2 和 P3：  ⚠️ 这是跨发束的危险区域！

         P2.L ●─────────────● P2.R     ← IsTip=0 读P2 (END)
              ┆             ┆              ↓
              ┆  如果不退化  ┆            P2.Type == END 且 IsTip == 0
              ┆  这里会画线  ┆              ↓
              ┆  连接两条    ┆            触发退化条件！
              ┆  不同的发束  ┆              ↓
              ┆             ┆            位置设为 ∞
              ┆             ┆
           ∞  ┆ · · · · · · ┆ ∞        ← IsTip=0 时 P2 位置变成无穷大
              ┆             ┆            GPU剔除这个四边形 ✗
              ┆             ┆
         P3.L ●─────────────● P3.R     ← IsTip=1 读P3 (START) ✓正常
                                          但四边形已经被退化，不会绘制


    ┌─────────────────────────────────────────┐
    │               发 束 1                    │
    └─────────────────────────────────────────┘

    BaseIndex=3 时，读取 P3 和 P4：

           ∞  ┆ · · · · · · ┆ ∞        ← IsTip=0 读P3 (START)
              ┆             ┆              ↓
              ┆             ┆            P3.Type == START 且 IsTip == 1
              ┆             ┆            （注意：这是上一个四边形的下边）
              ┆             ┆              ↓
              ┆             ┆            不不不，这里IsTip=0
              ┆             ┆            START且IsTip=1才退化
         P3.L ●─────────────● P3.R         所以P3正常 ✓
              │ ╲         ╱ │
              │   ╲ △4  ╱   │            四边形3
              │     ╲ ╱     │            2个三角形
              │  △5  ╳      │            正常绘制 ✓
              │    ╱   ╲    │
              │  ╱       ╲  │
         P4.L ●─────────────● P4.R     ← IsTip=1 读P4 (END) ✓正常

                      │
                      ▼
    ════════════════════════════════════════════  发束尖端
```

**退化条件总结：**

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   读取的控制点类型        IsTip值        结果                  │
│   ─────────────────────────────────────────────────────        │
│   END                     0              → 设为∞ (退化)        │
│   END                     1              → 正常                │
│   START                   0              → 正常                │
│   START                   1              → 设为∞ (退化)        │
│   INSIDE                  0/1            → 正常                │
│                                                                │
│   解释：                                                        │
│   • END+IsTip=0：表示四边形上边是发束末端，                     │
│                  下边会连到下一发束，必须切断                   │
│   • START+IsTip=1：表示四边形下边是发束起点，                   │
│                    上边来自上一发束，必须切断                   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**形象比喻：**

```
想象你在用一条连续的丝带缠绕：

    正常情况：丝带连续缠绕
    ══╗   ╔══
      ║   ║
      ╚═══╝

    退化处理：在发束交界处"剪断"丝带
    ══╗
      ║   ← 发束0结束
      ╳   ← 剪断！（位置设为无穷大，GPU不绘制）
      ║   ← 发束1开始
      ╚═══
```

### 11.8 抗锯齿处理

为防止发束过细导致走样，引擎会根据相机距离计算最小像素半径：

```hlsl
float MinStrandHairRadius = ConvertGivenDepthRadiusForProjectionType(
    HairViewInfo.RadiusAtDepth1,  // 深度为1时的半径（像素单位）
    DistanceToCamera,              // 到相机的距离
    HairViewInfo.bIsOrthoView);    // 是否正交投影

// 使用较大值，确保发束至少占据一定像素宽度
float FinalRadius = max(WorldStrandRadius, MinStrandHairRadius);
```

### 11.9 图元类型总结

| 配置 | 图元类型 | 每控制点顶点数 | 每段三角形数 | 优点 |
|------|----------|---------------|-------------|------|
| Triangle Strip | `PT_TriangleStrip` | 2 | 2（共享边） | 内存占用低，顶点着色器调用少 |
| Triangle List | `PT_TriangleList` | 6 | 2（独立） | 更灵活，便于调试 |

通过CVar `r.HairStrands.UsesTriangleStrips` 控制模式选择。
