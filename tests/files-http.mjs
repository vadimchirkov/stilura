import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Workspace files over HTTP: a rename or a deletion carries the document's
// notes and history with it, never overwrites another file, keeps the home
// draft in place, and a deleted file comes back from .trash/.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-files-'));
const draft = path.join(directory, 'draft.md');
fs.writeFileSync(draft, 'Home draft.\n');
const a = path.join(directory, 'a.md');
fs.writeFileSync(a, 'Text of A.\n');
fs.writeFileSync(`${a}.stilura-notes.json`, JSON.stringify({ notes: [{ id: 'n1', text: 'Note on A' }] }));
fs.mkdirSync(`${a}.stilura-history`);
fs.writeFileSync(path.join(`${a}.stilura-history`, '1.json'), '{"text":"Older A"}');
fs.writeFileSync(path.join(directory, 'b.md'), 'Text of B.\n');

const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/API_KEY|TOKEN|SECRET|^AWS_|^PI_/.test(name)));
const server = spawn(process.execPath, [fileURLToPath(new URL('../index.js', import.meta.url))], {
  cwd: directory,
  env: { ...env, PORT: '0', STILURA_NO_OPEN: '1', DRAFT_FILE: draft, STILURA_OFFLINE_MODELS: '1', PI_CODING_AGENT_DIR: path.join(directory, '.pi') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const url = await new Promise((resolve, reject) => {
  let output = '';
  const timer = setTimeout(() => reject(new Error(`Stilura did not start: ${output}`)), 30000);
  server.stdout.on('data', chunk => {
    output += chunk;
    const match = output.match(/Stilura → (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) { clearTimeout(timer); resolve(match[1]); }
  });
  server.stderr.on('data', chunk => { output += chunk; });
});
const call = async (method, route, body) => {
  const response = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
};
const has = name => fs.existsSync(path.join(directory, name));

try {
  // Open A first, so the rename has a live session to release.
  assert.equal((await call('POST', '/draft/open', { name: 'a.md' })).status, 200);

  // Rename carries notes and history; the old names are gone.
  const renamed = await call('POST', '/file/rename', { name: 'a.md', to: 'Chapter one.md' });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal(renamed.data.name, 'Chapter one.md');
  assert.ok(renamed.data.id && renamed.data.previousId && renamed.data.id !== renamed.data.previousId);
  assert.equal(fs.readFileSync(path.join(directory, 'Chapter one.md'), 'utf8'), 'Text of A.\n');
  assert.ok(has('Chapter one.md.stilura-notes.json') && has('Chapter one.md.stilura-history/1.json'));
  assert.ok(!has('a.md') && !has('a.md.stilura-notes.json') && !has('a.md.stilura-history'));
  assert.equal((await call('POST', '/draft/open', { name: 'Chapter one.md' })).data.notes?.[0]?.text, 'Note on A', 'notes follow the rename');

  // Never overwrites, never leaves the folder, never moves the home draft.
  assert.equal((await call('POST', '/file/rename', { name: 'Chapter one.md', to: 'b.md' })).status, 409);
  assert.equal(fs.readFileSync(path.join(directory, 'b.md'), 'utf8'), 'Text of B.\n');
  assert.equal((await call('POST', '/file/rename', { name: 'b.md', to: '../b.md' })).status, 400);
  assert.equal((await call('POST', '/file/rename', { name: 'draft.md', to: 'other.md' })).status, 400);
  assert.equal((await call('DELETE', '/file?name=draft.md')).status, 400);

  // Delete goes to .trash/ with the companions, and the list no longer shows it.
  const deleted = await call('DELETE', `/file?name=${encodeURIComponent('Chapter one.md')}`);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
  assert.match(deleted.data.trashed, /Z Chapter one\.md$/);
  assert.ok(!has('Chapter one.md') && has(`.trash/${deleted.data.trashed}`) && has(`.trash/${deleted.data.trashed}.stilura-notes.json`));
  assert.deepEqual((await call('GET', '/files')).data.files.map(file => file.name), ['b.md', 'draft.md']);

  // Restore puts it back with notes and history; a taken name is refused.
  const restored = await call('POST', '/file/restore', { trashed: deleted.data.trashed });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.equal(restored.data.name, 'Chapter one.md');
  assert.ok(has('Chapter one.md') && has('Chapter one.md.stilura-notes.json') && has('Chapter one.md.stilura-history/1.json'));
  const again = await call('DELETE', `/file?name=${encodeURIComponent('Chapter one.md')}`);
  fs.writeFileSync(path.join(directory, 'Chapter one.md'), 'Newer work.\n');
  assert.equal((await call('POST', '/file/restore', { trashed: again.data.trashed })).status, 409);
  assert.equal(fs.readFileSync(path.join(directory, 'Chapter one.md'), 'utf8'), 'Newer work.\n', 'a restore never overwrites');
  assert.equal((await call('POST', '/file/restore', { trashed: '../draft.md' })).status, 400);

  console.log('Files HTTP checks passed: rename with notes and history, no overwrite, home draft kept, trash and restore.');
} finally {
  server.kill('SIGTERM');
  fs.rmSync(directory, { recursive: true, force: true });
}
