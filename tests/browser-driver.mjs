import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// Puppeteer is not a dependency of this repo. Point PUPPETEER_MODULE at an
// installed copy, the way PLAYWRIGHT_MODULE works for the extension checks.
export function loadPuppeteer() {
  try {
    return require(process.env.PUPPETEER_MODULE || 'puppeteer');
  } catch (error) {
    throw new Error('Puppeteer is not available to Node. Install it, or set PUPPETEER_MODULE to an installed copy, as PLAYWRIGHT_MODULE works for the extension checks. ' + error.message);
  }
}

export const launchBrowser = puppeteer => puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});

// Runs index.js on a free port in `directory` and resolves with the child
// process and the URL it printed.
export async function startStilura({ directory, draft, env = process.env }) {
  const server = spawn(process.execPath, [fileURLToPath(new URL('../index.js', import.meta.url))], {
    cwd: directory,
    env: { ...env, PORT: '0', STILURA_NO_OPEN: '1', DRAFT_FILE: draft },
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
  return { server, url };
}
