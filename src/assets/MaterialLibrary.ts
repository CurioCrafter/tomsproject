import * as THREE from 'three';
import type { RouteBiomeId } from '../game/content/RouteTypes';
import {
  createProceduralTextures,
  disposeProceduralTextures,
  setProceduralTextureAnisotropy,
  type ProceduralTextureSet,
} from './ProceduralTextures';

export type MaterialRole =
  | 'blackSlate'
  | 'slateEdge'
  | 'snowCrust'
  | 'obsidian'
  | 'robe'
  | 'leather'
  | 'celestialGold'
  | 'lunarSilver'
  | 'aurora'
  | 'void'
  | 'danger'
  | 'spirit'
  | 'moonstone'
  | 'glass'
  | 'runeLight'
  | 'contactShadow';

export type MaterialRoles = Record<MaterialRole, THREE.Material>;

export type MaterialLibraryOptions = {
  textures?: ProceduralTextureSet;
  ownsTextures?: boolean;
  anisotropy?: number;
};

export class MaterialLibrary {
  readonly textures: ProceduralTextureSet;
  readonly roles: MaterialRoles;
  readonly biomeFloors: Readonly<Record<RouteBiomeId, THREE.MeshStandardMaterial>>;
  private readonly ownsTextures: boolean;
  private readonly generatedTextures = new Set<THREE.Texture>();
  private disposed = false;

  constructor(options: MaterialLibraryOptions = {}) {
    this.textures = options.textures ?? createProceduralTextures();
    this.ownsTextures = options.ownsTextures ?? !options.textures;
    if (options.anisotropy) setProceduralTextureAnisotropy(this.textures, options.anisotropy);
    const celestialBlackstone = this.loadGeneratedTexture(
      '/assets/textures/celestial-blackstone.webp',
      'generatedCelestialBlackstone',
      4,
    );
    const midnightStarweave = this.loadGeneratedTexture(
      '/assets/textures/midnight-starweave.webp',
      'generatedMidnightStarweave',
      2.5,
    );
    const drownedStone = this.loadGeneratedTexture('/assets/textures/drowned-cloister-stone.webp', 'generatedDrownedCloisterStone', 3);
    const verdantStone = this.loadGeneratedTexture('/assets/textures/verdant-cathedral-stone.webp', 'generatedVerdantCathedralStone', 3);
    const emberStone = this.loadGeneratedTexture('/assets/textures/ember-basilica-stone.webp', 'generatedEmberBasilicaStone', 3);
    const amethystStone = this.loadGeneratedTexture('/assets/textures/amethyst-archive-stone.webp', 'generatedAmethystArchiveStone', 3);

    this.roles = {
      blackSlate: new THREE.MeshStandardMaterial({
        name: 'material.blackSlate',
        color: '#aeb8bb',
        map: celestialBlackstone,
        roughness: 0.92,
        metalness: 0.04,
      }),
      slateEdge: new THREE.MeshStandardMaterial({
        name: 'material.slateEdge',
        color: '#536872',
        roughness: 0.68,
        metalness: 0.16,
      }),
      snowCrust: new THREE.MeshStandardMaterial({
        name: 'material.snowCrust',
        color: '#d6e6e8',
        map: this.textures.frost,
        roughness: 0.94,
        metalness: 0,
      }),
      obsidian: new THREE.MeshPhysicalMaterial({
        name: 'material.obsidian',
        color: '#090b12',
        roughness: 0.22,
        metalness: 0.54,
        clearcoat: 0.55,
        clearcoatRoughness: 0.28,
      }),
      robe: new THREE.MeshStandardMaterial({
        name: 'material.robe',
        color: '#a9b8dd',
        map: midnightStarweave,
        emissive: '#15213f',
        emissiveMap: midnightStarweave,
        emissiveIntensity: 0.24,
        roughness: 0.82,
        metalness: 0,
      }),
      leather: new THREE.MeshStandardMaterial({
        name: 'material.leather',
        color: '#392f2e',
        roughness: 0.78,
        metalness: 0.02,
      }),
      celestialGold: new THREE.MeshStandardMaterial({
        name: 'material.celestialGold',
        color: '#d7a44b',
        emissive: '#4e2c08',
        emissiveIntensity: 0.18,
        roughness: 0.3,
        metalness: 0.82,
      }),
      lunarSilver: new THREE.MeshStandardMaterial({
        name: 'material.lunarSilver',
        color: '#aebbc8',
        roughness: 0.28,
        metalness: 0.88,
      }),
      aurora: new THREE.MeshBasicMaterial({
        name: 'material.aurora',
        color: '#81f4dc',
        map: this.textures.aurora,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
      void: new THREE.MeshStandardMaterial({
        name: 'material.void',
        color: '#120c1f',
        emissive: '#261044',
        emissiveIntensity: 0.32,
        roughness: 0.48,
        metalness: 0.18,
      }),
      danger: new THREE.MeshStandardMaterial({
        name: 'material.danger',
        color: '#991e38',
        emissive: '#5c071a',
        emissiveIntensity: 0.72,
        roughness: 0.4,
        metalness: 0.18,
      }),
      spirit: new THREE.MeshStandardMaterial({
        name: 'material.spirit',
        color: '#63d7d4',
        emissive: '#166b74',
        emissiveIntensity: 0.9,
        roughness: 0.24,
        metalness: 0.08,
      }),
      moonstone: new THREE.MeshPhysicalMaterial({
        name: 'material.moonstone',
        color: '#b7d8ec',
        emissive: '#376fa7',
        emissiveIntensity: 0.82,
        roughness: 0.12,
        metalness: 0.06,
        clearcoat: 0.75,
      }),
      glass: new THREE.MeshPhysicalMaterial({
        name: 'material.glass',
        color: '#7898b5',
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        roughness: 0.08,
        metalness: 0.05,
        side: THREE.DoubleSide,
      }),
      runeLight: new THREE.MeshBasicMaterial({
        name: 'material.runeLight',
        color: '#baffff',
        map: this.textures.runes,
        transparent: true,
        alphaTest: 0.08,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
      contactShadow: new THREE.MeshBasicMaterial({
        name: 'material.contactShadow',
        color: '#020407',
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
    };

    this.roles.aurora.forceSinglePass = true;
    this.roles.glass.forceSinglePass = true;
    this.roles.runeLight.forceSinglePass = true;
    this.biomeFloors = Object.freeze({
      'moonless-tundra': this.roles.blackSlate as THREE.MeshStandardMaterial,
      'drowned-cloister': new THREE.MeshStandardMaterial({
        name: 'material.drownedCloisterStone', color: '#799aaa', map: drownedStone, roughness: 0.9, metalness: 0.09,
      }),
      'verdant-cathedral': new THREE.MeshStandardMaterial({
        name: 'material.verdantCathedralStone', color: '#78a987', map: verdantStone, roughness: 0.88, metalness: 0.06,
      }),
      'ember-basilica': new THREE.MeshStandardMaterial({
        name: 'material.emberBasilicaStone', color: '#a57663', map: emberStone, roughness: 0.86, metalness: 0.11,
      }),
      'amethyst-archives': new THREE.MeshStandardMaterial({
        name: 'material.amethystArchiveStone', color: '#9a82bd', map: amethystStone, roughness: 0.78, metalness: 0.16,
      }),
    });
  }

  get<T extends THREE.Material = THREE.Material>(role: MaterialRole): T {
    return this.roles[role] as T;
  }

  getBiomeFloor(biome: RouteBiomeId = 'moonless-tundra'): THREE.MeshStandardMaterial {
    return this.biomeFloors[biome];
  }

  setAnisotropy(anisotropy: number): void {
    setProceduralTextureAnisotropy(this.textures, anisotropy);
    const value = Math.max(1, Math.floor(anisotropy));
    this.generatedTextures.forEach((texture) => {
      texture.anisotropy = value;
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    new Set([...Object.values(this.roles), ...Object.values(this.biomeFloors)]).forEach((material) => material.dispose());
    this.generatedTextures.forEach((texture) => texture.dispose());
    if (this.ownsTextures) disposeProceduralTextures(this.textures);
  }

  private loadGeneratedTexture(url: string, name: string, repeat: number): THREE.Texture {
    const texture = new THREE.TextureLoader().load(url);
    texture.name = name;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    this.generatedTextures.add(texture);
    return texture;
  }
}
