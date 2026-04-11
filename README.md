# Command Garden

A live website that builds itself. Every morning at 6 AM, an autonomous pipeline picks one new feature, codes it, tests it, and ships it to production. Then it writes a public log of every decision it made along the way.

**Live site:** [commandgarden.com](https://commandgarden.com)
**Bluesky:** [@command-garden.bsky.social](https://bsky.app/profile/command-garden.bsky.social)
**Dev.to:** [dev.to/dtannen](https://dev.to/dtannen)

## How it works

Each daily run is a five-stage pipeline orchestrated by Commands.com:

```
Explore  →  Spec  →  Implementation  →  Validation  →  Review
```

1. **Explore** proposes 3-5 candidate improvements after reading the recent decision history, the feedback digest, and Bluesky engagement metrics. Candidates are scored by a panel of three judges (Claude, GPT, and Gemini) across seven dimensions: compounding value, usefulness, feasibility, legibility, novelty, continuity, and shareability.
2. **Spec** turns the winning candidate into a detailed implementation plan with explicit file paths, acceptance criteria, and rollback steps.
3. **Implementation** writes the code in isolated git worktrees, one parallel worker per task, then merges back to `main`.
4. **Validation** runs Playwright tests for every acceptance criterion, plus checks for broken links, accessibility issues, and decision-schema correctness.
5. **Review** verifies the spec was followed, writes the public-facing summary, and produces the social posts and outreach strategy for the day.

When the run finishes, the artifacts are uploaded to S3, CloudFront is invalidated, the homepage updates, a Bluesky post and a Dev.to article are auto-published, and the working tree is auto-committed and pushed.

## Repository layout

```
site/                   Static website (HTML, CSS, vanilla JS) deployed to S3 + CloudFront
  css/                  design-system.css (variables) + components.css (BEM components)
  js/                   app.js (data loading), renderer.js (DOM rendering), feedback.js
  days/                 Per-day public artifacts (decision.json, spec.md, etc.)
  index.html            Homepage
  archive/              Browse all shipped days
  feedback/             Submit feedback that feeds back into Explore
  judges/               Judge panel explainer

runner/                 Daily pipeline automation (Node.js)
  daily-runner.js       Orchestrator — runs the 5-stage pipeline end to end
  feedback-aggregator.js   Pulls pending feedback from DynamoDB into the day's digest
  artifact-publisher.js    Uploads day artifacts + site assets to S3
  bluesky-publisher.js     Posts to Bluesky and runs daily outreach
  devto-publisher.js       Publishes the daily build log as a Dev.to article
  pipeline-template.json   Commands.com pipeline definition

infra/                  AWS infrastructure
  cloudformation.yaml   S3, CloudFront, API Gateway, Lambda, DynamoDB
  lambda/feedback/      Feedback submission handler
  lambda/reactions/     Emoji reaction handler

scheduler/              macOS LaunchAgent plist for the 6 AM cron job
scripts/                Bash deploy scripts and the scheduler installer
schemas/                JSON schemas for decision.json, concept_bundle, etc.
tests/uiux/             Playwright end-to-end tests
content/days/           Per-day pipeline working directory (gitignored except for tracked artifacts)
```

## What it has shipped so far

| Day | Date | Feature |
|-----|------------|---------|
| 1 | 2026-04-06 | "How It Works" pipeline explainer section |
| 2 | 2026-04-07 | Garden Vital Stats homepage bar |
| 3 | 2026-04-08 | Inline Spec Viewer on day detail pages |
| 4 | 2026-04-09 | Visual garden of shipped features |
| 5 | 2026-04-10 | Retro terminal panel showing latest run |
| 6 | 2026-04-11 | Community Pulse — emoji reaction totals |

Each day's full decision trail (candidates, scores, judge reviews, spec, build summary, test results) is published at `commandgarden.com/days/YYYY-MM-DD/`.

## Running the pipeline

The pipeline runs automatically at 6:00 AM local time via macOS launchd. To trigger it manually:

```bash
# Today's date
node runner/daily-runner.js

# A specific date
node runner/daily-runner.js --date=2026-04-15
```

A run takes about 90 minutes end to end. Logs go to `runner/daily-runner.stdout.log` and `daily-runner.stderr.log` when launched by the scheduler.

### Scheduler

```bash
# Install the LaunchAgent (runs daily at 6 AM)
bash scripts/setup-scheduler.sh install

# Uninstall
bash scripts/setup-scheduler.sh uninstall

# Status
launchctl list | grep commandgarden
```

### Prerequisites

- Node.js 20+
- The Commands.com desktop app installed and running (the pipeline orchestrator depends on it)
- AWS credentials configured for the deployment account
- A `.env` file at the project root with:
  - `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`
  - `DEVTO_API_KEY`
  - `CLOUDFRONT_DISTRIBUTION_ID`
  - AWS region and table names

## Tests

```bash
npx playwright test
```

The Validation stage of the pipeline writes new Playwright specs every day for the feature it just shipped, so the test suite grows organically as the site grows.

## Tech stack

- **Frontend:** Vanilla HTML/CSS/JS (no framework). BEM components, CSS variables, no `innerHTML` with user data.
- **Backend:** AWS Lambda (Node.js) for feedback and reactions, DynamoDB for storage, API Gateway for HTTP.
- **Orchestration:** Commands.com multi-agent pipeline (Claude Sonnet as the controller, mixed-model judge panel)
- **Hosting:** S3 + CloudFront, custom domain via Route 53
- **Scheduler:** macOS launchd
- **Tests:** Playwright

## Contributing

This project is an experiment in autonomous software, so the most useful thing you can do is **submit feedback through the live site** at [commandgarden.com/feedback](https://commandgarden.com/feedback). Your feedback feeds directly into the next day's Explore stage and influences what gets built.

Issues and pull requests on this repo are welcome too, but understand that the working tree changes every morning as the pipeline auto-commits its day's work.

## Further reading

- `AGENTS.md` — the deep guide for AI agents working on this codebase (architecture, conventions, what's safe to modify, what isn't)
- `runner/pipeline-template.json` — the full pipeline definition with stage objectives and constraints
- `infra/cloudformation.yaml` — the entire AWS stack as one CloudFormation template

## License

MIT
