import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unavailableSelection } from '../src/format.js';

const models = [{ provider: 'test', model: 'a' }];
assert.equal(unavailableSelection(null, models), null, 'no saved model is first run, not a lost one');
assert.equal(unavailableSelection({ provider: 'test', model: 'a' }, models), null);
const lost = { provider: 'claude-code', model: 'sonnet', thinkingLevel: 'off' };
assert.equal(unavailableSelection(lost, models), lost);
assert.equal(unavailableSelection(lost, []), lost);

// Wiring: the welcome flow yields to a saved-but-unavailable model, and the
// banner offers the guided way out.
const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
assert(app.includes("const welcome = tab === 'welcome' && !unavailableSelection(agentSelection, agentInfo.models);"));
assert(app.includes("`Saved model ${lost.model} is unavailable right now.`"));
assert(app.includes("document.getElementById('model-unavailable-pick').addEventListener('click'"));
assert(fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').includes('id="model-unavailable-pick"'));
console.log('Saved model checks passed: unavailable vs first run, banner wiring.');
