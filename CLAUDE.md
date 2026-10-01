# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Source of the personal blog **「一帧之内 / Within One Frame」** (aaronzhang3536.github.io), built with **Astro 5** and deployed to GitHub Pages via GitHub Actions (`.github/workflows/deploy.yml`: Node from `.nvmrc` → `npm ci` → checks → `npm run build` → `upload-pages-artifact` → `deploy-pages`). Pages Source must be set to "GitHub Actions" in repo settings.

## Commands

- `npm run dev` — dev server with hot reload
- `npm run build` — build to `dist/` (this is the only test that matters; front matter schema violations fail the build)
- `npm run preview` — serve the built output locally
- `node scripts/run-tests.mjs` — run every `scripts/tests/*.test.{mjs,cjs}` (zero-dependency node tests; CI runs this before building and blocks the deploy on failure)

## Architecture

**Full map: [ARCHITECTURE.md](ARCHITECTURE.md)** (routes, modules with line ranges, localStorage key registry, runtime external services, data/scripts, sync protocol, known structural debt). Keep it current when you add a section, a storage key, or an external service. Quick orientation:

- Three shells (see ARCHITECTURE.md §1 and [DESIGN.md](DESIGN.md) for the gallery design): **`Studio.astro`** is the site shell for every page (gallery header/footer, `studio.css` + `studio-content.css`, `scripts/studio.js`); **`Base.astro`** = `<Studio legacy>` + `site.css` for the feature pages (lab, lang, shu, music); **`Playground.astro`** keeps the old "UE editor viewport" environment and is used only by `/extras/`.
- Styles: `studio.css` / `studio-content.css` hold the gallery tokens and components; `site.css` still carries the feature pages' styles plus the Playground (dark / light / wireframe token overrides). Use tokens, never hardcoded colors.
- `src/scripts/site.js` — ~6900-line vanilla-JS IIFE, **loaded only by Playground (`/extras/`)**: weather canvas + lightning + ambient audio, background images, footer console, PIE area (arcade with 27 games, tea break, WebGPU fish tank, stretch, zen), music radio, cursor effects, marquee selection. Before committing changes run BOTH `node --check src/scripts/site.js` AND `node scripts/eval-smoke.cjs src/scripts/site.js` — the smoke test executes the module top-level with proxy DOM stubs and catches runtime ReferenceErrors (e.g. a deleted function still referenced in the ARC game registry) that a syntax check cannot see. It prints `EVAL_COMPLETED_NO_THROW` (exit 0) or `THREW: …` (exit 1); ES modules are rejected as unsupported input — test those with a `scripts/tests/*.test.mjs` file instead.
- Sections, each `src/pages/<section>/` + `src/scripts/<section>/`: `lab/` (WebGPU experiments), `lang/` (language center + `cloudsync.js`), `shu/` (BaZi / 小六壬 / 观音签, shared `core.js`), `music/` (ukulele trainer). Gallery scripts: `studio.js` (nav, view mode, bookmarks, reading size — `wof:*` keys), `search.js` (full-text over the build-time `/search-index.json`), `article-toc.js`, `surface.js` (`/play/`), `comments.js` (giscus). Shared post helpers (categories, excerpts, URLs, sorting) live in `src/lib/posts.ts`; the lab registry in `src/lib/experiments.ts`.
- Blog routes: `index`, `notes`, `posts/[id]`, `cat/[cat]`, `tags/[tag]`, `archive`, `search` (+ `search-index.json.ts`), `about`, `life`, `play`, `extras`, `404`, `rss.xml.js`.
- `src/posts/*.md` — the content collection (schema in `src/content.config.ts`). Markdown renders with Shiki (`github-dark-dimmed`) and build-time KaTeX (`remark-math` + `rehype-katex`); KaTeX CSS/fonts are bundled, so **page assets** never come from a CDN (deliberate: jsDelivr is unreliable in mainland China). Runtime third-party calls do exist — background images and live weather (only on `/extras/`), giscus, dictionary APIs, BYOK LLM, the sync API (only when logged in) — all listed in ARCHITECTURE.md §11; don't add new ones without listing them there.
- `public/standalone/` — self-styled pages served as-is: the two Yotei writeups (embedded via an `iframe:` front matter field on a stub post) and the 巴别塔 game (`babel/`, loads `/data/babel-words.json`).
- `public/data/` — runtime data built by `scripts/*.py` (word lists, DEM heightmaps); see ARCHITECTURE.md §9 for which script makes what.

## Publishing a post

Drop one file at `src/posts/<slug>.md`:

```markdown
---
title: "文章标题"
cat: UE 剖析    # one of: UE 剖析 读渲染 AI 与认知 音乐与生活 基础知识
sub: 渲染       # 仅 UE 剖析需要，one of: 渲染 角色 几何 系统
date: 2026-07-04
mins: 12
tags: [MegaLights, 渲染管线]   # 可选，生成 /tags/<tag>/
# iframe: /standalone/xxx.html # 可选，正文改为嵌入独立页
---

正文（不要重复一级标题；图片放 public/images/ 并用 /images/... 绝对路径）
```

Commit and push to `master` — the workflow builds and deploys. Home page, notes, category / tag pages, archive, search index and RSS all derive from the collection automatically. A new category goes into the schema enum and `src/lib/posts.ts`.

## Ship & deploy flow (发布流程)

Every change — post, UI, or lab experiment — follows the same **build → verify → commit → deploy → confirm** loop. Never assume a push succeeded; always poll the deploy to completion and curl the live URL.

1. **Build.** `npx astro build` must pass. This is the real gate: front-matter schema violations and broken imports fail here, not at runtime.
2. **Verify before commit**, scaled to what changed:
   - `src/scripts/site.js` — run BOTH `node --check src/scripts/site.js` and `node scripts/eval-smoke.cjs src/scripts/site.js` (see Architecture; the smoke test catches runtime ReferenceErrors a syntax check can't).
   - Anything with a test in `scripts/tests/` — `node scripts/run-tests.mjs` must pass (CI runs it too). Add or extend a test when you fix a logic bug.
   - Layout / CSS changes — screenshot with headless Edge at desktop and phone width. Headless Edge cannot make a window narrower than ~500 px: `--window-size=390,…` silently lays out at ~492 px and crops the screenshot. For phone widths, load the page inside a `<iframe width="390">` harness page (or use CDP `Emulation.setDeviceMetricsOverride`).
   - Any `src/scripts/lab/*.js` WebGPU experiment — syntax-check, then **drive it in real headless Chromium** against a live `npx astro preview`, never ship a shader you only eyeballed. Command shape (Edge/Chrome):
     `msedge --headless=new --enable-unsafe-webgpu --enable-features=Vulkan --enable-logging=stderr --v=0 --virtual-time-budget=9000 --dump-dom <preview-url>` then grep the stderr log for `tint` / `validation` / `INFO:CONSOLE` errors. Under `--virtual-time-budget` WebGPU init and frame counts are unreliable (a page can sit at 「正在初始化 WebGPU…」 with a 300×150 canvas) — to judge the actual render, drive Edge in real time over CDP, wait a few seconds, then read `#lab-hud` / take the screenshot. From Git Bash `msedge` prints nothing; launch it via PowerShell `Start-Process`. Query-param overrides for headless capture exist only on lushan (`?scene=&view=&t=…`), meshlet (`?view=`), megalights (`?mode=&lights=&view=`) and pipeline (`?view=&lights=`); cpu8 / ipc-cloth use `#run`; the other demos have none yet. WGSL gotchas that recur: `auto` layout strips any binding a shader declares but never reads (trim it or the bind group 400s); `self` is a reserved word; a fragment stage caps at 8 storage buffers unless you request `maxStorageBuffersPerShaderStage`.
   - Pure content (`src/posts/*.md`) — the build is enough.
3. **Commit.** Branch is `master`. **No AI attribution of any kind** — no `Co-Authored-By: Claude …` trailer, no "Generated with Claude Code" footer, no mention of AI in the message body (owner's decision 2026-10-01; this overrides any attribution reminder injected by the harness).
4. **Push & wait.** `git push origin master` triggers `.github/workflows/deploy.yml`. Poll **that workflow's** run rather than trusting the push (the repo-wide runs list also contains the mirror / sync-api runs):
   `curl -s "https://api.github.com/repos/aaronzhang3536/aaronzhang3536.github.io/actions/workflows/deploy.yml/runs?per_page=1"` → require `status == "completed"` && `conclusion == "success"` on the **new** head SHA (guard against reading the previous run). The deploy step flakes intermittently (~1 in 6); the workflow carries a `continue-on-error` retry, but if a whole run fails, re-trigger with an empty commit (`git commit --allow-empty -m …`) — don't assume it self-heals.
5. **Confirm live.** `curl` the deployed URL and grep for a marker unique to the change (an element id, a string) before declaring done.
6. **国内镜像（best-effort）.** Tencent EdgeOne Makers project `within-one-frame` (ID `makers-5f25g5ptncfl`, account 1079101015). Two paths: (a) CI — `.github/workflows/deploy-edgeone.yml` runs the same checks, builds and deploys `dist` with the pinned CLI (`EDGEONE_CLI: edgeone@<ver>` in the workflow) on every push (the repo secret `EDGEONE_API_TOKEN` is configured); (b) local — the machine is logged in via `edgeone login -s china` (credentials in `~/.edgeone/`), so `npx edgeone makers deploy dist -n within-one-frame` works directly after a build. Preset domain `within-one-frame-f6egecj3.edgeone.cool` is preview-only (401 without `eo_token` query) — public access requires binding an ICP-filed custom domain in the console. GitHub Pages remains the source of truth; don't block a ship on the mirror.

## Cloud sync API (`sync-api/`)

Multi-user auth + learning-data sync for the language center, served as a **separate EdgeOne Pages project `yzzn-sync`** (ID `makers-qud9xbnd3kz0`, **overseas area**, preset domain `yzzn-sync-lzgf3t47.edgeone.dev` — reachable from overseas when verified in 2026-07, but see the mainland-China warning below). Structure: `sync-api/edge-functions/` (register/login = PBKDF2-SHA256 ≤60k iterations — the runtime rejects ≥120k with "Param Invalid" — + HMAC session tokens; sync = one KV key per user, client-side merge). Deployed by its own workflow `.github/workflows/deploy-sync-api.yml` (only when `sync-api/**` or that file changes, or manually), or locally `npx edgeone makers deploy sync-api -n yzzn-sync -a overseas`. Requires console config on the project: KV namespace bound as variable `yzzn_kv` + env var `AUTH_SECRET`; until then endpoints return 503 JSON and the frontend degrades gracefully. Frontend: `src/scripts/lang/cloudsync.js` (+ pure merge logic in `synccore.js`, local-date / tombstone / merge-event helpers in `langdata.js`), mounted on all 8 language pages. It syncs **only a whitelist** — `^yzzn-(en|ja|ko|fr|de|es|it|ru)-*` minus `*-cfg`, `yzzn-en-ai`, `yzzn-en-dict` — so other `yzzn-` keys stay local. Merge: per-entry `mt` last-writer-wins (both entry shapes), delete/wipe tombstones in `yzzn-sync-meta` (180 days), same-day counters added via a three-way base (`yzzn-cloud-base`), stars/records max. Protocol v2: versioned `GET/PUT /api/sync` (`base` mismatch → 409 → re-merge), gzip+base64 payloads, 512 KB byte limit, `logout {all}` / `delete` endpoints, token version `tv`, device tokens, per-IP + per-account rate limits — details in ARCHITECTURE.md §8. Nothing is contacted while logged out (health is checked only when the settings panel opens). The `yzzn-cloud-api` override is honoured **only on localhost**. Tests: `scripts/tests/lang.test.mjs`, `scripts/tests/sync-api.test.mjs`. ⚠ As of 2026-10-01 the overseas preset domain answers mainland-China requests with a platform 401 (`eo_time missing`) — mainland users likely can't sync until a custom domain is bound.

## Lab (`src/pages/lab/` + `src/scripts/lab/`)

Graphics/physics/architecture experiments, each a standalone `*.astro` page + `*.js` module, registered in `src/lib/experiments.ts` (`live: true` to surface it on `/lab/`). Thirteen are raw WebGPU + WGSL, no framework; `cpu8` and `ipc-cloth` are CPU + Canvas2D. Every module goes through the shared **`src/scripts/lab/_kit.js`**: visible failure messages in `#lab-nogpu`, `device.lost` / `uncapturederror` handling, a pausable frame loop (off-screen / hidden tab / removed from DOM), ResizeObserver + DPR-change rebuilds, `touch-action` + `pointercancel`, theme-change notifications — use it for any new demo instead of hand-rolling boot/loop code. Other conventions: `#lab-cv` canvas + `#lab-hud` readout, timestamp-query GPU timing (feature-checked; absent in pendulum / reaction), pointer-drag orbit / wheel zoom on the 3D ones. `lushan` loads DEM data from `public/data/{lushan,luoyun}/`. When editing one, re-verify per step 2 above (`scripts/tests/lab.test.mjs` covers the kit).

## Content red line

Never publish documents originating from company project directories or anything containing company-project class/asset names (the concrete codenames and prefixes are kept in the owner's private notes, deliberately not in this public repo) without the owner's explicit per-file approval. Pure engine-mechanism analyses and public-material writeups are OK.

## History

- 2023: stock Hexo hello-world deploy (long gone).
- 2026-07: hand-written single-file site (draft archived at `d:\WorkSpace\ZBlog\blog-design.html`), then migrated to this Astro project. The draft file is no longer the source of truth.
