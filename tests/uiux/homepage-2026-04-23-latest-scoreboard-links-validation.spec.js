const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const REACTION_TYPES = ["sprout", "fire", "thinking", "heart", "rocket"];
const repoRoot = path.join(__dirname, "../..");
const manifestForLatest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "site/days/manifest.json"), "utf8")
);
const EXPECTED_DAY_DATE = [...manifestForLatest.days].sort(
  (left, right) => new Date(right.date) - new Date(left.date)
)[0].date;

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getExpectedHomepageState() {
  const manifestPath = path.join(repoRoot, "site/days/manifest.json");
  const manifest = readJsonIfExists(manifestPath);
  const sortedDays = Array.isArray(manifest?.days)
    ? [...manifest.days].sort((left, right) => new Date(right.date) - new Date(left.date))
    : [];
  const latestEntry = sortedDays[0] || null;

  const dayDir = path.join(repoRoot, `site/days/${EXPECTED_DAY_DATE}`);
  const decisionPath = path.join(dayDir, "decision.json");
  const feedbackDigestPath = path.join(dayDir, "feedback-digest.json");

  const decision = readJsonIfExists(decisionPath);
  const feedbackDigest = readJsonIfExists(feedbackDigestPath);
  const winnerCandidate = decision?.candidates?.find(
    (candidate) => candidate.id === decision?.winner?.candidateId
  );

  let orderedReviewers = [];
  if (winnerCandidate?.reviewerBreakdown?.length) {
    if (Array.isArray(decision?.judgePanel) && decision.judgePanel.length > 0) {
      const byAgentId = new Map(
        winnerCandidate.reviewerBreakdown.map((entry) => [
          entry?.reviewer?.agentId,
          entry,
        ])
      );
      orderedReviewers = decision.judgePanel
        .map((judge) => byAgentId.get(judge.agentId))
        .filter(Boolean);
    } else {
      orderedReviewers = [...winnerCandidate.reviewerBreakdown];
    }
  }

  const scoringDimensions =
    Array.isArray(decision?.scoringDimensions) && decision.scoringDimensions.length > 0
      ? decision.scoringDimensions
      : winnerCandidate?.dimensionAverages
        ? Object.entries(winnerCandidate.dimensionAverages).map(([id, value]) => ({
            id,
            label: value?.label || id,
          }))
        : [];

  const aggregateCounts = Object.fromEntries(REACTION_TYPES.map((key) => [key, 0]));
  const recentReactions = feedbackDigest?.recentReactions || {};
  for (const counts of Object.values(recentReactions)) {
    for (const key of REACTION_TYPES) {
      aggregateCounts[key] += Number(counts?.[key] || 0);
    }
  }

  let mostReactedDay = null;
  const reactionDates = Object.keys(recentReactions).sort();
  for (const date of reactionDates) {
    const total = REACTION_TYPES.reduce(
      (sum, key) => sum + Number(recentReactions[date]?.[key] || 0),
      0
    );
    if (!mostReactedDay || total > mostReactedDay.total) {
      const titleFromManifest =
        manifest?.days?.find((day) => day.date === date)?.title || date;
      mostReactedDay = { date, total, title: titleFromManifest };
    }
  }

  return {
    manifestPath,
    manifest,
    latestEntry,
    decisionPath,
    feedbackDigestPath,
    decision,
    feedbackDigest,
    winnerCandidate,
    orderedReviewers,
    scoringDimensions,
    aggregateCounts,
    mostReactedDay,
  };
}

function installReactionStub(page) {
  return page.route("**/api/reactions*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ reactions: {} }),
    });
  });
}

async function waitForHomepageHydration(page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.locator("#todays-date")).not.toHaveText("");
  await expect(page.locator("#view-full-decision a")).toHaveCount(1);
  await expect(page.locator("#terminal-section")).toBeVisible();
  await expect(page.locator("#terminal-container .terminal")).toHaveCount(1);
  await expect(page.locator(".garden-stats--skeleton")).toHaveCount(0);
  await expect(page.locator("#garden-stats")).toBeVisible();
  await expect(page.locator("#garden-section")).toBeVisible();
  expect(await page.locator(".garden-viz__plant").count()).toBeGreaterThan(0);
}

test.describe("Homepage latest day and internal link validation", () => {
  test("homepage hydrates the latest entry, renders scoreboard rows in judge order, and stays console-clean", async ({
    page,
  }) => {
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message || String(error));
    });

    await installReactionStub(page);

    const expected = getExpectedHomepageState();

    expect(
      fs.existsSync(expected.manifestPath),
      `Homepage manifest is missing at ${expected.manifestPath}.`
    ).toBe(true);
    expect(
      expected.latestEntry,
      "site/days/manifest.json must contain at least one day entry."
    ).toBeTruthy();
    expect(
      expected.latestEntry?.date,
      `Homepage latest manifest entry should be ${EXPECTED_DAY_DATE}, found ${expected.latestEntry?.date || "none"}.`
    ).toBe(EXPECTED_DAY_DATE);
    expect(
      fs.existsSync(expected.decisionPath),
      `Latest homepage decision artifact must exist at ${expected.decisionPath}.`
    ).toBe(true);
    expect(
      fs.existsSync(expected.feedbackDigestPath),
      `Latest homepage feedback digest must exist at ${expected.feedbackDigestPath}.`
    ).toBe(true);
    expect(
      expected.decision?.winner,
      `Latest homepage decision at ${expected.decisionPath} must contain a winner.`
    ).toBeTruthy();
    expect(
      expected.winnerCandidate?.reviewerBreakdown?.length,
      `Winner candidate for ${EXPECTED_DAY_DATE} must carry reviewerBreakdown so the homepage scoreboard can render.`
    ).toBeGreaterThan(0);
    expect(
      expected.scoringDimensions.length,
      `Decision for ${EXPECTED_DAY_DATE} must expose scoring dimensions for the homepage scoreboard.`
    ).toBeGreaterThan(0);

    await waitForHomepageHydration(page);

    const expectedDateLabel = new Date(`${EXPECTED_DAY_DATE}T00:00:00`).toLocaleDateString(
      "en-US",
      { weekday: "long", month: "long", day: "numeric", year: "numeric" }
    );
    await expect(page.locator("#todays-date")).toHaveText(expectedDateLabel);
    await expect(
      page.locator("#todays-winner .winner-highlight__title")
    ).toHaveText(expected.decision.winner.title);
    await expect(page.locator("#view-full-decision a")).toHaveAttribute(
      "href",
      `/days/?date=${EXPECTED_DAY_DATE}`
    );

    const terminal = page.locator("#terminal-section");
    await expect(terminal.locator(".terminal__titlebar .terminal__title")).toContainText(
      EXPECTED_DAY_DATE
    );
    await expect(terminal.locator(".terminal__highlight")).toContainText(
      expected.decision.winner.title
    );

    const statsValues = await page
      .locator("#garden-stats .garden-stats__item dd")
      .allTextContents();
    expect(statsValues.map((value) => value.trim())).toHaveLength(3);

    const shippedCount = expected.manifest.days.filter((day) => day.status === "shipped").length;
    await expect(page.locator(".garden-viz__plant")).toHaveCount(shippedCount);

    const communityPulse = page.locator("#community-pulse");
    const totalRecentReactions = Object.values(expected.aggregateCounts).reduce(
      (sum, count) => sum + count,
      0
    );
    if (totalRecentReactions > 0) {
      await expect(communityPulse).toBeVisible();
      await expect(communityPulse.locator(".community-pulse-badge")).toHaveCount(5);
      const badgeCounts = await communityPulse
        .locator(".community-pulse-badge__count")
        .allTextContents();
      expect(badgeCounts.map((count) => count.trim())).toEqual(
        REACTION_TYPES.map((key) => String(expected.aggregateCounts[key]))
      );

      if (expected.mostReactedDay) {
        await expect(
          communityPulse.locator(".community-pulse-callout__link")
        ).toHaveAttribute("href", `/days/?date=${expected.mostReactedDay.date}`);
        await expect(
          communityPulse.locator(".community-pulse-callout__link")
        ).toHaveText(expected.mostReactedDay.title);
      }
      await expect(communityPulse.locator(".community-pulse-cta__link")).toHaveAttribute(
        "href",
        "#todays-change"
      );
    }

    const scoreboard = page.locator("#scoreboard-section");
    await expect(scoreboard).toBeVisible();
    await expect(scoreboard.locator(".scoreboard__grid")).toHaveCount(1);

    const layoutOrder = await page.evaluate(() => {
      const todaysChange = document.getElementById("todays-change");
      const scoreboardSection = document.getElementById("scoreboard-section");
      const candidatesSection = document.getElementById("candidates-section");
      if (!todaysChange || !scoreboardSection || !candidatesSection) {
        return { valid: false };
      }
      return {
        valid: true,
        scoreboardAfterTodaysChange: Boolean(
          todaysChange.compareDocumentPosition(scoreboardSection) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ),
        candidatesAfterScoreboard: Boolean(
          scoreboardSection.compareDocumentPosition(candidatesSection) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ),
      };
    });

    expect(layoutOrder.valid).toBe(true);
    expect(layoutOrder.scoreboardAfterTodaysChange).toBe(true);
    expect(layoutOrder.candidatesAfterScoreboard).toBe(true);

    const legendItems = scoreboard.locator(".scoreboard__legend-item");
    await expect(legendItems).toHaveCount(expected.orderedReviewers.length);
    const legendTexts = await legendItems.allTextContents();
    expect(legendTexts.map((text) => text.replace(/\s+/g, " ").trim())).toEqual(
      expected.orderedReviewers.map((entry) => {
        const reviewer = entry.reviewer || {};
        const modelFamily = reviewer.modelFamily || "judge";
        const displayName = modelFamily.charAt(0).toUpperCase() + modelFamily.slice(1);
        return `${displayName} (${reviewer.lens})`;
      })
    );

    const scoreRows = scoreboard.locator(".scoreboard__row:not(.scoreboard__overall)");
    await expect(scoreRows).toHaveCount(expected.scoringDimensions.length);

    for (let rowIndex = 0; rowIndex < expected.scoringDimensions.length; rowIndex += 1) {
      const dimension = expected.scoringDimensions[rowIndex];
      const row = scoreRows.nth(rowIndex);
      await expect(row.locator(".scoreboard__dim-label")).toHaveText(
        dimension.label || dimension.id
      );

      const barClasses = await row
        .locator(".scoreboard__bars .scoreboard__bar")
        .evaluateAll((nodes) => nodes.map((node) => node.className));
      expect(barClasses).toHaveLength(expected.orderedReviewers.length);
      expect(
        barClasses.map((className) => {
          const match = String(className).match(/scoreboard__bar--([a-z]+)/);
          return match ? match[1] : null;
        })
      ).toEqual(
        expected.orderedReviewers.map((entry) => entry.reviewer?.modelFamily || null)
      );
    }

    const overallRow = scoreboard.locator(".scoreboard__row.scoreboard__overall");
    await expect(overallRow).toHaveCount(1);
    const overallModels = await overallRow
      .locator(".scoreboard__overall-model")
      .allTextContents();
    expect(overallModels.map((text) => text.trim())).toEqual(
      expected.orderedReviewers.map((entry) => {
        const family = entry.reviewer?.modelFamily || "judge";
        return family.charAt(0).toUpperCase() + family.slice(1);
      })
    );

    expect(
      consoleErrors,
      `Console errors while hydrating the homepage:\n${consoleErrors.join("\n")}`
    ).toEqual([]);
    expect(
      pageErrors,
      `Uncaught page errors while hydrating the homepage:\n${pageErrors.join("\n")}`
    ).toEqual([]);
  });

  test("every rendered internal homepage href responds 200 after hydration", async ({
    page,
    request,
  }) => {
    await installReactionStub(page);
    await waitForHomepageHydration(page);

    const internalHrefs = await page.evaluate(() => {
      const hrefs = new Set();
      const anchors = Array.from(
        document.querySelectorAll("a[href^='/'], a[href^='./'], a[href^='../']")
      );

      anchors.forEach((anchor) => {
        const rawHref = anchor.getAttribute("href");
        if (!rawHref) {
          return;
        }

        const url = new URL(rawHref, window.location.href);
        const normalized = `${url.pathname}${url.search}`;
        if (normalized) {
          hrefs.add(normalized);
        }
      });

      return Array.from(hrefs).sort();
    });

    expect(internalHrefs.length).toBeGreaterThan(0);
    expect(internalHrefs).toContain(`/days/?date=${EXPECTED_DAY_DATE}`);

    const failures = [];
    for (const href of internalHrefs) {
      const response = await request.get(href);
      if (response.status() !== 200) {
        failures.push({ href, status: response.status() });
      }
    }

    expect(
      failures,
      `Rendered internal homepage hrefs with non-200 responses: ${JSON.stringify(failures)}`
    ).toEqual([]);
  });
});
