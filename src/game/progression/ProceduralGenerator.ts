import type { StartingAbilityId } from '../CharacterProfile';
import type { RouteBiomeId } from '../content/RouteTypes';
import { hashSeed, SeededRandom } from './SeededRandom';
import {
  ABILITY_EFFECTS,
  ABILITY_FORMS,
  ITEM_SLOTS,
  type AbilityEffect,
  type AbilityForm,
  type AbilitySchool,
  type ItemAffix,
  type ItemRarity,
  type ItemSlot,
  type ProceduralAbility,
  type ProceduralItem,
  type ProgressionStat,
  type RewardOffer,
} from './ProgressionTypes';

type BiomeLexicon = Readonly<{
  prefix: readonly string[];
  material: readonly string[];
  suffix: readonly string[];
  schools: readonly AbilitySchool[];
  lore: string;
}>;

const BIOME_LEXICON: Readonly<Record<RouteBiomeId, BiomeLexicon>> = {
  'moonless-tundra': {
    prefix: ['Moonless', 'Rimebound', 'Firmament', 'Blackstone'],
    material: ['Slate', 'Silver', 'Starweave', 'Meteor-Iron'],
    suffix: ['of the Pale Orbit', 'of Returning Light', 'of the Silent School'],
    schools: ['lunar', 'aurora'],
    lore: 'Recovered from the school roads where the absent stars still leave frost in stone.',
  },
  'ember-basilica': {
    prefix: ['Cinder-Vowed', 'Vermilion', 'Bellforged', 'Ashen'],
    material: ['Brass', 'Emberglass', 'Charstone', 'Reliquary-Iron'],
    suffix: ['of the Last Bell', 'of Penitent Flame', 'of the Red Nave'],
    schools: ['comet', 'eclipse'],
    lore: 'Consecrated beneath a red cathedral whose bells burn the names they toll.',
  },
  'drowned-cloister': {
    prefix: ['Tide-Hushed', 'Cerulean', 'Drowned', 'Brine-Scripted'],
    material: ['Pearlstone', 'Abyssal Silver', 'Blue Glass', 'Choir-Coral'],
    suffix: ['of the Sunken Choir', 'of Nine Tides', 'of the Flooded Saint'],
    schools: ['aurora', 'lunar'],
    lore: 'Raised from the flooded cloister while its submerged choir continued to breathe.',
  },
  'amethyst-archives': {
    prefix: ['Amethyst', 'Inkbound', 'Vesper', 'Mnemonic'],
    material: ['Star-Parchment', 'Violet Glass', 'Memory-Iron', 'Prism Slate'],
    suffix: ['of the Unwritten Hour', 'of the Spiral Index', 'of Violet Memory'],
    schools: ['eclipse', 'comet'],
    lore: 'Indexed in an archive where every unwritten choice casts a second shadow.',
  },
  'verdant-cathedral': {
    prefix: ['Verdant', 'Root-Crowned', 'Auroral', 'Glassgarden'],
    material: ['Living Bronze', 'Mossglass', 'Thorn-Silver', 'Saintwood'],
    suffix: ['of the Green Firmament', 'of the Rooted Dawn', 'of the Glass Chapel'],
    schools: ['aurora', 'comet'],
    lore: 'Grown rather than forged beneath the cathedral greenhouse of the newborn sky.',
  },
};

const SLOT_NOUNS: Readonly<Record<ItemSlot, readonly string[]>> = {
  weapon: ['Blade', 'Falchion', 'Ritual Knife', 'Longsword'],
  catalyst: ['Astrolabe', 'Crozier', 'Wand', 'Orb'],
  robe: ['Vestment', 'Mantle', 'Starweave', 'Pilgrim Robe'],
  charm: ['Seal', 'Medallion', 'Reliquary', 'Omen'],
};

const STAT_LABELS: Readonly<Record<ProgressionStat, string>> = {
  meleePower: 'Melee power',
  spellPower: 'Sorcery power',
  maxHealth: 'Vitality',
  maxFocus: 'Focus',
  maxStamina: 'Stamina',
  moveSpeed: 'Movement',
  cooldownRate: 'Casting speed',
  damageReduction: 'Ward',
  lootLuck: 'Discovery',
  healingPower: 'Restoration',
};

const SLOT_STATS: Readonly<Record<ItemSlot, readonly ProgressionStat[]>> = {
  weapon: ['meleePower', 'maxStamina', 'moveSpeed'],
  catalyst: ['spellPower', 'maxFocus', 'cooldownRate'],
  robe: ['maxHealth', 'damageReduction', 'healingPower'],
  charm: ['lootLuck', 'spellPower', 'meleePower', 'maxStamina', 'maxFocus'],
};

const STARTER_ABILITIES: Readonly<Record<StartingAbilityId, Omit<ProceduralAbility, 'id' | 'seed' | 'level' | 'power' | 'biome'>>> = {
  'lunar-dart': {
    name: 'Lunar Dart',
    description: 'A quick moon-silver bolt that pierces the first target.',
    school: 'lunar',
    form: 'bolt',
    effect: 'pierce',
    rarity: 'enchanted',
    focusCost: 15,
    cooldownSeconds: 0.38,
    glyph: '☾',
    starterId: 'lunar-dart',
  },
  'aurora-veil': {
    name: 'Aurora Veil',
    description: 'A merciful fan of light that wounds foes and restores its caster.',
    school: 'aurora',
    form: 'wave',
    effect: 'leech',
    rarity: 'enchanted',
    focusCost: 28,
    cooldownSeconds: 1.08,
    glyph: '✦',
    starterId: 'aurora-veil',
  },
  'comet-lance': {
    name: 'Comet Lance',
    description: 'A narrow, high-impact star lance that staggers armored foes.',
    school: 'comet',
    form: 'bolt',
    effect: 'stagger',
    rarity: 'enchanted',
    focusCost: 23,
    cooldownSeconds: 0.72,
    glyph: '✧',
    starterId: 'comet-lance',
  },
  'eclipse-step': {
    name: 'Eclipse Step',
    description: 'Fold through a short shadow and leave an echoing nova behind.',
    school: 'eclipse',
    form: 'step',
    effect: 'echo',
    rarity: 'enchanted',
    focusCost: 20,
    cooldownSeconds: 1.35,
    glyph: '◐',
    starterId: 'eclipse-step',
  },
};

const GLYPHS: Readonly<Record<AbilitySchool, string>> = {
  lunar: '☾',
  aurora: '✦',
  comet: '✧',
  eclipse: '◐',
};

function chooseRarity(random: SeededRandom, level: number, lootLuck: number): ItemRarity {
  const roll = random.next() + Math.min(0.16, level * 0.008 + lootLuck * 0.0025);
  if (roll >= 0.985) return 'mythic';
  if (roll >= 0.82) return 'astral';
  if (roll >= 0.38) return 'enchanted';
  return 'weathered';
}

function rarityRank(rarity: ItemRarity): number {
  return ['weathered', 'enchanted', 'astral', 'mythic'].indexOf(rarity);
}

function affixValue(stat: ProgressionStat, level: number, rarity: ItemRarity, random: SeededRandom): number {
  const rank = rarityRank(rarity);
  const scalar = 1 + level * 0.13 + rank * 0.34 + random.next() * 0.28;
  if (stat === 'maxHealth') return Math.round(8 * scalar);
  if (stat === 'maxFocus' || stat === 'maxStamina') return Math.round(6 * scalar);
  if (stat === 'moveSpeed' || stat === 'cooldownRate' || stat === 'damageReduction') return Number((0.025 * scalar).toFixed(3));
  if (stat === 'lootLuck') return Number((1.8 * scalar).toFixed(1));
  return Number((0.055 * scalar).toFixed(3));
}

function createAffixes(slot: ItemSlot, level: number, rarity: ItemRarity, random: SeededRandom): readonly ItemAffix[] {
  const count = Math.min(SLOT_STATS[slot].length, 1 + rarityRank(rarity));
  const available = [...SLOT_STATS[slot]];
  const affixes: ItemAffix[] = [];
  while (affixes.length < count && available.length > 0) {
    const index = random.int(0, available.length - 1);
    const stat = available.splice(index, 1)[0];
    affixes.push({ stat, value: affixValue(stat, level, rarity, random), label: STAT_LABELS[stat] });
  }
  return affixes;
}

export function createStarterAbility(id: StartingAbilityId, runSeed: number, index: number): ProceduralAbility {
  const blueprint = STARTER_ABILITIES[id];
  const seed = hashSeed(`${runSeed}:starter:${id}:${index}`);
  return {
    ...blueprint,
    id: `ability-${seed.toString(36)}`,
    seed,
    level: 1,
    power: id === 'aurora-veil' ? 31 : id === 'comet-lance' ? 26 : id === 'eclipse-step' ? 24 : 18,
    biome: 'moonless-tundra',
  };
}

export function generateProceduralItem(
  sourceSeed: string,
  level: number,
  biome: RouteBiomeId,
  options: Readonly<{ slot?: ItemSlot; lootLuck?: number }> = {},
): ProceduralItem {
  const seed = hashSeed(`item:${sourceSeed}`);
  const random = new SeededRandom(seed);
  const lexicon = BIOME_LEXICON[biome];
  const slot = options.slot ?? random.pick(ITEM_SLOTS);
  const rarity = chooseRarity(random, level, options.lootLuck ?? 0);
  const affixes = createAffixes(slot, Math.max(1, level), rarity, random);
  const name = `${random.pick(lexicon.prefix)} ${random.pick(lexicon.material)} ${random.pick(SLOT_NOUNS[slot])} ${random.pick(lexicon.suffix)}`;
  return {
    id: `item-${seed.toString(36)}`,
    seed,
    name,
    lore: lexicon.lore,
    slot,
    rarity,
    biome,
    level: Math.max(1, Math.floor(level)),
    power: Math.round((10 + level * 5.5) * (1 + rarityRank(rarity) * 0.23)),
    affixes,
  };
}

export function generateProceduralAbility(
  sourceSeed: string,
  level: number,
  biome: RouteBiomeId,
  lootLuck = 0,
): ProceduralAbility {
  const seed = hashSeed(`ability:${sourceSeed}`);
  const random = new SeededRandom(seed);
  const lexicon = BIOME_LEXICON[biome];
  const school = random.pick(lexicon.schools);
  const form = random.pick(ABILITY_FORMS) as AbilityForm;
  const effect = random.pick(ABILITY_EFFECTS) as AbilityEffect;
  const rarity = chooseRarity(random, level, lootLuck);
  const schoolName: Record<AbilitySchool, string> = {
    lunar: 'Lunar',
    aurora: 'Aurora',
    comet: 'Comet',
    eclipse: 'Eclipse',
  };
  const formName: Record<AbilityForm, string> = { bolt: 'Lance', wave: 'Canticle', nova: 'Crown', step: 'Step' };
  const effectName: Record<AbilityEffect, string> = {
    pierce: 'of Piercing Orbits',
    leech: 'of Returning Breath',
    stagger: 'of the Broken Bell',
    echo: 'of the Second Shadow',
    ward: 'of Sainted Glass',
    chain: 'of the Constellation Chain',
  };
  const rank = rarityRank(rarity);
  const focusBase: Record<AbilityForm, number> = { bolt: 16, wave: 25, nova: 31, step: 20 };
  const cooldownBase: Record<AbilityForm, number> = { bolt: 0.48, wave: 1.05, nova: 1.55, step: 1.25 };
  return {
    id: `ability-${seed.toString(36)}`,
    seed,
    name: `${schoolName[school]} ${formName[form]} ${effectName[effect]}`,
    description: `${formName[form]} sorcery shaped by ${effect}; its pattern changes with the pilgrim who remembers it.`,
    school,
    form,
    effect,
    rarity,
    biome,
    level: Math.max(1, Math.floor(level)),
    power: Math.round((17 + level * 4.8) * (1 + rank * 0.2)),
    focusCost: Math.max(8, focusBase[form] - rank),
    cooldownSeconds: Number(Math.max(0.28, cooldownBase[form] * (1 - rank * 0.055)).toFixed(2)),
    glyph: GLYPHS[school],
  };
}

export function generateRewardOffer(
  runSeed: number,
  sourceId: string,
  title: string,
  level: number,
  biome: RouteBiomeId,
  lootLuck = 0,
  slotBias?: ItemSlot,
): RewardOffer {
  const offerSeed = `${runSeed}:${sourceId}:${level}:${biome}`;
  const first = generateProceduralItem(`${offerSeed}:0`, level, biome, { slot: slotBias, lootLuck });
  const second = generateProceduralItem(`${offerSeed}:1`, level, biome, { lootLuck });
  const ability = generateProceduralAbility(`${offerSeed}:2`, level, biome, lootLuck);
  return {
    id: `offer-${hashSeed(offerSeed).toString(36)}`,
    sourceId,
    title,
    biome,
    level,
    choices: [
      { id: first.id, kind: 'item', item: first },
      { id: second.id, kind: 'item', item: second },
      { id: ability.id, kind: 'ability', ability },
    ],
  };
}
