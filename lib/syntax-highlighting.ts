import type { SyntaxHighlighterProps } from "react-syntax-highlighter";
import { PrismLight } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/esm/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

// The full Prism entry pulls in every language (~1MB). Register only what the app
// highlights: source files opened in the viewer and common fenced block languages.
import bash from "refractor/bash";
import c from "refractor/c";
import cpp from "refractor/cpp";
import csharp from "refractor/csharp";
import css from "refractor/css";
import diff from "refractor/diff";
import docker from "refractor/docker";
import go from "refractor/go";
import graphql from "refractor/graphql";
import hcl from "refractor/hcl";
import ini from "refractor/ini";
import java from "refractor/java";
import javascript from "refractor/javascript";
import json from "refractor/json";
import jsx from "refractor/jsx";
import kotlin from "refractor/kotlin";
import makefile from "refractor/makefile";
import markdown from "refractor/markdown";
import markup from "refractor/markup";
import objectivec from "refractor/objectivec";
import perl from "refractor/perl";
import php from "refractor/php";
import powershell from "refractor/powershell";
import properties from "refractor/properties";
import python from "refractor/python";
import r from "refractor/r";
import ruby from "refractor/ruby";
import rust from "refractor/rust";
import scala from "refractor/scala";
import sql from "refractor/sql";
import swift from "refractor/swift";
import toml from "refractor/toml";
import tsx from "refractor/tsx";
import typescript from "refractor/typescript";
import yaml from "refractor/yaml";

const LANGUAGES = {
  bash, c, cpp, csharp, css, diff, docker, go, graphql, hcl, ini, java, javascript,
  json, jsx, kotlin, makefile, markdown, markup, objectivec, perl, php, powershell,
  properties, python, r, ruby, rust, scala, sql, swift, toml, tsx, typescript, yaml,
} as const;

for (const [name, language] of Object.entries(LANGUAGES)) {
  PrismLight.registerLanguage(name, language);
}

export const CodeHighlighter = PrismLight;
export type CodeHighlighterProps = SyntaxHighlighterProps;
export { vs, vscDarkPlus };
export { normalizeLanguage, REGISTERED_LANGUAGES } from "./code-languages";