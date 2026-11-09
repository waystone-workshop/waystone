import test from "node:test";
import assert from "node:assert/strict";
import { rangeQuery, mergeMessages } from "../src/context.mjs";
import policy from "../policy.cjs";
test("export range is inclusive and independent of click order", () => {
  assert.equal(rangeQuery("selection", new Set([9, 3, 5])), "from=3&to=9");
  assert.equal(rangeQuery("all", new Set([9])), "");
  assert.throws(() => rangeQuery("selection", new Set()), /Select/);
});
test("catch-up deduplicates messages received through HTTP and sockets", () => {
  assert.deepEqual(
    mergeMessages([{ id: 3 }, { id: 1 }], [{ id: 3 }, { id: 2 }]),
    [{ id: 1 }, { id: 2 }, { id: 3 }],
  );
});
test("desktop only connects to HTTPS or local development origins", () => {
  assert.equal(
    policy.validateServer("https://mars.example.com"),
    "https://mars.example.com",
  );
  assert.equal(
    policy.validateServer("http://localhost:4000"),
    "http://localhost:4000",
  );
  for (const url of [
    "http://mars.example.com",
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "https://example.com/path",
  ])
    assert.throws(() => policy.validateServer(url));
});
test("desktop request bridge cannot escape the API", () => {
  policy.validatePath("/api/channels/3/export?format=zip&from=1&to=9");
  for (const path of [
    "https://evil.test",
    "/api/../secret",
    "//evil.test",
    "/api/%2e%2e/secret",
  ])
    assert.throws(() => policy.validatePath(path));
});
