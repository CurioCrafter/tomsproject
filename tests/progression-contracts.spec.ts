import { expect, test } from '@playwright/test';
import {
  DEFAULT_CHARACTER_PROFILE,
  sanitizeCharacterProfile,
  type CharacterProfile,
} from '../src/game/CharacterProfile';
import {
  CHARACTER_PROFILE_STORAGE_KEY,
  LEGACY_CHARACTER_PROFILE_STORAGE_KEY,
  loadCharacterProfile,
} from '../src/game/CharacterProfileStore';
import { FIRMAMENT_ROUTE } from '../src/game/content/FirmamentRoute';
import {
  generateProceduralAbility,
  generateProceduralItem,
  generateRewardOffer,
} from '../src/game/progression/ProceduralGenerator';
import { ProgressionSystem } from '../src/game/progression/ProgressionSystem';
import type { BranchSelection } from '../src/game/progression/ProgressionTypes';
import { BranchDirector } from '../src/systems/BranchDirector';

const TEST_PROFILE: CharacterProfile = {
  ...DEFAULT_CHARACTER_PROFILE,
  name: 'Contract Seer',
  origin: 'comet-warden',
  startingAbilities: ['comet-lance', 'eclipse-step'],
};

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

test('procedural rewards are deterministic, source-keyed, and independent of generation order', () => {
  const expected = generateRewardOffer(
    0x5eedc0de,
    'drowned-belfry-cantors',
    'The drowned bells fall silent',
    4,
    'drowned-cloister',
    7.5,
    'robe',
  );

  const itemBeforeNoise = generateProceduralItem('order-proof:item', 6, 'ember-basilica');
  const abilityBeforeNoise = generateProceduralAbility('order-proof:ability', 6, 'amethyst-archives');
  generateProceduralAbility('unrelated:ability', 11, 'verdant-cathedral', 20);
  generateProceduralItem('unrelated:item', 2, 'moonless-tundra', { slot: 'charm', lootLuck: 30 });
  const replay = generateRewardOffer(
    0x5eedc0de,
    'drowned-belfry-cantors',
    'The drowned bells fall silent',
    4,
    'drowned-cloister',
    7.5,
    'robe',
  );

  expect(replay).toEqual(expected);
  expect(generateProceduralItem('order-proof:item', 6, 'ember-basilica')).toEqual(itemBeforeNoise);
  expect(generateProceduralAbility('order-proof:ability', 6, 'amethyst-archives')).toEqual(abilityBeforeNoise);
  expect(expected.choices.map((choice) => choice.kind)).toEqual(['item', 'item', 'ability']);
  expect(new Set(expected.choices.map((choice) => choice.id)).size).toBe(3);
  expect(generateRewardOffer(0x5eedc0de, 'different-source', 'Other', 4, 'drowned-cloister').id).not.toBe(
    expected.id,
  );
});

test('progression claims deterministic loot once, equips it, and upgrades items and abilities', () => {
  const itemProgression = new ProgressionSystem(TEST_PROFILE, 123456);
  const initialItemState = itemProgression.getSnapshot();
  expect(initialItemState.inventory).toHaveLength(4);
  expect(initialItemState.abilities.map((ability) => ability.starterId)).toEqual(['comet-lance', 'eclipse-step']);
  expect(initialItemState.equippedAbilityIds.slice(0, 2).every(Boolean)).toBe(true);

  const itemOffer = itemProgression.createRewardOffer(
    'garden-grafts',
    'The garden remembers',
    'verdant-cathedral',
    1,
  );
  expect(itemOffer).not.toBeNull();
  const itemChoice = itemOffer?.choices.find((choice) => choice.kind === 'item');
  if (!itemOffer || !itemChoice || itemChoice.kind !== 'item') throw new Error('Expected an item reward choice.');
  const queuedOffer = itemProgression.createRewardOffer(
    'ember-choir-penitents',
    'The solar bells remember',
    'ember-basilica',
    2,
  );
  expect(queuedOffer?.sourceId).toBe('ember-choir-penitents');
  expect(itemProgression.currentOffer?.sourceId).toBe('garden-grafts');

  expect(itemProgression.claimReward(itemOffer.id, itemChoice.id)).toEqual(itemChoice);
  expect(itemProgression.currentOffer?.sourceId).toBe('ember-choir-penitents');
  expect(itemProgression.claimReward(itemOffer.id, itemChoice.id)).toBeNull();
  expect(itemProgression.createRewardOffer('garden-grafts', 'Duplicate', 'verdant-cathedral')).toBeNull();
  expect(itemProgression.equipItem(itemChoice.item.id)).toBe(true);
  expect(itemProgression.getSnapshot().equippedItems[itemChoice.item.slot]).toBe(itemChoice.item.id);

  const beforeItemUpgrade = itemProgression
    .getSnapshot()
    .inventory.find((item) => item.id === itemChoice.item.id);
  expect(beforeItemUpgrade).toBeDefined();
  expect(itemProgression.upgradeItem(itemChoice.item.id)).toBe(true);
  const afterItemUpgrade = itemProgression
    .getSnapshot()
    .inventory.find((item) => item.id === itemChoice.item.id);
  expect(afterItemUpgrade?.level).toBe((beforeItemUpgrade?.level ?? 0) + 1);
  expect(afterItemUpgrade?.power ?? 0).toBeGreaterThan(beforeItemUpgrade?.power ?? 0);

  const abilityProgression = new ProgressionSystem(TEST_PROFILE, 654321);
  const abilityOffer = abilityProgression.createRewardOffer(
    'amethyst-archive-scribes',
    'The archive yields a memory',
    'amethyst-archives',
    1,
  );
  const abilityChoice = abilityOffer?.choices.find((choice) => choice.kind === 'ability');
  if (!abilityOffer || !abilityChoice || abilityChoice.kind !== 'ability') {
    throw new Error('Expected an ability reward choice.');
  }
  expect(abilityProgression.claimReward(abilityOffer.id, abilityChoice.id)).toEqual(abilityChoice);
  expect(abilityProgression.getSnapshot().equippedAbilityIds[2]).toBe(abilityChoice.ability.id);
  expect(abilityProgression.equipAbility(abilityChoice.ability.id, 0)).toBe(true);
  expect(abilityProgression.getSnapshot().equippedAbilityIds[0]).toBe(abilityChoice.ability.id);

  const beforeAbilityUpgrade = abilityProgression
    .getSnapshot()
    .abilities.find((ability) => ability.id === abilityChoice.ability.id);
  expect(abilityProgression.upgradeAbility(abilityChoice.ability.id)).toBe(true);
  const afterAbilityUpgrade = abilityProgression
    .getSnapshot()
    .abilities.find((ability) => ability.id === abilityChoice.ability.id);
  expect(afterAbilityUpgrade?.level).toBe((beforeAbilityUpgrade?.level ?? 0) + 1);
  expect(afterAbilityUpgrade?.power ?? 0).toBeGreaterThan(beforeAbilityUpgrade?.power ?? 0);
});

test('specialization and branch consequences modify the build and restore at checkpoints', () => {
  const progression = new ProgressionSystem(TEST_PROFILE, 987654);
  const baseSpellPower = progression.getModifiers().spellPower;

  progression.recordEncounterVictory(2);
  expect(progression.getSnapshot()).toMatchObject({ level: 2, insight: 1 });
  expect(progression.allocateSpec('moon')).toBe(true);
  expect(progression.allocateSpec('moon')).toBe(false);
  expect(progression.getSnapshot().specs.moon).toBe(1);
  expect(progression.getModifiers().spellPower).toBeGreaterThan(baseSpellPower);

  const firstSelection: BranchSelection = {
    choiceId: 'drowned-vow',
    optionId: 'take-the-graveglass',
    label: 'Take the graveglass',
    consequence: {
      affinity: 'wrathful',
      affinityDelta: 0.14,
      lootBias: 'catalyst',
      enemyPowerMultiplier: 1.06,
      rewardLabel: 'Graveglass answers the hand that stole it',
    },
  };
  expect(progression.recordBranchSelection(firstSelection)).toBe(true);
  expect(progression.recordBranchSelection(firstSelection)).toBe(false);
  expect(progression.hasBranchSelection('drowned-vow')).toBe(true);
  expect(progression.enemyPowerMultiplier).toBeCloseTo(1.06);
  progression.commitCheckpoint();

  expect(
    progression.recordBranchSelection({
      choiceId: 'ember-rite',
      optionId: 'relight-the-sun-heart',
      label: 'Relight the sun-heart',
      consequence: {
        affinity: 'wrathful',
        affinityDelta: 0.22,
        lootBias: 'weapon',
        enemyPowerMultiplier: 1.1,
        rewardLabel: 'The sun-heart burns inside mortal steel',
      },
    }),
  ).toBe(true);
  expect(progression.enemyPowerMultiplier).toBeCloseTo(1.166);

  progression.restoreCheckpoint();
  expect(progression.hasBranchSelection('drowned-vow')).toBe(true);
  expect(progression.hasBranchSelection('ember-rite')).toBe(false);
  expect(progression.enemyPowerMultiplier).toBeCloseTo(1.06);
});

test('every fork keeps both arms sealed until selection and opens its exit only after the selected encounter clears', () => {
  const choices = FIRMAMENT_ROUTE.choices ?? [];
  const encounterById = new Map((FIRMAMENT_ROUTE.branchEncounters ?? []).map((encounter) => [encounter.id, encounter]));
  expect(choices).toHaveLength(4);

  choices.forEach((choice, choiceIndex) => {
    const director = new BranchDirector(FIRMAMENT_ROUTE);
    const selected = choice.options[choiceIndex % choice.options.length];
    const unselected = choice.options.find((option) => option.id !== selected.id);
    const initialGates = Object.fromEntries(director.getGateOverrides().map((gate) => [gate.id, gate.state]));

    expect(initialGates[choice.directGateId], `${choice.id} direct route starts sealed`).toBe('closed');
    for (const option of choice.options) {
      expect(initialGates[option.entryGateId], `${choice.id}/${option.id} entry starts sealed`).toBe('closed');
      expect(initialGates[option.exitGateId], `${choice.id}/${option.id} exit starts sealed`).toBe('closed');
    }

    expect(director.selectOption(choice.id, selected.id)).toEqual(selected);
    const selectedGates = Object.fromEntries(director.getGateOverrides().map((gate) => [gate.id, gate.state]));
    expect(selectedGates[selected.entryGateId]).toBe('open');
    expect(selectedGates[selected.exitGateId]).toBe('closed');
    expect(selectedGates[choice.directGateId]).toBe('closed');
    if (!unselected) throw new Error(`Choice ${choice.id} did not expose a second route arm.`);
    expect(selectedGates[unselected.entryGateId]).toBe('closed');
    expect(selectedGates[unselected.exitGateId]).toBe('closed');

    const encounter = encounterById.get(selected.encounterId);
    if (!encounter) throw new Error(`Missing selected encounter ${selected.encounterId}.`);
    expect(director.activateSelectedEncounterAt(encounter.activation.center)).toBe(encounter.id);
    expect(director.getEncounterState(encounter.id)).toBe('active');
    expect(encounter.spawns.every((spawn) => director.isEnemyEnabled(spawn.id))).toBe(true);

    encounter.spawns.slice(0, -1).forEach((spawn) => {
      expect(director.markEnemyDefeated(spawn.id)).toMatchObject({
        accepted: true,
        encounterCompleted: false,
        encounterId: encounter.id,
        choiceId: choice.id,
      });
      const partialGates = Object.fromEntries(director.getGateOverrides().map((gate) => [gate.id, gate.state]));
      expect(partialGates[selected.exitGateId]).toBe('closed');
      expect(partialGates[choice.directGateId]).toBe('closed');
    });

    const finalSpawn = encounter.spawns.at(-1);
    if (!finalSpawn) throw new Error(`Encounter ${encounter.id} did not contain enemies.`);
    expect(director.markEnemyDefeated(finalSpawn.id)).toMatchObject({
      accepted: true,
      encounterCompleted: true,
      encounterId: encounter.id,
      choiceId: choice.id,
    });
    expect(director.getEncounterState(encounter.id)).toBe('cleared');

    const completedSnapshot = director.getSnapshot();
    const completedGates = Object.fromEntries(completedSnapshot.gates.map((gate) => [gate.id, gate.state]));
    expect(completedGates[selected.entryGateId]).toBe('open');
    expect(completedGates[selected.exitGateId]).toBe('open');
    expect(completedGates[choice.directGateId]).toBe('open');
    expect(completedGates[unselected.entryGateId]).toBe('closed');
    expect(completedGates[unselected.exitGateId]).toBe('closed');
    expect(completedSnapshot.selections).toContainEqual({ choiceId: choice.id, optionId: selected.id });
    expect(completedSnapshot.completedEncounterIds).toContain(encounter.id);

    director.restoreAfterDeath();
    const restoredSnapshot = director.getSnapshot();
    expect(restoredSnapshot.activeEncounterId).toBeNull();
    expect(restoredSnapshot.defeatedSpawnIds).toEqual([]);
    expect(restoredSnapshot.selections).toEqual(completedSnapshot.selections);
    expect(restoredSnapshot.completedEncounterIds).toEqual(completedSnapshot.completedEncounterIds);
    expect(restoredSnapshot.gates).toEqual(completedSnapshot.gates);
  });
});

test('legacy v1 profiles migrate to v2 defaults and malformed new fields sanitize independently', () => {
  const storage = new MemoryStorage();
  storage.setItem(
    LEGACY_CHARACTER_PROFILE_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 1,
      name: '  Vesper   Pilgrim  ',
      lifeStage: 'elder',
      frame: 'sturdy',
      veil: 'moon-mask',
      robeDye: 'moss',
      astralMetal: 'aurora-bronze',
      catalyst: 'ash-wand',
    }),
  );

  const migrated = loadCharacterProfile(storage);
  expect(migrated).toEqual({
    schemaVersion: 2,
    name: 'Vesper Pilgrim',
    lifeStage: 'elder',
    frame: 'sturdy',
    veil: 'moon-mask',
    robeDye: 'moss',
    astralMetal: 'aurora-bronze',
    catalyst: 'ash-wand',
    origin: DEFAULT_CHARACTER_PROFILE.origin,
    startingAbilities: DEFAULT_CHARACTER_PROFILE.startingAbilities,
  });
  expect(JSON.parse(storage.getItem(CHARACTER_PROFILE_STORAGE_KEY) ?? 'null')).toEqual(migrated);

  const sanitized = sanitizeCharacterProfile({
    ...migrated,
    origin: 'not-an-origin',
    startingAbilities: ['comet-lance', 'comet-lance', 'not-an-ability'],
    robeDye: 'not-a-dye',
    primaryAbility: 'comet-lance',
    secondaryAbility: 'eclipse-step',
  });
  expect(sanitized.origin).toBe(DEFAULT_CHARACTER_PROFILE.origin);
  expect(sanitized.robeDye).toBe(DEFAULT_CHARACTER_PROFILE.robeDye);
  expect(sanitized.startingAbilities).toEqual(DEFAULT_CHARACTER_PROFILE.startingAbilities);
});
