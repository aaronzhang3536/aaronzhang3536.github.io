# 架构说明 · 一帧之内 / Within One Frame

> 本文描述**代码现在是什么样**：模块划分、数据流、存储键、外部依赖、构建与部署。
> 操作规程（怎么发文、怎么验证、怎么发布）见 [CLAUDE.md](CLAUDE.md)；画廊式界面的设计约定见 [DESIGN.md](DESIGN.md)。
> 最近一次全量核对：2026-10-01（画廊改版 + 全站 bug 修复之后）。

---

## 1. 总览

纯静态站点：**Astro 5**（lock 中为 5.18.2）构建出约 99 个 HTML 页面，部署到 GitHub Pages；腾讯云 EdgeOne Makers 做国内镜像。唯一的服务端是独立部署的云同步接口 `sync-api/`（EdgeOne 边缘函数 + KV），只给外语中心用。

页面分三层外壳：

| 外壳 | 文件 | 用在哪里 | 加载什么 |
|---|---|---|---|
| **Studio**（画廊式主界面） | `src/layouts/Studio.astro` | 首页、文章、列表、搜索、关于、`/play/` 等所有新页面 | `studio.css` + `studio-content.css` + KaTeX CSS + `scripts/studio.js` |
| **Base**（功能页） | `src/layouts/Base.astro` = `<Studio legacy>` + `site.css` | 实验室、外语中心、术数、音乐等工具页 | 在 Studio 之上补回旧的功能样式；各页自带模块脚本 |
| **Playground**（旧的「UE 编辑器视口」环境） | `src/layouts/Playground.astro` | 只有 `/extras/`（游戏与放松） | `site.css` + `playground-shell.css` + **`scripts/site.js`**（天气、PIE 娱乐区、音乐电台、光标特效…） |

站点内容分成几个「栏目」，每个是一组页面加一组脚本，彼此基本独立：

| 栏目 | 路由 | 页面 | 脚本 |
|---|---|---|---|
| 博客正文 | `/` `/notes/` `/posts/*` `/cat/*` `/tags/*` `/archive/` `/search/` | `src/pages/*.astro` | `studio.js`、`search.js`、`article-toc.js`、`comments.js` |
| 做点好玩的 | `/play/`（交互曲面）→ `/lab/`、`/extras/`、巴别塔 | `play.astro` `extras.astro` | `surface.js`；`/extras/` 用 `site.js` |
| 实验室 | `/lab/*` | `src/pages/lab/` | `src/scripts/lab/*.js`（15 个）+ `_kit.js` |
| 生活 | `/life/` → 外语、音乐、术数 | `life.astro` | — |
| 外语中心 | `/lang/*` | `src/pages/lang/` | `src/scripts/lang/*.js` |
| 术数 | `/shu/*` | `src/pages/shu/` | `src/scripts/shu/*.js` |
| 音乐 | `/music/*` | `src/pages/music/` | `src/scripts/music/ukulele.js` |
| 独立页 | `/standalone/*` | `public/standalone/`（不经 Astro） | 自带 |

```
.
├── astro.config.mjs          # site URL、sitemap、remark-math/rehype-katex、Shiki 主题
├── DESIGN.md                 # 画廊式界面的设计约定（路由、组件、偏好键、封面素材）
├── src/
│   ├── content.config.ts     # 文章集合 schema
│   ├── layouts/              # Studio / Base / Playground
│   ├── components/           # StudioHeader / StudioFooter / PostCard / PostCollection / Icon
│   ├── lib/                  # posts.ts（分类、摘要、URL、搜索文档）· text.mjs（摘要/搜索）· experiments.ts（实验室注册表）
│   ├── styles/               # studio.css · studio-content.css · site.css（功能页 + Playground）· playground-shell.css
│   ├── scripts/
│   │   ├── studio.js  search.js  article-toc.js  surface.js  comments.js
│   │   ├── site.js           # 只在 /extras/（Playground）加载
│   │   └── lab/  lang/  shu/  music/
│   ├── pages/                # 路由
│   └── posts/*.md            # 文章
├── public/
│   ├── data/                 # 运行时数据（词库、DEM 高程）
│   ├── images/editorial/     # 画廊封面素材
│   ├── standalone/           # 独立 HTML（Yotei 两篇、巴别塔游戏）
│   └── models/  images/  robots.txt
├── scripts/
│   ├── run-tests.mjs  eval-smoke.cjs  requirements.txt
│   ├── tests/*.test.mjs      # 零依赖的回归测试（CI 会跑）
│   └── build-*.py  enhance-loess-dem.py   # 构建期数据脚本
├── sync-api/                 # 云同步边缘函数（独立部署）
└── .github/workflows/        # deploy.yml · deploy-edgeone.yml · deploy-sync-api.yml
```

---

## 2. 构建与部署

### 2.1 构建

- `npm run build` → `dist/`。front matter 不符合 schema 会直接构建失败。
- Node 版本：`package.json` 的 `engines` 写 `>=22`，`.nvmrc` 写 `22`（CI 也读它）。
- Markdown：`remark-math` + `rehype-katex`（构建期渲染公式，KaTeX CSS/字体打进包里）；代码高亮用 Shiki `github-dark-dimmed`。
- 搜索索引 `/search-index.json` 在构建期由 `src/pages/search-index.json.ts` 生成（全文，含标题与代码）。

### 2.2 部署流水线

| Workflow | 触发 | 做什么 |
|---|---|---|
| `deploy.yml` | push `master` / 手动 | setup-node（`.nvmrc`）→ `npm ci` → **检查**（`node --check site.js`、`eval-smoke`、`run-tests`）→ `npm run build` → `upload-pages-artifact` → `deploy-pages`；部署失败等 45 s 重试一次；`cancel-in-progress: false` |
| `deploy-edgeone.yml` | push `master` / 手动 | 同一组检查 → 构建 → 用**锁定版本**的 CLI（`EDGEONE_CLI: edgeone@1.6.41`）部署国内镜像 `within-one-frame`；`permissions: contents: read` |
| `deploy-sync-api.yml` | push `master` 且 `sync-api/**` 或本文件有改动 / 手动 | 用同一锁定版本的 CLI 部署 `sync-api` 到 `yzzn-sync`（overseas 区） |

- 三个 workflow 共用仓库 secret `EDGEONE_API_TOKEN`（已配置）；缺 secret 时 EdgeOne 两个直接跳过。
- 检查不过，Pages 和镜像都不会发布。
- GitHub Pages 是正本；镜像预设域名只能预览（需要 `eo_token`），对外公开需要绑定已备案的域名。

---

## 3. 内容层

`src/content.config.ts`，glob `src/posts/**/*.md`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | string | |
| `cat` | enum | `UE 剖析` / `读渲染` / `AI 与认知` / `音乐与生活` / `基础知识` |
| `sub` | enum，可选 | `渲染` / `角色` / `几何` / `系统`，约定只给 `UE 剖析` 用 |
| `date` | coerce.date | |
| `mins` | number | 手填阅读时长 |
| `tags` | string[]，默认 `[]` | 生成 `/tags/<tag>/` |
| `iframe` | string，可选 | 指向 `public/standalone/` 下的独立页，文章页嵌入 |

分类清单、分类显示名、文章「类型」（技术 / 生活 / 交互）、摘要、URL、排序（日期倒序，同日按 id）都集中在 `src/lib/posts.ts`。

---

## 4. 路由

| 路由 | 文件 | 说明 |
|---|---|---|
| `/` | `pages/index.astro` | 封面式首页 + 最近文章（图文 / 列表切换） |
| `/notes/` | `pages/notes.astro` | 全部文章集合 |
| `/posts/<id>/` | `pages/posts/[id].astro` | 封面式阅读页；长目录（`article-toc.js`，粘性侧栏 + 当前位置高亮）；稍后读、字号调整；giscus 评论 |
| `/cat/<cat>/` `/tags/<tag>/` `/archive/` | | 列表页 |
| `/search/` | `pages/search.astro` + `scripts/search.js` | 读取 `/search-index.json` 做全文搜索，全部在浏览器本地完成 |
| `/about/` `/life/` `/play/` `/extras/` | | 关于；生活入口；交互曲面 + 实验入口；游戏与放松（Playground） |
| `/404` | `pages/404.astro` | `noindex`，不输出 canonical |
| `/rss.xml` | `pages/rss.xml.js` | `@astrojs/rss`，带 `<language>zh-CN</language>` |
| `/sitemap-index.xml` | `@astrojs/sitemap` | |
| `/lab/` `/lab/<slug>/` | `pages/lab/` | 见 7.1 |
| `/lang/` `/lang/{english,japanese,korean}/` `/lang/{fr,de,es,it,ru}/` | `pages/lang/` | 后五个由 `[lang].astro` 生成 |
| `/shu/` `/shu/{xiaoliuren,bazi,guanyin}/` | `pages/shu/` | |
| `/music/` `/music/ukulele/` | `pages/music/` | |
| `/standalone/...` | `public/standalone/` | 原样拷贝，不经过任何外壳 |

`Studio` 的 head：title、description、canonical（`noindex` 时改为 robots noindex）、`og:type`（只有文章页是 `article`，并带 `article:published_time`）、`og:image`（`/images/editorial/cover-atlas.webp`）、`twitter:card=summary_large_image`。

---

## 5. Playground 与 `site.js`（只在 `/extras/`）

`Playground.astro` 保留了改版前的「UE 编辑器视口」外壳：主题 / 天气 / 环境音 / PIE 按钮、`#pie` 全屏层、坐标轴 gizmo、页脚控制台 `#cmd`。（装饰性的假 HUD 已在改版中删除。）

`src/scripts/site.js`：约 6900 行的 IIFE，没有 import/export，模块之间靠闭包变量和函数提升互相调用。

| 行号（约） | 模块 | 要点 |
|---|---|---|
| 1–90 | 主题 + 减少动态效果 | dark/light/wire；**只在用户主动选择时写 `yzzn-theme`**，否则实时跟随系统；`reduced` 监听变化，各模块登记 `reducedHooks` |
| 91–172 | 控制台 `#cmd` | weather / bg / search / music / play / 主题 / sound / help / quit |
| 173–247 | 背景图 | 只在可见时（开启、非线框、非隐藏标签页、未被 PIE 盖住）才取图；图源只剩 picsum；失败按顺序换源 |
| 248–1491 | 天气 | 粒子、天空层、小猫、闪电、实时天气（无用户手势且未授权时不调定位）、WebAudio 环境音；rAF 在隐藏 / 被 PIE 盖住 / 减少动态效果时停表；resize 节流，只在宽度或大幅高度变化时重建 |
| 1492–1638 | PIE 框架 | `GM` 注册表 `{zh, incognito, start(stage) → cleanup}`；进入时焦点移入、Tab 困在层内，退出时归还；菜单支持方向键 / Esc |
| 1639–6198 | PIE 各模式 | 茶歇（复用环境音的雨声）、WebGPU 鱼缸（退出必 `device.destroy()`）、游戏厅（`ARC` 注册表，27 款，卡片支持 Enter/空格）、拉伸、禅（触屏双击 / 长按退出） |
| 6199–6263 | 文章页增强 | 只在有 `.md-body` 时生效 |
| 6264–6590 | 音乐电台 | 三个合成频道 + 本地文件 |
| 6591–6633 | 星光 + logo boop | |
| 6634–6940 | 指针特效 | 仅精确指针：光标光晕 / 星屑（静止后停表，指针事件唤醒）、框选（只在真正的空白背景起框，不碰正文、表单、画布、已有选区） |

---

## 6. 画廊界面脚本（Studio）

| 脚本 | 作用 | 本地偏好键 |
|---|---|---|
| `studio.js` | 导航菜单、图文/列表切换、稍后读、阅读字号 | `wof:browse-mode` `wof:bookmarks` `wof:reading-size` |
| `search.js` + `lib/text.mjs` | 全文搜索与片段高亮 | — |
| `article-toc.js` | 文章目录：粘性侧栏、只滚动目录本身、高亮当前小节 | — |
| `surface.js` | `/play/` 的 Canvas2D 交互曲面 | — |
| `comments.js` | giscus：进入视口前 600 px 才注入；12 s 未加载降级为链接 | — |

`wof:` 前缀刻意避开 `yzzn-`，不会进入云同步。

---

## 7. 栏目模块

### 7.1 实验室（`/lab/`）

- 注册表：`src/lib/experiments.ts`（`href, sw, name, desc, tag, live`），`lab/index.astro` 渲染列表。
- 页面结构：`.lab-stage`（`canvas#lab-cv` + `#lab-hud`）+ `.lab-ctl` 控件；WebGPU 页有 `#lab-nogpu` 提示和 `<details><pre id="lab-wgsl">`。
- **共享库 `src/scripts/lab/_kit.js`**（15 个模块都接入）：
  - 失败提示：主函数异常、拿不到上下文 → `#lab-nogpu` 写明原因；`device.lost` → 停循环并提示刷新；`uncapturederror` → HUD 置顶报错；
  - 可暂停的帧循环：画布离屏（IntersectionObserver）或标签页隐藏时暂停，移出文档时彻底停止；
  - ResizeObserver + DPR 变化防抖重排，背板取画布内容盒；各模块随尺寸重建相关纹理/缓冲；
  - 交互画布 `touch-action: none` + `pointercancel`；主题切换通知。
- 13 个是裸 WebGPU + WGSL；`cpu8`、`ipc-cloth` 是 CPU + Canvas2D（无 WebGPU 也能跑）。
- 路径追踪累积到 4096 spp 视为收敛，停止派发直到相机或参数变化。
- lushan：只在指针锁定或画布聚焦时响应飞行键；DEM 加载校验 HTTP 状态与字节数。
- URL 覆盖参数只有 lushan（`scene view t q fog alt pitch yaw dbg pipe lod tau`）、meshlet（`view`）、megalights（`mode lights view`）、pipeline（`view lights`）；cpu8 / ipc-cloth 用 `#run`。
- `wgpu-matrix` 被 7 个模块使用。

### 7.2 外语中心（`/lang/`）与巴别塔

| 页面 | 脚本 | 功能 |
|---|---|---|
| `/lang/english/` | `english.js` + `cloudsync.js` | SM-2 复习、生词本、听写、闯关、词典 + AI 讲解、AI 口语陪练 |
| `/lang/japanese/` `/lang/korean/` | `eastasian.js`（`boot('ja'\|'ko')`）+ `cloudsync.js` | 五十音 / 谚文道场、复习、闯关 |
| `/lang/{fr,de,es,it,ru}/` | `eastasian.js` | 词性竞技场、复习、闯关；俄语另有西里尔字母道场 |

- 共享：`synccore.js`（纯合并逻辑，见 §8）、`langdata.js`（本地日期、删除/清空记录、合并通知事件 `yzzn-sync-applied`）。
- 「今天」按**本地日期**计算（兼容旧的 UTC 日期键）。
- 欧洲语言词包第 2 列是性别 / 词性标签（竞技场判题用），可选第 5 列是展示与朗读形式（如 `l'homme`）。
- AI：只在英语页，用户自带 Key，浏览器直接调用 OpenAI 兼容接口；Key 存在 `yzzn-en-cfg`，不同步、导出时剔除。

**巴别塔**（`public/standalone/babel/`）：`data.js`（词库、卡牌、圣物、敌人）→ `game.js`（规则引擎，`G.on/emit` 事件总线；战斗分 player / enemy / exam / over 四个阶段）→ `ui.js`（DOM 渲染）。

- 词库 `/data/babel-words.json` 带 ECDICT 核实过的构词形式；没有可靠形式的词只考词义。
- `card.lvl` 只表示卡牌强度；是否显示中文、星级只由生词手册（`babel-manual`）决定，手册只能靠答题写入。
- 规则测试：`scripts/tests/babel.test.mjs`。

### 7.3 术数（`/shu/`）

- `core.js` 是共享库：干支、五行、十神、纳音、藏干表；日柱以 2000-01-01 戊午日为锚点。十二节使用由 lunar-javascript 1.7.7 生成的离线时刻表（1900–2101），支持出生日期 1901–2100。`calendarDate` 是无设备时区的日历读数适配器，避免夏令时把出生输入自动移位；原有 Date 调用仍兼容。
- `fourPillars` 默认午夜换日，可选 `dayBoundary: 'zi'` 在 23 点换日；两种模式的晚子时时柱均按次日干计算。`daYun` 按分钟折算起运，返回年月日小时、起运挂钟秒及各步运的精确起止。`solar2lunar` / `lunar2solar` 共享离线农历表，`lunarMonths` 提供实际闰月及每月日数。
- 八字页使用 `Studio.astro` + 独立 `bazi.css`，`bazi-model.js` 处理输入校验、四柱数据、分口径五行统计、十二长生、大运流年流月和文本报告；`bazi.js` 只负责界面。出生输入到分钟，空时间必须补填，不自动替代为中午；不支持真太阳时或历史夏令时校正，不用简单计数判断旺衰。
- 公农历切换保持同一日期；修改输入后撤下旧结果，需重新排盘。结果可复制或下载为文本。出生信息不写入本地存储、URL 或网络，也不参与云同步。
- `xiaoliuren.js` 小六壬（时间起课或报数起课，记录存 `yzzn-xlr-history`）；`guanyin.js` 观音灵签（记录存 `yzzn-gy-history`）。
- 历法回归：`scripts/tests/shu.test.mjs` 保留全范围参考哈希；`bazi.test.mjs` 验证时区间隙、非法日期、公农历逐日往返、换日规则、交节和交运边界、流年月份及报告。

### 7.4 音乐（`/music/ukulele/`）

`ukulele.js`：和弦图、Karplus-Strong 拨弦（分数延迟全通补偿，音高误差 < 0.1 音分）、节拍器、节奏训练（判定与高亮按 `outputLatency + baseLatency + 校准值` 对齐耳朵听到的时刻；触屏舞台左 / 中 / 右 = ↓ / ✕ / ↑）、麦克风调音器（可锁定目标弦，提示八度错误；测频限定 150–1000 Hz）、和弦听辨、7 天计划。设置 `yzzn-uke-cfg`，进度 `yzzn-uke-{rhythm,ear,plan}`。测试：`scripts/tests/ukulele.test.mjs`。

---

## 8. 云同步（`sync-api/` + `cloudsync.js`）

独立的 EdgeOne Pages 项目 `yzzn-sync`（overseas 区，预设域名 `yzzn-sync-lzgf3t47.edgeone.dev`）。

> ⚠ 2026-10-01 从国内网络实测，该预设域名返回平台层 401（`X-EOP-MSG: eo_time missing`），请求到不了函数；国内访客的云同步很可能不可用，需要绑定自定义域名解决。

**端点**（`sync-api/edge-functions/`，公共代码 `_lib.js`）：

| 端点 | 说明 |
|---|---|
| `GET /api/health` | 自检结果在模块级缓存 60 s（不再每次跑 PBKDF2） |
| `POST /api/auth/register` / `login` | `{u, p[, dev]}` → `{token, u, uid, dev}`；PBKDF2-SHA256 6 万次（运行时拒绝 ≥ 12 万）；不存在的用户也跑一次同成本散列 |
| `POST /api/auth/logout` | `{all:true}` 时令牌版本 `tv + 1`，所有设备下线 |
| `POST /api/auth/delete` | `{p}` 再验一次密码，删除账户与数据 |
| `GET /api/sync` | `{fmt:2, v, ts, z\|keys}`；版本号也放在 ETag |
| `PUT /api/sync` | `{fmt:2, base, v, ts, z\|keys}`；`base` 与当前版本不符 → 409，客户端重拉合并重试；上限 512 KB（按字节，先看 Content-Length 再流式读）；旧客户端格式在记录已升级后返回 409 `client_outdated` |

- **令牌**：`uid.uname.exp.tv`（注册时签发的带 `.n`），30 天；校验时比对账户的 `tv` 与 uid。另有一年有效的**设备令牌**，凭它登录不受账户锁影响（防恶意锁号）。
- **频控**：登录每 IP 20 次 / 10 分钟（实例内存精确）+ 40 次 / 10 分钟（KV 近似，按 IP 散列分桶）；账户连续失败 5 次后指数退避锁定（30 s 起，最长 15 分钟）；注册每 IP 5 次/小时、10 次/天，全站每天 300 个。EdgeOne KV 没有 TTL、没有原子操作、跨节点最终一致约 60 s，所以跨节点的频控是近似的。
- **KV 布局**：`acct:<小写用户名>`（含 `tv`、`u`）、`u:<uid>:data`（含 `fmt v z wd wn`，每日写入计数存在记录里）、`lk_<用户名>`、`rl_login_*`、`rl_reg_*`、`rl_reg_all`。
- **控制台配置**：KV 命名空间绑定为 `yzzn_kv`，环境变量 `AUTH_SECRET`（**不要轮换**，否则所有会话与设备令牌失效）。

**前端 `cloudsync.js`**：

- **只同步白名单** `^yzzn-(en|ja|ko|fr|de|es|it|ru)-*`，排除 `*-cfg`、`yzzn-en-ai`、`yzzn-en-dict`；
- 拦截 `Storage.prototype` 的写入，防抖 12 s；未登录时页面加载不发任何请求，health 只在打开「设置」时检查一次；
- 合并（`synccore.js`）：词条按修改时间 `mt` 后写者胜（旧数据从复习状态反推）；删除 / 清空写入墓碑 `yzzn-sync-meta`（保留 180 天）；当日计数按「本机 + 云端 − 上次云端值」相加；星数 / 纪录取大；
- 浏览器支持时 gzip + base64 压缩上传；仍超限则不上传并在页面顶部提示；
- 合并后派发事件让页面就地刷新，不再自动 reload；
- 换账号登录前询问是否合并或用云端替换（替换前先下载备份）；
- `yzzn-cloud-api` 覆盖接口地址**只在 localhost 生效**。
- 测试：`scripts/tests/lang.test.mjs`（合并、多设备端到端）、`scripts/tests/sync-api.test.mjs`（直接调用处理函数，带随机延迟的内存 KV）。

---

## 9. 数据与构建脚本

### 9.1 `public/data/`

| 路径 | 大小 | 格式 | 生成方式 |
|---|---|---|---|
| `en/levels/{zk,gk,cet4,cet6,ky,toefl,ielts,gre}.json` | 共 3.2 MB | `{name, n, words:[[词, 音标, 释义, 词频rank]]}`，已去掉领域专业义项 | `python scripts/build-en-levels.py <ECDICT.csv>` |
| `babel-words.json` | 194 KB | `{n, tiers:[[[词, 音标, 短释义, 词性, 构词?]]]}`，8 档 × 450 词；构词串 `正确形式/其他正确形式\|其他真实变形`，`~` 表示原词 + 后缀 | `python scripts/build-babel-words.py <ECDICT.csv>`（读上一行的 levels） |
| `lang/*.json` | 共 68 KB | `{name, words:[[表记, r, 罗马音/IPA, 中文, 展示形式?]]}` | 手工 |
| `lushan/`（1024²）、`luoyun/`（2048²） | 2 MB / 8 MB | `height.bin`：n×n 的 Uint16LE，$v = (h + 100) \times 10$，第 0 行是北边；`meta.json` | `scripts/build-terrain-dem.py`；罗云村再跑 `enhance-loess-dem.py` |

ECDICT（MIT，<https://github.com/skywind3000/ECDICT>）不在仓库里，重新生成时自行下载。

### 9.2 `scripts/`

| 脚本 | 输入 → 输出 | 备注 |
|---|---|---|
| `run-tests.mjs` | 运行 `scripts/tests/` 下每个 `*.test.mjs` / `*.test.cjs`（各自子进程、60 s 超时） | 全部通过退出 0；`--list`、`-v`；CI 会跑 |
| `eval-smoke.cjs` | 用 Proxy 桩执行 site.js | 成功打印 `EVAL_COMPLETED_NO_THROW`（退出 0），失败打印 `THREW: …`（退出 1）；ES module 一律判为不支持 |
| `build-en-levels.py` | ECDICT CSV → `en/levels/*.json` | 只用标准库 |
| `build-babel-words.py` | ECDICT CSV + levels → `babel-words.json` | 输出可复现；内置不出复数题的名词表等核对表 |
| `build-terrain-dem.py` | Copernicus GLO-30 tif 目录或 AWS terrarium 瓦片 → `height.bin` + `meta.json` | 默认拒绝用 SRTM 覆盖 Copernicus 数据（`--force` 跳过）；烘焙命令写进 `meta.json` 的 `bake` |
| `enhance-loess-dem.py` | 原地增强 luoyun 数据 | 已增强过就拒绝执行 |
| `requirements.txt` | Python 依赖（Pillow、numpy、tifffile、imagecodecs） | |

---

## 10. 浏览器存储键

站点自己的键：功能页用 `yzzn-` 前缀，画廊界面用 `wof:` 前缀。**只有白名单里的 `yzzn-<语言>-*` 会被云同步上传**（见 §8），其余键都只在本机。

| 键 | 归属 | 内容 | 同步 |
|---|---|---|---|
| `wof:browse-mode` `wof:bookmarks` `wof:reading-size` | studio.js | 浏览模式、稍后读、阅读字号 | 否 |
| `yzzn-theme` `yzzn-bg` `yzzn-wx` `yzzn-wx-live` `yzzn-snd` `yzzn-music` | site.js（/extras/） | 主题、背景图、天气、实时天气缓存、环境音、电台 | 否 |
| `yzzn-fish` `yzzn-arcade-hi` `yzzn-arc-coins` `yzzn-arc-<游戏>` | site.js（PIE） | 鱼缸、游戏厅成绩与金币 | 否 |
| `yzzn-en-{words,stats,daily,game}` | english.js | 生词与 SRS 状态、统计 | 是 |
| `yzzn-en-cfg` `yzzn-en-ai` `yzzn-en-dict` | english.js | 配置（含 AI Key）、AI 缓存、词典缓存 | 否 |
| `yzzn-<ja\|ko\|fr\|de\|es\|it\|ru>-{words,dojo,game,daily}` | eastasian.js | 同上 | 是（`-cfg` 除外） |
| `yzzn-sync-meta` | langdata.js | 删除 / 清空墓碑 | 随同步元数据处理 |
| `yzzn-cloud` `yzzn-cloud-api` `yzzn-cloud-base` | cloudsync.js | 登录令牌与归属；接口地址覆盖（仅 localhost）；上次同步的云端快照（计数器三方合并的公共祖先 + 未确认的写入） | 否 |
| `yzzn-xlr-history` `yzzn-gy-history` | shu | 起课 / 抽签记录 | 否 |
| `yzzn-uke-{cfg,rhythm,ear,plan}` | music | 延迟校准、训练进度 | 否 |
| `babel-manual` | 巴别塔 | 生词手册 | 否 |

---

## 11. 运行时外部依赖

站点资源（JS/CSS/字体/公式/封面图）全部本地打包。以下是运行时会访问的第三方服务：

| 服务 | 谁在用 | 何时访问 |
|---|---|---|
| picsum.photos | site.js 背景图（仅 `/extras/`） | 背景图开启且可见时 |
| api.open-meteo.com、ipwho.is、api.bigdatacloud.net；浏览器定位 | site.js 实时天气（仅 `/extras/`） | auto 天气模式；定位只在已授权或用户手动切换时调用 |
| picsum.photos/seed | 拼图小游戏 | 游戏中 |
| giscus.app、GitHub Discussions | comments.js | 文章页滚动到评论区附近时 |
| dictionaryapi.dev、freedictionaryapi.com | english.js | 查词时 |
| 用户自配的 LLM 接口 | english.js | 使用 AI 功能时 |
| yzzn-sync-lzgf3t47.edgeone.dev | cloudsync.js | **仅登录后**同步，或打开「设置」时检查一次 |
| cdn.jsdelivr.net（KaTeX） | `public/standalone/yotei-*.html` | 打开这两篇时 |

---

## 12. 验证手段

| 改动范围 | 怎么验证 |
|---|---|
| 任何改动 | `npx astro build` + `node scripts/run-tests.mjs` |
| `site.js` | `node --check` + `node scripts/eval-smoke.cjs src/scripts/site.js`（退出码可信） |
| 有逻辑的模块 | 修 bug 时在 `scripts/tests/` 加或扩展测试；测试零依赖、随机数要固定种子（CI 不能有偶发失败） |
| lab | `node --check` + 无头 Edge 跑预览页，从 stderr 里 grep `tint` / `validation` / `INFO:CONSOLE`。**`--virtual-time-budget` 下 WebGPU 初始化和帧数都不可靠**（可能停在「正在初始化」），要看真实渲染就用 CDP 实时驱动（等几秒后读 HUD / 截图） |
| 手机宽度布局 | 无头 Edge 窗口**最窄约 500 px**，`--window-size=390,…` 实际视口约 492 px，截图只是被裁窄。用 `width=390` 的 iframe 套页或 CDP `Emulation.setDeviceMetricsOverride` |

---

## 13. 已知架构债（摘要）

1. **site.js 单体**：约 6900 行，现在只在 `/extras/` 加载，对主站性能已无影响；以后要动它可再拆成按需 `import()` 的模块。
2. **site.css 仍承载所有功能页样式**：经 `Base.astro` 加载到实验室 / 外语 / 术数 / 音乐页；可按页拆分。
3. **lab 重复代码**：`_kit.js` 收掉了失败处理、循环、resize、触控；但 `pipeline.js` 仍大量复制 meshlet 与 megalights，wgpu-matrix 与手写向量运算并存。
4. **外语中心两套实现**：english.js 与 eastasian.js 的 SRS 数据结构仍不同（合并层已兼容两种），每关词数不同。
5. **云同步可达性**：overseas 预设域名从国内被平台拦截（见 §8），需要自定义域名。
6. **DEM 数据未压缩**：luoyun 8 MB 原始 Uint16，可做差分 + 压缩。
