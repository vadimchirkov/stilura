#!/usr/bin/env node
/**
 * Render artifact/demo.html in a narrow portrait window for phone cutdowns.
 * Same timeline as docs/demo.mp4; never writes to docs/demo.*.
 *
 *   node docs/marketing/video/render-narrow.mjs 9x16   → /tmp/stilura-narrow-9x16.mp4
 *   node docs/marketing/video/render-narrow.mjs 4x5    → /tmp/stilura-narrow-4x5.mp4
 *
 * Then build-cutdowns.py adds captions and speeds up the loading skeletons.
 * Driver logic copied from scripts/render-demo.mjs; the only change is that it
 * resizes the stage and moves the camera after load (demo.html keeps its
 * format settings in mutable objects), so demo.html itself is untouched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FORMAT = process.argv[2] === '4x5' ? '4x5' : '9x16';
// winW 864 makes the editor column 52ch, exactly as the real editor in a narrow window.
// pad: extra space above the text (window px) for captions. keyBottom: key badge position.
const F = FORMAT === '9x16'
  ? { w: 1080, h: 1920, winW: 600, winH: 1200, close: 2.7, pad: 315, keyBottom: 560, col: '34ch' }
  : { w: 1080, h: 1350, winW: 864, winH: 1080, close: 1.7, pad: 220, keyBottom: 150 };
const FPS = 30, DURATION = 25.5; // the cutdowns end before the zoom-out at 25.5 s
const OUT = `/tmp/stilura-narrow-${FORMAT}.mp4`;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'stilura-narrow-'));
const frames = path.join(work, 'frames');
fs.mkdirSync(frames);
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(work, 'profile')}`,
  '--hide-scrollbars', '--force-color-profile=srgb', '--no-first-run', 'about:blank'], { stdio: 'ignore' });

try {
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

  await send('Emulation.setDeviceMetricsOverride', { width: F.w, height: F.h, deviceScaleFactor: 1, mobile: false });
  const url = pathToFileURL(path.join(ROOT, 'artifact', 'demo.html'));
  url.search = '?render&format=4x5';
  await send('Page.navigate', { url: url.href });
  for (let i = 0; !(await evaluate('typeof renderAt === "function"')); i++) {
    if (i > 100) throw new Error('demo.html did not expose renderAt');
    await new Promise(r => setTimeout(r, 100));
  }
  await evaluate(`(() => {
    Object.assign(FMT, { w: ${F.w}, h: ${F.h}, winW: ${F.winW}, winH: ${F.winH}, close: ${F.close} });
    stage.style.width = '${F.w}px'; stage.style.height = '${F.h}px';
    win.style.width = '${F.winW}px'; win.style.height = '${F.winH}px';
    Object.assign(CLOSE, { s: ${F.close}, x: ${F.w / 2 - F.winW / 2 * F.close}, y: ${-6 * F.close} });
    document.getElementById('doc').style.paddingTop = '${F.pad}px';
    keyEl.style.bottom = '${F.keyBottom}px';
    ${F.col ? `document.getElementById('doc').style.width = '${F.col}';` : ''}
    ${FORMAT === '9x16' ? "keyEl.style.visibility = 'hidden'; // captions name the keys" : ''}
    fit();
  })()`);

  const total = Math.round(FPS * DURATION);
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

execFileSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%04d.png'),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', OUT], { stdio: 'inherit' });
fs.rmSync(work, { recursive: true, force: true });
console.log(OUT);
