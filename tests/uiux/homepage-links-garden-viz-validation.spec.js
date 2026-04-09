const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
} = require("./helpers/local-site");

function isValidIsoDate(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return false;
  }

  const date = new Date(`${dateString}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateString;
}

test("homepage internal links are well-formed and garden plant links use valid day URLs", async ({
  page,
}) => {
  if (USE_ROUTED_SITE) {
    await installLocalSiteRoutes(page);
  }

  await page.goto(getAppUrl("/"));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#garden-section")).toBeVisible();

  const linkData = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a")).map((anchor) => {
      const href = anchor.getAttribute("href");
      const text = (anchor.textContent || "").trim();
      const isInternal =
        typeof href === "string" &&
        (href.startsWith("/") || href.startsWith("#"));
      const isHash = typeof href === "string" && href.startsWith("#");
      const hashTarget = isHash ? document.getElementById(href.slice(1)) : null;

      return {
        href,
        text,
        isInternal,
        isHash,
        isGardenPlant: anchor.matches(".garden-viz__plant"),
        hashTargetExists: isHash ? !!hashTarget : null,
      };
    })
  );

  expect(linkData.length).toBeGreaterThan(0);

  linkData.forEach((link) => {
    expect(link.href).toBeTruthy();
    expect(link.href).not.toBe("");
    expect(link.href).not.toBe("#");
    expect(link.href).not.toBe("undefined");
  });

  const internalLinks = linkData.filter((link) => link.isInternal);
  expect(internalLinks.length).toBeGreaterThan(0);

  internalLinks.forEach((link) => {
    expect(link.href.trim().length).toBeGreaterThan(0);

    if (link.isHash) {
      expect(
        link.hashTargetExists,
        `hash link ${link.href} should resolve to an element in the DOM`
      ).toBe(true);
    }
  });

  const gardenPlantLinks = linkData.filter((link) => link.isGardenPlant);
  expect(gardenPlantLinks.length).toBeGreaterThan(0);

  gardenPlantLinks.forEach((link) => {
    expect(link.href).toMatch(/^\/days\/\?date=\d{4}-\d{2}-\d{2}$/);

    const match = link.href.match(/^\/days\/\?date=(\d{4}-\d{2}-\d{2})$/);
    expect(match).toBeTruthy();
    expect(isValidIsoDate(match[1])).toBe(true);
  });

  const fullArchiveLink = page.getByRole("link", { name: "View full archive" });
  await expect(fullArchiveLink).toHaveAttribute("href", "/archive/");

  const navDestinations = ["/", "/archive/", "/judges/", "/feedback/", "/days/"];
  for (const destination of navDestinations) {
    await expect(page.locator(`.nav__links a[href="${destination}"]`)).toHaveCount(1);
  }

  const footerLink = page.locator('footer a[href="https://commands.com"]');
  await expect(footerLink).toHaveCount(1);
});
