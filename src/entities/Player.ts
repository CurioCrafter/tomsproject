import * as THREE from 'three';
import type { AuthoredModel } from '../assets/GameModels';
import type { InputController } from '../core/InputController';
import type { BuildModifiers } from '../game/progression/ProgressionTypes';

export type PlayerTuning = {
  speed: number;
  dashMultiplier: number;
  acceleration: number;
};

export type ArenaBounds = {
  halfWidth: number;
  halfDepth: number;
};

export type SpellComprehension = 'Novice' | 'Apprentice' | 'Mage' | 'Seer' | 'Warlock' | 'Ancient' | 'Celestial';

export type PlayerEquipment = {
  catalyst: string;
  melee: string;
  armor: string;
};

export class Player {
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  readonly facing = new THREE.Vector3(0, 0, -1);
  readonly radius = 0.52;
  readonly equipment: PlayerEquipment = {
    catalyst: 'Moon-etched ash staff',
    melee: 'Meteor-iron arming sword',
    armor: 'Aurora pilgrim robes',
  };
  readonly charms = new Set<string>(['Initiate\'s lunar medallion']);

  health = 120;
  stamina = 100;
  focus = 100;
  dead = false;

  private readonly move = new THREE.Vector2();
  private readonly targetVelocity = new THREE.Vector3();
  private readonly dodgeDirection = new THREE.Vector3();
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({
    color: '#b7c6d8',
    roughness: 0.72,
    metalness: 0.04,
  });
  private readonly cloakMaterial = new THREE.MeshStandardMaterial({
    color: '#173450',
    roughness: 0.82,
    metalness: 0.02,
    emissive: '#071426',
    emissiveIntensity: 0.5,
  });
  private readonly magicMaterial = new THREE.MeshStandardMaterial({
    color: '#a6fff2',
    roughness: 0.2,
    metalness: 0.12,
    emissive: '#1b8d88',
    emissiveIntensity: 1.4,
  });
  private readonly swordPivot = new THREE.Group();
  private readonly staffPivot = new THREE.Group();
  private readonly lockRing: THREE.Mesh;
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private meleeCooldown = 0;
  private readonly abilityCooldowns: [number, number, number] = [0, 0, 0];
  private attackAnimation = 0;
  private castAnimation = 0;
  private dodgeTimer = 0;
  private invulnerabilityTimer = 0;
  private staminaDelay = 0;
  private damageFlash = 0;
  private focusRegenMultiplier = 1;
  private maximumHealth = 120;
  private maximumStamina = 100;
  private maximumFocus = 100;
  private moveSpeedMultiplier = 1;
  private meleePowerMultiplier = 1;
  private spellPowerMultiplier = 1;
  private cooldownRate = 0;
  private damageReduction = 0;
  private healingMultiplier = 1;
  private groundHeight = 0;
  private authoredModel: AuthoredModel | null = null;

  constructor() {
    const cloakGeometry = this.own(new THREE.ConeGeometry(0.48, 1.12, 9));
    const cloak = new THREE.Mesh(cloakGeometry, this.cloakMaterial);
    cloak.position.y = 0.62;
    cloak.castShadow = true;
    cloak.receiveShadow = true;
    this.group.add(cloak);

    const headGeometry = this.own(new THREE.SphereGeometry(0.25, 14, 10));
    const head = new THREE.Mesh(headGeometry, this.bodyMaterial);
    head.position.y = 1.3;
    head.scale.y = 1.08;
    head.castShadow = true;
    this.group.add(head);

    const hoodGeometry = this.own(new THREE.ConeGeometry(0.32, 0.62, 9));
    const hood = new THREE.Mesh(hoodGeometry, this.cloakMaterial);
    hood.position.set(0, 1.58, 0.03);
    hood.rotation.x = -0.08;
    hood.castShadow = true;
    this.group.add(hood);

    const staffGeometry = this.own(new THREE.CylinderGeometry(0.035, 0.045, 1.65, 8));
    const staff = new THREE.Mesh(staffGeometry, new THREE.MeshStandardMaterial({ color: '#332826', roughness: 0.9 }));
    staff.position.y = 0.82;
    staff.rotation.z = -0.08;
    staff.castShadow = true;
    const focusGeometry = this.own(new THREE.OctahedronGeometry(0.13, 0));
    const focus = new THREE.Mesh(focusGeometry, this.magicMaterial);
    focus.position.y = 1.7;
    this.staffPivot.position.set(-0.46, 0.1, 0);
    this.staffPivot.add(staff, focus);
    this.group.add(this.staffPivot);

    const swordGeometry = this.own(new THREE.BoxGeometry(0.09, 0.82, 0.045));
    const sword = new THREE.Mesh(swordGeometry, new THREE.MeshStandardMaterial({ color: '#d9ecf2', metalness: 0.78, roughness: 0.24 }));
    sword.position.y = 0.46;
    sword.castShadow = true;
    this.swordPivot.position.set(0.44, 0.72, -0.12);
    this.swordPivot.rotation.set(0.35, 0, -2.45);
    this.swordPivot.add(sword);
    this.group.add(this.swordPivot);

    const lockGeometry = this.own(new THREE.RingGeometry(0.65, 0.69, 32));
    this.lockRing = new THREE.Mesh(lockGeometry, new THREE.MeshBasicMaterial({ color: '#9ce9ff', transparent: true, opacity: 0.7, depthWrite: false }));
    this.lockRing.rotation.x = -Math.PI / 2;
    this.lockRing.position.y = 0.035;
    this.lockRing.visible = false;
    this.group.add(this.lockRing);
  }

  get isInvulnerable(): boolean {
    return this.invulnerabilityTimer > 0;
  }

  get isDodging(): boolean {
    return this.dodgeTimer > 0;
  }

  get maxHealth(): number {
    return this.maximumHealth;
  }

  get maxStamina(): number {
    return this.maximumStamina;
  }

  get maxFocus(): number {
    return this.maximumFocus;
  }

  get meleeMultiplier(): number {
    return this.meleePowerMultiplier;
  }

  get spellMultiplier(): number {
    return this.spellPowerMultiplier;
  }

  useAuthoredModel(model: AuthoredModel): void {
    if (this.authoredModel) {
      this.swordPivot.removeFromParent();
      this.group.add(this.swordPivot);
      this.authoredModel.root.removeFromParent();
      this.authoredModel.dispose();
    }
    for (const child of [...this.group.children]) {
      if (child !== this.lockRing) child.visible = false;
    }
    this.authoredModel = model;
    this.group.add(model.root);
    this.swordPivot.removeFromParent();
    this.swordPivot.visible = true;
    this.swordPivot.position.set(0.5, 1.28, -0.08);
    model.root.add(this.swordPivot);
  }

  update(delta: number, elapsed: number, input: InputController, tuning: PlayerTuning, bounds: ArenaBounds): void {
    this.tickTimers(delta);
    if (this.dead) {
      this.velocity.multiplyScalar(Math.exp(-10 * delta));
      this.group.rotation.z = THREE.MathUtils.damp(this.group.rotation.z, -1.35, 7, delta);
      return;
    }

    input.readMovement(this.move);
    if (input.consume('dodge') && this.stamina >= 24 && this.dodgeTimer <= 0) {
      this.dodgeDirection.set(this.move.x, 0, this.move.y);
      if (this.dodgeDirection.lengthSq() < 0.05) this.dodgeDirection.copy(this.facing);
      else this.dodgeDirection.normalize();
      this.dodgeTimer = 0.38;
      this.invulnerabilityTimer = Math.max(this.invulnerabilityTimer, 0.29);
      this.stamina -= 24;
      this.staminaDelay = 0.62;
    }

    if (this.dodgeTimer > 0) {
      this.velocity.copy(this.dodgeDirection).multiplyScalar(tuning.speed * this.moveSpeedMultiplier * tuning.dashMultiplier * 1.28);
    } else {
      this.targetVelocity.set(this.move.x, 0, this.move.y).multiplyScalar(tuning.speed * this.moveSpeedMultiplier);
      const smoothing = 1 - Math.exp(-tuning.acceleration * delta);
      this.velocity.lerp(this.targetVelocity, smoothing);
    }

    this.group.position.addScaledVector(this.velocity, delta);
    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -bounds.halfWidth + this.radius, bounds.halfWidth - this.radius);
    this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -bounds.halfDepth + this.radius, bounds.halfDepth - this.radius);

    if (!this.isDodging && this.velocity.lengthSq() > 0.04) {
      this.facing.set(this.velocity.x, 0, this.velocity.z).normalize();
    }
    this.group.rotation.y = THREE.MathUtils.damp(this.group.rotation.y, Math.atan2(-this.facing.x, -this.facing.z), 15, delta);
    this.group.position.y = this.groundHeight + 0.02 + Math.sin(elapsed * 8.5) * Math.min(this.velocity.length() / 80, 0.045);
    this.group.rotation.z = THREE.MathUtils.damp(this.group.rotation.z, 0, 10, delta);

    if (this.staminaDelay <= 0) this.stamina = Math.min(this.maxStamina, this.stamina + 28 * delta);
    this.focus = Math.min(this.maxFocus, this.focus + 7.5 * this.focusRegenMultiplier * delta);
    this.animateEquipment(delta, elapsed);
  }

  tryMelee(): boolean {
    if (this.dead || this.meleeCooldown > 0 || this.stamina < 14 || this.isDodging) return false;
    this.stamina -= 14;
    this.staminaDelay = 0.44;
    this.meleeCooldown = 0.46 / (1 + this.cooldownRate);
    this.attackAnimation = 0.34;
    return true;
  }

  tryCastLunar(): boolean {
    return this.tryUseAbility(0, 15, 0.38);
  }

  tryCastAurora(): boolean {
    return this.tryUseAbility(1, 28, 1.08);
  }

  tryUseAbility(slot: number, focusCost: number, cooldownSeconds: number): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.abilityCooldowns.length) return false;
    if (this.dead || this.abilityCooldowns[slot] > 0 || this.focus < focusCost || this.isDodging) return false;
    this.focus -= Math.max(0, focusCost);
    this.abilityCooldowns[slot] = Math.max(0.08, cooldownSeconds) / (1 + this.cooldownRate);
    this.castAnimation = cooldownSeconds >= 0.8 ? 0.58 : 0.32;
    return true;
  }

  takeDamage(amount: number, ignoreInvulnerability = false): boolean {
    if (this.dead || (this.isInvulnerable && !ignoreInvulnerability)) return false;
    const appliedAmount = Math.max(0, amount) * (ignoreInvulnerability ? 1 : 1 - this.damageReduction);
    this.health = Math.max(0, this.health - appliedAmount);
    this.invulnerabilityTimer = 0.48;
    this.damageFlash = 0.2;
    if (this.health <= 0) {
      this.dead = true;
      this.velocity.set(0, 0, 0);
    }
    return true;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + Math.max(0, amount) * this.healingMultiplier);
  }

  setFacing(direction: THREE.Vector3): void {
    if (direction.lengthSq() < 0.0001) return;
    this.facing.set(direction.x, 0, direction.z).normalize();
  }

  setLockVisible(visible: boolean): void {
    this.lockRing.visible = visible;
  }

  setFocusRegenMultiplier(multiplier: number): void {
    this.focusRegenMultiplier = Math.max(0.2, multiplier);
  }

  addCharm(name: string): void {
    this.charms.add(name);
  }

  setEquipment(equipment: Partial<PlayerEquipment>): void {
    Object.assign(this.equipment, equipment);
  }

  setGroundHeight(height: number): void {
    if (!Number.isFinite(height)) return;
    this.groundHeight = height;
    this.group.position.y = height + 0.02;
  }

  applyBuild(modifiers: BuildModifiers, preserveResourceRatios = true): void {
    const healthRatio = this.maximumHealth > 0 ? this.health / this.maximumHealth : 1;
    const staminaRatio = this.maximumStamina > 0 ? this.stamina / this.maximumStamina : 1;
    const focusRatio = this.maximumFocus > 0 ? this.focus / this.maximumFocus : 1;
    this.maximumHealth = Math.max(50, 120 + modifiers.maxHealth);
    this.maximumStamina = Math.max(45, 100 + modifiers.maxStamina);
    this.maximumFocus = Math.max(35, 100 + modifiers.maxFocus);
    this.moveSpeedMultiplier = THREE.MathUtils.clamp(1 + modifiers.moveSpeed, 0.72, 1.55);
    this.meleePowerMultiplier = Math.max(0.35, 1 + modifiers.meleePower);
    this.spellPowerMultiplier = Math.max(0.35, 1 + modifiers.spellPower);
    this.cooldownRate = THREE.MathUtils.clamp(modifiers.cooldownRate, -0.35, 1.25);
    this.damageReduction = THREE.MathUtils.clamp(modifiers.damageReduction, 0, 0.65);
    this.healingMultiplier = Math.max(0.25, 1 + modifiers.healingPower);
    if (preserveResourceRatios) {
      this.health = THREE.MathUtils.clamp(healthRatio * this.maximumHealth, 0, this.maximumHealth);
      this.stamina = THREE.MathUtils.clamp(staminaRatio * this.maximumStamina, 0, this.maximumStamina);
      this.focus = THREE.MathUtils.clamp(focusRatio * this.maximumFocus, 0, this.maximumFocus);
    } else {
      this.health = this.maximumHealth;
      this.stamina = this.maximumStamina;
      this.focus = this.maximumFocus;
    }
  }

  restoreAt(position: THREE.Vector3): void {
    this.group.position.copy(position);
    this.groundHeight = Math.max(-12, Math.min(12, position.y - 0.02));
    this.group.position.y = this.groundHeight + 0.02;
    this.group.rotation.z = 0;
    this.velocity.set(0, 0, 0);
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.focus = this.maxFocus;
    this.dead = false;
    this.dodgeTimer = 0;
    this.invulnerabilityTimer = 1.2;
    this.meleeCooldown = 0;
    this.abilityCooldowns.fill(0);
  }

  dispose(): void {
    if (this.authoredModel) {
      this.swordPivot.removeFromParent();
      this.group.add(this.swordPivot);
      this.authoredModel.root.removeFromParent();
      this.authoredModel.dispose();
      this.authoredModel = null;
    }
    for (const geometry of this.ownedGeometries) geometry.dispose();
    const materials = new Set<THREE.Material>();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const values = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of values) materials.add(material);
    });
    for (const material of materials) material.dispose();
  }

  private tickTimers(delta: number): void {
    this.meleeCooldown = Math.max(0, this.meleeCooldown - delta);
    for (let index = 0; index < this.abilityCooldowns.length; index += 1) {
      this.abilityCooldowns[index] = Math.max(0, this.abilityCooldowns[index] - delta);
    }
    this.attackAnimation = Math.max(0, this.attackAnimation - delta);
    this.castAnimation = Math.max(0, this.castAnimation - delta);
    this.dodgeTimer = Math.max(0, this.dodgeTimer - delta);
    this.invulnerabilityTimer = Math.max(0, this.invulnerabilityTimer - delta);
    this.staminaDelay = Math.max(0, this.staminaDelay - delta);
    this.damageFlash = Math.max(0, this.damageFlash - delta);
    this.bodyMaterial.emissive.set(this.damageFlash > 0 ? '#8e172f' : '#000000');
    this.bodyMaterial.emissiveIntensity = this.damageFlash > 0 ? 2.2 : 0;
  }

  private animateEquipment(delta: number, elapsed: number): void {
    const swingProgress = this.attackAnimation > 0 ? 1 - this.attackAnimation / 0.34 : 0;
    const swing = this.attackAnimation > 0 ? Math.sin(swingProgress * Math.PI) : 0;
    this.swordPivot.rotation.z = -2.45 + swing * 2.7;
    this.swordPivot.rotation.x = 0.35 - swing * 0.75;
    const cast = this.castAnimation > 0 ? Math.sin((1 - this.castAnimation / 0.58) * Math.PI) : 0;
    this.staffPivot.rotation.z = THREE.MathUtils.damp(this.staffPivot.rotation.z, cast * 0.62, 15, delta);
    this.magicMaterial.emissiveIntensity = 1.35 + cast * 2.8 + Math.sin(elapsed * 3.5) * 0.12;
    this.authoredModel?.update(delta, elapsed, 1 + cast * 0.8 + swing * 0.35);
    const authoredStaff = this.authoredModel?.parts.get('crescentStaff');
    if (authoredStaff) authoredStaff.rotation.z = THREE.MathUtils.damp(authoredStaff.rotation.z, cast * 0.26, 14, delta);
    const authoredArm = this.authoredModel?.parts.get('rightArmJoint');
    if (authoredArm) authoredArm.rotation.x = THREE.MathUtils.damp(authoredArm.rotation.x, -swing * 0.68, 18, delta);
  }

  private own<T extends THREE.BufferGeometry>(geometry: T): T {
    this.ownedGeometries.push(geometry);
    return geometry;
  }
}
