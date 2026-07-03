---
title: "UE Mass 框架"
cat: 引擎定制
date: 2026-03-24
mins: 18
---

> UE 内置的 ECS（Entity-Component-System）框架，专为大规模实体模拟设计（万级 NPC/Crowd），以数据驱动、缓存友好的方式批量处理实体。

---

## 1. 模块结构

Mass 框架由一个核心运行时模块和多个 Gameplay/AI 插件组成：

```
Engine/Source/Runtime/MassEntity/              ← 核心 ECS 运行时（5.7 已从插件移入引擎）
Engine/Plugins/Runtime/MassGameplay/           ← Gameplay 层
  ├─ MassActors          Actor 代理
  ├─ MassCommon          通用 Fragment
  ├─ MassLOD             距离 LOD 系统
  ├─ MassMovement        移动处理
  ├─ MassRepresentation  可视化（ISM/Actor 池）
  ├─ MassSignals         信号系统
  ├─ MassSimulation      模拟管理
  ├─ MassSpawner         生成系统
  ├─ MassReplication     网络复制
  ├─ MassEQS             环境查询集成
  ├─ MassSmartObjects    智能对象交互
  └─ MassDebug           调试工具
Engine/Plugins/AI/MassAI/                      ← AI 层
  ├─ MassAIBehavior      行为逻辑
  ├─ MassNavigation      导航基础
  ├─ MassNavMeshNavigation  NavMesh 导航
  └─ MassZoneGraphNavigation  ZoneGraph 导航
Engine/Plugins/AI/MassCrowd/                   ← 人群模拟
Engine/Plugins/Runtime/MassInsights/           ← 性能分析
```

**Build.cs 依赖**（核心模块）：
- Public：Core, CoreUObject, Engine, DeveloperSettings, TraceLog
- Private (Editor)：UnrealEd, EditorSubsystem
- 默认启用并发存储（`WITH_MASS_CONCURRENT_RESERVE`），编辑器下始终开启

---

## 2. 核心 ECS 概念

### 2.1 五种数据类型

`MassEntityElementTypes.h`

| 类型 | 基类 | 粒度 | 用途 |
|------|------|------|------|
| **Fragment** | `FMassFragment` | 每个 Entity 一份 | 实体数据（位置、速度、血量等） |
| **Tag** | `FMassTag` | 无数据，仅标记 | 布尔标记（是否死亡、是否激活） |
| **ChunkFragment** | `FMassChunkFragment` | 每个 Chunk 一份 | Chunk 级共享数据（LOD 级别） |
| **SharedFragment** | `FMassSharedFragment` | 跨 Entity 共享 | 可变共享参数 |
| **ConstSharedFragment** | `FMassConstSharedFragment` | 跨 Entity 共享（不可变） | LOD 距离阈值等配置 |

对应 BitSet 类型：
- `FMassFragmentBitSet` — 普通 Fragment
- `FMassTagBitSet` — Tag
- `FMassChunkFragmentBitSet` — Chunk Fragment
- `FMassSharedFragmentBitSet` — Shared Fragment
- `FMassConstSharedFragmentBitSet` — Const Shared Fragment

### 2.2 Entity

`MassEntityHandle.h`

```cpp
struct FMassEntityHandle   // 8 字节，对齐
{
    int32 Index;          // 在 EntityManager 中的索引（0 号保留，不可用）
    int32 SerialNumber;   // 验证序列号，防止野指针
    // IsValid() = Index > 0 && SerialNumber > 0
};
```

Entity 本身没有任何数据，只是一个 Handle。数据全部存储在 Fragment 中。

### 2.3 Archetype

`MassArchetypeTypes.h`

Archetype = 一组 Fragment/Tag 的唯一组合。拥有相同 Fragment 组合的所有 Entity 属于同一个 Archetype。

```
Archetype A: [Transform, Velocity, Health]     → 所有可移动可战斗的 NPC
Archetype B: [Transform, Velocity]             → 所有可移动但不可战斗的 NPC
Archetype C: [Transform, Health]               → 所有静止可战斗的物体
```

**Archetype 组合描述符**（`FMassArchetypeCompositionDescriptor`）：
- 封装所有 Fragment/Tag BitSet
- 支持 `IsEquivalent()`, `HasAll()`, `Append()`, `Remove()`, `CalculateDifference()`
- 用于查询匹配和 Archetype 查找

**Archetype 查找**：两级 Hash 结构
- `FragmentHashToArchetypeMap[TypeHash] → TArray<FMassArchetypeData*>`
- Hash = CompositionDescriptor Hash + GroupHash
- 已存在的 Archetype 直接复用，不重复创建

### 2.4 Chunk（内存块）

`MassArchetypeData.h:26-100`

每个 Archetype 管理多个 Chunk，每个 Chunk 是一块连续内存，存储一批 Entity 的数据：

```
Chunk 内存布局（SoA - Structure of Arrays）：

[Entity Handle 0..N] [Fragment_A 0..N] [Fragment_B 0..N] [Fragment_C 0..N]
 ← 连续内存 →        ← 连续内存 →       ← 连续内存 →      ← 连续内存 →
```

```cpp
struct FMassArchetypeChunk
{
    uint8* RawMemory = nullptr;             // 连续内存块
    SIZE_T AllocSize = 0;
    int32 NumInstances = 0;                 // 当前 Entity 数量
    int32 SerialModificationNumber = 0;     // 版本号，用于一致性校验
    TArray<FInstancedStruct> ChunkFragmentData;              // Chunk 级 Fragment
    FMassArchetypeSharedFragmentValues SharedFragmentValues;  // 共享 Fragment
};
```

**内存配置**：
- Chunk 大小通过 `UMassEntitySettings.ChunkMemorySize` 配置（1KB~512KB）
- `NumEntitiesPerChunk` 根据 Chunk 大小和单个 Entity 大小自动计算
- LLM 内存追踪分类：`Mass/ArchetypeChunk`, `Mass/PushCommand`

**缓存友好**：同类数据连续存储，顺序遍历时 CPU 缓存命中率极高，这是 Mass 性能优势的核心。

### 2.5 Entity 视图

`MassEntityView.h`

```cpp
struct FMassEntityView
{
    // 通过 Entity Handle 获取任意 Fragment 的只读/读写引用
    const T& GetFragmentData<T>() const;
    T& GetFragmentDataChecked<T>();
};
```

用于在不通过 Query 遍历的情况下直接访问单个 Entity 的数据。

---

## 3. Entity Manager

`MassEntityManager.h:95+`

Entity Manager 是 Mass 框架的核心管理器，每个 World 一个实例（通过 `UMassEntitySubsystem` 获取）。

### 3.1 获取方式

```cpp
// 方式一：World Subsystem
UMassEntitySubsystem* Subsystem = World->GetSubsystem<UMassEntitySubsystem>();
FMassEntityManager& EntityManager = Subsystem->GetMutableEntityManager();

// 方式二：在 Processor 的 Execute 中直接使用参数
void UMyProcessor::Execute(FMassEntityManager& EntityManager, FMassExecutionContext& Context) { ... }
```

### 3.2 主要 API

```cpp
// ===== 创建 =====
FMassEntityHandle CreateEntity(const FMassArchetypeHandle& Archetype);
TSharedRef<FEntityCreationContext> BatchCreateEntities(
    const FMassArchetypeHandle& Archetype, int32 Count, TArray<FMassEntityHandle>& OutEntities);

// ===== Archetype =====
FMassArchetypeHandle CreateArchetype(const FMassArchetypeCompositionDescriptor& Composition);
void GetMatchingArchetypes(const FMassFragmentRequirements& Req, TArray<FMassArchetypeHandle>& Out);

// ===== 操作 =====
void DestroyEntity(FMassEntityHandle Handle);
FMassCommandBuffer& Defer();    // 延迟命令缓冲（线程安全）
void DoEntityCompaction(double TimeAllowed);  // 内存整理
```

### 3.3 Entity Builder（流式 API）

`MassEntityBuilder.h`

```cpp
using namespace UE::Mass;

FMassEntityHandle Entity = FEntityBuilder(EntityManager)
    .Add<FTransformFragment>(FTransform::Identity)    // 添加 Fragment 并初始化
    .Add_GetRef<FVelocityFragment>()                  // 添加并获取引用修改
    .AddTag<FAliveTag>()                              // 添加 Tag
    .Commit();                                         // 提交创建，返回 Handle
```

**Builder 状态机**：Initial → ReadyToCommit → Committed
- 析构时自动 Commit（除非 Reset）
- 支持 `AppendDataFromEntity()` / `CopyDataFromEntity()` 从已有 Entity 复制
- 支持 `SetReservedEntityHandle()` 预分配 Handle

---

## 4. Command Buffer（延迟命令）

`MassCommandBuffer.h` / `MassCommands.h`

### 4.1 为什么需要延迟

在 Processor 执行期间直接修改 Entity 组合（添加/删除 Fragment）会导致 Archetype 迁移，破坏正在遍历的数据。Command Buffer 将所有修改排队，在当前帧处理完后统一执行。

### 4.2 使用方式

```cpp
void UMyProcessor::Execute(FMassEntityManager& EntityManager, FMassExecutionContext& Context)
{
    MyQuery.ForEachEntityChunk(Context, [&](FMassExecutionContext& Ctx)
    {
        auto Healths = Ctx.GetMutableFragmentView<FHealthFragment>();
        auto Entities = Ctx.GetEntities();

        for (int32 i = 0; i < Ctx.GetNumEntities(); ++i)
        {
            if (Healths[i].Value <= 0.f)
            {
                // 不能直接 DestroyEntity！用 Defer
                Context.Defer().DestroyEntity(Entities[i]);
                // 或添加 Tag
                Context.Defer().AddTag<FDeadTag>(Entities[i]);
                // 或添加 Fragment
                Context.Defer().AddFragment<FRagdollFragment>(Entities[i]);
            }
        }
    });
}
```

### 4.3 命令类型与执行顺序

`MassCommands.h`

命令按以下**固定顺序**批量执行，保证一致性：

```
1. Create              → 创建 Entity
2. Add                 → 添加 Fragment/Tag
3. Set                 → 设置 Fragment 值
4. ChangeComposition   → 同时添加和移除
5. Remove              → 移除 Fragment/Tag
6. Destroy             → 销毁 Entity
```

**常用命令类**：
- `FMassCommandDestroyEntities` — 批量销毁
- `FMassCommandAddFragmentsInternal<T>` — 添加 Fragment
- `FMassCommandRemoveFragmentsInternal<T>` — 移除 Fragment
- `FMassCommandAddTagsInternal` — 添加 Tag
- `FMassCommandSwapTagsInternal` — 交换 Tag
- `FMassCommandBuildEntity` — 通过 Builder 创建
- `FMassDeferredCommand` — 自定义延迟命令

### 4.4 线程安全

- 每个 Command Buffer 跟踪创建线程 ID（`OwnerThreadId`）
- `COMMAND_PUSHING_CHECK()` 校验推送线程一致性
- 并行 Processor 使用独立 Command Buffer，执行后合并到主缓冲区
- `AppendingCommandsCS` 临界区保护命令追加

---

## 5. Processor（处理器）

`MassProcessor.h:76+`

Processor 是 Mass 的逻辑单元，类似 ECS 中的 System。每个 Processor 声明它需要的 Fragment，框架自动匹配所有满足条件的 Archetype 并批量执行。

### 5.1 处理阶段

`MassProcessingTypes.h:169-179`

```cpp
enum class EMassProcessingPhase : uint8
{
    PrePhysics,       // 物理之前（大部分逻辑在这里）
    StartPhysics,
    DuringPhysics,
    EndPhysics,
    PostPhysics,      // 物理之后
    FrameEnd,         // 帧末
    MAX,
};
```

### 5.2 Processor 配置

```cpp
class UMassProcessor : public UObject
{
    FMassProcessorExecutionOrder ExecutionOrder;  // Group, ExecuteBefore, ExecuteAfter
    EMassProcessingPhase ProcessingPhase;          // 所属阶段
    uint8 ExecutionFlags;                          // Server/Client/Standalone/Editor
    int16 ExecutionPriority;                       // 优先级
    bool bRequiresGameThreadExecution;             // 是否必须在 GameThread
};
```

### 5.3 Processor 生命周期

```
1. ConfigureQueries()  → 声明需要哪些 Fragment（读/写/可选）
2. Initialize()        → 自定义初始化
3. Execute()           → 每帧执行（框架自动传入匹配的 Entity Chunk）
```

### 5.4 自定义 Processor 示例

```cpp
UCLASS()
class UMoveProcessor : public UMassProcessor
{
    GENERATED_BODY()

    FMassEntityQuery MoveQuery;

    virtual void ConfigureQueries() override
    {
        MoveQuery.AddRequirement<FTransformFragment>(EMassFragmentAccess::ReadWrite);
        MoveQuery.AddRequirement<FVelocityFragment>(EMassFragmentAccess::ReadOnly);
        MoveQuery.AddRequirement<FDeadTag>(EMassFragmentAccess::None, EMassFragmentPresence::None);
        MoveQuery.RegisterWithProcessor(*this);
    }

    virtual void Execute(FMassEntityManager& EntityManager, FMassExecutionContext& Context) override
    {
        MoveQuery.ForEachEntityChunk(Context, [](FMassExecutionContext& Ctx)
        {
            auto Transforms = Ctx.GetMutableFragmentView<FTransformFragment>();
            auto Velocities = Ctx.GetFragmentView<FVelocityFragment>();
            const float DT = Ctx.GetDeltaTimeSeconds();

            for (int32 i = 0; i < Ctx.GetNumEntities(); ++i)
            {
                Transforms[i].Transform.AddToTranslation(Velocities[i].Value * DT);
            }
        });
    }
};
```

### 5.5 依赖管理

`MassProcessorDependencySolver.cpp`

框架自动根据 Processor 的 Fragment 访问模式构建依赖图：
- 读同一 Fragment 的 Processor 可以并行
- 写同一 Fragment 的 Processor 必须串行
- `ExecuteAfter` / `ExecuteBefore` 显式指定顺序

### 5.6 Composite Processor

`UMassCompositeProcessor` 作为容器嵌套子 Processor，框架展平为依赖图后调度到 TaskGraph。

---

## 6. Query（查询系统）

`MassEntityQuery.h:50+`

### 6.1 声明需求

```cpp
FMassEntityQuery MyQuery;
MyQuery.AddRequirement<FTransformFragment>(EMassFragmentAccess::ReadWrite);
MyQuery.AddRequirement<FVelocityFragment>(EMassFragmentAccess::ReadOnly);
MyQuery.AddRequirement<FDeadTag>(EMassFragmentAccess::None, EMassFragmentPresence::None);  // 排除
MyQuery.AddSubsystemRequirement<UNavigationSubsystem>(EMassFragmentAccess::ReadOnly);
```

### 6.2 访问模式与存在性

`MassRequirements.h:16-66`

| EMassFragmentAccess | 含义 |
|---------------------|------|
| `None` | 不绑定（仅用于存在性过滤） |
| `ReadOnly` | 只读 |
| `ReadWrite` | 读写 |

| EMassFragmentPresence | 含义 |
|-----------------------|------|
| `All` | 必须存在 |
| `Any` | 至少一个存在 |
| `None` | 不能存在（排除） |
| `Optional` | 可选 |

### 6.3 Archetype 缓存

Query 执行时会缓存匹配的 Archetype 列表。内部机制：
- 通过 `ArchetypeDataVersion` 检测是否有新 Archetype 创建
- 增量更新：仅处理新增的 Archetype
- 缓存 `FMassQueryRequirementIndicesMapping`（Fragment → Archetype 内存布局的映射）

### 6.4 执行方式

```cpp
// 单线程遍历所有匹配的 Chunk
MyQuery.ForEachEntityChunk(Context, [this](FMassExecutionContext& Ctx)
{
    const int32 NumEntities = Ctx.GetNumEntities();
    auto Transforms = Ctx.GetMutableFragmentView<FTransformFragment>();
    auto Velocities = Ctx.GetFragmentView<FVelocityFragment>();

    for (int32 i = 0; i < NumEntities; ++i)
    {
        Transforms[i].Transform.AddToTranslation(Velocities[i].Value * Ctx.GetDeltaTimeSeconds());
    }
});

// 并行执行（CVar: mass.AllowQueryParallelFor, 默认 true）
MyQuery.ParallelForEachEntityChunk(Context, ExecuteFunc, EParallelExecutionFlags::AutoBalance);
```

### 6.5 其他 Query API

```cpp
int32 Count = MyQuery.GetNumMatchingEntities(EntityManager);      // 统计匹配数量
auto Collection = MyQuery.CreateMatchingEntitiesCollection(EM);    // 获取 Entity 范围集合
MyQuery.SetChunkFilter(Condition);                                 // Chunk 级过滤条件
```

---

## 7. Observer（观察者系统）

`MassObserverManager.h:65+`

Observer Processor 在 Entity 的 Fragment 组合发生变化时触发，类似事件驱动：

### 7.1 观察操作

```cpp
enum class EMassObservedOperation : uint8
{
    AddElement,       // Fragment/Tag 被添加到 Entity
    RemoveElement,    // Fragment/Tag 从 Entity 移除
    MAX
};
```

### 7.2 Observer Processor

```cpp
UCLASS()
class UDeathObserver : public UMassObserverProcessor
{
    // 当 FDeadTag 被添加到 Entity 时触发
    // 在 GetObservedType() 和 GetObservedOperation() 中指定
};
```

### 7.3 通知时机

| 方法 | 触发时机 |
|------|---------|
| `OnPostEntitiesCreated()` | 批量创建后 |
| `OnPostEntityCreated()` | 单个创建后 |
| `OnPreEntitiesDestroyed()` | 批量销毁前 |
| `OnPreEntityDestroyed()` | 单个销毁前 |
| `OnPostCompositionAdded()` | Fragment/Tag 添加后 |
| `OnPreCompositionRemoved()` | Fragment/Tag 移除前 |

### 7.4 Observer Lock

`FMassObserverManager::FObserverLock` — 在多步操作期间暂停通知，操作完成后一次性触发。

支持通知合并（coalescing）：CVar `mass.observers.CoalesceBufferedNotifications`

---

## 8. Relation 系统（关系）

`MassEntityRelations.h` / `MassRelationManager.cpp`

5.7 新增的关系系统，用于表达 Entity 之间的关联。

### 8.1 核心概念

```
关系 = Subject（主动方） + Object（被动方） + RelationType（关系类型）
```

每个关系实例本身也是一个 Entity（拥有 Tag 和 Fragment）。

### 8.2 关系类型特性

```cpp
struct FRelationTypeTraits
{
    UScriptStruct* RelationTagType;       // 标识关系的 Tag
    UScriptStruct* RelationFragmentType;  // 关系数据 Fragment

    struct FRoleTraits {
        UScriptStruct* Element;             // 角色的 Fragment 类型
        ERemovalPolicy DestructionPolicy;   // 关系断开时的行为
        bool bExclusive;                    // 该角色是否独占（最多1个参与者）
        EExternalMappingRequired RequiresExternalMapping;
    } RoleTraits[2];  // [Subject, Object]
};
```

**销毁策略**（`ERemovalPolicy`）：
| 策略 | 行为 |
|------|------|
| `CleanUp` | 清理关系数据 |
| `Destroy` | 销毁关联 Entity |
| `Splice` | 重新连接到上级 |
| `Custom` | 自定义处理 |

### 8.3 API

```cpp
FRelationManager& RelManager = EntityManager.GetRelationManager();

// 创建关系
RelManager.CreateRelationInstances(RelationTypeHandle, Subjects, Objects);

// 查询关系
RelManager.GetRelationSubjects(RelationType, ObjectEntity);   // 获取某 Object 的所有 Subject
RelManager.GetRelationObjects(RelationType, SubjectEntity);   // 获取某 Subject 的所有 Object
RelManager.IsSubjectOfRelation(RelationType, Subject, Object);
RelManager.IsSubjectOfRelationRecursive(...);  // 递归检查（父子链）
```

### 8.4 内置关系

- **ChildOf**（`MassChildOf.h`）— 层级父子关系，支持递归遍历

---

## 9. Execution Context（执行上下文）

`MassExecutionContext.h`

### 9.1 在 Chunk 遍历中使用

```cpp
MyQuery.ForEachEntityChunk(Context, [](FMassExecutionContext& Ctx)
{
    // 基本信息
    int32 Num = Ctx.GetNumEntities();
    float DT = Ctx.GetDeltaTimeSeconds();

    // Fragment 视图
    auto Transforms = Ctx.GetMutableFragmentView<FTransformFragment>();   // 读写
    auto Velocities = Ctx.GetFragmentView<FVelocityFragment>();           // 只读

    // Entity Handle 列表
    TConstArrayView<FMassEntityHandle> Entities = Ctx.GetEntities();

    // Chunk Fragment
    auto& LODChunk = Ctx.GetChunkFragment<FMassSimulationVariableTickChunkFragment>();

    // Shared Fragment
    auto& SharedConfig = Ctx.GetSharedFragment<FMySharedConfig>();
    auto& ConstConfig = Ctx.GetConstSharedFragment<FMyConstConfig>();

    // 延迟命令
    Ctx.Defer().DestroyEntity(Entities[0]);

    // Subsystem 访问
    auto& NavSystem = Ctx.GetSubsystemChecked<UNavigationSubsystem>();
});
```

### 9.2 Entity 迭代器

支持 range-based for：

```cpp
for (int32 EntityIndex : Ctx)
{
    Transforms[EntityIndex].Transform = ...;
}
```

---

## 10. Processing Phase Manager

`MassProcessingPhaseManager.h`

### 10.1 Phase 与 Tick Group 映射

每个 `EMassProcessingPhase` 对应一个 `ETickingGroup`，由 `FMassProcessingPhaseManager` 管理：

```
PrePhysics   → TG_PrePhysics
StartPhysics → TG_StartPhysics
DuringPhysics → TG_DuringPhysics
EndPhysics   → TG_EndPhysics
PostPhysics  → TG_PostPhysics
FrameEnd     → TG_LastDemotable
```

### 10.2 执行流水线

```
FMassProcessingPhaseManager
  ├─ 拥有 FMassEntityManager
  ├─ 每个 Phase 持有一个 UMassCompositeProcessor
  │  ├─ 通过 FMassProcessorDependencySolver 解析依赖
  │  ├─ 展平为 Flat Processing Graph
  │  └─ 调度 FMassProcessorTask 到 TaskGraph
  └─ Phase 委托：OnPhaseStart / OnPhaseEnd
```

### 10.3 Executor

`MassExecutor.h` — 高层执行 API：

```cpp
namespace UE::Mass::Executor
{
    // 执行整个 Pipeline
    void Run(FMassRuntimePipeline& Pipeline, FMassProcessingContext& Context);

    // 在指定 Entity 集合上执行（稀疏处理）
    void RunSparse(RuntimePipeline, Context, EntityCollections);

    // 异步并行执行
    void TriggerParallelTasks(Processors, Context, CompletionCallback);
}
```

---

## 11. 并行执行模型

### 11.1 Task Graph 集成

- 每个 Processor 封装为 `FMassProcessorTask`（高优先级 Worker 线程）
- `FMassProcessorsTask_GameThread` — GameThread 专用
- 框架根据依赖图自动调度
- 只读 Query 可并行，读写 Query 按 Chunk 串行

### 11.2 并行 Query

```cpp
// 自动负载均衡：线程动态领取 Chunk
query.ParallelForEachEntityChunk(context, func, EParallelExecutionFlags::AutoBalance);

// 强制并行
query.ParallelForEachEntityChunk(context, func, EParallelExecutionFlags::Force);
```

### 11.3 线程安全机制

| 机制 | 说明 |
|------|------|
| `FScopedProcessing` | 原子计数器标记"正在处理"，禁止同步 API |
| Command Buffer 线程隔离 | 并行 Task 各自持有独立 Buffer，完成后合并 |
| `FConcurrentEntityStorage` | 并发安全的 Entity 存储后端 |
| `OwnerThreadId` 校验 | 每个 Command Buffer 校验推送线程 |

---

## 12. LOD 系统

`MassSimulationLOD.h:16+`

Mass 内置距离 LOD，按距离分级处理实体：

```cpp
struct FMassSimulationLODParameters : FMassConstSharedFragment
{
    float LODDistance[EMassLOD::Max];                        // 各级距离阈值
    float BufferHysteresisOnDistancePercentage = 10.0f;     // 迟滞百分比，防抖动
    int32 LODMaxCount[EMassLOD::Max];                       // 各级最大实体数
};

struct FMassSimulationLODFragment : FMassFragment
{
    float ClosestViewerDistanceSq = FLT_MAX;
    TEnumAsByte<EMassLOD::Type> LOD;       // 当前 LOD
    TEnumAsByte<EMassLOD::Type> PrevLOD;   // 上一帧 LOD
};
```

### Variable Tick

```cpp
struct FMassSimulationVariableTickChunkFragment : FMassChunkFragment
{
    static bool ShouldTickChunkThisFrame(const FMassExecutionContext& Context);
    static EMassLOD::Type GetChunkLOD(const FMassExecutionContext& Context);
};
```

Chunk 级 LOD 判断：同一 Chunk 内的实体共享 LOD 级别，整个 Chunk 一起决定是否在本帧处理，极大减少判断开销。

---

## 13. 可视化表现

`MassRepresentation/Public/`

Mass 实体没有 Actor，通过以下方式呈现：

| 距离 | 表现方式 | 说明 |
|------|---------|------|
| 近 | **Actor 代理** | 从 Actor 池中取出真实 Actor 挂载 |
| 中 | **ISM（Instanced Static Mesh）** | 批量实例化渲染 |
| 远 | **ISM 低模 / 不渲染** | 最低开销 |

### Actor 池

- `MassRepresentationActorManagement` — Actor 池化管理
- 近处 Entity 激活 Actor（从池中取），远处回收（归还池）
- 避免频繁 Spawn/Destroy

### ISM 更新

- `MassUpdateISMProcessor` — 每帧批量更新 ISM Transform
- 利用 Chunk 连续内存一次性提交

---

## 14. 生成系统

`MassSpawner.h:19+`

```cpp
class AMassSpawner : public AActor
{
    void DoSpawning();      // 批量生成
    void DoDespawning();    // 批量销毁
    TArray<UMassEntityTemplate*> EntityTemplates;  // Entity 模板
};
```

### Trait 系统

Entity 模板通过 Trait 配置（类似 UE 的 Component 概念）：
- `FTransformFragment` — 位置变换
- `FAgentRadiusFragment` — 碰撞半径
- `FMassSimulationLODParameters` — LOD 配置
- 自定义 Trait 继承 `UMassEntityTraitBase`

---

## 15. AI 集成

### StateTree

- `MassStateTreeExecutionContext` — Mass 专用 StateTree 执行上下文
- `MassStateTreeProcessors` — 批量驱动 StateTree 逻辑

### 导航

- **NavMesh**：`MassNavMeshNavigation` — 传统寻路
- **ZoneGraph**：`MassZoneGraphNavigation` — 区域图导航（适合人群沿路径移动）

### 人群

- `MassCrowd` — 人群感知移动、避障
- `MassCrowdNavigationProcessor` — 群体寻路
- `MassCrowdVisualizationProcessor` — 群体渲染

---

## 16. 调试与性能分析

### 16.1 调试工具

- `FMassDebugger` — 中央调试接口
  - Archetype 统计（`FArchetypeStats`）
  - Fragment 断点
  - Entity 选择与追踪

### 16.2 Stats

| Stat | 含义 |
|------|------|
| `STAT_Mass_Total` | 框架总耗时 |
| `STAT_Mass_DoTask` | 单个 Processor 执行耗时 |
| `STAT_Mass_FlushCommands` | Command Buffer 刷新耗时 |
| `STAT_Mass_ArchetypeBatchAdd` | 批量 Entity 添加耗时 |
| `STAT_Mass_PhaseTick` | Phase Tick 耗时 |
| `STAT_Mass_IsSubject` | 关系 Subject 查询耗时 |

### 16.3 CSV Profiler

- `MassEntities` — Entity 操作追踪
- `MassEntitiesCounters` — Command 计数统计

---

## 17. 常用 CVar

| CVar | 默认值 | 作用 |
|------|--------|------|
| `mass.LogProcessingGraph` | false | 每帧打印 Processor 执行图 |
| `mass.LogNewProcessingGraph` | false | 新处理图创建时打印 |
| `mass.AllowQueryParallelFor` | true | 允许 Query 并行执行 |
| `mass.commands.LockObserversDuringFlushing` | false | 命令缓冲刷新时锁定 Observer |
| `massentities.EnableCommandDetailedStats` | false | 命令详细统计（CSV） |
| `mass.debug.TrackRequirementsAccess` | false | 追踪 Fragment 访问 |
| `mass.observers.CoalesceBufferedNotifications` | false | 合并观察者通知 |
| `Mass.ConcurrentReserve.Enable` | true | 并发 Entity 存储 |
| `Mass.ConcurrentReserve.MaxEntityCount` | 2^27 | 最大 Entity 数量 |
| `Mass.ConcurrentReserve.EntitiesPerPage` | 2^16 | 每页 Entity 数 |

---

## 18. 与传统 Actor 方案对比

| | 传统 Actor + Component | Mass Entity |
|---|---|---|
| 每个单位内存 | KB 级（Actor + Components + UObject 开销） | 几十~几百字节（纯数据 Fragment） |
| Tick 开销 | 每个 Actor 独立 Tick，函数调用开销大 | Chunk 批量处理，缓存友好 |
| 适合数量 | 几百 | 几千~几万 |
| 可视化 | 每个有独立 Actor | ISM + Actor 池 |
| AI | BehaviorTree / StateTree per Actor | StateTree per Entity（批量驱动） |
| 物理 | 完整碰撞 | 简化碰撞 / 无碰撞 |
| 网络 | Actor Replication | 自定义 Mass Replication |
| 开发复杂度 | 低（蓝图友好） | 高（C++ 为主，数据驱动思维） |

---

## 19. 快速上手步骤

### 19.1 Build.cs 添加依赖

```csharp
PublicDependencyModuleNames.AddRange(new string[] {
    "MassEntity",
    "MassCommon",       // 可选：通用 Fragment
    "MassSpawner",      // 可选：生成系统
    "MassRepresentation", // 可选：可视化
    "StructUtils",      // FInstancedStruct 支持
});
```

### 19.2 定义 Fragment 和 Tag

```cpp
USTRUCT()
struct FHealthFragment : public FMassFragment
{
    GENERATED_BODY()
    float CurrentHealth = 100.f;
    float MaxHealth = 100.f;
};

USTRUCT()
struct FDeadTag : public FMassTag
{
    GENERATED_BODY()
};
```

### 19.3 编写 Processor

```cpp
UCLASS()
class UHealthProcessor : public UMassProcessor
{
    GENERATED_BODY()
    FMassEntityQuery HealthQuery;

    virtual void ConfigureQueries() override
    {
        HealthQuery.AddRequirement<FHealthFragment>(EMassFragmentAccess::ReadWrite);
        HealthQuery.AddRequirement<FDeadTag>(EMassFragmentAccess::None, EMassFragmentPresence::None);
        HealthQuery.RegisterWithProcessor(*this);
    }

    virtual void Execute(FMassEntityManager& EntityManager, FMassExecutionContext& Context) override
    {
        HealthQuery.ForEachEntityChunk(Context, [&](FMassExecutionContext& Ctx)
        {
            auto Healths = Ctx.GetMutableFragmentView<FHealthFragment>();
            auto Entities = Ctx.GetEntities();

            for (int32 i = 0; i < Ctx.GetNumEntities(); ++i)
            {
                if (Healths[i].CurrentHealth <= 0.f)
                {
                    Context.Defer().AddTag<FDeadTag>(Entities[i]);
                }
            }
        });
    }
};
```

### 19.4 定义 Trait（配置模板用）

```cpp
UCLASS()
class UHealthTrait : public UMassEntityTraitBase
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere)
    float DefaultHealth = 100.f;

    virtual void BuildTemplate(FMassEntityTemplateBuildContext& BuildContext, const UWorld& World) const override
    {
        BuildContext.AddFragment<FHealthFragment>();
        // 可在 FMassEntityTemplate::OnBuildFinished 中设置默认值
    }
};
```

---

## 更新日志

| 日期 | 内容 |
|------|------|
| 2026-03-12 | 初始文档，基于 UE 5.7.3 源码分析 |
| 2026-03-24 | 大幅补充：Command Buffer 详解、Entity Builder、Relation 系统、Execution Context、Phase Manager、线程安全、调试工具、快速上手指南。升级至 5.7.4 |
