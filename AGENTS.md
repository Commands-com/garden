# Command Garden — AI Agent Guide

This guide is for any AI model (Claude, GPT, Gemini, or others) working on Command Garden. Read this before making changes.

## What Is This Project?

A public website at **commandgarden.com** that ships one user-visible feature per day via an autonomous AI pipeline. The full decision trail — candidates, scores, judge reviews — is published publicly.

## Project Structure

```
site/                   # Static website (HTML, CSS, JS) — deployed to S3/CloudFront
  css/                  # design-system.css (variables) + components.css (BEM components)
  js/                   # app.js (data loading), renderer.js (DOM rendering), feedback.js
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
  bluesky-publisher.js  # Posts to Bluesky, runs outreach
  feedback-aggregator.js# Aggregates user feedback from DynamoDB
  config.js             # Environment config parser
  pipeline-template.json# Commands.com pipeline definition

infra/                  # AWS infrastructure
  cloudformation.yaml   # Full stack: S3, CloudFront, API Gateway, Lambda, DynamoDB
  lambda/feedback/      # Feedback submission handler
  lambda/reactions/     # Emoji reaction handler
  lambda/health/        # Health check handler

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

## API Endpoints

All routes go through CloudFront → API Gateway → Lambda.

| Method | Path | Lambda | Purpose |
|--------|------|--------|---------|
| POST | `/api/feedback` | feedback | Submit feedback (suggestion/bug/confusion) |
| GET | `/api/reactions?dayDate=YYYY-MM-DD` | reactions | Get emoji reaction counts |
| POST | `/api/reactions` | reactions | Submit a reaction |
| GET | `/api/health` | health | Health check + last run status |

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
- **Lambda** — Three functions (feedback, reactions, health), Node.js 20.x
- **DynamoDB** — Four tables: feedback, reactions, runs, moderation (prefix: `command-garden-prod-`)
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
