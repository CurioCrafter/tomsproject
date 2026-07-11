#!/usr/bin/env node
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:4197';
const durationMs = Number(process.argv[3] ?? 120_000);
const outDir = 'artifacts/soak-playtest';
const directions = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
const actions = ['KeyJ', 'KeyQ', 'KeyJ', 'Space', 'KeyE', 'KeyJ'];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
const pageErrors = [];
const samples = [];

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.goto(url, { waitUntil: 'domcontentloaded' });
const begin = page.locator('#begin-pilgrimage');
if (await begin.isVisible().catch(() => false)) {
  await begin.click();
  await page.locator('#front-end-layer').waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => undefined);
} else {
  await page.locator('#enter-game').evaluate((element) => element.click());
  await page.locator('#title-veil').waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => undefined);
}
await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);

const startedAt = Date.now();
let tick = 0;
while (Date.now() - startedAt < durationMs) {
  const snapshot = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__ ?? null);
  if (!snapshot) throw new Error('Diagnostics disappeared during soak.');

  if (snapshot.phase === 'dead') {
    await page.keyboard.press('Enter');
  } else if (snapshot.phase === 'victory') {
    samples.push({ second: Math.round((Date.now() - startedAt) / 1000), ...snapshot });
    break;
  } else {
    const direction = directions[Math.floor(tick / 8) % directions.length];
    await page.keyboard.down(direction);
    await page.waitForTimeout(420);
    await page.keyboard.up(direction);
    await page.keyboard.press(actions[tick % actions.length]);
  }

  if (tick === 30 || tick === 78) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(180);
    await page.keyboard.press('Escape');
  }

  if (tick % 10 === 0) {
    samples.push({ second: Math.round((Date.now() - startedAt) / 1000), ...snapshot });
  }
  tick += 1;
  await page.waitForTimeout(360);
}

const final = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__ ?? null);
const screenshotPath = path.join(outDir, 'final.png');
await page.screenshot({ path: screenshotPath, fullPage: true });
const report = {
  url,
  requestedDurationMs: durationMs,
  elapsedMs: Date.now() - startedAt,
  ticks: tick,
  samples,
  final,
  consoleErrors,
  pageErrors,
  screenshotPath,
};
await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();

console.log(JSON.stringify({
  elapsedMs: report.elapsedMs,
  ticks: tick,
  sampleCount: samples.length,
  finalPhase: final?.phase,
  finalFrame: final?.frame,
  restored: final?.restorationCount,
  enemiesRemaining: final?.enemies?.active,
  consoleErrors,
  pageErrors,
  screenshotPath,
}, null, 2));

if (!final || consoleErrors.length > 0 || pageErrors.length > 0 || report.elapsedMs < Math.min(durationMs, 118_000)) {
  process.exit(1);
}
