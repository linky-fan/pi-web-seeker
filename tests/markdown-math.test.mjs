import assert from "node:assert/strict";
import test from "node:test";

const { containsMath } = await import("../lib/markdown-math.ts");

test("detects display math only in the $$ form remark-math understands", () => {
  assert.equal(containsMath("before\n$$\nx = 1\n$$\nafter"), true);
  assert.equal(containsMath("start $$x$$ end"), true);
  // remark-math ignores backslash delimiters, so they must not load KaTeX.
  assert.equal(containsMath("inline \\(x+1\\) value"), false);
  assert.equal(containsMath("block \\[x^2\\] here"), false);
});

test("ignores plain prose, inline dollar amounts, and escaped delimiters", () => {
  assert.equal(containsMath("This costs $5 and $10."), false);
  assert.equal(containsMath("no math here"), false);
  assert.equal(containsMath(""), false);
  assert.equal(containsMath("escaped \\$$ not math"), false);
});

test("a Windows-style path or escaped backslash-paren is not treated as math", () => {
  assert.equal(containsMath("C:\\\\Users\\\\x"), false);
  assert.equal(containsMath("multiply \\\\(not math"), false);
});