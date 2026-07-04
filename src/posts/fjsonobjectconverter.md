---
title: "FJsonObjectConverter 深度技术分析"
cat: 引擎剖析
date: 2026-04-02
mins: 18
tags: [序列化, 反射]
---

> 基于 UE 5.7 引擎源码逐行分析 + 权威网络资源 + 项目实际状况的完整技术评估。
>
> 分析日期：2026-03-26

---

## 一、概述

`FJsonObjectConverter` 是 UE 引擎 `JsonUtilities` 模块中的核心类，提供 **USTRUCT/UObject 与 JSON 之间的自动双向序列化**。它基于 UE 反射系统（`FProperty` / `TFieldIterator`）自动遍历结构体的所有属性，无需手动编写每个字段的序列化代码。

- **所在模块**: `Engine/Source/Runtime/JsonUtilities`
- **头文件**: `JsonObjectConverter.h`
- **关联文件**: `JsonObjectStructInterface.h`（静态接口注册）、`JsonObjectWrapper.h`（JSON 透传结构体）

---

## 二、核心 API 架构

### 2.1 导出方向（UStruct → JSON）

| API | 说明 |
|-----|------|
| `UStructToJsonObject<T>(InStruct)` | 模板版，自动推导 `StaticStruct`，返回 `TSharedPtr<FJsonObject>` |
| `UStructToJsonObject(UStruct*, void*, TSharedRef<FJsonObject>)` | 非模板版，接受任意 UStruct 定义 |
| `UStructToJsonObjectString(...)` | 直接输出 JSON 字符串，支持 PrettyPrint / Condensed |
| `UStructToFormattedJsonObjectString<CharType, PrintPolicy>` | 自定义输出策略的模板版 |
| `UStructToJsonAttributes(...)` | 输出到 `TMap<FString, TSharedPtr<FJsonValue>>` 属性表 |
| `UPropertyToJsonValue(...)` | 单个属性级别的转换 |

### 2.2 导入方向（JSON → UStruct）

| API | 说明 |
|-----|------|
| `JsonObjectToUStruct<T>(JsonObject, OutStruct)` | 模板版，自动推导 `StaticStruct` / `StaticClass` |
| `JsonObjectStringToUStruct<T>(JsonString, OutStruct)` | 从 JSON 字符串直接反序列化 |
| `JsonArrayStringToUStruct<T>(JsonString, TArray<T>*)` | JSON 数组 → `TArray` |
| `JsonArrayToUStruct<T>(JsonArray, TArray<T>*)` | `TArray<FJsonValue>` → `TArray<T>` |
| `JsonAttributesToUStruct(...)` | 从属性表直接导入 |
| `JsonValueToUProperty(...)` | 单个属性级别导入 |

### 2.3 自定义回调机制

```cpp
// 导出回调 — 优先级最高，返回有效值则跳过默认逻辑
using CustomExportCallback = TDelegate<TSharedPtr<FJsonValue>(FProperty* Property, const void* Value)>;

// 导入回调 — 返回 true 表示已处理，false 回退到默认
using CustomImportCallback = TDelegate<bool(const TSharedPtr<FJsonValue>& JsonValue, FProperty* Property, void* Value)>;
```

引擎内置了一个导出回调实例：

```cpp
// 将 FDateTime 输出为 ISO8601 格式字符串
static const CustomExportCallback ExportCallback_WriteISO8601Dates;
```

其实现：

```cpp
const FJsonObjectConverter::CustomExportCallback FJsonObjectConverter::ExportCallback_WriteISO8601Dates =
    FJsonObjectConverter::CustomExportCallback::CreateLambda(
        [](FProperty* Prop, const void* Data) -> TSharedPtr<FJsonValue>
        {
            if (FStructProperty* StructProperty = CastField<FStructProperty>(Prop))
            {
                checkSlow(StructProperty->Struct);
                if (StructProperty->Struct->GetFName() == NAME_DateTime)
                {
                    return MakeShared<FJsonValueString>(static_cast<const FDateTime*>(Data)->ToIso8601());
                }
            }
            return {};
        });
```

---

## 三、类型处理策略（源码实现分析）

### 3.1 导出时的类型分派优先级

源码 `ConvertScalarFPropertyToJsonValueWithContainer` 中的处理顺序：

| 优先级 | 类型 | JSON 输出 |
|--------|------|-----------|
| 0 | **CustomExportCallback** | 用户自定义（最高优先级） |
| 1 | `FEnumProperty` | `FJsonValueString`（枚举名字符串） |
| 2 | `FNumericProperty` + Enum | `FJsonValueString` |
| 3 | `FNumericProperty`（float） | `FJsonValueNumber` |
| 4 | `FNumericProperty`（int） | `FJsonValueNumber` |
| 5 | `FBoolProperty` | `FJsonValueBoolean` |
| 6 | `FStrProperty` | `FJsonValueString` |
| 7 | `FTextProperty` | `FJsonValueString`（简单/复杂格式可控） |
| 8 | `FArrayProperty` | `FJsonValueArray` |
| 9 | `FSetProperty` | `FJsonValueArray` |
| 10 | `FMapProperty` | `FJsonValueObject`（Key→String, Value→JsonValue） |
| 11 | `FStructProperty` | 先查 `IJsonObjectStructConverter`，再查 `ExportTextItem`，最后递归展开 |
| 12 | `FObjectProperty` | Instanced 对象按值导出（含 `_ClassName`），其余按引用路径字符串 |
| 13 | `FOptionalProperty` | 有值则递归内部类型，无值则 `FJsonValueNull` |
| 14 | `FByteProperty` | `FJsonValueNumber` |
| 15 | 其它 | `ExportTextItem_Direct` → 字符串 fallback |

### 3.2 导入时的特殊类型处理

- **FColor / FLinearColor**: 支持从 hex 字符串直接解析（如 `"#FF0000FF"`）
- **FDateTime**: 支持 `"min"`, `"max"`, `"now"` 关键字 + ISO8601 格式 + 通用 `FDateTime::Parse`
- **FText**: 支持从字符串（含 `NSLOCTEXT` 复杂格式）和多语言 JSON 对象（`{"en":"Hello","zh":"你好"}`）导入
- **FObjectProperty**: 从 JSON Object 导入时，读取 `_ClassName` 字段来动态构造正确的子类实例（`StaticAllocateObject`）
- **Integer 从字符串**: 使用 `FCString::Atoi64` 避免 double 精度丢失

### 3.3 属性过滤机制

```cpp
// 默认跳过标记
SkipFlags |= CPF_Deprecated | CPF_Transient;

// 可选 unset 的 Optional 属性在导出时自动跳过
if (const FOptionalProperty* Opt = CastField<FOptionalProperty>(Property))
    if (!Opt->IsSet(Value)) continue;
```

- `CheckFlags`: 只转换匹配至少一个 flag 的属性（0 = 全部）
- `SkipFlags`: 跳过匹配任一 flag 的属性
- 支持 `bStrictMode`: 严格模式下缺少/多余字段会报错

---

## 四、高级扩展机制

### 4.1 IJsonObjectStructConverter 静态接口注册

UE 5.7 引入了 `FJsonObjectStructInterfaceRegistry`，允许为特定 `UScriptStruct` 注册自定义转换器，**绕过默认的反射遍历**：

```cpp
// 你的结构体需要实现两个方法：
struct FMyCustomStruct
{
    EJsonObjectConvertResult ConvertToJson(TSharedPtr<FJsonObject>& OutJsonObject) const;
    EJsonObjectConvertResult ConvertFromJson(const TSharedPtr<FJsonObject>& InJsonObject);
};

// 模块启动时注册
void FMyModule::StartupModule()
{
    static const TImplementsJsonObjectStructConverter<FMyCustomStruct> Converter;
    FJsonObjectStructInterfaceRegistry::RegisterStructConverter(
        FMyCustomStruct::StaticStruct(), &Converter);
}

// 模块关闭时注销
void FMyModule::ShutdownModule()
{
    FJsonObjectStructInterfaceRegistry::UnregisterStructConverter(FMyCustomStruct::StaticStruct());
}
```

返回值语义：

| `EJsonObjectConvertResult` | 含义 |
|---|---|
| `UseDefaultConverter` | 放弃自定义，回退默认反射 |
| `FailAndAbort` | 失败，终止整棵转换树 |
| `IgnoreAndContinue` | 输出空对象 `{}`，但不失败 |
| `Converted` | 自定义转换成功 |

### 4.2 FJsonObjectWrapper 透传

`FJsonObjectWrapper` 是一个特殊的 USTRUCT，内部持有 `TSharedPtr<FJsonObject>`。当 `FJsonObjectConverter` 遇到这个类型时：

- **导出**: 直接复制 `JsonObject->Values` 到输出
- **导入**: 直接将输入的 JSON 属性赋给 `JsonObject->Values`

这提供了一个"JSON 透传"通道，适合存储半结构化数据。

```cpp
// FJsonObjectWrapper 定义（JsonObjectWrapper.h）
USTRUCT(BlueprintType, meta = (DisplayName = "JsonObject"))
struct FJsonObjectWrapper
{
    GENERATED_USTRUCT_BODY()

    UPROPERTY(EditAnywhere, Category = "JSON")
    FString JsonString;

    TSharedPtr<FJsonObject> JsonObject;

    bool ImportTextItem(const TCHAR*& Buffer, int32 PortFlags, UObject* Parent, FOutputDevice* ErrorText);
    bool ExportTextItem(FString& ValueStr, FJsonObjectWrapper const& DefaultValue, UObject* Parent, int32 PortFlags, UObject* ExportRootScope) const;
    void PostSerialize(const FArchive& Ar);
    bool JsonObjectToString(FString& Str) const;
    bool JsonObjectFromString(const FString& Str);
};
```

### 4.3 StandardizeCase

默认行为会将属性名首字母小写化，并将 `ID` 替换为 `Id`。可通过 `EJsonObjectConversionFlags::SkipStandardizeCase` 关闭。

```cpp
FString FJsonObjectConverter::StandardizeCase(const FString &StringIn)
{
    FString FixedString = StringIn;
    FixedString[0] = FChar::ToLower(FixedString[0]);
    FixedString.ReplaceInline(TEXT("ID"), TEXT("Id"), ESearchCase::CaseSensitive);
    return FixedString;
}
```

---

## 五、EJsonObjectConversionFlags

```cpp
enum class EJsonObjectConversionFlags
{
    None = 0,
    SkipStandardizeCase              = 1 << 0,  // 保留属性名原始大小写
    WriteTextAsComplexString         = 1 << 1,  // FText 以 NSLOCTEXT(...) 格式导出（本地化必需）
    SuppressClassNameForPersistentObject = 1 << 2,  // 不写 _ClassName（纯输出场景）
};
```

---

## 六、UObject 实例化序列化（Instanced Subobjects）

当 `FObjectProperty` 带有 `CPF_PersistentInstance` 标记（即 `UPROPERTY(Instanced)`）或对象在 Container 的 Outer 链中时：

**导出**:
1. 写入 `_ClassName` 字段（除非 `SuppressClassNameForPersistentObject`）
2. 递归导出对象的所有属性
3. 使用 `ExportedObjects` 集合跟踪已导出对象，防止循环引用

**导入**:
1. 读取 `_ClassName` 字段确定实际类
2. 通过 `StaticAllocateObject` + `ClassConstructor` 动态创建实例
3. 递归填充属性

**限制**: 创建对象的 Outer 是 `GetTransientPackage()`（如果无 Container），生命周期需要调用者管理。

---

## 七、性能特征分析

### 7.1 开销来源

| 环节 | 开销 |
|------|------|
| `TFieldIterator` 反射遍历 | O(N) 属性数量，每次调用都遍历 |
| `CastField<>` 类型判断 | 线性 if-else 链（~15 种类型） |
| `StandardizeCase` | 每个属性名一次字符串操作 |
| `FString` 分配 | JSON key/value 大量字符串堆分配 |
| `TSharedPtr<FJsonValue>` | 每个值一次堆分配 + 引用计数 |
| 递归嵌套 | 深层结构递归调用，栈深度与嵌套层级成正比 |

### 7.2 性能建议

- **不适合热路径（Tick/每帧）**: 反射遍历 + 大量堆分配，不适合高频调用
- **适合低频场景**: 配置加载、存档读写、REST API 通信、编辑器工具
- **大数据量优化**: 考虑 `CustomExportCallback` 跳过不需要的字段
- **替代方案**: 高性能场景用 `FArchive` 二进制序列化或 `FStructuredArchive`

---

## 八、与其他 JSON 方案的对比

| 方案 | 自动化程度 | 性能 | 灵活性 | 适用场景 |
|------|-----------|------|--------|---------|
| **FJsonObjectConverter** | 全自动（反射驱动） | 中等 | 高（回调扩展） | USTRUCT 配置、存档、API |
| **FJsonObject 手动构建** | 全手动 | 最优 | 最高 | 精确控制输出格式 |
| **FJsonSerializer** | 底层解析/写入 | 高 | 底层 | JSON 字符串 ↔ FJsonObject |
| **FJsonReader（SAX）** | 底层流式 | 最优（内存） | 底层 | MB 级大文件解析 |
| **FJsonDomBuilder** | Builder 模式 | 高 | 中 | 程序化构建 JSON |
| **FStructuredArchive** | 中等 | 高 | 中 | 通用序列化（非 JSON 专用） |

**何时选择 FJsonObjectConverter**:
- 拥有 USTRUCT 且其结构与 JSON Schema 一一对应
- 需要一行代码完成转换
- 覆盖约 80% 的用例（配置文件、HTTP API、存档数据）

**何时选择 FJsonSerializer + FJsonObject**:
- JSON Schema 与 USTRUCT 不完全匹配
- 需要在序列化前检查/修改字段
- 处理动态/未知结构的 JSON

**组合使用**:
```cpp
// 1. 字符串 → FJsonObject（FJsonSerializer）
TSharedPtr<FJsonObject> JsonObj;
TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonString);
FJsonSerializer::Deserialize(Reader, JsonObj);

// 2. 中间操作（手动修改字段）
JsonObj->SetStringField(TEXT("ExtraField"), TEXT("value"));

// 3. FJsonObject → USTRUCT（FJsonObjectConverter）
FMyStruct Result;
FJsonObjectConverter::JsonObjectToUStruct(JsonObj.ToSharedRef(), &Result);
```

---

## 九、实际应用场景与前景

### 9.1 典型应用

1. **游戏配置/数据表**: USTRUCT 定义的配置数据与 JSON 文件互转
2. **REST API 通信**: HTTP 请求/响应体的自动序列化
3. **存档系统**: 玩家存档的 JSON 格式持久化
4. **编辑器工具**: 蓝图/编辑器数据的 JSON 导入导出
5. **调试输出**: 快速将任意 USTRUCT 转为可读 JSON 字符串

### 9.2 在 ActionRPG 项目中的潜在应用

- **技能/属性配置**: GAS 相关的 `URPGAttributeSet` 或技能参数可 JSON 化管理
- **AI 配置**: `FTKAIMessage` 等 AI 消息结构的序列化
- **存档系统**: 玩家进度、装备、属性的 JSON 存储
- **远程调试**: 运行时状态快照导出为 JSON

### 9.3 技术趋势

- UE 5.7 新增的 `IJsonObjectStructConverter` 静态接口注册表明 Epic 在持续增强此方案的可扩展性
- `FOptionalProperty` 支持（UE 5.4+）表明与 C++ 新特性保持同步
- `EJsonObjectConversionFlags` 的持续扩展为不同场景提供精细控制
- `FJsonObjectWrapper` 为半结构化数据提供了 "Schema-on-Read" 能力

---

## 十、已知限制与注意事项

### 10.1 通用限制

1. **Map Key 必须可转为 String**: JSON 对象的 Key 只能是字符串，非字符串 Key 会通过 `ExportTextItem` fallback
2. **int64 精度**: 导出为 `FJsonValueNumber`（double），超过 2^53 的 int64 会丢精度；导入时字符串格式 int64 会用 `Atoi64` 保留精度
3. **循环引用**: 通过 `ExportedObjects` 集合追踪防止无限递归，但仅限同一转换树
4. **UObject 生命周期**: 导入时动态创建的对象 Outer 为 `TransientPackage`，需要手动管理
5. **属性名大小写**: 默认 `StandardizeCase` 会修改输出名（首字母小写、ID→Id），可能与外部 API 不兼容
6. **无 Schema 验证**: 非严格模式下缺少字段静默跳过，可能导致数据不完整
7. **非线程安全**: 反射系统本身非线程安全，不要在多线程中并发使用
8. **嵌套容器不支持**: UE 不支持嵌套容器属性（如 `TArray<TArray<int32>>`），`FJsonObjectConverter` 继承此限制
9. **无多态 Struct 支持**: 基类 struct 指针使用声明的静态类型，非运行时派生类型

### 10.2 已知引擎 Bug

**UE-230676: TMap\<FString, UStruct\> 反序列化数据错误**

当 TMap 的 Value 是 USTRUCT 时，反序列化时 diff 对比使用的是零初始化的成员而非正确的默认构造实例，导致数值属性被错误覆盖。

**规避方案**: 将 `TMap<FString, FMyStruct>` 替换为 `TArray<FMyPairStruct>`：

```cpp
USTRUCT()
struct FMyPairStruct
{
    GENERATED_BODY()

    UPROPERTY()
    FString Key;

    UPROPERTY()
    FMyStruct Value;
};
```

### 10.3 属性名变换陷阱

`StandardizeCase` 默认行为会：
- 将属性名首字母变为小写（`MyProperty` → `myProperty`）
- 将 `ID` 替换为 `Id`（`PlayerID` → `playerId`）

与外部 API 对接时可能导致字段不匹配。解决方案：使用 `SkipStandardizeCase` flag，或在模板版 API 不支持 flags 时使用非模板版本手动传入。

### 10.4 float 精度问题

浮点数序列化到 JSON 时使用 `double` 表示，`float` 值如 `1.1f` 可能输出为 `1.10000002384185791`。对精度敏感的场景（如货币、坐标同步）需要通过 `CustomExportCallback` 自定义格式化。

---

## 十一、当前项目（ActionRPG）的 JSON 使用现状

ActionRPG 项目当前 **未使用** `FJsonObjectConverter`。现有序列化方案：

| 子系统 | 序列化方式 | 关键文件 |
|--------|-----------|---------|
| 存档系统 | `USaveGame` + `FArchive` 二进制 | `RPGSaveGame.h/cpp` |
| 游戏设置 | `UPROPERTY(Config)` → INI 文件 | `TKGameUserSettings.h/cpp` |
| 网络同步 | UE 原生 Replication | ASC / Character |

---

## 十二、Build.cs 集成要求

使用 `FJsonObjectConverter` 需要在模块的 `Build.cs` 中添加：

```csharp
PrivateDependencyModuleNames.AddRange(new string[] { "Json", "JsonUtilities" });
```

头文件包含：

```cpp
#include "JsonObjectConverter.h"
```

---

## 十三、基础使用示例

### 13.1 Struct → JSON 字符串

```cpp
USTRUCT()
struct FMyData
{
    GENERATED_BODY()

    UPROPERTY()
    FString Name;

    UPROPERTY()
    int32 Score = 0;

    UPROPERTY()
    TArray<FString> Tags;
};

FMyData Data;
Data.Name = TEXT("Player1");
Data.Score = 100;
Data.Tags = { TEXT("VIP"), TEXT("Active") };

FString JsonString;
FJsonObjectConverter::UStructToJsonObjectString(Data, JsonString);
// 输出: {"name":"Player1","score":100,"tags":["VIP","Active"]}
```

### 13.2 JSON 字符串 → Struct

```cpp
FMyData ParsedData;
FJsonObjectConverter::JsonObjectStringToUStruct(JsonString, &ParsedData);
```

### 13.3 JSON 数组 → TArray

```cpp
FString JsonArrayString = TEXT("[{\"name\":\"A\"},{\"name\":\"B\"}]");
TArray<FMyData> DataArray;
FJsonObjectConverter::JsonArrayStringToUStruct(JsonArrayString, &DataArray);
```

### 13.4 自定义导出回调

```cpp
FJsonObjectConverter::CustomExportCallback ExportCb;
ExportCb.BindLambda([](FProperty* Property, const void* Value) -> TSharedPtr<FJsonValue>
{
    if (auto* StructProperty = CastField<FStructProperty>(Property))
    {
        if (StructProperty->Struct == TBaseStructure<FDateTime>::Get())
        {
            const FDateTime& DateTime = *static_cast<const FDateTime*>(Value);
            return MakeShared<FJsonValueString>(DateTime.ToIso8601());
        }
    }
    return {}; // 返回空则使用默认处理
});

TSharedPtr<FJsonObject> JsonObj = FJsonObjectConverter::UStructToJsonObject(Data, 0, 0, &ExportCb);
```

---

## 十四、方案选型决策树

```
需要 JSON 序列化?
├── USTRUCT 结构与 JSON Schema 一致?
│   ├── 是 → FJsonObjectConverter（一行代码搞定）
│   └── 否 → FJsonSerializer + FJsonObject 手动构建
├── 数据量极大（MB 级）?
│   └── 是 → FJsonReader SAX 流式解析
├── 需要运行时多态（基类指针→派生类）?
│   └── 是 → 自定义 CustomImportCallback + _ClassName 字段
│         或使用 IJsonObjectStructConverter 注册
└── 高频热路径（每帧）?
    └── 是 → FArchive 二进制序列化，避免 JSON
```

---

## 参考资料

- [FJsonObjectConverter UE 5.7 API Reference](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/JsonUtilities/FJsonObjectConverter)
- [UE Bug Tracker: UE-230676（TMap 反序列化问题）](https://issues.unrealengine.com/issue/UE-230676)
- [Struct to JSON Serialization - James Brooks](https://blog.jamesbrooks.net/posts/struct-to-json-serialization/)
- [How to use FJsonObjectConverter? - Epic Forums](https://forums.unrealengine.com/t/how-to-use-fjsonobjectconverter/119290)
- [JSON Conversion of TMaps of UStructs - Epic Forums](https://forums.unrealengine.com/t/json-conversion-of-tmaps-of-ustructs-cant-deserialize/350757)
- 引擎源码: `Engine/Source/Runtime/JsonUtilities/Public/JsonObjectConverter.h`
- 引擎源码: `Engine/Source/Runtime/JsonUtilities/Private/JsonObjectConverter.cpp`
- 引擎源码: `Engine/Source/Runtime/JsonUtilities/Public/JsonObjectStructInterface.h`
- 引擎源码: `Engine/Source/Runtime/JsonUtilities/Public/JsonObjectWrapper.h`
