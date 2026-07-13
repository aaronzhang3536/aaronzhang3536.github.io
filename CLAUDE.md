# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Source of the personal blog **「一帧之内 / Within One Frame」** (aaronzhang3536.github.io), built with **Astro 5** and deployed to GitHub Pages via GitHub Actions (`.github/workflows/deploy.yml`, official `withastro/action`). Pages Source must be set to "GitHub Actions" in repo settings.

## Commands

- `npm run dev` — dev server with hot reload
- `npm run build` — build to `dist/` (this is the only test that matters; front matter schema violations fail the build)
- `npm run preview` — serve the built output locally

## Architecture

- `src/layouts/Base.astro` — the site shell ("UE editor viewport" concept): theme tokens, header with theme/weather/PIE buttons, stat HUD, axis gizmo, PIE overlay markup, footer console. Present on every page.
- `src/styles/site.css` — all styling, driven by CSS custom properties on `:root`; three themes (dark / light / wireframe) are token-level overrides. New UI must use the tokens, never hardcoded colors.
- `src/scripts/site.js` — one vanilla-JS IIFE with all interactivity (bundled by Vite via `Base.astro`): theme cycling, canvas weather system (with lightning), rotating background images, cursor light, marquee selection, card tilt, footer console commands, and the PIE entertainment area (game arcade, tea-break pomodoro, WebGPU fish tank, stretch routine, zen mode). Loaded on every page. Before committing changes run BOTH `node --check src/scripts/site.js` AND `node scripts/eval-smoke.cjs src/scripts/site.js` — the smoke test executes the module top-level with proxy DOM stubs and catches runtime ReferenceErrors (e.g. a deleted function still referenced in the ARC game registry) that a syntax check cannot see. This exact failure once silently killed the whole arcade.
- `src/pages/` — index (hero, GPU/async content timeline, series cards, post list), `posts/[id].astro`, `cat/[cat].astro`, `archive.astro`, `rss.xml.js`, `404.astro`.
- `src/posts/*.md` — the content collection (schema in `src/content.config.ts`). Markdown renders with Shiki highlighting (`github-dark-dimmed`) and build-time KaTeX (`remark-math` + `rehype-katex`); KaTeX CSS/fonts are bundled — the site has **zero external CDN dependencies** (deliberate: jsDelivr is unreliable in mainland China). One nuance: the weather system's 「实时」 mode calls free no-key runtime APIs (open-meteo.com, ipwho.is, bigdatacloud.net) — optional runtime fetches with graceful degradation (failure keeps the current effect; every other weather mode stays fully local), not asset dependencies.
- Standalone HTML writeups (own styles, e.g. the Yotei pages) live in `public/standalone/` and are embedded via an `iframe:` front matter field on a stub post.

## Publishing a post

Drop one file at `src/posts/<slug>.md`:

```markdown
---
title: "文章标题"
cat: UE 剖析    # one of: UE 剖析 读渲染 AI 与认知 音乐与生活
sub: 渲染       # 仅 UE 剖析需要，one of: 渲染 角色 几何 系统
date: 2026-07-04
mins: 12
---

正文（不要重复一级标题；图片放 public/images/ 并用 /images/... 绝对路径）
```

Commit and push to `master` — the workflow builds and deploys. Homepage list, series counts, category pages, archive, and RSS all derive from the collection automatically.

## Ship & deploy flow (发布流程)

Every change — post, UI, or lab experiment — follows the same **build → verify → commit → deploy → confirm** loop. Never assume a push succeeded; always poll the deploy to completion and curl the live URL.

1. **Build.** `npx astro build` must pass. This is the real gate: front-matter schema violations and broken imports fail here, not at runtime.
2. **Verify before commit**, scaled to what changed:
   - `src/scripts/site.js` — run BOTH `node --check src/scripts/site.js` and `node scripts/eval-smoke.cjs src/scripts/site.js` (see Architecture; the smoke test catches runtime ReferenceErrors a syntax check can't).
   - Any `src/scripts/lab/*.js` WebGPU experiment — syntax-check, then **drive it in real headless Chromium** against a live `npx astro preview`, never ship a shader you only eyeballed. Command shape (Edge/Chrome):
     `msedge --headless=new --enable-unsafe-webgpu --enable-features=Vulkan --enable-logging=stderr --v=0 --virtual-time-budget=9000 --dump-dom <preview-url>` then grep the stderr log for `tint` / `validation` / `INFO:CONSOLE` errors; swap `--dump-dom` for `--screenshot=out.png` to eyeball the render and read the HUD. Each lab page honors a `?view=` / `?mode=` / `?lights=` query-param override so a specific state can be screenshotted headlessly. WGSL gotchas that recur: `auto` layout strips any binding a shader declares but never reads (trim it or the bind group 400s); `self` is a reserved word; a fragment stage caps at 8 storage buffers unless you request `maxStorageBuffersPerShaderStage`.
   - Pure content (`src/posts/*.md`) — the build is enough.
3. **Commit.** Branch is `master`. End every commit message with the trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.
4. **Push & wait.** `git push origin master` triggers `.github/workflows/deploy.yml` (`withastro/action`). Poll the run rather than trusting the push:
   `curl -s "https://api.github.com/repos/aaronzhang3536/aaronzhang3536.github.io/actions/runs?per_page=1"` → require `status == "completed"` && `conclusion == "success"` on the **new** head SHA (guard against reading the previous run). The deploy step flakes intermittently (~1 in 6); the workflow carries a `continue-on-error` retry, but if a whole run fails, re-trigger with an empty commit (`git commit --allow-empty -m …`) — don't assume it self-heals.
5. **Confirm live.** `curl` the deployed URL and grep for a marker unique to the change (an element id, a string) before declaring done.
6. **国内镜像（best-effort）.** Tencent EdgeOne Makers project `within-one-frame` (ID `makers-5f25g5ptncfl`, account 1079101015). Two paths: (a) CI — `.github/workflows/deploy-edgeone.yml` runs `npx edgeone makers deploy dist` on push, but skips silently until the repo secret `EDGEONE_API_TOKEN` is configured; (b) local — the machine is logged in via `edgeone login -s china` (credentials in `~/.edgeone/`), so `npx edgeone makers deploy dist -n within-one-frame` works directly after a build. Preset domain `within-one-frame-f6egecj3.edgeone.cool` is preview-only (401 without `eo_token` query) — public access requires binding an ICP-filed custom domain in the console. GitHub Pages remains the source of truth; don't block a ship on the mirror.

## Cloud sync API (`sync-api/`)

Multi-user auth + learning-data sync for the language center, served as a **separate EdgeOne Pages project `yzzn-sync`** (ID `makers-qud9xbnd3kz0`, **overseas area** — its preset domain `yzzn-sync-lzgf3t47.edgeone.dev` is publicly reachable, unlike china-area preset domains which are eo_token-gated; this was verified empirically). Structure: `sync-api/edge-functions/` (register/login = PBKDF2-SHA256 ≤60k iterations — the runtime rejects ≥120k with "Param Invalid" — + HMAC session tokens; sync = one KV key per user, client-side merge). Deployed by CI alongside the mirror, or locally `npx edgeone makers deploy sync-api -n yzzn-sync -a overseas`. Requires console config on the project: KV namespace bound as variable `yzzn_kv` + env var `AUTH_SECRET`; until then endpoints return 503 JSON and the frontend degrades gracefully. Frontend: `src/scripts/lang/cloudsync.js` (mounted on all 8 language pages' settings panel; localStorage keys `yzzn-*` minus `-cfg`/caches; merge = word-level rep/due winner + recursive numeric-max). Contract tests run against `scratchpad mock-sync.mjs`; a `yzzn-cloud-api` localStorage key overrides the API base for testing.

## Lab (`src/pages/lab/` + `src/scripts/lab/`)

Raw-WebGPU graphics/physics/architecture experiments, each a standalone `*.astro` page + `*.js` module registered in `src/pages/lab/index.astro`'s `demos` array (`live: true` to surface it). All are bare WGSL, no framework. They share conventions: a `#lab-cv` canvas + `#lab-hud` readout, timestamp-query GPU timing, a `?`-query-param override for headless capture, and pointer-drag orbit / wheel zoom. When editing one, re-verify per step 2 above.

## Content red line

Never publish documents originating from company project directories (ProjectTK, tk-demo, …) or anything containing project class/asset names (`TK*`, `BP_Monster*`, …) without the owner's explicit per-file approval. Pure engine-mechanism analyses and public-material writeups are OK.

## History

- 2023: stock Hexo hello-world deploy (long gone).
- 2026-07: hand-written single-file site (draft archived at `d:\WorkSpace\ZBlog\blog-design.html`), then migrated to this Astro project. The draft file is no longer the source of truth.
