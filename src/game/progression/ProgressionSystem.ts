import type { CharacterProfile, PilgrimOrigin } from '../CharacterProfile';
import type { RouteBiomeId } from '../content/RouteTypes';
import { generateProceduralItem, generateRewardOffer, createStarterAbility } from './ProceduralGenerator';
import { hashSeed } from './SeededRandom';
import {
  EMPTY_BUILD_MODIFIERS,
  ITEM_SLOTS,
  SPEC_BRANCHES,
  type BranchSelection,
  type BuildModifiers,
  type ItemSlot,
  type ProceduralAbility,
  type ProceduralItem,
  type ProgressionSnapshot,
  type ProgressionStat,
  type RewardChoice,
  type RewardOffer,
  type SpecBranch,
} from './ProgressionTypes';

const MAX_INVENTORY = 36;
const MAX_ABILITIES = 18;
const MAX_SPEC_RANK = 5;

const ORIGIN_MODIFIERS: Readonly<Record<PilgrimOrigin, Partial<BuildModifiers>>> = {
  'lunar-penitent': { spellPower: 0.08, maxFocus: 12, lootLuck: 2 },
  'aurora-votary': { maxHealth: 16, healingPower: 0.12, damageReduction: 0.025 },
  'comet-warden': { meleePower: 0.08, maxStamina: 12, moveSpeed: 0.025 },
  'eclipse-outcast': { cooldownRate: 0.07, moveSpeed: 0.04, maxHealth: -8, lootLuck: 4 },
};

const SPEC_MODIFIERS: Readonly<Record<SpecBranch, readonly Partial<BuildModifiers>[]>> = {
  moon: [
    { spellPower: 0.05 },
    { maxFocus: 6 },
    { cooldownRate: 0.025 },
    { spellPower: 0.07 },
    { maxFocus: 12, spellPower: 0.08 },
  ],
  aurora: [
    { maxHealth: 8 },
    { healingPower: 0.045 },
    { damageReduction: 0.025 },
    { maxHealth: 12 },
    { healingPower: 0.08, damageReduction: 0.035 },
  ],
  eclipse: [
    { meleePower: 0.05 },
    { moveSpeed: 0.025 },
    { maxStamina: 7 },
    { cooldownRate: 0.035 },
    { meleePower: 0.08, moveSpeed: 0.035 },
  ],
};

function randomRunSeed(profile: CharacterProfile): number {
  try {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] || hashSeed(`${profile.name}:${Date.now()}`);
  } catch {
    return hashSeed(`${profile.name}:${Date.now()}:${performance.now()}`);
  }
}

function emptyEquipped(): Record<ItemSlot, string | null> {
  return { weapon: null, catalyst: null, robe: null, charm: null };
}

function emptySpecs(): Record<SpecBranch, number> {
  return { moon: 0, aurora: 0, eclipse: 0 };
}

function cloneItem(item: ProceduralItem): ProceduralItem {
  return { ...item, affixes: item.affixes.map((affix) => ({ ...affix })) };
}

function cloneAbility(ability: ProceduralAbility): ProceduralAbility {
  return { ...ability };
}

function cloneOffer(offer: RewardOffer | null): RewardOffer | null {
  if (!offer) return null;
  return {
    ...offer,
    choices: offer.choices.map((choice) =>
      choice.kind === 'item'
        ? { ...choice, item: cloneItem(choice.item) }
        : { ...choice, ability: cloneAbility(choice.ability) },
    ),
  };
}

function addModifiers(target: Record<ProgressionStat, number>, source: Partial<BuildModifiers>): void {
  for (const [stat, value] of Object.entries(source) as [ProgressionStat, number][]) {
    if (!Number.isFinite(value)) continue;
    target[stat] += value;
  }
}

export class ProgressionSystem {
  private profile!: CharacterProfile;
  private runSeed = 1;
  private level = 1;
  private experience = 0;
  private insight = 0;
  private stardust = 0;
  private inventory: ProceduralItem[] = [];
  private abilities: ProceduralAbility[] = [];
  private equippedItems = emptyEquipped();
  private equippedAbilityIds: [string | null, string | null, string | null] = [null, null, null];
  private specs = emptySpecs();
  private branchSelections: BranchSelection[] = [];
  private claimedRewardSourceIds = new Set<string>();
  private rewardQueue: RewardOffer[] = [];
  private checkpointSnapshot: ProgressionSnapshot | null = null;

  constructor(profile: CharacterProfile, seed?: number) {
    this.reset(profile, seed);
  }

  reset(profile: CharacterProfile, seed = randomRunSeed(profile)): void {
    this.profile = profile;
    this.runSeed = seed >>> 0 || 1;
    this.level = 1;
    this.experience = 0;
    this.insight = 0;
    this.stardust = 18;
    this.inventory = [];
    this.abilities = [];
    this.equippedItems = emptyEquipped();
    this.equippedAbilityIds = [null, null, null];
    this.specs = emptySpecs();
    this.branchSelections = [];
    this.claimedRewardSourceIds.clear();
    this.rewardQueue = [];

    ITEM_SLOTS.forEach((slot, index) => {
      const item = generateProceduralItem(`${this.runSeed}:starter:${profile.origin}:${slot}`, 1, 'moonless-tundra', { slot });
      this.inventory.push(item);
      this.equippedItems[slot] = item.id;
      if (index === 0) this.claimedRewardSourceIds.add(`starter-${profile.origin}`);
    });
    profile.startingAbilities.forEach((abilityId, index) => {
      const ability = createStarterAbility(abilityId, this.runSeed, index);
      this.abilities.push(ability);
      this.equippedAbilityIds[index] = ability.id;
    });
    this.checkpointSnapshot = this.getSnapshot();
  }

  get seed(): number {
    return this.runSeed;
  }

  get currentOffer(): RewardOffer | null {
    return cloneOffer(this.rewardQueue[0] ?? null);
  }

  get equippedAbilities(): readonly (ProceduralAbility | null)[] {
    return this.equippedAbilityIds.map((id) => this.abilities.find((ability) => ability.id === id) ?? null);
  }

  get enemyPowerMultiplier(): number {
    return this.branchSelections.reduce(
      (value, selection) => value * Math.max(0.75, selection.consequence.enemyPowerMultiplier),
      1,
    );
  }

  createRewardOffer(sourceId: string, title: string, biome: RouteBiomeId, level = this.level): RewardOffer | null {
    if (this.claimedRewardSourceIds.has(sourceId)) return null;
    const existing = this.rewardQueue.find((offer) => offer.sourceId === sourceId);
    if (existing) return cloneOffer(existing);
    const bias = this.branchSelections.at(-1)?.consequence.lootBias;
    const offer = generateRewardOffer(
      this.runSeed,
      sourceId,
      title,
      Math.max(1, level),
      biome,
      this.getModifiers().lootLuck,
      bias,
    );
    this.rewardQueue.push(offer);
    return cloneOffer(offer);
  }

  claimReward(offerId: string, choiceId: string): RewardChoice | null {
    const offer = this.rewardQueue[0] ?? null;
    if (!offer || offer.id !== offerId || this.claimedRewardSourceIds.has(offer.sourceId)) return null;
    const choice = offer.choices.find((candidate) => candidate.id === choiceId);
    if (!choice) return null;
    if (choice.kind === 'item') {
      if (this.inventory.length >= MAX_INVENTORY) return null;
      this.inventory.push(cloneItem(choice.item));
    } else {
      if (this.abilities.length >= MAX_ABILITIES) return null;
      this.abilities.push(cloneAbility(choice.ability));
      const freeSlot = this.equippedAbilityIds.findIndex((id) => id === null);
      if (freeSlot >= 0) this.equippedAbilityIds[freeSlot] = choice.ability.id;
    }
    this.claimedRewardSourceIds.add(offer.sourceId);
    this.rewardQueue.shift();
    this.stardust += 12 + offer.level * 3;
    return choice.kind === 'item'
      ? { ...choice, item: cloneItem(choice.item) }
      : { ...choice, ability: cloneAbility(choice.ability) };
  }

  dismissOffer(): boolean {
    if (this.rewardQueue.length < 2) return false;
    const deferred = this.rewardQueue.shift();
    if (deferred) this.rewardQueue.push(deferred);
    return Boolean(deferred);
  }

  equipItem(itemId: string): boolean {
    const item = this.inventory.find((candidate) => candidate.id === itemId);
    if (!item) return false;
    this.equippedItems[item.slot] = item.id;
    return true;
  }

  equipAbility(abilityId: string, slot: number): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.equippedAbilityIds.length) return false;
    if (!this.abilities.some((ability) => ability.id === abilityId)) return false;
    const existingSlot = this.equippedAbilityIds.indexOf(abilityId);
    if (existingSlot >= 0) this.equippedAbilityIds[existingSlot] = this.equippedAbilityIds[slot];
    this.equippedAbilityIds[slot] = abilityId;
    return true;
  }

  upgradeItem(itemId: string): boolean {
    const index = this.inventory.findIndex((item) => item.id === itemId);
    if (index < 0) return false;
    const item = this.inventory[index];
    const cost = this.itemUpgradeCost(item);
    if (this.stardust < cost || item.level >= 12) return false;
    this.stardust -= cost;
    this.inventory[index] = {
      ...item,
      level: item.level + 1,
      power: Math.round(item.power * 1.1 + 2),
      affixes: item.affixes.map((affix) => ({ ...affix, value: Number((affix.value * 1.075).toFixed(3)) })),
    };
    return true;
  }

  upgradeAbility(abilityId: string): boolean {
    const index = this.abilities.findIndex((ability) => ability.id === abilityId);
    if (index < 0) return false;
    const ability = this.abilities[index];
    const cost = this.abilityUpgradeCost(ability);
    if (this.stardust < cost || ability.level >= 12) return false;
    this.stardust -= cost;
    this.abilities[index] = {
      ...ability,
      level: ability.level + 1,
      power: Math.round(ability.power * 1.11 + 1),
      focusCost: Math.max(7, ability.focusCost - (ability.level % 3 === 0 ? 1 : 0)),
      cooldownSeconds: Number(Math.max(0.25, ability.cooldownSeconds * 0.985).toFixed(2)),
    };
    return true;
  }

  itemUpgradeCost(item: ProceduralItem): number {
    return 16 + item.level * 11;
  }

  abilityUpgradeCost(ability: ProceduralAbility): number {
    return 18 + ability.level * 12;
  }

  allocateSpec(branch: SpecBranch): boolean {
    if (!SPEC_BRANCHES.includes(branch) || this.insight <= 0 || this.specs[branch] >= MAX_SPEC_RANK) return false;
    this.insight -= 1;
    this.specs[branch] += 1;
    return true;
  }

  recordEncounterVictory(order: number): void {
    this.experience += 60 + Math.max(0, order) * 22;
    this.stardust += 8 + Math.max(0, order) * 2;
    while (this.experience >= this.experienceToNext()) {
      this.experience -= this.experienceToNext();
      this.level += 1;
      this.insight += 1;
    }
  }

  recordBranchSelection(selection: BranchSelection): boolean {
    if (this.branchSelections.some((candidate) => candidate.choiceId === selection.choiceId)) return false;
    this.branchSelections.push({
      ...selection,
      consequence: { ...selection.consequence },
    });
    return true;
  }

  hasBranchSelection(choiceId: string): boolean {
    return this.branchSelections.some((selection) => selection.choiceId === choiceId);
  }

  commitCheckpoint(): void {
    this.checkpointSnapshot = this.getSnapshot();
  }

  restoreCheckpoint(): void {
    if (this.checkpointSnapshot) this.restore(this.checkpointSnapshot);
  }

  getModifiers(): BuildModifiers {
    const result = { ...EMPTY_BUILD_MODIFIERS } as Record<ProgressionStat, number>;
    addModifiers(result, ORIGIN_MODIFIERS[this.profile.origin]);
    for (const slot of ITEM_SLOTS) {
      const itemId = this.equippedItems[slot];
      const item = itemId ? this.inventory.find((candidate) => candidate.id === itemId) : null;
      if (!item) continue;
      for (const affix of item.affixes) result[affix.stat] += affix.value;
      if (slot === 'weapon') result.meleePower += item.power * 0.0024;
      if (slot === 'catalyst') result.spellPower += item.power * 0.0024;
    }
    for (const branch of SPEC_BRANCHES) {
      for (let rank = 0; rank < this.specs[branch]; rank += 1) addModifiers(result, SPEC_MODIFIERS[branch][rank] ?? {});
    }
    return result;
  }

  getSnapshot(): ProgressionSnapshot {
    return {
      version: 1,
      runSeed: this.runSeed,
      origin: this.profile.origin,
      level: this.level,
      experience: this.experience,
      experienceToNext: this.experienceToNext(),
      insight: this.insight,
      stardust: this.stardust,
      inventory: this.inventory.map(cloneItem),
      abilities: this.abilities.map(cloneAbility),
      equippedItems: { ...this.equippedItems },
      equippedAbilityIds: [...this.equippedAbilityIds],
      specs: { ...this.specs },
      branchSelections: this.branchSelections.map((selection) => ({ ...selection, consequence: { ...selection.consequence } })),
      claimedRewardSourceIds: [...this.claimedRewardSourceIds],
      pendingOffer: cloneOffer(this.rewardQueue[0] ?? null),
      rewardQueue: this.rewardQueue.map((offer) => cloneOffer(offer) as RewardOffer),
      modifiers: this.getModifiers(),
    };
  }

  private experienceToNext(): number {
    return 100 + (this.level - 1) * 55;
  }

  private restore(snapshot: ProgressionSnapshot): void {
    this.runSeed = snapshot.runSeed;
    this.level = snapshot.level;
    this.experience = snapshot.experience;
    this.insight = snapshot.insight;
    this.stardust = snapshot.stardust;
    this.inventory = snapshot.inventory.map(cloneItem);
    this.abilities = snapshot.abilities.map(cloneAbility);
    this.equippedItems = { ...snapshot.equippedItems };
    this.equippedAbilityIds = [...snapshot.equippedAbilityIds];
    this.specs = { ...snapshot.specs };
    this.branchSelections = snapshot.branchSelections.map((selection) => ({ ...selection, consequence: { ...selection.consequence } }));
    this.claimedRewardSourceIds = new Set(snapshot.claimedRewardSourceIds);
    this.rewardQueue = snapshot.rewardQueue.map((offer) => cloneOffer(offer) as RewardOffer);
  }
}
