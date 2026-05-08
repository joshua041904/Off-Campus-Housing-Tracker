import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PAGES = [
  { name: "trust", path: "/trust" },
  { name: "listings", path: "/listings" },
  { name: "login", path: "/login" },
  { name: "register", path: "/register" },
];

test.describe("accessibility checks (axe)", () => {
  for (const { name, path } of PAGES) {
    test(`${name} page has no critical accessibility violations`, async ({ page }) => {
      await page.route("**/api/listings/search*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      });

      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .exclude("#__next > [aria-hidden]")
        .analyze();

      const critical = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious"
      );

      if (critical.length > 0) {
        console.log(
          "Accessibility violations:",
          JSON.stringify(critical.map((v) => ({
            id: v.id,
            impact: v.impact,
            description: v.description,
            nodes: v.nodes.length,
          })), null, 2)
        );
      }

      expect(critical).toHaveLength(0);
    });
  }
});
