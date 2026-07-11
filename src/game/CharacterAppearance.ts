import type * as THREE from 'three';
import type { SorcererAppearanceOptions } from '../assets/GameModels';
import type { CharacterProfile } from './CharacterProfile';

export type CharacterAppearanceMetadata = {
  readonly robeColors: Readonly<Record<CharacterProfile['robeDye'], THREE.ColorRepresentation>>;
  readonly metalColors: Readonly<Record<CharacterProfile['astralMetal'], THREE.ColorRepresentation>>;
};

export const CHARACTER_APPEARANCE: CharacterAppearanceMetadata = {
  robeColors: {
    midnight: '#8497ca',
    ash: '#c4c4c1',
    moss: '#88a790',
    oxblood: '#b77c83',
  },
  metalColors: {
    'lunar-silver': '#b8cef2',
    'aurora-bronze': '#70d5ad',
    'celestial-gold': '#d6bd79',
  },
};

export function appearanceFromProfile(profile: CharacterProfile): SorcererAppearanceOptions {
  return {
    lifeStage: profile.lifeStage,
    frame: profile.frame === 'sturdy' ? 'broad' : 'slender',
    veil: profile.veil === 'deep-hood' ? 'hood' : profile.veil === 'moon-mask' ? 'starVeil' : 'unveiled',
    robeColor: CHARACTER_APPEARANCE.robeColors[profile.robeDye],
    metalColor: CHARACTER_APPEARANCE.metalColors[profile.astralMetal],
    catalyst: profile.catalyst === 'crescent-staff' ? 'crescent' : profile.catalyst === 'ash-wand' ? 'orb' : 'bare',
  };
}

export function appearanceSignature(profile: CharacterProfile): string {
  return [
    profile.lifeStage,
    profile.frame,
    profile.veil,
    profile.robeDye,
    profile.astralMetal,
    profile.catalyst,
  ].join('|');
}
