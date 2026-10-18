# 手机 Django 后端接入

更新：2026-10-18（北京时间）。

已在 Windows 本机 ZhangJieyi 完成源码核对、SSH 接入、备份、手机数据库迁移、专属域名配置和真实客户端联调。客户端从原有 EdgeOne 学习同步切换为 CommonTools 公共账号与本应用独立数据服务。发布与验证记录见 [实际验证记录](phone-backend-verification.md)。

## 入口和配置

| 用途 | 地址 |
| --- | --- |
| 站点账号、导入导出、本人数据管理 | https://aaronzhang3536.github.io/account/ |
| 专属应用入口 | https://within-one-frame.zhangjieyi.cn/ （跳转到账号页） |
| 公共账号 API | https://api.zhangjieyi.cn/api/v1 |
| 应用业务 API | https://within-one-frame.zhangjieyi.cn/api/v1/apps/within-one-frame |
| 管理员入口 | https://within-one-frame.zhangjieyi.cn/admin/within_frame/ |

应用标识为 within-one-frame。部署配置在 [config.js](../public/account/config.js)，接口地址只由可信部署文件决定，不读取同步内容或浏览器里的旧 API 覆盖键。正式地址要求 HTTPS；本机开发允许 localhost / 127.0.0.1 的 HTTP。

服务端沿用手机 ~/commontools-backend、Django 5.2.18、SQLite、Waitress 与 runit。扩展源码在 [phone-backend](../phone-backend/)，install.py 以增量方式复制应用并向现有 settings / urls 添加挂接，不替换 commerce 的账号、订单、付费授权实现。已同步安装到本机 F:/commontools/backend。

## 账号和权限

复用 POST /register、POST /login、GET /me、POST /logout 和 POST /password。注册、登录提交 username、password、product=within-one-frame；成功返回 token、expires_at、username，再由 /me 取得服务端用户 ID。需要认证的调用发送 Authorization: Bearer <token>，不接受网页登录 Cookie。

公共账号会话有效期为 7 天，无刷新接口，每个账号最多 5 个 API 会话。跨应用复用账号与密码，但每个应用单独登录、独立签发会话。退出仅删除当前令牌；修改密码沿用原实现，撤销所有旧会话。401 后清除当前失效令牌，保留该用户的离线存档并提示重新登录，不把它转交给访客或新账号。

新增 Application、Membership、AppSession、State、Record、Operation 六个模型。业务服务同时校验活动用户、未过期令牌、令牌绑定应用、启用的应用及活动成员关系。所有数据从已认证身份取得归属，拒绝客户端指定 user_id / owner。旧公共令牌没有应用绑定时不能直接访问新业务接口。

本应用是开放注册的免费数据空间；Product.enabled 仍为 False，不添加商业套餐、不发放其他工具的付费授权。管理员可停用应用或成员关系；再次登录不会自动恢复被撤销的关系。

普通用户在账号页管理自己的数据。Django 管理员页提供只读数据检查和应用成员管理；有查看权限的普通 staff 只看到自己的活动应用记录，不能利用对象 ID 访问别人的记录。superuser 是明确授权的全局管理角色。数据不通过 Django admin 直接改写，以免绕过版本与删除机制。

## 保存协议

所有路径相对应用业务 API，无尾斜杠。

| 方法与路径 | 请求/响应 |
| --- | --- |
| GET /state | 返回 {version, values}；values 是明确白名单键到原始编码字符串或 null 的映射 |
| PUT /state | 提交 {base, operation_id, values}；全量替换，省略的现存键转为删除墓碑 |
| GET /records | 返回 {version, records:[{id,key,value,modified_at}]}，只列出未删除记录 |
| POST /records | 提交 {base, operation_id, key, value}，创建或更新本人应用中的数据类别 |
| GET /records/<UUID> | 返回本人应用范围内的单条记录和版本 |
| PATCH /records/<UUID> | 提交 {base, operation_id, value} |
| DELETE /records/<UUID> | 提交 {base, operation_id}；保留 null 墓碑 |

operation_id 使用 UUID；同一请求必须重用同一个编号。重复请求返回原版本和 replayed=true，不重复修改。相同编号配不同内容返回 409。base 不是当前版本时返回 409 和云端快照，不覆盖新版本。未登录/过期返回 401，无应用权限返回 403，跨用户对象返回 404，非法字段返回 400。服务端的 SQLite IMMEDIATE 事务覆盖版本比较、数据修改与幂等记录写入。

每个数据类别先验证字段、类型和数量；单类字符串最多 750000 UTF-8 字节、快照最多 120 类和 2 MiB 校验序列化数据；Nginx/Django 请求体上限 3 MiB。写入限流沿用公共后端的持久化频控，每个来源 180 次/分钟。删除墓碑和操作编号本版不自动过期。

客户端将业务值、本地合并基线、版本、未确认请求按“业务 API 地址 + 应用标识 + 服务端用户 ID”分区；访客独立分区。每次业务修改先原子写入独立的本地操作条目，避免另一标签页提交快照时覆盖新操作；快照记录已应用操作，再清理条目，清理中断也不会重复应用。待发送操作与确认元数据不上传为业务值。AI 配置单独留在该用户本地分区。

网络同步通过浏览器 Web Locks 串行化。请求绑定打开页面时的身份，切换账号后迟到响应被拒绝；另一页面改变业务内容会重新载入当前页面。单纯同步时间/版本更新不会引发页面间刷新循环。本地写入失败会显示未保存；网络失败显示本地保留，未收到结果的请求按原编号重试。

## 合并、迁移与边界

保留各业务模块原有的记录格式与单机业务规则，包括最快用时、最高分、取消计划、词条复习状态和最近 6 条历史。跨设备合并采用保守的三方比较：只有一方改变的数据类别自动合并；双方同时修改同一类别则暂停同步并保留双方版本，由账号页选择云端或本机版本，选择前下载本机备份。不会擅自对累计次数相加、把偏好取最大、把取消勾选当作 true，或让旧设备自动恢复已重置的存档。

这是对旧语言同步“自动按字段合并”的明确调整：同一词本或同一天统计的并发修改可能需要人工处理，以保护删除、重置与计数。恢复云端内容后会刷新页面使内存与存档一致，正在进行但未保存的单局/音频状态不属于同步范围。

首次登录不会自动收走访客数据；账号页提供明确确认的访客导入和 JSON 文件导入，可读取原语言导出的 keys 格式。导入前下载当前业务备份。不同后端或同名账号不会自动绑定；原 EdgeOne 服务和旧登录键保持原状，当前页面不再加载 cloudsync.js。旧同步源码与回归测试保留用于历史兼容核查。

同步范围为八种语言、文章收藏及阅读偏好、音乐成绩与练习计划、小六壬/观音神课最近 6 条历史、Babel 生词手册、游戏成绩和站点显示偏好。AI Key、语音配置、音频校准、天气位置缓存、出生信息、AI 对话、本地音频文件、认证令牌不进入业务接口。GitHub Discussions 评论保持原身份来源。字段清单见 [数据清单](phone-backend-data-inventory.md)。

## 部署、备份和回退

已确认 Windows 本机 SSH，使用原有手机连接与专用密钥；没有复制或输出私钥。变更前完整备份：

- 手机：~/phone-server-backups/within-one-frame-20261018-151406/
- 电脑：F:/PhoneServer/backups/within-one-frame-20261018-151406.tar.gz
- 归档 SHA256：bf861e8872a1032ec85ef0dc49111b519c5ce29e84b28252a9eba6c618bca8e7
- 迁移前再次在线备份：~/commontools-backend/backups/backend-20261018-072825-64bcd7.sqlite3
- 该迁移前快照的异机副本：F:/PhoneServer/backups/within-one-frame-pre-migrate-20261018.sqlite3

完整备份包含 SQLite 一致性快照、.env、当前源码、Nginx 主配置/原应用配置、隧道配置和服务启动脚本。数据库 integrity_check 为 ok；异机归档摘要一致。备份含私密配置，只保存在上述本机/手机私有路径，不进入本仓库。

迁移为 within_frame.0001_initial 和 0002_seed_application。configure_phone.py 增量添加专属虚拟主机、具体 ALLOWED_HOSTS、精确的跨域来源及 Tunnel ingress。域名 CNAME 指向既有隧道，未覆盖原域名记录。Nginx 继续仅监听 127.0.0.1:8080，后端仅监听 127.0.0.1:8765。原健康服务保留。公共 /api/v1 根路径不再产生降级到 HTTP:8080 的重定向。

后续部署顺序：先备份并检查备份，再运行 install.py、check、makemigrations --check --dry-run、独立测试数据库测试、migrate，配置有变化时再运行 configure_phone.py，校验 nginx -t 与 cloudflared tunnel ingress validate，最后重启 commontools-backend、重载 Nginx；修改 ingress 时重启 cloudflared。

回退优先恢复备份中的源码、settings/urls、.env 和代理配置，停用新入口，保留新增的数据表及现有业务数据；不直接回滚 SQLite 整库，以免丢失迁移后其他工具的订单或账号修改。确需整库恢复时，先停止后端、另存当前数据库，再用所选一致性快照恢复并校验、迁移、启动。恢复前必须明确接受该快照之后的数据损失。初始备份没有 within-one-frame.conf，配置回退时同时移除新主配置 include；保留未引用的配置文件不影响运行。

手机关机或断网仍会导致公网不可用。本次“重启持久化”指真实 runit 后端服务重启，未对整台手机执行重启，也不代表长期锁屏网络稳定性已得到证明。

## 检查命令

    node scripts/run-tests.mjs
    node --check src/scripts/site.js
    node scripts/eval-smoke.cjs src/scripts/site.js
    npm run build
    python manage.py check
    python manage.py makemigrations --check --dry-run
    python manage.py test within_frame commerce --noinput

verify_live.py 只用于显式创建的临时应用和测试账号，状态文件包含测试密码/令牌，必须放在 .local 或其他私有目录并在测试后清理；不可用于重置真实用户的存档。

依据：[Django SQLite 事务](https://docs.djangoproject.com/en/5.2/ref/databases/#transactions-behavior)、[Cloudflare Tunnel DNS 路由](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)。
