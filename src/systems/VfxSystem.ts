import * as THREE from 'three';
import type { MaterialRole } from '../assets/MaterialLibrary';
import { MaterialLibrary } from '../assets/MaterialLibrary';

export type VfxEventType = 'cast' | 'hit' | 'dodge' | 'death' | 'restoration';

export type VfxEvent = {
  type: VfxEventType;
  position: THREE.Vector3;
  direction?: THREE.Vector3;
  intensity?: number;
};

export type VfxPoolStats = Record<VfxEventType, { active: number; capacity: number }>;

type EffectParts = {
  core?: THREE.Object3D;
  rings: THREE.Object3D[];
  shards: THREE.Object3D[];
  streaks: THREE.Object3D[];
};

type PooledEffect = {
  type: VfxEventType;
  root: THREE.Group;
  parts: EffectParts;
  age: number;
  duration: number;
  intensity: number;
  velocity: THREE.Vector3;
  active: boolean;
};

const POOL_CAPACITY: Record<VfxEventType, number> = {
  cast: 10,
  hit: 12,
  dodge: 8,
  death: 5,
  restoration: 6,
};

const EFFECT_DURATION: Record<VfxEventType, number> = {
  cast: 0.48,
  hit: 0.34,
  dodge: 0.42,
  death: 1.15,
  restoration: 1.55,
};

export class VfxSystem {
  readonly root = new THREE.Group();

  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();
  private readonly pools: Record<VfxEventType, PooledEffect[]> = {
    cast: [],
    hit: [],
    dodge: [],
    death: [],
    restoration: [],
  };
  private readonly cursors: Record<VfxEventType, number> = {
    cast: 0,
    hit: 0,
    dodge: 0,
    death: 0,
    restoration: 0,
  };
  private readonly ringGeometry = this.track(new THREE.RingGeometry(0.56, 0.7, 32));
  private readonly torusGeometry = this.track(new THREE.TorusGeometry(0.58, 0.045, 7, 28));
  private readonly coreGeometry = this.track(new THREE.IcosahedronGeometry(0.22, 1));
  private readonly shardGeometry = this.track(new THREE.TetrahedronGeometry(0.105, 0));
  private readonly streakGeometry = this.track(new THREE.PlaneGeometry(0.12, 1.15));
  private readonly materials: Record<VfxEventType, THREE.MeshBasicMaterial>;
  private disposed = false;

  constructor(materialLibrary?: MaterialLibrary) {
    this.root.name = 'vfxSystem';
    this.root.matrixAutoUpdate = true;
    this.materials = {
      cast: this.createMaterial('vfx.cast', this.readColor(materialLibrary, 'spirit', '#69fff0'), 0.82),
      hit: this.createMaterial('vfx.hit', this.readColor(materialLibrary, 'danger', '#ff315f'), 0.9),
      dodge: this.createMaterial('vfx.dodge', this.readColor(materialLibrary, 'lunarSilver', '#d9f4ff'), 0.62),
      death: this.createMaterial('vfx.death', this.readColor(materialLibrary, 'void', '#9b55ff'), 0.8),
      restoration: this.createMaterial('vfx.restoration', this.readColor(materialLibrary, 'celestialGold', '#ffd675'), 0.78),
    };

    (Object.keys(POOL_CAPACITY) as VfxEventType[]).forEach((type) => {
      for (let slot = 0; slot < POOL_CAPACITY[type]; slot += 1) {
        const effect = this.createEffect(type, slot);
        this.pools[type].push(effect);
        this.root.add(effect.root);
      }
    });
  }

  emit(event: VfxEvent): void {
    const direction = event.direction ?? this.defaultDirection(event.type);
    const intensity = THREE.MathUtils.clamp(event.intensity ?? 1, 0.2, 3);
    const pool = this.pools[event.type];
    const index = this.cursors[event.type];
    this.cursors[event.type] = (index + 1) % pool.length;
    const effect = pool[index];
    effect.age = 0;
    effect.duration = EFFECT_DURATION[event.type] * THREE.MathUtils.lerp(0.9, 1.2, Math.min(1, intensity / 2));
    effect.intensity = intensity;
    effect.active = true;
    effect.root.visible = true;
    effect.root.position.copy(event.position);
    effect.root.scale.setScalar(0.001);
    effect.root.rotation.set(0, 0, 0);
    effect.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.clone().normalize());
    effect.velocity.copy(direction).normalize().multiplyScalar(event.type === 'cast' ? 3.2 * intensity : 0);
    this.resetParts(effect);
  }

  emitCast(position: THREE.Vector3, direction: THREE.Vector3, intensity = 1): void {
    this.emit({ type: 'cast', position, direction, intensity });
  }

  emitHit(position: THREE.Vector3, normal = new THREE.Vector3(0, 1, 0), intensity = 1): void {
    this.emit({ type: 'hit', position, direction: normal, intensity });
  }

  emitDodge(position: THREE.Vector3, direction: THREE.Vector3, intensity = 1): void {
    this.emit({ type: 'dodge', position, direction, intensity });
  }

  emitDeath(position: THREE.Vector3, intensity = 1): void {
    this.emit({ type: 'death', position, direction: new THREE.Vector3(0, 1, 0), intensity });
  }

  emitCelestialRestoration(position: THREE.Vector3, intensity = 1): void {
    this.emit({ type: 'restoration', position, direction: new THREE.Vector3(0, 1, 0), intensity });
  }

  update(delta: number, elapsed: number): void {
    (Object.keys(this.pools) as VfxEventType[]).forEach((type) => {
      this.pools[type].forEach((effect) => {
        if (!effect.active) return;
        effect.age += delta;
        const progress = THREE.MathUtils.clamp(effect.age / effect.duration, 0, 1);
        this.updateEffect(effect, progress, delta, elapsed);
        if (progress >= 1) this.deactivate(effect);
      });
    });
  }

  getStats(): VfxPoolStats {
    return {
      cast: this.poolStat('cast'),
      hit: this.poolStat('hit'),
      dodge: this.poolStat('dodge'),
      death: this.poolStat('death'),
      restoration: this.poolStat('restoration'),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geometries.forEach((geometry) => geometry.dispose());
    this.ownedMaterials.forEach((material) => material.dispose());
    this.root.clear();
  }

  private track<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  private createMaterial(name: string, color: THREE.ColorRepresentation, opacity: number): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      name,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    material.forceSinglePass = true;
    this.ownedMaterials.add(material);
    return material;
  }

  private readColor(
    library: MaterialLibrary | undefined,
    role: MaterialRole,
    fallback: THREE.ColorRepresentation,
  ): THREE.ColorRepresentation {
    if (!library) return fallback;
    const material = library.get(role) as THREE.Material & { color?: THREE.Color };
    return material.color?.clone() ?? fallback;
  }

  private createEffect(type: VfxEventType, slot: number): PooledEffect {
    const root = new THREE.Group();
    root.name = `vfx.${type}.${slot}`;
    root.visible = false;
    const parts: EffectParts = { rings: [], shards: [], streaks: [] };
    const material = this.materials[type];

    if (type === 'cast' || type === 'death') {
      const core = new THREE.Mesh(this.coreGeometry, material);
      core.name = 'effectCore';
      root.add(core);
      parts.core = core;
    }

    const ringCount = type === 'restoration' ? 3 : type === 'dodge' ? 2 : 1;
    for (let i = 0; i < ringCount; i += 1) {
      const ring = new THREE.Mesh(type === 'dodge' ? this.torusGeometry : this.ringGeometry, material);
      ring.name = `effectRing.${i}`;
      ring.position.z = i * 0.08;
      if (type === 'restoration') {
        ring.rotation.x = Math.PI / 2;
        ring.position.y = i * 0.35;
      }
      root.add(ring);
      parts.rings.push(ring);
    }

    const shardCount = type === 'death' ? 11 : type === 'hit' ? 7 : type === 'restoration' ? 8 : type === 'cast' ? 5 : 0;
    for (let i = 0; i < shardCount; i += 1) {
      const shard = new THREE.Mesh(this.shardGeometry, material);
      shard.name = `effectShard.${i}`;
      const angle = (i / Math.max(1, shardCount)) * Math.PI * 2 + slot * 0.37;
      const y = type === 'restoration' ? 0.35 + (i % 3) * 0.28 : Math.sin(i * 2.17) * 0.32;
      shard.userData.direction = new THREE.Vector3(Math.cos(angle), y, Math.sin(angle)).normalize();
      root.add(shard);
      parts.shards.push(shard);
    }

    const streakCount = type === 'dodge' ? 5 : type === 'restoration' ? 4 : 0;
    for (let i = 0; i < streakCount; i += 1) {
      const streak = new THREE.Mesh(this.streakGeometry, material);
      streak.name = `effectStreak.${i}`;
      streak.position.x = (i - (streakCount - 1) * 0.5) * 0.22;
      streak.rotation.x = type === 'restoration' ? 0 : Math.PI / 2;
      root.add(streak);
      parts.streaks.push(streak);
    }

    return {
      type,
      root,
      parts,
      age: 0,
      duration: EFFECT_DURATION[type],
      intensity: 1,
      velocity: new THREE.Vector3(),
      active: false,
    };
  }

  private resetParts(effect: PooledEffect): void {
    if (effect.parts.core) {
      effect.parts.core.position.set(0, 0, 0);
      effect.parts.core.rotation.set(0, 0, 0);
      effect.parts.core.scale.setScalar(1);
    }
    effect.parts.rings.forEach((ring, index) => {
      ring.position.set(0, effect.type === 'restoration' ? index * 0.35 : 0, index * 0.08);
      ring.scale.setScalar(1);
    });
    effect.parts.shards.forEach((shard) => {
      shard.position.set(0, 0, 0);
      shard.rotation.set(0, 0, 0);
      shard.scale.setScalar(1);
    });
    effect.parts.streaks.forEach((streak, index) => {
      streak.position.set((index - (effect.parts.streaks.length - 1) * 0.5) * 0.22, 0, 0);
      streak.scale.setScalar(1);
    });
  }

  private updateEffect(effect: PooledEffect, progress: number, delta: number, elapsed: number): void {
    const easeOut = 1 - (1 - progress) ** 3;
    const fadeScale = Math.max(0.001, Math.sin(progress * Math.PI));
    effect.root.position.addScaledVector(effect.velocity, delta);

    switch (effect.type) {
      case 'cast': {
        effect.root.scale.setScalar((0.45 + easeOut * 1.25) * effect.intensity * fadeScale);
        if (effect.parts.core) effect.parts.core.rotation.set(elapsed * 4, elapsed * 6, elapsed * 3);
        effect.parts.rings[0].rotation.z = elapsed * 7;
        effect.parts.shards.forEach((shard, index) => {
          const direction = shard.userData.direction as THREE.Vector3;
          shard.position.copy(direction).multiplyScalar(easeOut * 0.75);
          shard.rotation.y = elapsed * (5 + index);
        });
        break;
      }
      case 'hit': {
        effect.root.scale.setScalar((0.25 + easeOut * 1.8) * effect.intensity * Math.max(0.16, 1 - progress));
        effect.parts.rings[0].rotation.z = progress * Math.PI * 1.5;
        effect.parts.shards.forEach((shard, index) => {
          const direction = shard.userData.direction as THREE.Vector3;
          shard.position.copy(direction).multiplyScalar(easeOut * 1.15 * effect.intensity);
          shard.rotation.set(elapsed * (4 + index), elapsed * 3, 0);
        });
        break;
      }
      case 'dodge': {
        effect.root.scale.setScalar(effect.intensity * Math.max(0.001, 1 - progress * 0.72));
        effect.parts.rings.forEach((ring, index) => {
          ring.position.z = -easeOut * (0.5 + index * 0.38);
          ring.scale.setScalar(0.72 + progress * (1.35 + index * 0.25));
          ring.rotation.z = (index === 0 ? 1 : -1) * elapsed * 5;
        });
        effect.parts.streaks.forEach((streak, index) => {
          streak.position.z = -easeOut * (0.8 + index * 0.22);
          streak.scale.y = 0.45 + (1 - progress) * 1.8;
          streak.scale.x = Math.max(0.05, 1 - progress);
        });
        break;
      }
      case 'death': {
        effect.root.scale.setScalar(effect.intensity);
        if (effect.parts.core) {
          effect.parts.core.scale.setScalar(Math.max(0.001, 1.4 - progress * 1.35));
          effect.parts.core.rotation.y = elapsed * 5;
        }
        effect.parts.rings[0].scale.setScalar(0.4 + easeOut * 3.2);
        effect.parts.rings[0].rotation.z = elapsed * 1.7;
        effect.parts.shards.forEach((shard, index) => {
          const direction = shard.userData.direction as THREE.Vector3;
          shard.position.copy(direction).multiplyScalar(easeOut * (1.3 + (index % 4) * 0.38));
          shard.position.y -= progress * progress * 0.8;
          shard.scale.setScalar(Math.max(0.001, 1 - progress * 0.72));
          shard.rotation.set(elapsed * (2 + index * 0.2), elapsed * (3 + index * 0.3), 0);
        });
        break;
      }
      case 'restoration': {
        effect.root.scale.setScalar(effect.intensity * Math.max(0.001, fadeScale));
        effect.parts.rings.forEach((ring, index) => {
          ring.position.y = easeOut * (0.7 + index * 0.75);
          ring.scale.setScalar(0.55 + easeOut * (1.2 + index * 0.28));
          ring.rotation.z = elapsed * (index % 2 === 0 ? 0.8 : -0.65);
        });
        effect.parts.shards.forEach((shard, index) => {
          const direction = shard.userData.direction as THREE.Vector3;
          shard.position.copy(direction).multiplyScalar(0.35 + easeOut * 1.25);
          shard.position.y += easeOut * (1 + (index % 3) * 0.42);
          shard.rotation.y = elapsed * (1.8 + index * 0.2);
        });
        effect.parts.streaks.forEach((streak, index) => {
          streak.position.y = easeOut * (0.6 + index * 0.5);
          streak.scale.y = 0.8 + (1 - progress) * 2.4;
          streak.scale.x = Math.max(0.08, 1 - progress * 0.82);
        });
        break;
      }
    }
  }

  private deactivate(effect: PooledEffect): void {
    effect.active = false;
    effect.root.visible = false;
    effect.velocity.set(0, 0, 0);
  }

  private defaultDirection(type: VfxEventType): THREE.Vector3 {
    return type === 'cast' || type === 'dodge' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  }

  private poolStat(type: VfxEventType): { active: number; capacity: number } {
    const pool = this.pools[type];
    return { active: pool.filter((effect) => effect.active).length, capacity: pool.length };
  }
}
