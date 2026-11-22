import { createHash } from 'node:crypto';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { clampThinkingLevel, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { connectMcp, mcpConfigured } from './mcp.js';
import { CLAUDE_CODE, askClaudeCode, claudeCodeStatus, claudeModels } from './claude-code.js';
import { ANTIGRAVITY, askAntigravity, antigravityStatus } from './antigravity.js';

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
// Named models first. A router picks a different model per request, so the same
// draft comes back rewritten wholesale on one call and empty on the next — the
// app cannot hold a prompt contract against it. Kept last so an OpenRouter-only
// setup still starts, never as the preferred default.
const FALLBACK_MODELS = [
  ['openai-codex', 'gpt-6-luna'],
  ['anthropic', 'claude-sonnet-4-6'],
  ['openrouter', 'anthropic/claude-sonnet-4.6'],
  ['openrouter', 'auto'],
];

// Pi ships a snapshot of every provider's model list, and it ages: a model
// added to OpenRouter after the dependency was published cannot be selected at
// all, because `resolveModel` refuses what the catalog does not know. Asking a
// provider what it offers is a call to the provider the writer has already
// pointed the app at, so it is allowed by default. `STILURA_OFFLINE_MODELS=1`
// stops Stilura from asking, and Pi falls back to the list it already has —
// bundled, or cached from an earlier refresh.
const OFFLINE_MODELS = Boolean(process.env.STILURA_OFFLINE_MODELS);
let runtimePromise;
const runtime = () => runtimePromise ??= ModelRuntime.create({ allowModelNetwork: !OFFLINE_MODELS })
  .catch(error => {
    // No network, or a provider that will not answer: the snapshot still works.
    console.warn('[pi] model catalog refresh failed, using the bundled list —', error.message);
    // The in-flight assignment already happened; clear it so a later call
    // retries instead of reusing this rejection.
    runtimePromise = undefined;
    return ModelRuntime.create({ allowModelNetwork: false });
  })
  .catch(error => {
    // Even the offline snapshot can fail. Never park a rejected promise in the
    // cache — the next call must try again.
    runtimePromise = undefined;
    throw error;
  });

const requestedThinking = () => THINKING_LEVELS.includes(process.env.PI_THINKING_LEVEL)
  ? process.env.PI_THINKING_LEVEL
  : 'medium';

const selectionFor = (model, thinkingLevel = requestedThinking()) => ({
  provider: model.provider,
  model: model.id,
  thinkingLevel: clampThinkingLevel(model, thinkingLevel),
});

// Pi's catalog lists Codex models a ChatGPT subscription does not serve:
// they fail with "The '<model>' model is not supported when using Codex with a
// ChatGPT account." Verified 2026-11-11 on a ChatGPT account, only these
// worked; the first is the default after sign-in, the rest are the fallback
// chain in that order. Plans may differ, so a model that is refused at
// runtime is dropped for the rest of the process.
const OAUTH_MODELS = { 'openai-codex': ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna'] };
const refused = new Set();
const keyOf = (provider, id) => `${provider}/${id}`;
const offered = model => !refused.has(keyOf(model.provider, model.id))
  && (!OAUTH_MODELS[model.provider] || OAUTH_MODELS[model.provider].includes(model.id));

// The next allowlisted model after a refusal, or null when the chain is spent.
export function nextOfferedModel(provider, id) {
  refused.add(keyOf(provider, id));
  const next = (OAUTH_MODELS[provider] ?? []).find(candidate => !refused.has(keyOf(provider, candidate)));
  return next ? { provider, id: next } : null;
}

// Parallel callers (UI, extension popup, credential saves) share one build.
const statusInflight = new Map();
export function getAgentStatus({ force = false } = {}) {
  if (!statusInflight.has(force)) {
    const build = buildAgentStatus({ force }).finally(() => { if (statusInflight.get(force) === build) statusInflight.delete(force); });
    statusInflight.set(force, build);
  }
  return statusInflight.get(force);
}

// What the Claude Code and Antigravity subscriptions add to the model list.
function externalAgents(claudeCode, antigravity) {
  const agy = antigravity.loggedIn && antigravity.models.length > 0;
  return {
    models: [...(claudeCode.plan ? claudeModels : []), ...(agy ? antigravity.models : [])],
    providers: [
      ...(claudeCode.plan ? [{ id: CLAUDE_CODE, name: 'Claude Code · Pro/Max' }] : []),
      ...(agy ? [{ id: ANTIGRAVITY, name: 'Antigravity' }] : []),
    ],
    defaultSelection: claudeCode.plan ? { provider: CLAUDE_CODE, model: claudeModels[0].model, thinkingLevel: 'off' }
      : agy ? { provider: ANTIGRAVITY, model: antigravity.models[0].model, thinkingLevel: 'off' }
      : undefined,
  };
}

async function buildAgentStatus({ force }) {
  try {
    const [rt, claudeCode, antigravity] = await Promise.all([runtime(), claudeCodeStatus({ force }), antigravityStatus({ force })]);
    const available = (await rt.getAvailable()).filter(offered);
    const unique = [...new Map(available.map(model => [`${model.provider}\0${model.id}`, model])).values()];
    const models = unique.map(model => ({
      provider: model.provider,
      model: model.id,
      name: model.name,
      reasoning: model.reasoning,
      thinkingLevels: getSupportedThinkingLevels(model),
    }));
    const providers = [...new Set(models.map(model => model.provider))].map(id => ({
      id,
      name: rt.getProvider(id)?.name ?? id,
    }));
    const authProviders = rt.getProviders()
      .filter(provider => provider.auth.apiKey?.login)
      .map(provider => {
        const status = rt.getProviderAuthStatus(provider.id);
        return {
          id: provider.id,
          name: provider.name,
          label: provider.auth.apiKey.name,
          configured: status.configured,
          ...(status.source ? { source: status.source } : {}),
        };
      });
    const configured = process.env.PI_PROVIDER && process.env.PI_MODEL
      ? unique.find(model => model.provider === process.env.PI_PROVIDER && model.id === process.env.PI_MODEL)
      : undefined;
    const selected = configured
      ?? FALLBACK_MODELS.map(([provider, id]) => unique.find(model => model.provider === provider && model.id === id)).find(Boolean)
      ?? unique[0];
    const external = externalAgents(claudeCode, antigravity);
    models.push(...external.models);
    providers.push(...external.providers);
    const defaultSelection = selected ? selectionFor(selected) : external.defaultSelection;
    return {
      claudeCode,
      antigravity,
      available: models.length > 0,
      ...(defaultSelection ? { defaultSelection } : {}),
      providers,
      models,
      authProviders,
      ...(rt.getError() ? { error: rt.getError() } : {}),
    };
  } catch (error) {
    const [claudeCode, antigravity] = await Promise.all([
      claudeCodeStatus({ force }).catch(() => ({
        installed: false, claudeInstalled: false, adapterInstalled: false, plan: null,
      })),
      antigravityStatus({ force }).catch(() => ({
        installed: false, loggedIn: false, tier: null, models: [],
      })),
    ]);
    const { models, providers, defaultSelection } = externalAgents(claudeCode, antigravity);
    return {
      claudeCode,
      antigravity,
      available: models.length > 0,
      ...(defaultSelection ? { defaultSelection } : {}),
      providers, models, authProviders: [], error: error.message,
    };
  }
}

export async function saveProviderApiKey(providerId, apiKey) {
  const rt = await runtime();
  const provider = rt.getProvider(providerId);
  if (!provider?.auth.apiKey?.login) throw new Error(`Provider ${providerId} does not support API-key login`);
  if (!apiKey.trim() || apiKey.length > 10_000) throw new Error('API key is empty or too long');
  await rt.login(providerId, 'api_key', { prompt: async () => apiKey.trim(), notify: () => {} });
  statusInflight.clear();
}

export async function removeProviderApiKey(providerId) {
  const rt = await runtime();
  if (!rt.getProvider(providerId)) throw new Error(`Unknown provider ${providerId}`);
  await rt.logout(providerId);
  statusInflight.clear();
}

// ─── Subscription sign-in (OAuth) ──────────────────────────────────────────
// Allowlist, not every OAuth provider Pi knows. Anthropic is deliberately
// absent: since February 2026 Anthropic restricts Pro/Max OAuth tokens to
// Claude Code and claude.ai, and routing them through Stilura would violate
// their terms. OpenAI tolerates Codex OAuth in third-party tools, so only
// the ChatGPT Plus/Pro subscription is offered here.
//
// The flow is driven by Pi's CLI-oriented login: a `select` prompt picks the
// method, a notify carries the auth URL (or device code), and a `manual_code`
// prompt stays pending as the paste fallback when the localhost callback
// (fixed port 1455) never fires. The browser UI mirrors each step over three
// small endpoints; the login itself runs in the background.
const OAUTH_PROVIDERS = ['openai-codex'];
const OAUTH_METHODS = ['browser', 'device_code'];
const OAUTH_TTL = 10 * 60_000;

let oauthSession = null;

function clearOAuthTimer(session) {
  if (!session?.timer) return;
  clearTimeout(session.timer);
  session.timer = null;
}

function expireOAuth(session) {
  if (!session || session.step === 'done' || session.step === 'error') return;
  clearOAuthTimer(session);
  session.timedOut = true;
  session.step = 'error';
  session.error = 'Sign-in timed out';
  session.controller.abort();
  session.resolveManual?.reject(new Error('Sign-in timed out'));
  session.resolveManual = null;
}

function sweepExpiredOAuth() {
  if (oauthSession && oauthSession.step !== 'done' && oauthSession.step !== 'error'
    && Date.now() - oauthSession.startedAt >= oauthSession.ttl) {
    expireOAuth(oauthSession);
  }
}

const oauthSnapshot = session => !session ? null : {
  provider: session.provider,
  method: session.method,
  step: session.step,
  ...(session.url ? { url: session.url } : {}),
  ...(session.userCode ? { userCode: session.userCode } : {}),
  ...(session.verificationUri ? { verificationUri: session.verificationUri } : {}),
  ...(session.error ? { error: session.error } : {}),
};

const oauthError = (status, message) => Object.assign(new Error(message), { status });

export async function getOAuthStatus() {
  sweepExpiredOAuth();
  const rt = await runtime();
  const supported = [];
  for (const id of OAUTH_PROVIDERS) {
    const provider = rt.getProvider(id);
    if (!provider) continue;
    let configured = false;
    try { configured = !!rt.getProviderAuthStatus(id)?.configured; } catch {}
    // Chosen on sign-in. Changing the default is one line in OAUTH_MODELS.
    const recommended = OAUTH_MODELS[id]?.find(model => !refused.has(keyOf(id, model)) && rt.getModel(id, model));
    supported.push({
      id,
      name: provider.name ?? id,
      ...(provider.auth?.oauth && typeof provider.auth.oauth.name === 'string' ? { label: provider.auth.oauth.name } : {}),
      isSubscription: true,
      configured,
      ...(recommended ? { recommended } : {}),
    });
  }
  return { supported, active: oauthSnapshot(oauthSession) };
}

export async function startOAuth(providerId, method = 'browser', { ttl = OAUTH_TTL } = {}) {
  if (!OAUTH_PROVIDERS.includes(providerId)) {
    throw oauthError(400, providerId === 'anthropic'
      ? 'Claude Pro/Max sign-in is not offered: Anthropic restricts subscription tokens to Claude Code and claude.ai.'
      : `Sign-in is not offered for provider ${providerId}`);
  }
  if (!OAUTH_METHODS.includes(method)) throw oauthError(400, `Unknown sign-in method ${method}`);
  sweepExpiredOAuth();
  if (oauthSession && oauthSession.step !== 'done' && oauthSession.step !== 'error') {
    throw oauthError(409, 'A sign-in is already in progress');
  }
  const controller = new AbortController();
  const session = oauthSession = {
    provider: providerId, method, step: 'starting', controller, resolveManual: null,
    startedAt: Date.now(), ttl, timedOut: false, timer: null,
  };
  session.timer = setTimeout(() => expireOAuth(session), ttl);
  session.timer.unref?.();
  const interaction = {
    signal: controller.signal,
    prompt: async request => {
      if (request?.type === 'select') return method;
      if (request?.type === 'manual_code') {
        return new Promise((resolve, reject) => { session.resolveManual = { resolve, reject }; });
      }
      throw new Error(`Unsupported prompt type ${request?.type}`);
    },
    notify: async note => {
      if (oauthSession !== session) return;
      if (note?.type === 'auth_url' && note.url) {
        session.step = 'url';
        session.url = String(note.url);
      } else if (note?.type === 'device_code') {
        session.step = 'device';
        session.userCode = String(note.userCode ?? '');
        session.verificationUri = String(note.verificationUri ?? '');
      }
    },
  };
  (async () => {
    try {
      const rt = await runtime();
      await rt.login(providerId, 'oauth', interaction);
      if (oauthSession === session) session.step = 'done';
    } catch (error) {
      if (oauthSession !== session) return;
      session.step = 'error';
      session.error = session.timedOut ? 'Sign-in timed out'
        : controller.signal.aborted ? 'Sign-in cancelled'
        : (error?.message || String(error));
    } finally {
      clearOAuthTimer(session);
      session.resolveManual = null;
    }
  })();
  // The auth URL usually arrives within a second; wait for it briefly so the
  // caller can open it at once, and let status polling cover the slow path.
  const deadline = Date.now() + 10_000;
  while (session.step === 'starting' && Date.now() < deadline && !controller.signal.aborted) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { supported: (await getOAuthStatus()).supported, active: oauthSnapshot(session) };
}

export async function submitOAuthCode(code) {
  sweepExpiredOAuth();
  const text = String(code ?? '').trim();
  if (!text || text.length > 10_000) throw oauthError(400, 'Pasted code is empty or too long');
  const session = oauthSession;
  if (!session || !session.resolveManual) throw oauthError(409, 'No sign-in is waiting for a code');
  session.resolveManual.resolve(text);
  session.resolveManual = null;
  return { active: oauthSnapshot(session) };
}

export async function cancelOAuth() {
  sweepExpiredOAuth();
  const session = oauthSession;
  if (!session || session.step === 'done' || session.step === 'error') return { active: oauthSnapshot(session) };
  clearOAuthTimer(session);
  session.controller.abort();
  session.resolveManual?.reject(new Error('Sign-in cancelled'));
  session.resolveManual = null;
  return { active: oauthSnapshot(oauthSession) };
}

async function resolveModel(selection) {
  const rt = await runtime();
  if (!selection && process.env.PI_PROVIDER && process.env.PI_MODEL) {
    selection = { provider: process.env.PI_PROVIDER, model: process.env.PI_MODEL, thinkingLevel: requestedThinking() };
  }
  // A model refused earlier in this process goes straight to its fallback.
  while (selection && refused.has(keyOf(selection.provider, selection.model))) {
    const next = nextOfferedModel(selection.provider, selection.model);
    if (!next) break;
    selection = { ...selection, model: next.id };
  }
  if (selection) {
    const model = rt.getModel(selection.provider, selection.model);
    if (!model) throw new Error(`Unknown Pi model ${selection.provider}/${selection.model}`);
    const available = await rt.getAvailable(selection.provider);
    if (!available.some(candidate => candidate.id === selection.model)) {
      throw new Error(`Pi model ${selection.provider}/${selection.model} is not authenticated or unavailable`);
    }
    return { rt, model, selection: selectionFor(model, selection.thinkingLevel) };
  }
  const available = await rt.getAvailable();
  const model = FALLBACK_MODELS.map(([provider, id]) => available.find(candidate => candidate.provider === provider && candidate.id === id)).find(Boolean)
    ?? available[0];
  if (!model) throw new Error('No authenticated Pi model is available; open Settings and add an API key');
  return { rt, model, selection: selectionFor(model) };
}

// Either a single user turn or a whole transcript — the chat needs the latter.
// Assistant turns need content as blocks and a usage stub: Pi's context-token
// estimator reads assistant.usage.totalTokens unconditionally, and its Anthropic
// payload builder iterates assistant.content as blocks — a plain string crashes both.
const request = (systemPrompt, userPrompt, history) => ({
  systemPrompt,
  messages: (history ?? [{ role: 'user', content: userPrompt }])
    .map(message => message.role === 'assistant'
      ? {
          role: 'assistant',
          content: [{ type: 'text', text: message.content }],
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          timestamp: Date.now(),
        }
      : { role: message.role, content: message.content, timestamp: Date.now() }),
});

// One prompt-cache session per document, so two open drafts do not evict each
// other's cached prefix. The id is hashed: it is a file name from the client.
export const suggestSessionId = documentId => documentId
  ? `stilura-suggest:${createHash('sha256').update(documentId).digest('hex').slice(0, 16)}`
  : 'stilura-suggest';

const options = (selection, maxTokens, signal) => ({
  maxTokens,
  signal,
  ...(selection.thinkingLevel === 'off' ? {} : { reasoning: selection.thinkingLevel }),
});

// Some endpoints reject `reasoning: off` outright ("Reasoning is mandatory…")
// though the model list says it can be switched off. Remember which, and give
// those models the least reasoning they accept with room to finish.
const reasoningRequired = new Set();
const mandatoryReasoning = response => /reasoning is mandatory/i.test(response.errorMessage ?? '');
// A ChatGPT plan that does not serve the model (see OAUTH_MODELS).
const notSupported = message => /model is not supported when using Codex with a ChatGPT account/i.test(message ?? '');

export async function completeText({ systemPrompt, userPrompt, selection, maxTokens = 1500, signal, continuation = false, documentId }) {
  if (selection?.provider === CLAUDE_CODE) return askClaudeCode({ systemPrompt, userPrompt, model: selection.model, signal });
  if (selection?.provider === ANTIGRAVITY) return askAntigravity({ systemPrompt, userPrompt, model: selection.model, signal });
  const resolved = await resolveModel(selection);
  const modelKey = `${resolved.model.provider}/${resolved.model.id}`;
  // Typing suggestions need the least reasoning the model supports, regardless
  // of the default model settings. Mandatory-reasoning models need headroom.
  const ask = async (level, scale = 1) => {
    const effectiveSelection = continuation ? selectionFor(resolved.model, level) : resolved.selection;
    const wanted = (continuation ? (effectiveSelection.thinkingLevel === 'off' ? 256 : 2048) : maxTokens) * scale;
    const budget = Math.min(wanted, resolved.model.maxTokens ?? wanted);
    // The session key routes OpenAI-style providers to a warm prompt cache:
    // measured on a long draft, 86% of input cached and ~1.6 s → ~1.0 s.
    return resolved.rt.completeSimple(resolved.model, request(systemPrompt, userPrompt),
      { ...options(effectiveSelection, budget, signal), ...(continuation ? { sessionId: suggestSessionId(documentId) } : {}) });
  };
  let level = reasoningRequired.has(modelKey) ? 'minimal' : 'off';
  let response = await ask(level);
  if (continuation && !reasoningRequired.has(modelKey) && response.stopReason === 'error' && mandatoryReasoning(response)) {
    reasoningRequired.add(modelKey);
    response = await ask(level = 'minimal');
  }
  if (response.stopReason === 'error' && notSupported(response.errorMessage)) {
    const next = nextOfferedModel(resolved.model.provider, resolved.model.id);
    if (next) return completeText({ systemPrompt, userPrompt, selection: { ...resolved.selection, model: next.id }, maxTokens, signal, continuation, documentId });
  }
  if (response.stopReason === 'error' || response.stopReason === 'aborted') {
    throw new Error(response.errorMessage ?? 'Pi request failed');
  }
  const textOf = response => response.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('').trim();
  // Only continuations may use partial output. Drop the potentially cut word.
  const prefixOf = text => {
    const boundary = text.search(/\s+\S*$/u);
    return boundary < 0 ? '' : text.slice(0, boundary).trimEnd();
  };
  let text = textOf(response);
  if (response.stopReason === 'length') {
    if (!continuation) throw new Error('Model output was truncated. Try a smaller passage or less reasoning.');
    let prefix = prefixOf(text);
    // A short TEXT:/WORD: answer cut at its only word, or a reasoning-only
    // response, leaves nothing to accept: retry once with a larger budget.
    if (!prefix.replace(/^(?:TEXT|WORD):?/i, '').trim()) {
      response = await ask(level, 4);
      if (response.stopReason === 'error' || response.stopReason === 'aborted') throw new Error(response.errorMessage ?? 'Pi request failed');
      text = textOf(response);
      prefix = response.stopReason === 'length' ? prefixOf(text) : text;
    }
    return prefix;
  }
  return text;
}

export async function streamText({ systemPrompt, userPrompt, messages, selection, maxTokens = 2000, signal, onText, mcp = false, onReset = () => {}, onNotice = () => {} }) {
  // Agent sessions run their own tools; Stilura's MCP servers are not offered to them.
  if (mcp && [CLAUDE_CODE, ANTIGRAVITY].includes(selection?.provider) && mcpConfigured()) {
    onNotice(`Your MCP servers are not used with ${selection.provider === CLAUDE_CODE ? 'Claude Code' : 'Antigravity'}. Pick another model in Settings to use them.`);
  }
  if (selection?.provider === CLAUDE_CODE) {
    await askClaudeCode({ systemPrompt, userPrompt, messages, model: selection.model, signal, onText });
    return;
  }
  if (selection?.provider === ANTIGRAVITY) {
    await askAntigravity({ systemPrompt, userPrompt, messages, model: selection.model, signal, onText });
    return;
  }
  const resolved = await resolveModel(selection);
  const modelKey = `${resolved.model.provider}/${resolved.model.id}`;
  const effectiveSelection = reasoningRequired.has(modelKey) && resolved.selection.thinkingLevel === 'off'
    ? selectionFor(resolved.model, 'minimal')
    : resolved.selection;
  const connection = mcp ? await connectMcp(signal) : null;
  const context = request(connection ? `${systemPrompt}\n\n${connection.instructions}` : systemPrompt, userPrompt, messages);
  if (connection) context.tools = connection.tools;
  for (let step = 0; step < 12; step++) {
    signal?.throwIfAborted();
    const stream = resolved.rt.streamSimple(resolved.model, context, options(effectiveSelection, maxTokens, signal));
    let answer, wrote = false;
    for await (const event of stream) {
      if (event.type === 'text_delta') { wrote = true; onText(event.delta); }
      if (event.type === 'error') {
        if (!wrote && step === 0 && !reasoningRequired.has(modelKey) && mandatoryReasoning(event.error)) {
          reasoningRequired.add(modelKey);
          return streamText({ systemPrompt, userPrompt, messages, selection: selectionFor(resolved.model, 'minimal'), maxTokens, signal, onText, mcp, onReset });
        }
        // A refusal arrives before any text, so the next model can answer
        // the same request without the writer seeing the failure.
        const next = !wrote && step === 0 && notSupported(event.error.errorMessage)
          && nextOfferedModel(resolved.model.provider, resolved.model.id);
        if (next) return streamText({ systemPrompt, userPrompt, messages, selection: { ...resolved.selection, model: next.id }, maxTokens, signal, onText, mcp, onReset });
        throw new Error(event.error.errorMessage ?? 'Pi request failed');
      }
      if (event.type === 'done') {
        if (event.reason === 'length') throw new Error('Model output was truncated. Try a smaller passage.');
        answer = event.message;
      }
    }
    if (!answer) throw new Error('Model stream ended without a response.');
    const calls = answer.content.filter(block => block.type === 'toolCall');
    if (!calls.length) return;
    if (!connection) throw new Error('Model requested an unavailable tool.');
    if (step === 11) throw new Error('MCP tool limit reached. Try a narrower request.');
    if (calls.length > 12) throw new Error('Too many MCP calls in one step. Try a narrower request.');
    // Tool preambles may contain draft-edit markup; only the final answer is actionable.
    onReset();
    context.messages.push(answer);
    for (const call of calls) {
      signal?.throwIfAborted();
      const result = await connection.call(call.name, call.arguments);
      context.messages.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name,
        ...result, timestamp: Date.now() });
    }
  }
}
