#!/usr/bin/env node
/**
 * Render artifact/demo.html frame by frame into the README media.
 *
 *   node scripts/render-demo.mjs              → docs/demo.mp4 + docs/demo.gif (16:9)
 *   node scripts/render-demo.mjs --format 4x5 → docs/demo-4x5.mp4 (1080×1350 feed cut)
 *
 * The page computes every frame from t, so headless Chrome renders it exactly,
 * with no dropped frames. Needs Google Chrome (or CHROME=path) and ffmpeg.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORTRAIT = process.argv.includes('4x5');
const [W, H] = PORTRAIT ? [1080, 1350] : [1920, 1080];
const FPS = 30, DURATION = 28;
const CHROME = process.env.CHROME || {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}[process.platform] || 'google-chrome';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-demo-'));
const frames = path.join(work, 'frames');
fs.mkdirSync(frames);

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(work, 'profile')}`,
  '--hide-scrollbars', '--force-color-profile=srgb', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

try {
  // Chrome writes its chosen port into the profile once it is listening.
  const portFile = path.join(work, 'profile', 'DevToolsActivePort');
  for (let i = 0; !fs.existsSync(portFile); i++) {
    if (i > 100) throw new Error(`Chrome did not start: ${CHROME}`);
    await new Promise(r => setTimeout(r, 100));
  }
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };

  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const url = pathToFileURL(path.join(ROOT, 'artifact', 'demo.html'));
  url.search = PORTRAIT ? '?render&format=4x5' : '?render';
  await send('Page.navigate', { url: url.href });
  for (let i = 0; !(await evaluate('typeof renderAt === "function"')); i++) {
    if (i > 100) throw new Error('demo.html did not expose renderAt');
    await new Promise(r => setTimeout(r, 100));
  }

  const total = FPS * DURATION;
  for (let i = 0; i < total; i++) {
    await evaluate(`renderAt(${i / FPS})`);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(frames, `f${String(i).padStart(4, '0')}.png`), Buffer.from(data, 'base64'));
    if (i % FPS === 0) process.stdout.write(`\rframes ${i}/${total}`);
  }
  process.stdout.write(`\rframes ${total}/${total}\n`);
  ws.close();
} finally {
  chrome.kill();
}

const input = ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%04d.png')];
const out = name => path.join(ROOT, 'docs', name);

const mp4 = out(PORTRAIT ? 'demo-4x5.mp4' : 'demo.mp4');
execFileSync('ffmpeg', [...input, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'inherit' });

if (!PORTRAIT) {
  // The README column is ~830px; 1200px keeps the prose sharp on retina.
  // The flat paper palette fits in few colours; diff_mode only redraws what moved.
  execFileSync('ffmpeg', [...input, '-vf',
    'fps=15,scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    out('demo.gif')], { stdio: 'inherit' });
}

fs.rmSync(work, { recursive: true, force: true });
for (const f of PORTRAIT ? [mp4] : [mp4, out('demo.gif')]) {
  console.log(`${path.relative(ROOT, f)}  ${(fs.statSync(f).size / 1e6).toFixed(1)} MB`);
}
