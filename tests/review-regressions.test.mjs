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
const { DEFAULT_THEME, applyTheme, xtermTheme } = await load("theme");
const service = { id: "web", name: "SecretApp", group: "SecretGroup", cwd: "/work/project",
  program: "node", args: [], sensitive: true };

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
