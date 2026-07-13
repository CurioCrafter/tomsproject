import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

type ExpansionDiagnostics = {
  phase: string;
  objective: string;
  player: { focus: number; position: { x: number; y: number; z: number } };
  comprehension: { lunar: { uses: number }; aurora: { uses: number } };
  progression: {
    pendingOffer: { id: string; choices: readonly { id: string; kind: string }[] } | null;
    abilities: readonly { id: string; starterId?: string; name: string }[];
    equippedAbilityIds: readonly (string | null)[];
    branchSelections: readonly { choiceId: string; optionId: string }[];
  };
  route: {
    gateStates: Record<string, 'open' | 'closed'>;
    availableChoice: { id: string } | null;
    branch: { activeEncounterId: string | null; remainingEnemyCount: number; completedEncounterIds: readonly string[] };
  };
};

async function diagnostics(page: Page): Promise<ExpansionDiagnostics> {
  return page.evaluate(() => {
    const snapshot = window.__THREE_GAME_DIAGNOSTICS__ as unknown as ExpansionDiagnostics | undefined;
    if (!snapshot) throw new Error('Missing expansion diagnostics.');
    return snapshot;
  });
}

async function begin(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#begin-pilgrimage').click();
  await expect(page.locator('#character-creator-panel')).toBeVisible();
  await page.locator('#creator-begin').click();
  await expect(page.locator('#front-end-layer')).toBeHidden();
  await expect.poll(async () => (await diagnostics(page)).phase).toBe('exploration');
}

test('a real fork seals its exit, grants procedural loot, and unlocks the third cast slot', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Keyboard casting and one full branch proof are covered on desktop.');
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await begin(page);

  await page.evaluate(() => window.__CELESTIAL_GAME_TEST__?.showChoice('drowned-vow'));
  await expect.poll(async () => (await diagnostics(page)).route.availableChoice?.id).toBe('drowned-vow');
  await expect(page.locator('#route-choice-prompt')).toBeVisible();
  await page.locator('[data-route-option-id="still-the-bells"]').click();
  await expect.poll(async () => (await diagnostics(page)).progression.branchSelections[0]?.optionId).toBe('still-the-bells');
  let state = await diagnostics(page);
  expect(state.route.gateStates['drowned-belfry-entry']).toBe('open');
  expect(state.route.gateStates['graveglass-entry']).toBe('closed');
  expect(state.route.gateStates['drowned-belfry-exit']).toBe('closed');
  expect(state.route.gateStates['drowned-direct-seal']).toBe('closed');
  expect(state.objective).toContain('Follow the opened side path');

  await page.evaluate(() => window.__CELESTIAL_GAME_TEST__?.activateBranchEncounter('drowned-belfry-cantors'));
  await expect.poll(async () => (await diagnostics(page)).route.branch.activeEncounterId).toBe('drowned-belfry-cantors');
  state = await diagnostics(page);
  expect(state.route.branch.remainingEnemyCount).toBe(3);
  expect(state.objective).toBe('Ward sealed — 3 foes remain');
  await page.evaluate(() => window.__CELESTIAL_GAME_TEST__?.defeatActiveBranchEncounter());
  await expect.poll(async () => (await diagnostics(page)).route.branch.completedEncounterIds).toContain('drowned-belfry-cantors');
  await expect.poll(async () => Boolean((await diagnostics(page)).progression.pendingOffer)).toBe(true);
  state = await diagnostics(page);
  expect(state.route.branch.remainingEnemyCount).toBe(0);
  expect(state.route.gateStates['drowned-belfry-exit']).toBe('open');
  expect(state.route.gateStates['drowned-direct-seal']).toBe('open');

  await expect(page.locator('#star-atlas-layer')).toBeVisible();
  await expect(page.locator('#atlas-reward-choices [data-progression-action="claim-reward"]')).toHaveCount(3);
  await page.locator('#atlas-reward-choices [data-progression-action="claim-reward"]').nth(2).click();
  await expect.poll(async () => (await diagnostics(page)).progression.equippedAbilityIds[2]).not.toBeNull();
  state = await diagnostics(page);
  const thirdAbilityId = state.progression.equippedAbilityIds[2];
  expect(state.progression.abilities.some((ability) => ability.id === thirdAbilityId && !ability.starterId)).toBe(true);

  await page.locator('#atlas-close').click();
  await expect(page.locator('#star-atlas-layer')).toBeHidden();
  await expect.poll(async () => (await diagnostics(page)).phase).toBe('exploration');
  const focusBefore = (await diagnostics(page)).player.focus;
  const usesBefore = (await diagnostics(page)).comprehension.lunar.uses + (await diagnostics(page)).comprehension.aurora.uses;
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await diagnostics(page)).player.focus).toBeLessThan(focusBefore);
  await expect.poll(async () => {
    const current = await diagnostics(page);
    return current.comprehension.lunar.uses + current.comprehension.aurora.uses;
  }).toBe(usesBefore + 1);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
