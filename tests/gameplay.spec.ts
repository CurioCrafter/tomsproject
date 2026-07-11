import { expect, test, type Page } from '@playwright/test';

type Diagnostics = {
  frame: number;
  phase: string;
  paused: boolean;
  dead: boolean;
  victory: boolean;
  restorationCount: number;
  player: {
    position: { x: number; y: number; z: number };
    health: number;
    maxHealth: number;
    focus: number;
    stamina: number;
  };
  boss: { spawned: boolean; active: boolean; health: number; phase: number };
  comprehension: { lunar: { uses: number; tier: string }; aurora: { uses: number; tier: string } };
};

type TestHooks = {
  damagePlayer(amount?: number): void;
  restoreNextBody(): void;
  spawnBoss(): void;
  defeatBoss(): void;
  restart(): void;
};

async function enterGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.locator('#enter-game').evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator('#title-veil')).toBeHidden();
  await page.waitForFunction(() => ((window as unknown as { __THREE_GAME_DIAGNOSTICS__?: Diagnostics }).__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
}

async function diagnostics(page: Page): Promise<Diagnostics> {
  return page.evaluate(() => {
    const snapshot = (window as unknown as { __THREE_GAME_DIAGNOSTICS__?: Diagnostics }).__THREE_GAME_DIAGNOSTICS__;
    if (!snapshot) throw new Error('Missing game diagnostics.');
    return snapshot;
  });
}

async function useHooks(page: Page, action: (hooks: TestHooks) => void): Promise<void> {
  await page.evaluate((source) => {
    const hooks = (window as unknown as { __CELESTIAL_GAME_TEST__?: TestHooks }).__CELESTIAL_GAME_TEST__;
    if (!hooks) throw new Error('Missing development test hooks.');
    if (source === 'restore') hooks.restoreNextBody();
    else if (source === 'boss') hooks.spawnBoss();
    else if (source === 'death') hooks.damagePlayer(9999);
    else if (source === 'victory') hooks.defeatBoss();
    else if (source === 'restart') hooks.restart();
  }, action.name);
}

test('desktop combat resources and pause state follow real input', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop keyboard/mouse contract.');
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()));
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await enterGame(page);
  const before = await diagnostics(page);

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyW');
  await expect.poll(async () => (await diagnostics(page)).player.position.z).toBeLessThan(before.player.position.z - 0.4);

  await page.keyboard.press('KeyQ');
  await expect.poll(async () => (await diagnostics(page)).comprehension.lunar.uses).toBe(1);
  expect((await diagnostics(page)).player.focus).toBeLessThan(before.player.focus);

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await diagnostics(page)).phase).toBe('paused');
  await expect(page.locator('[data-menu-panel="pause"]')).toBeVisible();
  await page.locator('[data-menu-panel="pause"] [data-ui-action="settings"]').click();
  await expect(page.locator('[data-menu-panel="settings"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-menu-panel="pause"]')).toBeVisible();
  expect((await diagnostics(page)).phase).toBe('paused');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await diagnostics(page)).phase).toBe('exploration');

  await page.keyboard.press('Escape');
  await page.locator('[data-menu-panel="pause"] [data-game-intent="restart"]').click();
  await expect.poll(async () => (await diagnostics(page)).phase).toBe('exploration');
  expect((await diagnostics(page)).restorationCount).toBe(0);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('relics, boss, death checkpoint, victory, and new run form a complete loop', async ({ page }) => {
  await enterGame(page);

  await useHooks(page, function restore() {});
  await useHooks(page, function restore() {});
  await useHooks(page, function restore() {});
  await expect.poll(async () => (await diagnostics(page)).restorationCount).toBe(3);
  await expect.poll(async () => (await diagnostics(page)).phase).toBe('boss');
  await expect(page.locator('#boss-hud')).toBeVisible();

  await useHooks(page, function death() {});
  await expect.poll(async () => (await diagnostics(page)).phase).toBe('dead');
  await expect(page.locator('[data-menu-panel="death"]')).toBeVisible();
  await page.locator('[data-menu-panel="death"] [data-game-intent="restart"]').click();
  await expect.poll(async () => (await diagnostics(page)).phase).toBe('boss');
  expect((await diagnostics(page)).player.health).toBe((await diagnostics(page)).player.maxHealth);

  await useHooks(page, function victory() {});
  await expect.poll(async () => (await diagnostics(page)).phase).toBe('victory');
  await expect(page.locator('[data-menu-panel="victory"]')).toBeVisible();
  await page.locator('[data-menu-panel="victory"] [data-game-intent="restart"]').click();
  await expect.poll(async () => (await diagnostics(page)).phase).toBe('exploration');
  expect((await diagnostics(page)).restorationCount).toBe(0);
});

test('mobile action controls emit intents and retain practical target sizes', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only control contract.');
  await enterGame(page);

  const before = await diagnostics(page);
  await page.locator('#lunar-button').tap();
  await expect.poll(async () => (await diagnostics(page)).comprehension.lunar.uses).toBe(1);
  expect((await diagnostics(page)).player.focus).toBeLessThan(before.player.focus);

  for (const selector of ['#touch-stick', '#interact-button', '#melee-button', '#lunar-button', '#aurora-button', '#dash-button']) {
    const box = await page.locator(selector).boundingBox();
    expect(box, `${selector} should have a visible hit target`).not.toBeNull();
    expect(box?.width ?? 0, `${selector} width`).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0, `${selector} height`).toBeGreaterThanOrEqual(44);
  }
});
