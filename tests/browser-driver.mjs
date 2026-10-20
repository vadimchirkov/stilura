import { createRequire } from 'node:module';

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
