# 手机后端接入：当前接口、变更范围和接续条件

记录日期：2026-10-18。

**状态：已开展客户端准备工作，尚未完成手机 Django 后端接入。** 本文中的已确认接口来自本仓库的 EdgeOne 实现，不能用于推定手机公共账号 API 的路径、字段或令牌机制。客户端仍使用现有 EdgeOne 服务。

## 工程与应用标识

- 工程：`aaronzhang3536/aaronzhang3536.github.io`，Astro 静态网站「一帧之内 / Within One Frame」。
- 核查基线：`master` 的 `8679e8adb7af5005b90231aef1e0dd3a06934b04`。
- 交付目标分支：`master`；改动在独立工作副本完成检查后合并。
- `package.json` 中已有英文名称 `within-one-frame`，建议复用为后端应用标识；尚未在手机后端注册。
- 专属子域名尚未配置。业务字段清单见 [数据范围核查](phone-backend-data-inventory.md)。

## 已从源码核实的现有接口

现有服务根地址为 `https://yzzn-sync-lzgf3t47.edgeone.dev`。下表描述的是仓库当前实现，不是手机 Django 接口文档，也不代表已对线上 EdgeOne 做登录或数据写入测试。

| 功能 | 方法与路径 | 请求 | 返回与行为 |
| --- | --- | --- | --- |
| 注册 | `POST /api/auth/register` | `{u, p, dev?}` | 成功返回 `{token, u, uid, dev}` |
| 登录 | `POST /api/auth/login` | `{u, p, dev?}` | 成功返回 `{token, u, uid, dev}` |
| 当前用户 | 未找到独立端点 | — | 客户端读取本机登录记录；不能将其当作服务端身份核验 |
| 退出 | `POST /api/auth/logout` | Bearer；`{all?: true}` | 不带 `all` 时返回成功，由客户端丢弃令牌；`all: true` 更新账号令牌版本，令已签发令牌失效 |
| 注销账号 | `POST /api/auth/delete` | Bearer；`{p}` | 再次核验密码后删除账号及云端数据 |
| 拉取学习数据 | `GET /api/sync` | Bearer | `{fmt?, v, ts, z\|keys}`；`z` 为 gzip 后的 base64 字符串 |
| 写入学习数据 | `PUT /api/sync` | Bearer；`{fmt:2, base, v?, ts, z\|keys}` | 成功返回 `{ok, ts, v}`；版本不符返回 `409 conflict`；请求体上限 512 KiB |

需要认证的请求使用 `Authorization: Bearer <token>`。现有令牌是本仓库自定义的签名格式，源码配置的有效期为 30 天；没有找到刷新令牌端点。客户端收到当前会话的 `401` 后停止该会话同步并提示重新登录。

账号与同步实现：[`auth/`](../sync-api/edge-functions/api/auth/)、[`_lib.js`](../sync-api/edge-functions/_lib.js)、[`sync.js`](../sync-api/edge-functions/api/sync.js)。客户端实现：[`cloudsync.js`](../src/scripts/lang/cloudsync.js)。

现有服务器按已验证令牌中的用户标识读写一个 KV 数据记录，没有本任务要求的独立应用权限模型。客户端提交的 `uid`、应用名称或本地 `owner` 都不能替代未来服务端对用户与应用权限的校验。

## 本次客户端准备工作

本次改动针对现有同步实现的会话切换和本机保存失败问题。请求绑定发起时的身份与接口，过时响应不得继续提交合并结果、覆盖新登录状态或确认新会话的同步时间。本机学习数据和计数合并基线使用恢复日志，避免部分写入失败后显示成功或在重试时重复累计。

恢复日志保存写入前后值和当前恢复步骤，不参与业务上传或导出，也不复制认证令牌或设备令牌。它会额外占用浏览器存储空间。恢复存在账号归属或后续本地修改冲突时，保留当前数据和日志，暂停处理并明确提示；这类冲突需要先保留导出备份再处理，当前没有自动化的冲突裁决界面。

以下能力仍需后续实现：

- 手机公共账号 API 的注册、登录、当前用户、退出、过期与多应用登录适配。
- 服务端数据表、数据库迁移、应用授权、按用户及应用限定查询和更新，以及相同范围的数据管理入口。
- 全站统一登录和按后端、应用、用户划分的本地数据空间。当前其他模块仍未接入语言中心登录。
- 生产可配置的 HTTPS 业务地址。目前 `yzzn-cloud-api` 仅在 localhost 开发环境生效，线上仍使用默认 EdgeOne 地址。
- 手机专属子域名及 Cloudflare Tunnel、Nginx、Django 配置。

现有“退出保留本机数据”和“换账号时明确选择合并或替换”的流程仍保留。因此，本次修复不能表述为已完成全站账号隔离。旧 EdgeOne 用户也不能仅凭同名账号自动映射到手机公共账号。

## 验证方式与边界

新增回归文件：[`scripts/tests/cloudsync-safety.test.mjs`](../scripts/tests/cloudsync-safety.test.mjs)。它直接加载客户端模块，以受控异步响应及可注入故障的内存存储验证会话切换、本机写入失败和恢复；没有连接手机数据库。

完整仓库检查命令：

```sh
node scripts/run-tests.mjs
npm run build
```

修复前复现两个已确认缺陷的命令如下。此命令预期测试失败，用于证明回归用例能够发现原版本的问题；它不会替换工作区源码。

```sh
git show 8679e8adb7af5005b90231aef1e0dd3a06934b04:src/scripts/lang/cloudsync.js | \
CLOUDSYNC_BASELINE_STDIN=1 CLOUDSYNC_TEST_FILTER='in-flight GET|local word write' \
node scripts/tests/cloudsync-safety.test.mjs
```

2026-10-18 的实际本地结果如下，运行环境为 Linux、Node `v24.19.0`：

| 检查 | 实际结果 |
| --- | --- |
| 新增会话与保存失败回归 | 28 项通过，0 项失败 |
| 原有语言同步回归 | 91 项通过，0 项失败；原有测试文件未修改 |
| 全仓库 `node scripts/run-tests.mjs` | 10 个测试文件全部通过，0 个失败 |
| `node --check src/scripts/site.js` 与 `node --check src/scripts/lang/cloudsync.js` | 通过 |
| `node scripts/eval-smoke.cjs src/scripts/site.js` | `EVAL_COMPLETED_NO_THROW`，退出码 0 |
| `ASTRO_TELEMETRY_DISABLED=1 npm run build` | 成功生成 99 个页面，退出码 0 |
| `git diff --check` | 通过 |

第一次直接构建在 Astro 尝试创建执行环境的遥测配置目录时失败；关闭本次进程的遥测后构建通过，没有因此更改工程依赖、构建配置或权限。修复前的两个原始缺陷回归均失败；第一版交叉审查发现的四种边界问题对应五个用例，在修订前均失败，修订后均通过。

以上 Node 回归测试、构建成功、内存存储模拟均不能作为真实后端 CRUD、服务端权限隔离或手机重启持久化的证据。生产发布结果以对应提交的 GitHub Actions 和实际站点检查为准，不能由本地构建推定。

## 后端接入的接续条件

先取得手机 Django 项目的真实 README，并按 README 核对路由、认证实现、应用权限模型、数据库类型和部署方式。当前还没有这些材料，也没有手机端可执行连接。

生产变更应按以下顺序执行并保留实际记录：

1. 核实当前数据库及配置位置；备份数据库、部署配置和当前代码版本，并检查备份可读性与恢复路径。
2. 在既有认证机制上增加应用数据模型与迁移；业务接口只从服务端已认证身份取得用户归属，并验证应用权限。查询、详情、创建、更新、删除及管理入口使用同一权限范围。
3. 配置专属域名的 HTTPS 路由、代理协议传递、可信域名及必要的跨域允许项；核查预检和重定向不会降级到 HTTP。
4. 客户端接入核实后的账号和业务接口，提供明确的未保存、同步中、保存失败及会话失效状态。
5. 用独立测试数据验证创建、读取、更新和删除；分别验证两名用户、两个应用、越权对象访问、过期令牌、断网及保存失败。
6. 在真实写入后重启实际服务，再读取同一数据核实持久化；记录执行时间、版本、请求结果和清理结果。

以上各项尚未在手机生产环境执行，不能用预期行为填写实际验证结果。
