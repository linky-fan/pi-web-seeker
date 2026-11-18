import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CheckerAdapter } from "../adapter-types";
import type { ProjectContext } from "../discovery";
import { relativeProjectPath } from "../discovery";
import { decodeXmlAttribute, projectRelativeSourceFiles, resolveExecutable, severityFrom } from "../common";
import type { CheckerDiagnostic } from "../types";

const MAX_JAVA_SOURCES = 120;
const BUILTIN_CHECKSTYLE_CONFIG = [
  "<module name=\"Checker\">",
  "  <property name=\"charset\" value=\"UTF-8\"/>",
  "  <module name=\"FileTabCharacter\"/>",
  "  <module name=\"LineLength\"><property name=\"max\" value=\"160\"/></module>",
  "  <module name=\"TreeWalker\">",
  "    <module name=\"AvoidStarImport\"/>",
  "    <module name=\"OneStatementPerLine\"/>",
  "    <module name=\"WhitespaceAfter\"/>",
  "    <module name=\"AvoidInlineConditionals\"/>",
  "  </module>",
  "</module>",
].join("\n");

function javaSources(project: ProjectContext): string[] {
  return projectRelativeSourceFiles(project.root, project.sourceFiles, [".java"], MAX_JAVA_SOURCES);
}

function configuredCheckstyleConfig(project: ProjectContext): string | null {
  const candidates = [
    "checkstyle.xml",
    ".checkstyle.xml",
    "config/checkstyle/checkstyle.xml",
    "config/checkstyle/checkstyle-main.xml",
  ];
  for (const candidate of candidates) {
    const absolute = path.resolve(project.root, candidate);
    if (relativeProjectPath(project.root, absolute) && fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      return absolute;
    }
  }
  return null;
}

function defaultCheckstyleConfig(): string {
  const configDirectory = path.join(os.tmpdir(), "pi-web-checkers");
  fs.mkdirSync(configDirectory, { recursive: true });
  const configPath = path.join(configDirectory, "java-checkstyle-default.xml");
  if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, BUILTIN_CHECKSTYLE_CONFIG, "utf8");
  return configPath;
}

function checkstyleInvocation(project: ProjectContext): { command: string; prefix: string[] } | null {
  const cli = resolveExecutable("checkstyle", project.root);
  if (cli) return { command: cli, prefix: [] };
  const configuredJar = process.env.PI_WEB_CHECKSTYLE_JAR?.trim();
  if (!configuredJar) return null;
  try {
    if (!fs.statSync(configuredJar).isFile()) return null;
  } catch {
    return null;
  }
  const java = resolveExecutable("java", project.root);
  return java ? { command: java, prefix: ["-jar", configuredJar] } : null;
}

export function parseCheckstyle(project: ProjectContext, checkerId: string, output: string): CheckerDiagnostic[] {
  const diagnostics: CheckerDiagnostic[] = [];
  const files = /<file\b([^>]*)>([\s\S]*?)<\/file>/g;
  for (const fileMatch of output.matchAll(files)) {
    const fileAttributes = fileMatch[1];
    const filePath = /\bname="([^"]*)"/.exec(fileAttributes)?.[1];
    if (!filePath) continue;
    const errors = /<error\b([^>]*)\/?>/g;
    for (const errorMatch of fileMatch[2].matchAll(errors)) {
      const attributes = errorMatch[1];
      const getAttribute = (name: string) => {
        const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
        return match ? decodeXmlAttribute(match[1]) : undefined;
      };
      const message = getAttribute("message");
      if (!message) continue;
      diagnostics.push({
        id: `${checkerId}:${filePath}:${getAttribute("line") ?? 0}:${getAttribute("column") ?? 0}:${getAttribute("source") ?? message}`,
        checkerId,
        language: "java",
        path: relativeProjectPath(project.root, decodeXmlAttribute(filePath)),
        line: Number(getAttribute("line")) || undefined,
        column: Number(getAttribute("column")) || undefined,
        severity: severityFrom(getAttribute("severity")),
        code: getAttribute("source")?.split(".").pop(),
        message: message.slice(0, 2_000),
      });
    }
  }
  return diagnostics.slice(0, 2_000);
}

export const javaCheckstyleAdapter: CheckerAdapter = {
  id: "java-checkstyle",
  language: "java",
  label: "Java · Checkstyle",
  detect: (project) => project.entries.has("pom.xml")
    || project.entries.has("build.gradle")
    || project.entries.has("build.gradle.kts")
    || project.entries.has("settings.gradle")
    || project.entries.has("settings.gradle.kts")
    || project.sourceFiles.some((file) => file.toLowerCase().endsWith(".java")),
  availability(project) {
    if (javaSources(project).length === 0) {
      return { available: false, reason: "java.sourcesMissing" };
    }
    return checkstyleInvocation(project)
      ? {
        available: true,
        note: configuredCheckstyleConfig(project)
          ? undefined
          : "java.builtinConfig",
      }
      : { available: false, reason: "java.toolMissing" };
  },
  async createInvocation(project) {
    const executable = checkstyleInvocation(project);
    if (!executable) throw new Error("Checkstyle is not available.");
    const config = configuredCheckstyleConfig(project) ?? defaultCheckstyleConfig();
    const sources = javaSources(project);
    if (sources.length === 0) throw new Error("No Java source files were found.");
    return {
      command: executable.command,
      args: [...executable.prefix, "-f", "xml", "-c", config, ...sources],
      cwd: project.root,
    };
  },
  parse(project, checkerId, output) {
    return parseCheckstyle(project, checkerId, `${output.stdout}\n${output.stderr}`);
  },
};
