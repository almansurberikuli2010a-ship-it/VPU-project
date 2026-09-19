import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "../server/queue.js";

test("queue limits active work and removes cancelled waiters without consuming slots", async () => {
  const run = createLimiter(1);
  let release!: () => void;
  const ready = new Promise<void>((r) => {
    release = r;
  });
  const first = run(() => ready, new AbortController().signal);
  const cancelled = new AbortController();
  const second = run(async () => {
    assert.fail("cancelled work ran");
  }, cancelled.signal);
  const rejected = assert.rejects(second);
  cancelled.abort();
  let ran = false;
  const third = run(async () => {
    ran = true;
  }, new AbortController().signal);
  assert.equal(ran, false);
  release();
  await Promise.all([first, rejected, third]);
  assert.equal(ran, true);
});
