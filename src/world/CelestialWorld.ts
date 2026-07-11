import * as THREE from 'three';
import { MaterialLibrary } from '../assets/MaterialLibrary';
import { FIRMAMENT_ROUTE } from '../game/content/FirmamentRoute';
import type { GateStateSnapshot, RouteSectionDefinition, RouteShape } from '../game/content/RouteTypes';

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

    this.floatingMonoliths.forEach((monolith, index) => {
      const phase = elapsed * (0.22 + index * 0.018) + index * 1.7;
      monolith.position.y = monolith.userData.baseY + Math.sin(phase) * (0.08 + this.restoration * 0.16);
      monolith.rotation.y += delta * (index % 2 === 0 ? 0.045 : -0.038) * (0.3 + this.restoration);
    });

    this.gateVisuals.forEach((gate) => {
      const portcullis = gate.getObjectByName('gatePortcullis');
      const seal = gate.getObjectByName('gateSeal');
      const open = Boolean(gate.userData.open);
      if (portcullis) portcullis.position.y = THREE.MathUtils.damp(portcullis.position.y, open ? 5.35 : 0.08, 7, delta);
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
    chasm.position.set(0, -1.85, -10.5);

    for (const section of FIRMAMENT_ROUTE.sections) {
      section.walkable.forEach((shape, shapeIndex) => this.buildRouteSectionShape(section, shape, shapeIndex));
      if (section.kind === 'bridge' || section.kind === 'causeway' || section.kind === 'processional') {
        section.walkable.forEach((shape) => {
          if (shape.kind === 'obb') this.buildBridgeDetails(section, shape);
        });
      } else {
        this.buildCourtDetails(section);
      }
    }

    for (const gate of FIRMAMENT_ROUTE.gates) this.buildRouteGate(gate.id, gate.collider.a, gate.collider.b, gate.initialState === 'open');
    this.buildSchoolSpire();
  }

  private buildRouteSectionShape(section: RouteSectionDefinition, shape: RouteShape, shapeIndex: number): void {
    if (shape.kind === 'circle') {
      const foundation = this.mesh(
        `${section.id}.foundation.${shapeIndex}`,
        new THREE.CylinderGeometry(shape.radius, shape.radius + 0.48, 0.56, Math.max(18, Math.round(shape.radius * 4))),
        this.materials.get('blackSlate'),
        this.playLayer,
      );
      foundation.position.set(shape.center[0], -0.3, shape.center[1]);
      const frostLip = this.mesh(
        `${section.id}.frostLip.${shapeIndex}`,
        new THREE.TorusGeometry(shape.radius * 0.94, 0.095, 6, 48),
        this.materials.get('snowCrust'),
        this.playLayer,
        false,
      );
      frostLip.position.set(shape.center[0], 0.015, shape.center[1]);
      frostLip.rotation.x = Math.PI / 2;
      return;
    }

    const width = shape.halfExtents[0] * 2;
    const depth = shape.halfExtents[1] * 2;
    const foundation = this.mesh(
      `${section.id}.foundation.${shapeIndex}`,
      new THREE.BoxGeometry(width, 0.5, depth),
      this.materials.get('blackSlate'),
      this.playLayer,
    );
    foundation.position.set(shape.center[0], -0.27, shape.center[1]);
    foundation.rotation.y = -shape.rotation;
    const inlay = this.mesh(
      `${section.id}.routeInlay.${shapeIndex}`,
      new THREE.BoxGeometry(Math.max(0.42, width * 0.12), 0.035, depth * 0.94),
      this.materials.get('slateEdge'),
      this.playLayer,
      false,
    );
    inlay.position.set(shape.center[0], 0.012, shape.center[1]);
    inlay.rotation.y = -shape.rotation;
  }

  private buildBridgeDetails(section: RouteSectionDefinition, shape: Extract<RouteShape, { kind: 'obb' }>): void {
    const group = new THREE.Group();
    group.name = `${section.id}.bridgeKit`;
    group.position.set(shape.center[0], 0, shape.center[1]);
    group.rotation.y = -shape.rotation;
    this.foregroundLayer.add(group);

    const halfWidth = shape.halfExtents[0];
    const halfDepth = shape.halfExtents[1];
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
        if (index < count && (index + section.order + (side < 0 ? 1 : 0)) % 5 !== 0) {
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

  private buildCourtDetails(section: RouteSectionDefinition): void {
    const circle = section.walkable.find((shape): shape is Extract<RouteShape, { kind: 'circle' }> => shape.kind === 'circle');
    if (!circle) return;
    const columnGeometry = this.track(new THREE.CylinderGeometry(0.22, 0.34, 1.9, 7));
    const columns = new THREE.InstancedMesh(columnGeometry, this.materials.get('blackSlate'), 8);
    columns.name = `${section.id}.weatheredColumns`;
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const radius = circle.radius + 0.18;
      matrix.compose(
        new THREE.Vector3(circle.center[0] + Math.sin(angle) * radius, 0.88 - (index % 3) * 0.12, circle.center[1] + Math.cos(angle) * radius),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle + index * 0.19, (index % 2 === 0 ? 1 : -1) * 0.035)),
        new THREE.Vector3(1, 0.72 + (index % 3) * 0.13, 1),
      );
      columns.setMatrixAt(index, matrix);
    }
    columns.instanceMatrix.needsUpdate = true;
    columns.castShadow = true;
    this.midgroundLayer.add(columns);
  }

  private buildRouteGate(id: string, a: readonly [number, number], b: readonly [number, number], open: boolean): void {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    const group = new THREE.Group();
    group.name = `routeGate.${id}`;
    group.position.set((a[0] + b[0]) * 0.5, 0, (a[1] + b[1]) * 0.5);
    group.rotation.y = -Math.atan2(dz, dx);
    group.userData.open = open;
    this.foregroundLayer.add(group);

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
    portcullis.position.y = open ? 5.35 : 0.08;
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
