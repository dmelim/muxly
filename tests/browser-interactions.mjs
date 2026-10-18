import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
// Use an existing Playwright runtime; no browser or package installation is performed.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const dir = await mkdtemp(root + '/.interaction-check-');
let server, browser;
try {
  await writeFile(dir + '/index.html', '<html><body><div id="root"></div><script type="module" src="./main.jsx"></script></body></html>');
  await writeFile(dir + '/main.jsx', `
import React, { useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ServicesSidebar } from '/src/ServicesSidebar';
import { ConfirmDialog } from '/src/ConfirmDialog';
import { ContextMenu } from '/src/ContextMenu';
import { DEFAULT_SETTINGS } from '/src/appUtils';
import { hasOwnContextMenu } from '/src/inputEvents';
import { PaneSearchBar } from '/src/TerminalPanes';
import { auditLayout } from '/src/layoutAudit';
import '/src/styles.css';
const noop = () => {};
const service = { id: 'demo', name: 'Demo', program: 'echo', args: ['demo'], cwd: '/tmp' };
const props = {
 open: true, visible: true, onToggle: noop, managerMessage: '', compact: false, modKey: 'Cmd',
 groupedServices: [['Demo group', [service]]], allProjectNames: ['Demo group'], statuses: {},
 collapsedGroups: {}, settings: DEFAULT_SETTINGS, streamMode: false, projectNameAliases: {},
 redactStreamOutput: x => x, profiles: [], activeProfile: null, setActiveProfile: noop,
 runningElsewhere: [], profileActivity: {global:0, byProfile:{}}, serviceQuery:'', setServiceQuery:noop,
 dropIndicator:null, dragId:null, dragIdRef:{current:null}, dragGroup:null, dragGroupRef:{current:null},
 paneIds:[], portConflicts:{}, selected:null, iconImages:{}, displayProjectName:x=>x, maskName:s=>s.name,
 setDropIndicator:noop, setEditing:noop, toggleGroupCollapsed:noop, toggleProjectPinned:noop,
 toggleProjectNamePrivacy:noop, startGroup:noop, stopGroup:noop, beginDrag:noop, endDrag:noop,
 reorderService:noop, beginGroupDrag:noop, endGroupDrag:noop, reorderGroup:noop,
 onServiceMenuAction:noop, onGroupMenuAction:noop, onDeleteService:noop
};
// Sidebar + pane stand-in for layout sweeps: the pane clips like the real one,
// and the sidebar button must stay clickable whatever the pane width.
let emitResults = noop;
const fakeSearchAddon = {
 onDidChangeResults: cb => { emitResults = cb; return { dispose: noop }; },
 findNext: noop, findPrevious: noop, clearDecorations: noop
};
function LayoutFixture() {
 const [paneWidth,setPaneWidth] = useState(640);
 window.setPaneWidth = setPaneWidth;
 return <div id="layout-fixture" style={{position:'fixed',left:400,top:320,height:240,display:'flex',background:'#111'}}>
  <div style={{width:160,padding:8}}><button id="sidebar-control">Sidebar control</button></div>
  <div id="layout-pane" className="relative overflow-hidden" style={{width:paneWidth}}>
   <PaneSearchBar searchAddon={fakeSearchAddon} closing={false} seed={{query:'searchable',nonce:1}} onClose={noop}/>
  </div>
 </div>;
}
window.emitSearchResults = event => emitResults(event);
window.layoutIssues = () => auditLayout(document.querySelector('#layout-fixture')).map(i => i.kind + ': ' + i.detail);
function App() {
 const [normal,setNormal] = useState(0), [split,setSplit] = useState(0), [confirmed,setConfirmed] = useState(0), [cancelled,setCancelled] = useState(0);
 const [dialog,setDialog] = useState(false), [menu,setMenu] = useState(false), [action,setAction] = useState(0);
 const trigger = useRef(null);
 return <><output id="counts">{JSON.stringify({normal,split,confirmed,cancelled,action})}</output>
 <button id="dialog" onClick={()=>setDialog(true)}>Show dialog</button>
 <button id="trigger" ref={trigger} onClick={()=>setNormal(n=>n+1)} onContextMenu={e=>{e.preventDefault();setMenu(true);}}>Menu trigger</button>
 <div style={{width:360,height:700}}><ServicesSidebar {...props} openService={()=>setNormal(n=>n+1)} openInSplit={()=>setSplit(n=>n+1)}/></div>
 {dialog && <ConfirmDialog title="Test confirmation" message="Test" onConfirm={()=>{setConfirmed(n=>n+1);setDialog(false)}} onClose={()=>{setCancelled(n=>n+1);setDialog(false)}}/>}
 {menu && <ContextMenu x={450} y={80} restoreFocusRef={trigger} onClose={()=>setMenu(false)} items={[
 {id:'one',label:'First action',action:()=>setAction(n=>n+1)},
 {id:'sub',label:'Submenu',children:[{id:'child',label:'Child action',action:()=>setAction(n=>n+1)}]}
 ]}/>}
 <div id="targets"><input/><textarea/><textarea className="xterm-helper-textarea"/><div contentEditable/><div role="menu"><button>Menu item</button></div><div className="terminal"/></div>
 <output id="ownership">{''}</output>
 <LayoutFixture/>
 </>;
}
createRoot(document.getElementById('root')).render(<App/>);
window.checkOwnership = () => Array.from(document.querySelector('#targets').children).map(hasOwnContextMenu);
`);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 5189, strictPort: true } });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    Element.prototype.requestPointerLock = () => Promise.resolve();
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0] + dir.split('/').at(-1) + '/index.html');
  await page.locator('#counts').waitFor();
  const counts = async () => JSON.parse(await page.locator('#counts').textContent());
  for (const label of ['Reorder Demo group', 'Collapse Demo group', 'Pin project Demo group']) {
    const button = page.getByRole('button', { name: label, exact: true });
    await button.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Start All', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await button.evaluate(el => el === document.activeElement), true, label);
  }
  const groupButton = page.getByRole('button', { name: 'Collapse Demo group', exact: true });
  await groupButton.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Start All', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await groupButton.evaluate(el => el === document.activeElement), true);
  console.log('PASS group menu Escape restores the initiating keyboard or pointer control');
  for (const key of ['Enter', 'Space']) {
    await page.getByRole('button', { name: 'Open Demo in a new panel', exact: true }).focus();
    await page.keyboard.press(key);
  }
  assert.equal((await counts()).split, 2);
  assert.equal((await counts()).normal, 0);
  console.log('PASS nested split button: Enter and Space only open in split');
  const card = page.locator('[role="button"][draggable="true"]');
  await card.focus();
  await page.keyboard.press('Enter');
  assert.equal((await counts()).normal, 1);
  console.log('PASS service card keyboard activation');
  await card.focus();
  await page.keyboard.down('ContextMenu');
  const openMenus = page.locator('[role="menu"][tabindex="-1"]');
  await openMenus.waitFor();
  await page.keyboard.up('ContextMenu');
  // Observe cancellation directly: headless Chromium cannot expose WebView2's
  // native menu UI, but these events must be cancelled before it can open.
  const checkMenuDefaults = async () => openMenus.first().evaluate(menu => {
    const target = menu.querySelector('[role="menuitem"]') ?? menu;
    return [
      new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }),
      new KeyboardEvent('keyup', { key: 'ContextMenu', bubbles: true, cancelable: true }),
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    ].map(event => { target.dispatchEvent(event); return event.defaultPrevented; });
  });
  assert.deepEqual(await checkMenuDefaults(), [true, true, true, true]);
  await page.keyboard.press('Shift+F10');
  assert.equal(await openMenus.count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await openMenus.count(), 0);
  assert.equal(await card.evaluate(el => el === document.activeElement), true);
  console.log('PASS Menu-key release and repeated Shift+F10 cancel native defaults, with one Escape to close');
  await page.locator('#dialog').click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal((await counts()).cancelled, 1);
  assert.equal((await counts()).confirmed, 0);
  await page.locator('#dialog').click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal((await counts()).confirmed, 1);
  console.log('PASS Cancel and Confirm activate the focused button exactly once');
  await page.locator('#trigger').dispatchEvent('contextmenu', { button: 0, ctrlKey: true });
  await page.getByRole('menuitem', { name: 'First action', exact: true }).waitFor();
  assert.deepEqual(await checkMenuDefaults(), [true, true, true, true]);
  await page.locator('#trigger').dispatchEvent('click', { button: 0, detail: 1 });
  assert.equal((await counts()).normal, 1);
  assert.equal(await page.getByRole('menuitem', { name: 'First action', exact: true }).count(), 1);
  await page.getByRole('menuitem', { name: 'First action', exact: true }).click();
  assert.equal((await counts()).action, 1);
  console.log('PASS opening release ignored and subsequent menu click activates');
  await page.locator('#trigger').dispatchEvent('contextmenu', { button: 2 });
  await page.getByRole('menuitem', { name: 'First action', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#trigger').evaluate(el => el === document.activeElement), true);
  assert.deepEqual(await page.evaluate(() => window.checkOwnership()), [true,true,false,true,true,false]);
  console.log('PASS Escape focus restoration and context-menu ownership');
  // Width sweep: floating UI must stay inside its pane and never cover a
  // neighbouring control, from the narrowest usable pane to a wide one.
  const bar = page.locator('#layout-pane > :first-child');
  await page.evaluate(() => window.emitSearchResults({ resultIndex: 998, resultCount: 1000 }));
  for (const width of [160, 220, 300, 420, 640]) {
    await page.evaluate(w => window.setPaneWidth(w), width);
    await page.waitForTimeout(200); // let the 150 ms entrance animation settle
    const [paneBox, barBox] = await Promise.all([page.locator('#layout-pane').boundingBox(), bar.boundingBox()]);
    assert.ok(barBox.x >= paneBox.x && barBox.x + barBox.width <= paneBox.x + paneBox.width, `search bar fits a ${width}px pane`);
    assert.deepEqual(await page.evaluate(() => window.layoutIssues()), [], `layout issues at ${width}px`);
  }
  // Prove the audit catches the original regression: an unbounded bar.
  await bar.evaluate(el => { el.style.maxWidth = 'none'; });
  await page.evaluate(() => window.setPaneWidth(160));
  await page.waitForTimeout(50);
  assert.ok((await page.evaluate(() => window.layoutIssues())).some(issue => issue.startsWith('clipped:')));
  await bar.evaluate(el => { el.style.maxWidth = ''; });
  console.log('PASS pane search stays inside its pane across a width sweep');
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await server?.close();
  await rm(dir, { recursive:true, force:true });
}
