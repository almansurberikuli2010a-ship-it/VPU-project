import { test, expect } from "@playwright/test";
import type { PhotoRecord, Result, Profile } from "../shared/contracts.js";

test("desktop: real missing-key error, footer dialog, keyboard close, no overflow", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "See your university through real eyes.",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/home-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Privacy & sources" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "University name" })
    .fill("Test University");
  await page.getByRole("button", { name: "Build profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Search is not ready yet" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("API keys");
});

test("mobile and fixture-only flows: selection, limited data, tags, report, not found, cancellation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { status: "ok", configured: true } }),
  );
  let next:
    | Result
    | {
        status: "processing";
        partial?: Profile;
        progress: {
          stage: "verifying";
          found: number;
          assessed: number;
          accepted: number;
          elapsed_ms: number;
        };
      } = {
    status: "disambiguation_needed",
    query: "Test",
    candidates: [
      {
        id: "one",
        name: "Test University",
        location: "Test City",
        selection_token: "fixture-one",
      },
      {
        id: "two",
        name: "Another Test University",
        location: "Another City",
        selection_token: "fixture-two",
      },
    ],
  };
  await page.route("**/api/jobs", (route) =>
    route.fulfill({ status: 202, json: { job_id: "test-fixture" } }),
  );
  await page.route("**/api/jobs/test-fixture", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 204 })
      : route.fulfill({ json: next }),
  );
  await page.route("https://fixture.invalid/**", (route) => route.abort());
  await page.goto("/");
  await page.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("textbox", { name: "University name" }).fill("Test");
  await page.getByRole("button", { name: "Build profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Multiple universities found" }),
  ).toBeVisible();
  const card: PhotoRecord = {
    id: "test-photo",
    title: "Test fixture dormitory",
    image_url: "https://fixture.invalid/photo.jpg",
    source: "https://fixture.invalid/source",
    date: "2026-09-18",
    date_kind: "retrieved",
    verification_status: "limited_verification",
    confidence: 0.72,
    reasoning: "Fixture assessment: affiliation is uncertain.",
    tags: ["dormitory", "student_life"],
    category: "dormitories",
    verification_method: "Test-only assessment",
    duplicate_risk: "unknown",
  };
  next = {
    status: "success",
    university_name: "Test University — UI fixture",
    location: "Test City",
    description: "Synthetic data used only for automated interface tests.",
    description_sources: ["https://fixture.invalid/about"],
    categories: {
      campus: [],
      dormitories: [card],
      classrooms: [],
      libraries: [],
      city: [],
    },
    data_quality: "limited",
    warnings: ["Not enough evidence in this fixture."],
    missing_categories: ["campus", "classrooms", "libraries", "city"],
    stats: {
      found: 1,
      assessed: 1,
      accepted: 1,
      duplicates_removed: 0,
      rejected: 0,
      unavailable: 0,
      elapsed_ms: 1000,
    },
    generated_at: "2026-09-18T10:00:00Z",
  };
  const completed = next;
  next = {
    status: "processing",
    progress: {
      stage: "verifying",
      found: 10,
      assessed: 1,
      accepted: 1,
      elapsed_ms: 2000,
    },
    partial: completed,
  };
  await page.getByRole("button", { name: /Another Test University/ }).click();
  await expect(
    page.getByRole("heading", { name: "Test University — UI fixture" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop search" })).toBeVisible();
  next = completed;
  await expect(page.getByRole("button", { name: "Stop search" })).toHaveCount(
    0,
  );
  await expect(page.getByText("Limited data available")).toBeVisible();
  await expect(page.getByText("Image unavailable")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /Sports/ }).click();
  await expect(
    page.getByRole("heading", { name: "No photographs to show" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page
    .getByRole("button", { name: /View photo and verification report/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Fixture assessment: affiliation is uncertain.",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/profile-mobile-fixture.png",
    fullPage: true,
  });
  next = {
    status: "not_found",
    query: "Unknown",
    suggestions: ["Harvard University"],
  };
  await page.getByRole("textbox", { name: "University name" }).fill("Unknown");
  await page.getByRole("textbox", { name: "University name" }).press("Enter");
  await expect(
    page.getByRole("heading", { name: "University not found" }),
  ).toBeVisible();
  next = {
    status: "processing",
    progress: {
      stage: "verifying",
      found: 8,
      assessed: 2,
      accepted: 1,
      elapsed_ms: 8000,
    },
  };
  await page.getByRole("button", { name: "Harvard University" }).click();
  await expect(page.getByText("8 images found")).toBeVisible();
  await page.getByRole("button", { name: "Cancel search" }).click();
  await expect(
    page.getByRole("heading", {
      name: "See your university through real eyes.",
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
