const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  USE_ROUTED_SITE,
  installLocalSiteRoutes,
  getAppUrl,
  repoRoot,
} = require("./helpers/local-site");

const componentsCssPath = path.join(repoRoot, "site/css/components.css");
const designSystemCssPath = path.join(
  repoRoot,
  "site/css/design-system.css"
);
const terminalSpecPath = path.join(
  repoRoot,
  "content/days/2026-04-10/spec.md"
);

function collectTerminalViolations(cssSource) {
  const lines = cssSource.split(/\r?\n/);
  const stack = [];
  const violations = [];

  function recordViolation(selector, property, value, lineNumber) {
    const hasHardcodedColor =
      /#[0-9a-f]{3,8}\b/i.test(value) || /rgba?\(/i.test(value);
    const colorProperty =
      property === "color" ||
      property === "background" ||
      property === "background-color";

    if (!hasHardcodedColor) {
      return;
    }

    if (colorProperty || property === "box-shadow") {
      violations.push({
        lineNumber,
        selector,
        property,
        value,
      });
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const inlineRule = trimmed.match(
      /^([^@][^{]+)\{\s*([a-z-]+)\s*:\s*([^;]+);\s*\}$/i
    );
    if (inlineRule) {
      const [, selector, property, value] = inlineRule;
      if (selector.includes(".terminal")) {
        recordViolation(selector.trim(), property, value.trim(), index + 1);
      }
      continue;
    }

    if (trimmed.endsWith("{")) {
      stack.push(trimmed.slice(0, -1).trim());
      continue;
    }

    if (trimmed.startsWith("}")) {
      stack.pop();
      continue;
    }

    const currentSelector = [...stack]
      .reverse()
      .find((selector) => !selector.startsWith("@"));

    if (!currentSelector || !currentSelector.includes(".terminal")) {
      continue;
    }

    const declaration = trimmed.match(/^([a-z-]+)\s*:\s*([^;]+);$/i);
    if (!declaration) {
      continue;
    }

    const [, property, value] = declaration;
    recordViolation(currentSelector, property, value, index + 1);
  }

  return violations;
}

function formatViolations(violations) {
  if (violations.length === 0) {
    return "No hardcoded terminal color violations found.";
  }

  return violations
    .map(
      (violation) =>
        `line ${violation.lineNumber}: ${violation.selector} { ${violation.property}: ${violation.value}; }`
    )
    .join("\n");
}

test.describe("Terminal widget design-system compliance", () => {
  test.beforeEach(async ({ page }) => {
    if (USE_ROUTED_SITE) {
      await installLocalSiteRoutes(page);
    }

    await page.goto(getAppUrl("/"));
    await expect(page.locator("#terminal-section")).toBeVisible();
    await expect(page.locator("#terminal-container .terminal")).toHaveCount(1);
  });

  test("spec requires design-system tokens for terminal colors and no new terminal tokens were added", async () => {
    const specSource = fs.readFileSync(terminalSpecPath, "utf8");
    const designSystemSource = fs.readFileSync(designSystemCssPath, "utf8");

    expect(specSource).toContain("--color-error");
    expect(specSource).toContain("--color-warning");
    expect(specSource).toContain("--color-success");
    expect(specSource).toContain("No hardcoded hex values");
    expect(specSource).toContain("No new tokens added to `design-system.css`");

    const definedTokens = Array.from(
      designSystemSource.matchAll(/(--[a-z0-9-]+)\s*:/gi),
      (match) => match[1]
    );

    [
      "--surface-dark",
      "--color-cream",
      "--color-accent-gold-light",
      "--color-error",
      "--color-warning",
      "--color-success",
    ].forEach((token) => {
      expect(definedTokens).toContain(token);
    });

    const terminalSpecificTokens = definedTokens.filter((token) =>
      token.startsWith("--terminal")
    );
    expect(terminalSpecificTokens).toEqual([]);
  });

  test("terminal CSS rules do not use hardcoded hex or rgba color values", async () => {
    const componentsCss = fs.readFileSync(componentsCssPath, "utf8");
    const violations = collectTerminalViolations(componentsCss);

    expect(
      violations,
      `Expected .terminal* rules to use design-system vars only.\n${formatViolations(
        violations
      )}`
    ).toEqual([]);
  });
});
