const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

async function loadHomepage(page) {
  if (USE_ROUTED_SITE) {
    await installLocalSiteRoutes(page);
  }

  await page.goto(getAppUrl("/"));
  await expect(page.locator("#terminal-section")).toBeVisible();
  await expect(page.locator("#terminal-container .terminal")).toHaveCount(1);
}

test.describe("Terminal widget accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await loadHomepage(page);
  });

  test("uses aria-labelledby that points to the Latest Run h2 heading", async ({
    page,
  }) => {
    const section = page.locator("#terminal-section");
    const heading = section.locator(".section__title");

    await expect(heading).toHaveText("Latest Run");
    expect(await heading.evaluate((el) => el.tagName)).toBe("H2");

    const labelledBy = await section.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();

    const labelTarget = page.locator(`[id="${labelledBy}"]`);
    await expect(labelTarget).toHaveCount(1);

    const targetInfo = await labelTarget.evaluate((el) => ({
      tagName: el.tagName,
      text: (el.textContent || "").trim(),
      classList: Array.from(el.classList),
    }));

    expect(
      /^H[1-6]$/.test(targetInfo.tagName) ||
        targetInfo.classList.includes("section__title")
    ).toBe(true);
    expect(targetInfo.text).toBe("Latest Run");
  });

  test("marks terminal dots aria-hidden and keeps them out of keyboard focus order", async ({
    page,
  }) => {
    const dots = page.locator("#terminal-container .terminal__dot");
    await expect(dots).toHaveCount(3);

    for (let i = 0; i < 3; i += 1) {
      const dot = dots.nth(i);
      await expect(dot).toHaveAttribute("aria-hidden", "true");
      expect(await dot.getAttribute("tabindex")).toBeNull();
    }
  });

  test("uses the expected design-token colors for terminal background, body, and prompts", async ({
    page,
  }) => {
    const colors = await page.evaluate(() => {
      const terminal = document.querySelector("#terminal-container .terminal");
      const body = document.querySelector("#terminal-container .terminal__body");
      const prompt = document.querySelector(
        "#terminal-container .terminal__prompt"
      );

      function resolveToken(property, tokenName) {
        const probe = document.createElement("div");
        probe.style[property] = `var(${tokenName})`;
        document.body.appendChild(probe);
        const value = window.getComputedStyle(probe)[property];
        probe.remove();
        return value;
      }

      return {
        promptColor: window.getComputedStyle(prompt).color,
        bodyColor: window.getComputedStyle(body).color,
        terminalBackground: window.getComputedStyle(terminal).backgroundColor,
        expectedPromptColor: resolveToken("color", "--color-accent-gold-light"),
        expectedBodyColor: resolveToken("color", "--color-cream"),
        expectedTerminalBackground: resolveToken(
          "backgroundColor",
          "--surface-dark"
        ),
      };
    });

    expect(colors.promptColor).toBe(colors.expectedPromptColor);
    expect(colors.bodyColor).toBe(colors.expectedBodyColor);
    expect(colors.terminalBackground).toBe(colors.expectedTerminalBackground);
  });

  test("does not trap keyboard focus and exposes no terminal dots while tabbing", async ({
    page,
  }) => {
    let reachedFocusableAfterTerminal = false;
    const focusTrail = [];

    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");

      const snapshot = await page.evaluate(() => {
        const active = document.activeElement;
        const terminalSection = document.querySelector("#terminal-section");
        const afterTerminalTargets = [
          document.querySelector("#garden-section a.garden-viz__plant"),
          document.querySelector("#view-full-decision a"),
          document.querySelector("footer a"),
        ].filter(Boolean);

        return {
          text: active ? (active.textContent || "").trim().slice(0, 80) : "",
          href:
            active && typeof active.getAttribute === "function"
              ? active.getAttribute("href")
              : null,
          className: active ? active.className : "",
          insideTerminal:
            !!terminalSection && !!active && terminalSection.contains(active),
          isTerminalDot:
            !!active &&
            typeof active.classList?.contains === "function" &&
            active.classList.contains("terminal__dot"),
          isAfterTerminalTarget: afterTerminalTargets.some(
            (target) => target === active
          ),
        };
      });

      focusTrail.push(snapshot);

      expect(snapshot.insideTerminal).toBe(false);
      expect(snapshot.isTerminalDot).toBe(false);

      if (snapshot.isAfterTerminalTarget) {
        reachedFocusableAfterTerminal = true;
        break;
      }
    }

    expect(reachedFocusableAfterTerminal).toBe(true);

    const lastThree = focusTrail.slice(-3);
    if (lastThree.length === 3) {
      const allSame = lastThree.every(
        (item) =>
          item.text === lastThree[0].text &&
          item.href === lastThree[0].href &&
          item.className === lastThree[0].className
      );
      expect(allSame).toBe(false);
    }
  });
});
