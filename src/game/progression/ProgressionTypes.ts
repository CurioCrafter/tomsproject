import type { StartingAbilityId, PilgrimOrigin } from '../CharacterProfile';
import type { RouteBiomeId, RouteChoiceConsequence } from '../content/RouteTypes';

export const ITEM_SLOTS = ['weapon', 'catalyst', 'robe', 'charm'] as const;
export const ITEM_RARITIES = ['weathered', 'enchanted', 'astral', 'mythic'] as const;
export const ABILITY_SCHOOLS = ['lunar', 'aurora', 'comet', 'eclipse'] as const;
export const ABILITY_FORMS = ['bolt', 'wave', 'nova', 'step'] as const;
export const ABILITY_EFFECTS = ['pierce', 'leech', 'stagger', 'echo', 'ward', 'chain'] as const;
export const SPEC_BRANCHES = ['moon', 'aurora', 'eclipse'] as const;

export type ItemSlot = (typeof ITEM_SLOTS)[number];
export type ItemRarity = (typeof ITEM_RARITIES)[number];
export type AbilitySchool = (typeof ABILITY_SCHOOLS)[number];
export type AbilityForm = (typeof ABILITY_FORMS)[number];
export type AbilityEffect = (typeof ABILITY_EFFECTS)[number];
export type SpecBranch = (typeof SPEC_BRANCHES)[number];

export type ProgressionStat =
  | 'meleePower'
  | 'spellPower'
  | 'maxHealth'
  | 'maxFocus'
  | 'maxStamina'
  | 'moveSpeed'
  | 'cooldownRate'
  | 'damageReduction'
  | 'lootLuck'
  | 'healingPower';

export type ItemAffix = Readonly<{
  stat: ProgressionStat;
  value: number;
  label: string;
}>;

export type ProceduralItem = Readonly<{
  id: string;
  seed: number;
  name: string;
  lore: string;
  slot: ItemSlot;
  rarity: ItemRarity;
  biome: RouteBiomeId;
  level: number;
  power: number;
  affixes: readonly ItemAffix[];
}>;

export type ProceduralAbility = Readonly<{
  id: string;
  seed: number;
  name: string;
  description: string;
  school: AbilitySchool;
  form: AbilityForm;
  effect: AbilityEffect;
  rarity: ItemRarity;
  biome: RouteBiomeId;
  level: number;
  power: number;
  focusCost: number;
  cooldownSeconds: number;
  glyph: string;
  starterId?: StartingAbilityId;
}>;

export type RewardChoice =
  | Readonly<{ id: string; kind: 'item'; item: ProceduralItem }>
  | Readonly<{ id: string; kind: 'ability'; ability: ProceduralAbility }>;

export type RewardOffer = Readonly<{
  id: string;
  sourceId: string;
  title: string;
  biome: RouteBiomeId;
  level: number;
  choices: readonly RewardChoice[];
}>;

export type EquippedItems = Readonly<Record<ItemSlot, string | null>>;

export type BuildModifiers = Readonly<Record<ProgressionStat, number>>;

export type BranchConsequence = RouteChoiceConsequence;

export type BranchSelection = Readonly<{
  choiceId: string;
  optionId: string;
  label: string;
  consequence: BranchConsequence;
}>;

export type ProgressionSnapshot = Readonly<{
  version: 1;
  runSeed: number;
  origin: PilgrimOrigin;
  level: number;
  experience: number;
  experienceToNext: number;
  insight: number;
  stardust: number;
  inventory: readonly ProceduralItem[];
  abilities: readonly ProceduralAbility[];
  equippedItems: EquippedItems;
  equippedAbilityIds: readonly [string | null, string | null, string | null];
  specs: Readonly<Record<SpecBranch, number>>;
  branchSelections: readonly BranchSelection[];
  claimedRewardSourceIds: readonly string[];
  pendingOffer: RewardOffer | null;
  rewardQueue: readonly RewardOffer[];
  modifiers: BuildModifiers;
}>;

export const EMPTY_BUILD_MODIFIERS: BuildModifiers = Object.freeze({
  meleePower: 0,
  spellPower: 0,
  maxHealth: 0,
  maxFocus: 0,
  maxStamina: 0,
  moveSpeed: 0,
  cooldownRate: 0,
  damageReduction: 0,
  lootLuck: 0,
  healingPower: 0,
});
