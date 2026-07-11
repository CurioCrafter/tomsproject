export const CHARACTER_PROFILE_SCHEMA_VERSION = 1 as const;

export const LIFE_STAGES = ['young', 'elder'] as const;
export const BODY_FRAMES = ['slender', 'sturdy'] as const;
export const VEIL_STYLES = ['deep-hood', 'moon-mask', 'unveiled'] as const;
export const ROBE_DYES = ['midnight', 'ash', 'moss', 'oxblood'] as const;
export const ASTRAL_METALS = ['lunar-silver', 'aurora-bronze', 'celestial-gold'] as const;
export const CATALYST_STYLES = ['crescent-staff', 'ash-wand', 'bare-hands'] as const;

export type LifeStage = (typeof LIFE_STAGES)[number];
export type BodyFrame = (typeof BODY_FRAMES)[number];
export type VeilStyle = (typeof VEIL_STYLES)[number];
export type RobeDye = (typeof ROBE_DYES)[number];
export type AstralMetal = (typeof ASTRAL_METALS)[number];
export type CatalystStyle = (typeof CATALYST_STYLES)[number];

export type CharacterProfile = {
  schemaVersion: typeof CHARACTER_PROFILE_SCHEMA_VERSION;
  name: string;
  lifeStage: LifeStage;
  frame: BodyFrame;
  veil: VeilStyle;
  robeDye: RobeDye;
  astralMetal: AstralMetal;
  catalyst: CatalystStyle;
};

export const DEFAULT_CHARACTER_PROFILE: Readonly<CharacterProfile> = Object.freeze({
  schemaVersion: CHARACTER_PROFILE_SCHEMA_VERSION,
  name: 'Unnamed Pilgrim',
  lifeStage: 'young',
  frame: 'slender',
  veil: 'deep-hood',
  robeDye: 'midnight',
  astralMetal: 'lunar-silver',
  catalyst: 'crescent-staff',
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isMember = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === 'string' && options.includes(value as T);

export function normalizeCharacterName(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_CHARACTER_PROFILE.name;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return normalized || DEFAULT_CHARACTER_PROFILE.name;
}

/**
 * Treat persisted profile data as untrusted. Unknown or future fields are ignored,
 * while every supported field falls back independently to a safe default.
 */
export function sanitizeCharacterProfile(value: unknown): CharacterProfile {
  const source = isRecord(value) ? value : {};
  return {
    schemaVersion: CHARACTER_PROFILE_SCHEMA_VERSION,
    name: normalizeCharacterName(source.name),
    lifeStage: isMember(source.lifeStage, LIFE_STAGES) ? source.lifeStage : DEFAULT_CHARACTER_PROFILE.lifeStage,
    frame: isMember(source.frame, BODY_FRAMES) ? source.frame : DEFAULT_CHARACTER_PROFILE.frame,
    veil: isMember(source.veil, VEIL_STYLES) ? source.veil : DEFAULT_CHARACTER_PROFILE.veil,
    robeDye: isMember(source.robeDye, ROBE_DYES) ? source.robeDye : DEFAULT_CHARACTER_PROFILE.robeDye,
    astralMetal: isMember(source.astralMetal, ASTRAL_METALS) ? source.astralMetal : DEFAULT_CHARACTER_PROFILE.astralMetal,
    catalyst: isMember(source.catalyst, CATALYST_STYLES) ? source.catalyst : DEFAULT_CHARACTER_PROFILE.catalyst,
  };
}

export function cloneCharacterProfile(profile: CharacterProfile): CharacterProfile {
  return { ...profile };
}
