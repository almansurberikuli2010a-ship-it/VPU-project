import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";

test("HTTP boundary: health, missing keys, validation, origin checks, expired jobs", async (t) => {
  const server = createApp({ configured: false }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown, origin?: string) =>
    fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await (await fetch(`${base}/api/health`)).json()).configured,
    false,
  );
  const response = await post({ university_name: "MIT" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error_code, "SERVER_NOT_CONFIGURED");
  assert.equal((await post({ university_name: "X" })).status, 400);
  assert.equal(
    (await post({ university_name: "MIT" }, "https://evil.example")).status,
    403,
  );
  assert.equal((await fetch(`${base}/api/jobs/unknown`)).status, 404);
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
});
test("HTTP job lifecycle exposes final status union and supports cancellation", async (t) => {
  const server = createApp({
    configured: true,
    pipeline: async (request) => ({
      status: "not_found",
      query: request.university_name,
      suggestions: [],
    }),
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const created = await fetch(`${base}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ university_name: "Test" }),
  });
  assert.equal(created.status, 202);
  const { job_id } = await created.json();
  const finished = await (await fetch(`${base}/api/jobs/${job_id}`)).json();
  assert.equal(finished.status, "not_found");
  assert.equal(
    (await fetch(`${base}/api/jobs/${job_id}`, { method: "DELETE" })).status,
    204,
  );
  assert.equal((await fetch(`${base}/api/jobs/${job_id}`)).status, 404);
});
