import { expect, test, type Page } from '@playwright/test';

test.setTimeout(90_000);

type RuntimeDiagnostics = {
  phase?: string;
  paused?: boolean;
  progression?: Record<string, unknown>;
  route?: Record<string, unknown>;
};

type AtlasTestWindow = Window & {
  __THREE_GAME_DIAGNOSTICS__?: RuntimeDiagnostics;
  __LAST_FIRMAMENT_ATLAS__?: { isOpen: boolean };
};

async function beginGame(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as AtlasTestWindow).__LAST_FIRMAMENT_ATLAS__));
  await page.locator('#begin-pilgrimage').click();
  await expect(page.locator('#character-creator-panel')).toBeVisible();
  await page.locator('#creator-begin').click();
  await expect(page.locator('#front-end-layer')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as AtlasTestWindow).__THREE_GAME_DIAGNOSTICS__?.phase)).toBe('exploration');
}

test('Star Atlas opens from I, renders the live build, traps focus, and resumes cleanly', async ({ page }) => {
  await beginGame(page);
  await page.keyboard.press('i');

  await expect(page.locator('#star-atlas-layer')).toBeVisible();
  await expect(page.locator('#atlas-tab-gear')).toBeFocused();
  await expect.poll(() => page.evaluate(() => (window as AtlasTestWindow).__THREE_GAME_DIAGNOSTICS__?.paused)).toBe(true);
  await expect(page.locator('#atlas-equipment .atlas-equipped-slot')).toHaveCount(4);
  await expect(page.locator('#atlas-inventory .atlas-card')).toHaveCount(4);
  const panelBox = await page.locator('#star-atlas-panel').boundingBox();
  const statusBox = await page.locator('#atlas-status').boundingBox();
  expect((statusBox?.y ?? 0) + (statusBox?.height ?? 0)).toBeLessThanOrEqual((panelBox?.y ?? 0) + (panelBox?.height ?? 0) + 0.5);

  await page.locator('#atlas-tab-sorceries').click();
  await expect(page.locator('#atlas-loadout .atlas-loadout-slot')).toHaveCount(3);
  await expect(page.locator('#atlas-abilities .atlas-card')).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#atlas-tab-constellation')).toBeFocused();
  await expect(page.locator('#atlas-panel-constellation')).toBeVisible();

  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await expect(page.locator('#atlas-close')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.locator('#star-atlas-layer')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as AtlasTestWindow).__THREE_GAME_DIAGNOSTICS__?.paused)).toBe(false);
  await expect(page.locator('#atlas-button')).toBeFocused();
});

test('route and progression controls dispatch the published intent contracts', async ({ page }) => {
  await beginGame(page);

  const routeResult = await page.evaluate(() => {
    const runtime = window as AtlasTestWindow;
    const diagnostics: RuntimeDiagnostics = runtime.__THREE_GAME_DIAGNOSTICS__ ?? {};
    let captured: unknown = null;
    window.addEventListener(
      'celestial-route-choice-intent',
      (event) => {
        captured = (event as CustomEvent<unknown>).detail;
      },
      { once: true },
    );
    const availableChoice = {
      id: 'ui-contract-choice',
      name: 'The Glass Divide',
      sectionId: 'test-section',
      position: [0, 0],
      activationRadius: 4,
      prompt: 'Choose which memory the road will keep.',
      directGateId: 'test-gate',
      options: [
        {
          id: 'mercy-path',
          label: 'Tend the pale flame',
          description: 'Climb toward the quiet bells.',
          sectionIds: ['test-a'],
          entryGateId: 'test-a-gate',
          encounterId: 'test-a-encounter',
          consequence: {
            affinity: 'mercy',
            affinityDelta: 0.1,
            lootBias: 'robe',
            enemyPowerMultiplier: 0.96,
            rewardLabel: 'Merciful vestments',
          },
        },
        {
          id: 'wrath-path',
          label: 'Break the dark glass',
          description: 'Descend through the wounded archive.',
          sectionIds: ['test-b'],
          entryGateId: 'test-b-gate',
          encounterId: 'test-b-encounter',
          consequence: {
            affinity: 'wrathful',
            affinityDelta: 0.1,
            lootBias: 'weapon',
            enemyPowerMultiplier: 1.08,
            rewardLabel: 'Wrathful armaments',
          },
        },
      ],
    };
    window.dispatchEvent(
      new CustomEvent('celestial-game-state', {
        detail: { ...diagnostics, phase: 'exploration', paused: false, route: { availableChoice } },
      }),
    );
    const prompt = document.querySelector<HTMLElement>('#route-choice-prompt');
    const first = prompt?.querySelector<HTMLButtonElement>('[data-route-option-id="mercy-path"]');
    first?.click();
    window.dispatchEvent(
      new CustomEvent('celestial-game-state', {
        detail: { ...diagnostics, phase: 'exploration', paused: false, route: { availableChoice: null } },
      }),
    );
    window.dispatchEvent(
      new CustomEvent('celestial-game-state', {
        detail: { ...diagnostics, phase: 'exploration', paused: false, route: { availableChoice } },
      }),
    );
    const restored = prompt?.querySelector<HTMLButtonElement>('[data-route-option-id="mercy-path"]');
    return { hidden: prompt?.hidden, title: prompt?.querySelector('h2')?.textContent, restoredEnabled: !restored?.disabled, captured };
  });

  expect(routeResult).toEqual({
    hidden: false,
    title: 'The Glass Divide',
    restoredEnabled: true,
    captured: { choiceId: 'ui-contract-choice', optionId: 'mercy-path' },
  });

  const rewardResult = await page.evaluate(() => {
    const runtime = window as AtlasTestWindow;
    const diagnostics: RuntimeDiagnostics = runtime.__THREE_GAME_DIAGNOSTICS__ ?? {};
    const progression = diagnostics.progression ?? {};
    const starter = ((progression.inventory as readonly Record<string, unknown>[] | undefined) ?? [])[0];
    let captured: unknown = null;
    window.addEventListener(
      'celestial-progression-intent',
      (event) => {
        captured = (event as CustomEvent<unknown>).detail;
      },
      { once: true },
    );
    const pendingOffer = {
      id: 'offer-ui-contract',
      sourceId: 'ui-contract',
      title: 'A Choice Beneath Glass',
      biome: 'amethyst-archives',
      level: 2,
      choices: [
        { id: 'reward-ui-contract', kind: 'item', item: { ...starter, id: 'item-ui-contract', name: 'Contract Glass Charm' } },
        { id: 'reward-ui-contract-2', kind: 'item', item: { ...starter, id: 'item-ui-contract-2', name: 'Archive Moon Robe' } },
        { id: 'reward-ui-contract-3', kind: 'item', item: { ...starter, id: 'item-ui-contract-3', name: 'Prismatic Pilgrim Blade' } },
      ],
    };
    window.dispatchEvent(
      new CustomEvent('celestial-game-state', {
        detail: { ...diagnostics, phase: 'exploration', paused: false, progression: { ...progression, pendingOffer }, route: { availableChoice: null } },
      }),
    );
    const reward = document.querySelector<HTMLElement>('#atlas-reward');
    const claim = reward?.querySelector<HTMLButtonElement>('[data-progression-action="claim-reward"]');
    claim?.click();
    return {
      hidden: reward?.hidden,
      title: reward?.querySelector('h3')?.textContent,
      choiceCount: reward?.querySelectorAll('[data-progression-action="claim-reward"]').length,
      captured,
    };
  });

  expect(rewardResult).toEqual({
    hidden: false,
    title: 'A Choice Beneath Glass',
    choiceCount: 3,
    captured: { action: 'claim-reward', id: 'reward-ui-contract', offerId: 'offer-ui-contract' },
  });
});

test('keyboard activation of the Atlas system button pauses without restarting the run', async ({ page }) => {
  await beginGame(page);
  const seedBefore = await page.evaluate(() => {
    const diagnostics = (window as AtlasTestWindow).__THREE_GAME_DIAGNOSTICS__;
    return (diagnostics?.progression?.runSeed as number | undefined) ?? null;
  });
  await page.locator('#atlas-button').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#star-atlas-layer')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as AtlasTestWindow).__THREE_GAME_DIAGNOSTICS__?.paused)).toBe(true);
  const seedAfter = await page.evaluate(() => {
    const diagnostics = (window as AtlasTestWindow).__THREE_GAME_DIAGNOSTICS__;
    return (diagnostics?.progression?.runSeed as number | undefined) ?? null;
  });
  expect(seedAfter).toBe(seedBefore);
});

test('mobile exposes 44px Atlas and third-ability controls', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile control geometry is covered by the mobile project.');
  await beginGame(page);
  for (const selector of ['#atlas-button', '#ability3-button']) {
    await expect(page.locator(selector)).toBeVisible();
    const box = await page.locator(selector).boundingBox();
    expect(box, `${selector} should have a rendered target`).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
