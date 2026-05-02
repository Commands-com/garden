/**
 * Garden Replay (May 1, 2026) — Implementation absence verification.
 *
 * The Implementation stage stopped with reason `user_stop` after 3 turns and
 * produced no implementation_bundle. This test pins the as-shipped state and
 * reports each Spec acceptance criterion (AC-1…AC-15) explicitly with status:
 *   - PASS              — behaviour matches the spec contract
 *   - FAIL              — code shipped but is incorrect / regressed
 *   - NOT-IMPLEMENTED   — spec contract is not yet shipped (expected for May 1)
 *
 * The test asserts the negative state — that the spec-promised replay surfaces
 * are not present in the DOM, that /game/?replay=fake-slug does not crash, and
 * that the existing /game/ surface is still console-clean.
 */

const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-05-01";
const GAME_PATH = `/game/?testMode=1&date=${DAY_DATE}`;
const REPLAY_PATH = `/game/?replay=fake-slug`;

const ACCEPTANCE_CRITERIA = [
  {
    id: "AC-1",
    title: "Capture surfaces only on cleared challenge runs (DOM celebration card with Save this run).",
  },
  {
    id: "AC-2",
    title: "POST /api/replays mint round-trip succeeds for a real cleared run; slug matches Crockford base32.",
  },
  {
    id: "AC-3",
    title: "Server-side simulator parity (validatedGardenHP / validatedDurationMs match runtime).",
  },
  {
    id: "AC-4",
    title: "Replay fidelity: placements fire at recorded survivedMs within ±1 step.",
  },
  {
    id: "AC-5",
    title: "Server rejects mints whose plan does not clear (HTTP 422 did_not_clear).",
  },
  {
    id: "AC-6",
    title: "Server rejects malformed plans (HTTP 400 invalid_plan with structural details).",
  },
  {
    id: "AC-7",
    title: "Server rejects stale game versions (HTTP 409 stale_game_version).",
  },
  {
    id: "AC-8",
    title: "Watch route /game/?replay=<slug> plays back to challengeCleared at 1×.",
  },
  {
    id: "AC-9",
    title: "Watch route plays back to challengeCleared at 1.5× via sub-stepped physics.",
  },
  {
    id: "AC-10",
    title: "Watch route disables player input and developer test hooks.",
  },
  {
    id: "AC-11",
    title: "Confirm-and-share row exposes copy + Bluesky/X intents.",
  },
  {
    id: "AC-12",
    title: "IP rate limit returns HTTP 429 on the 11th mint per IP per day.",
  },
  {
    id: "AC-13",
    title: "Alias sanitization mirrors leaderboard ([\\w .-] / 24 chars).",
  },
  {
    id: "AC-14",
    title: "Stale-version GET surfaces { staleVersion: true } and watch route renders the notice.",
  },
  {
    id: "AC-15",
    title: "npm run test:uiux is green.",
  },
];

function reportAcceptance(report, id, status, evidence) {
  const entry = ACCEPTANCE_CRITERIA.find((ac) => ac.id === id);
  if (!entry) {
    throw new Error(`Unknown acceptance criterion: ${id}`);
  }
  if (!["PASS", "FAIL", "NOT-IMPLEMENTED"].includes(status)) {
    throw new Error(`Unknown acceptance status: ${status}`);
  }
  report.push({ id, title: entry.title, status, evidence });
}

function logAcceptanceReport(report, label) {
  // Emit a single deterministic block so the report is easy to grep out of the
  // Playwright runner output.
  const lines = [
    "",
    `=== Garden Replay May 1 — Acceptance Criteria Report (${label}) ===`,
    ...report.map(
      (entry) => `${entry.id} [${entry.status}] ${entry.title} :: ${entry.evidence}`
    ),
    "=== End Report ===",
    "",
  ];
  console.log(lines.join("\n"));
}

async function startGameRouted(page, relativePath) {
  const runtimeProblems = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeProblems.push(`[console:error] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    runtimeProblems.push(`[pageerror] ${error.message || String(error)}`);
  });

  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(relativePath));

  return runtimeProblems;
}

test.describe("Garden Replay 2026-05-01 — implementation absence", () => {
  test("spec-promised replay UI is not present, /?replay= does not crash, console is clean, ACs reported", async ({
    page,
  }) => {
    const report = [];

    // ---------------------------------------------------------------------
    // Phase 1: open the regular game page in testMode and confirm the
    // celebration card / share row / speed toggle are not in the DOM.
    // ---------------------------------------------------------------------
    const gameProblems = await startGameRouted(page, GAME_PATH);

    await expect(page.locator("#game-stage")).toBeAttached();
    await expect(page.locator("nav .nav__link--active")).toHaveText("Game");
    await expect(page.locator("#game-root canvas")).toHaveCount(1);

    await page.waitForFunction(
      () =>
        window.__gameTestHooks &&
        typeof window.__gameTestHooks.getState === "function",
      undefined,
      { timeout: 10000 }
    );

    // Settle on the title scene so the DOM has fully painted before we
    // interrogate it for the (absent) replay surfaces.
    await page.waitForFunction(
      () => window.__gameTestHooks.getState()?.scene === "title",
      undefined,
      { timeout: 10000 }
    );

    const stage = page.locator("#game-stage");

    // Celebration card (AC-1, G1, P6) — must not exist.
    const saveRunCard = stage.locator("[data-role='save-run-card']");
    const saveRunCardCount = await saveRunCard.count();
    expect(
      saveRunCardCount,
      "Spec G1/AC-1 promises a [data-role='save-run-card'] celebration card on challenge clear, but the Implementation stage stopped with user_stop and shipped no card. Expected 0 in unimplemented state."
    ).toBe(0);
    reportAcceptance(
      report,
      "AC-1",
      "NOT-IMPLEMENTED",
      `No [data-role='save-run-card'] in #game-stage (count=${saveRunCardCount}); Save-this-run capture surface was never written.`
    );

    // Share row anchors (AC-11, G4) — must not exist.
    const blueskyAnchor = stage.locator("a[href*='bsky.app/intent']");
    const twitterAnchor = stage.locator("a[href*='twitter.com/intent']");
    const blueskyCount = await blueskyAnchor.count();
    const twitterCount = await twitterAnchor.count();
    expect(
      blueskyCount,
      "Spec AC-11 promises a Bluesky compose intent anchor in the post-mint share row."
    ).toBe(0);
    expect(
      twitterCount,
      "Spec AC-11 promises a secondary X compose intent anchor in the post-mint share row."
    ).toBe(0);
    reportAcceptance(
      report,
      "AC-11",
      "NOT-IMPLEMENTED",
      `No bsky.app/intent or twitter.com/intent anchors in #game-stage (bsky=${blueskyCount}, x=${twitterCount}); share row was never built.`
    );

    // Speed toggle (G3, G5, AC-8/AC-9) — must not exist.
    const speedToggle = stage
      .locator("button, [role='button'], [role='switch']")
      .filter({ hasText: /1\.5x|speed/i });
    const speedAriaToggle = stage.locator(
      "[aria-label*='1.5x' i], [aria-label*='speed' i]"
    );
    const speedToggleCount = await speedToggle.count();
    const speedAriaCount = await speedAriaToggle.count();
    expect(
      speedToggleCount + speedAriaCount,
      "Spec AC-9 promises a 1× / 1.5× speed toggle in the watch route. None should exist in the unimplemented state."
    ).toBe(0);

    // Phaser bootstrap should not yet expose replayMode plumbing.
    const replayBootstrap = await page.evaluate(() => {
      // The spec promises bootstrap.replayMode / replayPlan / replayTimeScale /
      // showSaveCard. None of these should be reachable from window in v1.
      const hooks = window.__gameTestHooks;
      const game = hooks?.getGame ? hooks.getGame() : null;
      return {
        hasReplayModeFlag:
          typeof window.__bootstrap === "object" &&
          window.__bootstrap !== null &&
          "replayMode" in window.__bootstrap,
        hasShowSaveCard: typeof window.bootstrap?.showSaveCard === "function",
        hookKeys: hooks ? Object.keys(hooks).sort() : [],
        sceneKey: hooks?.getState?.()?.scene || null,
      };
    });
    expect(replayBootstrap.hasReplayModeFlag).toBe(false);
    expect(replayBootstrap.hasShowSaveCard).toBe(false);

    reportAcceptance(report, "AC-8", "NOT-IMPLEMENTED",
      "No replayMode bootstrap flag, no /api/replays GET handler, no playback path; watch-route runtime extension was never written.");
    reportAcceptance(report, "AC-9", "NOT-IMPLEMENTED",
      `No 1.5× speed toggle present in #game-stage (text-match=${speedToggleCount}, aria-match=${speedAriaCount}); sub-stepping condition widening was never written.`);
    reportAcceptance(report, "AC-10", "NOT-IMPLEMENTED",
      "No replayMode guard exists on pointer-down placement / inventory hotkeys; watch-route input gating was never written.");

    // Capture-only ACs that depend on backend artifacts — none exist.
    reportAcceptance(report, "AC-2", "NOT-IMPLEMENTED",
      "No infra/lambda/replays/index.js and no POST /api/replays route; mint endpoint was never written.");
    reportAcceptance(report, "AC-3", "NOT-IMPLEMENTED",
      "No site/game/src/sim/replay-simulator.mjs and no Lambda; simulator parity gate cannot be exercised.");
    reportAcceptance(report, "AC-4", "NOT-IMPLEMENTED",
      "No replay queue draining and no watch route; replay fidelity check has no surface to validate.");
    reportAcceptance(report, "AC-5", "NOT-IMPLEMENTED",
      "No mint endpoint; did_not_clear rejection cannot be exercised.");
    reportAcceptance(report, "AC-6", "NOT-IMPLEMENTED",
      "No mint endpoint; structural plan rejections (date mismatch, >200 placements, OOB row) cannot be exercised.");
    reportAcceptance(report, "AC-7", "NOT-IMPLEMENTED",
      "No mint endpoint; stale_game_version rejection cannot be exercised.");
    reportAcceptance(report, "AC-12", "NOT-IMPLEMENTED",
      "No mint endpoint; IP rate limit cannot be exercised.");
    reportAcceptance(report, "AC-13", "NOT-IMPLEMENTED",
      "No mint endpoint; alias sanitization cannot be exercised against /api/replays.");
    reportAcceptance(report, "AC-14", "NOT-IMPLEMENTED",
      "No GET /api/replays/{slug} response and no watch-route stale notice; stale-version GET cannot be exercised.");

    expect(
      gameProblems,
      `Console errors / uncaught exceptions while loading ${GAME_PATH}:\n${gameProblems.join("\n")}`
    ).toEqual([]);

    // ---------------------------------------------------------------------
    // Phase 2: navigate to /game/?replay=fake-slug. Per the spec the watch
    // route would fetch /api/replays/fake-slug, but no such endpoint exists.
    // The page must NOT throw — it should degrade to the standard /game/
    // surface (title scene), and the console must stay clean.
    // ---------------------------------------------------------------------
    const replayProblems = [];
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
    page.on("console", (message) => {
      if (message.type() === "error") {
        replayProblems.push(`[console:error] ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      replayProblems.push(`[pageerror] ${error.message || String(error)}`);
    });

    await page.goto(getAppUrl(REPLAY_PATH));

    // Either we redirected to /game/ (no ?replay=) or we still have ?replay=
    // but the canvas is the standard title scene — both are acceptable
    // graceful-degradation outcomes when the watch route is not implemented.
    //
    // NOTE: ?replay=fake-slug intentionally omits ?testMode=1, so
    // installGameTestHooks() in site/game/src/systems/test-hooks.js short-
    // circuits and window.__gameTestHooks is NEVER installed on this route.
    // The right assertions here are: canvas mounts, no 'Now watching' banner,
    // no console.error / pageerror — none of which require the test hooks.
    await expect(page.locator("#game-root canvas")).toHaveCount(1);
    await expect(page.locator("#game-root canvas")).toBeVisible();

    // Settle window so any async boot logging surfaces before we read the
    // error buffers, and so a deferred "Now watching" banner (if the spec
    // had been implemented) would have had time to mount.
    await page.waitForTimeout(750);

    // No "Now watching" banner should be present (replay watch route is not
    // implemented, so no banner should render even on ?replay=fake-slug).
    const watchingBanner = page
      .locator("#game-stage")
      .locator(":text-matches('Now watching', 'i')");
    expect(await watchingBanner.count()).toBe(0);

    // Confirm the page actually rendered the standard /game/ shell rather
    // than a blank/error state. The shell title is static HTML, not Phaser-
    // rendered, so it should be present regardless of replay-route handling.
    await expect(page.locator("h1.game-shell__title")).toHaveText(
      "Rootline Defense"
    );

    expect(
      replayProblems,
      `Console errors / uncaught exceptions while loading ${REPLAY_PATH}:\n${replayProblems.join("\n")}`
    ).toEqual([]);

    reportAcceptance(report, "AC-15", "FAIL",
      "Existing /game/?testMode=1&date=2026-05-01 surface and /game/?replay=fake-slug fallback are console-clean and do not crash, but the spec-required replay/share/watch surfaces are NOT-IMPLEMENTED — npm run test:uiux cannot validate AC-1…AC-14 because the implementation_bundle was never produced (Implementation stage user_stop after 3 turns).");

    logAcceptanceReport(report, "May 1 implementation-absence sweep");

    // Sanity: the report must include every AC exactly once.
    expect(report).toHaveLength(ACCEPTANCE_CRITERIA.length);
    const reportedIds = new Set(report.map((entry) => entry.id));
    for (const ac of ACCEPTANCE_CRITERIA) {
      expect(reportedIds.has(ac.id), `AC ${ac.id} was not reported`).toBe(true);
    }
  });
});
