import * as THREE from 'three';
import {
  createCelestialAstrolabe,
  createConstellationReliquary,
  createEnemyModel,
  createEclipseArchonBoss,
  createMoonwellRelic,
  createSorcererModel,
} from '../assets/GameModels';
import { MaterialLibrary } from '../assets/MaterialLibrary';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { CelestialRelic, type RelicKind } from '../entities/CelestialRelic';
import { CombatProjectile } from '../entities/CombatProjectile';
import { Enemy, type EnemyAttackEvent } from '../entities/Enemy';
import { Player, type ArenaBounds, type SpellComprehension } from '../entities/Player';
import { AudioSystem } from '../systems/AudioSystem';
import { CameraRig } from '../systems/CameraRig';
import { CollisionSystem, type CircleObstacle } from '../systems/CollisionSystem';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { EncounterDirector } from '../systems/EncounterDirector';
import { Hud } from '../systems/Hud';
import { VfxSystem } from '../systems/VfxSystem';
import { disposeObject3D } from '../utils/dispose';
import { CelestialWorld } from '../world/CelestialWorld';
import {
  DEFAULT_CHARACTER_PROFILE,
  sanitizeCharacterProfile,
  type CharacterProfile,
} from './CharacterProfile';
import { appearanceFromProfile, appearanceSignature } from './CharacterAppearance';
import type { FrontEndIntentDetail } from '../ui/FrontEndController';
import { FIRMAMENT_ROUTE, FIRMAMENT_ROUTE_WALKABLE } from './content/FirmamentRoute';
import type { EncounterDefinition, RouteEnemyKind, RouteSectionDefinition, RouteShape } from './content/RouteTypes';

const ARENA: ArenaBounds = {
  halfWidth: 30,
  halfDepth: 82,
};

const FIXED_STEP = 1 / 60;
const PROGRESSION_TARGET = 4;
const START_POSITION = new THREE.Vector3(FIRMAMENT_ROUTE.start.position[0], 0.02, FIRMAMENT_ROUTE.start.position[1]);
const FINAL_BOSS_SPAWN = FIRMAMENT_ROUTE.encounters
  .find((encounter) => encounter.boss === 'final')
  ?.spawns.find((spawn) => spawn.kind === 'eclipseArchon');
if (!FINAL_BOSS_SPAWN) throw new Error('The firmament route requires a final Eclipse Archon spawn.');
const BOSS_POSITION = new THREE.Vector3(FINAL_BOSS_SPAWN.position[0], 0, FINAL_BOSS_SPAWN.position[1]);

type GamePhase = 'menu' | 'exploration' | 'boss' | 'dead' | 'victory' | 'paused';
type DamageSource = 'melee' | 'lunar' | 'aurora';

type AffinityState = {
  celestial: number;
  wrathful: number;
  mercy: number;
};

type ComprehensionTrack = {
  uses: number;
  tier: SpellComprehension;
  challengeRank: number;
};

type TestHooks = {
  start: () => void;
  damagePlayer: (amount?: number) => void;
  restoreNextBody: () => void;
  spawnBoss: () => void;
  defeatBoss: () => void;
  restart: () => void;
  activateNextEncounter: () => void;
  defeatActiveEncounter: () => void;
  claimAvailableCheckpoint: () => void;
  showEncounter: (encounterId: string) => void;
  showSection: (sectionId: string) => void;
  victoryTrade: () => void;
};

type RuntimeWindow = Window & {
  __THREE_GAME_DIAGNOSTICS__?: unknown;
  __CELESTIAL_GAME_TEST__?: TestHooks;
};

const RELIC_DATA: ReadonlyArray<{ kind: RelicKind; position: readonly [number, number]; checkpointId: string }> =
  FIRMAMENT_ROUTE.checkpoints.map((checkpoint) => ({
    kind: checkpoint.relicKind,
    position: checkpoint.position,
    checkpointId: checkpoint.id,
  }));

const OBSTACLES: readonly CircleObstacle[] = [];

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(47, 1, 0.1, 190);
  private readonly input: InputController;
  private readonly player = new Player();
  private readonly collision = new CollisionSystem();
  private readonly encounterDirector = new EncounterDirector(FIRMAMENT_ROUTE);
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly materials = new MaterialLibrary({
    anisotropy: Math.min(8, this.rendererAnisotropy()),
  });
  private readonly world = new CelestialWorld(this.materials, {
    arenaHalfWidth: ARENA.halfWidth,
    arenaHalfDepth: ARENA.halfDepth,
    worldRadius: 112,
  });
  private readonly vfx = new VfxSystem(this.materials);
  private readonly relics: CelestialRelic[] = [];
  private readonly relicCheckpointIds = new Map<CelestialRelic, string>();
  private readonly enemies: Enemy[] = [];
  private readonly projectiles: CombatProjectile[] = [];
  private readonly enemyAttacks: EnemyAttackEvent[] = [];
  private readonly enemySpawnIds = new Map<Enemy, string>();
  private readonly enemyBySpawnId = new Map<string, Enemy>();
  private readonly enemyPreviousPositions = new Map<Enemy, THREE.Vector3>();
  private readonly enemyLeashRegions = new Map<Enemy, readonly RouteShape[]>();
  private readonly enemyWakeAt = new Map<Enemy, number>();
  private readonly checkpoint = START_POSITION.clone();
  private readonly previousPlayerPosition = START_POSITION.clone();
  private readonly aim2 = new THREE.Vector2();
  private readonly aimDirection = new THREE.Vector3(0, 0, -1);
  private readonly tempDirection = new THREE.Vector3();
  private readonly loop = new Loop(
    (delta) => this.update(delta),
    () => this.render(),
  );

  private readonly tuning: DebugTuning = {
    speed: 6.3,
    dashMultiplier: 1.82,
    acceleration: 15,
    cameraLag: 0.11,
    exposure: 1.06,
    maxDpr: 2,
  };

  private readonly debugTools: DebugTools;
  private readonly affinity: AffinityState = {
    celestial: 0.12,
    wrathful: 0,
    mercy: 0.18,
  };
  private readonly comprehension: Record<'lunar' | 'aurora', ComprehensionTrack> = {
    lunar: { uses: 0, tier: 'Novice', challengeRank: 0 },
    aurora: { uses: 0, tier: 'Novice', challengeRank: 0 },
  };

  private readonly landmarks: THREE.Group;
  private characterProfile: CharacterProfile;
  private boss: Enemy;
  private midpointBoss!: Enemy;
  private lockedTarget: Enemy | null = null;
  private phase: GamePhase = 'menu';
  private phaseBeforePause: Exclude<GamePhase, 'paused'> = 'exploration';
  private accumulator = 0;
  private elapsed = 0;
  private deathTimer = 0;
  private frame = 0;
  private restoredCount = 0;
  private defeatedEnemies = 0;
  private damageDealt = 0;
  private damageTaken = 0;
  private disposed = false;

  private readonly onFrontEndIntent = (event: Event): void => {
    const detail = (event as CustomEvent<FrontEndIntentDetail>).detail;
    if (!detail) return;
    if (detail.type === 'preview' && detail.profile) {
      this.applyCharacterProfile(detail.profile);
    } else if (detail.type === 'start') {
      this.beginPilgrimage(detail.profile ?? this.characterProfile);
    } else if (detail.type === 'open-settings') {
      this.hud.showSettingsFrom('none');
    }
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    initialProfile: CharacterProfile = DEFAULT_CHARACTER_PROFILE,
  ) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = this.tuning.exposure;
    this.materials.setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    this.characterProfile = sanitizeCharacterProfile(initialProfile);
    this.player.useAuthoredModel(createSorcererModel(this.materials, appearanceFromProfile(this.characterProfile)));
    this.applyCharacterProfile(this.characterProfile);

    const stick = this.getElement('#touch-stick');
    const knob = this.getElement('#touch-knob');
    const dashButton = this.getElement('#dash-button');
    this.input = new InputController(stick, knob, dashButton);
    this.input.setEnabled(false);
    this.debugTools = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    });

    this.landmarks = this.createLandmarks();
    this.createScene();
    this.createRelics();
    this.boss = this.createEnemies();
    this.collision.configureRouteCollision(FIRMAMENT_ROUTE_WALKABLE, FIRMAMENT_ROUTE.gates, this.encounterDirector.getSnapshot().gates);
    this.player.restoreAt(START_POSITION);
    this.hud.setTarget(PROGRESSION_TARGET);
    this.cameraRig.setOcclusionRoots([this.world.foregroundLayer, this.world.midgroundLayer, this.world.farLayer]);
    this.cameraRig.snapTo(this.player.group.position);
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    window.addEventListener('celestial-front-end-intent', this.onFrontEndIntent);
    this.installTestHooks();
    this.publishDiagnostics(true);
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    window.removeEventListener('celestial-front-end-intent', this.onFrontEndIntent);
    this.input.dispose();
    this.audio.dispose();
    this.hud.dispose();
    this.debugTools.dispose();
    for (const projectile of this.projectiles) projectile.dispose();
    for (const relic of this.relics) relic.dispose();
    for (const enemy of this.enemies) enemy.dispose();
    this.player.dispose();
    this.vfx.dispose();
    this.world.dispose();
    this.materials.dispose();
    disposeObject3D(this.landmarks);
    this.renderer.dispose();
    const runtimeWindow = window as RuntimeWindow;
    runtimeWindow.__THREE_GAME_DIAGNOSTICS__ = undefined;
    runtimeWindow.__CELESTIAL_GAME_TEST__ = undefined;
  }

  private update(delta: number): void {
    this.frame += 1;
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);

    if (this.phase === 'menu') {
      this.updatePresentation(delta);
      this.publishDiagnostics();
      return;
    }

    if (this.input.consume('pause') && this.phase !== 'dead' && this.phase !== 'victory') {
      if (this.phase === 'paused') {
        this.phase = this.phaseBeforePause;
        this.audio.resume();
      } else {
        this.phaseBeforePause = this.phase;
        this.phase = 'paused';
        this.audio.pause();
      }
      this.emitAudio('pause');
    }

    const restartRequested = this.input.consume('restart');
    if (restartRequested && this.phase === 'paused') {
      this.restartFullRun();
      this.audio.resume();
    }
    if (this.phase === 'paused') {
      this.updatePresentation(delta);
      this.publishDiagnostics();
      return;
    }
    if (this.phase === 'dead') {
      this.deathTimer += delta;
      if (restartRequested) this.restartFromCheckpoint();
      this.updatePresentation(delta);
      this.publishDiagnostics();
      return;
    }
    if (this.phase === 'victory') {
      if (restartRequested) this.restartFullRun();
      this.updatePresentation(delta);
      this.publishDiagnostics();
      return;
    }

    this.elapsed += delta;
    this.accumulator += Math.min(delta, 0.05);
    while (this.accumulator >= FIXED_STEP) {
      this.fixedUpdate(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
    this.updatePresentation(delta);
    this.publishDiagnostics();
  }

  private applyCharacterProfile(profile: CharacterProfile): void {
    const next = sanitizeCharacterProfile(profile);
    const appearanceChanged = appearanceSignature(next) !== appearanceSignature(this.characterProfile);
    this.characterProfile = next;
    this.player.setEquipment({
      catalyst:
        next.catalyst === 'crescent-staff'
          ? 'Moon-etched crescent staff'
          : next.catalyst === 'ash-wand'
            ? 'Moon-ash orb wand'
            : 'Unbound celestial hands',
      armor: `${next.robeDye[0].toUpperCase()}${next.robeDye.slice(1)} starweave robes`,
    });
    if (!appearanceChanged) return;
    this.player.useAuthoredModel(createSorcererModel(this.materials, appearanceFromProfile(next)));
  }

  private beginPilgrimage(profile: CharacterProfile): void {
    this.applyCharacterProfile(profile);
    this.restartFullRun();
    this.input.setEnabled(true);
    this.hud.showMenu('none');
    this.cameraRig.snapTo(this.player.group.position);
    this.emitAudio('confirm', 0.8);
  }

  private onEncounterActivated(encounterId: string): void {
    const encounter = FIRMAMENT_ROUTE.encounters.find((candidate) => candidate.id === encounterId);
    if (!encounter) return;
    this.syncRouteState();
    for (const spawn of encounter.spawns) {
      const enemy = this.enemyBySpawnId.get(spawn.id);
      if (!enemy) continue;
      const delay = 'wakeDelaySeconds' in spawn ? Math.max(0, spawn.wakeDelaySeconds ?? 0) : 0;
      if (delay > 0) this.enemyWakeAt.set(enemy, this.elapsed + delay);
      else enemy.awaken();
    }
    if (encounter.boss !== 'none') {
      this.phase = 'boss';
      this.vfx.emitCelestialRestoration(
        new THREE.Vector3(encounter.activation.center[0], 0, encounter.activation.center[1]),
        encounter.boss === 'final' ? 2.4 : 1.75,
      );
      this.cameraRig.kick(0.24, 0.45);
      this.emitAudio('boss-awaken', encounter.boss === 'final' ? 1 : 0.82);
    }
    this.hud.showDiscovery({
      id: `encounter-${encounter.id}`,
      visible: true,
      kicker: encounter.boss === 'none' ? 'The pilgrimage narrows' : 'Celestial adversary',
      title: encounter.name,
      detail: encounter.objective,
      duration: encounter.boss === 'none' ? 1500 : 2200,
    });
  }

  private syncRouteState(): void {
    const snapshot = this.encounterDirector.getSnapshot();
    this.collision.syncGateStates(snapshot.gates);
    this.world.setGateStates(snapshot.gates);
  }

  private getActiveBoss(): Enemy | null {
    const activeEncounter = this.encounterDirector.activeEncounter;
    if (!activeEncounter || activeEncounter.boss === 'none') return null;
    const bossSpawn = activeEncounter.spawns.find((spawn) => spawn.role === 'boss');
    return bossSpawn ? this.enemyBySpawnId.get(bossSpawn.id) ?? null : null;
  }

  private fixedUpdate(delta: number): void {
    this.collision.beginStep();
    const wasDodging = this.player.isDodging;
    this.previousPlayerPosition.copy(this.player.group.position);
    this.player.update(delta, this.elapsed, this.input, this.tuning, ARENA);
    this.collision.resolveRouteMovement(
      this.previousPlayerPosition,
      this.player.group.position,
      this.player.velocity,
      this.player.radius,
    );
    const activatedEncounterId = this.encounterDirector.activateNextEncounterAt(
      [this.player.group.position.x, this.player.group.position.z],
      this.player.radius,
    );
    if (activatedEncounterId) this.onEncounterActivated(activatedEncounterId);
    if (!wasDodging && this.player.isDodging) {
      this.vfx.emitDodge(this.player.group.position, this.player.velocity, 1.1);
      this.emitAudio('dodge', 0.7);
    }

    this.updateTargeting();
    this.handlePlayerActions();
    if (this.phase === 'victory') return;
    this.enemyAttacks.length = 0;
    for (const enemy of this.enemies) {
      const previous = this.enemyPreviousPositions.get(enemy) ?? enemy.group.position.clone();
      previous.copy(enemy.group.position);
      const spawnId = this.enemySpawnIds.get(enemy);
      const enabled = spawnId ? this.encounterDirector.isEnemyEnabled(spawnId) : false;
      const leashRegions = this.enemyLeashRegions.get(enemy) ?? FIRMAMENT_ROUTE_WALKABLE;
      const playerInLeash = this.collision.containsInWalkableUnion(
        this.player.group.position,
        this.player.radius * 0.2,
        leashRegions,
      );
      if (enabled && enemy.dormant && this.elapsed >= (this.enemyWakeAt.get(enemy) ?? -Infinity)) {
        this.enemyWakeAt.delete(enemy);
        enemy.awaken();
      }
      enemy.update(
        delta,
        this.elapsed,
        playerInLeash ? this.player.group.position : enemy.spawnPosition,
        enabled,
        this.enemyAttacks,
        playerInLeash,
      );
      if (enemy.active && !enemy.dormant) {
        this.collision.resolveRouteMovement(previous, enemy.group.position, enemy.velocity, enemy.radius, leashRegions);
      }
    }
    this.separateEnemies();
    for (const enemy of this.enemies) {
      if (!enemy.active || enemy.dormant) continue;
      const previous = this.enemyPreviousPositions.get(enemy) ?? enemy.group.position;
      this.collision.resolveRouteMovement(
        previous,
        enemy.group.position,
        enemy.velocity,
        enemy.radius,
        this.enemyLeashRegions.get(enemy) ?? FIRMAMENT_ROUTE_WALKABLE,
      );
    }
    for (const attack of this.enemyAttacks) this.resolveEnemyAttack(attack);
    this.updateProjectiles(delta);
    if (this.isVictoryPhase()) return;
    this.updateRelics(delta);

    if (this.player.dead && this.phase !== 'dead') {
      this.phase = 'dead';
      this.deathTimer = 0;
      this.vfx.emitDeath(this.player.group.position, 1.35);
      this.cameraRig.kick(0.34, 0.5);
      this.emitAudio('death', 1);
    }
  }

  private updatePresentation(delta: number): void {
    const restoration = (this.restoredCount + (this.phase === 'victory' ? 1 : 0)) / PROGRESSION_TARGET;
    this.world.update(delta, this.elapsed, restoration);
    this.vfx.update(delta, this.elapsed);
    const activeBoss = this.getActiveBoss();
    const cameraTarget = this.lockedTarget?.active
      ? this.lockedTarget.group.position
      : this.phase === 'boss' && activeBoss?.active
        ? activeBoss.group.position
        : null;
    const section = this.findCurrentSection();
    const routeForward = section
      ? this.tempDirection.set(section.cameraForward[0], 0, section.cameraForward[1]).normalize()
      : null;
    this.cameraRig.update(delta, this.player.group.position, this.tuning.cameraLag, cameraTarget, routeForward);
    const score = this.restoredCount + (this.phase === 'victory' ? 1 : 0);
    this.hud.update(score, PROGRESSION_TARGET, this.elapsed, this.phase === 'victory');
  }

  private handlePlayerActions(): void {
    if (this.input.consume('lock')) {
      if (this.lockedTarget?.active) this.lockedTarget = null;
      else this.lockedTarget = this.findNearestEnemy(18);
      this.player.setLockVisible(Boolean(this.lockedTarget));
      this.emitAudio('lock', 0.35);
    }

    this.chooseAimDirection();
    if (this.input.consume('melee') && this.player.tryMelee()) {
      this.player.setFacing(this.aimDirection);
      let hitCount = 0;
      for (const enemy of this.enemies) {
        if (!enemy.active || enemy.dormant) continue;
        if (!this.collision.isInCone(this.player.group.position, this.player.facing, 2.35, 0.78, enemy.group.position, enemy.radius)) continue;
        this.damageEnemy(enemy, 27 * (1 + this.affinity.wrathful * 0.22), 'melee');
        hitCount += 1;
      }
      this.vfx.emitCast(this.player.group.position, this.player.facing, 0.65);
      if (hitCount > 0) this.cameraRig.kick(0.12 + hitCount * 0.025, 0.15);
      this.emitAudio('melee', hitCount > 0 ? 0.9 : 0.45);
    }

    if (this.input.consume('lunar') && this.player.tryCastLunar()) {
      this.player.setFacing(this.aimDirection);
      const track = this.recordSpellUse('lunar');
      const damage = 18 * this.magicMultiplier('lunar') * this.tierMultiplier(track.tier);
      const origin = this.player.group.position.clone().addScaledVector(this.player.facing, 0.85);
      origin.y = 0.82;
      const projectile = new CombatProjectile('player', 'lunar', origin, this.player.facing, 13.5, damage, 0.23, 3.1);
      this.projectiles.push(projectile);
      this.scene.add(projectile.group);
      this.vfx.emitCast(origin, this.player.facing, 0.9 + this.tierRank(track.tier) * 0.08);
      this.emitAudio('lunar-cast', 0.78);
    }

    if (this.input.consume('aurora') && this.player.tryCastAurora()) {
      this.player.setFacing(this.aimDirection);
      const track = this.recordSpellUse('aurora');
      const damage = 31 * this.magicMultiplier('aurora') * this.tierMultiplier(track.tier);
      let hitCount = 0;
      for (const enemy of this.enemies) {
        if (!enemy.active || enemy.dormant) continue;
        if (!this.collision.isInCone(this.player.group.position, this.player.facing, 7.6, 0.5, enemy.group.position, enemy.radius)) continue;
        this.damageEnemy(enemy, damage * Math.max(0.72, 1 - hitCount * 0.12), 'aurora');
        this.vfx.emitHit(enemy.group.position, this.player.facing, 1.1);
        hitCount += 1;
        if (hitCount >= 4) break;
      }
      if (hitCount > 0) {
        this.player.heal((5 + this.affinity.mercy * 8) * Math.min(2, hitCount));
        this.affinity.mercy = Math.min(1, this.affinity.mercy + 0.006 * hitCount);
        this.cameraRig.kick(0.15, 0.2);
      }
      this.vfx.emitCast(this.player.group.position, this.player.facing, 1.45);
      this.emitAudio('aurora-cast', 0.9);
    }
  }

  private updateTargeting(): void {
    if (this.lockedTarget && (!this.lockedTarget.active || this.lockedTarget.dormant || this.lockedTarget.group.position.distanceToSquared(this.player.group.position) > 26 * 26)) {
      this.lockedTarget = null;
      this.player.setLockVisible(false);
    }
  }

  private chooseAimDirection(): void {
    const target = this.lockedTarget?.active ? this.lockedTarget : this.findNearestEnemy(9.5);
    if (target) {
      this.aimDirection.copy(target.group.position).sub(this.player.group.position).setY(0).normalize();
      return;
    }
    if (this.input.hasPointerAim()) {
      this.input.readAim(this.aim2);
      this.aimDirection.set(this.aim2.x, 0, this.aim2.y);
      if (this.aimDirection.lengthSq() > 0.06) {
        this.aimDirection.normalize();
        return;
      }
    }
    this.aimDirection.copy(this.player.facing);
  }

  private findNearestEnemy(maxDistance: number): Enemy | null {
    let nearest: Enemy | null = null;
    let nearestDistanceSq = maxDistance * maxDistance;
    for (const enemy of this.enemies) {
      if (!enemy.active || enemy.dormant) continue;
      const distanceSq = enemy.group.position.distanceToSquared(this.player.group.position);
      if (distanceSq >= nearestDistanceSq) continue;
      nearestDistanceSq = distanceSq;
      nearest = enemy;
    }
    return nearest;
  }

  private resolveEnemyAttack(attack: EnemyAttackEvent): void {
    if (attack.kind === 'melee') {
      if (this.collision.circlesOverlap(attack.source.group.position, attack.radius, this.player.group.position, this.player.radius)) {
        this.damagePlayer(attack.damage);
      }
      return;
    }
    if (attack.kind === 'burst') {
      this.vfx.emitHit(attack.position, new THREE.Vector3(0, 1, 0), 1.7);
      if (this.collision.circlesOverlap(attack.position, attack.radius, this.player.group.position, this.player.radius)) {
        this.damagePlayer(attack.damage);
      }
      return;
    }

    const count = Math.max(1, attack.count);
    for (let index = 0; index < count; index += 1) {
      let angle = 0;
      if (attack.kind === 'nova') angle = index / count * Math.PI * 2;
      else angle = (index - (count - 1) / 2) * 0.17;
      const direction = attack.kind === 'nova'
        ? new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle))
        : attack.direction.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
      const origin = attack.source.group.position.clone().addScaledVector(direction, attack.source.radius + 0.28);
       origin.y = attack.source.isBoss ? 1.25 : 0.78;
      const projectile = new CombatProjectile(
        'enemy',
         attack.source.isBoss ? 'eclipse' : 'star',
        origin,
        direction,
         attack.source.isBoss ? 9.5 : 7.8,
        attack.damage,
        attack.radius,
        4.2,
      );
      this.projectiles.push(projectile);
      this.scene.add(projectile.group);
    }
     this.emitAudio(attack.source.isBoss ? 'boss-cast' : 'enemy-cast', 0.55);
  }

  private updateProjectiles(delta: number): void {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.update(delta, this.elapsed);
      if (
        projectile.active &&
        (this.collision.sweepClosedGates(projectile.previousPosition, projectile.group.position, projectile.radius) ||
          !this.collision.containsInWalkableUnion(projectile.group.position, 0))
      ) {
        this.vfx.emitHit(projectile.group.position, projectile.velocity, 0.65);
        projectile.deactivate();
      }
      if (projectile.active && projectile.faction === 'player') {
        for (const enemy of this.enemies) {
          if (!enemy.active || enemy.dormant) continue;
          if (!this.collision.sweepCircle(projectile.previousPosition, projectile.group.position, projectile.radius, enemy.group.position, enemy.radius)) continue;
          this.damageEnemy(enemy, projectile.damage, projectile.kind === 'aurora' ? 'aurora' : 'lunar');
          this.vfx.emitHit(enemy.group.position, projectile.velocity, 1);
          projectile.deactivate();
          break;
        }
      } else if (projectile.active && projectile.faction === 'enemy') {
        if (this.collision.sweepCircle(projectile.previousPosition, projectile.group.position, projectile.radius, this.player.group.position, this.player.radius)) {
          if (this.damagePlayer(projectile.damage)) projectile.deactivate();
          else if (this.player.isInvulnerable) projectile.deactivate();
        }
      }
      if (
        projectile.active &&
        (Math.abs(projectile.group.position.x) > ARENA.halfWidth + 2 || Math.abs(projectile.group.position.z) > ARENA.halfDepth + 2)
      ) {
        projectile.deactivate();
      }
      if (projectile.active) continue;
      this.scene.remove(projectile.group);
      projectile.dispose();
      this.projectiles.splice(index, 1);
    }
  }

  private damageEnemy(enemy: Enemy, amount: number, source: DamageSource): void {
    if (!enemy.active || enemy.dormant) return;
    const killed = enemy.takeDamage(amount);
    this.damageDealt += amount;
    this.vfx.emitHit(enemy.group.position, this.player.facing, Math.min(1.7, amount / 22));
    this.emitAudio('enemy-hit', Math.min(1, amount / 32));
    if (!killed) return;
    this.enemyWakeAt.delete(enemy);
    this.defeatedEnemies += 1;
    this.vfx.emitDeath(enemy.group.position, enemy.isBoss ? 2.6 : 1);
    if (source === 'melee') {
      this.affinity.wrathful = Math.min(1, this.affinity.wrathful + 0.045);
      this.affinity.celestial = Math.max(0, this.affinity.celestial - 0.008);
    } else {
      this.affinity.celestial = Math.min(1, this.affinity.celestial + 0.028);
    }
    const spawnId = this.enemySpawnIds.get(enemy);
    const defeat = spawnId ? this.encounterDirector.markEnemyDefeated(spawnId) : null;
    if (defeat?.encounterCompleted) {
      if (enemy === this.midpointBoss) this.encounterDirector.commitProgressBoundary();
      this.syncRouteState();
      if (enemy === this.boss) {
        this.completeVictory();
      } else {
        this.phase = 'exploration';
        if (enemy === this.midpointBoss) {
          this.player.addCharm('Castellan\'s Broken Orrery');
          this.player.heal(48);
          this.comprehension.lunar.challengeRank = Math.max(3, this.comprehension.lunar.challengeRank);
          this.refreshComprehension('lunar');
        }
        this.hud.showDiscovery({
          id: `encounter-cleared-${spawnId}`,
          visible: true,
          kicker: enemy.isBoss ? 'Warden defeated' : 'Path unsealed',
          title: enemy.isBoss ? `${enemy.displayName} is broken` : 'The blackstone seal releases',
          detail: this.encounterDirector.objective,
          duration: enemy.isBoss ? 2200 : 1500,
        });
        this.emitAudio('checkpoint', enemy.isBoss ? 1 : 0.72);
      }
    }
  }

  private damagePlayer(amount: number, force = false): boolean {
    const applied = this.player.takeDamage(amount, force);
    if (!applied) return false;
    this.damageTaken += amount;
    this.cameraRig.kick(0.25, 0.28);
    this.vfx.emitHit(this.player.group.position, this.tempDirection.set(0, 1, 0), 1.25);
    this.emitAudio('player-hit', Math.min(1, amount / 24));
    return true;
  }

  private updateRelics(delta: number): void {
    const interact = this.input.consume('interact');
    for (const relic of this.relics) {
      relic.update(delta, this.elapsed);
      if (relic.state === 'sealed' && !this.enemies.some((enemy) => enemy.guardRelic === relic.index && enemy.active)) {
        relic.setReady();
      }
      if (relic.state !== 'ready') continue;
      const distanceSq = relic.position.distanceToSquared(this.player.group.position);
      if (distanceSq <= (relic.radius + this.player.radius) ** 2 || (interact && distanceSq <= 3.5 * 3.5)) {
        this.restoreRelic(relic);
      }
    }
  }

  private restoreRelic(relic: CelestialRelic): void {
    if (!relic.restore()) return;
    const checkpointId = this.relicCheckpointIds.get(relic);
    if (checkpointId) this.encounterDirector.activateCheckpoint(checkpointId);
    this.restoredCount += 1;
    this.checkpoint.copy(relic.position).add(new THREE.Vector3(0, 0.02, 2.6));
    this.player.heal(this.player.maxHealth);
    this.player.focus = this.player.maxFocus;
    this.affinity.celestial = Math.min(1, this.affinity.celestial + 0.08);
    this.affinity.mercy = Math.min(1, this.affinity.mercy + 0.04);
    if (relic.kind === 'moon') {
      this.player.addCharm('Pale Moon Sigil');
      this.comprehension.lunar.challengeRank = Math.max(3, this.comprehension.lunar.challengeRank);
      this.refreshComprehension('lunar');
    } else if (relic.kind === 'aurora') {
      this.player.addCharm('Verdant Aurora Thread');
      this.player.setFocusRegenMultiplier(1.35);
      this.comprehension.aurora.challengeRank = Math.max(3, this.comprehension.aurora.challengeRank);
      this.refreshComprehension('aurora');
    } else {
      this.player.addCharm('Conjunction of the Lost Stars');
      this.comprehension.lunar.challengeRank = Math.max(4, this.comprehension.lunar.challengeRank);
      this.comprehension.aurora.challengeRank = Math.max(4, this.comprehension.aurora.challengeRank);
      this.refreshComprehension('lunar');
      this.refreshComprehension('aurora');
    }
    this.vfx.emitCelestialRestoration(relic.position, 1.4 + relic.index * 0.3);
    this.audio.pickup(relic.index + 2);
    this.hud.flashPickup();
    this.emitAudio('checkpoint', 1);
    this.syncRouteState();
  }

  private awakenBoss(): void {
    while (this.encounterDirector.nextEncounter && this.encounterDirector.nextEncounter.boss !== 'final') {
      const encounter = this.encounterDirector.nextEncounter;
      this.forceCompleteEncounter(encounter.id);
      const checkpoint = FIRMAMENT_ROUTE.checkpoints.find((candidate) => candidate.unlocksAfterEncounterId === encounter.id);
      if (checkpoint) {
        const relic = this.relics[FIRMAMENT_ROUTE.checkpoints.indexOf(checkpoint)];
        if (relic && relic.state !== 'restored') {
          relic.setReady();
          this.restoreRelic(relic);
        }
      }
    }
    const finalEncounter = this.encounterDirector.nextEncounter;
    if (!finalEncounter || finalEncounter.boss !== 'final') return;
    if (!this.boss.active) this.boss.reset();
    if (this.encounterDirector.activateEncounter(finalEncounter.id)) this.onEncounterActivated(finalEncounter.id);
  }

  private forceCompleteEncounter(encounterId: string): void {
    const encounter = FIRMAMENT_ROUTE.encounters.find((candidate) => candidate.id === encounterId);
    if (!encounter || this.encounterDirector.nextEncounter?.id !== encounterId) return;
    this.encounterDirector.activateEncounter(encounterId);
    for (const spawn of encounter.spawns) {
      const enemy = this.enemyBySpawnId.get(spawn.id);
      if (!enemy) continue;
      enemy.reset();
      enemy.awaken();
      enemy.takeDamage(enemy.maxHealth + 1);
    }
    this.encounterDirector.completeEncounter(encounterId);
    this.syncRouteState();
  }

  private completeVictory(): void {
    this.phase = 'victory';
    for (const projectile of this.projectiles) {
      if (projectile.faction === 'enemy') projectile.deactivate();
    }
    this.lockedTarget = null;
    this.player.setLockVisible(false);
    this.comprehension.lunar.challengeRank = Math.max(4, this.comprehension.lunar.challengeRank);
    this.comprehension.aurora.challengeRank = Math.max(4, this.comprehension.aurora.challengeRank);
    this.refreshComprehension('lunar');
    this.refreshComprehension('aurora');
    this.player.addCharm('Eclipse Warden\'s Crown');
    this.vfx.emitCelestialRestoration(BOSS_POSITION, 3);
    this.audio.pickup(12);
    this.hud.flashPickup();
    this.cameraRig.kick(0.32, 0.65);
    this.emitAudio('victory', 1);
  }

  private isVictoryPhase(): boolean {
    return this.phase === 'victory';
  }

  private restartFromCheckpoint(): void {
    this.clearProjectiles();
    this.encounterDirector.restoreLastCheckpoint();
    this.syncRouteState();
    this.resetEnemiesForRouteState();
    const routeCheckpoint = this.encounterDirector.currentCheckpoint;
    if (routeCheckpoint) {
      this.checkpoint.set(routeCheckpoint.position[0], 0.02, routeCheckpoint.position[1] + 2.4);
    } else {
      this.checkpoint.copy(START_POSITION);
    }
    this.player.restoreAt(this.checkpoint);
    this.phase = 'exploration';
    this.deathTimer = 0;
    this.accumulator = 0;
    this.lockedTarget = null;
    this.player.setLockVisible(false);
    this.cameraRig.snapTo(this.player.group.position);
    this.emitAudio('checkpoint', 0.75);
  }

  private restartFullRun(): void {
    this.clearProjectiles();
    this.encounterDirector.reset();
    this.syncRouteState();
    for (const relic of this.relics) relic.reset();
    this.resetEnemiesForRouteState();
    this.restoredCount = 0;
    this.defeatedEnemies = 0;
    this.damageDealt = 0;
    this.damageTaken = 0;
    this.elapsed = 0;
    this.accumulator = 0;
    this.deathTimer = 0;
    this.checkpoint.copy(START_POSITION);
    this.affinity.celestial = 0.12;
    this.affinity.wrathful = 0;
    this.affinity.mercy = 0.18;
    for (const track of Object.values(this.comprehension)) {
      track.uses = 0;
      track.tier = 'Novice';
      track.challengeRank = 0;
    }
    this.player.charms.clear();
    this.player.addCharm('Initiate\'s lunar medallion');
    this.player.setFocusRegenMultiplier(1);
    this.player.restoreAt(START_POSITION);
    this.phase = 'exploration';
    this.input.setEnabled(true);
    this.lockedTarget = null;
    this.player.setLockVisible(false);
    this.cameraRig.snapTo(this.player.group.position);
  }

  private resetEnemiesForRouteState(): void {
    this.enemyWakeAt.clear();
    for (const enemy of this.enemies) {
      enemy.reset();
      const encounterId = enemy.encounterId;
      if (!encounterId) continue;
      const state = this.encounterDirector.getEncounterState(encounterId);
      if (state === 'cleared') {
        enemy.awaken();
        enemy.takeDamage(enemy.maxHealth + 1);
      } else if (state === 'active') {
        enemy.awaken();
      }
    }
  }

  private recordSpellUse(spell: 'lunar' | 'aurora'): ComprehensionTrack {
    const track = this.comprehension[spell];
    track.uses += 1;
    this.refreshComprehension(spell);
    return track;
  }

  private refreshComprehension(spell: 'lunar' | 'aurora'): void {
    const track = this.comprehension[spell];
    let passiveRank = track.uses >= 30 ? 2 : track.uses >= 12 ? 1 : 0;
    passiveRank = Math.max(passiveRank, track.challengeRank);
    const tiers: SpellComprehension[] = ['Novice', 'Apprentice', 'Mage', 'Seer', 'Warlock', 'Ancient', 'Celestial'];
    track.tier = tiers[Math.min(tiers.length - 1, passiveRank)];
  }

  private tierMultiplier(tier: SpellComprehension): number {
    return 1 + this.tierRank(tier) * 0.115;
  }

  private tierRank(tier: SpellComprehension): number {
    const tiers: SpellComprehension[] = ['Novice', 'Apprentice', 'Mage', 'Seer', 'Warlock', 'Ancient', 'Celestial'];
    return tiers.indexOf(tier);
  }

  private magicMultiplier(spell: 'lunar' | 'aurora'): number {
    let multiplier = 1 + this.affinity.celestial * 0.18;
    if (spell === 'lunar' && this.player.charms.has('Pale Moon Sigil')) multiplier *= 1.14;
    if (spell === 'aurora' && this.player.charms.has('Verdant Aurora Thread')) multiplier *= 1.12;
    if (this.player.charms.has('Conjunction of the Lost Stars')) multiplier *= 1.1;
    return multiplier;
  }

  private separateEnemies(): void {
    for (let a = 0; a < this.enemies.length; a += 1) {
      const first = this.enemies[a];
      if (!first.active || first.dormant) continue;
      for (let b = a + 1; b < this.enemies.length; b += 1) {
        const second = this.enemies[b];
        if (!second.active || second.dormant) continue;
        const dx = second.group.position.x - first.group.position.x;
        const dz = second.group.position.z - first.group.position.z;
        const minimum = (first.radius + second.radius) * 0.72;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq >= minimum * minimum || distanceSq < 0.00001) continue;
        const distance = Math.sqrt(distanceSq);
        const push = (minimum - distance) * 0.5;
        const nx = dx / distance;
        const nz = dz / distance;
        first.group.position.x -= nx * push;
        first.group.position.z -= nz * push;
        second.group.position.x += nx * push;
        second.group.position.z += nz * push;
      }
    }
  }

  private createScene(): void {
    this.scene.background = new THREE.Color('#02030a');
    this.scene.fog = new THREE.FogExp2('#07101a', 0.018);
    this.scene.add(this.world.root, this.landmarks, this.vfx.root, this.player.group);

    const hemisphere = new THREE.HemisphereLight('#7fb7d9', '#080b12', 1.25);
    this.scene.add(hemisphere);
    const moonlight = new THREE.DirectionalLight('#cce6ff', 3.25);
    moonlight.position.set(-16, 30, 10);
    this.scene.add(moonlight);

    const auroraFill = new THREE.DirectionalLight('#73d9c7', 1.35);
    auroraFill.position.set(18, 12, -14);
    this.scene.add(auroraFill);

    const pilgrimLight = new THREE.PointLight('#91d9d2', 2.1, 11, 2);
    pilgrimLight.position.set(0, 2.8, 0.8);
    this.player.group.add(pilgrimLight);

    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(3.4, 28, 18),
      new THREE.MeshBasicMaterial({ color: '#dcecff', fog: false }),
    );
    moon.position.set(-22, 29, -44);
    this.landmarks.add(moon);
  }

  private createRelics(): void {
    RELIC_DATA.forEach((data, index) => {
      const relic = new CelestialRelic(index, data.kind, new THREE.Vector3(data.position[0], 0, data.position[1]));
      if (data.kind === 'moon') relic.useAuthoredModel(createMoonwellRelic(this.materials));
      else if (data.kind === 'aurora') relic.useAuthoredModel(createCelestialAstrolabe(this.materials));
      else relic.useAuthoredModel(createConstellationReliquary(this.materials));
      this.relics.push(relic);
      this.relicCheckpointIds.set(relic, data.checkpointId);
      this.scene.add(relic.group);
    });
  }

  private createEnemies(): Enemy {
    let id = 0;
    const guardedRelicByEncounter = new Map<string, number>(
      FIRMAMENT_ROUTE.checkpoints.map((checkpoint, index) => [checkpoint.unlocksAfterEncounterId, index] as const),
    );
    let finalBoss: Enemy | null = null;

    for (const encounter of FIRMAMENT_ROUTE.encounters) {
      for (const spawn of encounter.spawns) {
        const enemy = new Enemy({
          id: id++,
          kind: spawn.kind,
          position: new THREE.Vector3(spawn.position[0], 0, spawn.position[1]),
          guardRelic: guardedRelicByEncounter.get(encounter.id),
          encounterId: encounter.id,
          initiallyDormant: true,
          buildPlaceholderModel: false,
        });
        enemy.group.rotation.y = spawn.facingRadians;
        enemy.useAuthoredModel(
          spawn.kind === 'eclipseArchon'
            ? createEclipseArchonBoss(this.materials)
            : createEnemyModel(spawn.kind, this.materials),
        );
        if (enemy.isBoss) {
          const encounterLight = new THREE.PointLight(
            spawn.kind === 'eclipseArchon' ? '#ff5b9b' : '#f3bd66',
            spawn.kind === 'eclipseArchon' ? 5.2 : 4.4,
            spawn.kind === 'eclipseArchon' ? 12 : 9,
            2,
          );
          encounterLight.name = `${spawn.id}.portraitLight`;
          encounterLight.position.set(0, 3.2, 1.6);
          enemy.group.add(encounterLight);
        }
        this.enemies.push(enemy);
        this.enemySpawnIds.set(enemy, spawn.id);
        this.enemyBySpawnId.set(spawn.id, enemy);
        this.enemyPreviousPositions.set(enemy, enemy.group.position.clone());
        const leashRegions: RouteShape[] = [];
        for (const sectionId of spawn.leashSectionIds) {
          const section = FIRMAMENT_ROUTE.sections.find((candidate) => candidate.id === sectionId);
          if (section) leashRegions.push(...(section.walkable as readonly RouteShape[]));
        }
        this.enemyLeashRegions.set(enemy, leashRegions.length > 0 ? leashRegions : FIRMAMENT_ROUTE_WALKABLE);
        this.scene.add(enemy.group);
        if (spawn.kind === 'orreryCastellan') this.midpointBoss = enemy;
        if (spawn.kind === 'eclipseArchon') finalBoss = enemy;
      }
    }

    if (!finalBoss || !this.midpointBoss) throw new Error('The campaign requires both midpoint and final bosses.');
    return finalBoss;
  }

  private createLandmarks(): THREE.Group {
    const root = new THREE.Group();
    root.name = 'gameplay-landmarks';
    const stoneMaterial = new THREE.MeshStandardMaterial({ color: '#111a24', roughness: 0.9, metalness: 0.08 });
    const runeMaterial = new THREE.MeshStandardMaterial({ color: '#77d8ce', emissive: '#1e837f', emissiveIntensity: 1.35, roughness: 0.28 });
    for (const [index, obstacle] of OBSTACLES.entries()) {
      const stone = new THREE.Mesh(
        index === 0 ? new THREE.CylinderGeometry(obstacle.radius * 0.82, obstacle.radius, 3.8, 9) : new THREE.DodecahedronGeometry(obstacle.radius, 0),
        stoneMaterial,
      );
      stone.position.set(obstacle.x, index === 0 ? 1.9 : obstacle.radius * 0.82, obstacle.z);
      stone.scale.y = index === 0 ? 1 : 1.45;
      stone.rotation.y = index * 1.73;
      stone.castShadow = true;
      stone.receiveShadow = true;
      root.add(stone);
      const rune = new THREE.Mesh(new THREE.TorusGeometry(obstacle.radius * 0.62, 0.035, 6, 24), runeMaterial);
      rune.position.set(obstacle.x, 0.06, obstacle.z);
      rune.rotation.x = -Math.PI / 2;
      root.add(rune);
    }
    const bossSeal = new THREE.Mesh(
      new THREE.RingGeometry(3.8, 4.05, 64),
      new THREE.MeshBasicMaterial({ color: '#d52366', transparent: true, opacity: 0.5, depthWrite: false }),
    );
    bossSeal.position.set(BOSS_POSITION.x, 0.06, BOSS_POSITION.z);
    bossSeal.rotation.x = -Math.PI / 2;
    root.add(bossSeal);
    return root;
  }

  private clearProjectiles(): void {
    for (const projectile of this.projectiles) {
      this.scene.remove(projectile.group);
      projectile.dispose();
    }
    this.projectiles.length = 0;
  }

  private getCurrentObjective(): string {
    if (this.phase === 'menu') return 'Choose the pilgrim who will restore the sky';
    if (this.phase === 'dead') return 'Fallen — returning to the last restored body';
    if (this.phase === 'victory') return 'The Eclipse Archon is defeated; the firmament remembers';
    const activeBoss = this.getActiveBoss();
    if (this.phase === 'boss' && activeBoss) return `Defeat ${activeBoss.displayName} — phase ${activeBoss.phase}`;
    const readyRelic = this.relics.find((candidate) => candidate.state === 'ready');
    if (readyRelic) return `Claim the restored ${readyRelic.kind} body`;
    return this.encounterDirector.objective;
  }

  private findCurrentSection(): RouteSectionDefinition | null {
    const position = this.player.group.position;
    return (
      FIRMAMENT_ROUTE.sections.find((section) =>
        this.collision.containsInWalkableUnion(position, this.player.radius * 0.25, section.walkable),
      ) ?? null
    );
  }

  private publishDiagnostics(forceEvent = false): void {
    if (!forceEvent && this.frame % 6 !== 0) return;
    const activeByKind = (kind: RouteEnemyKind): number =>
      this.enemies.filter((enemy) => enemy.kind === kind && enemy.active && !enemy.dormant).length;
    const activeBoss = this.getActiveBoss();
    const routeSnapshot = this.encounterDirector.getSnapshot();
    const info = this.renderer.info;
    const snapshot = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: this.restoredCount + (this.phase === 'victory' ? 1 : 0),
      targetScore: PROGRESSION_TARGET,
      complete: this.phase === 'victory',
      phase: this.phase,
      paused: this.phase === 'paused',
      dead: this.phase === 'dead',
      victory: this.phase === 'victory',
      app: {
        screen: this.phase === 'menu' ? 'main-menu' : 'game',
        inputEnabled: this.phase !== 'menu',
      },
      character: { ...this.characterProfile },
      objective: this.getCurrentObjective(),
      restorationCount: this.restoredCount,
      restoredBodies: this.relics.filter((relic) => relic.state === 'restored').map((relic) => relic.kind),
      player: {
        position: {
          x: this.player.group.position.x,
          y: this.player.group.position.y,
          z: this.player.group.position.z,
        },
        speed: this.player.velocity.length(),
        health: this.player.health,
        maxHealth: this.player.maxHealth,
        stamina: this.player.stamina,
        maxStamina: this.player.maxStamina,
        focus: this.player.focus,
        maxFocus: this.player.maxFocus,
        invulnerable: this.player.isInvulnerable,
        dodging: this.player.isDodging,
      },
      enemies: {
        active: this.enemies.filter((enemy) => enemy.active && !enemy.dormant && !enemy.isBoss).length,
        defeated: this.defeatedEnemies,
        byType: {
          wisp: activeByKind('wisp'),
          sentinel: activeByKind('sentinel'),
          seer: activeByKind('seer'),
          ashenInitiate: activeByKind('ashenInitiate'),
          astralLancer: activeByKind('astralLancer'),
          eclipseChorister: activeByKind('eclipseChorister'),
          orreryCastellan: activeByKind('orreryCastellan'),
          eclipseArchon: activeByKind('eclipseArchon'),
        },
      },
      boss: {
        spawned: Boolean(activeBoss && !activeBoss.dormant),
        active: Boolean(activeBoss?.active && !activeBoss.dormant),
        health: activeBoss?.health ?? 0,
        maxHealth: activeBoss?.maxHealth ?? 0,
        phase: activeBoss?.phase ?? 1,
        name: activeBoss?.displayName ?? '',
        epithet: activeBoss?.epithet ?? '',
      },
      progression: {
        restored: this.restoredCount,
        target: this.relics.length,
        charms: [...this.player.charms],
        equipment: { ...this.player.equipment },
      },
      affinity: { ...this.affinity },
      comprehension: {
        lunar: { ...this.comprehension.lunar },
        aurora: { ...this.comprehension.aurora },
      },
      combat: {
        damageDealt: this.damageDealt,
        damageTaken: this.damageTaken,
        projectiles: this.projectiles.length,
        lockedTarget: this.lockedTarget?.id ?? null,
        activeCollisions: this.collision.activeContacts,
      },
      route: {
        activeEncounterId: routeSnapshot.activeEncounterId,
        nextEncounterId: routeSnapshot.nextEncounterId,
        currentCheckpointId: routeSnapshot.currentCheckpointId,
        completedEncounterIds: [...routeSnapshot.completedEncounterIds],
        gateStates: Object.fromEntries(routeSnapshot.gates.map((gate) => [gate.id, gate.state])),
        campaignComplete: routeSnapshot.campaignComplete,
        currentSectionId: this.findCurrentSection()?.id ?? FIRMAMENT_ROUTE.start.sectionId,
      },
      simulation: {
        engine: 'deterministic-custom-circles',
        fixedStep: FIXED_STEP,
        colliderCount: this.collision.routeRegionCount + this.collision.dynamicGateCount + this.enemies.filter((enemy) => enemy.active).length + 1,
        walkableRegionCount: this.collision.routeRegionCount,
        dynamicGateCount: this.collision.dynamicGateCount,
        closedGateCount: this.collision.closedGateCount,
        ccdProjectiles: this.projectiles.length,
      },
      vfx: this.vfx.getStats(),
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
      },
    };
    (window as RuntimeWindow).__THREE_GAME_DIAGNOSTICS__ = snapshot;
    window.dispatchEvent(new CustomEvent('celestial-game-state', { detail: snapshot }));
  }

  private installTestHooks(): void {
    if (!import.meta.env.DEV) return;
    (window as RuntimeWindow).__CELESTIAL_GAME_TEST__ = {
      start: () => {
        if (this.phase === 'dead') this.restartFromCheckpoint();
        if (this.phase === 'paused') this.phase = this.phaseBeforePause;
      },
      damagePlayer: (amount = 25) => this.damagePlayer(amount, true),
      restoreNextBody: () => {
        const relic = this.relics.find((candidate) => candidate.state !== 'restored');
        if (!relic) return;
        const checkpoint = FIRMAMENT_ROUTE.checkpoints[relic.index];
        const unlockEncounter = checkpoint
          ? FIRMAMENT_ROUTE.encounters.find((encounter) => encounter.id === checkpoint.unlocksAfterEncounterId)
          : null;
        while (
          unlockEncounter &&
          this.encounterDirector.nextEncounter &&
          this.encounterDirector.nextEncounter.order <= unlockEncounter.order
        ) {
          this.forceCompleteEncounter(this.encounterDirector.nextEncounter.id);
        }
        relic.setReady();
        this.restoreRelic(relic);
        if (this.restoredCount === this.relics.length) this.awakenBoss();
        this.publishDiagnostics(true);
      },
      spawnBoss: () => this.awakenBoss(),
      defeatBoss: () => {
        if (this.boss.dormant) this.awakenBoss();
        this.damageEnemy(this.boss, this.boss.health + 1, 'lunar');
      },
      restart: () => this.restartFullRun(),
      activateNextEncounter: () => {
        const encounter = this.encounterDirector.nextEncounter;
        if (!encounter || !this.encounterDirector.activateEncounter(encounter.id)) return;
        this.placePlayerForEncounter(encounter);
        this.onEncounterActivated(encounter.id);
        this.publishDiagnostics(true);
      },
      defeatActiveEncounter: () => {
        const encounter = this.encounterDirector.activeEncounter;
        if (!encounter) return;
        for (const spawn of encounter.spawns) {
          const enemy = this.enemyBySpawnId.get(spawn.id);
          if (!enemy?.active) continue;
          if (enemy.dormant) {
            this.enemyWakeAt.delete(enemy);
            enemy.awaken();
          }
          this.damageEnemy(enemy, enemy.health + 1, 'lunar');
        }
        this.publishDiagnostics(true);
      },
      claimAvailableCheckpoint: () => {
        const snapshot = this.encounterDirector.getSnapshot();
        const availableIndex = snapshot.checkpoints.findIndex((checkpoint) => checkpoint.state === 'available');
        if (availableIndex < 0) return;
        const relic = this.relics[availableIndex];
        if (!relic) return;
        relic.setReady();
        this.restoreRelic(relic);
        this.publishDiagnostics(true);
      },
      showEncounter: (encounterId) => {
        const target = FIRMAMENT_ROUTE.encounters.find((encounter) => encounter.id === encounterId);
        if (!target) return;
        while (this.encounterDirector.nextEncounter && this.encounterDirector.nextEncounter.order < target.order) {
          const prior = this.encounterDirector.nextEncounter;
          this.forceCompleteEncounter(prior.id);
          const checkpointIndex = FIRMAMENT_ROUTE.checkpoints.findIndex(
            (checkpoint) => checkpoint.unlocksAfterEncounterId === prior.id,
          );
          const relic = this.relics[checkpointIndex];
          if (relic && relic.state !== 'restored') {
            relic.setReady();
            this.restoreRelic(relic);
          }
        }
        if (this.encounterDirector.nextEncounter?.id === target.id && this.encounterDirector.activateEncounter(target.id)) {
          this.placePlayerForEncounter(target);
          this.onEncounterActivated(target.id);
        }
        this.publishDiagnostics(true);
      },
      showSection: (sectionId) => {
        const section = FIRMAMENT_ROUTE.sections.find((candidate) => candidate.id === sectionId);
        const shape = section?.walkable[0];
        if (!section || !shape) return;
        const position = new THREE.Vector3(shape.center[0], 0.02, shape.center[1]);
        this.player.restoreAt(position);
        this.player.setFacing(new THREE.Vector3(section.cameraForward[0], 0, section.cameraForward[1]));
        this.cameraRig.snapTo(position);
        this.publishDiagnostics(true);
      },
      victoryTrade: () => {
        if (this.boss.dormant) this.awakenBoss();
        this.damagePlayer(this.player.health + 1, true);
        this.damageEnemy(this.boss, this.boss.health + 1, 'lunar');
        this.publishDiagnostics(true);
      },
    };
  }

  private placePlayerForEncounter(encounter: EncounterDefinition): void {
    const section = FIRMAMENT_ROUTE.sections.find((candidate) => candidate.id === encounter.sectionIds[0]);
    const forward = new THREE.Vector3(
      section?.cameraForward[0] ?? 0,
      0,
      section?.cameraForward[1] ?? -1,
    ).normalize();
    const distance = encounter.boss === 'none' ? 1.8 : 4.5;
    const position = new THREE.Vector3(encounter.activation.center[0], 0.02, encounter.activation.center[1])
      .addScaledVector(forward, -distance);
    this.player.restoreAt(position);
    this.player.setFacing(forward);
    this.cameraRig.snapTo(position);
  }

  private emitAudio(name: string, intensity = 1): void {
    window.dispatchEvent(new CustomEvent('celestial-audio', { detail: { name, intensity } }));
  }

  private rendererAnisotropy(): number {
    try {
      return this.renderer?.capabilities.getMaxAnisotropy() ?? 1;
    } catch {
      return 1;
    }
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
