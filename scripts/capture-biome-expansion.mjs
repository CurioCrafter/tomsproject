#!/usr/bin/env node
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5197';
const outDir = process.argv[3] ?? 'artifacts/biome-expansion';
const captureFilter = process.argv[4];
const captures = [
  ['drowned-cloister', 'drowned-belfry-cantors', 'drowned-vow', 'still-the-bells'],
  ['verdant-cathedral', 'bloodroot-reliquary', 'verdant-covenant', 'harvest-the-root'],
  ['ember-basilica', 'ember-choir-penitents', 'ember-rite', 'still-the-solar-bells'],
  ['amethyst-archives', 'amethyst-null-scribes', 'amethyst-confession', 'seal-the-null'],
].filter(([biome]) => !captureFilter || biome === captureFilter);

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const report = [];

for (const [biome, encounterId, choiceId, optionId] of captures) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#begin-pilgrimage').click();
  await page.locator('#creator-begin').click();
  await page.locator('#front-end-layer').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'exploration');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 8);
  await page.evaluate((id) => window.__CELESTIAL_GAME_TEST__?.showChoice(id), choiceId);
  const choiceState = await page.evaluate(() => ({
    availableChoiceId: window.__THREE_GAME_DIAGNOSTICS__?.route?.availableChoice?.id ?? null,
    currentSectionId: window.__THREE_GAME_DIAGNOSTICS__?.route?.currentSectionId ?? null,
    hooksInstalled: Boolean(window.__CELESTIAL_GAME_TEST__),
  }));
  if (choiceState.availableChoiceId !== choiceId) {
    throw new Error(`Could not show ${choiceId}: ${JSON.stringify(choiceState)}`);
  }
  await page.locator(`[data-route-option-id="${optionId}"]`).click();
  await page.waitForFunction(
    ([nextChoiceId, nextOptionId]) => window.__THREE_GAME_DIAGNOSTICS__?.progression?.branchSelections
      ?.some((selection) => selection.choiceId === nextChoiceId && selection.optionId === nextOptionId),
    [choiceId, optionId],
  );
  await page.evaluate((id) => window.__CELESTIAL_GAME_TEST__?.activateBranchEncounter(id), encounterId);
  await page.waitForFunction(
    (id) => window.__THREE_GAME_DIAGNOSTICS__?.route?.branch?.activeEncounterId === id,
    encounterId,
  );
  await page.waitForTimeout(900);
  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__ ?? null);
  const screenshotPath = path.join(outDir, `${biome}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  report.push({
    biome,
    encounterId,
    screenshotPath,
    phase: diagnostics?.phase,
    elapsed: diagnostics?.elapsed,
    objective: diagnostics?.objective,
    playerY: diagnostics?.player?.position?.y,
    currentSectionId: diagnostics?.route?.currentSectionId,
    activeBranchEncounterId: diagnostics?.route?.branch?.activeEncounterId,
    activeEnemyCount: diagnostics?.enemies?.active,
    renderer: diagnostics?.renderer,
    canvas: diagnostics?.canvas,
    consoleErrors,
    pageErrors,
  });
  await page.close();
}

await browser.close();
await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (report.some((entry) => entry.consoleErrors.length > 0 || entry.pageErrors.length > 0 || !Number.isFinite(entry.playerY))) {
  process.exit(1);
}
