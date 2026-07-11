import { expect, test, type Page } from '@playwright/test';

type RouteDiagnostics = {
  phase: string;
  victory: boolean;
  restorationCount: number;
  enemies: { active: number };
  boss: { active: boolean; name: string };
  progression: { charms: string[] };
  route: {
    activeEncounterId: string | null;
    nextEncounterId: string | null;
    currentCheckpointId: string | null;
    completedEncounterIds: string[];
    gateStates: Record<string, 'open' | 'closed'>;
    campaignComplete: boolean;
  };
};

type CampaignHooks = {
  start(): void;
  damagePlayer(amount?: number): void;
  activateNextEncounter(): void;
  defeatActiveEncounter(): void;
  claimAvailableCheckpoint(): void;
};

async function snapshot(page: Page): Promise<RouteDiagnostics> {
  return page.evaluate(() => {
    const value = window.__THREE_GAME_DIAGNOSTICS__ as unknown as RouteDiagnostics | undefined;
    if (!value) throw new Error('Missing route diagnostics.');
    return value;
  });
}

async function useHook(page: Page, name: keyof CampaignHooks): Promise<void> {
  await page.evaluate((hookName) => {
    const hooks = window.__CELESTIAL_GAME_TEST__ as unknown as CampaignHooks | undefined;
    if (!hooks) throw new Error('Missing campaign test hooks.');
    (hooks[hookName] as () => void)();
  }, name);
}

test('the pilgrimage gates encounters, commits the midpoint boss, and reaches final victory', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'One deterministic campaign proof is sufficient.');
  await page.goto('/');
  await page.locator('#begin-pilgrimage').click();
  await expect(page.locator('#front-end-layer')).toBeHidden();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);

  expect((await snapshot(page)).route.gateStates).toMatchObject({
    'threshold-portcullis': 'open',
    'moon-seal': 'closed',
    'orrery-seal': 'closed',
    'aurora-seal': 'closed',
    'eclipse-seal': 'closed',
  });
  expect((await snapshot(page)).enemies.active).toBe(0);

  const initialWave = await page.evaluate(() => {
    const hooks = window.__CELESTIAL_GAME_TEST__ as unknown as CampaignHooks | undefined;
    if (!hooks) throw new Error('Missing campaign test hooks.');
    hooks.activateNextEncounter();
    const value = window.__THREE_GAME_DIAGNOSTICS__ as unknown as RouteDiagnostics | undefined;
    if (!value) throw new Error('Missing route diagnostics after encounter activation.');
    return value;
  });
  expect(initialWave.route.activeEncounterId).toBe('ashen-processional-ward');
  expect(initialWave.route.gateStates['threshold-portcullis']).toBe('closed');
  expect(initialWave.enemies.active).toBe(1);
  await expect.poll(async () => (await snapshot(page)).enemies.active).toBe(3);
  await useHook(page, 'defeatActiveEncounter');
  await expect.poll(async () => (await snapshot(page)).route.nextEncounterId).toBe('fallen-orbit-crossing');
  expect((await snapshot(page)).route.gateStates['moon-seal']).toBe('open');
  await useHook(page, 'claimAvailableCheckpoint');
  await expect.poll(async () => (await snapshot(page)).route.currentCheckpointId).toBe('moon-relic');

  await useHook(page, 'activateNextEncounter');
  await expect.poll(async () => (await snapshot(page)).route.activeEncounterId).toBe('fallen-orbit-crossing');
  await useHook(page, 'defeatActiveEncounter');
  await expect.poll(async () => (await snapshot(page)).route.nextEncounterId).toBe('orrery-castellan');

  await useHook(page, 'activateNextEncounter');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('boss');
  expect((await snapshot(page)).boss.name).toBe('The Orrery Castellan');
  await useHook(page, 'defeatActiveEncounter');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('exploration');
  expect((await snapshot(page)).victory).toBe(false);
  expect((await snapshot(page)).progression.charms).toContain("Castellan's Broken Orrery");

  // A defeated boss is a permanent progress boundary even before the next
  // physical relic is claimed; death must not resurrect it beside its reward.
  await page.evaluate(() => window.__CELESTIAL_GAME_TEST__?.damagePlayer(9999));
  await expect.poll(async () => (await snapshot(page)).phase).toBe('dead');
  await useHook(page, 'start');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('exploration');
  expect((await snapshot(page)).route.completedEncounterIds).toContain('orrery-castellan');
  expect((await snapshot(page)).route.nextEncounterId).toBe('choristers-of-the-sundered-span');

  await useHook(page, 'claimAvailableCheckpoint');
  await expect.poll(async () => (await snapshot(page)).route.currentCheckpointId).toBe('aurora-relic');
  await useHook(page, 'activateNextEncounter');
  await expect.poll(async () => (await snapshot(page)).route.activeEncounterId).toBe('choristers-of-the-sundered-span');
  await useHook(page, 'defeatActiveEncounter');
  await useHook(page, 'claimAvailableCheckpoint');
  await expect.poll(async () => (await snapshot(page)).route.currentCheckpointId).toBe('constellation-relic');

  await useHook(page, 'activateNextEncounter');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('boss');
  expect((await snapshot(page)).boss.name).toBe('The Eclipse Archon');
  await useHook(page, 'defeatActiveEncounter');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('victory');
  expect((await snapshot(page)).route.campaignComplete).toBe(true);
  expect((await snapshot(page)).route.completedEncounterIds).toHaveLength(5);
});
