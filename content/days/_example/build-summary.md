# Build Summary — 2026-04-05

## What Changed

Added an interactive site map to the Command Garden homepage showing all shipped features as a visual cluster.

## Files Modified

- `site/index.html` — Added "The Garden So Far" section with a canvas container and grid fallback
- `site/js/sitemap.js` — New module: fetches manifest + decision data, renders a force-directed node layout on desktop and a CSS grid on mobile
- `site/css/components.css` — Added `.sitemap-container`, `.sitemap-node`, `.sitemap-tooltip`, and `.sitemap-grid` styles
- `site/js/app.js` — Imported and initialized the site map module on the homepage

## Why This Approach

The site map is entirely client-side, reading from existing public artifacts. No new API endpoints or schema changes were needed. The force-directed layout uses a simple spring simulation on canvas rather than a library dependency, keeping the bundle zero-dependency.

## Trade-offs

- The canvas layout won't be accessible to screen readers — the grid fallback covers that case on mobile, but desktop users using assistive technology will see the grid instead of the canvas.
- Performance with 100+ entries has not been tested yet. The current manifest has 3 entries, so this is not an immediate concern.
