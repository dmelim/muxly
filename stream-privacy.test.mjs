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
const load = async (file) => import(await moduleUrl(new URL(`./src/${file}.ts`, import.meta.url)));

const { StreamLogSearchCache } = await load("streamLogSearchCache");
const { isServiceOutputHidden, setTerminalConcealed } = await load("streamPrivacy");
const service = { id: "private", name: "SecretApp", cwd: "C:\\Users\\QASecret", program: "node", args: [], sensitive: true };
test("sensitive search excludes all chunk splits, cached hits and cursor-positioned fragments", () => {
  for (const raw of ["C:\\Users\\QASecret\\private\\file.txt\r\n", "C:\\Users\r\n\x1b[2;1HQASecret\\private\\file.txt"]) {
    for (let split = 0; split <= raw.length; split++) {
      const cache = new StreamLogSearchCache();
      const chunks = [raw.slice(0, split), raw.slice(split)];
      assert.ok(cache.search(service, chunks, 1, "QASecret", "alias", false).total > 0);
      const hidden = cache.search(service, chunks, 1, "QASecret", "alias", true);
      assert.equal(hidden.total, 0);
      assert.deepEqual(hidden.hits, []);
      assert.ok(cache.search(service, chunks, 1, "QASecret", "alias", false).total > 0);
    }
  }
});
test("sensitivity changes invalidate public search and public logs remain searchable", () => {
  const cache = new StreamLogSearchCache();
  const chunks = ["QASecret"];
  const publicService = { ...service, sensitive: false };
  assert.ok(cache.search(publicService, chunks, 2, "QASecret", "alias", true).total > 0);
  assert.equal(cache.search(service, chunks, 2, "QASecret", "alias", true).total, 0);
  cache.retain(new Set());
  assert.ok(cache.search(publicService, chunks, 2, "QASecret", "alias", true).total > 0);
});
test("concealment revokes selection and input without touching parser state", () => {
  const calls = [];
  const terminal = { options: {}, clearSelection() { calls.push("clear"); }, blur() { calls.push("blur"); } };
  setTerminalConcealed(terminal, true);
  assert.equal(terminal.options.disableStdin, true);
  assert.deepEqual(calls, ["clear", "blur"]);
  setTerminalConcealed(terminal, false);
  assert.equal(terminal.options.disableStdin, false);
  assert.deepEqual(calls, ["clear", "blur"]);
  assert.equal(isServiceOutputHidden(service, true), true);
  assert.equal(isServiceOutputHidden(service, false), false);
  assert.equal(isServiceOutputHidden({}, true), false);
});
