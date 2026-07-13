#!/usr/bin/env node
import { chromium, devices } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

function parseArgs(argv) {
  const args = {
    url: 'http://127.0.0.1:5197',
    out: 'artifacts/canvas-inspection',
    mobile: false,
    wait: 750,
    state: 'active',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--url') args.url = argv[++i];
    else if (value === '--out') args.out = argv[++i];
    else if (value === '--mobile') args.mobile = true;
    else if (value === '--wait') args.wait = Number(argv[++i]);
    else if (value === '--state') args.state = argv[++i];
    else if (value === '-h' || value === '--help') {
      console.log('Usage: inspect-threejs-canvas.mjs [--url URL] [--out DIR] [--mobile] [--wait MS] [--state active|boundary|bridge|drowned-choice|drowned-selected|midboss|finalboss|death|victory]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return args;
}

async function sampleCanvas(page) {
  const locator = page.locator('canvas').first();
  const rect = await locator.boundingBox();
  if (!rect || rect.width < 32 || rect.height < 32) {
    return { ok: false, reason: 'canvas-too-small', rect };
  }

  const buffer = await locator.screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  let alphaPixels = 0;
  const colors = new Set();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));

  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const a = png.data[offset + 3];
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    if (a > 0) alphaPixels += 1;
    colors.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 6}`);
  }

  const variance = max - min;
  const diagnostics = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return {
      drawingBuffer: canvas
        ? { width: canvas.width, height: canvas.height }
        : null,
      game: window.__THREE_GAME_DIAGNOSTICS__ ?? null,
    };
  });

  const ok = alphaPixels > 256 && (variance > 8 || colors.size > 3);
  return {
    ok,
    reason: ok ? 'nonblank' : 'low-variance',
    rect,
    drawingBuffer: diagnostics.drawingBuffer,
    alphaPixels,
    variance,
    colorBuckets: colors.size,
    diagnostics: diagnostics.game,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext(args.mobile
    ? { ...devices['iPhone 13'], userAgent: undefined }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(args.url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { state: 'visible', timeout: 10_000 });
  const begin = page.locator('#begin-pilgrimage');
  if (await begin.isVisible().catch(() => false)) {
    await begin.click();
  } else {
    // Keep the compatibility hook for inspecting older deployed builds.
    const enter = page.locator('#enter-game');
    await enter.evaluate((element) => element.click()).catch(() => undefined);
  }
  const confirmPilgrim = page.locator('#creator-begin');
  if (await confirmPilgrim.isVisible().catch(() => false)) await confirmPilgrim.click();
  await page.locator('#front-end-layer').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
  await page.locator('#title-veil').waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => undefined);
  if (args.state === 'boundary') {
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(1_200);
    await page.keyboard.up('KeyS');
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(3_300);
    await page.keyboard.up('KeyA');
  } else if (args.state === 'bridge') {
    await page.evaluate(() => window.__CELESTIAL_GAME_TEST__?.showSection('fallen-orbit-bridge'));
  } else if (args.state === 'drowned-choice' || args.state === 'drowned-selected') {
    await page.evaluate(() => {
      window.__CELESTIAL_GAME_TEST__?.showEncounter('ashen-processional-ward');
      window.__CELESTIAL_GAME_TEST__?.defeatActiveEncounter();
      window.__CELESTIAL_GAME_TEST__?.claimReward(0);
    });
    const atlasClose = page.locator('#atlas-close');
    if (await atlasClose.isVisible().catch(() => false)) await atlasClose.click();
    await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'exploration');
    await page.evaluate((state) => {
      window.__CELESTIAL_GAME_TEST__?.showChoice('drowned-vow');
      if (state === 'drowned-selected') {
        window.__CELESTIAL_GAME_TEST__?.chooseBranch('drowned-vow', 'still-the-bells');
      }
    }, args.state);
  } else if (args.state === 'midboss') {
    await page.evaluate(() => window.__CELESTIAL_GAME_TEST__?.showEncounter('orrery-castellan'));
  } else if (args.state === 'boss' || args.state === 'finalboss' || args.state === 'victory') {
    await page.evaluate(() => window.__CELESTIAL_GAME_TEST__?.showEncounter('eclipse-archon'));
    if (args.state === 'victory') await page.evaluate(() => window.__CELESTIAL_GAME_TEST__?.defeatActiveEncounter());
  } else if (args.state === 'death') {
    await page.evaluate(() => window.__CELESTIAL_GAME_TEST__?.damagePlayer(9999));
  } else {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(280);
    await page.keyboard.up('KeyW');
    await page.keyboard.press('KeyQ');
  }
  await page.waitForTimeout(args.wait);

  const result = await sampleCanvas(page);
  const screenshotPath = path.join(args.out, `${args.mobile ? 'mobile' : 'desktop'}-${args.state}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const report = {
    url: args.url,
    mode: args.mobile ? 'mobile' : 'desktop',
    state: args.state,
    screenshotPath,
    result,
    consoleErrors,
    pageErrors,
  };

  await writeFile(path.join(args.out, `${args.mobile ? 'mobile' : 'desktop'}-${args.state}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();

  console.log(JSON.stringify(report, null, 2));

  if (!result.ok || consoleErrors.length > 0 || pageErrors.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
