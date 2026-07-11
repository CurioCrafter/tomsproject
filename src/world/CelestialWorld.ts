import * as THREE from 'three';
import { MaterialLibrary } from '../assets/MaterialLibrary';

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
          float alpha = texel.r * edge * shimmer * (0.12 + restoration * 0.62);
          vec3 color = mix(vec3(0.15, 0.62, 0.68), vec3(0.48, 0.35, 0.95), texel.b);
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
    this.buildTundra(arenaHalfWidth, arenaHalfDepth);
    this.buildForeground(arenaHalfWidth, arenaHalfDepth);
    this.buildSpireFields(arenaHalfWidth, arenaHalfDepth);
    this.buildObservatory();
    this.buildFarSilhouettes(worldRadius);

    this.beaconLight.name = 'world.restorationBeaconLight';
    this.beaconLight.position.set(0, 4.8, -15.5);
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

    const curtainGeometry = this.track(new THREE.PlaneGeometry(31, 13, 30, 10));
    for (let i = 0; i < 3; i += 1) {
      const curtain = new THREE.Mesh(curtainGeometry, this.auroraMaterial);
      curtain.name = `auroraCurtain.${i}`;
      curtain.position.set((i - 1) * 18, 17 + i * 2.4, -33 + Math.abs(i - 1) * 3);
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

  private buildTundra(halfWidth: number, halfDepth: number): void {
    const floor = this.mesh(
      'blackSlateTundra',
      new THREE.PlaneGeometry(halfWidth * 2 + 8, halfDepth * 2 + 8, 1, 1),
      this.materials.get('blackSlate'),
      this.playLayer,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.08;

    const pathMaterial = this.materials.get('slateEdge');
    const pathGeometry = this.track(new THREE.BoxGeometry(1.2, 0.055, 0.38));
    const markers: Array<[number, number, number]> = [];
    for (let x = -halfWidth + 1; x <= halfWidth - 1; x += 1.75) {
      markers.push([x, 0, -halfDepth + 0.7], [x, Math.PI, halfDepth - 0.7]);
    }
    for (let z = -halfDepth + 1.7; z <= halfDepth - 1.7; z += 1.75) {
      markers.push([-halfWidth + 0.7, Math.PI / 2, z], [halfWidth - 0.7, -Math.PI / 2, z]);
    }
    const inlays = new THREE.InstancedMesh(pathGeometry, pathMaterial, markers.length);
    inlays.name = 'navigationalSlateInlays';
    const matrix = new THREE.Matrix4();
    markers.forEach(([x, rotation, z], index) => {
      matrix.makeRotationY(rotation);
      matrix.setPosition(x, -0.035, z);
      inlays.setMatrixAt(index, matrix);
    });
    inlays.receiveShadow = true;
    inlays.instanceMatrix.needsUpdate = true;
    this.playLayer.add(inlays);

    const frostGeometry = this.track(new THREE.CircleGeometry(1, 18));
    const frostPatches = new THREE.InstancedMesh(frostGeometry, this.materials.get('snowCrust'), 16);
    frostPatches.name = 'windScouredFrostShelves';
    const safeRadiusX = halfWidth + 1.4;
    const safeRadiusZ = halfDepth + 1.5;
    for (let i = 0; i < 16; i += 1) {
      const side = i % 4;
      const along = ((Math.floor(i / 4) + 0.5) / 4 - 0.5) * 34;
      const x = side < 2 ? along : (side === 2 ? -safeRadiusX - 3.5 : safeRadiusX + 3.5);
      const z = side < 2 ? (side === 0 ? -safeRadiusZ - 3 : safeRadiusZ + 3) : along * 0.62;
      matrix.compose(
        new THREE.Vector3(x, -0.045, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, i * 0.37)),
        new THREE.Vector3(1.4 + (i % 3) * 0.55, 0.7 + (i % 4) * 0.16, 1),
      );
      frostPatches.setMatrixAt(i, matrix);
    }
    frostPatches.receiveShadow = true;
    frostPatches.instanceMatrix.needsUpdate = true;
    this.playLayer.add(frostPatches);
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
    observatory.position.set(0, 0, -18.5);
    this.midgroundLayer.add(observatory);

    const foundation = this.mesh('observatoryFoundation', new THREE.CylinderGeometry(5.4, 6.1, 1.05, 16), this.materials.get('blackSlate'), observatory);
    foundation.position.y = 0.45;
    const terrace = this.mesh('observatoryTerrace', new THREE.CylinderGeometry(4.7, 5.15, 0.32, 16), this.materials.get('slateEdge'), observatory);
    terrace.position.y = 1.08;
    const dome = this.mesh(
      'observatoryDome',
      new THREE.SphereGeometry(3.25, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
      this.materials.get('obsidian'),
      observatory,
    );
    dome.position.y = 1.18;
    const domeBand = this.mesh('observatoryDomeBand', new THREE.TorusGeometry(3.25, 0.16, 8, 40), this.materials.get('celestialGold'), observatory);
    domeBand.rotation.x = Math.PI / 2;
    domeBand.position.y = 1.24;

    this.observatoryMechanism.name = 'observatoryCelestialMechanism';
    this.observatoryMechanism.position.y = 3.9;
    observatory.add(this.observatoryMechanism);
    const meridian = this.mesh('meridianRing', new THREE.TorusGeometry(2.45, 0.11, 8, 40), this.materials.get('lunarSilver'), this.observatoryMechanism);
    meridian.rotation.y = Math.PI / 2;
    const ecliptic = this.mesh('eclipticRing', new THREE.TorusGeometry(1.95, 0.085, 7, 36), this.materials.get('celestialGold'), this.observatoryMechanism);
    ecliptic.rotation.set(Math.PI / 2.8, 0.35, 0.2);
    const lens = this.mesh('restorationLens', new THREE.IcosahedronGeometry(0.54, 2), this.materials.get('moonstone'), this.observatoryMechanism);
    lens.scale.y = 1.4;

    const telescopePivot = new THREE.Group();
    telescopePivot.name = 'grandTelescopePivot';
    telescopePivot.position.set(0, 3.2, 0);
    telescopePivot.rotation.x = -0.52;
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
        new THREE.Vector3(Math.sin(angle) * 4.9, 1.35, Math.cos(angle) * 4.9),
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
