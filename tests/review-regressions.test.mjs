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
