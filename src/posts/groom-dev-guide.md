---
title: "UE Groom 毛发系统开发指南"
cat: UE 剖析
sub: 角色
date: 2026-01-19
mins: 20
tags: [Groom, 工作流]
---

> 面向 3A 主机游戏的毛发制作流程、使用注意事项和性能优化

---

## 目录

1. [Groom 系统概述](#1-groom-系统概述)
2. [制作流程](#2-制作流程)
3. [导入和配置](#3-导入和配置)
4. [绑定系统](#4-绑定系统)
5. [LOD 系统](#5-lod-系统)
6. [物理模拟](#6-物理模拟)
7. [渲染设置](#7-渲染设置)
8. [实际使用注意事项](#8-实际使用注意事项)
9. [性能优化](#9-性能优化)
10. [平台适配](#10-平台适配)
11. [常见问题排查](#11-常见问题排查)

---

## 1. Groom 系统概述

### 1.1 什么是 Groom

Groom 是 Unreal Engine 的毛发系统，支持头发、胡须、眉毛、皮毛等毛发效果的渲染和模拟。

### 1.2 三种几何类型

| 类型 | 描述 | 性能 | 质量 | 适用场景 |
|------|------|------|------|----------|
| **Strands** | 真实的发丝几何体 | 低 | 最高 | 主角特写、过场动画 |
| **Cards** | 片状卡片几何体 | 高 | 中等 | 游戏实时、NPC |
| **Meshes** | 网格几何体 | 最高 | 较低 | 远距离 LOD、低端设备 |


### 1.3 核心资产结构

```
Groom 资产体系：

├── UGroomAsset            ← 主毛发资产
│   ├── Hair Groups        ← 毛发组（可多个）
│   ├── LOD Settings       ← LOD 配置
│   ├── Physics Settings   ← 物理配置
│   └── Rendering Settings ← 渲染配置
│
├── UGroomBindingAsset     ← 绑定资产（连接毛发和骨骼）
│   ├── Source Mesh        ← 源网格
│   ├── Target Mesh        ← 目标网格
│   └── Binding Type       ← 绑定类型
│
├── UGroomCache            ← 毛发缓存（预烘焙动画）
│
└── UGroomComponent        ← 组件（场景中使用）
```

---

## 2. 制作流程

### 2.1 DCC 软件制作

#### 支持的软件

| 软件 | 导出格式 | 推荐度 |
|------|----------|--------|
| **Maya + XGen** | .abc (Alembic) | ⭐⭐⭐⭐⭐ |
| **Houdini** | .abc (Alembic) | ⭐⭐⭐⭐ |
| **Blender** | .abc (Alembic) | ⭐⭐⭐ |
| **3ds Max** | .abc (Alembic) | ⭐⭐⭐ |

#### XGen 制作流程（推荐）

> 详细制作流程另见团队内部《XGen 毛发制作规范》美术文档（未公开）。

#### 毛发属性要求

```cpp
// UE 识别的 Alembic 属性
必需属性：
├── P (Position)      // 顶点位置
└── NumVertices       // 每条曲线的顶点数

可选属性：
├── width             // 毛发宽度
├── Cd / color        // 顶点颜色
├── groom_id          // 毛发组 ID
├── groom_color       // 组颜色
├── groom_guide       // 引导线标记
├── groom_root_uv     // 根部 UV
└── groom_closest_guide // 最近引导线索引
```

#### CV 数量建议

| 毛发类型 | CV 数量 | 说明 |
|----------|---------|------|
| 游戏直发 | <30 | 足够表现直发形态 |
| 游戏卷发 | 40-50 | 需要更多点表现弯曲 |
| 影视级卷发 | <80 | 高精度曲线 |

**优化技巧**：可以先将密度减半、宽度翻倍作为起点，再根据视觉效果调整。

### 2.2 导入到 UE

#### 导入类型

| 导入方式 | 生成资产 | 用途 |
|----------|----------|------|
| 单帧导入 | Groom Asset | 静态毛发 |
| 多帧导入 | Groom Asset + guides_cache + strands_cache | 预烘焙动画 |

**多帧导入说明**：
- `guides_cache`：记录引导线位置，需开启 Simulation 才能使用
- `strands_cache`：记录发丝位置，直接播放缓存动画

#### 导入选项

```
Import Groom 对话框：

Build Settings:
├── Override Guides: 是否覆盖引导线
├── Hair to Guide Density: 毛发到引导线的密度比
└── Interpolation Quality: 插值质量（Low/Medium/High）

Conversion Settings:
├── Rotation: 坐标系旋转
├── Scale: 缩放
└── Apply to Root: 是否应用到根部
```

### 2.3 制作 Cards（卡片）

#### 两种来源

```cpp
enum class EHairCardsSourceType : uint8
{
    Procedural,  // 程序化生成
    Imported     // 外部导入
};
```

#### 程序化 Cards 设置

> ⚠️ 需要启用插件：**Hair Card Generator**（Edit → Plugins → Hair Card Generator）

```
Cards Generation Settings:

├── Cards Count: 卡片数量
├── Cards Width: 卡片宽度
├── Cards Length: 卡片长度
├── Guide Influence Radius: 引导线影响半径
└── Texture Layout: 纹理布局
```

### 2.4 Cards 纹理布局

#### 布局类型对比

| 布局 | 纹理数 | 优点 | 缺点 | 适用场景 |
|------|--------|------|------|----------|
| **Card Default** | 6 | 精度高、数据完整、调试方便 | 内存占用大 | 主角、高品质 Cards |
| **Card Compact** | 3 | 内存省一半 | 丢失 RootUV/Auxiliary | NPC、中等品质 Cards |
| **Mesh Default** | 6 | 支持 GroupID | 内存占用大 | 高品质 Meshes |
| **Mesh Compact** | 3 | 紧凑 + GroupID | 丢失 Color.B、Roughness | 低品质 Meshes |

> ⚠️ 切换布局需要重新生成 Cards 纹理（右键 Cards LOD → Generate Textures）

#### Card Default（6张纹理）

| 纹理 | 格式 | R | G | B | A |
|------|------|---|---|---|---|
| Depth | R8 | 深度值 | - | - | - |
| Coverage | R8 | 覆盖度 | - | - | - |
| Tangent | RGB8 | TangentX | TangentY | TangentZ | - |
| Attributes | RGB8 | RootUV.x | CoordU | Seed | - |
| Material | RGBA8 | Color.R | Color.G | Color.B | Roughness |
| Auxiliary | RGBA8 | 自定义 | 自定义 | 自定义 | 自定义 |

#### Card Compact（3张纹理）

| 纹理 | 格式 | R | G | B | A |
|------|------|---|---|---|---|
| TangentCoordU | RGBA8 | TangentX | TangentY | TangentZ | CoordU |
| CoverageDepthSeed | RGB8 | Coverage | Depth | Seed | - |
| ColorRoughness | RGBA8 | Color.R | Color.G | Color.B | Roughness |

#### Mesh Default（6张纹理）

与 Card Default 相同，但 Material.A 存储 **GroupID** 而非 Roughness。

#### Mesh Compact（3张纹理）

| 纹理 | 格式 | R | G | B | A |
|------|------|---|---|---|---|
| TangentCoordU | RGB8 | TangentX | TangentY | TangentZ | - |
| ColorXYDepthGroupID | RGBA8 | Color.R | Color.G | Depth | GroupID |
| RootUVSeedCoverage | RGBA8 | RootUV.x | RootUV.y | Seed | Coverage |

#### 各属性用途

| 属性 | 用途 |
|------|------|
| Depth | 视差映射，模拟发丝层次感 |
| Coverage | Alpha 遮罩，发丝边缘透明度 |
| Tangent | 光照计算，各向异性高光方向 |
| CoordU | 沿发丝方向的 UV（根部→发梢渐变） |
| RootUV | 发丝根部在头皮上的 UV 位置 |
| Seed | 随机种子，材质中的随机变化 |
| GroupID | 毛发组 ID，区分不同区域 |
| Auxiliary | 预留自定义数据 |

#### Card Default 为什么只存 RootUV.x？

Card Default 的 Attributes 纹理中只存储了 `RootUV.x`，而非完整的 `RootUV.xy`。原因如下：

1. **Cards 的 RootUV 主要从顶点属性获取**
   ```hlsl
   // HairCardsVertexFactory.ush:237-244
   void GetRootUVsAtlasUVs(...)
   {
       const float4 UVs = HairCardsVF.UVsBuffer[UVFetchIndex];
       OutRootUV  = UVs.xy;   // 完整的 RootUV (x, y) 从顶点 Buffer 读取
       OutAtlasUV = UVs.zw;   // 用于纹理采样的 Atlas UV
   }
   ```

2. **Card Default 实际不支持从纹理采样 RootUV**
   ```hlsl
   // HairCardsAttributeCommon.ush:46
   case EHairCardsVFAttribute_RootUV: return LAYOUT_VALUES(InLayoutIndex, 9, 3, 9, 2);
   // Layout0(Card Default) = 9 表示无效索引，即不支持纹理采样
   ```

3. **Cards 几何体有规整的 UV 布局**，每个顶点都包含了完整的 RootUV 信息。纹理中的 `RootUV.x` 只是一个辅助值，用于某些特殊的逐像素效果，精度要求不高。

4. **Mesh Compact 需要完整的 RootUV.xy** 是因为 Meshes 是预烘焙的静态几何体，没有 Cards 那样规整的顶点数据结构，必须通过纹理来获取根部位置信息。

> 总结：如果你的材质需要使用精确的 RootUV 进行头皮位置相关的效果（如根部渐变色），Cards 可以直接使用顶点属性中的数据，无需担心纹理精度问题。

---

## 3. 导入和配置

### 3.1 Hair Groups 分组原则

**核心原则**：Hair Groups 应按**身体部位/区域**进行划分，以便为不同区域设置独立的物理、渲染和 LOD。

#### 分组内部结构

每个 Hair Group 内部都应包含：

```
Hair Group 内部结构：

├── Guides（导线）     ← 用于物理模拟，数量较少
│
└── Strands（发丝）    ← 用于渲染，插值跟随导线
```

导线控制物理行为，渲染发丝根据导线插值生成最终效果。

#### 常规分组（推荐）

大多数情况下，2-3 个分组即可满足需求：

```
├── Group 0: 主体发丝 (Main Hair)
│   └── 大部分头发，统一物理和渲染设置
│
└── Group 1: 辫子/马尾 (Braids/Ponytail)  ← 如有需要
    └── 需要独立物理的长发部分
```

#### 高品质分组（主角特写）

对于需要极致效果的主角，可按区域细分：

```
├── Group 0: 头顶 (Top)        ← 较硬，轻微摆动
├── Group 1: 刘海 (Bangs)      ← 靠近面部，高优先级
├── Group 2: 两侧 (Sides)      ← 中等刚度
├── Group 3: 后部 (Back)       ← 较柔软，大幅摆动
├── Group 4: 辫子 (Braids)     ← 需要碰撞，大幅运动
└── Group 5: 碎发 (Baby Hair)  ← 很柔软，可选关闭
```

#### 按区域分组的优势

| 优势 | 说明 |
|------|------|
| **独立物理** | 辫子需要碰撞和大幅摆动，头顶相对固定 |
| **独立 LOD** | 刘海保持高质量，后部可大幅简化 |
| **独立渲染** | 不同区域可使用不同材质、宽度 |
| **独立控制** | 运行时可单独开关某区域的模拟 |

### 3.2 插值设置

#### 为什么需要插值？

Groom 系统采用 **Guides + Strands** 的两层架构来平衡质量与性能：

```
Groom 发丝架构：

Guides（导线）                    Strands（渲染发丝）
   │                                    │
   ├── 数量少（几百~几千根）              ├── 数量多（数万~数十万根）
   ├── 参与物理模拟                      ├── 不参与物理模拟
   └── 作为骨架控制周围发丝              └── 根据周围导线插值得到位置
                    │
                    ▼
            插值系统（Interpolation）
            将少量 Guides 的运动传递给大量 Strands
```

**核心思想**：只对少量 Guides 做昂贵的物理模拟，然后通过插值让大量渲染发丝跟随 Guides 运动。这样既能保证视觉上的发丝密度，又能将模拟开销控制在合理范围内。

**插值过程**：
1. 每根渲染发丝找到影响它的 1-3 根最近导线
2. 根据距离计算每根导线的权重
3. 运行时根据导线的变形对渲染发丝进行插值变形

**源码位置**：`GroomAssetInterpolation.h`

```cpp
// 插值质量（决定寻找最近导线的精度）
enum class EHairInterpolationQuality : uint8
{
    Low,     // 低质量，快速（使用近似搜索）
    Medium,  // 中等质量
    High     // 高质量，慢速（精确搜索最近导线）
};

// 插值权重类型（决定权重如何随距离衰减）
enum class EHairInterpolationWeight : uint8
{
    Parametric,  // 参数化权重（沿发丝长度方向也考虑权重变化）
    Root,        // 根部权重（只考虑根部距离）
    Index        // 索引权重（固定索引映射）
};
```

**配置建议**：

| 场景 | 插值质量 | 权重类型 | 说明 |
|------|----------|----------|------|
| 主角 | High | Parametric | 最精确，发丝跟随自然 |
| 重要 NPC | Medium | Parametric | 平衡质量与性能 |
| 普通 NPC | Low | Root | 快速，远景足够 |

> ⚠️ **插值设置不支持运行时修改**
>
> 插值数据是**预构建**的，存储在资产的 `InterpolationBulkData` 中：
> - **Low 质量**：构建需要几分钟（最近邻搜索）
> - **Medium 质量**：构建需要十几分钟（限定范围内的曲线形状匹配）
> - **High 质量**：构建需要几十分钟（完整曲线形状匹配）
>
> 修改插值设置后需要在编辑器中重新构建资产，因此应在制作阶段确定好插值质量，而非运行时动态调整。

---

## 4. 绑定系统

### 4.1 绑定类型

**源码位置**：`GroomBindingAsset.h`

```cpp
// 绑定目标类型
enum class EGroomBindingMeshType : uint8
{
    SkeletalMesh,    // 骨骼网格
    GeometryCache    // 几何缓存（Alembic 动画）
};
```

### 4.2 创建绑定

#### 编辑器创建

```
1. 右键 Groom Asset → Create Binding
2. 选择目标 Skeletal Mesh
3. 设置绑定参数
4. 点击创建
```

#### 蓝图/C++ 创建

```cpp
// 使用 Blueprint Library
UGroomBindingAsset* Binding = UGroomBlueprintLibrary::CreateNewGroomBindingAsset(
    GroomAsset,           // Groom 资产
    SkeletalMesh,         // 目标骨骼网格
    NumInterpolationPoints,
    SourceSkeletalMesh,   // 源骨骼网格（可选）
    MatchingSection
);
```

### 4.3 绑定参数

```
Binding Settings:

├── Num Interpolation Points: 插值点数量（影响精度）
├── Matching Section: 匹配的网格段
├── Source Skeletal Mesh: 源网格（制作时的网格）
└── Target Skeletal Mesh: 目标网格（运行时的网格）

绑定类型：
├── Rigid: 刚体跟随骨骼
└── Skinning: 蒙皮跟随皮肤表面
```

### 4.4 绑定原理

绑定资产存储了毛发在目标骨骼网格上的投影信息：
- 计算每根发丝根部与蒙皮网格最近三角形的**重心坐标**
- 运行时根据三角形变形，插值计算发丝根部位置

### 4.5 RBF 插值（面部表情）

对于面部毛发（眉毛、睫毛、胡须），启用 **RBF（Radial Basis Function）** 约束可防止极端表情时毛发散开：

```
Groom Asset → Hair Groups → [选择组] → Global Interpolation
└── Enable RBF Interpolation: ✅
```

**作用**：在面部做出极端表情时，保持毛发的自然变形，避免发丝分散。

### 4.6 绑定注意事项

```
⚠️ 重要：

1. 源网格和目标网格拓扑应该相似
2. UV 布局必须匹配
3. 绑定后修改网格需要重新绑定
4. 绑定编译是异步的，注意等待完成
5. 面部毛发建议开启 RBF 插值
```

---

## 5. LOD 系统

### 5.1 LOD 配置

**源码位置**：`GroomAssetInterpolation.h`

```cpp
struct FHairLODSettings
{
    // 曲线抽取比例（0-1）
    float CurveDecimation = 1.0f;

    // 顶点抽取比例（0-1）
    float VertexDecimation = 1.0f;

    // 角度阈值（度）
    float AngularThreshold = 1.0f;

    // 屏幕大小阈值
    float ScreenSize = 1.0f;

    // 厚度缩放
    float ThicknessScale = 1.0f;

    // 几何类型
    EGroomGeometryType GeometryType;  // Strands/Cards/Meshes

    // 是否可见
    bool bVisible = true;
};
```

### 5.2 LOD 模式

```cpp
enum class EGroomLODMode : uint8
{
    Default,  // 使用项目设置
    Manual,   // 手动配置每个 LOD
    Auto      // 自动根据屏幕覆盖计算
};
```

### 5.3 推荐 LOD 配置

```
3A 游戏推荐 LOD 设置：

LOD 0（特写）:
├── 几何类型: Strands
├── 曲线抽取: 1.0
├── 顶点抽取: 1.0
├── 屏幕大小: > 0.5
└── 模拟: 开启

LOD 1（中景）:
├── 几何类型: Strands
├── 曲线抽取: 0.5
├── 顶点抽取: 0.5
├── 屏幕大小: 0.2 - 0.5
└── 模拟: 开启（简化）

LOD 2（远景）:
├── 几何类型: Cards
├── 屏幕大小: 0.05 - 0.2
└── 模拟: 关闭

LOD 3（极远）:
├── 几何类型: Meshes
├── 屏幕大小: < 0.05
└── 模拟: 关闭
```

### 5.4 LOD 过渡

```cpp
// 组件中设置 LOD 偏差
GroomComponent->SetLODBias(LODBias);

// 强制 LOD
GroomComponent->SetForcedLOD(LODIndex);
```

---

## 6. 物理模拟

### 6.1 物理系统架构

**源码位置**：`GroomAssetPhysics.h`

```
Groom 物理架构：

├── Niagara 求解器
│   ├── Cosserat Rods（推荐）
│   ├── Angular Springs
│   └── Custom
│
├── 约束系统
│   ├── 弯曲约束
│   ├── 拉伸约束
│   └── 碰撞约束
│
└── 外力系统
    ├── 重力
    ├── 风力
    └── 空气阻力
```

### 6.2 求解器设置

```cpp
struct FHairSolverSettings
{
    // 启用变形
    bool bEnableDeformation = true;

    // 启用模拟
    bool EnableSimulation = true;

    // 求解器类型
    ENiagaraSolverType NiagaraSolver = ENiagaraSolverType::CosseratRods;

    // 子步数（越高越稳定，越慢）
    int32 SubSteps = 2;

    // 约束迭代次数
    int32 IterationCount = 5;

    // 重力预加载（初始化时施加重力的帧数）
    int32 GravityPreloading = 3;
};
```

### 6.3 物理约束

```cpp
// 弯曲约束
struct FHairBendConstraint
{
    float Stiffness = 0.01f;           // 刚度
    float Damping = 0.0f;              // 阻尼
    FRuntimeFloatCurve StiffnessScale; // 沿发丝的刚度曲线
};

// 拉伸约束
struct FHairStretchConstraint
{
    float Stiffness = 1.0f;            // 刚度
    float Damping = 0.0f;              // 阻尼
    FRuntimeFloatCurve StretchScale;   // 沿发丝的拉伸曲线
};

// 碰撞约束
struct FHairCollisionConstraint
{
    float StaticFriction = 0.1f;       // 静摩擦
    float KineticFriction = 0.05f;     // 动摩擦
    float CollisionRadius = 0.1f;      // 碰撞半径
    bool bSelfCollision = false;       // 自碰撞
};
```

### 6.4 外力设置

```cpp
struct FHairExternalForces
{
    FVector GravityVector = FVector(0, 0, -981.0f);  // 重力
    float AirDrag = 0.1f;                             // 空气阻力
    FVector AirVelocity = FVector::ZeroVector;        // 风速
};
```

### 6.5 推荐物理配置

```
主角头发（高质量）：
├── 求解器: Cosserat Rods
├── 子步数: 3
├── 迭代次数: 8
├── 弯曲刚度: 0.005 - 0.02
├── 拉伸刚度: 1.0
├── 碰撞: 开启
└── 自碰撞: 可选（性能消耗大）

NPC 头发（中等质量）：
├── 求解器: Angular Springs
├── 子步数: 2
├── 迭代次数: 4
├── 弯曲刚度: 0.01 - 0.05
├── 拉伸刚度: 1.0
└── 碰撞: 简化

远景/低优先级（低质量）：
└── 模拟: 关闭
```

### 6.6 碰撞设置

```cpp
// 添加碰撞体
GroomComponent->AddCollisionComponent(CapsuleComponent);

// 或在蓝图中设置 Physics Asset
GroomComponent->SetPhysicsAsset(PhysicsAsset);
```

---

## 7. 渲染设置

### 7.1 几何设置

**源码位置**：`GroomAssetRendering.h`

```cpp
struct FHairGeometrySettings
{
    float HairWidth = 0.01f;           // 毛发宽度（厘米）
    float HairRootScale = 1.0f;        // 根部宽度缩放
    float HairTipScale = 0.1f;         // 尖端宽度缩放
};
```

### 7.2 阴影设置

```cpp
struct FHairShadowSettings
{
    float HairShadowDensity = 1.0f;              // 阴影密度
    float HairRaytracingRadiusScale = 1.0f;     // 光追半径缩放
    bool bUseHairRaytracingGeometry = true;     // 使用光追几何体
    bool bVoxelize = true;                       // 体素化（用于阴影/AO）
};
```

### 7.3 高级渲染设置

```cpp
struct FHairAdvancedRenderingSettings
{
    bool bUseStableRasterization = false;   // 稳定光栅化（抗锯齿）
    bool bScatterSceneLighting = false;     // 散射场景光照
};
```

### 7.4 材质配置

```
Groom 材质类型：

Strands 材质：
├── Shading Model: Hair
├── Blend Mode: Opaque
├── 输入：
│   ├── Base Color: 发色
│   ├── Roughness: 粗糙度
│   ├── Scatter: 散射
│   └── Tangent: 切线（可选）

Cards 材质：
├── Shading Model: Default Lit / Hair
├── Blend Mode: Masked
├── 输入：
│   ├── Base Color: 发色纹理
│   ├── Opacity Mask: Alpha 遮罩
│   ├── Normal: 法线贴图
│   └── Depth: 深度贴图（视差）

Meshes 材质：
├── Shading Model: Default Lit
└── 标准 PBR 材质
```

---

## 8. 实际使用注意事项

### 8.1 资产管理

```
⚠️ 重要注意事项：

1. Groom Asset 和 Binding Asset 是分开的
   └── 修改 Skeletal Mesh 后需要重建 Binding

2. 异步编译
   └── Binding 编译是异步的，注意等待完成再使用

3. 内存管理
   └── Strands 内存消耗大，注意资源预算

4. 版本兼容
   └── UE 版本升级可能需要重新导入
```

### 8.2 组件使用

```cpp
// 正确的组件设置顺序
void SetupGroomComponent(UGroomComponent* GroomComp)
{
    // 1. 设置 Groom Asset
    GroomComp->SetGroomAsset(GroomAsset);

    // 2. 设置 Binding Asset
    GroomComp->SetBindingAsset(BindingAsset);

    // 3. 设置 Physics Asset（可选）
    GroomComp->SetPhysicsAsset(PhysicsAsset);

    // 4. 附着到骨骼组件
    GroomComp->AttachToComponent(SkeletalMeshComp,
        FAttachmentTransformRules::KeepRelativeTransform);

    // 5. 注册组件
    GroomComp->RegisterComponent();
}
```

### 8.3 运行时控制

```cpp
// 重置模拟
GroomComponent->ResetSimulation();

// 启用/禁用模拟
FHairSimulationSettings SimSettings;
SimSettings.bOverrideSettings = true;
SimSettings.SolverSettings.EnableSimulation = bEnable;
GroomComponent->SetSimulationSettings(SimSettings);

// 设置 LOD 偏差
GroomComponent->SetLODBias(Bias);
```

### 8.4 常见陷阱

```
❌ 常见错误：

1. 忘记设置 Binding Asset
   → 毛发不跟随角色

2. 源网格和目标网格不匹配
   → 绑定失败或变形错误

3. 物理设置过于激进
   → 模拟不稳定、穿模

4. LOD 切换不平滑
   → 视觉跳变

5. 同时启用太多 Strands 角色
   → 性能暴跌
```

### 8.5 角色蓝图中的 Groom 组件配置

#### 组件结构示例

```
角色蓝图 Groom 组件布局：

BP_Character
├── SkeletalMeshComponent (Body)
│
├── GroomComponent_Hair      ← 头发
├── GroomComponent_Beard     ← 胡须（如有）
├── GroomComponent_Eyebrows  ← 眉毛
└── GroomComponent_Eyelashes ← 睫毛
```

#### Culling 设置

每个 Groom 组件都应根据部位重要性配置剔除距离：

| 部位 | Bounds Scale | Detail Mode | 说明 |
|------|--------------|-------------|------|
| 头发 | 1.2 | High | 始终可见，适当放大包围盒 |
| 胡须 | 1.0 | High | 近距离可见 |
| 眉毛 | 1.0 | Medium | 中等距离剔除 |
| 睫毛 | 0.8 | Low | 可较早剔除 |

```cpp
// 蓝图/C++ 中设置 Culling
void SetupGroomCulling(UGroomComponent* GroomComp, EDetailMode DetailMode)
{
    // 包围盒缩放（影响剔除判定）
    GroomComp->SetBoundsScale(1.2f);

    // Detail Mode: Low/Medium/High
    // Low = 最先被剔除，High = 最后被剔除
    GroomComp->SetDetailMode(DetailMode);

    // 可见性距离（可选，0 = 无限制）
    GroomComp->SetCullDistance(5000.0f);  // 50米
}
```

#### 按角色等级配置

不同重要性的角色应使用不同的 Groom 设置：

```
角色等级配置：

┌─────────────────────────────────────────────────────────────────┐
│ 主角 (Hero)                                                      │
├─────────────────────────────────────────────────────────────────┤
│ LOD Bias: 0 (最高质量)                                           │
│ 物理模拟: 完整                                                    │
│ Visible in Ray Tracing: true                                     │
│ Visible in Reflections: true                                     │
│ Cast Shadow: true                                                │
│ Self Shadow: true                                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Boss / 重要 NPC                                                  │
├─────────────────────────────────────────────────────────────────┤
│ LOD Bias: 1 (稍低质量)                                           │
│ 物理模拟: 简化                                                    │
│ Visible in Ray Tracing: true                                     │
│ Visible in Reflections: true                                     │
│ Cast Shadow: true                                                │
│ Self Shadow: false                                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 普通 NPC / 小兵                                                  │
├─────────────────────────────────────────────────────────────────┤
│ LOD Bias: 2-3 (较低质量，优先使用 Cards)                          │
│ 物理模拟: 关闭                                                    │
│ Visible in Ray Tracing: false                                    │
│ Visible in Reflections: false                                    │
│ Cast Shadow: false 或 距离限制                                   │
│ Self Shadow: false                                               │
└─────────────────────────────────────────────────────────────────┘
```

#### 性能相关设置

> 📘 **详细的性能配置请参考**：《Groom 性能配置指南》（团队内部文档，未公开）
>
> 包含完整的角色等级配置代码、LOD 参数详解、物理模拟优化、平台适配、Scalability 设置等。

**快速参考**：

| 设置项 | 主角 | Boss | NPC | 小兵 |
|--------|------|------|-----|------|
| LOD Bias | 0 | 1 | 2 | 3 |
| 物理模拟 | 完整 | 简化 | 关闭 | 关闭 |
| Ray Tracing | ✅ | ✅ | ❌ | ❌ |
| Cast Shadow | ✅ | ✅ | ✅ | ❌ |

---

## 9. 性能优化

> 📘 **完整的性能优化指南请参考**：《Groom 性能配置指南》（团队内部文档，未公开）

### 9.1 优化要点速查

| 优化方向 | 关键措施 |
|----------|----------|
| **GPU** | 减少发丝数（CurveDecimation）、减少顶点（VertexDecimation）、启用 Cluster Culling |
| **CPU** | 降低物理迭代（SubSteps/IterationCount）、关闭自碰撞、远景关闭物理 |
| **内存** | 使用 Cards 代替 Strands、使用 Compact 纹理布局、共享 Groom Asset |

### 9.2 性能预算参考

```
3A 主机游戏性能预算（PS5/XSX）：

毛发系统总预算: ≤ 5ms

├── 主角: 2-3ms（Strands ≤ 100,000 根，完整物理）
├── 重要 NPC: 每个 0.5-1ms（Strands/Cards 混合）
└── 普通 NPC: 每个 0.1-0.3ms（Cards 为主，无物理）
```

---

## 10. 平台适配

> 📘 **完整的平台配置和 Scalability 设置请参考**：《Groom 性能配置指南》（团队内部文档，未公开）

### 10.1 平台支持矩阵

| 平台 | Strands | Cards | Meshes | 物理 |
|------|---------|-------|--------|------|
| **PC (High) / PS5 / XSX** | ✅ | ✅ | ✅ | ✅ |
| **PS4 Pro / Xbox One X** | ⚠️ 限制 | ✅ | ✅ | ⚠️ 简化 |
| **Nintendo Switch** | ❌ | ✅ | ✅ | ❌ |
| **Mobile** | ❌ | ⚠️ | ✅ | ❌ |

### 10.2 平台适配要点

| 平台 | 推荐几何类型 | 最大发丝数 | 物理设置 |
|------|--------------|------------|----------|
| PS5 / XSX | Strands | 100,000 | 完整 |
| PS4 / XB1 | Cards + 简化 Strands | 30,000 | 简化 |
| Switch | Cards only | - | 关闭 |
| Mobile | Meshes only | - | 关闭 |

---

## 11. 常见问题排查

### 11.1 毛发不显示

```
检查清单：

□ Groom Asset 是否正确设置
□ Binding Asset 是否创建并设置
□ 组件是否正确附着到骨骼组件
□ LOD 设置是否正确（检查 bVisible）
□ 材质是否正确指派
□ 渲染设置是否启用毛发渲染
```

### 11.2 毛发不跟随角色

```
检查清单：

□ Binding Asset 是否匹配当前 Skeletal Mesh
□ 源网格和目标网格是否匹配
□ 组件附着关系是否正确
□ Binding 编译是否完成
```

### 11.3 物理模拟不稳定

```
检查清单：

□ 子步数是否足够（增加 SubSteps）
□ 约束刚度是否过高
□ 时间步是否稳定（避免帧率波动）
□ 碰撞体是否合理
□ 重力预加载是否设置
```

### 11.4 性能问题

```
排查步骤：

1. 使用 stat HairStrands 查看性能数据

2. 检查 Strands 数量
   └── 控制台：r.HairStrands.DebugMode 1

3. 检查 LOD 切换
   └── 确保远距离使用 Cards/Meshes

4. 检查物理消耗
   └── stat Physics

5. 检查 GPU 时间
   └── ProfileGPU
```

### 11.5 调试命令

```cpp
// 常用控制台命令

// 显示毛发调试信息
r.HairStrands.DebugMode 1

// 显示 LOD 信息
r.HairStrands.LODForcedIndex -1  // 自动
r.HairStrands.LODForcedIndex 0   // 强制 LOD 0

// 禁用毛发渲染
r.HairStrands.Enable 0

// 禁用毛发物理
r.HairStrands.Simulation 0

// 显示绑定调试
r.HairStrands.BindingDebug 1
```

---

## 附录：关键源码文件

| 文件路径 | 功能 |
|----------|------|
| `HairStrands/Source/HairStrandsCore/Public/GroomAsset.h` | 主 Groom 资产 |
| `HairStrands/Source/HairStrandsCore/Public/GroomBindingAsset.h` | 绑定资产 |
| `HairStrands/Source/HairStrandsCore/Public/GroomComponent.h` | Groom 组件 |
| `HairStrands/Source/HairStrandsCore/Public/GroomAssetPhysics.h` | 物理设置 |
| `HairStrands/Source/HairStrandsCore/Public/GroomAssetRendering.h` | 渲染设置 |
| `HairStrands/Source/HairStrandsCore/Public/GroomAssetInterpolation.h` | LOD 和插值 |
| `HairStrands/Source/HairStrandsCore/Public/GroomAssetCards.h` | Cards 系统 |
| `HairStrands/Source/HairStrandsCore/Public/GroomCache.h` | 缓存系统 |
| `HairStrands/Source/HairStrandsCore/Public/GroomBlueprintLibrary.h` | 蓝图库 |

---

## 更新日志

- **2026-01-16**：初版创建，基于 UE5 HairStrands 系统源码分析
- **2026-01-19**：将 DCC 示例从 Houdini 改为 XGen，精简代码示例
- **2026-01-19**：补充 CV 数量建议、多帧导入说明、绑定原理和 RBF 插值
- **2026-01-19**：补充 Cards 纹理布局详解（4种布局的通道定义和选择建议）
- **2026-01-19**：将性能相关设置提取到独立文档 《Groom 性能配置指南》（团队内部文档，未公开）
