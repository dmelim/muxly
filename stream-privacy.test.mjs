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
const { findRedactions, fitMaskLabel, maskedSelectionText } = await load("streamMasks");
const { redactStreamText, redactStreamWorkspaceText } = await load("types");
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
const applyRanges = (text, ranges) => {
  let out = "";
  let last = 0;
  for (const range of ranges) {
    out += text.slice(last, range.start) + range.label;
    last = range.end;
  }
  return out + text.slice(last);
};

const workspace = [{ ...service, group: "acme-portal" }];
const redactors = {
  generic: (text) => redactStreamText(text, true),
  workspace: (text) => redactStreamWorkspaceText(text, workspace, { "acme-portal": "blue-fox" }, { "acme-portal": true }, true)
};
const lines = [
  "  ➜  Local:   http://localhost:3000/",
  "GET https://api.example.com/v1/users?id=7 200",
  "Serving C:\\Users\\QASecret\\private\\file.txt now",
  "error in /home/qasecret/app/src/index.ts:12:4",
  "mail me at someone@example.com or ~/notes/todo.md",
  "[SecretApp] ready — acme-portal built in 120ms",
  "opening \"C:\\Program Files\\Tool\\tool.exe\" with C:/Users/QASecret/x",
  "ordinary log line with nothing private",
  "rapid api QASecret QASecretX acme-portal-ui"
];

test("mask ranges reproduce the redacted text exactly", () => {
  for (const [name, redact] of Object.entries(redactors)) {
    for (const line of lines) {
      const ranges = findRedactions(line, redact);
      assert.equal(applyRanges(line, ranges), redact(line), `${name}: ${line}`);
      for (const range of ranges) assert.ok(range.end > range.start, `${name}: empty range in ${line}`);
    }
  }
});

test("masks hide every private value and leave public text visible", () => {
  const line = "Serving C:\\Users\\QASecret\\private\\file.txt now";
  const ranges = findRedactions(line, redactors.generic);
  assert.deepEqual(ranges, [{ start: 8, end: 42, label: "[private path]" }]);
  const visible = applyRanges(line, ranges.map((range) => ({ ...range, label: "" })));
  assert.equal(visible, "Serving  now");
  assert.deepEqual(findRedactions("ordinary log line", redactors.generic), []);
});

test("an untrackable or failing redactor fails closed", () => {
  const untracked = (text) => String(text).trim().replace("QASecret", "[x]");
  assert.deepEqual(findRedactions("hi QASecret there", untracked), [{ start: 3, end: 11, label: "[x]" }]);
  const throwing = () => { throw new Error("boom"); };
  assert.deepEqual(findRedactions("QASecret", throwing), [{ start: 0, end: 8, label: "[hidden]" }]);
});

test("ranges use UTF-16 offsets around emoji and other astral characters", () => {
  const unicodeLines = [
    "😀 contact someone@example.com done",
    "done someone@example.com 😀",
    "👩‍💻 C:\\Users\\QASecret\\😀\\file.txt 🎉",
    "😀😀 QASecret 😀😀"
  ];
  for (const [name, redact] of Object.entries(redactors)) {
    for (const line of unicodeLines) {
      assert.equal(applyRanges(line, findRedactions(line, redact)), redact(line), `${name}: ${line}`);
    }
  }
  const line = "😀 contact someone@example.com done";
  assert.deepEqual(findRedactions(line, redactors.generic), [{ start: 11, end: 30, label: "[email]" }]);
  // A replacement sharing only half of a surrogate pair must not keep that half.
  const emojiSwap = (text) => text.replace("😀", "😃");
  assert.deepEqual(findRedactions("a😀b", emojiSwap), [{ start: 1, end: 3, label: "😃" }]);
});

// One cell per UTF-16 code point, all on row 0, like readLogicalLine produces.
const logicalLine = (text) => {
  const cells = [];
  let offset = 0;
  for (const char of text) {
    cells.push({ row: 0, column: cells.length, width: 1, start: offset, end: offset + char.length });
    offset += char.length;
  }
  return { text, cells, nextRow: 1 };
};
const selectColumns = (from, to) => (row, column) => row === 0 && column >= from && column < to;

test("copying part of a masked value copies its label, not the fragment", () => {
  const text = "open /home/random-user/quarterly-plan/report.txt now";
  const line = logicalLine(text);
  const ranges = findRedactions(text, redactors.generic);
  assert.ok(ranges.length > 0);
  const from = text.indexOf("quarterly-plan");
  const fragment = maskedSelectionText(line, ranges, selectColumns(from, from + "quarterly-plan".length));
  assert.ok(!fragment.includes("quarterly"), fragment);
  assert.equal(fragment, ranges[0].label);
  assert.equal(maskedSelectionText(line, ranges, selectColumns(0, text.length)), redactors.generic(text));
  assert.equal(maskedSelectionText(line, ranges, selectColumns(0, 4)), "open");
  assert.equal(maskedSelectionText(line, [], selectColumns(from, from + 9)), "quarterly");
});

test("mask labels fit their cells", () => {
  assert.equal(fitMaskLabel("[private path]", 20), "[private path]");
  assert.equal(fitMaskLabel("[private path]", 6), "[priv…");
  assert.equal(fitMaskLabel("[private path]", 1), "…");
});
