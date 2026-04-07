const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

test.describe("Mobile navigation toggle", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(getAppUrl("/"));
  });

  test("opens and closes with correct aria-expanded state and visible nav links", async ({
    page,
  }) => {
    const toggle = page.locator(".nav__mobile-toggle");
    const menu = page.locator(".nav__links");
    const navLinks = [
      { href: "/", name: "Home" },
      { href: "/archive/", name: "Archive" },
      { href: "/judges/", name: "Judges" },
      { href: "/feedback/", name: "Feedback" },
      { href: "/days/", name: "View Source|Days" },
    ];

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("aria-label", "Toggle menu");
    await expect(menu).toBeHidden();

    await toggle.click();

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toBeVisible();

    for (const linkMeta of navLinks) {
      const link = menu.locator(`a[href="${linkMeta.href}"]`);
      await expect(link).toBeVisible();
      await expect(link).toContainText(new RegExp(linkMeta.name));
      await link.click({ trial: true });
    }

    await toggle.click();

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();
  });

  test("supports keyboard open and close with Enter after focusing the toggle via Tab", async ({
    page,
  }) => {
    const toggle = page.locator(".nav__mobile-toggle");
    const menu = page.locator(".nav__links");

    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();

    await page.keyboard.press("Enter");

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toBeVisible();

    await page.keyboard.press("Enter");

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();
  });
});
