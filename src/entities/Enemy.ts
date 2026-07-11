import * as THREE from 'three';
import type { AuthoredModel } from '../assets/GameModels';

export type EnemyKind = 'wisp' | 'sentinel' | 'seer' | 'boss';
export type EnemyAttackKind = 'melee' | 'projectile' | 'burst' | 'nova';

export type EnemyAttackEvent = {
  kind: EnemyAttackKind;
  source: Enemy;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  damage: number;
  radius: number;
  count: number;
};

type EnemyConfig = {
  id: number;
  kind: EnemyKind;
  position: THREE.Vector3;
  guardRelic?: number;
};

const MAX_HEALTH: Record<EnemyKind, number> = {
  wisp: 38,
  sentinel: 82,
  seer: 58,
  boss: 620,
};

const SPEED: Record<EnemyKind, number> = {
  wisp: 3.25,
  sentinel: 2.65,
  seer: 2.15,
  boss: 2.55,
};

const RADIUS: Record<EnemyKind, number> = {
  wisp: 0.55,
  sentinel: 0.72,
  seer: 0.66,
  boss: 1.38,
};

export class Enemy {
  readonly id: number;
  readonly kind: EnemyKind;
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  readonly spawnPosition = new THREE.Vector3();
  readonly guardRelic: number | null;
  readonly maxHealth: number;
  readonly radius: number;
  health: number;
  active = true;
  dormant = false;
  phase = 1;

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly accentMaterial: THREE.MeshStandardMaterial;
  private readonly telegraph: THREE.Mesh;
  private readonly healthFill: THREE.Mesh;
  private readonly tempDirection = new THREE.Vector3();
  private readonly attackPoint = new THREE.Vector3();
  private state: 'idle' | 'chase' | 'telegraph' | 'recover' | 'dead' = 'idle';
  private stateTimer = 0.4;
  private attackCooldown = 0.5;
  private attackIndex = 0;
  private hitFlash = 0;
  private authoredModel: AuthoredModel | null = null;

  constructor(config: EnemyConfig) {
    this.id = config.id;
    this.kind = config.kind;
    this.guardRelic = config.guardRelic ?? null;
    this.maxHealth = MAX_HEALTH[this.kind];
    this.health = this.maxHealth;
    this.radius = RADIUS[this.kind];
    this.group.position.copy(config.position);
    this.spawnPosition.copy(config.position);
    this.dormant = this.kind === 'boss';

    const palette = this.getPalette();
    this.bodyMaterial = this.material(new THREE.MeshStandardMaterial({
      color: palette.body,
      roughness: this.kind === 'wisp' ? 0.24 : 0.68,
      metalness: this.kind === 'sentinel' || this.kind === 'boss' ? 0.28 : 0.06,
      emissive: palette.emissive,
      emissiveIntensity: this.kind === 'wisp' ? 1.4 : 0.35,
    }));
    this.accentMaterial = this.material(new THREE.MeshStandardMaterial({
      color: palette.accent,
      roughness: 0.18,
      metalness: 0.2,
      emissive: palette.accent,
      emissiveIntensity: 1.55,
    }));
    this.buildModel();

    const telegraphMaterial = this.material(new THREE.MeshBasicMaterial({
      color: this.kind === 'boss' ? '#ff2c69' : '#ff6a72',
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    this.telegraph = new THREE.Mesh(this.geometry(new THREE.RingGeometry(0.72, 0.9, 40)), telegraphMaterial);
    this.telegraph.rotation.x = -Math.PI / 2;
    this.telegraph.position.y = 0.05;
    this.telegraph.visible = false;
    this.group.add(this.telegraph);

    const barBack = new THREE.Mesh(
      this.geometry(new THREE.PlaneGeometry(this.kind === 'boss' ? 2.4 : 1.15, 0.1)),
      this.material(new THREE.MeshBasicMaterial({ color: '#100a12', transparent: true, opacity: 0.82, depthTest: false })),
    );
    barBack.position.set(0, this.kind === 'boss' ? 3.6 : 2.05, 0);
    barBack.renderOrder = 4;
    this.group.add(barBack);
    this.healthFill = new THREE.Mesh(
      this.geometry(new THREE.PlaneGeometry(this.kind === 'boss' ? 2.32 : 1.08, 0.065)),
      this.material(new THREE.MeshBasicMaterial({ color: this.kind === 'boss' ? '#e44a82' : '#f46d75', depthTest: false })),
    );
    this.healthFill.position.set(0, barBack.position.y, 0.003);
    this.healthFill.renderOrder = 5;
    this.group.add(this.healthFill);
    if (this.kind === 'boss') this.group.visible = true;
  }

  get healthRatio(): number {
    return this.health / this.maxHealth;
  }

  useAuthoredModel(model: AuthoredModel): void {
    if (this.authoredModel) {
      this.authoredModel.root.removeFromParent();
      this.authoredModel.dispose();
    }
    const telegraphIndex = this.group.children.indexOf(this.telegraph);
    for (let index = 0; index < telegraphIndex; index += 1) this.group.children[index].visible = false;
    this.authoredModel = model;
    this.group.add(model.root);
  }

  awaken(): void {
    if (!this.active) return;
    this.dormant = false;
    this.state = 'idle';
    this.stateTimer = 1.4;
    this.attackCooldown = 1.8;
    this.accentMaterial.emissiveIntensity = 3.4;
  }

  update(delta: number, elapsed: number, target: THREE.Vector3, enabled: boolean, attacks: EnemyAttackEvent[]): void {
    this.updateVisuals(delta, elapsed);
    if (!this.active || this.dormant || !enabled) {
      this.velocity.multiplyScalar(Math.exp(-8 * delta));
      return;
    }

    if (this.kind === 'boss') {
      const nextPhase = this.healthRatio > 0.66 ? 1 : this.healthRatio > 0.33 ? 2 : 3;
      if (nextPhase !== this.phase) {
        this.phase = nextPhase;
        this.state = 'recover';
        this.stateTimer = 1.15;
        this.attackCooldown = 0.2;
        this.accentMaterial.emissiveIntensity = 4.2;
      }
    }

    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    this.stateTimer = Math.max(0, this.stateTimer - delta);
    this.tempDirection.copy(target).sub(this.group.position).setY(0);
    const distance = this.tempDirection.length();
    if (distance > 0.001) this.tempDirection.multiplyScalar(1 / distance);

    if (this.state === 'telegraph') {
      this.velocity.multiplyScalar(Math.exp(-12 * delta));
      if (this.stateTimer <= 0) this.executeAttack(attacks);
      return;
    }
    if (this.state === 'recover') {
      this.velocity.multiplyScalar(Math.exp(-8 * delta));
      if (this.stateTimer <= 0) this.state = 'chase';
      return;
    }

    const preferred = this.kind === 'wisp' ? 7.5 : this.kind === 'seer' ? 6.4 : this.kind === 'boss' ? 3.6 : 1.65;
    const detection = this.kind === 'boss' ? 40 : 13.5;
    if (distance > detection) {
      this.state = 'idle';
      this.velocity.multiplyScalar(Math.exp(-5 * delta));
      return;
    }

    this.state = 'chase';
    let movement = distance > preferred ? 1 : distance < preferred * 0.62 ? -0.45 : 0;
    if (this.kind === 'wisp' || this.kind === 'seer') {
      const strafe = Math.sin(elapsed * 1.8 + this.id) * 0.48;
      const x = this.tempDirection.x;
      this.tempDirection.x = x * movement - this.tempDirection.z * strafe;
      this.tempDirection.z = this.tempDirection.z * movement + x * strafe;
    } else {
      this.tempDirection.multiplyScalar(movement);
    }
    const targetSpeed = SPEED[this.kind] * (this.kind === 'boss' ? 1 + (this.phase - 1) * 0.12 : 1);
    this.velocity.lerp(this.tempDirection.multiplyScalar(targetSpeed), 1 - Math.exp(-delta * 7));
    this.group.position.addScaledVector(this.velocity, delta);
    if (this.velocity.lengthSq() > 0.03) this.group.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);

    if (this.attackCooldown <= 0 && this.canAttack(distance)) this.beginAttack(target);
  }

  takeDamage(amount: number): boolean {
    if (!this.active || this.dormant) return false;
    this.health = Math.max(0, this.health - Math.max(0, amount));
    this.hitFlash = 0.13;
    if (this.health <= 0) {
      this.active = false;
      this.state = 'dead';
      this.stateTimer = 0.6;
      this.telegraph.visible = false;
      this.velocity.set(0, 0, 0);
      this.group.visible = false;
      return true;
    }
    return false;
  }

  reset(): void {
    this.health = this.maxHealth;
    this.active = true;
    this.group.visible = true;
    this.group.position.copy(this.spawnPosition);
    this.velocity.set(0, 0, 0);
    this.state = 'idle';
    this.stateTimer = 0.4;
    this.attackCooldown = 0.8 + (this.id % 4) * 0.15;
    this.phase = 1;
    this.dormant = this.kind === 'boss';
  }

  dispose(): void {
    if (this.authoredModel) {
      this.authoredModel.root.removeFromParent();
      this.authoredModel.dispose();
      this.authoredModel = null;
    }
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }

  private beginAttack(target: THREE.Vector3): void {
    this.state = 'telegraph';
    this.attackPoint.copy(target);
    this.telegraph.visible = true;
    this.attackIndex += 1;
    if (this.kind === 'sentinel') this.stateTimer = 0.58;
    else if (this.kind === 'wisp') this.stateTimer = 0.72;
    else if (this.kind === 'seer') this.stateTimer = 0.92;
    else this.stateTimer = this.phase === 3 ? 1.05 : 0.82;
  }

  private executeAttack(attacks: EnemyAttackEvent[]): void {
    this.telegraph.visible = false;
    this.state = 'recover';
    this.stateTimer = this.kind === 'boss' ? 0.52 : 0.42;
    let kind: EnemyAttackKind = 'melee';
    let damage = 18;
    let radius = 2.25;
    let count = 1;
    let position = this.group.position;
    if (this.kind === 'wisp') {
      kind = 'projectile';
      damage = 13;
      radius = 0.22;
      this.attackCooldown = 2.25;
    } else if (this.kind === 'seer') {
      kind = 'burst';
      damage = 20;
      radius = 2.1;
      position = this.attackPoint;
      this.attackCooldown = 2.8;
    } else if (this.kind === 'sentinel') {
      this.attackCooldown = 1.75;
    } else {
      const pattern = this.attackIndex % (this.phase + 2);
      damage = 24 + this.phase * 3;
      if (this.phase >= 2 && pattern === 0) {
        kind = 'nova';
        radius = 0.3;
        count = this.phase === 2 ? 8 : 12;
      } else if (this.phase === 3 && pattern === 1) {
        kind = 'burst';
        radius = 4.5;
        position = this.attackPoint;
      } else if (pattern % 2 === 0) {
        kind = 'projectile';
        radius = 0.35;
        count = this.phase;
      } else {
        radius = 3.25 + this.phase * 0.35;
      }
      this.attackCooldown = Math.max(0.82, 1.7 - this.phase * 0.2);
    }
    const direction = this.tempDirection.clone();
    attacks.push({ kind, source: this, position: position.clone(), direction, damage, radius, count });
  }

  private canAttack(distance: number): boolean {
    if (this.kind === 'sentinel') return distance <= 2.25;
    if (this.kind === 'boss' && this.attackIndex % 3 === 1) return distance <= 4.8;
    return distance <= 11.5;
  }

  private updateVisuals(delta: number, elapsed: number): void {
    this.authoredModel?.update(delta, elapsed, this.kind === 'boss' ? this.phase : this.state === 'telegraph' ? 1.5 : 1);
    this.hitFlash = Math.max(0, this.hitFlash - delta);
    this.bodyMaterial.emissiveIntensity = this.hitFlash > 0 ? 3.6 : this.kind === 'wisp' ? 1.4 : 0.35;
    if (this.hitFlash > 0) this.bodyMaterial.emissive.set('#ffced2');
    else this.bodyMaterial.emissive.set(this.getPalette().emissive);
    const ratio = Math.max(0.001, this.healthRatio);
    this.healthFill.scale.x = ratio;
    this.healthFill.position.x = -(1 - ratio) * (this.kind === 'boss' ? 1.16 : 0.54);
    this.telegraph.rotation.z += delta * (this.kind === 'boss' ? 2.3 : 1.4);
    if (this.telegraph.visible) {
      const targetScale = this.kind === 'boss' ? 3.8 + this.phase * 0.45 : this.kind === 'seer' ? 2.4 : 1.45;
      this.telegraph.scale.setScalar(targetScale * (1 + Math.sin(elapsed * 13) * 0.06));
      (this.telegraph.material as THREE.MeshBasicMaterial).opacity = 0.48 + Math.sin(elapsed * 18) * 0.22;
    }
    if (this.kind === 'wisp') this.group.position.y = 0.55 + Math.sin(elapsed * 3.1 + this.id) * 0.18;
    if (this.kind === 'boss') {
      this.group.children[0]?.rotateY(delta * (0.4 + this.phase * 0.2));
      this.accentMaterial.emissiveIntensity = THREE.MathUtils.damp(this.accentMaterial.emissiveIntensity, 1.5 + this.phase * 0.65, 2.5, delta);
    }
  }

  private buildModel(): void {
    if (this.kind === 'wisp') {
      const core = new THREE.Mesh(this.geometry(new THREE.IcosahedronGeometry(0.42, 1)), this.bodyMaterial);
      const halo = new THREE.Mesh(this.geometry(new THREE.TorusGeometry(0.66, 0.035, 8, 28)), this.accentMaterial);
      halo.rotation.x = Math.PI / 2;
      core.castShadow = true;
      this.group.add(core, halo);
      return;
    }

    const scale = this.kind === 'boss' ? 1.62 : 1;
    const body = new THREE.Mesh(this.geometry(new THREE.CapsuleGeometry(0.42 * scale, 0.72 * scale, 5, 10)), this.bodyMaterial);
    body.position.y = 0.82 * scale;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);

    const head = new THREE.Mesh(this.geometry(new THREE.OctahedronGeometry(0.32 * scale, 0)), this.accentMaterial);
    head.position.y = 1.7 * scale;
    head.castShadow = true;
    this.group.add(head);

    if (this.kind === 'sentinel') {
      const shield = new THREE.Mesh(this.geometry(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 8)), this.bodyMaterial);
      shield.rotation.z = Math.PI / 2;
      shield.position.set(-0.56, 0.85, -0.08);
      shield.castShadow = true;
      this.group.add(shield);
    }
    if (this.kind === 'seer') {
      const crown = new THREE.Mesh(this.geometry(new THREE.TorusGeometry(0.42, 0.055, 6, 18)), this.accentMaterial);
      crown.position.y = 2.12;
      crown.rotation.x = Math.PI / 2;
      this.group.add(crown);
    }
    if (this.kind === 'boss') {
      for (let i = 0; i < 3; i += 1) {
        const orbit = new THREE.Mesh(this.geometry(new THREE.TorusGeometry(1.0 + i * 0.28, 0.055, 8, 32)), this.accentMaterial);
        orbit.position.y = 1.65;
        orbit.rotation.set(i * 0.72, i * 0.48, i * 0.9);
        this.group.add(orbit);
      }
      const mantle = new THREE.Mesh(this.geometry(new THREE.ConeGeometry(1.22, 2.2, 9, 1, true)), this.bodyMaterial);
      mantle.position.y = 1.05;
      mantle.castShadow = true;
      this.group.add(mantle);
    }
  }

  private getPalette(): { body: THREE.ColorRepresentation; accent: THREE.ColorRepresentation; emissive: THREE.ColorRepresentation } {
    if (this.kind === 'wisp') return { body: '#6caec7', accent: '#c9f5ff', emissive: '#17657e' };
    if (this.kind === 'sentinel') return { body: '#48515e', accent: '#ff9568', emissive: '#281017' };
    if (this.kind === 'seer') return { body: '#522f61', accent: '#f0a2ff', emissive: '#270d38' };
    return { body: '#17111f', accent: '#e64a88', emissive: '#35051c' };
  }

  private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private material<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }
}
