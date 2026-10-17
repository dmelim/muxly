import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/contextMenuOpeningClick.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { suppressContextMenuOpeningClick } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('opening release cannot activate the trigger or menu; a fresh click can', () => {
  const target = new EventTarget();
  const cleanup = suppressContextMenuOpeningClick(target);
  let activations = 0;
  target.addEventListener('click', () => activations++);
  const click = (detail = 1) => {
    const event = new Event('click', { cancelable: true });
    Object.assign(event, { detail });
    target.dispatchEvent(event);
    return event;
  };
  // Control may already be released by the time the click arrives.
  target.dispatchEvent(new Event('pointerup'));
  assert.equal(click().defaultPrevented, true);
  assert.equal(activations, 0);
  assert.equal(click(0).defaultPrevented, false, 'keyboard activation stays available');
  target.dispatchEvent(new Event('pointerdown'));
  target.dispatchEvent(new Event('pointerup'));
  assert.equal(click().defaultPrevented, false);
  assert.equal(activations, 2);
  cleanup();
});

test('closing the menu removes the opening gesture guard', () => {
  const target = new EventTarget();
  const cleanup = suppressContextMenuOpeningClick(target);
  cleanup();
  const event = new Event('click', { cancelable: true });
  Object.assign(event, { detail: 1 });
  target.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

const inputSource = await readFile(new URL('../src/inputEvents.ts', import.meta.url), 'utf8');
const inputJs = ts.transpileModule(inputSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { isPrimaryPress } = await import(`data:text/javascript;base64,${Buffer.from(inputJs).toString('base64')}`);

test('resize and scrollbar gestures reject secondary clicks and macOS Control-click', () => {
  for (const mac of [true, false]) {
    assert.equal(isPrimaryPress({ button: 0, ctrlKey: false }, mac), true);
    for (const button of [1, 2]) {
      assert.equal(isPrimaryPress({ button, ctrlKey: false }, mac), false);
      assert.equal(isPrimaryPress({ button, ctrlKey: true }, mac), false);
    }
  }
  assert.equal(isPrimaryPress({ button: 0, ctrlKey: true }, true), false);
  assert.equal(isPrimaryPress({ button: 0, ctrlKey: true }, false), true);
});
