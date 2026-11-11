import assert from 'node:assert/strict';
import vm from 'node:vm';
import { cancelOAuth, getAgentStatus, getOAuthStatus, nextOfferedModel, startOAuth, submitOAuthCode } from '../pi.js';
import { appSection } from './app-source.mjs';

// Subscription sign-in: the allowlist, method validation, and the session
// state machine — without starting a real browser flow.
await assert.rejects(startOAuth('anthropic'), /not offered/);
await assert.rejects(startOAuth('nope'), /not offered/);
await assert.rejects(startOAuth('openai-codex', 'bogus'), /method/);

const status = await getOAuthStatus();
assert(Array.isArray(status.supported));
assert(status.supported.some(provider => provider.id === 'openai-codex' && provider.isSubscription));
assert(!status.supported.some(provider => provider.id === 'anthropic'), 'Claude OAuth must never be offered');
assert.equal(status.active, null);

await assert.rejects(submitOAuthCode('whatever'), /waiting for a code/);
await assert.rejects(submitOAuthCode('   '), /empty/);
assert.deepEqual(await cancelOAuth(), { active: null });

// ChatGPT sign-in picks a model the subscription actually serves.
const codex = status.supported.find(provider => provider.id === 'openai-codex');
assert.equal(codex.recommended, 'gpt-6-luna');
const agent = await getAgentStatus();
for (const model of agent.models.filter(model => model.provider === 'openai-codex')) {
  assert(['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna'].includes(model.model), `${model.model} is refused for ChatGPT accounts`);
}

// After sign-in the selection switches to the recommended model, over an
// earlier choice, and the dialog closes with a notice offering to change it.
{
  const notices = [];
  let closed = false;
  const models = [
    { provider: 'openrouter', model: 'auto', name: 'Auto' },
    { provider: 'openai-codex', model: 'gpt-6-luna', name: 'GPT-6 Luna' },
  ];
  const context = vm.createContext({
    oauthInfo: { supported: [{ id: 'openai-codex', recommended: 'gpt-6-luna' }] },
    agentInfo: { models },
    agentSelection: { provider: 'openrouter', model: 'auto', thinkingLevel: 'high' },
    draftSelection: null,
    saveAgentSelection() { context.agentSelection = context.draftSelection; },
    currentAgent: () => context.agentSelection,
    renderModelSettings() {}, renderCredentials() {},
    closeSettingsAnimated() { closed = true; },
    openSettings() {},
    notify: (text, options) => notices.push({ text, label: options?.label }),
  });
  vm.runInContext(appSection('function signedIn(', 'async function startOAuthFlow('), context);
  context.signedIn('openai-codex');
  assert.deepEqual({ ...context.agentSelection }, { provider: 'openai-codex', model: 'gpt-6-luna', thinkingLevel: 'medium' });
  assert(closed);
  assert.deepEqual(notices, [{ text: 'Signed in with ChatGPT. Writing with GPT-6 Luna.', label: 'Change' }]);
}

// A model the subscription refuses falls back along the chain, then stops.
assert.deepEqual(nextOfferedModel('openai-codex', 'gpt-6-luna'), { provider: 'openai-codex', id: 'gpt-5.6-terra' });
assert.deepEqual(nextOfferedModel('openai-codex', 'gpt-5.6-terra'), { provider: 'openai-codex', id: 'gpt-5.6-luna' });
assert.equal(nextOfferedModel('openai-codex', 'gpt-5.6-luna'), null);
assert.equal((await getOAuthStatus()).supported.find(provider => provider.id === 'openai-codex').recommended, undefined);

console.log('OAuth checks passed: allowlist, method validation, status shape, idle code/cancel paths, recommended ChatGPT model, switch after sign-in, refusal fallback.');
