const { test, expect } = require("@playwright/test");

async function hasVisibleFocusStyle(locator) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const hasOutline =
      style.outlineStyle !== "none" && style.outlineWidth !== "0px";
    const hasBoxShadow = style.boxShadow !== "none";
    return hasOutline || hasBoxShadow;
  });
}

async function activeElementIsVisible(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  });
}

test("desktop keyboard navigation reaches nav links and hero CTAs with visible focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  await page.keyboard.press("Tab");

  const firstFocus = await page.evaluate(() => {
    const element = document.activeElement;
    const href =
      element && typeof element.getAttribute === "function"
        ? element.getAttribute("href")
        : null;

    return {
      inNav: !!element?.closest("nav"),
      isSkipLink: typeof href === "string" && href.startsWith("#"),
    };
  });

  expect(firstFocus.inNav || firstFocus.isSkipLink).toBe(true);

  const navLinks = page.locator(".nav__link");
  const navLinkCount = await navLinks.count();

  for (let index = 0; index < navLinkCount; index += 1) {
    await page.keyboard.press("Tab");
    const link = navLinks.nth(index);
    await expect(link).toBeFocused();
    expect(await hasVisibleFocusStyle(link)).toBe(true);
  }

  const primaryCta = page.getByRole("link", { name: "See today's change" });
  const feedbackCta = page.getByRole("link", { name: "Give feedback" });

  await page.keyboard.press("Tab");
  await expect(primaryCta).toBeFocused();
  await expect(primaryCta).toHaveAccessibleName("See today's change");

  await page.keyboard.press("Tab");
  await expect(feedbackCta).toBeFocused();
  await expect(feedbackCta).toHaveAccessibleName("Give feedback");
});

test("mobile nav toggle responds to keyboard and hidden menu items are skipped when closed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");

  const toggle = page.locator(".nav__mobile-toggle");
  const menu = page.locator(".nav__links");
  const menuLinks = page.locator(".nav__links .nav__link");
  const primaryCta = page.getByRole("link", { name: "See today's change" });

  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();

  await toggle.focus();
  await page.keyboard.press("Enter");

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toBeVisible();

  const menuLinkCount = await menuLinks.count();
  for (let index = 0; index < menuLinkCount; index += 1) {
    await page.keyboard.press("Tab");
    const link = menuLinks.nth(index);
    await expect(link).toBeFocused();
    await expect(link).toBeVisible();
    expect(await activeElementIsVisible(page)).toBe(true);
  }

  await toggle.focus();
  await page.keyboard.press("Space");

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();

  await page.keyboard.press("Tab");
  await expect(primaryCta).toBeFocused();
});
