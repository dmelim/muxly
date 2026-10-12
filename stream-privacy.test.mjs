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
const { findRedactions, fitMaskLabel, maskSpans, maskedSelectionText, readMaskedLogicalLine } = await load("streamMasks");
const { handleTerminalCopyKey } = await load("terminalCopy");
const { redactStreamText, redactStreamWorkspaceText, redactSensitive } = await load("types");
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

test("masks widen on rows where joined emoji can shift the drawn text", () => {
  const range = { start: 0, end: 0, label: "[private path]" };
  const plain = logicalLine("x /home/random-user/notes.md ok");
  const plainRange = { ...range, ...findRedactions(plain.text, redactors.generic)[0] };
  assert.deepEqual([...maskSpans(plain, plainRange, 80)], [[0, { start: 2, end: 28 }]]);
  // A lone astral emoji is drawn to fit its cell; only multi-code-point cells drift.
  const astral = logicalLine("😀 /home/random-user/notes.md ok");
  const astralRange = { ...range, ...findRedactions(astral.text, redactors.generic)[0] };
  assert.deepEqual([...maskSpans(astral, astralRange, 80)], [[0, { start: 2, end: 28 }]]);
  // xterm puts a ZWJ in the cell before it, so "👩‍💻" is two cells: "👩‍" and "💻".
  const text = "👩‍💻 /home/random-user/notes.md ok";
  const cells = [{ row: 0, column: 0, width: 1, start: 0, end: 3 }, { row: 0, column: 1, width: 1, start: 3, end: 5 }];
  for (let offset = 5, column = 2; offset < text.length; offset += 1, column += 1) {
    cells.push({ row: 0, column, width: 1, start: offset, end: offset + 1 });
  }
  const joined = { text, cells, nextRow: 1 };
  const joinedRange = findRedactions(text, redactors.generic)[0];
  assert.deepEqual([...maskSpans(joined, joinedRange, 80)], [[0, { start: 0, end: 32 }]]);
  assert.deepEqual([...maskSpans(joined, joinedRange, 29)], [[0, { start: 0, end: 29 }]]);
});

test("mask labels fit their cells", () => {
  assert.equal(fitMaskLabel("[private path]", 20), "[private path]");
  assert.equal(fitMaskLabel("[private path]", 6), "[priv…");
  assert.equal(fitMaskLabel("[private path]", 1), "…");
});

test("host hard wraps keep Unicode path suffixes masked in display and partial copies", () => {
  const prefix = "Long path: C:\\Users\\Example Person\\Documents\\very-long-folder-name\\another-long-folder-name\\yet-another-folder\\café\\";
  const suffix = "漢字\\project.txt PUBLIC-END";
  const makeTerminal = (rows, cols) => ({ cols, buffer: { active: {
    length: rows.length,
    getLine: (row) => rows[row] === undefined ? undefined : {
      isWrapped: false,
      translateToString: () => rows[row],
      getCell: (column) => ({ getChars: () => rows[row][column] ?? "", getWidth: () => row === 1 && column === 0 ? 2 : 1 })
    }
  } } });
  const rangesFor = (text) => findRedactions(text, redactors.generic);
  for (const cols of [prefix.length, prefix.length + 1]) {
    const line = readMaskedLogicalLine(makeTerminal([prefix, suffix], cols), 0, rangesFor);
    const ranges = rangesFor(line.text);
    assert.equal(line.nextRow, 2);
    assert.equal(maskedSelectionText(line, ranges, (row) => row === 1), "[private path] PUBLIC-END");
    assert.equal(maskedSelectionText(line, ranges, (row, column) => row === 1 && column < 2), "[private path]");
    const spans = maskSpans(line, ranges[0], cols);
    assert.equal(spans.get(1).start, 0);
    assert.equal(spans.get(1).end, "漢字\\project.txt".length);
  }
  assert.equal(readMaskedLogicalLine(makeTerminal([prefix, suffix], prefix.length + 5), 0, rangesFor).nextRow, 1);
  assert.equal(readMaskedLogicalLine(makeTerminal([prefix, "ordinary public sentence"], prefix.length), 0, rangesFor).nextRow, 1);
});

test("aliases containing spaces cannot expose the tail of an absolute path", () => {
  const text = "open C:\\Users\\Example Person\\Documents\\café\\漢字\\project.txt done";
  const services = [{ ...service, name: "café", cwd: "C:\\Users\\Example Person\\Documents\\café", group: "private" }];
  const redact = (value) => redactStreamWorkspaceText(value, services, { private: "public alias" }, {}, true);
  assert.equal(redact(text), "open [private path] done");
  assert.equal(applyRanges(text, findRedactions(text, redact)), "open [private path] done");
  const spaced = { ...service, name: "db", cwd: "C:\\Private Folder\\secret", group: "private" };
  const raw = "open C:\\Private Folder\\secret\\db\\漢字\\report.txt done";
  assert.equal(redactSensitive(raw, spaced, "public alias", true), "open [private path] done");
  assert.equal(redactStreamWorkspaceText(raw, [spaced], { private: "public alias" }, {}, true), "open [private path] done");
});

test("selected Ctrl+C and Ctrl+Shift+C copy without forwarding an interrupt", () => {
  for (const shiftKey of [false, true]) {
    for (const selected of [false, true]) {
      const calls = [];
      const event = { key: "c", ctrlKey: true, metaKey: false, altKey: false, shiftKey,
        stopPropagation: () => calls.push("stop"), preventDefault: () => calls.push("prevent") };
      const handled = handleTerminalCopyKey(event, selected, () => { calls.push("copy"); return true; });
      if (!handled) calls.push("pty");
      else if (!shiftKey) calls.push("native-copy");
      assert.deepEqual(calls, selected ? (shiftKey ? ["stop", "prevent", "copy"] : ["stop", "native-copy"]) : ["pty"]);
    }
  }
});
