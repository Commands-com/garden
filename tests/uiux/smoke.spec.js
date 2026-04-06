// Minimal smoke test to validate harness wiring
const { test, expect } = require("@playwright/test");

test("homepage loads successfully", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/.+/);
});
