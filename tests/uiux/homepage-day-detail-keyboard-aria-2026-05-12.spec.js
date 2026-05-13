const { test, expect } = require("@playwright/test");
const {
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

const DAY_DATE = "2026-05-12";
const DAY_PATH = `/days/?date=${DAY_DATE}`;
const REACTION_NAME_PATTERN = /Sprout|Fire|Thinking|Heart|Rocket/i;

async function gotoRenderedPage(page, path) {
  await installLocalSiteRoutes(page);
  await page.goto(getAppUrl(path));
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".skeleton")).toHaveCount(0);
}

async function assertLandmarksAndSkipLink(page) {
  const nav = page.locator('nav[role="navigation"][aria-label="Main navigation"]');
  await expect(nav).toHaveCount(1);
  await expect(nav).toBeVisible();

  const main = page.locator("main");
  await expect(main).toHaveCount(1);
  await expect(main).toBeVisible();

  const skipLink = page.locator("a.skip-link").first();
  await expect(skipLink).toHaveCount(1);
  await expect(skipLink).toHaveAttribute("href", /^#[A-Za-z][\w-]*$/);

  const skipTarget = await skipLink.getAttribute("href");
  await expect(page.locator(skipTarget)).toHaveCount(1);
}

async function collectTabSequence(page, maxTabs = 90) {
  const sequence = [];

  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      const styles = window.getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || "",
        href: element.getAttribute("href") || "",
        type: element.getAttribute("type") || "",
        text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
        className:
          typeof element.className === "string" ? element.className : "",
        ariaLabel: element.getAttribute("aria-label") || "",
        ariaPressed: element.getAttribute("aria-pressed") || "",
        ariaExpanded: element.getAttribute("aria-expanded") || "",
        isVisible:
          styles.display !== "none" &&
          styles.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0,
        inMainNav: !!element.closest('nav[role="navigation"][aria-label="Main navigation"]'),
        isSkipLink: element.matches("a.skip-link"),
        isHeroCta: !!element.closest(".hero__actions"),
        isReactionButton: element.matches(".reaction-bar__btn"),
        isRecentDayCard: !!element.closest("#recent-timeline .timeline-entry"),
        isSpecToggle: element.matches("#spec-container summary.spec-collapsible__toggle"),
        isArtifactLink: element.matches("#artifacts-container a.artifact-link"),
        isDayNavLink: element.matches("#day-nav a.day-nav__link"),
      };
    });

    if (focused) {
      sequence.push(focused);
    }
  }

  return sequence;
}

function findIndexOrFail(sequence, predicate, label) {
  const index = sequence.findIndex(predicate);
  expect(index, `${label} should appear in tab order`).toBeGreaterThanOrEqual(0);
  expect(sequence[index].isVisible, `${label} should be visible when focused`).toBe(true);
  return index;
}

async function assertReactionButtons(page, scopeSelector) {
  const buttons = page.locator(`${scopeSelector} .reaction-bar__btn`);
  const count = await buttons.count();
  expect(count, `${scopeSelector} should render reaction buttons`).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    await expect(button).toHaveAccessibleName(REACTION_NAME_PATTERN);
    await expect(button).toHaveAttribute("aria-pressed", /^(true|false)$/);
  }

  const firstButton = buttons.first();
  const initialPressed = await firstButton.getAttribute("aria-pressed");
  await firstButton.focus();
  await page.keyboard.press("Enter");
  await expect(firstButton).toHaveAttribute(
    "aria-pressed",
    initialPressed === "true" ? "false" : "true"
  );
}

async function assertMobileToggleKeyboardBehavior(page, path) {
  await page.setViewportSize({ width: 375, height: 667 });
  await gotoRenderedPage(page, path);

  const toggle = page.locator(".nav__mobile-toggle");
  const menu = page.locator(".nav__links");

  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();

  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toBeVisible();

  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
}

test.describe("Homepage and 2026-05-12 day-detail keyboard navigation and ARIA", () => {
  test("homepage exposes landmarks, skip-first tab order, reaction button state, and day-card reachability", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoRenderedPage(page, "/");
    await assertLandmarksAndSkipLink(page);

    const sequence = await collectTabSequence(page);
    const skipIndex = findIndexOrFail(sequence, (entry) => entry.isSkipLink, "skip link");
    expect(skipIndex, "skip link should be first in tab order").toBe(0);

    const firstNavIndex = findIndexOrFail(
      sequence,
      (entry) => entry.inMainNav && entry.tag === "a",
      "main navigation links"
    );
    const firstHeroCtaIndex = findIndexOrFail(
      sequence,
      (entry) => entry.isHeroCta && entry.tag === "a",
      "hero CTAs"
    );
    const firstReactionIndex = findIndexOrFail(
      sequence,
      (entry) => entry.isReactionButton,
      "reaction buttons"
    );
    const firstRecentDayIndex = findIndexOrFail(
      sequence,
      (entry) => entry.isRecentDayCard && entry.tag === "a",
      "recent day cards"
    );

    expect(firstNavIndex).toBeGreaterThan(skipIndex);
    expect(firstHeroCtaIndex).toBeGreaterThan(firstNavIndex);
    expect(firstReactionIndex).toBeGreaterThan(firstHeroCtaIndex);
    expect(firstRecentDayIndex).toBeGreaterThan(firstReactionIndex);

    await assertReactionButtons(page, "#todays-winner");
  });

  test("2026-05-12 day detail exposes landmarks, skip-first tab order, reactions, and no focus trap", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoRenderedPage(page, DAY_PATH);
    await assertLandmarksAndSkipLink(page);

    await expect(page.locator("#day-header h1")).toContainText("May 12, 2026");

    const sequence = await collectTabSequence(page, 120);
    const skipIndex = findIndexOrFail(sequence, (entry) => entry.isSkipLink, "skip link");
    expect(skipIndex, "skip link should be first in tab order").toBe(0);

    const firstNavIndex = findIndexOrFail(
      sequence,
      (entry) => entry.inMainNav && entry.tag === "a",
      "main navigation links"
    );
    const reactionIndex = findIndexOrFail(
      sequence,
      (entry) => entry.isReactionButton,
      "reaction buttons"
    );
    const dayNavIndex = findIndexOrFail(
      sequence,
      (entry) => entry.isDayNavLink,
      "previous/next day navigation"
    );

    expect(firstNavIndex).toBeGreaterThan(skipIndex);
    const specToggleIndex = sequence.findIndex((entry) => entry.isSpecToggle);
    const artifactIndex = sequence.findIndex((entry) => entry.isArtifactLink);
    if (specToggleIndex >= 0) {
      expect(specToggleIndex).toBeGreaterThan(firstNavIndex);
    }
    if (artifactIndex >= 0) {
      expect(artifactIndex).toBeGreaterThan(
        specToggleIndex >= 0 ? specToggleIndex : firstNavIndex
      );
      expect(reactionIndex).toBeGreaterThan(artifactIndex);
    } else {
      expect(reactionIndex).toBeGreaterThan(
        specToggleIndex >= 0 ? specToggleIndex : firstNavIndex
      );
    }
    expect(dayNavIndex).toBeGreaterThan(reactionIndex);

    await assertReactionButtons(page, "#reactions-section");
  });

  test("mobile nav toggle opens with Enter/Space and Escape closes it on homepage and day detail", async ({
    page,
  }) => {
    await assertMobileToggleKeyboardBehavior(page, "/");
    await assertMobileToggleKeyboardBehavior(page, DAY_PATH);
  });
});
