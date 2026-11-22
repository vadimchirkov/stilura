import { EDITOR_UI_CSS } from '../extension/editor-ui.js';
// src/app.js — Stilura frontend (CodeMirror 6)

import {
  EditorView,
  keymap,
  drawSelection,
  Decoration,
  WidgetType,
} from '@codemirror/view';
import {
  EditorState,
  Transaction,
  StateField,
  RangeSet,
  StateEffect,
  Compartment,
  Prec,
} from '@codemirror/state';
import {
  defaultKeymap,
  history,
  historyKeymap,
} from '@codemirror/commands';
import { renderMarkdown } from '../markdown.js';
import { replacementTarget, resolveDrift, unwrapProse, wordDiff } from '../editing.js';
import { paragraphRanges, resolveNoteRange, mapNoteAnchors } from '../notes.js';
import { reversible } from '../work.js';
import { EDITS_OPEN, chatVisibleText, locateChatEdits, mapChatEdit, chatEditMatches } from '../chat-edits.js';
import { searchKeymap } from '@codemirror/search';
import { hydrateIcons, icon } from './icons.js';
import { openStorage } from './storage.js';
import { liveDocument } from './live.js';
import { markdownField } from './editor/markdown.js';
import { focusMode, setFocusMode } from './editor/focus.js';
import { clearGhostFx, ghostField, ghostClear, ghostAccept } from './editor/ghost.js';
import { spellMarkerField, createSpelling } from './editor/spelling.js';
import { combobox, setOptions, fieldValue } from './combobox.js';
import { el } from './dom.js';
import { safeJson, formatFileSize, timeAgo } from './format.js';
import { api } from './api.js';
import { createDocumentState } from './document-state.js';
import { createUpdateCheck } from './update.js';
import { createSuggest } from './features/suggest.js';
import { setGenerationFx, generationField, slashRequest, requestField, waitingForSlash, createGenerate } from './features/generate.js';
import { setPassageFx, createPassage } from './features/passage.js';
import { createBubble } from './features/bubble.js';
import { createSwitcher, newFileName } from './features/switcher.js';
import { createHistory } from './features/history.js';
import { createNotices, modelError } from './notices.js';
import { createEditorTheme, textSelection } from './editor/theme.js';
import { BRIEF_STEPS, validateBriefQuestions, validateBriefUpdate } from '../brief.js';

async function main() {
const editorStyle = document.createElement('style');
editorStyle.textContent = EDITOR_UI_CSS; document.head.append(editorStyle);
let liveSync = null;
const desktop = new URLSearchParams(location.search).get('shell') === 'desktop';
const localStorage = await openStorage({
  desktop,
  onError: error => window.dispatchEvent(new CustomEvent('stilura-storage-error', { detail: error.message })),
});

// Static markup names Tabler icons with <span class="ph" data-icon="…">;
// this fills them from the single map in icons.js.
hydrateIcons();

// Naming a shortcut with the wrong modifier is worse than not naming it.

// ─── Elements ──────────────────────────────────────────────────────────────────

const editorWrap    = document.getElementById('editor-wrapper');
const settingsOpen  = document.getElementById('settings-open');
const settingsDialog = document.getElementById('settings-dialog');
const providerEl    = document.getElementById('agent-provider');
const modelEl       = document.getElementById('agent-model');
const thinkingEl    = document.getElementById('agent-thinking');
const apiKeyEl      = document.getElementById('api-key');
const keyAddEl      = document.getElementById('key-add');
const modelField    = document.getElementById('model-field');
const thinkingField = document.getElementById('thinking-field');
const connectRow    = document.getElementById('connect-row');
const connectSignin = document.getElementById('connect-signin');
const connectClaude = document.getElementById('connect-claude');
const claudeProvider = 'claude-code';
const connectAntigravity = document.getElementById('connect-antigravity');
const antigravityProvider = 'antigravity';
const subscriptionProviders = ['openai-codex', claudeProvider, antigravityProvider];
const connectKey    = document.getElementById('connect-key');
const connectionLine = document.getElementById('connection-line');
const settingsError = document.getElementById('settings-error');
const modelHint     = document.getElementById('model-hint');
const chatStream    = document.getElementById('chat-stream');
const chatInput     = document.getElementById('chat-input');
const chatSendButton = document.getElementById('chat-send');
const chatClear     = document.getElementById('chat-clear');
const chatPill      = document.getElementById('chat-pill');
const chatPillLabel = document.getElementById('chat-pill-label');
if (!/Mac|iPhone|iPad/.test(navigator.platform)) {
  chatPill.querySelector('kbd').textContent = 'Ctrl K';
  for (const key of document.querySelectorAll('kbd.mod')) key.textContent = 'Ctrl';
}
const editFeedback = document.getElementById('edit-feedback');
const noticeLive = document.getElementById('notice-live');
const chatPanel     = document.getElementById('chat');
const updateCheckEl = document.getElementById('update-check');
const themeToggleEl = document.getElementById('theme-toggle');
const updateBadge   = document.getElementById('update-badge');
const updateStatus  = document.getElementById('update-status');
const updateSection = document.getElementById('settings-updates');

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const savedTheme = localStorage.getItem('wa-theme');
let currentTheme = savedTheme === 'dark' || savedTheme === 'light'
  ? savedTheme
  : (systemTheme.matches ? 'dark' : 'light');
function setTheme(theme, persist = true) {
  const root = document.documentElement;
  // Every color transition would otherwise fire at once on its own clock and
  // smear the swap: freeze them, flush the new values, then let them back.
  root.classList.add('no-transition');
  currentTheme = theme;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  themeToggleEl.checked = theme === 'dark';
  if (persist) localStorage.setItem('wa-theme', theme);
  void root.offsetHeight;
  requestAnimationFrame(() => root.classList.remove('no-transition'));
}
setTheme(currentTheme, false);
themeToggleEl.addEventListener('change', () => {
  themeToggleEl.classList.add('is-init'); // transitions-dev toggle: arm the bounce after mount
  setTheme(themeToggleEl.checked ? 'dark' : 'light');
});

// How much of the editor the floating panel covers. Measured, because the
// panel grows with its content: a fixed guess leaves the line being typed —
// and the suggestion under it — hidden behind the cards.
let chatHeight = 140;
// The open document's load and save state, shared by every part of the page.
const docState = createDocumentState();
// ─── Notices ─── (src/notices.js)
const notices = createNotices({
  editFeedback, noticeLive, chatPanel, chatInput,
  focusEditor: () => workView.focus(),
  openSettings: tab => openSettings(tab),
});
const { notify, notifyProblem, clearNotice, dismissPassingNotice } = notices;
function setSuggestStatus(text, detail) {
  suggestWorking = text.endsWith('…') ? text : '';
  syncPill();
  if (text && !suggestWorking) notify(text, { detail });
}

// A failed suggestion is about the model, not the text: report it even when
// the writer has typed on since. Background retries fire at every pause, so a
// passing failure is shown once per half minute; one only settings can fix
// stays until it is dealt with.
let lastSuggestFailure = 0;
function reportSuggestFailure(problem, manual) {
  if (!manual && problem.act !== 'settings' && Date.now() - lastSuggestFailure < 30_000) return;
  lastSuggestFailure = Date.now();
  const say = `Suggestions: ${problem.say}`;
  if (problem.act === 'settings') notifyProblem({ ...problem, say }, null, 'Try again', 'suggest-error');
  else notify(say, { detail: problem.detail, key: 'suggest-error', icon: 'alert', tone: 'error' });
}
let tabId;
try {
  if (!sessionStorage.getItem('stilura-tab') && sessionStorage.getItem('litura-tab')) sessionStorage.setItem('stilura-tab', sessionStorage.getItem('litura-tab'));
  tabId = sessionStorage.getItem('stilura-tab') || crypto.randomUUID();
  sessionStorage.setItem('stilura-tab', tabId);
} catch { tabId = crypto.randomUUID(); }
const docStorage = {
  getItem(key) { try { return docState.documentKey ? (key === 'wa-working' ? localStorage.getItem(docState.documentKey + key + ':' + tabId) : null) ?? localStorage.getItem(docState.documentKey + key) : null; } catch { return null; } },
  setItem(key, value) { try { if (docState.documentKey) { localStorage.setItem(docState.documentKey + key, value); if (key === 'wa-working') localStorage.setItem(docState.documentKey + key + ':' + tabId, value); } } catch { notify('Browser backup unavailable — keep this tab open until saved', { sticky: true, key: 'backup' }); } },
  removeItem(key) { try { if (docState.documentKey) localStorage.removeItem(docState.documentKey + key); } catch {} },
};
const jobs = new Set();
// JSON in storage can be stale, truncated, or hand-edited. A corrupt value
// must read as its fallback, never throw at the call site.
// Background work is the writer's text being checked while they type; it is
// not something they pressed send for. Only what they started turns the send
// button into a stop button.
function startJob({ background = false } = {}) {
  const job = new AbortController();
  job.background = background;
  jobs.add(job);
  syncSend();
  return job;
}
function finishJob(job) {
  jobs.delete(job);
  syncSend();
}
// While the model is working, the send button is the work: it spins where the
// writer is already looking, and pressing it stops what it is showing.
function stopJobs() {
  for (const job of jobs) job.abort();
  cancelSuggestion();
}

// ─── Stored state across versions ──────────────────────────────────────────
// Bumped only when stored chat turns change shape. The
// draft (`wa-working`, mirrored to draft.md) is never cleared here: it is the
// only state the writer cannot regenerate.
const STORAGE_SCHEMA = '1';
if (localStorage.getItem('wa-schema') !== STORAGE_SCHEMA) {
  docStorage.removeItem('wa-chat');
  localStorage.setItem('wa-schema', STORAGE_SCHEMA);
}

const thinkingNames = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum' };
let agentInfo = { available: false, providers: [], models: [], authProviders: [] };
let agentSelection = null;
try { agentSelection = JSON.parse(localStorage.getItem('wa-agent') || 'null'); } catch {}
let draftSelection = agentSelection;

const levelsFor = model => model?.thinkingLevels?.length
  ? model.thinkingLevels
  : model?.reasoning ? ['off', 'low', 'medium', 'high'] : ['off'];

function normalizeSelection(selection) {
  const model = agentInfo.models.find(item => item.provider === selection?.provider && item.model === selection?.model);
  if (!model) return null;
  const levels = levelsFor(model);
  const thinkingLevel = levels.includes(selection.thinkingLevel)
    ? selection.thinkingLevel
    : levels.includes('medium') ? 'medium' : levels[0];
  return { provider: model.provider, model: model.model, thinkingLevel };
}

function currentAgent() {
  return normalizeSelection(agentSelection);
}

function saveAgentSelection() {
  const normalized = normalizeSelection(draftSelection);
  if (!normalized) return;
  draftSelection = normalized;
  agentSelection = normalized;
  cancelSuggestion();
  ghostClear(workView);
  localStorage.setItem('wa-agent', JSON.stringify(agentSelection));
}

// Continuations share the editor's model; the server minimizes reasoning.
function activeSuggestAgent() { return currentAgent(); }

combobox(providerEl);
combobox(modelEl);

// Every provider the writer can reach, connected or not, in one list: the
// ones with models (connected), the ones that take an API key, and the
// subscriptions. Connected first, so the usual choice is at the top.
function providerChoices() {
  const byId = new Map();
  const add = (id, name, extra) => byId.set(id, { id, name, ...byId.get(id), ...extra });
  for (const provider of agentInfo.authProviders) add(provider.id, provider.name, { key: provider });
  for (const provider of oauthInfo.supported) add(provider.id, provider.label ?? provider.name, { signin: provider, name: provider.label ?? provider.name });
  for (const provider of agentInfo.providers) add(provider.id, provider.name);
  if (agentInfo.claudeCode) add(claudeProvider, 'Claude Code · Pro/Max');
  if (agentInfo.antigravity) add(antigravityProvider, 'Antigravity');
  const choices = [...byId.values()].map(choice => ({ ...choice, connected: agentInfo.models.some(model => model.provider === choice.id) }));
  return choices.sort((a, b) => b.connected - a.connected || a.name.localeCompare(b.name));
}

// A provider picked in the list but not connected yet. It is not a selection:
// nothing is saved until it connects and has a model.
let draftProvider = null;
let modelSetup = '';
let guidedStep = 1;
const chatService = document.getElementById('service-chatgpt');
const claudeService = document.getElementById('service-claude');
const antigravityService = document.getElementById('service-antigravity');
const apiService = document.getElementById('service-api');
const apiModelSettings = document.getElementById('api-model-settings');
const guidedStepsEl = document.getElementById('guided-steps');
const guidedBackRowEl = document.getElementById('guided-back-row');
const guidedReadyEl = document.getElementById('guided-ready');

function syncGuidedMode() {
  const isGuided = settingsDialog.dataset.guided === 'true' && settingsDialog.dataset.tab === 'models';
  if (!isGuided) {
    delete settingsDialog.dataset.guidedStep;
    guidedStepsEl.hidden = true;
    guidedBackRowEl.hidden = true;
    guidedReadyEl.hidden = true;
    return;
  }
  if (currentAgent()) guidedStep = 3;
  else if (guidedStep === 3) guidedStep = 2;
  settingsDialog.dataset.guidedStep = String(guidedStep);
  guidedStepsEl.hidden = false;
  guidedBackRowEl.hidden = guidedStep < 2;
  guidedReadyEl.hidden = guidedStep !== 3;
  for (const pill of guidedStepsEl.querySelectorAll('.guided-step')) {
    const n = Number(pill.dataset.step);
    pill.classList.toggle('is-now', n === guidedStep);
    pill.classList.toggle('is-done', n < guidedStep);
  }
}

function renderModelSettings() {
  draftSelection = normalizeSelection(draftSelection)
    ?? normalizeSelection(agentInfo.defaultSelection)
    ?? (agentInfo.models[0] ? normalizeSelection({ ...agentInfo.models[0], thinkingLevel: 'medium' }) : null);
  const choices = providerChoices();
  const apiChoices = choices.filter(choice => !choice.signin && choice.id !== claudeProvider && choice.id !== antigravityProvider);
  const apiOpen = modelSetup === 'api';
  const guided = settingsDialog.dataset.guided === 'true';
  const activeAgent = currentAgent();
  const id = modelSetup && !apiOpen ? modelSetup : activeAgent?.provider;
  const showSubscriptionModel = !guided && subscriptionProviders.includes(id) && Boolean(modelFor(id));
  document.getElementById('writing-model-heading').textContent = guided ? 'Connect your writing assistant' : 'Writing model';
  apiModelSettings.hidden = !apiOpen && !showSubscriptionModel;
  document.getElementById('provider-field').hidden = !apiOpen;
  apiService.setAttribute('aria-expanded', String(apiOpen));
  for (const [tab, section] of [[chatService, 'openai-codex'], [claudeService, claudeProvider], [antigravityService, antigravityProvider], [apiService, 'api']]) {
    if (guided) tab.removeAttribute('aria-pressed');
    else tab.setAttribute('aria-pressed', String(section === (apiOpen ? 'api' : id)));
  }
  setOptions(providerEl, apiChoices.map(choice => ({
    value: choice.id,
    label: choice.connected ? choice.name : `${choice.name} · not connected`,
  })), draftProvider ?? draftSelection?.provider);
  const provider = choices.find(choice => choice.id === (apiOpen ? fieldValue(providerEl) : id));
  const connected = !!provider?.connected;
  modelField.hidden = !(connected && (apiOpen || showSubscriptionModel));
  thinkingField.hidden = modelField.hidden || provider?.id === claudeProvider || provider?.id === antigravityProvider;
  for (const [card, id, label] of [
    [chatService, 'openai-codex', 'Plus or Pro'],
    [claudeService, claudeProvider, 'Claude Pro or Max'],
    [antigravityService, antigravityProvider, 'Google AI · agy'],
  ]) {
    const model = modelFor(id);
    const active = currentAgent()?.provider === id;
    const plan = id === claudeProvider && agentInfo.claudeCode?.plan;
    const tier = id === antigravityProvider && agentInfo.antigravity?.tier;
    const modelLabel = model?.name || model?.model;
    const modelName = plan ? `Claude ${plan === 'max' ? 'Max' : 'Pro'} · ${modelLabel}`
      : tier ? `${tier} · ${modelLabel}`
      : modelLabel;
    card.querySelector('small').textContent = model ? `${active ? '' : 'Connected · '}${modelName}` : label;
    card.classList.toggle('is-active', active);
    card.classList.toggle('is-connected', Boolean(model));
    if (active) card.setAttribute('aria-current', 'true');
    else card.removeAttribute('aria-current');
    card.disabled = !choices.some(choice => choice.id === id);
  }
  const chatAction = document.getElementById('chat-service-action');
  const chat = choices.find(choice => choice.id === 'openai-codex');
  chatAction.hidden = apiOpen || id !== 'openai-codex' || !chat?.signin?.configured;
  if (!chatAction.hidden && !chatAction.firstChild) chatAction.append(signOutButton(chat));
  if (chatAction.hidden) chatAction.replaceChildren();
  const activeIsApi = Boolean(activeAgent && !subscriptionProviders.includes(activeAgent.provider));
  const activeApiChoice = activeIsApi ? choices.find(choice => choice.id === activeAgent.provider) : null;
  const activeApiModel = activeIsApi ? agentInfo.models.find(item => item.provider === activeAgent.provider && item.model === activeAgent.model) : null;
  apiService.querySelector('small').textContent = activeIsApi
    ? `${activeApiChoice?.name ?? activeAgent.provider} · ${activeApiModel?.name || activeAgent.model}`
    : 'Choose a provider';
  apiService.classList.toggle('is-active', activeIsApi);
  apiService.classList.toggle('is-connected', apiChoices.some(choice => choice.connected));
  if (activeIsApi) apiService.setAttribute('aria-current', 'true');
  else apiService.removeAttribute('aria-current');
  chatService.setAttribute('aria-expanded', String(id === 'openai-codex' && !connected));
  claudeService.setAttribute('aria-expanded', String(id === claudeProvider && !connected));
  antigravityService.setAttribute('aria-expanded', String(id === antigravityProvider && !connected));
  if (connected && (apiOpen || showSubscriptionModel)) {
    const models = agentInfo.models.filter(model => model.provider === provider.id);
    setOptions(modelEl, models.map(model => ({ value: model.model, label: model.name || model.model })), draftSelection?.model);
    const model = models.find(item => item.model === fieldValue(modelEl));
    const levels = levelsFor(model);
    setOptions(thinkingEl, levels.map(level => ({ value: level, label: thinkingNames[level] ?? level })), draftSelection?.thinkingLevel);
    draftSelection = model ? { provider: model.provider, model: model.model, thinkingLevel: fieldValue(thinkingEl) } : null;
  }
  modelHint.textContent = !choices.length ? 'No providers found. Check that Pi is installed.'
    : provider && !connected && (provider.signin || provider.key) ? `Connect ${provider.name} to choose a model.` : '';
  renderConnection(provider);
  syncGuidedMode();
}

// Under the fields: how the chosen provider connects, or how it is
// connected with the way back out. The provider list already puts the
// connected ones first, so nothing else repeats them.
function renderConnection(provider) {
  const connected = !!provider?.connected;
  connectRow.hidden = !provider || connected;
  connectSignin.hidden = connectRow.hidden || !provider.signin || modelSetup !== 'openai-codex';
  connectClaude.hidden = connectRow.hidden || provider.id !== claudeProvider;
  if (!connectClaude.hidden) {
    const status = agentInfo.claudeCode ?? {};
    const installed = Boolean(status.installed);
    const claudeInstalled = status.claudeInstalled ?? installed;
    const adapterInstalled = status.adapterInstalled ?? installed;
    document.getElementById('claude-connect-hint').textContent = installed
      ? 'Sign in with Claude Pro or Max in Terminal, then check the connection here.'
      : claudeInstalled && !adapterInstalled
        ? 'Claude Code is installed, but the ACP adapter is missing. Install it in Terminal, then check the connection here.'
        : !claudeInstalled && adapterInstalled
          ? 'The ACP adapter is installed, but Claude Code CLI is missing. Install Claude Code, then sign in from Terminal.'
          : 'Install Claude Code and the ACP adapter, then sign in from Terminal.';
    document.getElementById('claude-command').hidden = !installed;
    const adapterCommand = document.getElementById('claude-adapter-command');
    if (adapterCommand) adapterCommand.hidden = adapterInstalled;
    document.getElementById('claude-install').hidden = installed;
  }
  connectAntigravity.hidden = connectRow.hidden || provider.id !== antigravityProvider;
  if (!connectAntigravity.hidden) {
    const installed = Boolean(agentInfo.antigravity?.installed);
    document.getElementById('antigravity-connect-hint').textContent = installed
      ? 'Sign in to Antigravity in Terminal, then check the connection here.'
      : 'Install Antigravity (agy), then sign in from Terminal.';
    document.getElementById('antigravity-command').hidden = !installed;
    document.getElementById('antigravity-install').hidden = installed;
  }
  connectKey.hidden = connectRow.hidden || modelSetup !== 'api' || !provider.key;
  if (!connectKey.hidden) {
    apiKeyEl.placeholder = provider.key.label ?? 'API key';
    document.getElementById('api-key-label').textContent = `${provider.name} API key`;
    document.getElementById('api-key-hint').textContent = `Stored on this computer. Sent only to ${provider.name}.`;
  }
  const statusEl = text => {
    const span = document.createElement('span');
    span.className = 'connection-status';
    span.textContent = text;
    return span;
  };
  const line = [];
  if (connected && subscriptionProviders.includes(provider.id)) {
    // Subscription status is shown on its service card.
  } else if (connected && provider.key?.configured && provider.key.source !== 'environment') {
    line.push(statusEl('Connected with an API key. '), removeKeyButton(provider));
  } else if (connected) {
    line.push(statusEl(provider.key?.source === 'environment' ? `Connected to ${provider.name} with a key from the environment.` : `Connected to ${provider.name}.`));
  } else if (provider && !provider.signin && !provider.key && provider.id !== claudeProvider && provider.id !== antigravityProvider) {
    line.push('This provider is configured outside Stilura.');
  }
  connectionLine.replaceChildren(...line);
}

const choiceName = id => providerChoices().find(choice => choice.id === id)?.name ?? id;

function linkButton(label, title, run) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', run);
  return button;
}

// A removed key or sign-out cannot be undone from here: the first press only
// arms the button, the second acts. Blur or Escape disarms it.
function armedActionButton({ label, title, armedLabel, armedAriaLabel, onConfirm }) {
  const button = linkButton(label, title, () => {
    if (button.classList.contains('is-armed')) return onConfirm();
    button.classList.add('is-armed');
    button.textContent = armedLabel;
    button.ariaLabel = armedAriaLabel;
  });
  const disarm = () => {
    button.classList.remove('is-armed');
    button.textContent = label;
    button.removeAttribute('aria-label');
  };
  button.addEventListener('blur', disarm);
  button.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !button.classList.contains('is-armed')) return;
    event.preventDefault();
    event.stopPropagation();
    disarm();
  });
  return button;
}

function removeKeyButton(provider) {
  return armedActionButton({
    label: 'Remove key',
    title: `Remove ${provider.name} key`,
    armedLabel: 'Press again to remove',
    armedAriaLabel: `Confirm: remove ${provider.name} key`,
    onConfirm: () => removeProviderKey(provider.id),
  });
}

function signOutButton(provider) {
  return armedActionButton({
    label: 'Sign out',
    title: `Sign out of ${provider.name}`,
    armedLabel: 'Press again to sign out',
    armedAriaLabel: `Confirm: sign out of ${provider.name}`,
    onConfirm: () => removeProviderKey(provider.id),
  });
}

// The model a provider starts on: the one in use if it is this provider's,
// else the server's default or sign-in recommendation for it, else its first
// reasoning model.
function modelFor(id) {
  const models = agentInfo.models.filter(model => model.provider === id);
  const named = [agentSelection, agentInfo.defaultSelection,
    { model: oauthInfo.supported.find(provider => provider.id === id)?.recommended }]
    .map(selection => (!selection?.provider || selection.provider === id) && models.find(model => model.model === selection?.model))
    .find(Boolean);
  return named || models.find(model => model.reasoning) || models[0];
}

// Picking a connected provider picks a model at once and saves it; an
// unconnected one only shows how to connect it.
function selectProvider(id) {
  settingsError.textContent = '';
  const chosen = modelFor(id);
  draftProvider = chosen ? null : id;
  if (chosen) draftSelection = { provider: id, model: chosen.model, thinkingLevel: agentSelection?.provider === id ? agentSelection.thinkingLevel : 'medium' };
  renderModelSettings();
  if (chosen) { saveAgentSelection(); renderModelSettings(); }
}
const connectedTo = selectProvider;


async function refreshAgent({ force = false } = {}) {
  agentInfo = await api(force ? '/api/agent/status?refresh=1' : '/api/agent/status');
  const savedNormalized = normalizeSelection(agentSelection);
  if (savedNormalized) {
    // Saved model still exists in current catalog — keep it.
    agentSelection = savedNormalized;
    localStorage.setItem('wa-agent', JSON.stringify(agentSelection));
  }
  // If saved model not in current catalog, do NOT overwrite with default.
  // Leave the stale selection in localStorage so the user sees it in
  // settings and can re-pick. The defaultSelection is only used when
  // there is no saved selection at all — or when it was a ChatGPT model the
  // subscription refused or no longer serves: the writer never picked that
  // one by hand, sign-in did.
  else if ((!agentSelection || agentSelection.provider === 'openai-codex') && agentInfo.defaultSelection) {
    agentSelection = normalizeSelection(agentInfo.defaultSelection);
    if (agentSelection) localStorage.setItem('wa-agent', JSON.stringify(agentSelection));
  }
  return agentInfo;
}

const settingsTabs = [...settingsDialog.querySelectorAll('.settings-tabs [role="tab"]')];
function showSettingsTab(name, focus = false) {
  settingsDialog.dataset.tab = name;
  for (const tab of settingsTabs) {
    const on = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on && focus) tab.focus();
  }
  document.getElementById('settings-panel').setAttribute('aria-labelledby', `tab-${name}`);
  document.getElementById('settings-panel').scrollTop = 0;
  if (name !== 'models') delete settingsDialog.dataset.guided;
  if (settingsDialog.open && name === 'models') renderModelSettings();
  else syncGuidedMode();
}
for (const tab of settingsTabs) {
  tab.addEventListener('click', () => showSettingsTab(tab.dataset.tab));
  tab.addEventListener('keydown', event => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? settingsTabs.length - 1
      : step ? (settingsTabs.indexOf(tab) + step + settingsTabs.length) % settingsTabs.length : -1;
    if (index < 0) return;
    event.preventDefault();
    showSettingsTab(settingsTabs[index].dataset.tab, true);
  });
}
showSettingsTab(settingsDialog.dataset.tab);

// `tab` picks the tab to land on; a click passes its event, which is ignored
// and leaves the tab the writer was last on. 'welcome' is the first-run way
// in: the Model tab with the ChatGPT card focused.
async function openSettings(tab) {
  const welcome = tab === 'welcome';
  if (typeof tab === 'string') showSettingsTab(welcome ? 'models' : tab);
  settingsError.textContent = '';
  try { await refreshAgent(); } catch (error) { settingsError.textContent = error.message; }
  await refreshOAuth();
  draftSelection = currentAgent();
  draftProvider = null;
  if (welcome || !draftSelection) {
    settingsDialog.dataset.guided = 'true';
    guidedStep = 1;
  } else {
    delete settingsDialog.dataset.guided;
    guidedStep = 1;
  }
  modelSetup = draftSelection && !subscriptionProviders.includes(draftSelection.provider) ? 'api' : '';
  renderModelSettings();
  renderOAuthFlow();
  if (!settingsDialog.open) settingsDialog.showModal();
  else pollOAuth();
  // First run says why the dialog opened; the next opening reads normally.
  document.getElementById('settings-sub').textContent = welcome
    ? 'Connect a service to start writing with AI.'
    : 'Changes save as you make them.';
  if (welcome && !chatService.disabled) chatService.focus();
}

settingsOpen.addEventListener('click', openSettings);
document.getElementById('claude-copy').addEventListener('click', async event => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText('claude auth login');
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  } catch { button.textContent = 'Copy failed'; }
});
document.getElementById('claude-adapter-copy')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText('npm i -g @agentclientprotocol/claude-agent-acp');
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  } catch { button.textContent = 'Copy failed'; }
});
document.getElementById('claude-recheck').addEventListener('click', async event => {
  const button = event.currentTarget;
  const prevText = button.textContent;
  button.disabled = true;
  button.textContent = 'Checking…';
  settingsError.textContent = '';
  try {
    await refreshAgent({ force: true });
    if (modelSetup !== claudeProvider) return;
    selectProvider(claudeProvider);
    if (!agentInfo.claudeCode?.plan) settingsError.textContent = 'Claude Code is not connected to a Pro or Max account.';
  } catch (error) { settingsError.textContent = error.message; }
  finally {
    button.disabled = false;
    button.textContent = prevText;
  }
});
document.getElementById('antigravity-copy')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText('agy acp --login');
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  } catch { button.textContent = 'Copy failed'; }
});
document.getElementById('antigravity-recheck')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const prevText = button.textContent;
  button.disabled = true;
  button.textContent = 'Checking…';
  settingsError.textContent = '';
  try {
    await refreshAgent({ force: true });
    if (modelSetup !== antigravityProvider) return;
    selectProvider(antigravityProvider);
    if (!agentInfo.antigravity?.loggedIn) {
      settingsError.textContent = agentInfo.antigravity?.installed
        ? 'Antigravity is not signed in. Run agy acp --login in Terminal.'
        : 'Antigravity (agy) was not found. Install it and check again.';
    }
  } catch (error) { settingsError.textContent = error.message; }
  finally {
    button.disabled = false;
    button.textContent = prevText;
  }
});
// transitions-dev modal close (06-modal.md): play .is-closing (150ms) before
// .close() so exit mirrors enter; Escape stays instant (native), class is
// cleaned on 'close'. Timing reads --modal-close-dur to stay in sync with CSS.
function closeSettingsAnimated() {
  if (!settingsDialog.open || settingsDialog.classList.contains('is-closing')) return;
  const closeMs = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')
  ) || 150;
  settingsDialog.classList.add('is-closing');
  setTimeout(() => settingsDialog.close(), closeMs);
}
settingsDialog.addEventListener('close', () => {
  settingsDialog.classList.remove('is-closing');
  // A picker left open would outlive the dialog: invisible, still holding
  // keystrokes, and flashing back in on the next open.
  for (const popover of settingsDialog.querySelectorAll(':popover-open')) popover.hidePopover();
});
settingsDialog.querySelector('.dialog-close').addEventListener('click', closeSettingsAnimated);

// Without a model every AI action fails in the console and the editor just
// looks broken. Send the writer to the one place that fixes it instead.
async function ensureAgent() {
  if (docState.loadingDocument) { notify('Wait until the draft is loaded'); return false; }
  if (currentAgent()) return true;
  // The status call may still be in flight on a fresh load — ask once more
  // before telling the writer their setup is missing.
  try { await refreshAgent(); } catch {}
  if (currentAgent()) return true;
  openSettings('welcome');
  return false;
}

providerEl.addEventListener('change', () => selectProvider(fieldValue(providerEl)));
modelEl.addEventListener('change', () => {
  draftSelection = { provider: modelSetup === 'api' ? fieldValue(providerEl) : modelSetup || currentAgent()?.provider, model: fieldValue(modelEl), thinkingLevel: draftSelection?.thinkingLevel ?? 'medium' };
  saveAgentSelection();
  renderModelSettings();
});
// A popover left open behind a closed dialog comes back with it.
settingsDialog.addEventListener('close', () => {
  for (const popover of document.querySelectorAll('.combo')) {
    if (popover.matches(':popover-open')) popover.hidePopover();
  }
});
thinkingEl.addEventListener('change', () => {
  if (draftSelection) draftSelection = { ...draftSelection, thinkingLevel: fieldValue(thinkingEl) };
  saveAgentSelection();
});

// The settings form has no method="dialog" on purpose: Enter in the key field
// adds the key (below) instead of closing the whole dialog. Stop any implicit
// submit from navigating or dismissing as well.
document.getElementById('settings-form').addEventListener('submit', event => event.preventDefault());

const keyToggleEl = document.getElementById('key-toggle');
apiKeyEl.addEventListener('input', () => {
  apiKeyEl.removeAttribute('aria-invalid');
  // transitions-dev error shake: typing clears the error at once.
  if (apiKeyEl._revertTimer) { clearTimeout(apiKeyEl._revertTimer); apiKeyEl._revertTimer = null; }
  apiKeyEl.classList.remove('is-error');
});
apiKeyEl.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !keyAddEl.disabled) { event.preventDefault(); keyAddEl.click(); }
});
keyToggleEl.addEventListener('click', () => {
  const show = apiKeyEl.type === 'password';
  apiKeyEl.type = show ? 'text' : 'password';
  keyToggleEl.textContent = show ? 'Hide' : 'Show';
  keyToggleEl.setAttribute('aria-label', show ? 'Hide API key' : 'Show API key');
  apiKeyEl.focus();
});

// Add stays enabled and validates on press: a disabled button cannot be
// focused and never says why it does nothing. It is disabled only while the
// request runs, so a double press cannot add the key twice.
async function addProviderKey() {
  if (!apiKeyEl.value.trim()) {
    settingsError.textContent = 'Paste an API key to connect.';
    apiKeyEl.setAttribute('aria-invalid', 'true');
    showKeyError();
    apiKeyEl.focus();
    return;
  }
  settingsError.textContent = '';
  keyAddEl.disabled = true;
  const provider = fieldValue(providerEl);
  try {
    agentInfo = await api('/api/agent/credentials', {
      method: 'POST',
      body: JSON.stringify({ provider, apiKey: apiKeyEl.value }),
    });
    apiKeyEl.value = '';
    if (agentInfo.models.some(model => model.provider === provider)) connectedTo(provider);
    else {
      renderModelSettings();
      settingsError.textContent = `Key saved, but ${choiceName(provider)} lists no models for it. Check the key's access.`;
    }
  } catch (error) {
    settingsError.textContent = error.message;
    apiKeyEl.setAttribute('aria-invalid', 'true');
    showKeyError();
  }
  finally { keyAddEl.disabled = false; }
}
keyAddEl.addEventListener('click', addProviderKey);

// transitions-dev error state shake (12-error-state-shake.md): replay the
// shake from a clean baseline, hold the border long enough to read the
// message, then fade back to neutral. Timer tracks the latest call.
function showKeyError() {
  const cs = getComputedStyle(document.documentElement);
  const ms = (name, fb) => {
    const v = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(v) ? v : fb;
  };
  apiKeyEl.classList.add('is-error');
  apiKeyEl.classList.remove('is-shaking');
  void apiKeyEl.offsetWidth; // flush the rest state so the shake replays
  apiKeyEl.classList.add('is-shaking');
  const shakeMs = ms('--shake-dur-a', 80) * 2 + ms('--shake-dur-b', 60) * 2;
  setTimeout(() => apiKeyEl.classList.remove('is-shaking'), shakeMs + 20);
  if (apiKeyEl._revertTimer) clearTimeout(apiKeyEl._revertTimer);
  apiKeyEl._revertTimer = setTimeout(() => {
    apiKeyEl._revertTimer = null;
    apiKeyEl.classList.remove('is-error');
  }, shakeMs + ms('--revert-hold', 3000));
}

async function removeProviderKey(provider) {
  settingsError.textContent = '';
  try {
    agentInfo = await api('/api/agent/credentials', { method: 'DELETE', body: JSON.stringify({ provider }) });
    // Signed out of the model in use: forget it, so the next AI action shows
    // the welcome (or the default model, if another provider has a key).
    if (agentSelection?.provider === provider) {
      agentSelection = draftSelection = null;
      localStorage.removeItem('wa-agent');
      await refreshAgent();
    }
    // Stay on that provider, now showing how to connect it again.
    draftProvider = provider;
    await refreshOAuth();
  } catch (error) { settingsError.textContent = error.message; }
}

// ─── Subscription sign-in (OAuth) ──────────────────────────────────────────
// Only allowlisted providers (see pi.js) — currently ChatGPT Plus/Pro via the
// Codex OAuth flow. The server runs Pi's login in the background; here we
// show the auth URL (or device code), offer the manual-paste fallback, and
// poll until the flow settles.
const oauthFlowEl   = document.getElementById('oauth-flow');
const oauthStatusEl = document.getElementById('oauth-status');
const oauthUrlWrap  = document.getElementById('oauth-url-wrap');
const oauthUrlEl    = document.getElementById('oauth-url');
const oauthDeviceWrap = document.getElementById('oauth-device-wrap');
const oauthDeviceLink = document.getElementById('oauth-device-link');
const oauthDeviceCode = document.getElementById('oauth-device-code');
const oauthPasteWrap = document.getElementById('oauth-paste-wrap');
const oauthCodeEl   = document.getElementById('oauth-code');
const oauthSendEl   = document.getElementById('oauth-send');
const oauthCancelEl = document.getElementById('oauth-cancel');
let oauthInfo = { supported: [], active: null };
let oauthTimer = null;
let oauthTab = null;

function closeOAuthTab() {
  try { oauthTab?.close(); } catch {}
  oauthTab = null;
}

function stopOAuthPoll() {
  if (oauthTimer) { clearTimeout(oauthTimer); oauthTimer = null; }
}

function oauthActivePending() {
  const step = oauthInfo.active?.step;
  return step === 'starting' || step === 'url' || step === 'device';
}

// Sign-in state changes what the provider list and connect row show.
function renderSubscriptions() {
  renderModelSettings();
  renderOAuthFlow();
}

function renderOAuthFlow() {
  const active = oauthInfo.active;
  const pending = oauthActivePending();
  oauthFlowEl.hidden = !active || (!pending && active.step !== 'error');
  oauthFlowEl.classList.toggle('is-pending', pending);
  oauthFlowEl.classList.toggle('is-error', active?.step === 'error');
  if (oauthFlowEl.hidden) { stopOAuthPoll(); return; }
  if (active.step === 'error') {
    oauthStatusEl.textContent = `Sign-in didn't finish.${active.error ? ` ${active.error}.` : ''} Try again.`;
    oauthUrlWrap.hidden = true;
    oauthDeviceWrap.hidden = true;
    oauthPasteWrap.hidden = true;
    oauthCancelEl.textContent = 'Dismiss';
    stopOAuthPoll();
    return;
  }
  oauthCancelEl.textContent = 'Cancel';
  oauthStatusEl.textContent = active.step === 'device'
    ? 'Waiting for you to approve on the verification page…'
    : 'Finish signing in in the new tab.';
  if (active.url) {
    oauthUrlWrap.hidden = false;
    oauthUrlEl.href = active.url;
    oauthUrlEl.textContent = 'Open the sign-in page';
  } else oauthUrlWrap.hidden = true;
  if (active.step === 'device' && active.userCode) {
    oauthDeviceWrap.hidden = false;
    oauthDeviceLink.href = active.verificationUri || '#';
    oauthDeviceCode.textContent = active.userCode;
  } else oauthDeviceWrap.hidden = true;
  // The localhost callback usually completes on its own; the paste box stays
  // for the case it never fires (busy port, hardened browser).
  oauthPasteWrap.hidden = false;
}

async function pollOAuth(finishing = false) {
  stopOAuthPoll();
  // Keeps going with the dialog closed: the browser sign-in finishes in
  // another tab, and the writer may have closed settings to wait.
  if (!oauthActivePending() && !finishing) return;
  try {
    const status = await api('/api/agent/oauth/status');
    if (status.active?.step === 'done') {
      // Keep the pending state until model refresh succeeds, so a transient
      // failure here can retry the completion rather than losing it.
      await refreshAgent();
      oauthInfo = status;
      renderSubscriptions();
      closeOAuthTab();
      signedIn(status.active.provider);
      return;
    }
    oauthInfo = status;
    renderSubscriptions();
    if (oauthActivePending()) {
      oauthTimer = setTimeout(pollOAuth, 2000);
    }
  } catch { oauthTimer = setTimeout(() => pollOAuth(finishing), 5000); }
}

// Signing in is choosing that provider: switch to its recommended model even
// over an earlier choice, then get out of the way.
function signedIn(provider) {
  draftProvider = null;
  const recommended = oauthInfo.supported.find(item => item.id === provider)?.recommended;
  const models = agentInfo.models.filter(item => item.provider === provider);
  const model = models.find(item => item.model === recommended) ?? models[0];
  if (!model) {
    settingsError.textContent = 'Signed in, but ChatGPT did not return an available model.';
    return;
  }
  draftSelection = { provider, model: model.model, thinkingLevel: 'medium' };
  saveAgentSelection();
  renderModelSettings();
  const chosen = agentInfo.models.find(item => item.provider === currentAgent()?.provider && item.model === currentAgent()?.model);
  if (!chosen || chosen.provider !== provider) return;
  if (typeof settingsDialog !== 'undefined' && settingsDialog.dataset.guided === 'true') return;
  closeSettingsAnimated();
  notify(`Signed in with ChatGPT. Writing with ${chosen.name ?? chosen.model}.`, { action: () => openSettings('models'), label: 'Change' });
}

async function startOAuthFlow(provider, method) {
  settingsError.textContent = '';
  // Popup blockers only honour windows opened inside the click itself, and
  // the auth URL arrives after a round-trip — so park a blank tab now and
  // navigate it once the URL lands. If it never lands, the link in the flow
  // box below takes over as the manual fallback.
  closeOAuthTab();
  const authTab = method === 'browser' ? window.open('about:blank', '_blank') : null;
  oauthTab = authTab;
  try {
    oauthInfo = await api('/api/agent/oauth/start', {
      method: 'POST',
      body: JSON.stringify({ provider, method }),
    });
    oauthCodeEl.value = '';
    renderSubscriptions();
    pollOAuth();
    const url = oauthInfo.active?.url;
    if (authTab) {
      if (url) authTab.location.href = url;
      else authTab.close();
    }
  } catch (error) {
    try { authTab?.close(); } catch {}
    settingsError.textContent = error.message;
  }
}

async function refreshOAuth() {
  try {
    oauthInfo = await api('/api/agent/oauth/status');
    renderSubscriptions();
  } catch { /* settings already show the last known state */ }
}

oauthSendEl.addEventListener('click', async () => {
  if (!oauthCodeEl.value.trim()) return;
  settingsError.textContent = '';
  try {
    oauthInfo = await api('/api/agent/oauth/code', {
      method: 'POST',
      body: JSON.stringify({ code: oauthCodeEl.value }),
    });
    oauthCodeEl.value = '';
    renderSubscriptions();
    pollOAuth(oauthInfo.active?.step === 'done');
  } catch (error) { settingsError.textContent = error.message; }
});
oauthCancelEl.addEventListener('click', async () => {
  try {
    oauthInfo = await api('/api/agent/oauth/cancel', { method: 'POST' });
    closeOAuthTab();
    renderSubscriptions();
    pollOAuth();
  } catch (error) { settingsError.textContent = error.message; }
});

chatService.addEventListener('click', () => {
  modelSetup = 'openai-codex';
  if (settingsDialog.dataset.guided === 'true') guidedStep = 2;
  selectProvider('openai-codex');
  if (!modelFor('openai-codex') && !oauthActivePending()) void startOAuthFlow('openai-codex', 'browser');
});
claudeService.addEventListener('click', () => {
  modelSetup = claudeProvider;
  if (settingsDialog.dataset.guided === 'true') guidedStep = 2;
  selectProvider(claudeProvider);
});
antigravityService.addEventListener('click', () => {
  modelSetup = antigravityProvider;
  if (settingsDialog.dataset.guided === 'true') guidedStep = 2;
  selectProvider(antigravityProvider);
});
apiService.addEventListener('click', () => {
  const fromStep1 = settingsDialog.dataset.guided === 'true' && guidedStep === 1;
  modelSetup = fromStep1 ? 'api' : (modelSetup === 'api' ? '' : 'api');
  if (settingsDialog.dataset.guided === 'true' && modelSetup === 'api') guidedStep = 2;
  draftProvider = null;
  renderModelSettings();
  if (modelSetup === 'api') providerEl.focus();
});
document.getElementById('guided-back')?.addEventListener('click', () => {
  guidedStep = 1;
  modelSetup = '';
  draftProvider = null;
  renderModelSettings();
});
document.getElementById('guided-done')?.addEventListener('click', () => closeSettingsAnimated());
document.getElementById('connect-browser')?.addEventListener('click', () => startOAuthFlow('openai-codex', 'browser'));
document.getElementById('connect-device').addEventListener('click', () => startOAuthFlow('openai-codex', 'device_code'));
document.getElementById('oauth-copy-code')?.addEventListener('click', event => {
  const button = event.currentTarget;
  const code = oauthDeviceCode.textContent;
  if (!code) return;
  navigator.clipboard?.writeText(code).then(() => {
    button.textContent = 'Copied';
    setTimeout(() => { if (button.isConnected) button.textContent = 'Copy code'; }, 1500);
  }).catch(() => {});
});

// First run: no model anywhere means every AI action would fail, so offer the
// way in at once instead of waiting for the writer to hit that wall.
refreshAgent().then(() => {
  if (!currentAgent() && !settingsDialog.open) openSettings('welcome');
}).catch(error => notifyProblem({ say: 'Could not load models.', act: 'retry', detail: error.message }, refreshAgent));

// ─── Ghost text ─── (src/editor/ghost.js)

// ─── Spelling marks ─── (src/editor/spelling.js)
const spelling = createSpelling({ view: () => workView });
const { schedule: scheduleSpellCheck, run: runSpellCheck } = spelling;

document.addEventListener('keydown', event => {
  if (event.defaultPrevented || (event.key === 'Escape' && event.target.closest('.file-action-panel:popover-open'))) return;
  if (event.key === 'Escape' && !markBubble.hidden) { hideMarkBubble(); workView.focus(); return; }
  if (event.key === 'Escape' && plainPreview) { clearPlainPreview(); workView.focus(); return; }
  // Last, so the lighter dismissals above still win. On a narrow window the
  // sidebar is a layer over the text, and Escape is how a layer goes away.
  // The composer claims Escape for itself only while it holds a request, and claims it by stopping the event on the way out — so
  // there is nothing left to check here. Tested any looser, the panel became
  // undismissable by key, because the focus is almost always in the draft and
  // the draft has no Escape of its own to spend. The scrim is the way out for
  // a hand that is not on the keyboard.
  if (event.key === 'Escape' && sidebarIsOverlay()) { setSidebar(false); return; }
});
// A press outside the bubble puts it away; a mark click re-opens its own on
// the following click event, so hiding here never swallows an opening.
document.addEventListener('mousedown', event => {
  if (!markBubble.hidden && !markBubble.contains(event.target)) hideMarkBubble();
}, true);
// Selecting with the mouse offers the one explicit context action; keyboard
// selections keep Cmd+K. Copying is acting on the text, not asking — no bubble.
document.addEventListener('mouseup', event => {
  if (!workView.dom.contains(event.target)) return;
  if (event.button === 2) return;
  if (workView.state.selection.main.empty) return;
  const { clientX, clientY } = event;
  deferBubble(() => showSelectionBubble(clientX, clientY), 250);
});
document.addEventListener('copy', () => { if (bubble.mode() === 'selection') hideMarkBubble(); });
// ─── Update check ─── (src/update.js)
const { refreshUpdate } = createUpdateCheck({ storage: localStorage, checkbox: updateCheckEl, badge: updateBadge, status: updateStatus, section: updateSection });

// ─── Suggestion system ─── (src/features/suggest.js)
let suggestWorking = '';   // "Suggesting…" while a request is out
const { cancelSuggestion, suggestSchedule, suggestionUpdate, suggestFetch, pending: suggestPending } = createSuggest({
  getView: () => workView,
  docState,
  generating: () => !!generate.job(),
  statusShown: () => !!suggestWorking,
  setSuggestStatus: (...args) => setSuggestStatus(...args),
  slashRequest: state => slashRequest(state),
  ensureAgent: () => ensureAgent(),
  activeSuggestAgent: () => activeSuggestAgent(),
  backgroundAllowed: () => ![claudeProvider, antigravityProvider].includes(currentAgent()?.provider),
  currentAgent: () => currentAgent(),
  briefContext: () => briefContext(),
  startJob: options => startJob(options),
  finishJob: job => finishJob(job),
  reportSuggestFailure: (problem, manual) => reportSuggestFailure(problem, manual),
});

// ─── Generate in the draft ─── (src/features/generate.js)
const generate = createGenerate({
  jobs,
  docState,
  passageFx: () => setPassageFx,
  // Callbacks, not references: several are declared further down main().
  cancelSuggestion: () => cancelSuggestion(),
  closePassage: view => closePassage(view),
  combinedContext: () => combinedContext(),
  currentAgent: () => currentAgent(),
  ensureAgent: () => ensureAgent(),
  startJob: options => startJob(options),
  finishJob: job => finishJob(job),
  notify: (...args) => notify(...args),
  notifyProblem: (...args) => notifyProblem(...args),
  requestPassage: (view, previous) => requestPassage(view, previous),
  saveSnapshot: label => saveSnapshot(label),
  sseChunks: response => sseChunks(response),
});
const { GenerationWidget, generationInput, handleWrite, reviewGeneration, generateFromLine } = generate;

// ─── Read-only compartment (blocks input while loading) ────────────────

const readonlyComp = new Compartment();

function editorSetReadonly(view, on) {
  view.dispatch({ effects: readonlyComp.reconfigure(EditorState.readOnly.of(on)) });
  view.dom.classList.toggle('streaming', on);
}

// ─── Local passage actions ─── (src/features/passage.js)
const passage = createPassage({
  storage: localStorage,
  jobs,
  docState,
  cancelSuggestion: () => cancelSuggestion(),
  combinedContext: () => combinedContext(),
  currentAgent: () => currentAgent(),
  ensureAgent: () => ensureAgent(),
  startJob: options => startJob(options),
  finishJob: job => finishJob(job),
  notify: (...args) => notify(...args),
  notifyProblem: (...args) => notifyProblem(...args),
});
const { passageField, openPassage, closePassage, requestPassage } = passage;

// ─── Chat ──────────────────────────────────────────────────────────────────────
//
//  One surface for everything the assistant says. The composer is pinned to the
//  bottom of the canvas and the stream grows upward above it; nothing is modal,
//  so the draft stays readable and editable while you decide.
//
//  Context attaches to the composer as a chip rather than opening a window:
//  right-click a selection, or click a marked passage, and the passage rides
//  along with whatever you type next.
//

const CHAT_PLACEHOLDER = 'Ask about your draft, or request a rewrite';

// { role, content, display? } — `content` goes to the model, `display` is what
// the writer typed when the two differ.
let chatHistory = [];
let chatAbort = null;
const chatRequests = new Set();
const chatEditCards = new Map();
let changingChatEdit = null;


// Follow the stream only when the reader is already at the bottom. Yanking
// them down mid-sentence while they scroll back is the classic chat sin.
const chatAtBottom = () =>
  chatStream.scrollHeight - chatStream.scrollTop - chatStream.clientHeight < 48;

const reduceMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Discrete jumps glide; token-by-token follow stays instant — smooth scrolling
// lags behind a live stream and stutters.
// Scrollbar only while moving: the class is set on every scroll event (wheel,
// drag, key, or our own chatScroll) and dropped after a quiet moment.
let chatScrollTimer = 0;
chatStream.addEventListener('scroll', () => {
  chatStream.classList.add('is-scrolling');
  clearTimeout(chatScrollTimer);
  chatScrollTimer = setTimeout(() => chatStream.classList.remove('is-scrolling'), 900);
}, { passive: true });

function chatScroll(stick, smooth = false) {
  if (!stick) return;
  const top = chatStream.scrollHeight;
  if (smooth && !reduceMotion()) {
    try { chatStream.scrollTo({ top, behavior: 'smooth' }); return; } catch {}
  }
  chatStream.scrollTop = top;
}

function saveChat() {
  docStorage.setItem('wa-chat', JSON.stringify({ document: workView.state.doc.toString(), messages: chatHistory.slice(-20) }));
}
function restoreChat() {
  let saved;
  try { saved = JSON.parse(docStorage.getItem('wa-chat') || 'null'); } catch { return; }
  const messages = Array.isArray(saved) ? saved : saved?.messages;
  if (!Array.isArray(messages)) return;
  chatHistory = messages.filter(message => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string').slice(-20);
  for (const message of chatHistory) {
    if (message.role === 'user') streamAppend(el('div', 'chat-entry is-user', message.display ?? message.content));
    else {
      message.edits = Array.isArray(message.edits) ? message.edits.filter(edit => edit && typeof edit.quote === 'string' && typeof edit.replacement === 'string' && typeof edit.label === 'string').slice(0, 8) : [];
      for (const edit of message.edits) {
        if (saved.document !== workView.state.doc.toString() || !chatEditMatches(edit, workView.state.doc.toString())) {
          if (edit.state !== 'unlocated') edit.state = 'stale';
        }
      }
      renderChatAnswer(streamAppend(el('div', 'chat-entry is-agent is-markdown')), message);
    }
  }
  // Folded into the pill by default: history is kept and reopens with it,
  // genuinely new arrivals still open it via chatAdd.
  setChatOpen(false);
  setIsland(false);
}
function renderChatAnswer(reply, message) {
  // Older saved answers may still carry a raw edit list in their text.
  reply.innerHTML = renderMarkdown(chatVisibleText(message.content, true));
  for (const edit of message.edits || []) reply.append(chatEditCard(edit));
}
function chatEditCard(edit) {
  const card = el('section', 'chat-edit-card');
  card.setAttribute('aria-label', edit.label);
  card.append(el('strong', 'chat-edit-title', edit.label));
  card.append(el('p', 'chat-edit-replacement', edit.replacement || '(Remove this passage)'));
  const actions = el('div', 'chat-edit-actions');
  const button = (name, handler) => {
    const node = el('button', 'review-action', name); node.type = 'button';
    node.addEventListener('click', handler); actions.append(node); return node;
  };
  const preview = button('Preview', () => {
    if (!chatEditMatches(edit, workView.state.doc.toString())) return;
    if (plainPreview?.edit === edit) clearPlainPreview();
    else {
      clearPlainPreview();
      workView.dispatch({ effects: EditorView.scrollIntoView(edit.from, { y: 'center' }) });
      showPlainPreview(edit.replacement, edit); plainPreview.edit = edit;
    }
    syncChatEditCards();
  });
  const apply = button('Apply', () => changeChatEdit(edit));
  apply.classList.add('is-primary');
  const keep = button('Keep original', () => { clearPlainPreview(); edit.state = 'kept'; saveChat(); syncChatEditCards(); undo.focus(); });
  // Undo speaks the same receipt language as applied variants: one quiet pill
  // in its own footer row, not another button in the action row.
  const undoFoot = el('div', 'variant-undo-row');
  undoFoot.hidden = true;
  const undo = el('button', 'chat-action', 'Undo');
  undo.type = 'button';
  undo.title = 'Put the passage back as it was';
  undo.addEventListener('click', () => {
    if (edit.state === 'kept') { edit.state = 'pending'; saveChat(); syncChatEditCards(); apply.focus(); }
    else changeChatEdit(edit, true);
  });
  undoFoot.append(undo);
  // The replacement is already written; only its place in the draft is lost
  // (never found, or edited since). The writer points at the passage and it
  // applies there, with the usual Undo — no second request, no typed prompt.
  const retarget = button('Replace selection', () => {
    const sel = workView.state.selection.main;
    if (sel.empty) return;
    Object.assign(edit, { from: sel.from, to: sel.to, quote: workView.state.sliceDoc(sel.from, sel.to), state: 'pending' });
    changeChatEdit(edit);
  });
  retarget.classList.add('is-primary');
  const status = el('p', 'chat-edit-status'); status.setAttribute('role', 'status');
  actions.prepend(status);
  card.append(actions, undoFoot);
  chatEditCards.set(edit, { card, actions, preview, apply, keep, undo, undoFoot, retarget, status });
  syncChatEditCard(edit, chatEditCards.get(edit));
  return card;
}
function syncChatEditCard(edit, ui) {
  const valid = chatEditMatches(edit, workView.state.doc.toString());
  const pending = edit.state === 'pending' && valid;
  const showUndo = valid && ['applied', 'kept'].includes(edit.state);
  const appliedNow = valid && edit.state === 'applied';
  ui.preview.hidden = ui.apply.hidden = ui.keep.hidden = !pending;
  ui.undo.hidden = !showUndo;
  ui.undo.setAttribute('aria-label', `${edit.state === 'applied' ? 'Undo edit' : 'Undo keeping original'}: ${edit.label}`);
  ui.undoFoot.hidden = !showUndo;
  // Applied is a receipt: tag in the title, Undo in its footer, nothing else.
  ui.card.classList.toggle('is-applied', appliedNow);
  // Lost its place and still undecided: the one way forward is to point at
  // the passage. An applied or kept edit that the writer has since rewritten
  // is history — nothing to offer.
  const lost = !valid && ['pending', 'stale', 'unlocated'].includes(edit.state);
  ui.actions.hidden = appliedNow || (!valid && !lost);
  ui.retarget.hidden = !lost;
  ui.preview.textContent = plainPreview?.edit === edit ? 'End preview' : 'Preview';
  ui.preview.setAttribute('aria-pressed', String(plainPreview?.edit === edit));
  ui.apply.disabled = ui.undo.disabled = workView.state.readOnly || docState.loadingDocument || docState.savePaused;
  syncRetarget(ui);
  // Applied needs no status: the tag in the title says it.
  ui.status.textContent = lost
    ? (edit.state === 'unlocated' ? 'Couldn’t find this passage. Select it in the draft.' : 'The passage changed. Select it in the draft.')
    : edit.state === 'kept' ? 'Original kept' : '';
  ui.status.hidden = !ui.status.textContent;
}
// Replace selection is live only while there is a selection to replace; the
// status line beside it says what to do until then. Cheap enough to run on
// every selection change.
function syncRetarget(ui) {
  ui.retarget.disabled = workView.state.selection.main.empty || workView.state.readOnly || docState.loadingDocument || docState.savePaused;
}
function syncChatEditCards() {
  for (const [edit, ui] of chatEditCards) {
    if (!ui.card.isConnected) { chatEditCards.delete(edit); continue; }
    syncChatEditCard(edit, ui);
  }
}
function changeChatEdit(edit, undo = false, automatic = false) {
  if (workView.state.readOnly || docState.loadingDocument || docState.savePaused || !chatEditMatches(edit, workView.state.doc.toString())
    || edit.state !== (undo ? 'applied' : 'pending')) return;
  clearPlainPreview();
  const text = undo ? edit.quote : edit.replacement;
  changingChatEdit = edit;
  try {
    if (undo || automatic) {
      saveSnapshot(undo ? 'Before undoing chat edit' : 'Before AI replacement');
      workView.dispatch({ changes: { from: edit.from, to: edit.to, insert: text },
        ...(automatic ? {} : { selection: { anchor: edit.from + text.length } }) });
      save();
    } else applyText(text, { from: edit.from, to: edit.to, text: edit.quote, document: workView.state.doc.toString() });
    edit.to = edit.from + text.length;
    edit.state = undo ? 'pending' : 'applied';
  } finally { changingChatEdit = null; }
  saveChat(); syncChatEditCards(); setChatOpen(true);
  if (!automatic) {
    const ui = chatEditCards.get(edit); (undo ? ui?.apply : ui?.undo)?.focus();
  }
}

// The chat belongs to the open document: kept with it, cleared when it goes.
docState.on({
  save: saveChat,
  restore: restoreChat,
  reset({ forget }) {
    chatEditCards.clear();
    clearPlainPreview();
    chatHistory = []; chatStream.replaceChildren();
    if (forget) docStorage.removeItem('wa-chat');
    setChatOpen(false);   // the stream was just emptied — don't leave × over nothing
    maybeCollapseIsland();
  },
});

// ── Rail ──
//
//  A remark about a place in the text stands next to that place. Cards are
//  positioned against the passage they anchor to and pushed down when they
//  would overlap; one that scrolls out of view is hidden with its mark.
//  Where the window is too narrow for a column, the same nodes go into the
//  panel and stack there.
const rail = document.getElementById('rail');
const railAnchors = new Map();   // node → () => document position | null
const railHomes = new Map();     // node → where it lives when there is no rail
const RAIL_WIDTH = 220, RAIL_GUTTER = 24;   // .rail width in style.css; the editor padding in the theme below assumes 2 × (RAIL_WIDTH + RAIL_GUTTER)
let railOn = false;
let railPaneLeft = 0;   // rail's left edge in pane coordinates for notePlus

// The rail lives in the margin the centred text column leaves empty, so it is
// available exactly when that margin can hold a note card and a gutter.
// Measured, not guessed at a breakpoint: the text column's padding is the
// margin. Only margin-note cards stand here (see railAdd).
function syncRail() {
  const margin = parseFloat(getComputedStyle(workView.contentDOM).paddingRight) || 0;
  const fits = margin >= RAIL_WIDTH + RAIL_GUTTER;
  if (fits) {
    // Beside the text, not against the window: the note belongs to the line.
    // The rail rides inside the editor's scroller (see the append below), so
    // its own left is in scroller coordinates; railPaneLeft keeps the pane
    // coordinates for the overlays that stayed outside.
    const box = workView.contentDOM.getBoundingClientRect();
    const scroller = workView.scrollDOM.getBoundingClientRect();
    const pane = document.getElementById('pane-work').getBoundingClientRect();
    rail.style.left = `${box.right - margin - scroller.left + RAIL_GUTTER}px`;
    railPaneLeft = box.right - margin - pane.left + RAIL_GUTTER;
  }
  if (fits === railOn) {
    rail.hidden = !fits || rail.children.length === 0;
    return;
  }
  railOn = fits;
  // Crossing the width moves note cards.
  // Moving must never open the chat: streamAppend keeps the panel as it was.
  for (const note of marginNotes) placeNoteCard(note);
  rail.hidden = !fits || rail.children.length === 0;
}

// Without a rail a card belongs in the stream, stacked in DOM order. Moving
// must never open the chat: crossing the breakpoint on resize is not something
// new arriving. Cards created fresh in the stream open it explicitly instead.
function placeHome(node) {
  const home = railHomes.get(node) ?? chatStream;
  if (home === chatStream) streamAppend(node);
  else home.append(node);
}

function railAdd(node, anchor, home = chatStream) {
  railAnchors.set(node, anchor);
  railHomes.set(node, home);
  syncRail();
  // Only margin-note cards stand in the rail; everything else stacks in the
  // stream at every width, as before.
  if (railOn && node.dataset.noteId !== undefined) rail.append(node);
  else placeHome(node);
  if (node.dataset.noteId !== undefined) railSizes.observe(node);
  layoutRail();
  return node;
}

function layoutRail() {
  syncRail();
  if (!railOn || !rail.children.length) return;
  const scroller = workView.scrollDOM;
  // The rail spans the whole document and scrolls with it, so card tops are
  // document coordinates: constant across scrolls, recomputed only on edits,
  // resizes and card changes — never per scroll event, where JS repositioning
  // lagged a frame behind composited text on momentum scrolling.
  rail.style.height = `${scroller.scrollHeight}px`;
  const scrollerTop = scroller.getBoundingClientRect().top;
  const scrollTop = scroller.scrollTop;
  const placed = [...rail.children]
    .map(node => {
      const position = railAnchors.get(node)?.();
      const coords = position == null ? null : workView.coordsAtPos(position);
      // −3 to stand exactly where the paragraph "+" stands (see moveNotePlus).
      return { node, at: coords && coords.top - scrollerTop + scrollTop - 3 };
    })
    .filter(item => item.at !== null && item.at !== undefined)
    .sort((a, b) => a.at - b.at);
  for (const node of rail.children) node.style.visibility = 'hidden';
  // The scroller clips offscreen cards; hiding them here would survive a scroll.
  let floor = -Infinity;
  for (const item of placed) {
    const height = item.node.offsetHeight;
    const at = Math.max(item.at, floor);
    item.node.style.top = `${at}px`;
    item.node.style.visibility = 'visible';
    floor = at + height + 8;
  }
}

new MutationObserver(layoutRail).observe(rail, { childList: true });
// Cards are stacked by their measured heights, so a card that grows or shrinks
// afterwards (typing a longer note, committing it, a font arriving) has to
// restack the ones below it — otherwise they keep their old tops and overlap.
const railSizes = new ResizeObserver(() => layoutRail());
window.addEventListener('resize', layoutRail);
// CM reports no geometry change when the text column only shifts sideways
// (sidebar, window width), so the pane itself is watched too — its width is
// what the rail measurement reads.
new ResizeObserver(() => layoutRail()).observe(document.getElementById('pane-work'));

// ── Conversation island ──
//
//  Idle the whole chat is one pill, after Symbioen's DynamicIsland (a compact
//  idle pill morphing into the full panel with a spring — idle content swaps
//  for open content, entering with scale .9 → 1 and blur 5px → 0). Here the
//  pill and the composer share surface/border/shadow so the swap reads as one
//  surface changing shape, and island-in (.35s on --ease) stands in for the
//  spring.
//
//  The pill opens both the field and the stream: a restored history reopens
//  with it. A notice takes the island over (see notify): while one is up the
//  composer and the pill step aside for it — either input or
//  notice, never both. Summoning the composer dismisses a passing notice; a
//  sticky problem keeps the input covered until its own action or ×.
//  Closing never discards — turns, cards and Undo stay, like
//  setChatOpen. Collapse is allowed only with nothing to lose (empty field,
//  no chip, no request running), so typing is never interrupted.
function syncPill() {
  if (!chatPillLabel) return;
  const n = chatStream.children.length;
  // Background work speaks through the pill until it ends.
  const working = suggestWorking;
  chatPanel.classList.toggle('is-working', Boolean(working));
  chatPillLabel.textContent = working || (n > 0 ? `Conversation${n > 1 ? ` • ${n}` : ''}` : 'Ask anything');
}

function canCollapseIsland() {
  return !chatInput.value.trim() && ![...jobs].some(job => !job.background);
}

function setIsland(open, opts = {}) {
  chatPanel.classList.toggle('is-collapsed', !open);
  chatPill?.setAttribute('aria-expanded', open ? 'true' : 'false');
  chatPill?.setAttribute('aria-label', open ? 'Conversation open' : 'Open conversation');
  syncPill();
  if (open) {
    if (opts.stream && chatStream.children.length > 0) setChatOpen(true);
    if (opts.focus) setTimeout(() => chatInput.focus({ preventScroll: true }), reduceMotion() ? 0 : 160);
  } else if (document.activeElement === chatInput) {
    try { workView.focus(); } catch {}
  }
  layoutRail();
}

function openIsland(opts = {}) {
  if (chatPanel.classList.contains('is-collapsed')) setIsland(true, opts);
  else if (opts.focus) chatInput.focus();
}

function maybeCollapseIsland() {
  if (canCollapseIsland()) setIsland(false);
}

chatPill?.addEventListener('mousedown', event => event.preventDefault());
chatPill?.addEventListener('click', () => {
  setIsland(true, { focus: true, stream: true });
});

// Clicking away from an empty, unstarted chat puts the pill back — only when
// there is nothing to lose (see canCollapseIsland) and no history to keep
// open. A scroll never collapses: the draft scrolls constantly.
document.addEventListener('pointerdown', event => {
  if (chatPanel.classList.contains('is-collapsed')) return;
  if (chatStream.children.length > 0) return;
  if (!canCollapseIsland()) return;
  if (event.target.closest('#chat')) return;
  setIsland(false);
});

// The pill names the count, so it must follow every stream change —
// including card removals that bypass setChatOpen.
new MutationObserver(() => syncPill()).observe(chatStream, { childList: true });

// The island morph. Pill, composer and notice are three elements, so a plain
// swap reads as one thing fading out and another fading in. Instead the
// incoming view is revealed from the outgoing one's outline and the outgoing
// view is clipped down to the incoming one's, on the same spring — the shape
// travels, the contents crossfade. Watching the class covers every path that
// swaps views (setIsland, notify) without threading a hook through each.
// The clip ends 60px outside the box so the shadow is revealed with it
// instead of popping in when the animation lets go.
const ISLAND_MORPH = { duration: 450, easing: 'cubic-bezier(.32, .72, 0, 1)' };
const chatComposer = chatPanel.querySelector('.chat-composer');
function islandView() {
  if (chatPanel.classList.contains('has-notice')) return editFeedback;
  return chatPanel.classList.contains('is-collapsed') ? chatPill : chatComposer;
}
let islandShown = islandView();
let islandRect = null;   // last known outline, for a view already display:none
new MutationObserver(() => {
  const next = islandView();
  if (!next || next === islandShown) return;
  const prev = islandShown;
  islandShown = next;
  const to = next.getBoundingClientRect();
  let from = prev?.getBoundingClientRect();
  if (!from?.width) from = islandRect;
  islandRect = to.width ? to : islandRect;
  const instant = next === chatComposer && chatPanel.dataset.openVia === 'key';
  if (next !== chatComposer) delete chatPanel.dataset.openVia;
  if (instant || reduceMotion() || !from?.width || !to.width) return;
  const inset = (box, of) => `inset(${box.top - of.top}px ${of.right - box.right}px ${of.bottom - box.bottom}px ${box.left - of.left}px round ${box.height / 2}px)`;
  const open = el => `inset(-60px round ${getComputedStyle(el).borderTopLeftRadius})`;
  next.animate([{ clipPath: inset(from, to) }, { clipPath: open(next) }], ISLAND_MORPH);
  if (prev?.getBoundingClientRect().width) {
    prev.animate([{ clipPath: open(prev) }, { clipPath: inset(to, from) }], ISLAND_MORPH);
  }
}).observe(chatPanel, { attributes: true, attributeFilter: ['class'] });

// Closing the conversation is a view, not an edit: the turns stay in memory
// and in storage, and the same control opens them again. Something new
// arriving is worth showing, so it opens by itself.
function setChatOpen(open) {
  // One surface: closing hides the stream and nothing else. Turns, remark
  // cards, undecided options and Undo all stay exactly where they were, so
  // reopening shows the same panel — closing never discards or retires
  // anything behind your back. The composer stays: it is how the writer
  // talks to the draft at all.
  // The toggle is its own right-aligned row above the stream (see .chat-clear)
  // — in normal flow, never overlapping cards or the composer, so it takes
  // a layout row and never scrolls away with a long stream.
  // A stream inside the folded pill is display:none — opening it there shows
  // nothing and leaves its fields unfocusable, so the island unfolds too.
  const wasShown = !chatStream.hidden && !chatPanel.classList.contains('is-collapsed');
  if (open) openIsland();
  if (open) chatStream.hidden = false;      // measure against a laid-out stream
  if (open && !wasShown) enterStream();
  chatClear.textContent = open ? '×' : 'Conversation';
  chatClear.setAttribute('aria-label', open ? 'Close the conversation' : 'Show the conversation');
  chatClear.title = open ? 'Close — nothing is discarded' : 'Show the conversation';
  if (open) { chatClear.hidden = false; chatScroll(true, true); return; }
  chatStream.hidden = true;
  clearPlainPreview();   // a hover preview must not outlive the panel
  // The toggle only makes sense while the stream holds something to show —
  // otherwise ×/Conversation sits above an empty panel and reads as broken.
  chatClear.hidden = chatStream.children.length === 0;
  layoutRail();
}

// The composer morphs between pill and field (see the island morph), but the
// stream above it is display:none while closed, so on its own the whole
// conversation would appear and vanish in one frame. It rises in with the
// morph and sinks toward the field before it is hidden.
const STREAM_MOTION = 'pseudoElement' in KeyframeEffect.prototype;
function enterStream() {
  if (!chatStream.childElementCount || reduceMotion()) return;
  // Showing a display:none stream replays every turn's own entrance; the
  // stream arrives as one piece instead.
  for (const animation of chatStream.getAnimations({ subtree: true })) animation.finish();
  chatStream.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
    { duration: 250, easing: 'cubic-bezier(.32, .72, 0, 1)' });
}
// fold: the whole island goes back to the pill, so the field fades with the
// turns. Otherwise the field stays, and losing the panel's 8px inset would
// drop it in one frame: it slides there instead.
function afterStreamLeaves(close, fold = false) {
  const shown = !chatStream.hidden && chatStream.childElementCount > 0 && !chatPanel.classList.contains('is-collapsed');
  if (!shown || reduceMotion()) return close();
  const timing = { duration: 150, easing: 'ease-out', fill: 'forwards' };
  const leaving = [chatStream.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(8px)' }], timing)];
  if (STREAM_MOTION) leaving.push(chatPanel.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, pseudoElement: '::before' }));
  if (fold) leaving.push(chatComposer.animate([{ opacity: 1 }, { opacity: 0 }], timing));
  const top = chatComposer.getBoundingClientRect().top;
  leaving[0].finished.then(() => {
    close();
    for (const animation of leaving) animation.cancel();
    const shift = top - chatComposer.getBoundingClientRect().top;
    if (!fold && shift) {
      chatComposer.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }],
        { duration: 200, easing: 'cubic-bezier(.32, .72, 0, 1)' });
    }
  }, () => {});
}

function chatAdd(node) {
  setIsland(true);
  setChatOpen(true);
  chatStream.append(node);
  // A new turn is worth showing: force-scroll, unlike streaming updates
  // which follow only when the reader is already at the bottom.
  chatScroll(true);
  chatClear.hidden = false;
  return node;
}

// Append without opening: rail→stream migration of cards that are already on
// screen. Opening is reserved for genuinely new arrivals (see chatAdd).
function streamAppend(node) {
  const stick = chatAtBottom();
  chatStream.append(node);
  chatScroll(stick);
  chatClear.hidden = false;
  return node;
}

// ── Margin notes ─────────────────────────────────────────────────────────────
//  The writer's own remarks on the draft (slice 1: create, show, delete — no
//  threads, no model calls yet). Each note anchors to a paragraph with a
//  quote snapshot:
//
//  - live edits map the passage boundaries, including reworded text;
//  - lost anchors stay as points with a "text changed" badge, never
//    highlighting a different copy of the quote or a whole paragraph;
//  - the paragraph is gone too (empty draft) → no mark; the card waits in the
//    stream until the text returns.
//
//  Storage is a new per-document key, so STORAGE_SCHEMA stays '1': no stored
//  shape changed, only a new one appeared.
let noteSeq = 0;
let marginNotes = [];       // { id, para, quote, text, at, drifted }
const noteCards = new Map();  // note id → its card, while it is on screen

const setNoteFx = StateEffect.define();
const noteMark = note => Decoration.mark({
  class: 'cm-note' + (note.drifted ? ' is-drifted' : ''),
  attributes: {
    'data-note-id': note.id,
    title: note.text || 'Margin note',
  },
}).range(note.from, note.to);

const noteField = StateField.define({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setNoteFx)) return Decoration.set(effect.value.map(noteMark), true);
    }
    if (!tr.docChanged) return decorations;
    return decorations.map(tr.changes);
  },
});

// Paragraph, offset and length follow editor transactions. A null paragraph
// is a document note; a deleted passage remains a point without a mark.
function noteRange(id) {
  const note = marginNotes.find(item => item.id === id);
  if (!note) return null;
  const range = resolveNoteRange(workView.state.doc.toString(), note);
  return range && { from: range.from, to: range.to };
}

function markForNote(id) { return workView.dom.querySelector(`.cm-note[data-note-id="${CSS.escape(id)}"]`); }

// Rail position of a note: its own line — where its "+" stood or its passage
// begins — so a note stands exactly where it was made. Passage notes
// anchor by their live range's paragraph (falling back to the stored one),
// document notes pin at the very top.
function noteAnchor(id) {
  const note = marginNotes.find(item => item.id === id);
  if (!note) return null;
  if (note.para === null) return 0;
  const paras = paragraphRanges(workView.state.doc.toString());
  if (!paras.length) return null;
  // Stands where it was made: at its passage, or at the line its "+" was
  // pressed beside. Anchored to the paragraph's top it landed screens above a
  // click in a long paragraph.
  return noteRange(id)?.from ?? paras[Math.min(note.para, paras.length - 1)].from;
}

// Re-anchor every note against the document as it is now. Illegal inside an
// update listener — callers queue it as a microtask (see the docChanged
// listener below), or call it directly from event handlers.
function syncNoteMarks() {
  const document = workView.state.doc.toString();
  const marks = [];
  for (const note of marginNotes) {
    if (note.resolved) continue;
    const resolved = resolveNoteRange(document, note);
    note.drifted = !resolved || resolved.drifted;
    // Document notes and empty drafts resolve bare: no mark to draw, the
    // card's place (rail top, or stream) is decided by placeNoteCard.
    if (resolved && !resolved.bare && resolved.to > resolved.from) {
      marks.push({ id: note.id, from: resolved.from, to: resolved.to, drifted: note.drifted, text: note.text });
    }
  }
  workView.dispatch({ effects: setNoteFx.of(marks) });
  for (const note of marginNotes) placeNoteCard(note);
  layoutRail();
}

// A note with a live range stands in the rail when there is one; a drifted
// orphan with no range waits in the stream. Never opens the chat — arriving
// by edit or resize is not something new arriving.
function placeNoteCard(note) {
  const card = noteCards.get(note.id);
  if (!card || !card.isConnected) return;
  card.style.top = '';
  card.style.visibility = '';
  if (railOn && noteRange(note.id)) {
    if (card.parentElement !== rail) rail.append(card);
  } else placeHome(card);
  rail.hidden = !railOn || rail.children.length === 0;
  // Never clobber an open editor: typing elsewhere re-anchors notes on every
  // keystroke, and that must not eat the text being typed in the card.
  if (!card.querySelector('textarea')) renderNoteCard(note);
}

function saveNotes() {
  docStorage.setItem('wa-notes', JSON.stringify({ notes: marginNotes }));
  liveSync?.notesChanged();
}

function restoreNotes() {
  // Restoring runs again on a retried load and on every file switch: cards
  // from the last pass must go first, or each one is stacked a second time.
  discardNoteCards();
  let saved = null;
  try { saved = JSON.parse(docStorage.getItem('wa-notes') || 'null'); } catch {}
  const notes = Array.isArray(saved?.notes) ? saved.notes : [];
  marginNotes = notes.filter(note =>
    note && typeof note.id === 'string' && typeof note.quote === 'string'
    && typeof note.text === 'string' && note.text.trim() !== ''
    && (Number.isInteger(note.para) && note.para >= 0 || note.para === null));
  for (const note of marginNotes) if (!Number.isInteger(note.off) || note.off < 0) note.off = 0;
  const baseline = typeof saved?.document === 'string' ? saved.document : null;
  const paras = baseline === null ? [] : paragraphRanges(baseline);
  for (const note of marginNotes) {
    const para = paras[note.para];
    note.anchor ??= para && baseline.slice(para.from, para.to);
    if (note.resolved && !note.work) continue;
    note.drifted = false;
    noteCards.set(note.id, railAdd(noteCard(note), () => noteAnchor(note.id)));
  }
  syncNoteMarks();   // also clears the marks a previous document left
}

function discardNoteCards() {
  for (const card of noteCards.values()) {
    railAnchors.delete(card); railHomes.delete(card); card.remove();
  }
  noteCards.clear();
  marginNotes = [];
}

function noteExcerpt(note) {
  const range = noteRange(note.id);
  const live = range ? workView.state.sliceDoc(range.from, note.quote ? range.to : range.from + 160) : '';
  const text = (live || note.quote).trim().replace(/\s+/g, ' ');
  return text.length > 120 ? text.slice(0, 120).replace(/\s+\S*$/, '') + '…' : text;
}

function noteCard(note) {
  const card = el('div', 'note-card');
  card.dataset.noteId = note.id;
  card.tabIndex = 0;
  card.setAttribute('aria-label', 'Margin note. Press Enter to edit.');
  card.addEventListener('mouseenter', () => markForNote(note.id)?.classList.add('is-hot'));
  card.addEventListener('mouseleave', () => markForNote(note.id)?.classList.remove('is-hot'));
  card.addEventListener('click', event => {
    if (event.target.closest('textarea, button')) return;
    focusNote(note.id);
  });
  card.addEventListener('keydown', event => {
    if (event.target !== card) return;
    if (event.key === 'Enter') { event.preventDefault(); editNoteCard(note.id); }
    // Keyboard way to delete: the × is hover-only on desktop, unreachable
    // without a mouse. Undo stays the way back, like the button.
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteNote(note.id); }
  });
  renderNoteCard(note, card);
  return card;
}

function renderNoteCard(note, card = noteCards.get(note.id)) {
  if (!card || card.querySelector('textarea')) return;
  // Re-rendered on every keystroke via placeNoteCard — skip when nothing the
  // note shows changed, so hover and focus survive typing elsewhere.
  const inStream = card.parentElement === chatStream;
  const work = note.work, latest = work?.attempts?.at(-1);
  const key = `${inStream}|${note.drifted}|${note.text}|${noteExcerpt(note)}|${work?.status}|${work?.generation}|${work?.error}|${work?.messages?.length}|${latest?.id}|${latest?.status}|${latest?.edits.map(edit => edit.valid).join()}`;
  if (card.dataset.renderKey === key) return;
  card.dataset.renderKey = key;
  card.replaceChildren();
  // In the rail the note stands beside its passage, so the passage itself is
  // the context — just the text. In the stream there is no beside, so the
  // quote travels with it; a document note names the whole draft instead.
  const scope = note.para === null ? 'Whole draft' : noteExcerpt(note);
  if (inStream || note.para === null) card.append(el('div', 'note-quote', note.para === null ? scope : `“${scope}”`));
  const body = el('div', 'note-text', note.text);
  body.addEventListener('click', event => { event.stopPropagation(); editNoteCard(note.id); });
  // The × stands inline, right after the last word: it is where the eye
  // finishes reading, instead of a corner of a box that has no visible edge.
  const del = el('button', 'note-del', '×');
  del.type = 'button';
  del.setAttribute('aria-label', 'Delete note');
  del.title = 'Delete note';
  del.addEventListener('click', event => { event.stopPropagation(); deleteNote(note.id); });
  body.append(del);
  if (note.resolved && work) {
    const completed = el('details', 'note-completed');
    completed.append(el('summary', '', 'Completed note'), body); card.append(completed);
  } else card.append(body);
  if (note.drifted) card.append(el('div', 'note-meta', 'text changed — check this note'));
  if (work) {
    const labels = { queued: 'Queued', working: 'Agent writing', review: 'Review changes', done: 'Done', reverted: 'Reverted', blocked: 'Needs input' };
    const status = el('div', 'note-meta', labels[work.status] || 'Queued');
    status.setAttribute('role', 'status'); card.append(status);
    if (work.error) card.append(el('div', 'note-meta', work.error));
    for (const attempt of work.attempts || []) {
      const details = el('details', 'note-work-result');
      details.append(el('summary', '', attempt === latest ? 'Agent result' : 'Previous result'));
      if (attempt.comment) details.append(el('p', '', attempt.comment));
      for (const edit of attempt.edits) {
        details.append(el('del', 'note-before', edit.before), el('ins', 'note-after', edit.after));
      }
      card.append(details);
    }
    for (const message of work.messages || []) card.append(el('p', 'note-feedback', message.text));
    const actions = el('div', 'note-work-actions');
    const button = (label, type, extra = {}) => {
      const el = el('button', 'chat-action', label); el.type = 'button';
      el.addEventListener('click', () => updateNoteWork(note.id, type, extra)); actions.append(el);
      return el;
    };
    if (work.status === 'review' && latest?.status === 'applied') button('Accept', 'accept', { attempt: latest.id });
    if (latest && ['applied', 'accepted'].includes(latest.status) && latest.edits.length) {
      const undo = button('Undo', 'revert', { attempt: latest.id });
      undo.disabled = !reversible(latest, workView.state.doc.toString());
      if (undo.disabled) undo.title = 'This passage changed after the agent edit';
    }
    if (!['queued', 'working'].includes(work.status)) button('Regenerate', 'regenerate');
    if (actions.children.length) card.append(actions);
  }
}

async function updateNoteWork(id, type, extra = {}) {
  try {
    await liveSync.flush();
    const note = marginNotes.find(note => note.id === id);
    if (!note?.work) throw new Error('Save this note before updating its work.');
    await liveSync.work({ id, type, generation: note.work.generation, ...extra });
    noteCards.get(id)?.focus({ preventScroll: true });
  } catch (error) { notify(`Unable to update this note: ${error.message} The note itself is kept.`, { sticky: true, action: () => updateNoteWork(id, type, extra), label: 'Try again' }); }
}

function editNoteCard(id) {
  const note = marginNotes.find(item => item.id === id);
  const card = noteCards.get(id);
  if (!note || !card || card.querySelector('textarea')) return;
  delete card.dataset.renderKey;
  card.replaceChildren();
  const field = document.createElement('textarea');
  field.value = note.text;
  field.rows = 1;
  field.setAttribute('aria-label', 'Note text');
  field.placeholder = 'Write a note…';
  card.append(field);
  // No Save/Cancel: blur commits, Escape drops. A commit flag keeps the blur
  // from re-saving after Escape already cancelled.
  // Empty notes don't linger: a fresh note left empty is removed silently
  // (cancelling is not deleting — there is nothing to put back), while
  // clearing a note that held text goes through deleteNote with its Undo.
  let finished = false;
  const finish = save => {
    if (finished) return;
    finished = true;
    const fresh = note.text === '';
    const next = field.value.trim();
    if ((!save || next === '') && fresh) { removeNoteSilent(id); workView.focus(); return; }
    if (save && next === '') { deleteNote(id); return; }   // focuses + Undo itself
    if (save && next !== note.text) {
      note.text = next;
      saveNotes();
      syncNoteMarks();
    }
    delete card.dataset.renderKey;
    field.remove();   // renderNoteCard skips a card that still holds a field
    if (note.resolved && !note.work) { railAnchors.delete(card); railHomes.delete(card); card.remove(); noteCards.delete(id); }
    else renderNoteCard(note);
  };
  field.addEventListener('blur', () => finish(true));
  field.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); finish(false); workView.focus(); }
    else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); finish(true); workView.focus(); }
    event.stopPropagation();
  });
  // Fit the field to its text. Rows counted against a fixed 22px came out a
  // line too tall for an empty note; the content height is never wrong.
  const fit = () => { field.style.height = 'auto'; field.style.height = `${field.scrollHeight}px`; };
  field.addEventListener('input', fit);
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
  fit();
}

// A point within its paragraph: saved paragraph text survives insertions above.
function createParagraphNote(para, off = 0) {
  const paras = paragraphRanges(workView.state.doc.toString());
  if (!paras.length || para < 0 || para >= paras.length) return null;
  return addNote({ para, quote: '', off });
}

function addNote({ para, quote, off = 0, text = '', kind, edit = true }) {
  const document = workView.state.doc.toString();
  const paragraph = paragraphRanges(document)[para];
  const note = {
    id: `n${Date.now().toString(36)}${(noteSeq++).toString(36)}`,
    para,
    quote,
    off,
    length: quote.length,
    anchor: paragraph && document.slice(paragraph.from, paragraph.to),
    text, kind,
    at: new Date().toISOString(),
    drifted: false,
  };
  marginNotes.push(note);
  saveNotes();
  const card = noteCard(note);
  noteCards.set(note.id, railAdd(card, () => noteAnchor(note.id)));
  // A fresh note is a new arrival: open for it when it lands in the stream.
  // In the rail it is already visible beside the line.
  if (card.parentElement === chatStream) setChatOpen(true);
  syncNoteMarks();
  // The bubble's button returns focus to the editor after this runs — take
  // the field back on the next tick.
  if (edit) queueMicrotask(() => editNoteCard(note.id));
  return note;
}

// Notes are the open document's: kept with it, dropped when it goes.
docState.on({
  save: saveNotes,
  restore: restoreNotes,
  reset({ forget }) {
    discardNoteCards();
    if (forget) docStorage.removeItem('wa-notes');
  },
});

// ── Paragraph "+" ────────────────────────────────────────────────────────────
//  Hovering the empty margin beside a paragraph shows one faint "+", Notion-
//  style: the paragraph is the commonest note target, and selecting it first
//  just to press Note is a tax on every remark. Clicking the "+" opens a
//  paragraph note (empty quote: the saved paragraph text is the anchor).
//  No shortcut to remember, no button to find — the margin itself invites.
const notePlus = document.createElement('button');
notePlus.type = 'button';
notePlus.className = 'note-plus';
notePlus.innerHTML = icon('plus');
notePlus.title = 'Note on this paragraph';
notePlus.setAttribute('aria-label', 'Add a note on this paragraph');
notePlus.hidden = true;
document.getElementById('pane-work').append(notePlus);
let plusPara = -1;
let plusOff = 0;
let plusRaf = 0;

// Paragraph splitting on every mousemove would tax long drafts; the split
// only changes on edit, so cache it keyed by docState.editVersion.
let paraCacheVersion = -1;
let paraCache = [];
function cachedParagraphs() {
  if (paraCacheVersion !== docState.editVersion) {
    paraCache = paragraphRanges(workView.state.doc.toString());
    paraCacheVersion = docState.editVersion;
  }
  return paraCache;
}

function hideNotePlus() {
  plusPara = -1;
  if (plusRaf) { cancelAnimationFrame(plusRaf); plusRaf = 0; }
  if (plusHideTimer) { clearTimeout(plusHideTimer); plusHideTimer = null; }
  if (!notePlus.hidden) notePlus.hidden = true;
}

// Boundary crossings (text ⇄ "+") hide and re-show within one mousemove,
// which reads as blinking. Hiding waits a beat instead; anything continuous
// (scroll, drag, selection, bubble, rail off) still hides at once.
let plusHideTimer = null;
function schedulePlusHide() {
  if (plusHideTimer || notePlus.hidden) return;
  plusHideTimer = setTimeout(() => { plusHideTimer = null; hideNotePlus(); }, 150);
}

function moveNotePlus(event) {
  if (plusRaf) return;
  const clientY = event.clientY;
  plusRaf = requestAnimationFrame(() => {
    plusRaf = 0;
    // Measured now, not remembered: the rail's fit was last judged whenever a
    // card or a resize last asked, and on a fresh load with no notes that was
    // before the column had its final padding — the "+" never showed until
    // the window was resized.
    syncRail();
    // The "+" belongs to the rail: no rail, no plus. Hidden while dragging or
    // holding a selection (its bubble already offers Note) and before the
    // draft loads. An open bubble does not hide it; pressing the "+" closes
    // the bubble anyway. A selection hides it only while
    // its bubble stands: Change puts the bubble away but leaves the passage
    // selected, and that must not take the "+" from every paragraph.
    if (!railOn || docState.loadingDocument || event.buttons !== 0
        || (!workView.state.selection.main.empty && !markBubble.hidden)) {
      hideNotePlus();
      return;
    }
    const contentBox = workView.contentDOM.getBoundingClientRect();
    const pos = workView.posAtCoords({ x: contentBox.left + 40, y: clientY });
    if (pos == null) { hideNotePlus(); return; }
    const paras = cachedParagraphs();
    if (!paras.length) { hideNotePlus(); return; }
    let index = paras.findIndex(paragraph => pos >= paragraph.from && pos <= paragraph.to);
    // The "+" stands on the line under the pointer, not the paragraph's first
    // line: a hard-wrapped draft reads as one long paragraph, and pinned to
    // its top the "+" sat screens away from the hand, often scrolled out.
    let at = pos;
    if (index < 0) {
      // Blank gaps between paragraphs belong to no paragraph — snapping to
      // the nearest one instead of blinking out on every crossing.
      let best = 0, bestDist = Infinity;
      paras.forEach((paragraph, i) => {
        const dist = pos < paragraph.from ? paragraph.from - pos : pos - paragraph.to;
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      index = best;
      at = pos < paras[index].from ? paras[index].from : paras[index].to;
    }
    const coords = workView.coordsAtPos(at);
    // A line a note already stands beside needs no invitation: pressing it
    // would stack a second card on the first. Notes elsewhere in the same
    // paragraph do not count — each line is its own place.
    if (coords && marginNotes.some(note => {
      const card = noteCards.get(note.id);
      if (!card?.isConnected || card.parentElement !== rail) return false;
      const box = card.getBoundingClientRect();
      return coords.top >= box.top - 4 && coords.top <= box.bottom;
    })) { hideNotePlus(); return; }
    const railLeft = railPaneLeft;
    if (!coords || !railLeft) { hideNotePlus(); return; }
    if (plusHideTimer) { clearTimeout(plusHideTimer); plusHideTimer = null; }
    const pane = document.getElementById('pane-work').getBoundingClientRect();
    plusPara = index;
    plusOff = at - paras[index].from;
    notePlus.style.left = `${railLeft - 28}px`;
    notePlus.style.top = `${(coords.top + coords.bottom) / 2 - 11 - pane.top}px`;   // 22px "+" centred on the line
    notePlus.hidden = false;
  });
}
editorWrap.addEventListener('mousemove', moveNotePlus);
editorWrap.addEventListener('mouseleave', event => {
  // Moving onto the "+" itself must not dismiss it — it is the target.
  if (event.relatedTarget === notePlus) return;
  hideNotePlus();
});
notePlus.addEventListener('mouseenter', () => {
  if (plusHideTimer) { clearTimeout(plusHideTimer); plusHideTimer = null; }
});
notePlus.addEventListener('mouseleave', schedulePlusHide);
notePlus.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  const para = plusPara, off = plusOff;
  hideNotePlus();
  // Focus stays where it was; the new note's editor takes it on the tick.
  if (para >= 0) createParagraphNote(para, off);
});

// A note that never held text leaves no trace: no toast, no Undo — there is
// nothing to put back. Backing out of a fresh note is cancelling, not deleting.
function removeNoteSilent(id) {
  const index = marginNotes.findIndex(note => note.id === id);
  if (index < 0) return;
  marginNotes.splice(index, 1);
  const card = noteCards.get(id);
  if (card) { railAnchors.delete(card); railHomes.delete(card); card.remove(); }
  noteCards.delete(id);
  syncNoteMarks();
  saveNotes();
}

function deleteNote(id) {  const index = marginNotes.findIndex(note => note.id === id);
  if (index < 0) return;
  const [note] = marginNotes.splice(index, 1);
  const document = workView.state.doc.toString();
  const card = noteCards.get(id);
  if (card) { railAnchors.delete(card); railHomes.delete(card); card.remove(); }
  noteCards.delete(id);
  syncNoteMarks();
  saveNotes();
  workView.focus();
  notifyUndo('Note deleted', () => {
    marginNotes.splice(Math.min(index, marginNotes.length), 0, note);
    saveNotes();
    const restored = noteCard(note);
    noteCards.set(note.id, railAdd(restored, () => noteAnchor(note.id)));
    if (restored.parentElement === chatStream) setChatOpen(true);
    syncNoteMarks();
    if (workView.state.doc.toString() !== document) notify('Note restored — its passage moved while it was gone.');
  });
}

// The writer's margin notes as model context: short lines labeled by scope,
// so a "tighten this" reads as the author's voice, not an instruction from
// nowhere. Empty notes never persist (see editNoteCard), so everything here
// is content. Sent with chat and rewrites only — suggestions fire on every
// pause.
function notesBrief() {
  if (!marginNotes.length) return '';
  const lines = marginNotes.filter(note => !note.resolved).map(note => {
    if (note.para === null) return `- On the whole draft: ${note.text}`;
    const range = noteRange(note.id);
    const live = range ? workView.state.sliceDoc(range.from, note.quote ? range.to : range.from + 200).trim().replace(/\s+/g, ' ') : '';
    return `- On "${(live || note.quote).slice(0, 200)}": ${note.text}`;
  });
  return `WRITER'S MARGIN NOTES (the author's own remarks — weigh them, do not quote them back):\n${lines.join('\n')}`;
}

// Four draft-specific questions, saved with answers so an interrupted brief resumes.
let positionBrief = null;   // { reader, goal, awareness, scope, updatedAt, nudged }
let briefSession = null;    // { step, answers, card } while the interview runs

function saveBrief() {
  cancelSuggestion();
  ghostClear(workView);
  if (positionBrief) docStorage.setItem('wa-brief', JSON.stringify(positionBrief));
  else docStorage.removeItem('wa-brief');
}
function restoreBrief() {
  const saved = safeJson(docStorage.getItem('wa-brief'), null);
  positionBrief = saved && typeof saved === 'object' ? saved : null;
  if (positionBrief?.questions) {
    try { positionBrief.questions = validateBriefQuestions(positionBrief.questions); }
    catch { delete positionBrief.questions; }
  }
  briefSession?.controller?.abort();
  briefSession = null;
}
function briefComplete() {
  return BRIEF_STEPS.every(step => typeof positionBrief?.[step.key] === 'string' && positionBrief[step.key].trim());
}
function briefContext() {
  const lines = BRIEF_STEPS.flatMap((step, index) => typeof positionBrief?.[step.key] === 'string' && positionBrief[step.key].trim()
    ? [`- ${positionBrief.questions?.[index]?.question || step.label}: ${positionBrief[step.key]}`] : []);
  if (typeof positionBrief?.direction === 'string' && positionBrief.direction.trim()) lines.push(`- Writing constraints: ${positionBrief.direction}`);
  return lines.length ? `WRITING BRIEF (author's preferences, not factual evidence):\n${lines.join('\n')}` : '';
}

function applyChatBrief(update, message, expected) {
  let changes;
  try { ({ changes } = validateBriefUpdate(update, message)); }
  catch { notify('The brief update could not be verified. Nothing was saved. Ask again to update it.'); return; }
  if (JSON.stringify(positionBrief) !== expected || briefSession) {
    notify('The brief changed while the reply was loading. Ask again to update it.');
    return;
  }
  const previous = positionBrief;
  positionBrief = { ...positionBrief, ...changes, updatedAt: Date.now(), nudged: true };
  // Generated questions can become irrelevant after the author changes the brief.
  delete positionBrief.questions;
  const applied = positionBrief;
  saveBrief();
  notifyUndo('Brief updated — suggestions, rewrites and chat now use it.', () => {
    if (positionBrief !== applied) { notify('The brief has changed since this update. Edit it with /brief.'); return; }
    positionBrief = previous;
    saveBrief();
  });
}
function combinedContext() {
  return [notesBrief(), briefContext()].filter(Boolean).join('\n\n');
}

async function startBrief() {
  dismissPassingNotice();
  openIsland();
  if (briefSession) { renderBriefQuestion(); chatInput.focus(); return; }
  if (briefComplete() && positionBrief?.questions) { renderBriefSummary(); return; }
  const answers = {};
  for (const step of BRIEF_STEPS) {
    if (typeof positionBrief?.[step.key] === 'string' && positionBrief[step.key].trim()) answers[step.key] = positionBrief[step.key];
  }
  const step = BRIEF_STEPS.findIndex(item => !answers[item.key]);
  const session = briefSession = { step: step === -1 ? 0 : step, answers, card: null };
  if (!positionBrief?.questions && workView.state.doc.length) {
    session.loading = true;
    session.controller = new AbortController();
    renderBriefQuestion();
    try {
      const result = await api('/brief', { method: 'POST', signal: session.controller.signal,
        body: JSON.stringify({ document: workView.state.doc.toString(), answers, agent: currentAgent() }) });
      if (briefSession !== session) return;
      positionBrief = { ...(positionBrief || {}), questions: validateBriefQuestions(result.questions) };
      saveBrief();
    } catch (error) {
      if (briefSession !== session) return;
      notify('Could not tailor the brief — using general questions. ' + error.message);
    }
    session.loading = false;
  }
  if (briefSession !== session) return;
  if (briefComplete()) { session.card?.remove(); briefSession = null; renderBriefSummary(); return; }
  renderBriefQuestion();
  chatInput.focus();
}

function renderBriefQuestion() {
  if (!briefSession) return;
  briefSession.card?.remove();
  const step = (positionBrief?.questions || BRIEF_STEPS)[briefSession.step];
  const card = el('div', 'chat-entry is-agent brief-card');
  const head = el('div', 'brief-head');
  head.append(el('span', 'brief-kicker', 'Positioning brief'));
  head.append(el('span', 'brief-step', `${briefSession.step + 1} of ${BRIEF_STEPS.length}`));
  card.append(head);
  card.append(el('p', 'brief-question', briefSession.loading ? 'Preparing questions for your draft…' : step.question));
  const options = el('div', 'brief-options');
  options.setAttribute('role', 'group');
  options.setAttribute('aria-label', step.question);
  for (const option of briefSession.loading ? [] : step.options) {
    const pick = el('button', 'brief-option', option);
    pick.type = 'button';
    pick.addEventListener('click', () => answerBriefStep(option));
    options.append(pick);
  }
  card.append(options);
  const foot = el('div', 'brief-foot');
  foot.append(el('span', 'variant-hint', briefSession.loading ? '' : 'Or type your own answer below.'));
  const skip = el('button', 'brief-skip', 'Skip for now');
  skip.type = 'button';
  skip.addEventListener('click', () => cancelBrief());
  foot.append(skip);
  card.append(foot);
  briefSession.card = chatAdd(card);
}

function answerBriefStep(text) {
  if (!briefSession || briefSession.loading) return;
  const clean = String(text ?? '').trim();
  if (!clean) return;
  const step = BRIEF_STEPS[briefSession.step];
  briefSession.answers[step.key] = clean.slice(0, 200);
  positionBrief = { ...(positionBrief || {}), ...briefSession.answers, nudged: true };
  saveBrief();
  briefSession.card?.remove();
  briefSession.card = null;
  const next = BRIEF_STEPS.findIndex(item => !briefSession.answers[item.key]?.trim());
  if (next !== -1) {
    briefSession.step = next;
    renderBriefQuestion();
    return;
  }
  finishBrief();
}

function finishBrief() {
  positionBrief = { ...positionBrief, ...briefSession.answers, updatedAt: Date.now(), nudged: true };
  briefSession = null;
  saveBrief();
  renderBriefSummary();
  notify('Brief saved — suggestions, rewrites, chat and ideas now use it.');
}

function renderBriefSummary() {
  const card = el('div', 'chat-entry is-agent brief-card');
  const head = el('div', 'brief-head');
  head.append(el('span', 'brief-kicker', 'Positioning brief'));
  if (positionBrief.updatedAt) head.append(el('span', 'brief-step', new Date(positionBrief.updatedAt).toLocaleDateString()));
  card.append(head);
  const rows = el('div', 'brief-rows');
  for (let index = 0; index < BRIEF_STEPS.length; index++) {
    const step = BRIEF_STEPS[index];
    const row = el('div', 'brief-row');
    row.append(el('span', 'brief-label', step.label));
    row.append(el('span', 'brief-value', positionBrief[step.key]));
    const edit = el('button', 'brief-edit', 'Edit');
    edit.type = 'button';
    edit.setAttribute('aria-label', `Edit ${step.label.toLowerCase()}`);
    edit.addEventListener('click', () => {
      briefSession = { step: index, answers: { ...positionBrief }, card: null };
      card.remove();
      renderBriefQuestion();
      chatInput.focus();
    });
    row.append(edit);
    rows.append(row);
  }
  card.append(rows);
  if (positionBrief.direction) card.append(el('p', 'brief-value', positionBrief.direction));
  const meta = 'Used for suggestions, rewrites, chat and ideas. To update from chat: “For the whole draft: …”.';
  card.append(el('p', 'variant-hint', meta));
  chatAdd(card);
}

function cancelBrief() {
  if (!briefSession) return;
  briefSession.controller?.abort();
  briefSession.card?.remove();
  // Keep partial answers so /brief resumes where it stopped.
  positionBrief = { ...(positionBrief || {}), ...briefSession.answers, nudged: true };
  briefSession = null;
  saveBrief();
}

// Clicking a note's mark reads the note: the editor scrolls the passage into
// view and the card takes focus. Arms nothing.
function focusNote(id) {
  const range = noteRange(id);
  if (range) workView.dispatch({ effects: EditorView.scrollIntoView(range.from, { y: 'center' }) });
  const card = noteCards.get(id);
  if (card?.isConnected) {
    if (card.parentElement === chatStream) setChatOpen(true);
    layoutRail();
    card.focus({ preventScroll: true });
  }
}

// Keep the way back visible even when the conversation is put away.
const notifyUndo = (message, onUndo) => notify(message, { action: onUndo, key: 'undo', icon: 'check', tone: 'ok' });

// The brief is the open document's: kept with it, dropped when it goes.
docState.on({
  save: saveBrief,
  restore: restoreBrief,
  reset({ forget }) {
    positionBrief = null;
    if (briefSession) { briefSession.controller?.abort(); briefSession.card?.remove(); briefSession = null; }
    if (forget) docStorage.removeItem('wa-brief');
  },
});

// ── Mark bubble ── (src/features/bubble.js)
const markBubble = document.getElementById('mark-bubble');
const bubble = createBubble({
  element: markBubble,
  getView: () => workView,
  openPassage: (view, range) => openPassage(view, range),
  recheckSpelling: () => runSpellCheck(),
});
const { hideMarkBubble, deferBubble, reanchorBubble, showSelectionBubble, showSpellBubble } = bubble;

// ── Rewrite variants ────────────────────────────────────────────────────────
// Chat replacements preview in place before the writer applies them.

class PlainVariantWidget extends WidgetType {
  constructor(text, block) { super(); this.text = text; this.block = block; }
  eq(other) { return other.text === this.text && other.block === this.block; }
  toDOM() {
    const node = document.createElement(this.block ? 'div' : 'span');
    node.className = 'cm-variant-plain';
    node.textContent = this.text;
    return node;
  }
  ignoreEvent() { return true; }
}

const setPlainVariantFx = StateEffect.define();
const variantPlainField = StateField.define({
  create: () => null,
  update(value, tr) {
    if (tr.docChanged) return null;  // the writer took the sentence over
    for (const effect of tr.effects) if (effect.is(setPlainVariantFx)) return effect.value;
    return value;
  },
});

// A brief wash over just-applied text, so the eye lands on what changed
// instead of catching a snap. Any further edit takes over and clears it.
const setFlashFx = StateEffect.define();
const flashField = StateField.define({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setFlashFx)) return effect.value;
    if (tr.docChanged) return null;
    return value;
  },
});
let flashTimer = null;

let plainPreview = null;  // { target } while a hover preview is up
function showPlainPreview(text, target) {
  plainPreview = { target };
  workView.dispatch({
    effects: [setPlainVariantFx.of({
      from: target.from,
      to: target.to,
      text,
      block: workView.state.doc.lineAt(target.from).number !== workView.state.doc.lineAt(target.to).number,
    })],
  });
}
function clearPlainPreview() {
  if (!plainPreview) return;
  plainPreview = null;
  try { workView.dispatch({ effects: setPlainVariantFx.of(null) }); } catch {}
  syncChatEditCards();
}

function applyText(text, target) {
  if (!replacementTarget(workView.state.doc.toString(), target) || workView.state.readOnly) {
    notify('The draft changed since this answer. Select the passage and request a new change.');
    return;
  }
  plainPreview = null;
  saveSnapshot('Before AI replacement');
  workView.dispatch({
    changes: { from: target.from, to: target.to, insert: text },
    selection: { anchor: target.from + text.length },
    effects: [setPlainVariantFx.of(null), setFlashFx.of({ from: target.from, to: target.from + text.length })],
  });
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { try { workView.dispatch({ effects: setFlashFx.of(null) }); } catch {} }, 1300);
  workView.focus();
  save();
}

// ── Slash commands ──────────────────────────────────────────────────────────
//
//  Granola-style menu over the composer: icon, name and one line of
//  description per row, filtered as the writer types after /. ↑↓ move,
//  Enter/Tab runs, Esc closes. Every choice runs immediately.
//  The menu only lives while the field holds a bare /name — once arguments
//  follow, Enter runs instead of picking.
const SLASH_COMMANDS = [
  {
    name: 'brief', icon: 'target', title: 'Positioning brief',
    desc: 'Answer 4 questions about reader and goal',
    run() {
      clearNotice('brief');
      startBrief();
    },
  },
];

const slashMenu = document.getElementById('slash-menu');
let slashActive = -1;     // index into the current filtered rows
let slashDismissed = '';  // field value Esc dismissed the menu for

// A bare /name with nothing after it; null once arguments follow or the
// field is anything else.
function slashQuery() {
  const match = chatInput.value.match(/^\/([A-Za-z]*)$/);
  return match ? match[1].toLowerCase() : null;
}
function slashMatches() {
  const query = slashQuery();
  if (query === null) return [];
  return SLASH_COMMANDS.filter(item => item.name.startsWith(query));
}
function setSlashActive(index) {
  slashActive = index;
  const rows = [...slashMenu.querySelectorAll('.slash-item')];
  rows.forEach((row, at) => {
    const on = at === index;
    row.classList.toggle('is-active', on);
    row.setAttribute('aria-selected', String(on));
  });
  if (rows[index]) {
    rows[index].scrollIntoView({ block: 'nearest' });
    chatInput.setAttribute('aria-activedescendant', rows[index].id);
  } else chatInput.removeAttribute('aria-activedescendant');
}
function pickSlash(item) {
  if ([...jobs].some(job => !job.background)) return;
  slashMenu.hidden = true;
  chatInput.setAttribute('aria-expanded', 'false');
  chatInput.removeAttribute('aria-activedescendant');
  chatInput.value = '';
  chatResize();
  chatInput.focus();
  item.run('');
}
function renderSlashMenu() {
  const query = slashQuery();
  if (query === null || chatInput.value === slashDismissed || document.activeElement !== chatInput) {
    slashMenu.hidden = true;
    chatInput.setAttribute('aria-expanded', 'false');
    chatInput.removeAttribute('aria-activedescendant');
    return;
  }
  const matched = slashMatches();
  slashMenu.replaceChildren();
  if (!matched.length) {
    slashMenu.append(el('p', 'slash-empty', 'No matching command — try /brief.'));
  } else {
    if (slashActive < 0 || slashActive >= matched.length) slashActive = 0;
    matched.forEach((item, index) => {
      const row = el('button', 'slash-item' + (index === slashActive ? ' is-active' : ''));
      row.type = 'button';
      row.id = `slash-item-${index}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === slashActive));
      const badge = el('span', 'slash-icon', '');
      badge.innerHTML = icon(item.icon);
      badge.setAttribute('aria-hidden', 'true');
      const text = el('span', 'slash-text', '');
      const name = el('span', 'slash-name', item.title + ' ');
      name.append(el('span', 'slash-cmd', `/${item.name}`));
      text.append(name, el('span', 'slash-desc', item.desc));
      row.append(badge, text);
      // Mousedown would blur the composer and hide the menu before the click
      // lands; the click then reads as leaving the field. Hold focus instead.
      row.addEventListener('mousedown', event => event.preventDefault());
      row.addEventListener('click', () => pickSlash(item));
      row.addEventListener('mousemove', () => { if (slashActive !== index) setSlashActive(index); });
      slashMenu.append(row);
    });
    chatInput.setAttribute('aria-activedescendant', `slash-item-${slashActive}`);
  }
  slashMenu.hidden = false;
  chatInput.setAttribute('aria-expanded', 'true');
}
chatInput.addEventListener('input', () => { slashDismissed = ''; slashActive = -1; renderSlashMenu(); });
chatInput.addEventListener('focus', renderSlashMenu);
chatInput.addEventListener('blur', () => { slashMenu.hidden = true; });

// ── Conversation ──

async function chatSend() {
  // Sealed while the writer's own work runs — Stop first, then ask.
  if ([...jobs].some(job => !job.background)) return;
  slashMenu.hidden = true;
  const text = chatInput.value.trim();
  const slash = text.match(/^\/([A-Za-z]+)\s*([\s\S]*)$/);
  if (slash) {
    const command = SLASH_COMMANDS.find(item => item.name === slash[1].toLowerCase());
    if (!command) { notify('No such command — try /brief.'); return; }
    chatInput.value = '';
    chatResize();
    command.run(slash[2] || '');
    return;
  }
  // While the brief interview runs the composer is its answer field.
  if (briefSession) {
    if (briefSession.loading) return;
    if (!text) return;
    chatInput.value = '';
    chatResize();
    streamAppend(el('div', 'chat-entry is-user', text));
    answerBriefStep(text);
    return;
  }
  if (!text) return;
  if (!await ensureAgent()) return;
  chatInput.value = '';
  chatResize();
  chatAdd(el('div', 'chat-entry is-user', text));

  chatHistory.push({ role: 'user', content: text });
  saveChat();
  streamReply(newReplyBubble());
}

function newReplyBubble() {
  const reply = chatAdd(el('div', 'chat-entry is-agent is-markdown'));
  reply.append(el('span', 'chat-caret'));
  return reply;
}

// Split out from chatSend so a failed answer can be asked for again without
// the writer retyping the question — the turn is already in chatHistory.
async function streamReply(reply) {
  chatAbort?.abort();
  const job = startJob(); chatAbort = job;
  const request = { document: workView.state.doc.toString(), selection: null, changes: [],
    brief: JSON.stringify(positionBrief), message: chatHistory.at(-1)?.content };
  chatRequests.add(request);
  let answer = '', result = null;
  try {
    const res = await fetch('/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: job.signal,
      body: JSON.stringify({
        messages: chatHistory.map(({ role, content, edits }) => ({ role, content: content + (edits?.length ? `\n${EDITS_OPEN}${JSON.stringify(edits.map(({ label, quote, replacement, state }) => ({ label, quote, replacement, state })))}</stilura-edits>` : '') })),
        document: request.document, selection: request.selection?.text,
        selectionRange: request.selection && { from: request.selection.from, to: request.selection.to }, agent: currentAgent(),
        context: combinedContext() || undefined,
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Server error ${res.status}`);
    for await (const chunk of sseChunks(res)) {
      if (chunk.error) throw new Error(chunk.error);
      const stick = chatAtBottom();
      if (typeof chunk.answer === 'string') { answer = chunk.answer; result = chunk; }
      else answer += chunk.text ?? '';
      reply.innerHTML = renderMarkdown(answer); chatScroll(stick);
    }
    if (job.signal.aborted || !reply.isConnected) return;
    // No card is live until [DONE]; revalidate the envelope at the client too.
    const edits = locateChatEdits(result?.edits || [], request.document, request.selection);
    for (const edit of edits) for (const changes of request.changes) mapChatEdit(edit, changes);
    const message = { role: 'assistant', content: answer, edits, editWarning: result?.editWarning };
    // The finished answer follows the same rule as its tokens: a reader who
    // scrolled back up mid-stream keeps their place.
    const stick = chatAtBottom();
    chatHistory.push(message); renderChatAnswer(reply, message); saveChat(); chatScroll(stick);
    if (edits.length === 1) changeChatEdit(edits[0], false, true);
    if (message.editWarning) notify(message.editWarning);
    if (result?.briefWarning) notify(result.briefWarning);
    else if (result?.brief) applyChatBrief(result.brief, request.message, request.brief);
  } catch (error) {
    if (!reply.isConnected) return;
    if (error.name === 'AbortError') { reply.innerHTML = renderMarkdown(answer ? answer + '\n\n[Stopped — incomplete]' : 'Stopped'); return; }
    console.error('[/chat]', error);
    if (!answer) { reply.remove(); notifyProblem(modelError(error), () => streamReply(newReplyBubble())); }
    else reply.innerHTML = renderMarkdown(answer + '\n\n' + modelError(error).say);
  } finally { chatRequests.delete(request); finishJob(job); if (chatAbort === job) chatAbort = null; }
}

async function* sseChunks(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error('Connection ended before the answer completed. Retry.');
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6);
      if (payload === '[DONE]') return;
      yield JSON.parse(payload);
    }
  }
}

// ── Composer ──

function chatResize() {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 160)}px`;
  syncSend();
}

function syncSend() {
  const busy = [...jobs].some(job => !job.background);
  chatSendButton.classList.toggle('is-busy', busy);
  chatSendButton.disabled = !busy && !chatInput.value.trim();
  chatSendButton.setAttribute('aria-label', busy ? 'Stop' : 'Send');
  // While the writer's own work runs, the field is sealed: typing then would
  // read as steering a request that already left. The invitation says what
  // the field is doing instead, and the button is the work now.
  chatInput.readOnly = busy;
  chatInput.closest('.chat-composer')?.classList.toggle('is-busy', busy);
  chatInput.placeholder = busy ? 'Working…' : CHAT_PLACEHOLDER;
}

chatSendButton.addEventListener('click', () => {
  // The button stops only what it was showing: work the writer started.
  if ([...jobs].some(job => !job.background)) { stopJobs(); return; }
  chatSend();
  chatInput.focus();
});

syncSend();
chatInput.addEventListener('input', chatResize);

chatInput.addEventListener('keydown', event => {
  const menuOpen = !slashMenu.hidden;
  if (menuOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    const matched = slashMatches();
    if (matched.length) {
      event.preventDefault();
      const at = slashActive < 0 ? 0 : slashActive;
      setSlashActive((at + (event.key === 'ArrowDown' ? 1 : -1) + matched.length) % matched.length);
    }
    return;
  }
  if (menuOpen && event.key === 'Tab') {
    const matched = slashMatches();
    if (matched.length) {
      event.preventDefault();
      pickSlash(matched[slashActive] ?? matched[0]);
    }
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (menuOpen) {
      const matched = slashMatches();
      if (matched.length) { pickSlash(matched[slashActive] ?? matched[0]); return; }
      slashMenu.hidden = true;
    }
    chatSend();
  }
  else if (event.key === 'Escape') {
    // Escape belongs to the composer only while it has something to give up.
    // A key with two owners is claimed by the inner one: stopPropagation, so
    // nothing further up reads a state this handler has already undone — and
    // nothing above can act on the same press. With nothing attached and no
    // request running, the key is left alone to reach the sidebar overlay.
    if (chatAbort && !chatAbort.signal.aborted) { chatAbort.abort(); event.stopPropagation(); return; }
    if (menuOpen) {
      slashDismissed = chatInput.value;
      slashMenu.hidden = true;
      chatInput.removeAttribute('aria-activedescendant');
      event.stopPropagation();
      return;
    }
    if (briefSession) {
      cancelBrief();
      event.stopPropagation();
      return;
    }
    // An empty, unstarted composer folds back into the pill.
    if (!chatInput.value.trim() && canCollapseIsland()) {
      workView.focus();
      afterStreamLeaves(() => setIsland(false), true);
      event.stopPropagation();
    }
  }
});

// Keep focus where it is while the button is pressed: the mousedown would
// otherwise blur the composer first, and the click would read as leaving the
// field rather than as opening or closing the conversation.
chatClear.addEventListener('mousedown', event => event.preventDefault());
chatClear.addEventListener('click', () => {
  const open = chatStream.hidden;
  // Dismissing returns to the draft; opening returns to the composer. Focusing
  // the composer on close pops the keyboard after the user asked to leave.
  if (open) { setChatOpen(true); chatInput.focus(); return; }
  workView.focus();
  // Closing an empty, unstarted chat folds the whole island back into the
  // pill; otherwise only the stream goes.
  const fold = canCollapseIsland();
  afterStreamLeaves(() => { setChatOpen(false); if (fold) setIsland(false); }, fold);
});

// Cmd/Ctrl+K opens the same local field as Change.
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    if (document.querySelector('dialog[open]')) return;
    const active = document.activeElement;
    if (active !== document.body && !workView.dom.contains(active)) return;
    event.preventDefault();
    openPassage(workView, workView.state.selection.main);
  }
});

// ─── Editor theme (injected into <head> by CM6) ─────────────────────────────────

const isDark = currentTheme === 'dark';

// One visible highlight per character. Tracking fields keep all anchors intact.
function textHighlights(state) {
  const generation = state.field(generationField);
  const passage = state.field(passageField);
  const preview = state.field(variantPlainField);
  const flash = state.field(flashField);
  const mark = (value, className) => value && value.to > value.from
    ? Decoration.set([Decoration.mark({ class: className, ...(className === 'cm-passage-busy' ? { attributes: { 'aria-busy': 'true' } } : {}) }).range(value.from, value.to)]) : Decoration.none;
  const markers = (field, className, attribute) => Decoration.set(state.field(field).map(value =>
    Decoration.mark({ class: className, attributes: { [attribute]: String(value.from), title: `${value.message} Click for suggestions.` } }).range(value.from, value.to)), true);
  const selectionMask = Decoration.mark({});
  // Later sets win: diagnostics < working range < native selection < loading.
  const sets = [
    state.field(markdownField), state.field(noteField, false) ?? Decoration.none,
    markers(spellMarkerField, 'cm-spell-marker', 'data-spell-from'),
    mark(flash, 'cm-applied-flash'),
    mark(passage, 'cm-attached'), state.field(requestField),
    Decoration.set(state.selection.ranges.filter(range => !range.empty).map(range => selectionMask.range(range.from, range.to)), true),
    mark(passage?.busy ? passage : null, 'cm-passage-busy'),
  ];
  const priorities = new Map();
  sets.forEach((set, priority) => set.between(0, state.doc.length, (_from, _to, value) => priorities.set(value, priority)));
  // Replacement widgets occupy their range exclusively, including during regeneration.
  if (generation && !waitingForSlash(generation) && !(generation.source === 'passage' && passage?.busy)) sets.unshift(Decoration.set([
    Decoration.replace({ widget: new GenerationWidget(generation), block: !generation.inline }).range(generation.from, generation.to),
  ]));
  if (preview) sets.unshift(Decoration.set([
    Decoration.replace({ widget: new PlainVariantWidget(preview.text, preview.block), block: preview.block }).range(preview.from, preview.to),
  ]));
  const ranges = [], last = new Map();
  const emit = (from, to, value) => {
    const previous = last.get(value);
    if (previous?.to === from) previous.to = to;
    else { const range = value.range(from, to); ranges.push(range); last.set(value, range); }
  };
  RangeSet.spans(sets, 0, state.doc.length, {
    span(from, to, active) {
      let winner;
      for (const value of active) if (priorities.get(value) > 0 && (!winner || priorities.get(value) > priorities.get(winner))) winner = value;
      if (winner !== selectionMask && winner) emit(from, to, winner);
      // Keep Markdown formatting except inside the word-shaped loading placeholder.
      if (winner?.spec.class !== 'cm-passage-busy') {
        for (const value of active) if (priorities.get(value) === 0) emit(from, to, value);
      }
    },
    point: emit,
  });
  return Decoration.set(ranges, true);
}
const textHighlightLayer = EditorView.decorations.compute([
  markdownField, noteField, spellMarkerField,
  flashField, passageField, requestField, generationField, variantPlainField, 'selection',
], textHighlights);

const editorTheme = createEditorTheme(isDark);

// ─── Editor setup ──────────────────────────────────────────────────────────────

const historyComp = new Compartment();
const workView = new EditorView({
  state: EditorState.create({
    doc: '',

    extensions: [
      // Undo/redo
      historyComp.of(history()),
      drawSelection(),
      textSelection,
      focusMode,

      // ── Keymaps (highest priority first) ──────────────────────────────────
      //
      //  Prec.high ensures our handlers are tried before defaultKeymap.
      //  Each run() must return true (handled) or false (pass through).
      //
      Prec.high(keymap.of([
        {
          // Tab accepts a suggestion; otherwise it moves focus normally.
          key: 'Tab',
          run(view) {
            if (ghostAccept(view)) return true;
            return false; // Native Tab navigation when no suggestion is present.
          },
        },
        {
          // Escape: cancel generation or dismiss the continuation.
          key: 'Escape',
          run(view) {
            if (generate.job()) { generate.job().abort(); return true; }
            if (passage.job()) { passage.job().abort(); return true; }
            if (view.state.field(passageField)) { closePassage(view, { restoreSelection: true }); return true; }
            const ghost = view.state.field(ghostField);
            const pending = suggestPending();
            if (!ghost && !pending) return false;
            cancelSuggestion();
            ghostClear(view);
            return true;
          },
        },
        {
          // Focus mode: Cmd/Ctrl+. as in other focus-writing editors.
          key: 'Mod-.',
          run() { applyFocus(!document.body.classList.contains('focus-mode')); return true; },
        },
        {
          key: 'Mod-Enter',
          run(view) {
            cancelSuggestion();
            ghostClear(view);
            void suggestFetch(true);
            return true;
          },
        },
      ])),

      Prec.high(keymap.of([{ key: 'Enter', run: handleWrite }])),

      // Standard text-editing and history keymaps
      keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
      // Native spellcheck: free red squiggly + right-click suggestions from
      // the OS/browser dictionary. Autocorrect/autocapitalize stay off — a
      // silent rewrite is not what "quick fix" means here.
      EditorView.contentAttributes.of({
        'aria-label': 'Draft editor', 'aria-describedby': 'editor-shortcuts',
        spellcheck: 'true', autocorrect: 'off', autocapitalize: 'off',
      }),

      // Ghost text state + decoration provider
      ghostField,
      generationField,
      Prec.highest(generationInput),
      requestField,
      passageField,
      markdownField,
      spellMarkerField,
      variantPlainField,
      flashField,
      textHighlightLayer,

      // Read-only compartment — toggled while loading the document
      readonlyComp.of(EditorState.readOnly.of(true)),

      // Word wrap (essential for prose)
      EditorView.lineWrapping,

      // Reserve the covered strips so CodeMirror scrolls the caret clear of
      // both: the floating panel below, and the 48px header above — a jumped-to
      // line never parks flush under it.
      EditorView.scrollMargins.of(() => ({ top: 64, bottom: chatHeight })),

      // Visual theme
      editorTheme,

      // Passage gestures stay in the editor.
      EditorView.domEventHandlers({
        compositionstart(_event, view) { cancelSuggestion(); ghostClear(view); return false; },
        compositionend() { suggestSchedule(); return false; },
        click(event, view) {
          // A real selection wins over the mark underneath it: selecting is
          // acting, clicking is reading. The selection bubble already stands
          // from mouseup; the mark keeps its caret placement only.
          if (!view.state.selection.main.empty) return false;
          const at = { x: event.clientX, y: event.clientY };
          // The writer's own notes win over model marks underneath: a click
          // reads the note and arms nothing.
          const noteMarkEl = event.target.closest?.('.cm-note');
          if (noteMarkEl) {
            if (noteMarkEl.dataset.noteId && noteCards.has(noteMarkEl.dataset.noteId)) focusNote(noteMarkEl.dataset.noteId);
            return false;
          }
          const spellLocal = event.target.closest?.('.cm-spell-marker');
          const marker = spellLocal && view.state.field(spellMarkerField).find(item => item.from === Number(spellLocal.dataset.spellFrom));
          if (marker) showSpellBubble(marker, at.x, at.y);
          return false;
        },
        // Reaching for the text dismisses a hover preview; the cards stay —
        // choosing is a click on a card, not a click in the draft.
        mousedown() { clearPlainPreview(); return false; },

      }),

      EditorView.updateListener.of(suggestionUpdate),
      // The island's key hint lives exactly as long as the suggestion it names.
      EditorView.updateListener.of(update => {
        if (notices.state().key === 'passage-hint' && update.state.field(generationField)?.phase !== 'review') notify('', { key: 'passage-hint' });
      }),

      // Save on every edit.
      // Anything that moves the text moves the cards beside it.
      EditorView.updateListener.of(update => {
        if (update.docChanged || update.geometryChanged || update.viewportChanged) {
          layoutRail();
          hideNotePlus();   // its paragraph may have moved; it follows the mouse back
          // Only an edit invalidates the bubble — the words it points at may
          // be gone. A scroll or a reflow moves them; the bubble follows.
          if (update.docChanged) hideMarkBubble();
          else reanchorBubble();
        } else if (bubble.mode() === 'selection' && update.selectionSet && update.state.selection.main.empty) {
          hideMarkBubble();
        }
      }),

      EditorView.updateListener.of(update => {
        if (passage.job() && (!update.state.field(passageField) || update.state.readOnly || docState.loadingDocument || docState.savePaused)) passage.job().abort();
        if (generate.job() && (!update.state.field(generationField) || update.state.readOnly || docState.loadingDocument || docState.savePaused)) generate.job().abort();
        if (update.selectionSet && !update.docChanged) for (const ui of chatEditCards.values()) if (!ui.retarget.hidden) syncRetarget(ui);
        if (update.docChanged) {
          liveSync?.changed(update.changes);
          docState.editVersion++;
          for (const request of chatRequests) request.changes.push(update.changes);
          for (const message of chatHistory) for (const edit of message.edits || []) {
            if (edit !== changingChatEdit) mapChatEdit(edit, update.changes);
          }
          syncChatEditCards();
          if (!docState.loadingDocument) saveChat();
          if (update.transactions.some(tr => tr.isUserEvent('undo') || tr.isUserEvent('redo'))) clearNotice('undo');
          // A hover preview is a decoration over the old range; any edit drops it.
          if (plainPreview) queueMicrotask(clearPlainPreview);
          // Map anchors now; redraw and persist on the next tick because a
          // dispatch inside an update listener is illegal.
          if (marginNotes.length && !docState.loadingDocument) {
            // A disk reload replaces everything without identifying which passage changed.
            let replacedAll = false;
            update.changes.iterChangedRanges((from, to) => { if (from === 0 && to === update.startState.doc.length) replacedAll = true; });
            if (!replacedAll) mapNoteAnchors(marginNotes, update.startState.doc.toString(), update.state.doc.toString(), update.changes);
            queueMicrotask(() => { if (!docState.loadingDocument && marginNotes.length) { syncNoteMarks(); saveNotes(); } });
          }
          if (!docState.loadingDocument) save();
          scheduleSpellCheck();

        }
      }),
    ],
  }),

  parent: editorWrap,
});

// The rail rides inside the editor's scroller so note cards composite with
// the text instead of chasing it per scroll event (see layoutRail).
workView.scrollDOM.appendChild(rail);
// Content reflow (font arrival, zoom, wrap change) moves anchors without an
// edit: the rail's tops are document coordinates, so follow the content.
new ResizeObserver(() => layoutRail()).observe(workView.contentDOM);

// The checker binary is large; fetch it once in the background and mark
// whatever is already on the page as soon as it is ready.
spelling.start().catch(error => notifyProblem({ say: 'Spellcheck is unavailable.', detail: error.message }, null, 'Try again', 'spell-error'));

// ─── Persist ───────────────────────────────────────────────────────────────────

new ResizeObserver(() => {
  // Panel height + its 36px offset from the bottom + a line of breathing room.
  chatHeight = Math.round(chatPanel.getBoundingClientRect().height) + 64;
  document.documentElement.style.setProperty('--chat-height', `${chatHeight}px`);
  workView.dispatch({
    effects: EditorView.scrollIntoView(workView.state.selection.main.head, { y: 'nearest' }),
  });
}).observe(chatPanel);

// Workspace identity comes from the server path, never from the port or a
// global browser draft. Conflicts pause writes until explicitly resolved.
function saveSnapshot(label) {
  const snapshots = safeJson(docStorage.getItem('snapshots'), []);
  if (!Array.isArray(snapshots)) return;
  snapshots.unshift({ text: workView.state.doc.toString(), at: new Date().toISOString(), label });
  docStorage.setItem('snapshots', JSON.stringify(snapshots.slice(0, 10)));
}
function exportText(text, name = 'draft.md') {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function dialog(title) {
  const trigger = document.activeElement;
  const modal = el('dialog', 'settings-dialog document-dialog');
  const heading = el('h2', '', title);
  heading.id = 'document-dialog-' + crypto.randomUUID();
  modal.setAttribute('aria-labelledby', heading.id);
  // Title left, one × right — the same header the settings dialog has. A
  // full-width `Close` button under the title read as the dialog's action.
  const close = el('button', 'dialog-close', '×');
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => modal.close());
  const head = el('header', '');
  head.append(heading, close);
  modal.append(head);
  document.body.append(modal);
  modal.addEventListener('close', () => { modal.remove(); if (trigger?.isConnected) trigger.focus(); });
  modal.showModal();
  return modal;
}
function loadFromDisk(text) {
  docState.loadingDocument = true;
  docState.autosaveHold = false;   // the document is replaced — no delete to guard
  clearNotice('undo');
  for (const job of jobs) job.abort();
  cancelSuggestion();
  saveSnapshot('Before replacing document');
  workView.dispatch({ changes: { from: 0, to: workView.state.doc.length, insert: text } });
  // Chat, notes and brief belonged to the replaced text: drop them and their stored copies.
  docState.emit('reset', { forget: true });
  docState.loadingDocument = false;
}
// Replacing the draft asks nothing: the old text goes to History, and the
// notice carries an Undo for the next few seconds.
function replaceDraft(text, message) {
  const previous = workView.state.doc.toString();
  loadFromDisk(text); save();
  notifyUndo(message, () => { loadFromDisk(previous); save(); });
}
function saveToDisk() {
  if (liveSync?.active) return;
  clearTimeout(docState.diskTimer);
  if (docState.savePaused || docState.loadingDocument || docState.diskHold || docState.autosaveHold) return;
  // Routine saves are silent: autosave is expected to work, and a Saved /
  // Unsaved flicker on every pause reports nothing the writer can act on.
  // The header speaks only when attention is needed (error, conflict).
  docState.diskTimer = setTimeout(flushSave, 800);
}
function draftUrl(suffix = '') {
  return `/draft${suffix}` + (docState.documentName ? `?name=${encodeURIComponent(docState.documentName)}` : '');
}
function openDocumentText(text) {
  // Drop the previous file's undo stack before installing the new text.
  workView.dispatch({ effects: historyComp.reconfigure([]) });
  workView.dispatch({
    changes: { from: 0, to: workView.state.doc.length, insert: text },
    effects: historyComp.reconfigure(history()),
    annotations: Transaction.addToHistory.of(false),
  });
}
function flushSave() {
  if (liveSync?.active) return liveSync.flush();
  if (docState.saving) return docState.savePromise;
  if (docState.savePaused || docState.loadingDocument || docState.diskHold) return;
  const text = workView.state.doc.toString();
  if (text === docState.diskText && docState.diskRevision !== 'missing') return;
  docState.saving = true;
  docState.savePromise = (async () => {
  try {
    const response = await fetch(draftUrl(), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, revision: docState.diskRevision }),
    });
    const data = await response.json();
    if (response.status === 409) { handleFreshDisk(data.current); return; }
    if (!response.ok) throw new Error(data.error || 'Save failed');
    noteDiskBaseline(text, data.revision);
    docState.autosaveHold = false;   // any successful save resumes the schedule
    // A recovered save clears a previous error line, then goes quiet again.
    clearNotice('disk');
  } catch (error) {
    docState.savePaused = true;
    cancelSuggestion();
    ghostClear(workView);
    // The payload belongs in the tooltip; the notice carries the sentence
    // and the way out.
    notifyProblem({ say: 'Not saved — autosave paused.', act: 'retry', detail: error.message },
      () => { docState.savePaused = false; saveToDisk(); }, 'Retry saving', 'disk');
  } finally {
    docState.saving = false;
    docState.savePromise = null;
    if (!docState.savePaused && workView.state.doc.toString() !== docState.diskText) saveToDisk();
  }
  })();
  return docState.savePromise;
}
function save() {
  docStorage.setItem('wa-working', workView.state.doc.toString());
  liveSync?.notesChanged();
  saveToDisk();
}
// ─── Disk drift ──────────────────────────────────────────────────────────────
//
//  No modal, ever: a file changing under the editor is routine (another
//  editor, a second tab, a git pull), and a modal makes it an emergency.
//  The verdict comes from resolveDrift — silent in the two cases that need
//  no decision, and a slim banner above the draft in the one that does.
//  While the banner stands only disk writes wait; typing, suggestions and
//  the assistant keep working on the local copy.
const driftBanner = document.getElementById('drift-banner');
const driftDiffBody = document.getElementById('drift-diff-body');
let driftCurrent = null;   // fresh { text, revision } awaiting a choice

// The last disk text we confirmed, durable across restarts. Without it a
// reopen with unsaved work looks identical to an external edit — that
// confusion is what the old launch modal punished.
function noteDiskBaseline(text, revision) {
  docState.diskText = text; docState.diskRevision = revision;
  docStorage.setItem('wa-disk', JSON.stringify({ text, revision }));
}
function lastDiskBaseline() {
  const base = safeJson(docStorage.getItem('wa-disk'), null);
  return base && typeof base.text === 'string' ? base : null;
}
function handleFreshDisk(current) {
  if (!current || typeof current.text !== 'string') return;
  const verdict = resolveDrift(workView.state.doc.toString(), current.text, lastDiskBaseline()?.text);
  if (verdict === 'in-sync') { noteDiskBaseline(current.text, current.revision); hideDriftBanner(); return; }
  if (verdict === 'fast-forward') { adoptDiskText(current, true); return; }
  showDriftBanner(current);
}
// Take the disk copy without touching chat or focus: the writer
// changed nothing, so there is nothing of theirs to disturb. Announced with
// a toast when it happens behind their back, silently at startup.
function adoptDiskText(current, announce = false) {
  liveSync?.close();
  workView.dispatch({ changes: { from: 0, to: workView.state.doc.length, insert: current.text } });
  noteDiskBaseline(current.text, current.revision);
  liveSync?.connect(current);
  docState.diskHold = false; hideDriftBanner(); save();
  if (announce) notify('Reloaded from disk — it changed outside Stilura.');
}
function showDriftBanner(current) {
  driftCurrent = current;
  docState.diskHold = true;
  // The banner is the whole report for this case: it sits over the draft,
  // names the conflict and carries both ways out. A second copy in the stream
  // said the same sentence in error red and pulled the panel open over the
  // text the writer was trying to resolve it against.
  renderDriftDiff();
  driftBanner.hidden = false;
}
function hideDriftBanner() {
  driftCurrent = null;
  driftBanner.hidden = true;
  document.getElementById('drift-diff')?.removeAttribute('open');
}
function renderDriftDiff() {
  driftDiffBody.replaceChildren();
  if (!driftCurrent) return;
  const local = workView.state.doc.toString();
  const ops = wordDiff(driftCurrent.text, local);
  let shown = 0;
  for (const op of ops) {
    let text = op.text;
    // Long unchanged runs collapse: the decision needs the changes, not the
    // whole document reprinted around them.
    if (op.type === 'keep' && text.length > 400) text = text.slice(0, 200) + ' ⋯ ' + text.slice(-200);
    if (shown + text.length > 30000) {
      driftDiffBody.append(el('p', 'drift-diff-more', '… further differences truncated'));
      break;
    }
    shown += text.length;
    if (op.type === 'keep') driftDiffBody.append(document.createTextNode(text));
    else {
      const mark = document.createElement(op.type === 'del' ? 'del' : 'ins');
      mark.className = op.type === 'del' ? 'drift-del' : 'drift-ins';
      mark.textContent = text;
      driftDiffBody.append(mark);
    }
  }
  const legend = el('p', 'drift-legend', 'Struck text lives only on disk · highlighted text only in your copy');
  driftDiffBody.prepend(legend);
}
document.getElementById('drift-load').addEventListener('click', () => {
  if (driftCurrent) adoptDiskText(driftCurrent);
  workView.focus();
});
document.getElementById('drift-keep').addEventListener('click', () => {
  if (!driftCurrent) return;
  // Adopt the fresh revision and keep typing: the next save overwrites the
  // disk copy. Overwriting loses nothing — the server snapshots the previous
  // disk text into .stilura-history before every write, and the browser keeps
  // its own checkpoint in History.
  noteDiskBaseline(driftCurrent.text, driftCurrent.revision);
  liveSync?.connect(driftCurrent);
  docState.diskHold = false; hideDriftBanner(); save(); workView.focus();
});
function restoreDocument(current) {
  docState.documentKey = 'stilura:' + current.id + ':';
  docState.documentName = current.name ?? current.path.split(/[\\/]/).pop();
  // Capture the old baseline before installing the current disk revision.
  const driftBase = lastDiskBaseline();
  noteDiskBaseline(current.text, current.revision);
  const cached = docStorage.getItem('wa-working');
  // Normalize disk text once; cached work already has the writer's formatting.
  const opened = cached === null ? unwrapProse(current.text) : { text: cached, joined: 0 };
  openDocumentText(opened.text);
  docState.loadingDocument = false;
  docState.savePaused = false;
  docState.emit('restore');
  renderFileList();
  if (cached !== null) {
    const verdict = resolveDrift(workView.state.doc.toString(), current.text, driftBase?.text);
    if (verdict === 'fast-forward') adoptDiskText(current);
    else if (verdict === 'diverged') showDriftBanner(current);
  }
  else clearNotice('disk');
  if (!docState.diskHold) liveSync.connect(current);
  if (opened.joined > 0) {
    notifyUndo(`Opened ${docState.documentName} — ${opened.joined} wrapped ${opened.joined === 1 ? 'line' : 'lines'} joined into paragraphs. Saves go to this file.`, () => {
      workView.dispatch({ changes: { from: 0, to: workView.state.doc.length, insert: current.text } });
      save();
    });
  }
  return opened;
}
async function initializeDocument() {
  try {
    const current = await api('/draft');
    restoreDocument(current);
    editorSetReadonly(workView, false);
    saveToDisk();
  } catch (error) {
    // The try also covers restoring saved state, so a failure here is not always the network.
    console.error('[open draft]', error);
    notifyProblem({ say: 'Stilura could not open the draft.', act: 'retry', detail: error.message }, initializeDocument, 'Retry', 'disk');
  }
}
liveSync = liveDocument({
  view: workView,
  url: () => draftUrl('/live'),
  getNotes: () => marginNotes,
  readPendingNotes() {
    try { return JSON.parse(docStorage.getItem('wa-note-pending') || '[]'); } catch { return []; }
  },
  writePendingNotes: entries => docStorage.setItem('wa-note-pending', JSON.stringify(entries)),
  onSaved(current) { noteDiskBaseline(current.text, current.revision); docState.savePaused = false; clearNotice('disk'); },
  onError(error) { notify('Synchronization paused — your local changes are kept.', { sticky: true, key: 'disk', detail: error.message, action: () => liveSync.flush().catch(error => notify(error.message)), label: 'Retry' }); },
  onConflict: showDriftBanner,
  onNotes(notes, ready) {
    if (!ready) return;
    for (const note of [...marginNotes]) {
      if (notes.some(item => item.id === note.id) || !note.text || noteCards.get(note.id)?.querySelector('textarea')) continue;
      removeNoteSilent(note.id);
    }
    for (const incoming of notes) {
      let note = marginNotes.find(item => item.id === incoming.id);
      const editing = noteCards.get(incoming.id)?.querySelector('textarea');
      if (note) Object.assign(note, incoming);
      else { note = { ...incoming }; marginNotes.push(note); }
      if (note.resolved && !note.work && !editing) {
        const card = noteCards.get(note.id);
        if (card) { railAnchors.delete(card); railHomes.delete(card); card.remove(); noteCards.delete(note.id); }
      } else if ((!note.resolved || note.work) && !noteCards.has(note.id)) noteCards.set(note.id, railAdd(noteCard(note), () => noteAnchor(note.id)));
    }
    syncNoteMarks();
    docStorage.setItem('wa-notes', JSON.stringify({ notes: marginNotes }));
  },
});
initializeDocument();
async function checkDiskDrift() {
  if (liveSync?.active) { await liveSync.flush().catch(() => {}); return; }
  if (docState.loadingDocument || docState.switchingDocument || docState.saving || docState.autosaveHold) return;
  const key = docState.documentKey;
  try {
    const current = await api(draftUrl());
    if (key !== docState.documentKey || docState.switchingDocument) return;
    if (current.revision !== docState.diskRevision) handleFreshDisk(current);
  } catch (error) { notify(`Unable to check the file on disk: ${error.message}. Your draft is kept.`, { sticky: true, key: 'disk', action: checkDiskDrift, label: 'Try again' }); }
}
window.addEventListener('focus', () => { checkDiskDrift(); if (!sidebar.classList.contains('is-closed')) refreshFileList(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelSuggestion(); ghostClear(workView); }
  else { checkDiskDrift(); refreshUpdate(); }
});
window.addEventListener('beforeunload', event => {
  if (!docState.loadingDocument && (docState.saving || workView.state.doc.toString() !== docState.diskText)) { event.preventDefault(); event.returnValue = ''; }
});
// A free name in the folder: "Untitled.md", then "Untitled 2.md", …
function freeFileName(base, extension = '.md') {
  const taken = new Set(sidebarFiles.map(file => file.name.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = `${base}${n > 1 ? ` ${n}` : ''}${extension}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}
// Creates a new file and never overwrites one: the server refuses an
// existing name (409), and the next free name is tried instead.
async function createFile(base, extension, text) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const name = freeFileName(base, extension);
    try {
      await api('/file', { method: 'PUT', body: JSON.stringify({ name, text }) });
      await refreshFileList();
      return name;
    } catch (error) {
      if (error.status !== 409) throw error;
      await refreshFileList();
    }
  }
  throw new Error('No free file name');
}
// New and import add a file to the folder and open it. The open draft is
// saved and left as it is, never replaced.
document.getElementById('file-new').addEventListener('click', async () => {
  try {
    const name = await createFile('Untitled', '.md', '');
    await switchDocument(name);
    workView.focus();
  } catch (error) { notify(`Unable to create a file: ${error.message}`, { sticky: true }); }
});
document.getElementById('file-export').addEventListener('click', async () => {
  try {
  if (typeof window.showSaveFilePicker !== 'function') {
    exportText(workView.state.doc.toString(), docState.documentName);
    return;
  }
  const handle = await window.showSaveFilePicker({
    suggestedName: docState.documentName,
    types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] } }],
  });
  const writable = await handle.createWritable();
  await writable.write(workView.state.doc.toString());
  await writable.close();
  refreshFileList();
  workView.focus();
  } catch (error) {
    if (error.name !== 'AbortError') notify(`Unable to save a copy: ${error.message}. Your draft is unchanged.`, { sticky: true, action: () => document.getElementById('file-export').click(), label: 'Try again' });
  }
});
document.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
  event.preventDefault(); clearTimeout(docState.diskTimer); flushSave();
});
async function importFile(file) {
  if (!file || docState.loadingDocument) return;
  if (file.size > 1024 * 1024 || !/\.(md|markdown|txt)$/i.test(file.name)) {
    notify('Open a Markdown or text file under 1 MB.');
    return;
  }
  try {
    // A copy of the file joins the folder under its own name (or the next
    // free one) and opens, flowing like any sidebar file. The open draft is
    // saved and left as it is.
    const text = await file.text();
    const extension = file.name.match(/\.(md|markdown|txt)$/i)[0].toLowerCase();
    const base = file.name.slice(0, -extension.length).replace(/[\\/]/g, ' ').trim() || 'Imported';
    const name = await createFile(base, extension, text);
    await switchDocument(name);
  } catch (error) { notify(`Unable to open ${file.name}: ${error.message}. Your draft is unchanged.`, { sticky: true, action: () => importFile(file), label: 'Try again' }); }
}
// ─── File sidebar ────────────────────────────────────────────────────────────
//
//  The header toggle owns the sidebar; every file action lives inside it.
//  Rows name the workspace Markdown and text files — opening one switches the
//  single active document (and its saves) onto that file, so what is on screen
//  is always what is being saved. Each file keeps its own browser copy, chat
//  which come back when it is opened again.
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarToggleSide = document.getElementById('sidebar-toggle-side');
const fileList = document.getElementById('file-list');
const fileFilter = document.getElementById('file-filter');
let sidebarFiles = [];
let sidebarToggleTimer = null;
// True only where the sidebar is a layer over the draft rather than a column
// beside it — the same 640px the stylesheet switches the panel to `fixed` at.
// Above it the panel is part of the layout, and dismissing it on Escape or a
// stray click would be closing a pane the writer is reading beside.
const sidebarOverlayQuery = window.matchMedia('(max-width: 640px)');
const sidebarIsOverlay = () => sidebarOverlayQuery.matches && !sidebar.classList.contains('is-closed');
function setSidebar(open, persist = true) {
  // Width-animated, not display-toggled: the pane and composer glide with
  // it. inert keeps the collapsed panel out of tab order and screen readers.
  sidebar.classList.toggle('is-closed', !open);
  sidebar.inert = !open;
  // Two static buttons, one per head: each stays where it is, so nothing
  // travels while the panel glides. Both hide for the glide itself — neither
  // the leaving nor the arriving button should be caught mid-travel — then
  // only the one in the visible head comes back. Matches the .25s width
  // transition in CSS; instant when motion is reduced.
  sidebarToggle.hidden = true;
  sidebarToggleSide.hidden = true;
  sidebarToggle.setAttribute('aria-expanded', String(open));
  sidebarToggleSide.setAttribute('aria-expanded', String(open));
  clearTimeout(sidebarToggleTimer);
  const revealToggle = () => { sidebarToggle.hidden = open; sidebarToggleSide.hidden = !open; };
  // Nothing glides on the first call — the panel is already where it is going
  // to be — so waiting out the transition would only leave the window with no
  // toggle at all for a quarter of a second on every launch.
  if (!persist || reduceMotion()) revealToggle();
  else sidebarToggleTimer = setTimeout(revealToggle, 260);
  // The composer is viewport-centred (position: fixed), while the draft
  // re-centres inside the narrowed pane — without this it sits 124px off
  // the text it belongs to whenever the panel is open.
  document.documentElement.dataset.sidebar = open ? 'open' : 'closed';
  if (persist) { try { localStorage.setItem('wa-sidebar', open ? 'open' : 'closed'); } catch {} }
  if (open) refreshFileList();
}
function renderFileList() {
  const query = fileFilter.value.trim().toLowerCase();
  const shown = sidebarFiles.filter(file => !query || file.name.toLowerCase().includes(query));
  fileList.replaceChildren();
  if (!sidebarFiles.length) {
    fileList.append(el('li', 'file-list-empty', 'No Markdown or text files here yet.'));
    return;
  }
  if (!shown.length) {
    fileList.append(el('li', 'file-list-empty', 'Nothing matches this filter.'));
    return;
  }
  for (const file of shown) {
    const item = document.createElement('li');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'file-card';
    // The card shows name, age and excerpt; the size stays in the tooltip.
    row.title = `${file.name} · ${formatFileSize(file.size)}`;
    if (file.name === docState.documentName) row.setAttribute('aria-current', 'true');
    const top = el('span', 'file-card-top');
    const name = el('span', 'file-name', '');
    name.textContent = file.name;
    const meta = el('span', 'file-meta', '');
    meta.textContent = timeAgo(file.mtime);
    top.append(name, meta);
    row.append(top);
    if (file.excerpt) {
      const excerpt = el('span', 'file-excerpt', '');
      excerpt.textContent = file.excerpt;
      row.append(excerpt);
    }
    // Opening a file is the end of the visit to the panel, so on a narrow
    // window the overlay gets out of the way of the draft it just replaced.
    row.addEventListener('click', () => {
      if (sidebarIsOverlay()) setSidebar(false);
      switchDocument(file.name);
    });
    item.append(row);
    // The home draft is where Stilura opens, so it keeps its name and stays.
    if (!file.home) {
      item.classList.add('has-file-actions');
      item.append(fileActions(file, item));
    }
    fileList.append(item);
  }
}
function fileActions(file, item) {
  const actions = el('span', 'file-actions');
  const toggle = el('button', 'file-more', '⋯');
  toggle.type = 'button';
  toggle.setAttribute('aria-label', `Actions for ${file.name}`);
  toggle.setAttribute('aria-expanded', 'false');
  const panel = el('span', 'file-action-panel');
  panel.setAttribute('popover', 'auto');
  toggle.popoverTargetElement = panel;
  panel.addEventListener('beforetoggle', event => {
    const open = event.newState === 'open';
    item.classList.toggle('file-menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      const bounds = toggle.getBoundingClientRect();
      panel.style.left = `${Math.max(8, bounds.right - 152)}px`;
      panel.style.top = `${Math.min(bounds.bottom + 4, window.innerHeight - 88)}px`;
    }
  });
  const rename = el('button', 'file-action', 'Rename');
  rename.type = 'button';
  rename.autofocus = true;
  rename.addEventListener('click', () => { panel.hidePopover(); startRename(file, item); });
  const remove = el('button', 'file-action', 'Move to Trash');
  remove.type = 'button';
  remove.addEventListener('click', () => { panel.hidePopover(); deleteFile(file.name); });
  panel.append(rename, remove);
  actions.append(toggle, panel);
  return actions;
}

// Renaming happens in place: Enter keeps the new name, Escape or leaving
// the field keeps the old one.
function startRename(file, item) {
  const input = el('input', 'file-rename');
  Object.assign(input, { type: 'text', value: file.name, spellcheck: false });
  input.setAttribute('aria-label', `New name for ${file.name}`);
  item.classList.add('is-renaming');
  // The field stands in for the card, not inside it: keys typed into a
  // field inside a button would press the button.
  item.querySelector('.file-card').hidden = true;
  item.prepend(input);
  input.focus();
  input.setSelectionRange(0, file.name.replace(/\.(md|markdown|txt)$/i, '').length);
  let done = false;
  const finish = async commit => {
    if (done) return;
    done = true;
    const to = commit ? newFileName(input.value) : null;
    if (!to || to === file.name) { renderFileList(); return; }
    await renameFile(file.name, to);
  };
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(false));
}

// Browser-side copies (working text, chat, notes, brief) are stored under
// the document's id, which follows its path: move them with the rename.
function moveDocumentStorage(previousId, id) {
  const from = `stilura:${previousId}:`, to = `stilura:${id}:`;
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(from)) keys.push(key);
  }
  for (const key of keys) {
    localStorage.setItem(to + key.slice(from.length), localStorage.getItem(key));
    localStorage.removeItem(key);
  }
}

async function renameFile(name, to) {
  const rename = async () => {
    const result = await api('/file/rename', { method: 'POST', body: JSON.stringify({ name, to }) });
    moveDocumentStorage(result.previousId, result.id);
    return result;
  };
  try {
    if (name !== docState.documentName) {
      await rename();
      await refreshFileList();
    } else {
      // The open file: save it, let go of its live session, move it, then
      // open it again under the new name.
      await switchDocument(to, { before: async () => {
        liveSync?.close();
        try { await rename(); }
        catch (error) { liveSync?.connect(await api(draftUrl())); throw error; }
      } });
      await refreshFileList();
    }
    notify(`Renamed to ${to}.`);
  } catch (error) {
    notify(`Unable to rename ${name}: ${error.message}`, { sticky: true });
    renderFileList();
  }
}

// Deleting moves the file and its notes and history to the folder's .trash/;
// Undo brings them back. The open file is left first, for the home draft.
async function deleteFile(name) {
  const wasOpen = name === docState.documentName;
  try {
    if (wasOpen) {
      const home = sidebarFiles.find(file => file.home)?.name;
      if (!home) throw new Error('The home draft is missing.');
      await switchDocument(home);
      if (docState.documentName === name) return; // the switch was refused; its notice says why
    }
    const { trashed } = await api(`/file?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
    await refreshFileList();
    notify(`Moved ${name} to the trash.`, { label: 'Undo', action: async () => {
      try {
        await api('/file/restore', { method: 'POST', body: JSON.stringify({ trashed }) });
        await refreshFileList();
        if (wasOpen) await switchDocument(name);
      } catch (error) { notify(`Unable to restore ${name}: ${error.message}`, { sticky: true }); }
    } });
  } catch (error) { notify(`Unable to delete ${name}: ${error.message}`, { sticky: true }); }
}

async function refreshFileList() {
  try {
    const { files } = await api('/files');
    sidebarFiles = Array.isArray(files) ? files : [];
  } catch { sidebarFiles = []; }
  renderFileList();
}
// Opening a file switches the single active document — and its saves — onto
// it. The previous file is untouched: its disk copy keeps whatever was last
// saved, and its browser copy, chat waits under their own storage
// key until it is opened again.
// `before` runs once the open file is saved and before the next one opens:
// renaming the open file uses it to move the file in between.
async function switchDocument(name, { before } = {}) {
  if (docState.loadingDocument || docState.switchingDocument || docState.desktopSaving || (name === docState.documentName && !before)) { workView.focus(); return; }
  docState.switchingDocument = true;
  editorSetReadonly(workView, true);
  for (const job of jobs) job.abort();
  cancelSuggestion();
  try {
  // Finish both the in-flight save and any newer keystrokes before switching.
  try {
    if (docState.savePaused || docState.diskHold) throw new Error('Resolve the draft save error or disk conflict before switching files.');
    clearTimeout(docState.diskTimer);
    if (!docState.autosaveHold) await flushSave();
    if (!docState.savePaused && !docState.diskHold && !docState.autosaveHold) await flushSave();
    clearTimeout(docState.diskTimer);
    docState.emit('save');
    if (liveSync?.active) await liveSync.flush();
    if (docState.savePaused || docState.diskHold || (!docState.autosaveHold && workView.state.doc.toString() !== docState.diskText)) throw new Error('The draft has not been saved.');
    saveSnapshot('Before switching document');
    if (desktop) await localStorage.flush();
  } catch (error) {
    notify(`Unable to save ${docState.documentName}: ${error.message}. The current draft stays open.`, {
      sticky: true, key: 'disk', label: 'Retry saving',
      action: docState.diskHold ? null : () => { docState.savePaused = false; return switchDocument(name); },
    });
    return;
  }
  docState.autosaveHold = false;   // moving on ends the deleted-file episode
  let current;
  if (before) {
    try { await before(); }
    catch (error) { notify(error.message, { sticky: true, key: 'disk' }); return; }
  }
  try {
    current = await api('/draft/open', { method: 'POST', body: JSON.stringify({ name }) });
  } catch (error) { notify(`Unable to open ${name}: ${error.message}. The current draft stays open.`, { sticky: true, action: () => switchDocument(name), label: 'Try again' }); return; }
  liveSync?.close();
  docState.loadingDocument = true;
  for (const job of jobs) job.abort();
  cancelSuggestion();
  // Per-document UI bound to the old text goes; the old file's own state was
  // stored under its key above and is restored when it is opened again.
  clearNotice('undo');
  clearNotice('disk');
  docState.emit('reset', { forget: false });
  hideDriftBanner(); docState.diskHold = false;
  // Retarget storage and the disk baseline onto the new file first: every
  // restore below reads under the new key.
  const opened = restoreDocument(current);
  refreshFileList();
  if (!opened.joined) notify(`Opened ${docState.documentName}. Saves go to this file.`);
  workView.focus();
  } finally {
    docState.switchingDocument = false;
    editorSetReadonly(workView, false);
    saveToDisk();
  }
}
const toggleSidebar = () => { setSidebar(sidebar.classList.contains('is-closed')); workView.focus(); };
sidebarToggle.addEventListener('click', toggleSidebar);
sidebarToggleSide.addEventListener('click', toggleSidebar);
// The light-dismiss for the narrow-window overlay. The scrim is the only part
// of the sidebar a click can miss, so it is the only place that needs wiring.
document.getElementById('sidebar-scrim').addEventListener('click', () => setSidebar(false));
fileFilter.addEventListener('input', renderFileList);
setSidebar(false, false);

const fileInput = document.getElementById('file-input');
document.getElementById('file-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { importFile(fileInput.files[0]); fileInput.value = ''; });
editorWrap.addEventListener('dragover', event => event.preventDefault());
editorWrap.addEventListener('drop', event => { event.preventDefault(); importFile(event.dataTransfer?.files?.[0]); });
document.getElementById('file-history').addEventListener('click', createHistory({
  dialog, api, draftUrl, docStorage, localStorage, tabId,
  documentKey: () => docState.documentKey,
  currentText: () => workView.state.doc.toString(),
  replaceDraft,
}));

// ─── Quick switcher ─── (src/features/switcher.js)
async function createNamedFile(name) {
  const extension = name.match(/\.(md|markdown|txt)$/i)[0];
  try {
    await switchDocument(await createFile(name.slice(0, -extension.length), extension.toLowerCase(), ''));
    workView.focus();
  } catch (error) { notify(`Unable to create ${name}: ${error.message}`, { sticky: true }); }
}
const switcher = createSwitcher({
  files: () => sidebarFiles,
  refresh: () => refreshFileList(),
  open: name => { if (name !== docState.documentName) switchDocument(name); workView.focus(); },
  create: createNamedFile,
});
// Cmd/Ctrl+O, from anywhere: the browser's own "open file" would load a
// file in place of the app.
document.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'o') return;
  event.preventDefault();
  if (!switcher.open && !settingsDialog.open) switcher.show();
}, true);

// ─── Focus mode ─── (src/editor/focus.js)
// Remembered per browser like the theme. The shortcut hints go too: in focus
// mode nothing but the text is on screen.
const focusToggleEl = document.getElementById('focus-toggle');
function applyFocus(on, { persist = true } = {}) {
  setFocusMode(workView, on);
  document.body.classList.toggle('focus-mode', on);
  focusToggleEl.checked = on;
  if (!persist) return;
  localStorage.setItem('wa-focus', on ? 'on' : 'off');
  notify(on ? 'Focus mode on. Cmd/Ctrl+. turns it off.' : 'Focus mode off.');
}
focusToggleEl.addEventListener('change', () => {
  focusToggleEl.classList.add('is-init'); // arm the switch animation after mount, as for the theme
  applyFocus(focusToggleEl.checked);
});
applyFocus(localStorage.getItem('wa-focus') === 'on', { persist: false });

// ─── Initial focus ─────────────────────────────────────────────────────────────

workView.scrollDOM.addEventListener('scroll', () => { hideNotePlus(); reanchorBubble(); }, { passive: true });
workView.focus();

window.addEventListener('stilura-storage-error', event => {
  notify(event.detail, { sticky: true, key: 'backup', action: () => localStorage.flush().catch(error => notify(error.message)), label: 'Retry saving' });
});
if (desktop) {
  const events = new EventSource('/api/desktop/events');
  function resumeDesktop() {
    if (!docState.desktopSaving) return;
    docState.desktopSaving = false;
    document.body.inert = false;
    editorSetReadonly(workView, docState.loadingDocument || docState.switchingDocument);
  }
  events.onerror = resumeDesktop;
  events.onmessage = async event => {
    const message = JSON.parse(event.data);
    if (message.type === 'resume') { resumeDesktop(); return; }
    if (message.type !== 'flush') return;
    let error = '';
    try {
      if (docState.loadingDocument || docState.switchingDocument) throw new Error('Wait for the document to finish opening.');
      document.activeElement?.blur();
      docState.desktopSaving = true;
      document.body.inert = true;
      editorSetReadonly(workView, true);
      stopJobs();
      clearTimeout(docState.diskTimer);
      if (docState.savePaused || docState.diskHold) throw new Error('Resolve the draft save error or disk conflict before closing.');
      await flushSave();
      // A save already in flight may have contained the previous keystroke.
      if (!docState.savePaused && !docState.diskHold) await flushSave();
      if (docState.savePaused || docState.diskHold || workView.state.doc.toString() !== docState.diskText) throw new Error('The draft has not been saved.');
      await localStorage.flush();
    } catch (cause) { error = cause.message; resumeDesktop(); }
    try {
      await api('/api/desktop/flushed', { method: 'POST', body: JSON.stringify({ id: message.id, ok: !error, error }) });
    } catch (cause) { resumeDesktop(); notify(cause.message, { sticky: true }); }
  };
}
}
main().catch(error => {
  console.error(error);
  const notice = document.createElement('p');
  notice.textContent = `Stilura could not open: ${error.message} Reload to retry.`;
  notice.setAttribute('role', 'alert');
  document.body.prepend(notice);
});
