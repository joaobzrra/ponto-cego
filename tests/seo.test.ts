import assert from "node:assert/strict";
import test from "node:test";
import { launchRobots, publicIndexingEnabled } from "../src/lib/seo";

test("indexing is disabled by default", () => {
  const previous = process.env.PUBLIC_INDEXING_ENABLED;
  delete process.env.PUBLIC_INDEXING_ENABLED;
  assert.equal(publicIndexingEnabled(), false);
  assert.deepEqual(launchRobots(), { index: false, follow: true, nocache: true });
  if (previous === undefined) delete process.env.PUBLIC_INDEXING_ENABLED;
  else process.env.PUBLIC_INDEXING_ENABLED = previous;
});

test("indexing requires the explicit true value", () => {
  const previous = process.env.PUBLIC_INDEXING_ENABLED;
  process.env.PUBLIC_INDEXING_ENABLED = "true";
  assert.equal(publicIndexingEnabled(), true);
  assert.deepEqual(launchRobots(), { index: true, follow: true });
  if (previous === undefined) delete process.env.PUBLIC_INDEXING_ENABLED;
  else process.env.PUBLIC_INDEXING_ENABLED = previous;
});
