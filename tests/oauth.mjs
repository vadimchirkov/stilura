import assert from 'node:assert/strict';
import fs from 'node:fs';
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
const [agent, sameBuild] = await Promise.all([getAgentStatus(), getAgentStatus()]);
assert.equal(agent, sameBuild, 'parallel status calls share one build');
assert(agent.providers.length && agent.providers.every(provider => !('models' in provider)), 'providers do not repeat models[]');
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

// A successful callback closes the browser tab only after model status loads.
{
  let closed = 0, selected;
  const context = vm.createContext({
    oauthInfo: { active: { step: 'url' } },
    oauthTab: { close() { closed++; } },
    stopOAuthPoll() {},
    oauthActivePending: () => context.oauthInfo.active.step === 'url',
    api: async () => ({ active: { step: 'done', provider: 'openai-codex' } }),
    refreshAgent: async () => { assert.equal(closed, 0); },
    renderSubscriptions() {},
    signedIn: provider => { selected = provider; },
  });
  vm.runInContext(appSection('function closeOAuthTab()', 'function stopOAuthPoll()')
    + appSection('async function pollOAuth(', '// Signing in is choosing'), context);
  await context.pollOAuth();
  assert.equal(closed, 1);
  assert.equal(selected, 'openai-codex');
}

// A model the subscription refuses falls back along the chain, then stops.
assert.deepEqual(nextOfferedModel('openai-codex', 'gpt-6-luna'), { provider: 'openai-codex', id: 'gpt-5.6-terra' });
assert.deepEqual(nextOfferedModel('openai-codex', 'gpt-5.6-terra'), { provider: 'openai-codex', id: 'gpt-5.6-luna' });
assert.equal(nextOfferedModel('openai-codex', 'gpt-5.6-luna'), null);
assert.equal((await getOAuthStatus()).supported.find(provider => provider.id === 'openai-codex').recommended, undefined);

// An abandoned OAuth session expires after its TTL so a new sign-in is not blocked with 409.
{
  const piSource = fs.readFileSync(new URL('../pi.js', import.meta.url), 'utf8');
  const oauthCode = piSource
    .slice(piSource.indexOf('const OAUTH_PROVIDERS ='), piSource.indexOf('async function resolveModel('))
    .replaceAll('export ', '');
  const context = vm.createContext({
    AbortController, setTimeout, clearTimeout, Date,
    OAUTH_MODELS: { 'openai-codex': ['gpt-6-luna'] },
    refused: new Set(),
    keyOf: (p, id) => `${p}/${id}`,
    runtime: async () => ({
      getProvider: id => id === 'openai-codex' ? { name: 'ChatGPT', auth: { oauth: { name: 'ChatGPT' } } } : null,
      getProviderAuthStatus: () => ({ configured: false }),
      getModel: () => ({}),
      login: async (_provider, _mode, interaction) => {
        await interaction.notify({ type: 'auth_url', url: 'https://auth.example/start' });
        await interaction.prompt({ type: 'manual_code' });
      },
    }),
  });
  vm.runInContext(oauthCode, context);
  const started = await context.startOAuth('openai-codex', 'browser', { ttl: 150 });
  assert.equal(started.active.step, 'url');
  await assert.rejects(context.startOAuth('openai-codex', 'browser', { ttl: 150 }), error => error.status === 409);
  await new Promise(resolve => setTimeout(resolve, 200));
  const after = await context.getOAuthStatus();
  assert.equal(after.active.step, 'error');
  assert.equal(after.active.error, 'Sign-in timed out');
  const restarted = await context.startOAuth('openai-codex', 'browser', { ttl: 5000 });
  assert.equal(restarted.active.step, 'url');
  await context.cancelOAuth();
}

// streamText remembers mandatoryReasoning and retries once with minimal reasoning.
{
  const piSource = fs.readFileSync(new URL('../pi.js', import.meta.url), 'utf8');
  const streamCode = piSource
    .slice(piSource.indexOf('const options ='))
    .replaceAll('export ', '');
  const seenReasoning = [];
  const model = { provider: 'test', id: 'reasoning-only', reasoning: true };
  const context = vm.createContext({
    CLAUDE_CODE: 'claude-code',
    ANTIGRAVITY: 'antigravity',
    askClaudeCode: async () => '',
    askAntigravity: async () => '',
    connectMcp: async () => null,
    nextOfferedModel: () => null,
    request: () => ({ messages: [] }),
    selectionFor: (m, level) => ({ provider: m.provider, model: m.id, thinkingLevel: level }),
    resolveModel: async sel => ({
      model,
      selection: sel ?? { provider: model.provider, model: model.id, thinkingLevel: 'off' },
      rt: {
        streamSimple: async function* (_m, _ctx, opts) {
          seenReasoning.push(opts.reasoning);
          if (!opts.reasoning) {
            yield { type: 'error', error: { errorMessage: 'Reasoning is mandatory for this model' } };
            return;
          }
          yield { type: 'text_delta', delta: 'ok' };
          yield { type: 'done', reason: 'stop', message: { content: [{ type: 'text', text: 'ok' }] } };
        },
      },
    }),
  });
  vm.runInContext(streamCode, context);
  let out = '';
  await context.streamText({ systemPrompt: 's', userPrompt: 'u', onText: d => { out += d; } });
  assert.equal(out, 'ok');
  assert.deepEqual(seenReasoning, [undefined, 'minimal']);
  out = '';
  await context.streamText({ systemPrompt: 's', userPrompt: 'u', onText: d => { out += d; } });
  assert.equal(out, 'ok');
  assert.deepEqual(seenReasoning, [undefined, 'minimal', 'minimal'], 'cached mandatoryReasoning must skip off on subsequent calls');
}

// extension/popup.js picks 'off' when supported, otherwise the model's first supported thinkingLevel.
{
  const popupSource = fs.readFileSync(new URL('../extension/popup.js', import.meta.url), 'utf8');
  const fnCode = popupSource.slice(popupSource.indexOf('function models('), popupSource.indexOf("$('connection')"));
  const options = [];
  const statusEl = { textContent: '' };
  const selectEl = { replaceChildren(...items) { options.length = 0; options.push(...items); }, append(item) { options.push(item); } };
  const context = vm.createContext({
    $: id => id === 'model' ? selectEl : statusEl,
    status: text => { statusEl.textContent = text; },
    Option: function Option(text, value) { return { text, value, selected: false }; },
  });
  vm.runInContext(fnCode, context);
  context.models({
    available: true,
    models: [
      { provider: 'openai', model: 'm1', name: 'M1', thinkingLevels: ['off', 'medium'] },
      { provider: 'openai', model: 'm2', name: 'M2', thinkingLevels: ['minimal', 'high'] },
    ],
  });
  assert.equal(JSON.parse(options[1].value).thinkingLevel, 'off');
  assert.equal(JSON.parse(options[2].value).thinkingLevel, 'minimal');
}

console.log('OAuth checks passed: allowlist, method validation, status shape, idle code/cancel paths, recommended ChatGPT model, switch after sign-in, refusal fallback.');
