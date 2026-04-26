const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "runner",
  "pipeline-template.json"
);

function loadTemplate() {
  return JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8"));
}

function getStage(template, stageId) {
  const stage = template.orchestratorConfig.pipeline.find(
    (candidate) => candidate.stageId === stageId
  );
  expect(stage, `missing pipeline stage: ${stageId}`).toBeTruthy();
  return stage;
}

test.describe("daily pipeline template contract", () => {
  test("Explore runs a broad daily search and tolerates partial handoffs from provider stops", () => {
    const template = loadTemplate();
    const explore = getStage(template, "explore");

    expect(explore.roomConfig.seedMode).toBe("Domain Search");
    expect(explore.objective).toContain("propose 3-5 candidate improvements");
    expect(explore.objective).toContain("broad daily search");
    expect(explore.objective).toContain("partial concept bundle");
    expect(explore.handoff.requiredStatus).toEqual([
      "finalized",
      "partial",
      "failed",
    ]);
  });

  test("failed status is limited to stages with known partial-handoff failure modes", () => {
    const template = loadTemplate();
    const stages = template.orchestratorConfig.pipeline;
    const tolerantStages = new Set(["explore", "implementation"]);

    for (const stage of stages) {
      const statuses = stage.handoff?.requiredStatus || [];
      if (tolerantStages.has(stage.stageId)) {
        expect(statuses).toContain("failed");
      } else {
        expect(statuses).not.toContain("failed");
      }
    }
  });
});
