import { mkdir, writeFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const id = 'com.diethos.muxly.interactiontest';
const base = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
  : process.platform === 'win32' && process.env.APPDATA ? process.env.APPDATA : null;
if (!base) throw new Error('This fixture supports macOS and Windows only.');
const dir = join(base, id);
for (const file of ['services.json', 'settings.json']) {
  try { await access(join(dir, file)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  throw new Error(`Existing QA configuration: ${join(dir, file)}. Archive it before preparing a fresh run.`);
}
await mkdir(join(dir, 'workspace'), { recursive: true });
const services = Array.from({length: 18}, (_, index) => ({
  id: `interaction-${index + 1}`,
  name: `QA ${String(index + 1).padStart(2, '0')} interaction service`,
  program: process.execPath,
  args: ['-e', 'for(let i=1;i<=120;i++) console.log("QA searchable line "+i); setInterval(()=>{},1000)'],
  cwd: join(dir, 'workspace'), env: {}, port: null,
  group: index < 12 ? 'Interaction QA' : 'Overflow QA',
  usePty: index === 1
}));
const panels = [
  { id: 'qa-panel-a', tabIds: services.slice(0, 8).map(s => s.id), activeTabId: services[0].id },
  { id: 'qa-panel-b', tabIds: [services[8].id], activeTabId: services[8].id }
];
await writeFile(join(dir, 'services.json'), JSON.stringify(services, null, 2) + '\n', { flag: 'wx' });
await writeFile(join(dir, 'settings.json'), JSON.stringify({
  openServicesInTabs: true, workspacePanels: panels,
  openPaneIds: panels.flatMap(p => p.tabIds), focusedPanelId: panels[0].id,
  focusedPaneId: services[0].id, paneGridColumns: 2,
  profiles: [], activeProfile: null
}, null, 2) + '\n', { flag: 'wx' });
console.log(`Prepared isolated QA configuration: ${dir}`);
