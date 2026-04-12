# Command Garden — AI Agent Guide

This guide is for any AI model (Claude, GPT, Gemini, or others) working on Command Garden. Read this before making changes.

## What Is This Project?

A public website at **commandgarden.com** that ships one user-visible feature per day via an autonomous AI pipeline. The full decision trail — candidates, scores, judge reviews — is published publicly.

## Project Structure

```
site/                   # Static website (HTML, CSS, JS) — deployed to S3/CloudFront
  css/                  # design-system.css (variables) + components.css (BEM components)
  js/                   # app.js (data loading), renderer.js (DOM rendering), feedback.js
  game/                 # Phaser game shell, scenes, systems, config, and asset manifest
  days/                 # Daily artifacts served to users (decision.json, spec.md, etc.)
  images/               # Logo, favicon, OG image
  index.html            # Homepage
  archive/index.html    # Browse all days
  feedback/index.html   # Submit feedback
  judges/index.html     # Judge panel explainer
  days/index.html       # Individual day view

runner/                 # Daily pipeline automation (Node.js)
  daily-runner.js       # Main orchestrator — runs the 5-stage pipeline
  artifact-publisher.js # Uploads artifacts + site to S3, invalidates CloudFront
  asset-generator.js    # Replicate + ElevenLabs wrapper for game assets
  bluesky-publisher.js  # Posts to Bluesky, runs outreach
  feedback-aggregator.js# Aggregates user feedback from DynamoDB
  config.js             # Environment config parser
  pipeline-template.json# Commands.com pipeline definition

infra/                  # AWS infrastructure
  cloudformation.yaml   # Full stack: S3, CloudFront, API Gateway, Lambda, DynamoDB
  lambda/feedback/      # Feedback submission handler
  lambda/reactions/     # Emoji reaction handler
  lambda/health/        # Health check handler
  lambda/game-scores/   # Game leaderboard submission + lookup handler

scripts/                # Deployment scripts (bash)
  deploy-infra.sh       # CloudFormation stack deploy (also packages Lambda zips)
  deploy-site.sh        # Sync site/ to S3 + CloudFront invalidation
  deploy-lambdas.sh     # Package and upload Lambda code

content/days/           # Pipeline-generated artifacts (working directory, not served directly)
schemas/                # JSON schema validators for artifacts
tests/uiux/            # Playwright E2E tests
```

## What You Can Modify

| Area | How to change | Auto-deploys? |
|------|--------------|---------------|
| Site HTML/CSS/JS | Edit files in `site/` | Yes — `publishSiteAssets` syncs to S3 |
| Lambda code | Edit files in `infra/lambda/` | Yes — if `infra/` changed, runner runs `deploy-infra.sh` |
| CloudFormation (add Lambdas, DynamoDB tables, etc.) | Edit `infra/cloudformation.yaml` | Yes — same as above |
| Pipeline config | Edit `runner/pipeline-template.json` | Takes effect on next pipeline run |
| Daily artifacts | Generated into `content/days/YYYY-MM-DD/` | Published to S3 automatically |

## What You Must NOT Modify

- **`.env`** — Contains secrets (Bluesky password, AWS config). Never commit or expose.
- **`scripts/deploy-infra.sh`** — Changes here could break the deploy pipeline. Modify only if you're adding a new parameter.
- **`runner/daily-runner.js`** — Core orchestrator. Be very careful — a bug here stops the whole pipeline.
- **Navigation links** — Don't remove existing nav links without updating all HTML files.

## Design System

Use CSS variables from `site/css/design-system.css`. Never hardcode colors, spacing, or fonts.

**Colors:**
- `--color-deep-green` (#1a4d2e) — primary brand
- `--color-sage` (#5c8a6e) — links, secondary
- `--color-cream` (#f5f0e8) — light backgrounds
- `--color-warm-white` (#fafaf7) — page background
- `--color-accent-gold` (#c4a35a) — highlights
- `--color-text-dark`, `--color-text-muted`, `--color-text-light`
- Status: `--color-success`, `--color-error`, `--color-warning`, `--color-info`

**Spacing:** `--space-1` (0.25rem) through `--space-24` (6rem)

**Typography:** `--font-sans` (system stack), `--font-mono` (code). Sizes from `--text-xs` to `--text-5xl`.

**Borders:** `--radius-sm` (4px) through `--radius-xl` (16px)

**Component naming:** BEM convention — `.block__element--modifier` (e.g., `.card__title--highlighted`)

## DOM Safety

**Always use the `el()` helper** from `app.js` for creating elements. Never use `innerHTML` with user data.

```javascript
// GOOD
el('div', { className: 'card' },
  el('h3', {}, title),
  el('p', { className: 'text-muted' }, summary)
)

// BAD — XSS risk
container.innerHTML = `<h3>${title}</h3>`;
```

## Game Systems

The browser game lives under `site/game/` and is designed so most daily work happens in safe, data-driven places instead of repeatedly rewriting the loop.
Current direction: the runtime is on Phaser 4, and the game should migrate the temporary arena-survival prototype toward a Plants vs. Zombies-style lane-defense game instead of deepening the old arena loop.
The intended run flow is tutorial -> today's challenge -> endless. The tutorial should teach exactly what the player needs for the current daily board, then roll directly into that challenge on clear.
Before changing game code, read `docs/game-pipeline-guide.md`.
Before changing Phaser runtime code specifically, also read `docs/phaser-4-runtime.md`.

**Core systems — modify with caution**
- `site/game/src/scenes/play.js`
- `site/game/src/scenes/title.js`
- `site/game/src/scenes/gameover.js`
- `site/game/src/systems/input.js`
- `site/game/src/systems/spawning.js`
- `site/game/src/systems/scoring.js`
- `site/game/src/systems/test-hooks.js`

**Preferred daily mutation surfaces**
- `site/game/src/config/enemies.js`
- `site/game/src/config/plants.js`
- `site/game/src/config/scenarios.js`
- `site/game/src/config/board.js`
- `site/game/src/config/balance.js`
- `site/game/assets-manifest.json`

**Animation and asset guidance**
- Use `node runner/asset-generator.js sprite ...` with `rd-plus` for high-detail static unit art, environment art, UI, and items.
- Use `node runner/asset-generator.js animation ...` with `rd-animation` for true gameplay loops such as walking, idle, attack, hurt, spawn, or compact VFX sheets.
- Keep `rd-animation` outputs gameplay-sized. Its styles have hard size constraints; for example, `walking_and_idle` and `four_angle_walking` are 48x48, `small_sprites` is 32x32, and `vfx` is 24-96.
- Prefer runtime motion for anything that does not need hand-drawn frame changes. Defenders that mostly sit in place should usually stay static and use tweens, recoil, bob, tint, or scale rather than a full generated spritesheet.
- If a generated sheet contains multiple facing directions, never cycle all rows blindly. Explicitly choose the row that matches gameplay direction in config, such as `animationFrames: [12, 13, 14, 15]` for a right-to-left enemy that should always face the wall.
- Record animation choices in config files (`site/game/src/config/enemies.js`, later `plants.js` if needed), not as ad hoc magic numbers buried in scene code.
- Generated sheets should carry `metadata.phaser.frameWidth` and `metadata.phaser.frameHeight` in `site/game/assets-manifest.json` so Boot can preload them as spritesheets.

Rules:
- Prefer config/content additions over rewriting the core loop.
- Keep tutorial and challenge aligned. If the daily challenge adds a new plant, enemy, economy rule, or board rule, update the tutorial so it teaches that exact thing.
- Treat the daily challenge as a real board with a win state. Endless mode is the post-clear score chase, not the primary session structure.
- If you retune a daily board for difficulty, run `npm run validate:scenario-difficulty -- --date YYYY-MM-DD` and use its result when deciding whether the board is unwinnable, too forgiving, or acceptably knife-edge.
- Do not assume a good challenge must clear with full wall health. A valid board may be "hard but winnable" even if the canonical winning line survives on the last wall segment after one intentional late breach.
- Do not treat "no winning plan found" as automatic proof that the board must be softened. First ask whether the validator search is missing the real line because its beam width, seed plans, or pressure assumptions are too weak.
- If you touch a core system file, add or update tests that protect existing behavior.
- Generated binaries belong under `site/game/assets/generated/` and should stay out of git.
- Keep `?testMode=1` and `window.__gameTestHooks` working.

## API Endpoints

All routes go through CloudFront → API Gateway → Lambda.

| Method | Path | Lambda | Purpose |
|--------|------|--------|---------|
| POST | `/api/feedback` | feedback | Submit feedback (suggestion/bug/confusion) |
| GET | `/api/reactions?dayDate=YYYY-MM-DD` | reactions | Get emoji reaction counts |
| POST | `/api/reactions` | reactions | Submit a reaction |
| GET | `/api/health` | health | Health check + last run status |
| GET | `/api/game/leaderboard?dayDate=YYYY-MM-DD` | game-scores | Fetch the daily game leaderboard |
| POST | `/api/game/score` | game-scores | Submit a finished run to the daily board |

**Adding a new endpoint:**
1. Create handler in `infra/lambda/{name}/index.js`
2. Add to `cloudformation.yaml`: Lambda function, IAM role, API Gateway integration + route, Lambda permission
3. The daily runner will auto-deploy if `infra/` changed

**Lambda handler format (API Gateway v2.0 payload):**
```javascript
exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  const body = JSON.parse(event.body || '{}');
  const query = event.queryStringParameters || {};
  const sourceIp = event.requestContext?.http?.sourceIp;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ... })
  };
};
```

## Artifact Schema (decision.json v2)

Every day produces a `decision.json` with this structure:

```json
{
  "schemaVersion": 2,
  "runDate": "YYYY-MM-DD",
  "judgePanel": [{ "agentId", "displayName", "model", "lens" }],
  "candidates": [{
    "id": "candidate-1",
    "title": "Feature title",
    "summary": "Description",
    "averageScore": 7.9,
    "dimensionAverages": {
      "compoundingValue": { "average": 8.7 },
      "usefulnessClarity": { "average": 7.8 },
      "feasibility": { "average": 6.8 },
      "legibility": { "average": 8.0 },
      "noveltySurprise": { "average": 7.2 },
      "continuity": { "average": 8.3 },
      "shareability": { "average": 8.3 }
    },
    "reviewerBreakdown": [{ "reviewer", "overallScore", "dimensionScores", "keep", "mustChange", "risks" }]
  }],
  "winner": { "candidateId", "title", "summary", "averageScore" },
  "rationale": "Why this candidate won"
}
```

**Scoring dimensions** (all 1-10 scale):
- **compoundingValue** — Does this make future improvements easier?
- **usefulnessClarity** — Is this useful and understandable to visitors?
- **feasibility** — Can this be built in one pipeline run?
- **legibility** — Is the decision transparent and inspectable?
- **noveltySurprise** — Is this interesting or unexpected?
- **continuity** — Does this fit the garden's existing direction?
- **shareability** — Would someone share this on Bluesky?

## Daily Artifacts

Each day's directory (`site/days/YYYY-MM-DD/`) should contain:

| File | Source | Purpose |
|------|--------|---------|
| `decision.json` | Implementation stage | Full decision with candidates, scores, winner |
| `feedback-digest.json` | Feedback aggregator | User feedback that influenced this day |
| `spec.md` | Spec stage | Technical specification for the feature |
| `build-summary.md` | Post-implementation | What files changed and why |
| `test-results.json` | Validation stage | Test pass/fail results |
| `review.md` | Review stage | Final review notes |

## Key Rules

1. **One change per day.** Scope ruthlessly. If it can't ship in one pipeline run, it's too big.
2. **Backward compatible.** Don't break existing pages, APIs, or artifact schemas.
3. **No scope creep.** Implement exactly what the spec says. Don't add bonus features.
4. **User-visible only.** Every change must be something a visitor can see or interact with. Pure refactors don't count unless they unlock something visible today.
5. **Public accountability.** The decision.json is published. Write summaries for curious developers, not for internal docs.
6. **Test before shipping.** Run `npx playwright test` to validate. All tests must pass.
7. **Validate artifacts.** Run `node schemas/validate.js content/days/YYYY-MM-DD` before publishing.

## Common Patterns

**Adding a new page:**
1. Create `site/{section}/index.html` — copy nav/footer from an existing page
2. Add nav link to all HTML files' `.nav__links` section
3. Import modules with `<script type="module">`

**Adding a CSS component:**
1. Add to `site/css/components.css`
2. Use BEM naming (`.component__element--modifier`)
3. Use design system variables for all values
4. Add responsive rules inside existing media query blocks

**Fetching data in the frontend:**
```javascript
import { fetchJSON, fetchOptional, el } from '/js/app.js';

const data = await fetchJSON('/days/manifest.json');      // throws on error
const spec = await fetchOptional('/days/2026-04-06/spec.md', 'text'); // returns null on 404
```

## Infrastructure (AWS)

- **S3** — `command-garden-site` bucket, serves all static content
- **CloudFront** — CDN with OAC, custom domain `commandgarden.com` + `www` redirect
- **API Gateway** — HTTP API routing `/api/*` to Lambda
- **Lambda** — Four functions (feedback, reactions, health, game-scores), Node.js 20.x
- **DynamoDB** — Five tables: feedback, reactions, runs, moderation, game-scores (prefix: `command-garden-prod-`)
- **ACM** — TLS cert for `*.commandgarden.com`

## Bluesky

Account: `@command-garden.bsky.social`

The daily post format is:
```
Fully Automated Website Day X: {feature title}

{rationale excerpt}

#AIAgent #AutonomousAI #BuildInPublic #WebDev

{link to day page}
```

The Review stage can override this by setting `bluesky_post` in decision.json.
