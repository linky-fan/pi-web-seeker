import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { scanWorkspace, resolveInsideProject } = await import("../lib/checkers/discovery.ts");
const { decodeXmlAttribute, normalizeDiagnostic, parseJsonLines } = await import("../lib/checkers/common.ts");
const { validateCheckerIds } = await import("../lib/checkers/index.ts");
const { parseRuff, parseMypy } = await import("../lib/checkers/adapters/python.ts");
const { parseCheckstyle } = await import("../lib/checkers/adapters/java.ts");
const { compileDatabase, parseClangTidy } = await import("../lib/checkers/adapters/c-family.ts");
const { parseGoVet } = await import("../lib/checkers/adapters/go.ts");
const { parseCargoMessages } = await import("../lib/checkers/adapters/rust.ts");
const { rustClippyAdapter } = await import("../lib/checkers/adapters/rust.ts");
const { goVetAdapter } = await import("../lib/checkers/adapters/go.ts");
const { pythonRuffAdapter } = await import("../lib/checkers/adapters/python.ts");
const { runCheckerProcess } = await import("../lib/checkers/process-runner.ts");
const { openFileTab } = await import("../components/app-shell/inspector-state.ts");

function tempDirectory(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "pi-web-checkers-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return realpathSync.native(root);
}

function ensureFile(filePath, contents = "") {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function project(root, sourceFiles = []) {
  return {
    workspaceRoot: root,
    root,
    relativeRoot: ".",
    entries: new Set(),
    sourceFiles,
  };
}

test("workspace discovery finds Python, Java, C/C++, Go, and Rust project roots", (t) => {
  const root = tempDirectory(t);
  ensureFile(path.join(root, "py", "pyproject.toml"), "[project]\nname='py'\n");
  ensureFile(path.join(root, "py", "src", "main.py"));
  ensureFile(path.join(root, "java", "pom.xml"), "<project />\n");
  ensureFile(path.join(root, "java", "src", "Main.java"));
  ensureFile(path.join(root, "c", "CMakeLists.txt"), "project(sample C)\n");
  ensureFile(path.join(root, "c", "src", "main.cpp"));
  ensureFile(path.join(root, "go", "go.mod"), "module example.test/app\n");
  ensureFile(path.join(root, "go", "main.go"));
  ensureFile(path.join(root, "rust", "Cargo.toml"), "[package]\nname='sample'\nversion='0.1.0'\n");
  ensureFile(path.join(root, "rust", "src", "main.rs"));

  const result = scanWorkspace(root);
  assert.deepEqual(
    result.projects.map((item) => `${item.relativeRoot}:${item.sourceFiles.length}`),
    ["c:1", "go:1", "java:1", "py:1", "rust:1"],
  );
  assert.equal(result.truncated, false);
});

test("workspace discovery reports a depth-limited scan and ignores generated directories", (t) => {
  const root = tempDirectory(t);
  ensureFile(path.join(root, "node_modules", "hidden", "deep.py"));
  ensureFile(path.join(root, "a", "b", "c", "d", "e", "f", "deep.py"));
  const result = scanWorkspace(root);
  assert.equal(result.projects.length, 0);
  assert.equal(result.truncated, true);
});

test("project paths reject traversal and normalize diagnostics to relative files", (t) => {
  const root = tempDirectory(t);
  const source = ensureFile(path.join(root, "src", "main.py"));
  assert.equal(resolveInsideProject(root, "../outside.py"), null);
  assert.equal(resolveInsideProject(root, source), source);
  const diagnostic = normalizeDiagnostic({
    checkerId: "python-ruff::.",
    language: "python",
    projectRoot: root,
    path: source,
    line: 4,
    column: 2,
    severity: "error",
    message: "\u001b[31minvalid\u001b[0m",
  });
  assert.equal(diagnostic?.path, "src/main.py");
  assert.equal(diagnostic?.message, "invalid");
  assert.equal(diagnostic?.severity, "error");
  assert.equal(normalizeDiagnostic({
    checkerId: "python-ruff::.",
    language: "python",
    projectRoot: root,
    path: path.join(path.dirname(root), "outside.py"),
    message: "outside",
  })?.path, null);
});

test("Python Ruff and mypy output becomes structured diagnostics", (t) => {
  const root = tempDirectory(t);
  const source = ensureFile(path.join(root, "src", "main.py"));
  const ruff = parseRuff(project(root), "python-ruff::.", JSON.stringify([{
    filename: source,
    location: { row: 3, column: 5 },
    end_location: { row: 3, column: 8 },
    code: "F401",
    message: "unused import",
  }]));
  assert.equal(ruff.length, 1);
  assert.deepEqual(
    { path: ruff[0].path, line: ruff[0].line, column: ruff[0].column, endLine: ruff[0].endLine, code: ruff[0].code },
    { path: "src/main.py", line: 3, column: 5, endLine: 3, code: "F401" },
  );

  const mypy = parseMypy(project(root), "python-mypy::.", `${source}:7:9: error: incompatible type [assignment]\n`);
  assert.equal(mypy.length, 1);
  assert.equal(mypy[0].severity, "error");
  assert.equal(mypy[0].code, "assignment");
  assert.equal(mypy[0].line, 7);
  assert.equal(mypy[0].column, 9);
});

test("Checkstyle XML output is decoded and file paths stay project-relative", (t) => {
  const root = tempDirectory(t);
  const source = ensureFile(path.join(root, "src", "Main.java"));
  const xml = `<checkstyle><file name="${source}"><error line="5" column="3" severity="warning" message="Use &quot;final&quot; &#x26; avoid tabs" source="com.puppycrawl.tools.checkstyle.checks.ModifierOrderCheck"/></file></checkstyle>`;
  const diagnostics = parseCheckstyle(project(root), "java-checkstyle::.", xml);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].path, "src/Main.java");
  assert.equal(diagnostics[0].line, 5);
  assert.equal(diagnostics[0].message, 'Use "final" & avoid tabs');
  assert.equal(diagnostics[0].code, "ModifierOrderCheck");
  assert.equal(decodeXmlAttribute("&lt;x&gt; &amp; &#65;"), "<x> & A");
});

test("C/C++ compilation database accepts only in-project source files", (t) => {
  const root = tempDirectory(t);
  const source = ensureFile(path.join(root, "src", "main.c"));
  const outsideRoot = tempDirectory(t);
  const outside = ensureFile(path.join(outsideRoot, "external.c"));
  const dbPath = ensureFile(path.join(root, "build", "compile_commands.json"), JSON.stringify([
    { directory: root, file: path.relative(root, source), command: "cc -c src/main.c" },
  ]));
  const context = project(root);
  assert.deepEqual(compileDatabase(context), {
    path: dbPath,
    directory: path.dirname(dbPath),
    sources: [source],
  });

  writeFileSync(dbPath, JSON.stringify([
    { directory: path.dirname(outside), file: path.basename(outside), command: "cc -c external.c" },
  ]));
  assert.equal(compileDatabase(context), null);
  assert.match(readFileSync(dbPath, "utf8"), /external\.c/);

  writeFileSync(dbPath, JSON.stringify([
    ...Array.from({ length: 120 }, () => ({ directory: outsideRoot, file: path.basename(outside), command: "cc -c external.c" })),
    { directory: root, file: path.relative(root, source), command: "cc -c src/main.c" },
  ]));
  assert.deepEqual(compileDatabase(context)?.sources, [source]);

  const diagnostics = parseClangTidy(
    context,
    "c-clang-tidy::.",
    `${source}:8:2: warning: prefer explicit return type [modernize-use-trailing-return-type]\n`,
  );
  assert.equal(diagnostics[0].path, "src/main.c");
  assert.equal(diagnostics[0].line, 8);
  assert.equal(diagnostics[0].code, "modernize-use-trailing-return-type");
});

test("Go vet and Cargo JSON output become structured diagnostics", (t) => {
  const root = tempDirectory(t);
  const goSource = ensureFile(path.join(root, "go", "main.go"));
  const rustSource = ensureFile(path.join(root, "rust", "src", "main.rs"));
  const goDiagnostics = parseGoVet(
    project(root),
    "go-vet::.",
    `${goSource}:12:4: printf call has arguments but no formatting directives\n`,
  );
  assert.equal(goDiagnostics.length, 1);
  assert.equal(goDiagnostics[0].path, "go/main.go");
  assert.equal(goDiagnostics[0].line, 12);
  assert.equal(goDiagnostics[0].severity, "warning");

  const cargoMessage = {
    reason: "compiler-message",
    message: {
      level: "warning",
      message: "unused variable",
      code: { code: "unused_variables" },
      spans: [{
        file_name: path.relative(root, rustSource),
        line_start: 2,
        column_start: 9,
        line_end: 2,
        column_end: 10,
        is_primary: true,
      }],
    },
  };
  const rustDiagnostics = parseCargoMessages(project(root), "rust-clippy::.", JSON.stringify(cargoMessage));
  assert.equal(rustDiagnostics.length, 1);
  assert.equal(rustDiagnostics[0].path, "rust/src/main.rs");
  assert.equal(rustDiagnostics[0].code, "unused_variables");
  assert.equal(rustDiagnostics[0].severity, "warning");
  assert.deepEqual(parseJsonLines(`${JSON.stringify(cargoMessage)}\nprogress text\n`), [cargoMessage]);
});

test("checker selections reject malformed values and duplicate IDs", () => {
  assert.deepEqual(validateCheckerIds(["python-ruff::."]), ["python-ruff::."]);
  assert.equal(validateCheckerIds(Array.from({ length: 20 }, (_, index) => `checker-${index}`)).length, 20);
  for (const invalid of [null, {}, [], [""], ["x", "x"], ["x".repeat(501)], Array.from({ length: 21 }, (_, index) => `checker-${index}`)]) {
    assert.equal(validateCheckerIds(invalid), null);
  }
});

test("language adapters build fixed offline/read-only commands", async (t) => {
  const root = tempDirectory(t);
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const executableName = process.platform === "win32" ? "cargo.exe" : "cargo";
  writeFileSync(path.join(bin, executableName), "");
  if (process.platform !== "win32") chmodSync(path.join(bin, executableName), 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = bin;
  try {
    const workspaceRoot = tempDirectory(t);
    ensureFile(path.join(workspaceRoot, "Cargo.toml"), "[workspace]\nmembers = []\n");
    const workspaceProject = project(workspaceRoot);
    workspaceProject.entries.add("Cargo.toml");
    const workspaceInvocation = await rustClippyAdapter.createInvocation(workspaceProject);
    assert.ok(workspaceInvocation.args.includes("--offline"));
    assert.ok(workspaceInvocation.args.includes("--locked"));
    assert.ok(workspaceInvocation.args.includes("--workspace"));
    assert.equal(workspaceInvocation.env.CARGO_NET_OFFLINE, "true");
    assert.equal(workspaceInvocation.cwd, workspaceRoot);

    const packageRoot = tempDirectory(t);
    ensureFile(path.join(packageRoot, "Cargo.toml"), "[package]\nname='sample'\nversion='0.1.0'\n");
    const packageProject = project(packageRoot);
    packageProject.entries.add("Cargo.toml");
    const packageInvocation = await rustClippyAdapter.createInvocation(packageProject);
    assert.equal(packageInvocation.args.includes("--workspace"), false);

    const goProjectRoot = tempDirectory(t);
    const goName = process.platform === "win32" ? "go.exe" : "go";
    writeFileSync(path.join(bin, goName), "");
    if (process.platform !== "win32") chmodSync(path.join(bin, goName), 0o755);
    ensureFile(path.join(goProjectRoot, "go.mod"), "module example.test/app\n");
    const goInvocation = await goVetAdapter.createInvocation(project(goProjectRoot));
    assert.deepEqual(goInvocation.args, ["vet", "-mod=readonly", "./..."]);
    assert.equal(goInvocation.env.GOPROXY, "off");
    assert.equal(goInvocation.env.GOSUMDB, "off");

    const pythonRoot = tempDirectory(t);
    const ruffName = process.platform === "win32" ? "ruff.exe" : "ruff";
    writeFileSync(path.join(bin, ruffName), "");
    if (process.platform !== "win32") chmodSync(path.join(bin, ruffName), 0o755);
    const pythonInvocation = await pythonRuffAdapter.createInvocation(project(pythonRoot));
    assert.deepEqual(pythonInvocation.args, ["check", "--output-format=json", "."]);
    assert.equal(pythonInvocation.args.includes("--fix"), false);
    assert.equal(pythonRuffAdapter.availability(project(pythonRoot)).note, undefined);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});

test("Python checker identifies a tool resolved from the workspace virtual environment", async (t) => {
  const root = tempDirectory(t);
  const localDirectory = process.platform === "win32"
    ? path.join(root, ".venv", "Scripts")
    : path.join(root, ".venv", "bin");
  const pathDirectory = path.join(root, "path-bin");
  const executableName = process.platform === "win32" ? "ruff.exe" : "ruff";
  const workspaceExecutable = ensureFile(path.join(localDirectory, executableName));
  const pathExecutable = ensureFile(path.join(pathDirectory, executableName));
  if (process.platform !== "win32") {
    chmodSync(workspaceExecutable, 0o755);
    chmodSync(pathExecutable, 0o755);
  }

  const originalPath = process.env.PATH;
  process.env.PATH = pathDirectory;
  try {
    const workspace = project(root);
    const availability = pythonRuffAdapter.availability(workspace);
    const invocation = await pythonRuffAdapter.createInvocation(workspace);
    assert.equal(
      process.platform === "win32" ? invocation.command.toLowerCase() : invocation.command,
      process.platform === "win32" ? workspaceExecutable.toLowerCase() : workspaceExecutable,
    );
    assert.equal(availability.note, "python.workspaceTool");
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});

test("opening a file from a checker updates or clears its previous line marker", () => {
  const initial = [{ id: "file:/workspace/a.py", label: "a.py", kind: "file", filePath: "/workspace/a.py", lineNumber: 9 }];
  const selectedLine = openFileTab(initial, "/workspace/a.py", "a.py", 4);
  assert.equal(selectedLine[0].lineNumber, 4);
  const openedNormally = openFileTab(selectedLine, "/workspace/a.py", "a.py");
  assert.equal(openedNormally[0].lineNumber, undefined);
  assert.equal(openedNormally[0].label, "a.py");
});

test("checker process captures output and uses an abortable timeout", async (t) => {
  const root = tempDirectory(t);
  const success = await runCheckerProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('checker-ok')"],
    cwd: root,
    timeoutMs: 2_000,
  });
  assert.equal(success.stdout, "checker-ok");
  assert.equal(success.exitCode, 0);
  assert.equal(success.timedOut, false);
  assert.equal(success.spawnError, false);

  const timedOut = await runCheckerProcess({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    cwd: root,
    timeoutMs: 30,
  });
  assert.equal(timedOut.timedOut, true);

  const controller = new AbortController();
  const pending = runCheckerProcess({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    cwd: root,
    timeoutMs: 2_000,
  }, controller.signal);
  controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.aborted, true);
});

test("checker process caps captured output and reports a missing executable", async (t) => {
  const root = tempDirectory(t);
  const truncated = await runCheckerProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(1024 * 1024 + 128 * 1024))"],
    cwd: root,
    timeoutMs: 2_000,
  });
  assert.equal(truncated.outputTruncated, true);
  assert.ok(Buffer.byteLength(truncated.stdout) + Buffer.byteLength(truncated.stderr) <= 1024 * 1024);

  const missing = await runCheckerProcess({
    command: path.join(root, "missing-checker-executable"),
    args: [],
    cwd: root,
    timeoutMs: 2_000,
  });
  assert.equal(missing.spawnError, true);
});

test("checker subprocess environment is restricted", async (t) => {
  const root = tempDirectory(t);
  const credentialNames = ["PI_WEB_ACCESS_TOKEN", "OPENAI_API_KEY", "DATABASE_URL"];
  const originalValues = new Map(credentialNames.map((name) => [name, process.env[name]]));
  for (const name of credentialNames) process.env[name] = "checker-test-value";
  try {
    const result = await runCheckerProcess({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write(JSON.stringify({path: Boolean(process.env.PATH), appToken: Object.hasOwn(process.env, 'PI_WEB_ACCESS_TOKEN'), modelKey: Object.hasOwn(process.env, 'OPENAI_API_KEY'), databaseUrl: Object.hasOwn(process.env, 'DATABASE_URL'), goflags: process.env.GOFLAGS}))",
      ],
      cwd: root,
      env: { GOFLAGS: "-mod=readonly" },
      timeoutMs: 2_000,
    });
    assert.equal(result.spawnError, false, result.stderr);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      path: true,
      appToken: false,
      modelKey: false,
      databaseUrl: false,
      goflags: "-mod=readonly",
    });
  } finally {
    for (const [name, value] of originalValues) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
