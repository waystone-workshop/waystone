import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const included = new Set(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).build.files);

function localRequires(source) {
  return [...source.matchAll(/require\((["'])(\.[^"']+)\1\)/g)].map((match) => match[2]);
}

test("the installer packs every module the main process loads", () => {
  const pending = ["main.cjs"];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    assert.equal(included.has(file), true, `${file} is missing from the installer`);
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(join(root, file), "utf8");
    for (const spec of localRequires(source)) {
      pending.push(relative(root, join(root, dirname(file), spec)).replaceAll("\\", "/"));
    }
  }
  assert.equal(seen.has("display-media.cjs"), true);
});
