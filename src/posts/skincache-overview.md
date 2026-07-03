---
title: "GPU Skin Cache 概述"
cat: 角色技术
date: 2026-01-19
mins: 4
---

> GPU 蒙皮缓存系统

---

## 1. 什么是 SkinCache

SkinCache 是 UE 的 GPU 蒙皮缓存系统，将骨骼蒙皮计算从 CPU 移至 GPU，并将计算结果（顶点位置、切线）缓存在 GPU Buffer 中供其他系统使用。

```
传统流程（CPU Skinning）:
┌─────────┐     ┌─────────┐     ┌─────────┐
│ CPU     │ ──→ │ 上传    │ ──→ │ GPU     │
│ 蒙皮计算 │     │ 顶点数据 │     │ 渲染    │
└─────────┘     └─────────┘     └─────────┘

SkinCache 流程（GPU Skinning）:
┌─────────┐     ┌─────────────────────────────────┐
│ CPU     │ ──→ │ GPU                             │
│ 上传骨骼 │     │ ┌─────────┐     ┌─────────────┐ │
│ 矩阵    │     │ │ Compute │ ──→ │ SkinCache   │ │
└─────────┘     │ │ Shader  │     │ (Position/  │ │
                │ │ 蒙皮计算 │     │  Tangent)   │ │
                │ └─────────┘     └──────┬──────┘ │
                │                        │        │
                │    ┌───────────────────┼────┐   │
                │    ▼         ▼         ▼    │   │
                │ ┌─────┐ ┌───────┐ ┌───────┐ │   │
                │ │渲染 │ │Groom  │ │RayTrace│ │   │
                │ └─────┘ └───────┘ └───────┘ │   │
                └─────────────────────────────────┘
```

---

## 2. 依赖 SkinCache 的系统

以下功能**强制依赖** SkinCache，使用时会自动开启：

### 2.1 RayTracing / PathTracing

```cpp
// GPUSkinCache.cpp:2531-2537
if (GEnableGPUSkinCacheShaders)
{
    if (GIsRHIInitialized && IsGPUSkinCacheRayTracingSupported() && IsRayTracingEnabled())
    {
        // Skin cache is *required* for ray tracing.
        NewGPUSkinCacheValue = 1;
    }
}
```

**原因**：RayTracing 需要在 GPU 端访问蒙皮后的顶点位置来构建 BLAS（Bottom Level Acceleration Structure）。

判断函数 `GPUSkinCache.cpp:2337-2342`：
```cpp
bool FGPUSkinCache::IsGPUSkinCacheRayTracingSupported()
{
    return IsRayTracingAllowed()
        && r.RayTracing.Geometry.SupportSkeletalMeshes != 0
        && GEnableGPUSkinCache;
}
```

### 2.2 Groom 毛发系统（Skinning 绑定模式）

Groom 的 `BindingType` 设置为 `Skinning` 时，需要从 SkinCache 读取蒙皮后的顶点位置，让毛发跟随皮肤表面变形。

| 绑定类型 | 说明 | 需要 SkinCache |
|----------|------|----------------|
| `Rigid` | 刚性绑定，跟随骨骼 | ❌ |
| `Skinning` | 蒙皮绑定，跟随皮肤表面 | ✅ |

如果 `Skinning` 模式下 SkinCache 未启用，会输出警告：

```
LogHairStrands: Warning: Groom Component requires Skin Cache for Skinning binding...
```

### 2.3 Nanite Skeletal Mesh

Nanite 骨骼网格体需要 SkinCache 提供 GPU 端的蒙皮顶点数据。

### 2.4 依赖关系总结

```
┌─────────────────────────────────────────────────────┐
│                    SkinCache                         │
│  (GPU 端蒙皮后顶点位置 + 切线)                       │
└─────────────────────────────────────────────────────┘
                        ▲
          ┌─────────────┼─────────────┐
          │             │             │
    ┌─────┴─────┐ ┌─────┴─────┐ ┌─────┴─────┐
    │ RayTracing │ │   Groom   │ │  Nanite   │
    │ PathTracing│ │ (Skinning)│ │ SkeletalMesh│
    └───────────┘ └───────────┘ └───────────┘
```

---

## 3. 控制开关

```
控制层级：

├── 项目设置（编译时）
│   └── r.SkinCache.CompileShaders = 1  ← 编译 Skin Cache Shader
│
├── 全局开关（运行时）
│   ├── r.SkinCache.Mode              ← 启用模式
│   │   ├── 0: 关闭
│   │   ├── 1: 开启
│   │   └── -1: 根据依赖自动判断（默认）
│   └── r.SkinCache.Allow = 1         ← 允许使用
│
└── 资产设置（Per-Mesh）
    └── Skeletal Mesh → Support Compute Skin Cache ✅
```

**CVar 定义位置**: `GPUSkinCache.cpp:89-100`

---

## 4. SkinCache 输出

SkinCache 计算完成后，输出两个 GPU Buffer：

| Buffer | 内容 | 使用者 |
|--------|------|--------|
| `PositionBufferUAV` | 蒙皮后顶点位置 | 渲染、RayTracing、Groom |
| `TangentBufferUAV` | 蒙皮后切线 | 渲染（法线贴图） |

```hlsl
// GpuSkinCacheComputeShader.usf
PositionBufferUAV[VertexIndex] = Position;
TangentBufferUAV[2 * VertexIndex] = TangentX;
TangentBufferUAV[2 * VertexIndex + 1] = TangentZ;
```

---

## 5. 相关文档

| 文档 | 内容 |
|------|------|
| [SkinCache_RecomputeTangents.md](SkinCache_RecomputeTangents.md) | 运行时切线重算机制 |

---

## 更新日志

- **2026-01-19**：创建文档，整理 SkinCache 概述和依赖关系
