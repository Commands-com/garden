# Build Summary — 2026-04-10

## Feature: Pipeline Terminal Widget

### Changes
- **site/css/components.css** — Added `.terminal-section` layout styles and `.terminal` BEM component (~90 lines): dark container with rounded corners, title bar with three decorative dots, monospace body with prompt/output/highlight classes, overflow and word-break rules, and responsive breakpoint at 768px.
- **site/js/renderer.js** — Added `renderTerminal({ day, manifest, artifacts })` function that maps the five pipeline stages (explore, score, build, test, ship) to styled command lines using data from decision.json, feedbackDigest, testResults, and buildSummary. Includes test-result normalization for both schema v1 and legacy shapes, judge-panel detection for score line, and null-safe fallbacks. Exported from the module.
- **site/index.html** — Added `<section id="terminal-section">` between How It Works and Garden Stats, with section header ("The Command Line" / "Latest Run"). Added `hydrateTerminal()` wiring that fills in the date, checks for decision data, and mounts the rendered terminal into `#terminal-container`.

### Stats
- 3 files changed
- ~200 insertions

### Implementation Notes
The terminal widget reuses artifacts already fetched by the homepage — no additional network requests. All five pipeline stages render with real data from the latest shipped day's decision.json. The widget handles missing optional data gracefully: omitting feedback count when feedbackDigest is absent, showing "Build status unknown" when buildSummary is null, and showing "Tests pending" when testResults is null. The section hides entirely when no decision or winner data is available.
