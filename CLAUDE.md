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
- `public/js/site.js` — one vanilla-JS IIFE with all interactivity: theme cycling, canvas weather system (with lightning), rotating background images, cursor light, marquee selection, card tilt, footer console commands, and the PIE entertainment area (game arcade incl. jigsaw/2048/typing/N-back, tea-break pomodoro, fake shader-compile screen, stretch routine, zen mode). Loaded on every page. Syntax-check with `node --check public/js/site.js`.
- `src/pages/` — index (hero, GPU/async content timeline, series cards, post list), `posts/[id].astro`, `cat/[cat].astro`, `archive.astro`, `rss.xml.js`, `404.astro`.
- `src/posts/*.md` — the content collection (schema in `src/content.config.ts`). Markdown renders with Shiki highlighting (`github-dark-dimmed`) and build-time KaTeX (`remark-math` + `rehype-katex`); KaTeX CSS/fonts are bundled — the site has **zero external CDN dependencies** (deliberate: jsDelivr is unreliable in mainland China).
- Standalone HTML writeups (own styles, e.g. the Yotei pages) live in `public/standalone/` and are embedded via an `iframe:` front matter field on a stub post.

## Publishing a post

Drop one file at `src/posts/<slug>.md`:

```markdown
---
title: "文章标题"
cat: 渲染管线   # one of: 渲染管线 引擎剖析 角色技术 读渲染 AI 与认知 音乐与生活
date: 2026-07-04
mins: 12
---

正文（不要重复一级标题；图片放 public/images/ 并用 /images/... 绝对路径）
```

Commit and push to `master` — the workflow builds and deploys. Homepage list, series counts, category pages, archive, and RSS all derive from the collection automatically.

## Content red line

Never publish documents originating from company project directories (ProjectTK, tk-demo, …) or anything containing project class/asset names (`TK*`, `BP_Monster*`, …) without the owner's explicit per-file approval. Pure engine-mechanism analyses and public-material writeups are OK.

## History

- 2023: stock Hexo hello-world deploy (long gone).
- 2026-07: hand-written single-file site (draft archived at `d:\WorkSpace\ZBlog\blog-design.html`), then migrated to this Astro project. The draft file is no longer the source of truth.
