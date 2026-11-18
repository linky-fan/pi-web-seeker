import assert from "node:assert/strict";
import test from "node:test";

const { normalizeLanguage, REGISTERED_LANGUAGES } = await import("../lib/code-languages.ts");

test("bare text languages normalize to the no-highlight token", () => {
  for (const value of ["", "  ", "text", "TXT", "plaintext", " PlainText "]) {
    assert.equal(normalizeLanguage(value), "text", value);
  }
});

test("known languages pass through lowercased", () => {
  assert.equal(normalizeLanguage("TypeScript"), "typescript");
  assert.equal(normalizeLanguage(" dockerfile "), "dockerfile");
  assert.equal(normalizeLanguage("HTML"), "html");
});

test("the registered set covers what the file viewer and markdown emit", () => {
  // Extensions map to these names; html/xml/svg resolve through the markup grammar's
  // aliases and dockerfile through docker's alias, so register the base grammars.
  const required = [
    "typescript", "javascript", "python", "ruby", "go", "rust", "java", "kotlin",
    "swift", "c", "cpp", "csharp", "markup", "css", "json", "yaml", "toml",
    "markdown", "bash", "sql", "graphql", "docker", "hcl", "makefile",
  ];
  for (const name of required) {
    assert.ok(REGISTERED_LANGUAGES.includes(name), `missing ${name}`);
  }
  assert.equal(REGISTERED_LANGUAGES.length < 60, true, "registering too many languages defeats the size win");
});