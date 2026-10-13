import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/tabDrag.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { tabDropTarget, tabEdgeScroll, attachTabDragging } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const rect = (left, right, top = 10, bottom = 40) => ({ left, right, top, bottom });
const geometry = [{ panelId: 'a', bounds: rect(0, 300), tabs: [rect(6, 150), rect(154, 298)] },
  { panelId: 'b', bounds: rect(310, 610), tabs: [rect(316, 460)] }];
test('tab positions include close buttons, gaps, both reorder directions and cross-panel append', () => {
  assert.equal(tabDropTarget(geometry, 10, 20).index, 0);
  assert.equal(tabDropTarget(geometry, 140, 20).index, 1);
  assert.equal(tabDropTarget(geometry, 152, 20).index, 1);
  assert.equal(tabDropTarget(geometry, 295, 20).index, 2);
  assert.deepEqual(tabDropTarget(geometry, 600, 20), { panelId: 'b', index: 1, x: 460, top: 10, height: 30 });
  assert.equal(tabDropTarget(geometry, 305, 20), null);
  assert.equal(tabDropTarget(geometry, 50, 41), null);
});
test('overflow geometry keeps original indices and clips the marker to the visible strip', () => {
  const strips = [{ panelId: 'a', bounds: rect(0, 160), tabs: [rect(-140, 4), rect(8, 152), rect(156, 300)] }];
  assert.equal(tabDropTarget(strips, 12, 20).index, 1);
  assert.equal(tabDropTarget(strips, 159, 20).index, 2);
  assert.equal(tabDropTarget([{ panelId: 'empty', bounds: rect(0, 160), tabs: [] }], 20, 20).index, 0);
  assert.equal(tabDropTarget([{ panelId: 'a', bounds: rect(0, 160), tabs: [rect(-100, 140)] }], 1, 20).x, 1);
});
test('edge scrolling stays inside a strip and stops away from the edges', () => {
  assert.ok(tabEdgeScroll(rect(0, 300), 5, 20) < 0);
  assert.ok(tabEdgeScroll(rect(0, 300), 295, 20) > 0);
  assert.equal(tabEdgeScroll(rect(0, 300), 150, 20), 0);
  assert.equal(tabEdgeScroll(rect(0, 300), 301, 20), 0);
  assert.equal(tabEdgeScroll(rect(0, 300), 5, 41), 0);
});

// Exercise the event controller as well as the geometry without a new DOM dependency.
function harness() {
  const win = new EventTarget();
  const frames = new Map();
  globalThis.window = win;
  globalThis.requestAnimationFrame = (fn) => { frames.set(frames.size + 1, fn); return frames.size; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const workspace = new EventTarget();
  const handle = { dataset: { tabDragHandle: 'service' }, captured: false,
    closest: () => handle, setPointerCapture() { this.captured = true; },
    hasPointerCapture() { return this.captured; }, releasePointerCapture() { this.captured = false; } };
  workspace.contains = (node) => node === handle;
  const strip = { dataset: { tabStrip: 'a' }, scrollLeft: 0, getBoundingClientRect: () => rect(0, 300),
    querySelectorAll: () => geometry[0].tabs.map((bounds) => ({ getBoundingClientRect: () => bounds })) };
  workspace.querySelectorAll = () => [strip];
  const changes = [], moves = [];
  const detach = attachTabDragging(workspace, (value) => changes.push(value), (...args) => {
    assert.equal(handle.captured, false, 'release capture before potentially removing source panel');
    moves.push(args);
  });
  const fire = (type, x = 30, y = 20, extra = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: y, ...extra });
    if (type === 'pointerdown') {
      win.dispatchEvent(event);
      Object.defineProperty(event, 'target', { value: handle });
      workspace.dispatchEvent(event);
    } else win.dispatchEvent(event);
    return event;
  };
  return { fire, detach, changes, moves, frames, handle };
}
test('ordinary clicks and sub-threshold movement do not move a tab', () => {
  const h = harness();
  h.fire('pointerdown'); h.fire('pointermove', 33); h.fire('pointerup', 33);
  assert.deepEqual(h.moves, []);
  assert.equal(h.fire('click').defaultPrevented, false);
  h.detach();
});
test('drag commits once using release position and suppresses its click', () => {
  const h = harness();
  h.fire('pointerdown'); h.fire('pointermove', 140); h.fire('pointerup', 295);
  h.fire('pointerup', 295);
  assert.deepEqual(h.moves, [['service', 'a', 2]]);
  assert.equal(h.fire('click').defaultPrevented, true);
  assert.equal(h.frames.size, 0);
  h.detach();
});
test('outside drops, Escape, pointer cancellation and blur never move or leave a drag running', () => {
  for (const action of ['outside', 'Escape', 'pointercancel', 'lostpointercapture', 'blur']) {
    const h = harness();
    h.fire('pointerdown'); h.fire('pointermove', 140);
    if (action === 'outside') h.fire('pointerup', 400);
    else if (action === 'Escape') h.fire('keydown', 0, 0, { key: 'Escape' });
    else h.fire(action);
    h.fire('pointerup', 140);
    assert.deepEqual(h.moves, [], action);
    assert.equal(h.frames.size, 0, action);
    assert.equal(h.handle.captured, false, action);
    assert.equal(h.changes.at(-1), null, action);
    assert.equal(h.fire('click', 0, 0, { detail: 0 }).defaultPrevented, false, 'keyboard clicks remain usable');
    // Cancellation must not eat a subsequent deliberate click.
    h.fire('pointerdown'); h.fire('pointerup');
    assert.equal(h.fire('click').defaultPrevented, false, action);
    h.detach();
  }
});
test('secondary and macOS control clicks do not initiate dragging; unmount cancels', () => {
  const h = harness();
  h.fire('pointerdown', 30, 20, { ctrlKey: true }); h.fire('pointermove', 140); h.fire('pointerup', 140);
  h.fire('pointerdown', 30, 20, { button: 2 }); h.fire('pointermove', 140); h.fire('pointerup', 140);
  assert.deepEqual(h.moves, []);
  h.fire('pointerdown'); h.fire('pointermove', 140); h.detach();
  assert.equal(h.frames.size, 0);
  assert.equal(h.handle.captured, false);
  h.fire('pointerup', 140);
  assert.deepEqual(h.moves, []);
});
