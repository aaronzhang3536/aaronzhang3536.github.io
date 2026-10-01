# Gallery interface

The approved design uses an asymmetric photographic cover layout for the home page, a real article collection with gallery/list views, and a cover-led reading layout with a sticky outline. The interactive surface study and About page preserve the approved prototype's layout and copy.

## Content and routes

- `/`, `/notes/`, `/posts/<id>/`, `/archive/`, `/cat/<cat>/`, `/tags/<tag>/`, and `/search/` derive their article content from `src/posts/`.
- `/search-index.json` includes article text, headings and code, generated at build time. Search is local to the browser and uses no external service.
- `/play/` contains the Canvas2D surface study and links to the existing lab and arcade.
- `/life/` connects the real music/language pages. No prototype diary entries were added as published posts.
- Existing application pages retain their feature styles and scripts through `Base.astro`; `Playground.astro` keeps the original interactive environment on `/extras/`.
- Markdown, KaTeX, standalone embeds and giscus comments remain supported. Existing post/tag/category URLs are unchanged.

## Browser preferences

`wof:browse-mode`, `wof:bookmarks`, and `wof:reading-size` are local preferences. Their prefix deliberately avoids the legacy cloud-sync system's `yzzn-*` namespace. Storage denial degrades to in-memory interaction; no article content or preferences are sent by the new gallery scripts.

## Components and styles

`Studio.astro` is the site shell. `StudioHeader`, `StudioFooter`, `PostCard`, and `PostCollection` share navigation and content presentation. `src/lib/posts.ts` supplies real article descriptors. `src/lib/text.mjs` provides excerpt and search logic. Colors are centralized CSS tokens in `studio.css` and `studio-content.css`.

## Approved cover asset

`public/images/editorial/cover-atlas.webp` is an illustrative editorial triptych approved during design review. It is not a photograph of the author's home or work. The original is preserved outside the repository; the production asset is a format-optimized WebP with unchanged dimensions.

Cover design brief: three equal square compositions in one wide contact sheet with no text or borders: a folded translucent blue glass sculpture with amber caustics against ink blue; a sunlit home corner with vinyl, a green plant and cobalt cup; an undulating architectural surface in pale lavender and blue-gray light. Refined editorial photography, realistic materials, no people or lettering.

## Verification

Run `npm run build`, `node --test scripts/tests/gallery-search.test.mjs`, and the repository test runner when available. Inspect home, index, long articles, embedded articles, search, play, About and existing applications at desktop and phone widths. Verify long TOC scrolling, native anchors, math/code/table overflow, filtering, view persistence, bookmarks and keyboard navigation.

## Article-specific cover update · 2026-10-01

All 23 current posts now have individually generated conceptual covers. `src/data/post-covers.json` maps the article ID to its full image, small variant and Chinese alternative text. `PostCover.astro` is shared by homepage recommendations, collection/category/tag cards, related posts and article headers; the same full image is used for Open Graph and Twitter previews. New posts without a registered cover show a neutral fallback, not a reused article image.

Files: `public/images/posts/<article-id>.webp` (1440 × 960) and `<article-id>-small.webp` (480 × 320). Images use responsive source selection and below-the-fold lazy loading. The original three-scene atlas remains only for non-article section artwork. These are editorial illustrations, not engine screenshots or exact algorithm diagrams. The built-in image generator was used; final prompts are recorded in `public/images/posts/README.md`.
