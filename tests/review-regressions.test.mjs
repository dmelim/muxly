import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Use the existing compiler to load pure TS modules without adding a runner
// dependency or requiring Node's experimental TypeScript support.
const modules = new Map();
async function moduleUrl(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  let { outputText } = ts.transpileModule(await readFile(url, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  });
  const imports = [...outputText.matchAll(/from "(\.\/[^"\n]+)"/g)];
  for (const [, specifier] of imports) {
    const dependency = await moduleUrl(new URL(`${specifier}.ts`, url));
    outputText = outputText.replaceAll(`from "${specifier}"`, `from "${dependency}"`);
  }
  const result = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  modules.set(url.href, result);
  return result;
}
const load = async (file) => import(await moduleUrl(new URL(`../src/${file}.ts`, import.meta.url)));
const { redactSensitive } = await load("types");
const { LogSearchCache } = await load("logSearchCache");
const { DEFAULT_THEME, applyTheme, xtermTheme } = await load("theme");
const service = { id: "web", name: "SecretApp", group: "SecretGroup", cwd: "/work/project",
  program: "node", args: [], sensitive: true };

test("POSIX redaction keeps basenames at different offsets and URL spans", () => {
  for (const prefix of ["", "command: ", "path=", "("]) {
    assert.equal(redactSensitive(`${prefix}/opt/tools/node`, service, "masked", true),
      `${prefix}/masked/node`);
  }
  const url = "http://localhost:3000/assets/icon.svg";
  assert.equal(redactSensitive(url, service, "masked", true), url);
  assert.equal(redactSensitive('/opt/tools/node', service, "", true), "/private-project/node");
});

test("quoted and already-redacted paths retain complete filenames", () => {
  assert.equal(redactSensitive('"/opt/private/my tool"', service, "masked", true),
    '"/masked/my tool"');
  assert.equal(redactSensitive('/masked/node', service, "masked", true), '/masked/node');
  assert.equal(redactSensitive('/work/private/deep/node', service, "masked", true), '/masked/node');
  assert.equal(redactSensitive('/work/project', service, "masked", true), '/masked');
  assert.equal(redactSensitive('C:\\Users\\private\\node.exe', service, "masked", true),
    'C:\\masked\\node.exe');
  assert.equal(redactSensitive('/opt/tools/node', service, "masked", false), '/opt/tools/node');
});

test("search reuses results and prepared text until a bounded buffer changes", () => {
  const cache = new LogSearchCache();
  const chunks = ["ready\n", "error one\n"];
  let joins = 0;
  chunks.join = function (...args) { joins += 1; return Array.prototype.join.apply(this, args); };
  const first = cache.search(service, chunks, 1, "error", "masked", false);
  assert.equal(first.total, 1);
  assert.equal(cache.search(service, chunks, 1, "error", "masked", false), first);
  assert.equal(cache.search(service, chunks, 1, "ready", "masked", false).total, 1);
  assert.equal(joins, 1);
  chunks.splice(0, 2, "error two\n", "error three\n");
  assert.equal(cache.search(service, chunks, 2, "error", "masked", false).total, 2);
  assert.equal(joins, 2);
  assert.equal(cache.search(service, [], 3, "error", "masked", false).total, 0);
});

test("search invalidates cached sensitive text when privacy or aliases change", () => {
  const cache = new LogSearchCache();
  const chunks = ["SecretApp /opt/tools/node\n"];
  assert.equal(cache.search(service, chunks, 1, "SecretApp", "masked", false).total, 1);
  assert.equal(cache.search(service, chunks, 1, "SecretApp", "masked", true).total, 0);
  const privateResult = cache.search(service, chunks, 1, "node", "masked", true);
  assert.equal(privateResult.hits[0].line, "masked /masked/node");
  assert.equal(cache.search(service, chunks, 1, "node", "other", true).hits[0].line,
    "other /other/node");
  cache.retain(new Set());
  assert.notEqual(cache.search(service, chunks, 1, "node", "masked", true), privateResult);
});

test("running status is independent of accent and terminals share the palette", () => {
  const properties = new Map();
  globalThis.document = { documentElement: { style: { setProperty: (key, value) => properties.set(key, value) } } };
  try {
    const theme = { ...DEFAULT_THEME, running: "#123456", accent: "#abcdef",
      terminalForeground: "#fedcba", terminalCursor: "#112233" };
    applyTheme(theme);
    assert.equal(properties.get("--muxly-status-running"), "#123456");
    assert.equal(properties.get("--color-cyan-400"), "#abcdef");
    const terminal = xtermTheme(theme);
    assert.equal(terminal.green, "#123456");
    assert.equal(terminal.cyan, "#abcdef");
    assert.equal(terminal.foreground, "#fedcba");
    assert.equal(terminal.cursor, "#112233");
  } finally { delete globalThis.document; }
});

const { createTaskQueue, mirrorBootTheme } = await load("startup");

test("startup queue bounds overlapping batches and releases failed slots", async () => {
  const run = createTaskQueue(2);
  let active = 0;
  let maximum = 0;
  const releases = [];
  const jobs = Array.from({ length: 6 }, (_, index) => run(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => releases.push(resolve));
    active -= 1;
    if (index === 1) throw new Error("probe failed");
    return index;
  }));
  const resultsPromise = Promise.allSettled(jobs);
  for (let batch = 0; batch < 3; batch += 1) {
    assert.equal(active, 2);
    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setImmediate(resolve));
  }
  const results = await resultsPromise;
  assert.equal(maximum, 2);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(await run(async () => "ready"), "ready");
  assert.throws(() => createTaskQueue(0));
});

test("boot theme mirrors only display colours and tolerates unavailable storage", () => {
  const properties = new Map();
  let saved;
  globalThis.document = { documentElement: { style: { setProperty: (key, value) => properties.set(key, value) } } };
  globalThis.localStorage = { setItem: (key, value) => { saved = [key, JSON.parse(value)]; } };
  try {
    mirrorBootTheme(DEFAULT_THEME);
    assert.equal(saved[0], "muxly.boot-theme");
    assert.deepEqual(Object.keys(saved[1]).sort(), ["accent", "background", "border", "foreground", "muted"]);
    assert.equal(properties.get("--boot-background"), DEFAULT_THEME.appBackground);
    globalThis.localStorage.setItem = () => { throw new Error("storage disabled"); };
    assert.doesNotThrow(() => mirrorBootTheme(DEFAULT_THEME));
  } finally { delete globalThis.document; delete globalThis.localStorage; }
});
