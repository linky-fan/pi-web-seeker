import assert from "node:assert/strict";
import { resolve, sep } from "node:path";
import test from "node:test";

const { isValidComsNetProjectId, comsNetProjectDir, ComsNetInputError } = await import("../lib/coms-net-project.ts");

test("accepts ordinary coms-net project ids", () => {
  for (const id of ["default", "team-1", "proj_2", "A.b-c_9"]) {
    assert.equal(isValidComsNetProjectId(id), true, id);
  }
});

test("rejects traversal and separator project ids", () => {
  for (const id of ["", ".", "..", "../x", "a/b", "a\\b", "/abs", "C:/x", ".hidden", "-lead", "a b", "a".repeat(65), "a..b"]) {
    assert.equal(isValidComsNetProjectId(id), false, id);
  }
});

test("resolves project directories beneath the projects root", () => {
  const root = resolve("home", ".pi", "coms-net", "projects");
  assert.equal(comsNetProjectDir(root, "team-1"), `${root}${sep}team-1`);
  assert.throws(() => comsNetProjectDir(root, "../escape"), ComsNetInputError);
  assert.throws(() => comsNetProjectDir(root, ".."), ComsNetInputError);
});