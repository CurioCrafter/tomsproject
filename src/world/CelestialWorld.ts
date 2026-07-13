import * as THREE from 'three';
import { MaterialLibrary } from '../assets/MaterialLibrary';
import { FIRMAMENT_ROUTE, FIRMAMENT_ROUTE_ALL_SECTIONS } from '../game/content/FirmamentRoute';
import { routeElevationAt, routeSectionElevationAt, type AnyRouteSection } from '../game/content/RouteGeometry';
import type { GateStateSnapshot, RouteBiomeId, RouteShape } from '../game/content/RouteTypes';

export type CelestialWorldOptions = {
  arenaHalfWidth?: number;
  arenaHalfDepth?: number;
  worldRadius?: number;
};

type AuroraUniforms = {
  time: { value: number };
  restoration: { value: number };
  auroraMap: { value: THREE.Texture };
};

type SkyUniforms = {
  restoration: { value: number };
  time: { value: number };
};

type DistanceCullable = Readonly<{
  object: THREE.Object3D;
  center: THREE.Vector3;
  maxDistance: number;
}>;

const BRANCH_CONTROLLED_GATE_IDS = new Set<string>(
  (FIRMAMENT_ROUTE.choices ?? []).flatMap((choice) => [
    choice.directGateId,
    ...choice.options.flatMap((option) => [option.entryGateId, option.exitGateId]),
  ]),
);
const BRANCH_OPTION_GATE_OWNERS = new Map<string, Readonly<{ choiceId: string; optionId: string }>>(
  (FIRMAMENT_ROUTE.choices ?? []).flatMap((choice) => choice.options.flatMap((option) => [
    [option.entryGateId, { choiceId: choice.id, optionId: option.id }] as const,
    [option.exitGateId, { choiceId: choice.id, optionId: option.id }] as const,
  ])),
);

export class CelestialWorld {
  readonly root = new THREE.Group();
  readonly playLayer = new THREE.Group();
  readonly foregroundLayer = new THREE.Group();
  readonly midgroundLayer = new THREE.Group();
  readonly farLayer = new THREE.Group();
  readonly skyLayer = new THREE.Group();

  private readonly materials: MaterialLibrary;
  private readonly ownsMaterials: boolean;
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();
  private readonly auroraUniforms: AuroraUniforms;
  private readonly skyUniforms: SkyUniforms;
  private readonly auroraMaterial: THREE.ShaderMaterial;
  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly starMaterial: THREE.PointsMaterial;
  private readonly starfield: THREE.Points;
  private readonly observatoryMechanism = new THREE.Group();
  private readonly floatingMonoliths: THREE.Object3D[] = [];
  private readonly gateVisuals = new Map<string, THREE.Group>();
  private readonly branchSectionVisuals = new Map<string, THREE.Object3D[]>();
  private readonly biomeAccentMaterials = new Map<RouteBiomeId, THREE.MeshStandardMaterial>();
  private readonly distanceCullables: DistanceCullable[] = [];
  private readonly focusPosition = new THREE.Vector3();
  private readonly beaconLight = new THREE.PointLight('#7debd8', 0, 12, 2);
  private restoration = 0;
  private disposed = false;

  constructor(materials?: MaterialLibrary, options: CelestialWorldOptions = {}) {
    this.materials = materials ?? new MaterialLibrary();
    this.ownsMaterials = !materials;
    this.root.name = 'celestialWorld';
    this.playLayer.name = 'world.playLayer';
    this.foregroundLayer.name = 'world.foregroundLayer';
    this.midgroundLayer.name = 'world.midgroundLayer';
    this.farLayer.name = 'world.farLayer';
    this.skyLayer.name = 'world.skyLayer';
    this.root.add(this.skyLayer, this.farLayer, this.midgroundLayer, this.playLayer, this.foregroundLayer);

    this.skyUniforms = {
      restoration: { value: 0 },
      time: { value: 0 },
    };
    this.skyMaterial = new THREE.ShaderMaterial({
      name: 'world.skyGradient',
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: this.skyUniforms,
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float restoration;
        uniform float time;
        varying vec3 vWorldPosition;
        void main() {
          float horizon = smoothstep(-9.0, 28.0, vWorldPosition.y);
          vec3 nightLow = vec3(0.025, 0.045, 0.075);
          vec3 nightHigh = vec3(0.006, 0.009, 0.028);
          vec3 healedLow = vec3(0.055, 0.145, 0.17);
          vec3 healedHigh = vec3(0.035, 0.055, 0.15);
          vec3 low = mix(nightLow, healedLow, restoration);
          vec3 high = mix(nightHigh, healedHigh, restoration);
          float pulse = sin(time * 0.08) * 0.008;
          gl_FragColor = vec4(mix(low, high, horizon) + pulse, 1.0);
        }
      `,
    });
    this.ownedMaterials.add(this.skyMaterial);

    this.auroraUniforms = {
      time: { value: 0 },
      restoration: { value: 0 },
      auroraMap: { value: this.materials.textures.aurora },
    };
    this.auroraMaterial = new THREE.ShaderMaterial({
      name: 'world.auroraCurtain',
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: this.auroraUniforms,
      vertexShader: `
        uniform float time;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.z += sin(p.x * 0.16 + time * 0.18) * 0.65 + sin(p.y * 0.25 - time * 0.1) * 0.22;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D auroraMap;
        uniform float time;
        uniform float restoration;
        varying vec2 vUv;
        void main() {
          vec2 uv = vec2(fract(vUv.x + time * 0.006), vUv.y);
          vec4 texel = texture2D(auroraMap, uv);
          float edge = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
          float shimmer = 0.72 + sin(vUv.x * 18.0 + time * 0.8) * 0.16;
          float alpha = max(texel.r, 0.24) * edge * shimmer * (0.34 + restoration * 0.5);
          float bloodBand = smoothstep(0.38, 0.72, sin((vUv.x + time * 0.004) * 14.0) * 0.5 + 0.5);
          vec3 color = mix(vec3(0.08, 0.78, 0.46), vec3(0.72, 0.08, 0.18), bloodBand * 0.62 + texel.b * 0.18);
          gl_FragColor = vec4(color * (0.8 + restoration * 0.8), alpha);
        }
      `,
    });
    this.auroraMaterial.forceSinglePass = true;
    this.ownedMaterials.add(this.auroraMaterial);

    this.starMaterial = new THREE.PointsMaterial({
      name: 'world.stars',
      color: '#d9efff',
      size: 0.12,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.ownedMaterials.add(this.starMaterial);
    this.starfield = this.createStarfield(options.worldRadius ?? 52);

    const arenaHalfWidth = options.arenaHalfWidth ?? 11;
    const arenaHalfDepth = options.arenaHalfDepth ?? 7;
    const worldRadius = options.worldRadius ?? 52;
    this.buildSky(worldRadius);
    this.buildLinearRoute();
    this.buildForeground(arenaHalfWidth, arenaHalfDepth);
    this.buildSpireFields(arenaHalfWidth, arenaHalfDepth);
    this.buildObservatory();
    this.buildFarSilhouettes(worldRadius);

    this.beaconLight.name = 'world.restorationBeaconLight';
    const finalSection = FIRMAMENT_ROUTE.sections[FIRMAMENT_ROUTE.sections.length - 1];
    this.beaconLight.position.set(finalSection.walkable[0].center[0], 4.8, finalSection.walkable[0].center[1]);
    this.midgroundLayer.add(this.beaconLight);
  }

  update(delta: number, elapsed: number, restorationLevel: number): void {
    const target = THREE.MathUtils.clamp(restorationLevel, 0, 1);
    this.restoration = THREE.MathUtils.damp(this.restoration, target, 2.4, delta);
    this.skyUniforms.time.value = elapsed;
    this.skyUniforms.restoration.value = this.restoration;
    this.auroraUniforms.time.value = elapsed;
    this.auroraUniforms.restoration.value = this.restoration;
    this.starMaterial.opacity = THREE.MathUtils.lerp(0.68, 0.92, this.restoration);
    this.starMaterial.size = THREE.MathUtils.lerp(0.1, 0.17, this.restoration);
    this.starfield.rotation.y = elapsed * 0.004;
    this.skyLayer.rotation.y = Math.sin(elapsed * 0.025) * 0.025;
    this.observatoryMechanism.rotation.y = elapsed * (0.035 + this.restoration * 0.16);
    this.observatoryMechanism.rotation.z = Math.sin(elapsed * 0.17) * 0.045;
    this.beaconLight.intensity = this.restoration * 9;

    for (const entry of this.distanceCullables) {
      const dx = entry.center.x - this.focusPosition.x;
      const dz = entry.center.z - this.focusPosition.z;
      const branchVisible = entry.object.userData.branchRouteVisible !== false;
      entry.object.visible = branchVisible && dx * dx + dz * dz <= entry.maxDistance * entry.maxDistance;
    }

    this.floatingMonoliths.forEach((monolith, index) => {
      const phase = elapsed * (0.22 + index * 0.018) + index * 1.7;
      monolith.position.y = monolith.userData.baseY + Math.sin(phase) * (0.08 + this.restoration * 0.16);
      monolith.rotation.y += delta * (index % 2 === 0 ? 0.045 : -0.038) * (0.3 + this.restoration);
    });

    this.gateVisuals.forEach((gate) => {
      const portcullis = gate.getObjectByName('gatePortcullis');
      const ward = gate.getObjectByName('gateWard');
      const seal = gate.getObjectByName('gateSeal');
      const open = Boolean(gate.userData.open);
      if (ward) ward.visible = !open;
      if (portcullis) {
        if (!open) portcullis.visible = true;
        portcullis.position.y = THREE.MathUtils.damp(portcullis.position.y, open ? 3.65 : 0.08, 7, delta);
        if (open && portcullis.position.y >= 3.45) portcullis.visible = false;
      }
      if (seal instanceof THREE.Mesh && seal.material instanceof THREE.MeshBasicMaterial) {
        seal.material.opacity = THREE.MathUtils.damp(seal.material.opacity, open ? 0 : 0.42, 8, delta);
        seal.visible = seal.material.opacity > 0.015;
      }
    });
  }

  setGateStates(states: readonly GateStateSnapshot[]): void {
    for (const state of states) {
      const gate = this.gateVisuals.get(state.id);
      if (gate) gate.userData.open = state.state === 'open';
    }
  }

  setBranchSelections(selections: readonly Readonly<{ choiceId: string; optionId: string }>[]): void {
    const selectedByChoice = new Map(selections.map((selection) => [selection.choiceId, selection.optionId]));
    for (const section of FIRMAMENT_ROUTE.branchSections ?? []) {
      const visible = selectedByChoice.get(section.choiceId) === section.optionId;
      for (const object of this.branchSectionVisuals.get(section.id) ?? []) {
        object.userData.branchRouteVisible = visible;
        object.visible = visible;
      }
    }
    for (const [gateId, owner] of BRANCH_OPTION_GATE_OWNERS) {
      const gate = this.gateVisuals.get(gateId);
      if (!gate) continue;
      const visible = selectedByChoice.get(owner.choiceId) === owner.optionId;
      gate.userData.branchRouteVisible = visible;
      gate.visible = visible;
    }
  }

  setFocusPosition(position: THREE.Vector3): void {
    this.focusPosition.copy(position);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geometries.forEach((geometry) => geometry.dispose());
    this.ownedMaterials.forEach((material) => material.dispose());
    if (this.ownsMaterials) this.materials.dispose();
    this.root.clear();
  }

  private track<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  private registerCullable(object: THREE.Object3D, x: number, y: number, z: number, maxDistance = 34): void {
    this.distanceCullables.push({ object, center: new THREE.Vector3(x, y, z), maxDistance });
  }

  private mesh(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D,
    shadows = true,
  ): THREE.Mesh {
    this.track(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    parent.add(mesh);
    return mesh;
  }

  private buildSky(radius: number): void {
    const dome = this.mesh('skyDome', new THREE.SphereGeometry(radius, 32, 16), this.skyMaterial, this.skyLayer, false);
    dome.position.y = -7;
    dome.frustumCulled = false;
    this.skyLayer.add(this.starfield);

    const curtainGeometry = this.track(new THREE.PlaneGeometry(52, 18, 42, 12));
    for (let i = 0; i < 3; i += 1) {
      const curtain = new THREE.Mesh(curtainGeometry, this.auroraMaterial);
      curtain.name = `auroraCurtain.${i}`;
      curtain.position.set((i - 1) * 27, 20 + i * 2.4, -48 + Math.abs(i - 1) * 5);
      curtain.rotation.y = (i - 1) * -0.36;
      curtain.rotation.z = (i - 1) * 0.09;
      curtain.frustumCulled = false;
      this.skyLayer.add(curtain);
    }
  }

  private createStarfield(radius: number): THREE.Points {
    const positions: number[] = [];
    let seed = 0x0c31157;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let i = 0; i < 620; i += 1) {
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.lerp(-0.05, 0.94, random()));
      const distance = radius * THREE.MathUtils.lerp(0.78, 0.96, random());
      positions.push(
        Math.sin(phi) * Math.cos(theta) * distance,
        Math.cos(phi) * distance + 5,
        Math.sin(phi) * Math.sin(theta) * distance,
      );
    }
    const geometry = this.track(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, this.starMaterial);
    points.name = 'celestialStarfield';
    points.frustumCulled = false;
    return points;
  }

  private buildLinearRoute(): void {
    const chasmMaterial = new THREE.MeshStandardMaterial({
      name: 'world.lightlessChasm',
      color: '#010307',
      roughness: 1,
      metalness: 0,
    });
    this.ownedMaterials.add(chasmMaterial);
    const chasm = this.mesh('lightlessChasm', new THREE.PlaneGeometry(92, 142), chasmMaterial, this.playLayer, false);
    chasm.rotation.x = -Math.PI / 2;
    // Keep the void floor below the deepest authored crypt so descended paths
    // remain visible rather than being occluded by the old flat backdrop.
    chasm.position.set(0, -6.8, -10.5);

    const routeLayers = [this.playLayer, this.foregroundLayer, this.midgroundLayer, this.farLayer] as const;
    for (const section of FIRMAMENT_ROUTE_ALL_SECTIONS) {
      const childCounts = routeLayers.map((layer) => layer.children.length);
      section.walkable.forEach((shape, shapeIndex) => this.buildRouteSectionShape(section, shape, shapeIndex));
      if (section.kind === 'bridge' || section.kind === 'causeway' || section.kind === 'processional') {
        section.walkable.forEach((shape) => {
          if (shape.kind === 'obb') this.buildBridgeDetails(section, shape);
        });
      } else {
        this.buildCourtDetails(section);
      }
      if ('biome' in section && section.biome) this.buildBiomeEnvironment(section);
      if ('choiceId' in section) {
        const visuals = routeLayers.flatMap((layer, index) => layer.children.slice(childCounts[index]));
        visuals.forEach((object) => {
          object.userData.branchRouteVisible = false;
          object.visible = false;
        });
        this.branchSectionVisuals.set(section.id, visuals);
      }
    }

    for (const gate of FIRMAMENT_ROUTE.gates) {
      this.buildRouteGate(
        gate.id,
        gate.sectionId,
        gate.collider.a,
        gate.collider.b,
        gate.initialState === 'open',
        BRANCH_CONTROLLED_GATE_IDS.has(gate.id) ? 'ward' : 'portcullis',
      );
    }
    this.buildSchoolSpire();
  }

  private buildRouteSectionShape(section: AnyRouteSection, shape: RouteShape, shapeIndex: number): void {
    const biome = 'biome' in section ? section.biome ?? 'moonless-tundra' : 'moonless-tundra';
    const floorMaterial = this.materials.getBiomeFloor(biome);
    const elevation = routeSectionElevationAt(section, shape.center);
    if (shape.kind === 'circle') {
      const foundation = this.mesh(
        `${section.id}.foundation.${shapeIndex}`,
        new THREE.CylinderGeometry(shape.radius, shape.radius + 0.48, 0.56, Math.max(18, Math.round(shape.radius * 4))),
        floorMaterial,
        this.playLayer,
      );
      foundation.position.set(shape.center[0], elevation - 0.3, shape.center[1]);
      const frostLip = this.mesh(
        `${section.id}.frostLip.${shapeIndex}`,
        new THREE.TorusGeometry(shape.radius * 0.94, 0.095, 6, 48),
        this.materials.get('snowCrust'),
        this.playLayer,
        false,
      );
      frostLip.position.set(shape.center[0], elevation + 0.015, shape.center[1]);
      frostLip.rotation.x = Math.PI / 2;
      this.registerCullable(foundation, shape.center[0], elevation, shape.center[1]);
      this.registerCullable(frostLip, shape.center[0], elevation, shape.center[1]);
      return;
    }

    const width = shape.halfExtents[0] * 2;
    const depth = shape.halfExtents[1] * 2;
    if (section.kind === 'stair' && section.elevation && Math.abs(section.elevation.end - section.elevation.start) > 0.05) {
      this.buildStairFlight(section, shape, floorMaterial, shapeIndex);
      return;
    }
    const foundation = this.mesh(
      `${section.id}.foundation.${shapeIndex}`,
      new THREE.BoxGeometry(width, 0.5, depth),
      floorMaterial,
      this.playLayer,
    );
    foundation.position.set(shape.center[0], elevation - 0.27, shape.center[1]);
    foundation.rotation.y = -shape.rotation;
    const inlay = this.mesh(
      `${section.id}.routeInlay.${shapeIndex}`,
      new THREE.BoxGeometry(Math.max(0.42, width * 0.12), 0.035, depth * 0.94),
      this.materials.get('slateEdge'),
      this.playLayer,
      false,
    );
    inlay.position.set(shape.center[0], elevation + 0.012, shape.center[1]);
    inlay.rotation.y = -shape.rotation;
    this.registerCullable(foundation, shape.center[0], elevation, shape.center[1]);
    this.registerCullable(inlay, shape.center[0], elevation, shape.center[1]);
  }

  private buildStairFlight(
    section: AnyRouteSection,
    shape: Extract<RouteShape, { kind: 'obb' }>,
    material: THREE.Material,
    shapeIndex: number,
  ): void {
    const profile = section.elevation ?? { start: 0, end: 0 };
    const forwardLength = Math.hypot(section.cameraForward[0], section.cameraForward[1]) || 1;
    const forwardX = section.cameraForward[0] / forwardLength;
    const forwardZ = section.cameraForward[1] / forwardLength;
    const landingDepth = THREE.MathUtils.clamp(profile.landingDepth ?? 0, 0, Math.max(0, shape.halfExtents[1] - 0.5));
    const visualHalfDepth = shape.halfExtents[1] - landingDepth;
    const depth = visualHalfDepth * 2;
    const count = THREE.MathUtils.clamp(Math.max(Math.ceil(depth / 0.55), Math.ceil(Math.abs(profile.end - profile.start) * 4)), 10, 30);
    const stepDepth = depth / count;
    const stepGeometry = this.track(new THREE.BoxGeometry(shape.halfExtents[0] * 2, 0.24, stepDepth + 0.08));
    const steps = new THREE.InstancedMesh(stepGeometry, material, count);
    steps.name = `${section.id}.stairFlight.${shapeIndex}`;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(forwardX, forwardZ), 0));
    for (let index = 0; index < count; index += 1) {
      const ratio = (index + 0.5) / count;
      const distance = THREE.MathUtils.lerp(-depth * 0.5 + stepDepth * 0.5, depth * 0.5 - stepDepth * 0.5, ratio);
      const top = THREE.MathUtils.lerp(profile.start, profile.end, (index + 1) / count);
      matrix.compose(
        new THREE.Vector3(shape.center[0] + forwardX * distance, top - 0.12, shape.center[1] + forwardZ * distance),
        quaternion,
        new THREE.Vector3(1, 1, 1),
      );
      steps.setMatrixAt(index, matrix);
    }
    steps.instanceMatrix.needsUpdate = true;
    steps.castShadow = true;
    steps.receiveShadow = true;
    this.playLayer.add(steps);
    this.registerCullable(steps, shape.center[0], (profile.start + profile.end) * 0.5, shape.center[1]);

    const postIndices = Array.from({ length: Math.ceil(count / 3) + 1 }, (_, index) => Math.min(count - 1, index * 3));
    const postGeometry = this.track(new THREE.CylinderGeometry(0.07, 0.1, 0.72, 6));
    const posts = new THREE.InstancedMesh(postGeometry, this.biomeAccent(section), postIndices.length * 2);
    posts.name = `${section.id}.stairLanternPosts`;
    let instance = 0;
    for (const stepIndex of postIndices) {
      const ratio = (stepIndex + 0.5) / count;
      const distance = THREE.MathUtils.lerp(-depth * 0.5, depth * 0.5, ratio);
      const top = THREE.MathUtils.lerp(profile.start, profile.end, ratio);
      for (const side of [-1, 1]) {
        const sideX = forwardZ * side * (shape.halfExtents[0] - 0.15);
        const sideZ = -forwardX * side * (shape.halfExtents[0] - 0.15);
        matrix.makeTranslation(shape.center[0] + forwardX * distance + sideX, top + 0.34, shape.center[1] + forwardZ * distance + sideZ);
        posts.setMatrixAt(instance, matrix);
        instance += 1;
      }
    }
    posts.instanceMatrix.needsUpdate = true;
    posts.castShadow = true;
    this.foregroundLayer.add(posts);
    this.registerCullable(posts, shape.center[0], (profile.start + profile.end) * 0.5, shape.center[1]);
  }

  private buildBridgeDetails(section: AnyRouteSection, shape: Extract<RouteShape, { kind: 'obb' }>): void {
    const hubInset = section.id === 'fallen-orbit-bridge' ? 5.25 : 0;
    const forwardLength = Math.hypot(section.cameraForward[0], section.cameraForward[1]) || 1;
    const forwardX = section.cameraForward[0] / forwardLength;
    const forwardZ = section.cameraForward[1] / forwardLength;
    const group = new THREE.Group();
    group.name = `${section.id}.bridgeKit`;
    group.position.set(
      shape.center[0] + forwardX * hubInset * 0.5,
      routeSectionElevationAt(section, shape.center),
      shape.center[1] + forwardZ * hubInset * 0.5,
    );
    group.rotation.y = -shape.rotation;
    this.foregroundLayer.add(group);
    this.registerCullable(group, group.position.x, group.position.y, group.position.z);

    const halfWidth = shape.halfExtents[0];
    const halfDepth = shape.halfExtents[1] - hubInset * 0.5;
    const railGeometry = this.track(new THREE.BoxGeometry(0.18, 0.28, 1.45));
    const postGeometry = this.track(new THREE.CylinderGeometry(0.1, 0.14, 0.92, 6));
    const railTransforms: THREE.Matrix4[] = [];
    const postTransforms: THREE.Matrix4[] = [];
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const count = Math.max(3, Math.floor((halfDepth * 2) / 1.55));
    for (let index = 0; index <= count; index += 1) {
      const z = THREE.MathUtils.lerp(-halfDepth + 0.62, halfDepth - 0.62, index / count);
      for (const side of [-1, 1]) {
        matrix.compose(new THREE.Vector3(side * (halfWidth - 0.18), 0.43, z), quaternion, new THREE.Vector3(1, 1, 1));
        postTransforms.push(matrix.clone());
        const authoredOrder = 'order' in section ? section.order : section.id.length;
        if (index < count && (index + authoredOrder + (side < 0 ? 1 : 0)) % 5 !== 0) {
          const nextZ = THREE.MathUtils.lerp(-halfDepth + 0.62, halfDepth - 0.62, (index + 0.5) / count);
          matrix.compose(new THREE.Vector3(side * (halfWidth - 0.18), 0.66, nextZ), quaternion, new THREE.Vector3(1, 1, 1));
          railTransforms.push(matrix.clone());
        }
      }
    }
    const posts = new THREE.InstancedMesh(postGeometry, this.materials.get('obsidian'), postTransforms.length);
    posts.name = `${section.id}.parapetPosts`;
    postTransforms.forEach((transform, index) => posts.setMatrixAt(index, transform));
    posts.instanceMatrix.needsUpdate = true;
    posts.castShadow = true;
    group.add(posts);
    const rails = new THREE.InstancedMesh(railGeometry, this.materials.get('lunarSilver'), railTransforms.length);
    rails.name = `${section.id}.brokenParapets`;
    railTransforms.forEach((transform, index) => rails.setMatrixAt(index, transform));
    rails.instanceMatrix.needsUpdate = true;
    group.add(rails);

    for (const end of [-1, 1]) {
      const lamp = new THREE.Group();
      lamp.name = `${section.id}.runeLamp.${end < 0 ? 'near' : 'far'}`;
      lamp.position.set(0, 0, end * (halfDepth - 0.55));
      const base = this.mesh('lampBase', new THREE.CylinderGeometry(0.32, 0.44, 0.44, 8), this.materials.get('blackSlate'), lamp);
      base.position.y = 0.2;
      const core = this.mesh('lampCore', new THREE.OctahedronGeometry(0.18, 0), this.materials.get('moonstone'), lamp, false);
      core.position.y = 0.72;
      group.add(lamp);
    }
  }

  private buildCourtDetails(section: AnyRouteSection): void {
    const circle = section.walkable.find((shape): shape is Extract<RouteShape, { kind: 'circle' }> => shape.kind === 'circle');
    if (!circle) return;
    const elevation = routeSectionElevationAt(section, circle.center);
    const columnGeometry = this.track(new THREE.CylinderGeometry(0.22, 0.34, 1.9, 7));
    const matrix = new THREE.Matrix4();
    const transforms: THREE.Matrix4[] = [];
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const radius = circle.radius + 0.18;
      const localX = Math.sin(angle) * radius;
      const localZ = Math.cos(angle) * radius;
      if (!this.routeMouthIsClear(section, circle.center, localX, localZ, 1.7)) continue;
      matrix.compose(
        new THREE.Vector3(circle.center[0] + localX, elevation + 0.88 - (index % 3) * 0.12, circle.center[1] + localZ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle + index * 0.19, (index % 2 === 0 ? 1 : -1) * 0.035)),
        new THREE.Vector3(1, 0.72 + (index % 3) * 0.13, 1),
      );
      transforms.push(matrix.clone());
    }
    const columns = new THREE.InstancedMesh(columnGeometry, this.materials.get('blackSlate'), transforms.length);
    columns.name = `${section.id}.weatheredColumns`;
    transforms.forEach((transform, index) => columns.setMatrixAt(index, transform));
    columns.instanceMatrix.needsUpdate = true;
    columns.castShadow = true;
    this.midgroundLayer.add(columns);
    this.registerCullable(columns, circle.center[0], elevation, circle.center[1]);
  }

  private biomeId(section: AnyRouteSection): RouteBiomeId {
    return 'biome' in section ? section.biome ?? 'moonless-tundra' : 'moonless-tundra';
  }

  private biomeAccent(section: AnyRouteSection): THREE.MeshStandardMaterial {
    const biome = this.biomeId(section);
    const existing = this.biomeAccentMaterials.get(biome);
    if (existing) return existing;
    const palette: Readonly<Record<RouteBiomeId, readonly [string, string]>> = {
      'moonless-tundra': ['#aeefff', '#285c78'],
      'drowned-cloister': ['#79efff', '#075c72'],
      'verdant-cathedral': ['#a9ff72', '#1f7a43'],
      'ember-basilica': ['#ffad48', '#8c210d'],
      'amethyst-archives': ['#ed8dff', '#64159a'],
    };
    const [color, emissive] = palette[biome];
    const material = new THREE.MeshStandardMaterial({
      name: `material.biomeAccent.${biome}`,
      color,
      emissive,
      emissiveIntensity: 1.35,
      roughness: 0.28,
      metalness: 0.42,
    });
    this.biomeAccentMaterials.set(biome, material);
    this.ownedMaterials.add(material);
    return material;
  }

  private routeMouthIsClear(
    section: AnyRouteSection,
    origin: readonly [number, number],
    localX: number,
    localZ: number,
    halfWidth: number,
  ): boolean {
    for (const connectedId of section.connectsTo) {
      const connected = FIRMAMENT_ROUTE_ALL_SECTIONS.find((candidate) => candidate.id === connectedId);
      const target = connected?.walkable[0]?.center;
      if (!target) continue;
      const dx = target[0] - origin[0];
      const dz = target[1] - origin[1];
      const length = Math.hypot(dx, dz);
      if (length <= 0.001) continue;
      const forwardX = dx / length;
      const forwardZ = dz / length;
      const projection = localX * forwardX + localZ * forwardZ;
      const perpendicular = Math.abs(localX * forwardZ - localZ * forwardX);
      if (projection > 0 && perpendicular < halfWidth) return false;
    }
    return true;
  }

  private buildBiomeEnvironment(section: AnyRouteSection): void {
    const circle = section.walkable.find((shape): shape is Extract<RouteShape, { kind: 'circle' }> => shape.kind === 'circle');
    if (!circle) return;
    const biome = this.biomeId(section);
    const elevation = routeSectionElevationAt(section, circle.center);
    const group = new THREE.Group();
    group.name = `${section.id}.biomeArchitecture`;
    group.position.set(circle.center[0], elevation, circle.center[1]);
    this.midgroundLayer.add(group);
    this.registerCullable(group, circle.center[0], elevation, circle.center[1], 30);

    const floorMaterial = this.materials.getBiomeFloor(biome);
    const accent = this.biomeAccent(section);
    const forwardLength = Math.hypot(section.cameraForward[0], section.cameraForward[1]) || 1;
    const forwardX = section.cameraForward[0] / forwardLength;
    const forwardZ = section.cameraForward[1] / forwardLength;
    const cameraX = -forwardX;
    const cameraZ = -forwardZ;
    const columnHeight = biome === 'ember-basilica' ? 5.4 : biome === 'amethyst-archives' ? 4.7 : 4.15;
    const columnGeometry = this.track(new THREE.CylinderGeometry(0.24, 0.42, columnHeight, 8));
    const matrix = new THREE.Matrix4();
    const columnTransforms: THREE.Matrix4[] = [];
    for (let index = 0; index < 12; index += 1) {
      const angle = index / 12 * Math.PI * 2;
      const radialX = Math.sin(angle);
      const radialZ = Math.cos(angle);
      if (radialX * cameraX + radialZ * cameraZ > 0.16) continue;
      const radius = circle.radius + 0.65 + (index % 3 === 0 ? 0.35 : 0);
      const localX = radialX * radius;
      const localZ = radialZ * radius;
      if (!this.routeMouthIsClear(section, circle.center, localX, localZ, 2.05)) continue;
      matrix.compose(
        new THREE.Vector3(localX, columnHeight * 0.48, localZ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, (index % 2 ? -1 : 1) * 0.04)),
        new THREE.Vector3(1, 0.82 + (index % 4) * 0.06, 1),
      );
      columnTransforms.push(matrix.clone());
    }
    const columns = new THREE.InstancedMesh(columnGeometry, floorMaterial, columnTransforms.length);
    columns.name = `${section.id}.cathedralColumns`;
    columnTransforms.forEach((transform, index) => columns.setMatrixAt(index, transform));
    columns.instanceMatrix.needsUpdate = true;
    columns.castShadow = true;
    columns.receiveShadow = true;
    group.add(columns);

    const buttressGeometry = this.track(new THREE.BoxGeometry(0.34, 2.3, 1.15));
    const buttressTransforms: THREE.Matrix4[] = [];
    for (let index = 0; index < 12; index += 1) {
      const angle = index / 12 * Math.PI * 2;
      const radius = circle.radius + 1.9;
      const localX = Math.sin(angle) * radius;
      const localZ = Math.cos(angle) * radius;
      if (!this.routeMouthIsClear(section, circle.center, localX, localZ, 2.35)) continue;
      matrix.compose(
        new THREE.Vector3(localX, 1.15, localZ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, Math.sin(angle) * 0.18)),
        new THREE.Vector3(1, 1 + (index % 3) * 0.18, 1),
      );
      buttressTransforms.push(matrix.clone());
    }
    const buttresses = new THREE.InstancedMesh(buttressGeometry, floorMaterial, buttressTransforms.length);
    buttresses.name = `${section.id}.flyingButtresses`;
    buttressTransforms.forEach((transform, index) => buttresses.setMatrixAt(index, transform));
    buttresses.instanceMatrix.needsUpdate = true;
    buttresses.castShadow = true;
    group.add(buttresses);

    const rightX = forwardZ;
    const rightZ = -forwardX;
    const archPillarGeometry = this.track(new THREE.BoxGeometry(0.18, 2.8, 0.24));
    const archRoofGeometry = this.track(new THREE.BoxGeometry(0.16, 1.35, 0.22));
    const archPillars = new THREE.InstancedMesh(archPillarGeometry, accent, 6);
    const archRoofs = new THREE.InstancedMesh(archRoofGeometry, accent, 6);
    const archYaw = Math.atan2(forwardX, forwardZ);
    let archInstance = 0;
    for (let index = 0; index < 3; index += 1) {
      const offset = (index - 1) * 2.05;
      const centerX = forwardX * (circle.radius + 0.42) + rightX * offset;
      const centerZ = forwardZ * (circle.radius + 0.42) + rightZ * offset;
      for (const side of [-1, 1]) {
        matrix.compose(
          new THREE.Vector3(centerX + rightX * side * 0.72, 1.4, centerZ + rightZ * side * 0.72),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, archYaw, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        archPillars.setMatrixAt(archInstance, matrix);
        matrix.compose(
          new THREE.Vector3(centerX + rightX * side * 0.33, 3.2, centerZ + rightZ * side * 0.33),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, archYaw, -side * 0.64)),
          new THREE.Vector3(1, 1, 1),
        );
        archRoofs.setMatrixAt(archInstance, matrix);
        archInstance += 1;
      }
    }
    archPillars.name = `${section.id}.pointedArchPillars`;
    archRoofs.name = `${section.id}.pointedArchRoofs`;
    archPillars.instanceMatrix.needsUpdate = true;
    archRoofs.instanceMatrix.needsUpdate = true;
    group.add(archPillars, archRoofs);

    const propGeometry = this.track(
      biome === 'verdant-cathedral'
        ? new THREE.ConeGeometry(0.34, 2.2, 7)
        : biome === 'amethyst-archives'
          ? new THREE.OctahedronGeometry(0.5, 0)
          : this.createFacetedSpireGeometry(0.42, 1.7, 7),
    );
    const propTransforms: THREE.Matrix4[] = [];
    for (let index = 0; index < 22; index += 1) {
      const angle = index / 22 * Math.PI * 2 + (section.id.length % 5) * 0.13;
      const radialX = Math.sin(angle);
      const radialZ = Math.cos(angle);
      if (radialX * cameraX + radialZ * cameraZ > 0.3) continue;
      const radius = circle.radius + 3 + (index % 5) * 0.72;
      const height = 0.85 + (index % 4) * 0.26;
      const localX = radialX * radius;
      const localZ = radialZ * radius;
      if (!this.routeMouthIsClear(section, circle.center, localX, localZ, 2.65)) continue;
      matrix.compose(
        new THREE.Vector3(localX, height * 0.65 - 0.2, localZ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle * 1.7, (index % 3 - 1) * 0.1)),
        new THREE.Vector3(0.7 + (index % 3) * 0.25, height, 0.7 + ((index + 1) % 3) * 0.2),
      );
      propTransforms.push(matrix.clone());
    }
    const props = new THREE.InstancedMesh(propGeometry, biome === 'drowned-cloister' ? accent : floorMaterial, propTransforms.length);
    props.name = `${section.id}.regionalEnvironment`;
    propTransforms.forEach((transform, index) => props.setMatrixAt(index, transform));
    props.instanceMatrix.needsUpdate = true;
    props.castShadow = true;
    props.receiveShadow = true;
    group.add(props);

    if (biome === 'drowned-cloister') this.buildDrownedSanctuary(group, circle.radius, accent);
    else if (biome === 'verdant-cathedral') this.buildVerdantGlasshouse(group, circle.radius, accent);
    else if (biome === 'ember-basilica') this.buildEmberNave(group, circle.radius, accent);
    else if (biome === 'amethyst-archives') this.buildAmethystArchive(group, circle.radius, accent);

    const lightColor: Readonly<Record<RouteBiomeId, string>> = {
      'moonless-tundra': '#9defff',
      'drowned-cloister': '#3bdcf5',
      'verdant-cathedral': '#73ee83',
      'ember-basilica': '#ff6b30',
      'amethyst-archives': '#bc63ff',
    };
    const light = new THREE.PointLight(lightColor[biome], 3.6, circle.radius * 3.4, 2);
    light.name = `${section.id}.biomeLight`;
    light.position.set(0, 3.2, 0);
    group.add(light);
  }

  private buildDrownedSanctuary(group: THREE.Group, radius: number, accent: THREE.Material): void {
    for (let index = 0; index < 3; index += 1) {
      const angle = (index - 1) * 0.72;
      const bell = this.mesh(`drownedBell.${index}`, new THREE.SphereGeometry(0.48, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62), accent, group);
      bell.scale.set(0.82, 1.2, 0.82);
      bell.position.set(Math.sin(angle) * (radius + 0.4), 3.35 + index * 0.28, -Math.cos(angle) * (radius + 0.35));
      const cage = this.mesh(`bellCage.${index}`, new THREE.TorusGeometry(0.72, 0.055, 5, 20), this.materials.get('lunarSilver'), group, false);
      cage.position.copy(bell.position);
      cage.rotation.x = Math.PI / 2;
    }
  }

  private buildVerdantGlasshouse(group: THREE.Group, radius: number, accent: THREE.Material): void {
    for (let index = 0; index < 3; index += 1) {
      const pane = this.mesh(
        `glasshousePane.${index}`,
        new THREE.PlaneGeometry(1.8, 3.4),
        this.materials.get('glass'),
        group,
        false,
      );
      pane.position.set((index - 1) * 2.05, 2.05, -radius - 0.7);
      pane.rotation.y = (index - 1) * 0.12;
    }
    const rootGeometry = this.track(new THREE.CylinderGeometry(0.06, 0.13, 2.8, 6));
    const roots = new THREE.InstancedMesh(rootGeometry, accent, 14);
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < 14; index += 1) {
      const angle = index / 14 * Math.PI * 2;
      matrix.compose(
        new THREE.Vector3(Math.sin(angle) * (radius + 0.25), 1.05, Math.cos(angle) * (radius + 0.25)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((index % 3 - 1) * 0.3, angle, 0.2)),
        new THREE.Vector3(1, 0.75 + (index % 4) * 0.2, 1),
      );
      roots.setMatrixAt(index, matrix);
    }
    roots.instanceMatrix.needsUpdate = true;
    group.add(roots);
  }

  private buildEmberNave(group: THREE.Group, radius: number, accent: THREE.Material): void {
    const rose = this.mesh('emberRoseWindow', new THREE.RingGeometry(1.15, 1.46, 20), accent, group, false);
    rose.position.set(0, 4.5, -radius - 0.78);
    const spokesGeometry = this.track(new THREE.BoxGeometry(0.06, 2.7, 0.06));
    for (let index = 0; index < 8; index += 1) {
      const spoke = new THREE.Mesh(spokesGeometry, accent);
      spoke.name = `emberRoseSpoke.${index}`;
      spoke.position.copy(rose.position);
      spoke.rotation.z = index / 8 * Math.PI;
      group.add(spoke);
    }
    const brazierGeometry = this.track(new THREE.CylinderGeometry(0.28, 0.42, 0.82, 8));
    const braziers = new THREE.InstancedMesh(brazierGeometry, this.materials.get('celestialGold'), 6);
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < 6; index += 1) {
      const angle = index / 6 * Math.PI * 2;
      matrix.makeTranslation(Math.sin(angle) * (radius - 0.6), 0.42, Math.cos(angle) * (radius - 0.6));
      braziers.setMatrixAt(index, matrix);
    }
    braziers.instanceMatrix.needsUpdate = true;
    group.add(braziers);
  }

  private buildAmethystArchive(group: THREE.Group, radius: number, accent: THREE.Material): void {
    const shelfGeometry = this.track(new THREE.BoxGeometry(1.25, 0.12, 0.46));
    const shelves = new THREE.InstancedMesh(shelfGeometry, accent, 12);
    shelves.name = 'levitatingIndexShelves';
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < 12; index += 1) {
      const angle = index / 12 * Math.PI * 2;
      const y = 1.15 + (index % 4) * 0.78;
      matrix.compose(
        new THREE.Vector3(Math.sin(angle) * (radius + 0.15), y, Math.cos(angle) * (radius + 0.15)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, (index % 2 ? -1 : 1) * 0.08)),
        new THREE.Vector3(1, 1, 1),
      );
      shelves.setMatrixAt(index, matrix);
    }
    shelves.instanceMatrix.needsUpdate = true;
    group.add(shelves);
    for (let index = 0; index < 4; index += 1) {
      const crystal = this.mesh(`archiveMemoryCrystal.${index}`, new THREE.OctahedronGeometry(0.46 + index * 0.06, 0), accent, group, false);
      crystal.position.set((index - 1.5) * 2.1, 2.1 + (index % 2) * 0.8, -radius * 0.68);
      crystal.userData.baseY = crystal.position.y;
      this.floatingMonoliths.push(crystal);
    }
  }

  private buildRouteGate(
    id: string,
    sectionId: string,
    a: readonly [number, number],
    b: readonly [number, number],
    open: boolean,
    variant: 'portcullis' | 'ward',
  ): void {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    const group = new THREE.Group();
    group.name = `routeGate.${id}`;
    const midpoint: readonly [number, number] = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
    const section = FIRMAMENT_ROUTE_ALL_SECTIONS.find((candidate) => candidate.id === sectionId);
    const elevation = section ? routeSectionElevationAt(section, midpoint) : routeElevationAt(FIRMAMENT_ROUTE, midpoint);
    group.position.set(midpoint[0], elevation, midpoint[1]);
    group.rotation.y = -Math.atan2(dz, dx);
    group.userData.open = open;
    group.userData.variant = variant;
    this.foregroundLayer.add(group);
    this.registerCullable(group, midpoint[0], group.position.y, midpoint[1], 32);

    if (variant === 'ward') {
      const ward = new THREE.Group();
      ward.name = 'gateWard';
      ward.visible = !open;
      group.add(ward);

      const markerGeometry = this.track(new THREE.BoxGeometry(0.22, 1.25, 0.28));
      for (const side of [-1, 1]) {
        const marker = new THREE.Mesh(markerGeometry, this.materials.get('moonstone'));
        marker.name = `gateWardMarker.${side}`;
        marker.position.set(side * length * 0.5, 0.62, 0);
        marker.castShadow = true;
        ward.add(marker);
      }

      const sealMaterial = new THREE.MeshBasicMaterial({
        color: '#63e6db',
        transparent: true,
        opacity: open ? 0 : 0.3,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.ownedMaterials.add(sealMaterial);
      const seal = this.mesh(
        'gateSeal',
        new THREE.PlaneGeometry(Math.max(0.8, length - 0.2), 1.45),
        sealMaterial,
        ward,
        false,
      );
      seal.position.set(0, 0.78, -0.08);
      this.gateVisuals.set(id, group);
      return;
    }

    for (const side of [-1, 1]) {
      const pier = this.mesh(
        `gatePier.${side}`,
        new THREE.BoxGeometry(0.62, 3.5, 0.78),
        this.materials.get('blackSlate'),
        group,
      );
      pier.position.set(side * length * 0.5, 1.72, 0);
      const crown = this.mesh(
        `gateCrown.${side}`,
        new THREE.OctahedronGeometry(0.38, 0),
        this.materials.get('moonstone'),
        group,
        false,
      );
      crown.position.set(side * length * 0.5, 3.72, 0);
    }

    const portcullis = new THREE.Group();
    portcullis.name = 'gatePortcullis';
    portcullis.position.y = open ? 3.65 : 0.08;
    portcullis.visible = !open;
    group.add(portcullis);

    const innerWidth = Math.max(1, length - 0.7);
    const barCount = Math.max(3, Math.floor(innerWidth / 0.56) + 1);
    const barGeometry = this.track(new THREE.BoxGeometry(0.13, 2.65, 0.14));
    const bars = new THREE.InstancedMesh(barGeometry, this.materials.get('obsidian'), barCount);
    bars.name = 'gatePortcullisBars';
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < barCount; index += 1) {
      const x = THREE.MathUtils.lerp(-innerWidth * 0.5, innerWidth * 0.5, barCount === 1 ? 0.5 : index / (barCount - 1));
      matrix.makeTranslation(x, 1.42, 0);
      bars.setMatrixAt(index, matrix);
    }
    bars.instanceMatrix.needsUpdate = true;
    bars.castShadow = true;
    portcullis.add(bars);

    const railGeometry = this.track(new THREE.BoxGeometry(innerWidth + 0.18, 0.13, 0.18));
    for (const [index, y] of [0.52, 1.46, 2.38].entries()) {
      const rail = new THREE.Mesh(railGeometry, this.materials.get('lunarSilver'));
      rail.name = `gatePortcullisRail.${index}`;
      rail.position.y = y;
      rail.castShadow = true;
      portcullis.add(rail);
    }
    const sealMaterial = new THREE.MeshBasicMaterial({
      color: '#7debd8',
      transparent: true,
      opacity: open ? 0 : 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.ownedMaterials.add(sealMaterial);
    const seal = this.mesh('gateSeal', new THREE.PlaneGeometry(Math.max(1, length - 0.75), 2.7), sealMaterial, group, false);
    seal.position.set(0, 1.55, -0.12);
    seal.visible = !open;
    this.gateVisuals.set(id, group);
  }

  private buildSchoolSpire(): void {
    const spire = new THREE.Group();
    spire.name = 'spiralAstrologySchool';
    spire.position.set(9.5, 0, 49.5);
    this.midgroundLayer.add(spire);
    this.registerCullable(spire, 9.5, 0, 49.5, 44);
    for (let tier = 0; tier < 5; tier += 1) {
      const height = 3.2 + tier * 0.28;
      const tower = this.mesh(
        `schoolSpireTier.${tier}`,
        new THREE.CylinderGeometry(2.45 - tier * 0.24, 2.8 - tier * 0.22, height, 9),
        tier % 2 === 0 ? this.materials.get('blackSlate') : this.materials.get('obsidian'),
        spire,
      );
      tower.position.y = 1.5 + tier * 2.7;
      tower.rotation.y = tier * 0.31;
      const balcony = this.mesh(
        `schoolSpireBalcony.${tier}`,
        new THREE.TorusGeometry(2.52 - tier * 0.22, 0.12, 7, 36),
        this.materials.get('lunarSilver'),
        spire,
      );
      balcony.position.y = 2.95 + tier * 2.7;
      balcony.rotation.x = Math.PI / 2;
    }
    const crown = this.mesh('schoolSpireCrown', new THREE.ConeGeometry(1.65, 4.8, 7), this.materials.get('obsidian'), spire);
    crown.position.y = 16.4;
    const orrery = this.mesh('schoolSpireOrrery', new THREE.TorusKnotGeometry(1.15, 0.07, 80, 8, 2, 3), this.materials.get('celestialGold'), spire, false);
    orrery.position.y = 17.9;
  }

  private buildForeground(halfWidth: number, halfDepth: number): void {
    const rockGeometry = this.track(this.createFacetedSpireGeometry(0.72, 1.5, 7));
    const rocks = new THREE.InstancedMesh(rockGeometry, this.materials.get('slateEdge'), 18);
    rocks.name = 'foregroundWindCarvedRocks';
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 18; i += 1) {
      const angle = (i / 18) * Math.PI * 2 + 0.25;
      const margin = 3.5 + (i % 4) * 1.25;
      matrix.compose(
        new THREE.Vector3(Math.cos(angle) * (halfWidth + margin), 0.15, Math.sin(angle) * (halfDepth + margin)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle * 1.7, (i % 3 - 1) * 0.12)),
        new THREE.Vector3(0.7 + (i % 4) * 0.25, 0.6 + (i % 5) * 0.18, 0.7 + ((i + 2) % 3) * 0.22),
      );
      rocks.setMatrixAt(i, matrix);
    }
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    rocks.instanceMatrix.needsUpdate = true;
    this.foregroundLayer.add(rocks);

    const cairnGeometry = this.track(new THREE.DodecahedronGeometry(0.24, 0));
    const cairnStones = new THREE.InstancedMesh(cairnGeometry, this.materials.get('blackSlate'), 21);
    cairnStones.name = 'wayfinderCairns';
    let instance = 0;
    for (let cairn = 0; cairn < 7; cairn += 1) {
      const side = cairn % 2 === 0 ? -1 : 1;
      const base = new THREE.Vector3(side * (12.7 + (cairn % 3)), 0.1, -6 + cairn * 2);
      for (let tier = 0; tier < 3; tier += 1) {
        matrix.compose(
          base.clone().add(new THREE.Vector3((tier % 2) * 0.06, tier * 0.32, 0)),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(tier * 0.14, cairn + tier, 0)),
          new THREE.Vector3(1.3 - tier * 0.22, 0.72, 1 - tier * 0.14),
        );
        cairnStones.setMatrixAt(instance, matrix);
        instance += 1;
      }
    }
    cairnStones.castShadow = true;
    cairnStones.instanceMatrix.needsUpdate = true;
    this.foregroundLayer.add(cairnStones);
  }

  private buildSpireFields(halfWidth: number, halfDepth: number): void {
    const spireGeometry = this.track(this.createFacetedSpireGeometry(1, 1, 8));
    const spires = new THREE.InstancedMesh(spireGeometry, this.materials.get('blackSlate'), 22);
    spires.name = 'midgroundBlackSlateSpires';
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 22; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = -halfDepth + 2.5 + (i % 11) * Math.max(1.2, (halfDepth * 2 - 5) / 10);
      const height = 2.4 + ((i * 7) % 6) * 0.72;
      matrix.compose(
        new THREE.Vector3(side * (halfWidth + 2.5 + (i % 4) * 1.7), height * 0.48 - 0.04, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i * 0.74, side * 0.04)),
        new THREE.Vector3(0.8 + (i % 3) * 0.24, height, 0.75 + ((i + 1) % 4) * 0.16),
      );
      spires.setMatrixAt(i, matrix);
    }
    spires.castShadow = true;
    spires.receiveShadow = true;
    spires.instanceMatrix.needsUpdate = true;
    this.midgroundLayer.add(spires);

    const monolithGeometry = this.track(new THREE.OctahedronGeometry(0.52, 0));
    for (let i = 0; i < 5; i += 1) {
      const monolith = new THREE.Mesh(monolithGeometry, i % 2 === 0 ? this.materials.get('moonstone') : this.materials.get('obsidian'));
      monolith.name = `floatingOmenStone.${i}`;
      monolith.position.set((i - 2) * 4.2, 3.2 + (i % 2) * 1.3, -13.5 - Math.abs(i - 2) * 1.6);
      monolith.scale.set(0.65, 1.9 + (i % 3) * 0.4, 0.65);
      monolith.userData.baseY = monolith.position.y;
      monolith.castShadow = true;
      this.midgroundLayer.add(monolith);
      this.floatingMonoliths.push(monolith);
    }
  }

  private buildObservatory(): void {
    const observatory = new THREE.Group();
    observatory.name = 'moonfallObservatory';
    const finalSection = FIRMAMENT_ROUTE.sections[FIRMAMENT_ROUTE.sections.length - 1];
    observatory.position.set(finalSection.walkable[0].center[0], 0, finalSection.walkable[0].center[1]);
    this.midgroundLayer.add(observatory);
    this.registerCullable(observatory, observatory.position.x, 0, observatory.position.z, 42);

    const terrace = this.mesh(
      'observatoryTerraceRing',
      new THREE.RingGeometry(5.8, 8.55, 40),
      this.materials.get('blackSlate'),
      observatory,
    );
    terrace.rotation.x = -Math.PI / 2;
    terrace.position.y = 0.018;

    // The observatory is an open ruin rather than a solid dome. The ribs retain
    // the celestial silhouette while leaving the full boss floor readable and
    // collision-honest.
    for (let index = 0; index < 3; index += 1) {
      const rib = this.mesh(
        `observatoryDomeRib.${index}`,
        new THREE.TorusGeometry(4.65, 0.085, 7, 44, Math.PI),
        index === 1 ? this.materials.get('celestialGold') : this.materials.get('lunarSilver'),
        observatory,
        false,
      );
      rib.position.y = 0.16;
      rib.rotation.y = index * Math.PI / 3;
    }

    this.observatoryMechanism.name = 'observatoryCelestialMechanism';
    this.observatoryMechanism.position.y = 4.65;
    observatory.add(this.observatoryMechanism);
    const meridian = this.mesh('meridianRing', new THREE.TorusGeometry(2.45, 0.11, 8, 40), this.materials.get('lunarSilver'), this.observatoryMechanism);
    meridian.rotation.y = Math.PI / 2;
    const ecliptic = this.mesh('eclipticRing', new THREE.TorusGeometry(1.95, 0.085, 7, 36), this.materials.get('celestialGold'), this.observatoryMechanism);
    ecliptic.rotation.set(Math.PI / 2.8, 0.35, 0.2);
    const lens = this.mesh('restorationLens', new THREE.IcosahedronGeometry(0.54, 2), this.materials.get('moonstone'), this.observatoryMechanism);
    lens.scale.y = 1.4;

    const telescopePivot = new THREE.Group();
    telescopePivot.name = 'grandTelescopePivot';
    telescopePivot.position.set(0, 2.85, -10.8);
    telescopePivot.rotation.x = -0.42;
    observatory.add(telescopePivot);
    const barrel = this.mesh('grandTelescopeBarrel', new THREE.CylinderGeometry(0.38, 0.55, 4.8, 12), this.materials.get('lunarSilver'), telescopePivot);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.65;
    const objective = this.mesh('grandTelescopeObjective', new THREE.CylinderGeometry(0.62, 0.5, 0.28, 16), this.materials.get('glass'), telescopePivot, false);
    objective.rotation.x = Math.PI / 2;
    objective.position.z = -3.02;

    const buttressGeometry = this.track(new THREE.BoxGeometry(0.58, 2.1, 0.92));
    const buttresses = new THREE.InstancedMesh(buttressGeometry, this.materials.get('blackSlate'), 8);
    buttresses.name = 'observatoryButtresses';
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      matrix.compose(
        new THREE.Vector3(Math.sin(angle) * 10.35, 1.35, Math.cos(angle) * 10.35),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, Math.sin(angle) * 0.12)),
        new THREE.Vector3(1, 1, 1),
      );
      buttresses.setMatrixAt(i, matrix);
    }
    buttresses.castShadow = true;
    buttresses.receiveShadow = true;
    buttresses.instanceMatrix.needsUpdate = true;
    observatory.add(buttresses);

    const stairGeometry = this.track(new THREE.BoxGeometry(2.9, 0.16, 0.62));
    const stairs = new THREE.InstancedMesh(stairGeometry, this.materials.get('slateEdge'), 8);
    stairs.name = 'observatoryApproachStairs';
    for (let i = 0; i < 8; i += 1) {
      matrix.makeTranslation(0, 0.08 + i * 0.12, 5.8 - i * 0.47);
      stairs.setMatrixAt(i, matrix);
    }
    stairs.receiveShadow = true;
    stairs.instanceMatrix.needsUpdate = true;
    observatory.add(stairs);
  }

  private buildFarSilhouettes(worldRadius: number): void {
    const mountainGeometry = this.track(this.createFacetedSpireGeometry(1.4, 1, 9));
    const mountains = new THREE.InstancedMesh(mountainGeometry, this.materials.get('blackSlate'), 28);
    mountains.name = 'farNeedleMountainRange';
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 28; i += 1) {
      const angle = (i / 28) * Math.PI * 2;
      const radius = worldRadius * 0.78 + (i % 5) * 2.2;
      const height = 4 + ((i * 11) % 8) * 1.15;
      matrix.compose(
        new THREE.Vector3(Math.sin(angle) * radius, height * 0.46 - 0.7, Math.cos(angle) * radius),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle + i * 0.22, (i % 3 - 1) * 0.04)),
        new THREE.Vector3(2.8 + (i % 4) * 0.62, height, 2.2 + ((i + 2) % 4) * 0.55),
      );
      mountains.setMatrixAt(i, matrix);
    }
    mountains.receiveShadow = false;
    mountains.castShadow = false;
    mountains.instanceMatrix.needsUpdate = true;
    this.farLayer.add(mountains);
  }

  private createFacetedSpireGeometry(radius: number, height: number, sides: number): THREE.BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];
    const rings = [
      { y: -0.5 * height, radius },
      { y: -0.08 * height, radius: radius * 0.82 },
      { y: 0.3 * height, radius: radius * 0.46 },
      { y: 0.5 * height, radius: 0 },
    ];
    rings.forEach((ring, ringIndex) => {
      for (let side = 0; side < sides; side += 1) {
        const angle = (side / sides) * Math.PI * 2 + ringIndex * 0.13;
        positions.push(Math.cos(angle) * ring.radius, ring.y, Math.sin(angle) * ring.radius);
      }
    });
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      for (let side = 0; side < sides; side += 1) {
        const next = (side + 1) % sides;
        const a = ring * sides + side;
        const b = ring * sides + next;
        const c = (ring + 1) * sides + side;
        const d = (ring + 1) * sides + next;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }
}
