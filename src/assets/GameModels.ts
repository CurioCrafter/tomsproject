import * as THREE from 'three';
import { MaterialLibrary } from './MaterialLibrary';

export type EnemyVariant =
  | 'wisp'
  | 'sentinel'
  | 'seer'
  | 'veilWraith'
  | 'astralSentinel'
  | 'rimeStalker'
  | 'ashenInitiate'
  | 'astralLancer'
  | 'eclipseChorister'
  | 'orreryCastellan';

export type SorcererAppearanceOptions = {
  lifeStage?: 'young' | 'mature' | 'elder';
  frame?: 'slender' | 'balanced' | 'broad';
  veil?: 'hood' | 'starVeil' | 'hornedCowl' | 'unveiled';
  robeColor?: THREE.ColorRepresentation;
  metalColor?: THREE.ColorRepresentation;
  catalyst?: 'crescent' | 'orb' | 'astrolabe' | 'bare';
};

export type ModelDiagnostics = {
  meshes: number;
  geometries: number;
  materials: number;
  triangles: number;
};

export type AuthoredModel = {
  root: THREE.Group;
  collisionProxy: THREE.Object3D;
  sockets: Readonly<Record<string, THREE.Object3D>>;
  parts: ReadonlyMap<string, THREE.Object3D>;
  bounds: THREE.Box3;
  diagnostics: ModelDiagnostics;
  update(delta: number, elapsed: number, intensity?: number): void;
  dispose(): void;
};

type ModelUpdater = (delta: number, elapsed: number, intensity: number) => void;

class ModelBuilder {
  readonly root = new THREE.Group();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();

  constructor(name: string) {
    this.root.name = name;
  }

  geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  cloneMaterial<T extends THREE.Material>(
    source: T,
    name: string,
    configure?: (material: T) => void,
  ): T {
    const material = source.clone() as T;
    material.name = name;
    configure?.(material);
    this.ownedMaterials.add(material);
    return material;
  }

  mesh(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D = this.root,
    shadows = true,
  ): THREE.Mesh {
    this.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    parent.add(mesh);
    return mesh;
  }

  group(name: string, parent: THREE.Object3D = this.root): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    parent.add(group);
    return group;
  }

  collision(name: string, geometry: THREE.BufferGeometry): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({ visible: false });
    material.name = `${name}.material`;
    this.ownedMaterials.add(material);
    const proxy = this.mesh(name, geometry, material, this.root, false);
    proxy.visible = false;
    proxy.userData.collisionProxy = true;
    return proxy;
  }

  finish(
    collisionProxy: THREE.Object3D,
    sockets: Record<string, THREE.Object3D>,
    updater: ModelUpdater = () => undefined,
  ): AuthoredModel {
    this.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.root);
    const parts = new Map<string, THREE.Object3D>();
    const materials = new Set<THREE.Material>();
    let meshes = 0;
    let triangles = 0;

    this.root.traverse((object) => {
      if (object.name) parts.set(object.name, object);
      if (!(object instanceof THREE.Mesh)) return;
      meshes += 1;
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      meshMaterials.forEach((material) => materials.add(material));
      const index = object.geometry.index;
      const position = object.geometry.getAttribute('position');
      triangles += index ? index.count / 3 : position ? position.count / 3 : 0;
    });

    let disposed = false;
    return {
      root: this.root,
      collisionProxy,
      sockets,
      parts,
      bounds,
      diagnostics: {
        meshes,
        geometries: this.geometries.size,
        materials: materials.size,
        triangles: Math.round(triangles),
      },
      update: (delta, elapsed, intensity = 1) => updater(delta, elapsed, intensity),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.geometries.forEach((geometry) => geometry.dispose());
        this.ownedMaterials.forEach((material) => material.dispose());
      },
    };
  }
}

function addBeam(
  builder: ModelBuilder,
  parent: THREE.Object3D,
  name: string,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  radialSegments = 7,
): THREE.Mesh {
  const direction = new THREE.Vector3().subVectors(end, start);
  const mesh = builder.mesh(
    name,
    new THREE.CylinderGeometry(radius * 0.82, radius, direction.length(), radialSegments),
    material,
    parent,
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function addContactShadow(builder: ModelBuilder, materials: MaterialLibrary, radiusX: number, radiusZ: number): THREE.Mesh {
  const shadow = builder.mesh(
    'contactShadow',
    new THREE.CircleGeometry(1, 24),
    materials.get('contactShadow'),
    builder.root,
    false,
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(radiusX, radiusZ, 1);
  shadow.position.y = 0.012;
  return shadow;
}

function addSocket(builder: ModelBuilder, name: string, parent: THREE.Object3D, position: THREE.Vector3): THREE.Group {
  const socket = builder.group(name, parent);
  socket.position.copy(position);
  return socket;
}

export function createSorcererModel(
  materials: MaterialLibrary,
  appearance: SorcererAppearanceOptions = {},
): AuthoredModel {
  const builder = new ModelBuilder('sorcerer');
  const silhouette = builder.group('sorcererSilhouette');
  const lifeStage = appearance.lifeStage ?? 'mature';
  const frame = appearance.frame ?? 'balanced';
  const veil = appearance.veil ?? 'hood';
  const catalyst = appearance.catalyst ?? 'crescent';
  const heightScale = lifeStage === 'young' ? 0.93 : lifeStage === 'elder' ? 1.04 : 1;
  const widthScale = frame === 'slender' ? 0.84 : frame === 'broad' ? 1.18 : 1;
  const depthScale = frame === 'slender' ? 0.9 : frame === 'broad' ? 1.08 : 1;

  const robeMaterial = appearance.robeColor === undefined
    ? materials.get<THREE.MeshStandardMaterial>('robe')
    : builder.cloneMaterial(
      materials.get<THREE.MeshStandardMaterial>('robe'),
      'material.sorcererRobe.custom',
      (material) => {
        material.color.set(appearance.robeColor!);
        material.emissive.copy(material.color).multiplyScalar(0.18);
        material.emissiveIntensity = 0.3;
      },
    );
  const goldMaterial = appearance.metalColor === undefined
    ? materials.get<THREE.MeshStandardMaterial>('celestialGold')
    : builder.cloneMaterial(
      materials.get<THREE.MeshStandardMaterial>('celestialGold'),
      'material.sorcererMetal.custom',
      (material) => {
        material.color.set(appearance.metalColor!);
        material.emissive.copy(material.color).multiplyScalar(0.2);
      },
    );
  const silverMaterial = appearance.metalColor === undefined
    ? materials.get<THREE.MeshStandardMaterial>('lunarSilver')
    : builder.cloneMaterial(
      materials.get<THREE.MeshStandardMaterial>('lunarSilver'),
      'material.sorcererCatalystMetal.custom',
      (material) => material.color.set(appearance.metalColor!),
    );

  const robeProfile = [
    new THREE.Vector2(0.72, 0),
    new THREE.Vector2(0.68, 0.18),
    new THREE.Vector2(0.52, 1.18),
    new THREE.Vector2(0.42, 1.52),
    new THREE.Vector2(0.28, 1.72),
  ];
  const robe = builder.mesh('layeredRobe', new THREE.LatheGeometry(robeProfile, 14), robeMaterial, silhouette);
  robe.position.y = 0.06;

  const hem = builder.mesh(
    'goldHem',
    new THREE.TorusGeometry(0.67, 0.045, 6, 28),
    goldMaterial,
    silhouette,
  );
  hem.rotation.x = Math.PI / 2;
  hem.position.y = 0.15;

  const mantle = builder.mesh(
    'starMantle',
    new THREE.SphereGeometry(0.54, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.46),
    robeMaterial,
    silhouette,
  );
  mantle.position.y = 1.62;
  mantle.scale.set(1.35, 0.72, 1);

  const faceMaterial = veil === 'unveiled'
    ? builder.cloneMaterial(
      materials.get<THREE.MeshStandardMaterial>('leather'),
      'material.sorcererFace',
      (material) => {
        material.color.set(lifeStage === 'elder' ? '#8e6b61' : '#b98b75');
        material.roughness = 0.82;
      },
    )
    : materials.get('moonstone');
  const mask = builder.mesh(
    veil === 'unveiled' ? 'unveiledFace' : 'moonMask',
    veil === 'unveiled' ? new THREE.SphereGeometry(0.25, 14, 10) : new THREE.IcosahedronGeometry(0.26, 1),
    faceMaterial,
    silhouette,
  );
  mask.position.set(0, 1.82, -0.29);
  mask.scale.set(0.75, 1.05, veil === 'unveiled' ? 0.72 : 0.58);

  const veilRoot = builder.group('veilRoot', silhouette);
  veilRoot.position.set(0, 1.84, -0.02);
  if (veil === 'hood') {
    const hood = builder.mesh(
      'deepHood',
      new THREE.TorusGeometry(0.32, 0.13, 8, 20, Math.PI * 1.65),
      robeMaterial,
      veilRoot,
    );
    hood.rotation.z = Math.PI * 0.68;
  } else if (veil === 'starVeil') {
    const circlet = builder.mesh(
      'starVeilCirclet',
      new THREE.TorusGeometry(0.3, 0.055, 7, 22),
      goldMaterial,
      veilRoot,
    );
    circlet.rotation.x = Math.PI / 2;
    const drape = builder.mesh(
      'starVeilDrape',
      new THREE.ConeGeometry(0.39, 0.82, 9, 2, true, 0, Math.PI * 1.52),
      robeMaterial,
      veilRoot,
    );
    drape.position.set(0, -0.23, 0.17);
    drape.rotation.y = Math.PI * 0.24;
  } else if (veil === 'hornedCowl') {
    const cowl = builder.mesh(
      'hornedCowl',
      new THREE.TorusGeometry(0.32, 0.14, 8, 20, Math.PI * 1.65),
      robeMaterial,
      veilRoot,
    );
    cowl.rotation.z = Math.PI * 0.68;
    for (const side of [-1, 1]) {
      const horn = builder.mesh(
        `${side < 0 ? 'left' : 'right'}CowlHorn`,
        new THREE.ConeGeometry(0.075, 0.45, 5),
        goldMaterial,
        veilRoot,
      );
      horn.position.set(side * 0.28, 0.24, 0.02);
      horn.rotation.z = side * -0.48;
    }
  }

  if (lifeStage === 'young') {
    const noviceStar = builder.mesh(
      'noviceBrowStar',
      new THREE.OctahedronGeometry(0.07, 0),
      materials.get('spirit'),
      mask,
      false,
    );
    noviceStar.position.set(0, 0.08, -0.22);
  } else if (lifeStage === 'elder') {
    const elderCrescent = builder.mesh(
      'elderBrowCrescent',
      new THREE.TorusGeometry(0.16, 0.025, 6, 18, Math.PI * 1.45),
      goldMaterial,
      mask,
      false,
    );
    elderCrescent.position.set(0, 0.08, -0.22);
    elderCrescent.rotation.z = Math.PI * 0.76;
    silhouette.rotation.x = -0.035;
  }

  const leftArm = builder.group('leftArmJoint', silhouette);
  leftArm.position.set(-0.39, 1.42, 0);
  leftArm.rotation.z = 0.56;
  addBeam(builder, leftArm, 'leftSleeve', new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.48, -0.42, -0.08), 0.16, robeMaterial);
  const leftCuff = builder.mesh('leftCuff', new THREE.TorusGeometry(0.13, 0.035, 6, 14), goldMaterial, leftArm);
  leftCuff.position.set(-0.48, -0.42, -0.08);
  leftCuff.rotation.set(Math.PI / 2, 0.6, 0);

  const rightArm = builder.group('rightArmJoint', silhouette);
  rightArm.position.set(0.38, 1.44, 0);
  rightArm.rotation.z = -0.38;
  addBeam(builder, rightArm, 'rightSleeve', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.45, -0.3, -0.05), 0.16, robeMaterial);

  const staff = builder.group(
    catalyst === 'crescent'
      ? 'crescentStaff'
      : catalyst === 'orb'
        ? 'orbStaff'
        : catalyst === 'bare'
          ? 'bareHandFocus'
          : 'astrolabeStaff',
    silhouette,
  );
  const focusHeight = catalyst === 'bare' ? 1.04 : 1.98;
  staff.position.set(catalyst === 'bare' ? 0.42 : 0.82, catalyst === 'bare' ? 0.44 : 0.1, catalyst === 'bare' ? -0.22 : -0.02);
  const staffCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-0.04, 0.58, 0.03),
    new THREE.Vector3(0.05, 1.18, -0.02),
    new THREE.Vector3(0, 1.8, 0),
  ]);
  if (catalyst !== 'bare') {
    builder.mesh('staffShaft', new THREE.TubeGeometry(staffCurve, 18, 0.045, 7, false), silverMaterial, staff);
  }
  const catalystRings: THREE.Mesh[] = [];
  if (catalyst === 'crescent') {
    const crescent = builder.mesh(
      'staffCrescent',
      new THREE.TorusGeometry(0.3, 0.045, 7, 24, Math.PI * 1.55),
      goldMaterial,
      staff,
    );
    crescent.position.y = 1.98;
    crescent.rotation.z = Math.PI * 0.72;
    catalystRings.push(crescent);
  } else if (catalyst === 'orb') {
    const orbit = builder.mesh(
      'staffOrbitalRing',
      new THREE.TorusGeometry(0.24, 0.035, 7, 24),
      goldMaterial,
      staff,
    );
    orbit.position.y = 1.98;
    orbit.rotation.x = Math.PI / 2;
    catalystRings.push(orbit);
  } else if (catalyst === 'bare') {
    [0.22, 0.15].forEach((radius, index) => {
      const ring = builder.mesh(
        `bareFocusRing.${index}`,
        new THREE.TorusGeometry(radius, 0.024, 6, 22),
        index === 0 ? goldMaterial : silverMaterial,
        staff,
      );
      ring.position.y = focusHeight;
      ring.rotation.set(index * 0.8, Math.PI / 2, index * 0.55);
      catalystRings.push(ring);
    });
  } else {
    [0.31, 0.23, 0.16].forEach((radius, index) => {
      const ring = builder.mesh(
        `staffAstrolabeRing.${index}`,
        new THREE.TorusGeometry(radius, 0.025, 6, 22),
        index === 1 ? silverMaterial : goldMaterial,
        staff,
      );
      ring.position.y = 1.98;
      ring.rotation.set(index * 0.62, index * 0.48, index * 0.34);
      catalystRings.push(ring);
    });
  }
  const staffCore = builder.mesh(
    'staffCore',
    catalyst === 'orb' || catalyst === 'bare' ? new THREE.IcosahedronGeometry(catalyst === 'bare' ? 0.14 : 0.17, 1) : new THREE.OctahedronGeometry(0.13, 1),
    materials.get('moonstone'),
    staff,
  );
  staffCore.position.y = focusHeight;
  const catalystRingBaseRotations = catalystRings.map((ring) => ring.rotation.clone());

  const belt = builder.mesh('constellationBelt', new THREE.TorusGeometry(0.47, 0.055, 7, 24), materials.get('leather'), silhouette);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 1.06;
  for (let i = 0; i < 5; i += 1) {
    const charm = builder.mesh(`beltCharm.${i}`, new THREE.OctahedronGeometry(0.055, 0), goldMaterial, silhouette);
    const angle = (i / 4 - 0.5) * 1.8;
    charm.position.set(Math.sin(angle) * 0.47, 0.91 - Math.abs(i - 2) * 0.025, -Math.cos(angle) * 0.47);
  }

  const contactShadow = addContactShadow(builder, materials, 0.82 * widthScale, 0.68 * depthScale);
  contactShadow.name = 'sorcererContactShadow';
  const castSocket = addSocket(builder, 'castSocket', staff, new THREE.Vector3(0, focusHeight, 0));
  const dodgeSocket = addSocket(builder, 'dodgeSocket', silhouette, new THREE.Vector3(0, 0.85, 0.2));
  silhouette.scale.set(widthScale, heightScale, depthScale);
  const collision = builder.collision(
    'collisionProxy',
    new THREE.CapsuleGeometry(0.48 * Math.max(widthScale, depthScale), 1.12 * heightScale, 4, 8),
  );
  collision.position.y = heightScale;

  return builder.finish(collision, { cast: castSocket, dodge: dodgeSocket }, (_delta, elapsed, intensity) => {
    staffCore.rotation.y = elapsed * 2.4;
    staffCore.scale.setScalar(0.92 + Math.sin(elapsed * 4.2) * 0.08 * intensity);
    catalystRings.forEach((ring, index) => {
      const base = catalystRingBaseRotations[index];
      if (catalyst === 'crescent') {
        ring.rotation.set(base.x, base.y + Math.sin(elapsed * 1.3) * 0.08, base.z);
      } else {
        ring.rotation.set(
          base.x + Math.sin(elapsed * (0.65 + index * 0.12)) * 0.12,
          base.y + elapsed * (index % 2 === 0 ? 0.32 : -0.27) * intensity,
          base.z + Math.sin(elapsed * (0.82 + index * 0.09)) * 0.09,
        );
      }
    });
    mantle.rotation.y = Math.sin(elapsed * 0.7) * 0.045;
    leftArm.rotation.x = Math.sin(elapsed * 1.6) * 0.045;
    veilRoot.rotation.y = Math.sin(elapsed * 0.82) * 0.018;
  });
}

export function createVeilWraithEnemy(materials: MaterialLibrary): AuthoredModel {
  const builder = new ModelBuilder('enemy.veilWraith');
  const body = builder.group('wraithBody');
  const shroud = builder.mesh('tornShroud', new THREE.ConeGeometry(0.72, 1.75, 7, 3, true), materials.get('void'), body);
  shroud.position.y = 0.95;
  shroud.rotation.y = Math.PI / 7;
  const face = builder.mesh('facelessMask', new THREE.IcosahedronGeometry(0.25, 1), materials.get('lunarSilver'), body);
  face.position.set(0, 1.62, -0.3);
  face.scale.set(0.7, 1.05, 0.35);
  const eye = builder.mesh('singleEye', new THREE.OctahedronGeometry(0.075, 0), materials.get('danger'), face);
  eye.position.z = -0.23;

  for (const side of [-1, 1]) {
    const arm = builder.group(side < 0 ? 'leftTalonJoint' : 'rightTalonJoint', body);
    arm.position.set(side * 0.45, 1.26, 0);
    addBeam(builder, arm, `${side < 0 ? 'left' : 'right'}SpectralArm`, new THREE.Vector3(), new THREE.Vector3(side * 0.62, -0.38, -0.18), 0.095, materials.get('void'));
    const claw = builder.mesh(`${side < 0 ? 'left' : 'right'}Talon`, new THREE.ConeGeometry(0.12, 0.52, 4), materials.get('danger'), arm);
    claw.position.set(side * 0.68, -0.55, -0.2);
    claw.rotation.z = side * -0.58;
  }

  const trailingShards: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i += 1) {
    const shard = builder.mesh(`shroudShard.${i}`, new THREE.TetrahedronGeometry(0.15 + i * 0.015, 0), materials.get('void'), body);
    shard.position.set((i - 2) * 0.22, 0.04 + (i % 2) * 0.18, 0.04 + Math.abs(i - 2) * 0.08);
    shard.userData.baseY = shard.position.y;
    shard.scale.y = 2.1;
    trailingShards.push(shard);
  }
  addContactShadow(builder, materials, 0.68, 0.55);
  const hitSocket = addSocket(builder, 'hitSocket', body, new THREE.Vector3(0, 1.15, 0));
  const castSocket = addSocket(builder, 'castSocket', face, new THREE.Vector3(0, 0, -0.36));
  const collision = builder.collision('collisionProxy', new THREE.CapsuleGeometry(0.52, 0.9, 4, 8));
  collision.position.y = 0.98;

  return builder.finish(collision, { hit: hitSocket, cast: castSocket }, (_delta, elapsed) => {
    body.position.y = 0.13 + Math.sin(elapsed * 2.4) * 0.12;
    eye.scale.setScalar(0.85 + Math.sin(elapsed * 7) * 0.15);
    trailingShards.forEach((shard, index) => {
      shard.rotation.y = elapsed * (0.7 + index * 0.11);
      shard.position.y = shard.userData.baseY + Math.sin(elapsed * 2.1 + index) * 0.035;
    });
  });
}

export function createAstralSentinelEnemy(materials: MaterialLibrary): AuthoredModel {
  const builder = new ModelBuilder('enemy.astralSentinel');
  const chassis = builder.group('sentinelChassis');
  const core = builder.mesh('armoredCore', new THREE.DodecahedronGeometry(0.58, 0), materials.get('blackSlate'), chassis);
  core.position.y = 0.92;
  core.scale.set(0.95, 1.25, 0.72);
  const lens = builder.mesh('telegraphLens', new THREE.CylinderGeometry(0.2, 0.26, 0.13, 12), materials.get('danger'), chassis);
  lens.position.set(0, 1.02, -0.52);
  lens.rotation.x = Math.PI / 2;
  const crown = builder.group('bladeCrown', chassis);
  crown.position.y = 1.44;
  const fins: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i += 1) {
    const fin = builder.mesh(`crownBlade.${i}`, new THREE.ConeGeometry(0.13, 0.66, 4), materials.get('lunarSilver'), crown);
    const angle = (i / 5) * Math.PI * 2;
    fin.position.set(Math.sin(angle) * 0.48, 0.18, Math.cos(angle) * 0.32);
    fin.rotation.z = -Math.sin(angle) * 0.55;
    fin.rotation.x = Math.cos(angle) * 0.55;
    fins.push(fin);
  }
  const orbit = builder.mesh('shieldOrbit', new THREE.TorusGeometry(0.78, 0.055, 7, 28), materials.get('celestialGold'), chassis);
  orbit.position.y = 0.93;
  orbit.rotation.x = Math.PI / 2;

  const pylons: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const pylon = builder.group(side < 0 ? 'leftWeaponPylon' : 'rightWeaponPylon', chassis);
    pylon.position.set(side * 0.72, 0.9, 0);
    const guard = builder.mesh(`${side < 0 ? 'left' : 'right'}Guard`, new THREE.BoxGeometry(0.22, 0.78, 0.44), materials.get('slateEdge'), pylon);
    guard.rotation.z = side * 0.18;
    const blade = builder.mesh(`${side < 0 ? 'left' : 'right'}Blade`, new THREE.ConeGeometry(0.12, 0.76, 4), materials.get('danger'), pylon);
    blade.position.y = -0.62;
    blade.rotation.z = side * 0.12;
    pylons.push(pylon);
  }

  addContactShadow(builder, materials, 0.76, 0.62);
  const hitSocket = addSocket(builder, 'hitSocket', chassis, new THREE.Vector3(0, 0.95, 0));
  const castSocket = addSocket(builder, 'castSocket', lens, new THREE.Vector3(0, -0.08, 0));
  const collision = builder.collision('collisionProxy', new THREE.SphereGeometry(0.7, 10, 7));
  collision.position.y = 0.95;

  return builder.finish(collision, { hit: hitSocket, cast: castSocket }, (_delta, elapsed, intensity) => {
    chassis.position.y = 0.12 + Math.sin(elapsed * 2.8) * 0.07;
    orbit.rotation.z = elapsed * 0.9;
    crown.rotation.y = -elapsed * 0.55;
    lens.scale.z = 0.85 + Math.sin(elapsed * 6) * 0.15 * intensity;
    pylons[0].rotation.x = Math.sin(elapsed * 1.4) * 0.08;
    pylons[1].rotation.x = -Math.sin(elapsed * 1.4) * 0.08;
    fins.forEach((fin, index) => { fin.rotation.y = Math.sin(elapsed * 1.8 + index) * 0.09; });
  });
}

export function createRimeStalkerEnemy(materials: MaterialLibrary): AuthoredModel {
  const builder = new ModelBuilder('enemy.rimeStalker');
  const body = builder.group('stalkerBody');
  body.position.y = 0.35;
  const carapace = builder.mesh('lowCarapace', new THREE.DodecahedronGeometry(0.56, 0), materials.get('blackSlate'), body);
  carapace.scale.set(1.35, 0.52, 0.86);
  const prow = builder.mesh('frostProw', new THREE.ConeGeometry(0.34, 0.92, 5), materials.get('snowCrust'), body);
  prow.position.z = -0.65;
  prow.rotation.x = Math.PI / 2;
  const eyeBar = builder.mesh('eyeBar', new THREE.BoxGeometry(0.56, 0.1, 0.1), materials.get('danger'), body);
  eyeBar.position.set(0, 0.16, -0.63);

  const legJoints: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    for (let row = 0; row < 2; row += 1) {
      const leg = builder.group(`${side < 0 ? 'left' : 'right'}LegJoint.${row}`, body);
      leg.position.set(side * 0.45, -0.05, row === 0 ? -0.28 : 0.34);
      const knee = new THREE.Vector3(side * 0.48, -0.25, row === 0 ? -0.15 : 0.2);
      const foot = new THREE.Vector3(side * 0.82, -0.42, row === 0 ? -0.24 : 0.42);
      addBeam(builder, leg, `${side < 0 ? 'left' : 'right'}UpperLeg.${row}`, new THREE.Vector3(), knee, 0.085, materials.get('lunarSilver'));
      addBeam(builder, leg, `${side < 0 ? 'left' : 'right'}LowerLeg.${row}`, knee, foot, 0.065, materials.get('lunarSilver'));
      const claw = builder.mesh(`${side < 0 ? 'left' : 'right'}IceClaw.${row}`, new THREE.ConeGeometry(0.09, 0.38, 4), materials.get('danger'), leg);
      claw.position.copy(foot).add(new THREE.Vector3(side * 0.1, -0.02, -0.08));
      claw.rotation.z = side * -Math.PI / 2;
      legJoints.push(leg);
    }
  }

  const tail = builder.group('segmentedTail', body);
  tail.position.z = 0.5;
  for (let i = 0; i < 4; i += 1) {
    const segment = builder.mesh(`tailSegment.${i}`, new THREE.ConeGeometry(0.16 - i * 0.025, 0.42, 5), materials.get('slateEdge'), tail);
    segment.position.set(0, -0.02 - i * 0.02, 0.16 + i * 0.29);
    segment.rotation.x = Math.PI / 2;
  }
  addContactShadow(builder, materials, 0.9, 0.68);
  const hitSocket = addSocket(builder, 'hitSocket', body, new THREE.Vector3(0, 0.1, 0));
  const castSocket = addSocket(builder, 'castSocket', eyeBar, new THREE.Vector3(0, 0, -0.08));
  const collision = builder.collision('collisionProxy', new THREE.BoxGeometry(1.35, 0.7, 1.45));
  collision.position.y = 0.48;

  return builder.finish(collision, { hit: hitSocket, cast: castSocket }, (_delta, elapsed) => {
    body.position.y = 0.35 + Math.sin(elapsed * 5.2) * 0.025;
    legJoints.forEach((leg, index) => { leg.rotation.z = Math.sin(elapsed * 5 + index * 1.7) * 0.16; });
    tail.rotation.y = Math.sin(elapsed * 2.3) * 0.22;
    eyeBar.scale.x = 0.82 + Math.sin(elapsed * 8) * 0.18;
  });
}

export function createAshenInitiateEnemy(materials: MaterialLibrary): AuthoredModel {
  const builder = new ModelBuilder('enemy.ashenInitiate');
  const body = builder.group('ashenInitiateBody');
  const emberMaterial = builder.cloneMaterial(
    materials.get<THREE.MeshStandardMaterial>('danger'),
    'material.ashenInitiateEmber',
    (material) => {
      material.color.set('#d66538');
      material.emissive.set('#7a1e08');
      material.emissiveIntensity = 1.15;
    },
  );
  const robeProfile = [
    new THREE.Vector2(0.54, 0),
    new THREE.Vector2(0.48, 0.24),
    new THREE.Vector2(0.32, 1.08),
    new THREE.Vector2(0.25, 1.35),
  ];
  const robe = builder.mesh('ashLayeredRobe', new THREE.LatheGeometry(robeProfile, 10), materials.get('robe'), body);
  robe.position.y = 0.06;
  const mantle = builder.mesh(
    'charredMantle',
    new THREE.SphereGeometry(0.42, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.42),
    materials.get('blackSlate'),
    body,
  );
  mantle.position.y = 1.3;
  mantle.scale.set(1.3, 0.68, 0.92);
  const cowl = builder.mesh(
    'ashCowl',
    new THREE.TorusGeometry(0.25, 0.1, 7, 16, Math.PI * 1.6),
    materials.get('void'),
    body,
  );
  cowl.position.set(0, 1.5, -0.02);
  cowl.rotation.z = Math.PI * 0.7;
  const mask = builder.mesh('emberSlitMask', new THREE.IcosahedronGeometry(0.2, 0), materials.get('lunarSilver'), body);
  mask.position.set(0, 1.48, -0.22);
  mask.scale.set(0.72, 1.02, 0.42);
  const emberSlit = builder.mesh('telegraphEmberSlit', new THREE.BoxGeometry(0.18, 0.035, 0.025), emberMaterial, mask, false);
  emberSlit.position.z = -0.18;

  const crozier = builder.group('charredCrozierJoint', body);
  crozier.position.set(0.48, 0.2, 0.02);
  addBeam(
    builder,
    crozier,
    'charredCrozierShaft',
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.05, 1.52, 0),
    0.04,
    materials.get('leather'),
    6,
  );
  const brazier = builder.mesh('crozierBrazier', new THREE.TorusGeometry(0.19, 0.04, 6, 18), materials.get('celestialGold'), crozier);
  brazier.position.set(0.05, 1.61, 0);
  brazier.rotation.x = Math.PI / 2;
  const ember = builder.mesh('crozierTelegraphEmber', new THREE.OctahedronGeometry(0.1, 0), emberMaterial, crozier, false);
  ember.position.set(0.05, 1.62, 0);

  addContactShadow(builder, materials, 0.58, 0.5);
  const hitSocket = addSocket(builder, 'hitSocket', body, new THREE.Vector3(0, 0.92, 0));
  const castSocket = addSocket(builder, 'castSocket', ember, new THREE.Vector3());
  const collision = builder.collision('collisionProxy', new THREE.CapsuleGeometry(0.42, 0.78, 4, 7));
  collision.position.y = 0.82;

  return builder.finish(collision, { hit: hitSocket, cast: castSocket }, (_delta, elapsed, intensity) => {
    body.position.y = 0.04 + Math.sin(elapsed * 2.7) * 0.045;
    crozier.rotation.z = -0.08 + Math.sin(elapsed * 1.8) * 0.055;
    ember.rotation.y = elapsed * 2.8;
    ember.scale.setScalar(0.82 + Math.sin(elapsed * 7.2) * 0.12 + intensity * 0.08);
    mantle.rotation.y = Math.sin(elapsed * 1.1) * 0.045;
  });
}

export function createAstralLancerEnemy(materials: MaterialLibrary): AuthoredModel {
  const builder = new ModelBuilder('enemy.astralLancer');
  const body = builder.group('astralLancerBody');
  const telegraphMaterial = builder.cloneMaterial(
    materials.get<THREE.MeshStandardMaterial>('danger'),
    'material.astralLancerTelegraph',
    (material) => {
      material.color.set('#ff704f');
      material.emissive.set('#8e1608');
      material.emissiveIntensity = 1.4;
    },
  );

  const breastplate = builder.mesh('longBreastplate', new THREE.DodecahedronGeometry(0.52, 0), materials.get('blackSlate'), body);
  breastplate.position.y = 1.18;
  breastplate.scale.set(0.72, 1.45, 0.62);
  const helm = builder.mesh('needleHelm', new THREE.OctahedronGeometry(0.29, 0), materials.get('lunarSilver'), body);
  helm.position.y = 2.08;
  helm.scale.set(0.74, 1.24, 0.7);
  const visor = builder.mesh('lancerVisor', new THREE.BoxGeometry(0.3, 0.055, 0.04), telegraphMaterial, helm, false);
  visor.position.set(0, 0, -0.22);
  for (const side of [-1, 1]) {
    const pauldron = builder.mesh(
      `${side < 0 ? 'left' : 'right'}StarPauldron`,
      new THREE.ConeGeometry(0.2, 0.58, 5),
      materials.get('slateEdge'),
      body,
    );
    pauldron.position.set(side * 0.53, 1.42, 0);
    pauldron.rotation.z = side * -Math.PI / 2;
  }

  const lance = builder.group('astralLanceJoint', body);
  lance.position.set(0.56, 1.18, -0.08);
  addBeam(
    builder,
    lance,
    'astralLanceShaft',
    new THREE.Vector3(0, 0, 0.35),
    new THREE.Vector3(0, -0.06, -1.95),
    0.045,
    materials.get('lunarSilver'),
    7,
  );
  const lanceTip = builder.mesh('lanceTelegraphTip', new THREE.ConeGeometry(0.17, 0.62, 5), telegraphMaterial, lance);
  lanceTip.position.set(0, -0.07, -2.23);
  lanceTip.rotation.x = -Math.PI / 2;
  const lanceRing = builder.mesh('lanceFocusRing', new THREE.TorusGeometry(0.18, 0.028, 6, 18), materials.get('celestialGold'), lance);
  lanceRing.position.set(0, -0.05, -1.86);
  lanceRing.rotation.x = Math.PI / 2;

  const shield = builder.group('kiteShieldJoint', body);
  shield.position.set(-0.62, 1.03, -0.12);
  const shieldPlate = builder.mesh('constellationKiteShield', new THREE.CylinderGeometry(0.5, 0.35, 0.12, 6), materials.get('slateEdge'), shield);
  shieldPlate.rotation.z = Math.PI / 2;
  shieldPlate.scale.y = 1.35;
  const shieldRune = builder.mesh('shieldWarningRune', new THREE.TorusGeometry(0.22, 0.035, 6, 18), telegraphMaterial, shield, false);
  shieldRune.position.x = -0.08;
  shieldRune.rotation.y = Math.PI / 2;

  addContactShadow(builder, materials, 0.72, 0.62);
  const hitSocket = addSocket(builder, 'hitSocket', breastplate, new THREE.Vector3(0, 0, -0.45));
  const castSocket = addSocket(builder, 'castSocket', lanceTip, new THREE.Vector3(0, 0.31, 0));
  const collision = builder.collision('collisionProxy', new THREE.CapsuleGeometry(0.5, 1.18, 4, 8));
  collision.position.y = 1.14;

  return builder.finish(collision, { hit: hitSocket, cast: castSocket }, (_delta, elapsed, intensity) => {
    body.position.y = 0.08 + Math.sin(elapsed * 2.2) * 0.055;
    lance.position.z = -Math.max(0, Math.sin(elapsed * 2.4)) * 0.08 * intensity;
    lanceTip.scale.setScalar(0.9 + Math.sin(elapsed * 8) * 0.1 * intensity);
    lanceRing.rotation.z = elapsed * 1.4;
    shield.rotation.z = Math.sin(elapsed * 1.3) * 0.035;
  });
}

export function createEclipseChoristerEnemy(materials: MaterialLibrary): AuthoredModel {
  const builder = new ModelBuilder('enemy.eclipseChorister');
  const body = builder.group('eclipseChoristerBody');
  const voiceMaterial = builder.cloneMaterial(
    materials.get<THREE.MeshStandardMaterial>('danger'),
    'material.eclipseChoristerVoice',
    (material) => {
      material.color.set('#e96bba');
      material.emissive.set('#6a0a4a');
      material.emissiveIntensity = 1.5;
    },
  );
  const robeProfile = [
    new THREE.Vector2(0.7, 0),
    new THREE.Vector2(0.62, 0.32),
    new THREE.Vector2(0.36, 1.45),
    new THREE.Vector2(0.28, 1.72),
  ];
  const choirRobe = builder.mesh('bellChoirRobe', new THREE.LatheGeometry(robeProfile, 12), materials.get('void'), body);
  choirRobe.position.y = 0.08;
  const mask = builder.mesh('voicelessChoirMask', new THREE.IcosahedronGeometry(0.27, 1), materials.get('lunarSilver'), body);
  mask.position.set(0, 1.83, -0.2);
  mask.scale.set(0.75, 1.18, 0.45);
  const throat = builder.mesh('telegraphVoiceCore', new THREE.OctahedronGeometry(0.13, 0), voiceMaterial, body, false);
  throat.position.set(0, 1.46, -0.4);
  const halo = builder.mesh(
    'splitEclipseHalo',
    new THREE.TorusGeometry(0.48, 0.055, 7, 26, Math.PI * 1.62),
    materials.get('celestialGold'),
    body,
    false,
  );
  halo.position.y = 2.06;
  halo.rotation.z = Math.PI * 0.18;

  const choirWings: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const wing = builder.group(`${side < 0 ? 'left' : 'right'}ChoirWingJoint`, body);
    wing.position.set(side * 0.42, 1.22, 0.08);
    for (let tier = 0; tier < 3; tier += 1) {
      const vane = builder.mesh(
        `${side < 0 ? 'left' : 'right'}ChoirVane.${tier}`,
        new THREE.ConeGeometry(0.13, 0.72 - tier * 0.1, 4),
        tier === 1 ? materials.get('lunarSilver') : materials.get('blackSlate'),
        wing,
      );
      vane.position.set(side * (0.2 + tier * 0.19), 0.04 - tier * 0.2, 0.1 + tier * 0.08);
      vane.rotation.z = side * (-0.72 - tier * 0.12);
    }
    choirWings.push(wing);
  }

  const notes: THREE.Mesh[] = [];
  for (let index = 0; index < 3; index += 1) {
    const note = builder.mesh(`orbitingChoirNote.${index}`, new THREE.TetrahedronGeometry(0.085, 0), voiceMaterial, body, false);
    notes.push(note);
  }
  addContactShadow(builder, materials, 0.72, 0.58);
  const hitSocket = addSocket(builder, 'hitSocket', choirRobe, new THREE.Vector3(0, 0.9, 0));
  const castSocket = addSocket(builder, 'castSocket', throat, new THREE.Vector3(0, 0, -0.12));
  const collision = builder.collision('collisionProxy', new THREE.CapsuleGeometry(0.5, 1.08, 4, 8));
  collision.position.y = 1.02;

  return builder.finish(collision, { hit: hitSocket, cast: castSocket }, (_delta, elapsed, intensity) => {
    body.position.y = 0.12 + Math.sin(elapsed * 2) * 0.1;
    halo.rotation.y = Math.sin(elapsed * 0.8) * 0.24;
    throat.scale.setScalar(0.82 + Math.sin(elapsed * 7.8) * 0.12 + intensity * 0.08);
    choirWings.forEach((wing, index) => {
      wing.rotation.y = (index === 0 ? -1 : 1) * (0.08 + Math.sin(elapsed * 1.7) * 0.05 * intensity);
    });
    notes.forEach((note, index) => {
      const angle = elapsed * 0.75 + index * Math.PI * 2 / 3;
      note.position.set(Math.cos(angle) * 0.86, 1.18 + Math.sin(angle * 1.6) * 0.36, Math.sin(angle) * 0.62);
      note.rotation.y = elapsed * 1.8 + index;
    });
  });
}

export function createOrreryCastellanEnemy(materials: MaterialLibrary): AuthoredModel {
  const builder = new ModelBuilder('enemy.orreryCastellan');
  const body = builder.group('orreryCastellanBody');
  const equationMaterial = builder.cloneMaterial(
    materials.get<THREE.MeshStandardMaterial>('danger'),
    'material.orreryCastellanEquation',
    (material) => {
      material.color.set('#ff3d62');
      material.emissive.set('#790519');
      material.emissiveIntensity = 1.65;
    },
  );
  const bastion = builder.mesh('castellanBastionCore', new THREE.DodecahedronGeometry(0.78, 0), materials.get('obsidian'), body);
  bastion.position.y = 1.1;
  bastion.scale.set(1.18, 0.92, 1.02);
  const equationCore = builder.mesh('redEquationCore', new THREE.IcosahedronGeometry(0.25, 1), equationMaterial, body, false);
  equationCore.position.set(0, 1.12, -0.76);

  const orrery = builder.group('castellanOrrery', body);
  orrery.position.y = 1.1;
  const rings: THREE.Mesh[] = [];
  [1.02, 1.24, 1.46].forEach((radius, index) => {
    const ring = builder.mesh(
      `castellanOrbit.${index}`,
      new THREE.TorusGeometry(radius, 0.045, 7, 28),
      index === 1 ? materials.get('celestialGold') : materials.get('lunarSilver'),
      orrery,
      false,
    );
    ring.rotation.set(index * 0.7, index * 0.48, index * 0.36);
    ring.userData.baseRotation = ring.rotation.clone();
    rings.push(ring);
  });

  const legJoints: THREE.Group[] = [];
  for (let index = 0; index < 4; index += 1) {
    const angle = index * Math.PI / 2 + Math.PI / 4;
    const leg = builder.group(`castellanLegJoint.${index}`, body);
    leg.position.set(Math.sin(angle) * 0.58, 0.82, Math.cos(angle) * 0.58);
    const foot = new THREE.Vector3(Math.sin(angle) * 0.78, -0.7, Math.cos(angle) * 0.78);
    addBeam(builder, leg, `castellanStrut.${index}`, new THREE.Vector3(), foot, 0.11, materials.get('slateEdge'), 7);
    const anchor = builder.mesh(`castellanAnchor.${index}`, new THREE.CylinderGeometry(0.24, 0.32, 0.22, 6), materials.get('blackSlate'), leg);
    anchor.position.copy(foot).add(new THREE.Vector3(0, -0.08, 0));
    legJoints.push(leg);
  }
  for (let index = 0; index < 5; index += 1) {
    const angle = THREE.MathUtils.lerp(-1.1, 1.1, index / 4);
    const spike = builder.mesh(`castellanCrownSpike.${index}`, new THREE.ConeGeometry(0.1, 0.58, 5), materials.get('lunarSilver'), body);
    spike.position.set(Math.sin(angle) * 0.62, 1.88 + Math.cos(angle) * 0.24, 0.08);
    spike.rotation.z = -angle;
  }

  addContactShadow(builder, materials, 1.28, 1.08);
  const hitSocket = addSocket(builder, 'hitSocket', bastion, new THREE.Vector3(0, 0, -0.68));
  const castSocket = addSocket(builder, 'castSocket', equationCore, new THREE.Vector3(0, 0, -0.24));
  const collision = builder.collision('collisionProxy', new THREE.SphereGeometry(0.96, 10, 7));
  collision.position.y = 1.02;

  return builder.finish(collision, { hit: hitSocket, cast: castSocket }, (_delta, elapsed, intensity) => {
    body.position.y = 0.04 + Math.sin(elapsed * 1.8) * 0.035;
    equationCore.rotation.y = elapsed * 2.2;
    equationCore.scale.setScalar(0.88 + Math.sin(elapsed * 6.4) * 0.1 * intensity);
    rings.forEach((ring, index) => {
      const base = ring.userData.baseRotation as THREE.Euler;
      ring.rotation.set(
        base.x + Math.sin(elapsed * (0.35 + index * 0.06)) * 0.12,
        base.y + elapsed * (index % 2 === 0 ? 0.18 : -0.14),
        base.z,
      );
    });
    legJoints.forEach((leg, index) => {
      leg.rotation.z = Math.sin(elapsed * 2.2 + index * Math.PI * 0.5) * 0.035;
    });
  });
}

export function createEnemyModel(variant: EnemyVariant, materials: MaterialLibrary): AuthoredModel {
  switch (variant) {
    case 'wisp':
    case 'veilWraith': return createVeilWraithEnemy(materials);
    case 'sentinel':
    case 'astralSentinel': return createAstralSentinelEnemy(materials);
    case 'seer':
    case 'eclipseChorister': return createEclipseChoristerEnemy(materials);
    case 'rimeStalker': return createRimeStalkerEnemy(materials);
    case 'ashenInitiate': return createAshenInitiateEnemy(materials);
    case 'astralLancer': return createAstralLancerEnemy(materials);
    case 'orreryCastellan': return createOrreryCastellanEnemy(materials);
  }
}

export function createEclipseArchonBoss(materials: MaterialLibrary): AuthoredModel {
  const builder = new ModelBuilder('boss.eclipseArchon');
  const archon = builder.group('archonBody');
  const torso = builder.mesh('cathedralTorso', new THREE.DodecahedronGeometry(0.9, 0), materials.get('obsidian'), archon);
  torso.position.y = 1.8;
  torso.scale.set(0.84, 1.22, 0.62);
  const crownRoot = builder.group('eclipseCrown', archon);
  crownRoot.position.y = 3.06;
  const halo = builder.mesh('brokenHalo', new THREE.TorusGeometry(0.88, 0.1, 8, 36, Math.PI * 1.7), materials.get('celestialGold'), crownRoot);
  halo.rotation.z = Math.PI * 0.18;
  const face = builder.mesh('eclipseFace', new THREE.IcosahedronGeometry(0.38, 1), materials.get('void'), archon);
  face.position.set(0, 2.68, -0.34);
  face.scale.set(0.76, 1.08, 0.42);
  const core = builder.mesh('eclipseCore', new THREE.OctahedronGeometry(0.28, 1), materials.get('danger'), torso);
  core.position.z = -0.74;

  const crownSpikes: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i += 1) {
    const angle = THREE.MathUtils.lerp(-1.18, 1.18, i / 6);
    const spike = builder.mesh(`crownSpike.${i}`, new THREE.ConeGeometry(0.12, 0.8 + Math.cos(angle) * 0.28, 5), materials.get('lunarSilver'), crownRoot);
    spike.position.set(Math.sin(angle) * 0.83, Math.cos(angle) * 0.45, 0);
    spike.rotation.z = -angle;
    crownSpikes.push(spike);
  }

  const armRoots: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    for (let tier = 0; tier < 2; tier += 1) {
      const arm = builder.group(`${side < 0 ? 'left' : 'right'}ArmJoint.${tier}`, archon);
      arm.position.set(side * 0.58, 2.12 - tier * 0.62, 0);
      const hand = new THREE.Vector3(side * (1.18 + tier * 0.18), tier === 0 ? 0.18 : -0.22, -0.2 + tier * 0.28);
      addBeam(builder, arm, `${side < 0 ? 'left' : 'right'}Arm.${tier}`, new THREE.Vector3(), hand, 0.16 - tier * 0.025, materials.get('void'));
      const blade = builder.mesh(`${side < 0 ? 'left' : 'right'}HandBlade.${tier}`, new THREE.ConeGeometry(0.15, 0.74, 4), tier === 0 ? materials.get('danger') : materials.get('lunarSilver'), arm);
      blade.position.copy(hand).add(new THREE.Vector3(side * 0.22, -0.22, 0));
      blade.rotation.z = side * -0.74;
      armRoots.push(arm);
    }
  }

  const skirt = builder.group('floatingVestments', archon);
  const skirtShards: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const shard = builder.mesh(`vestmentShard.${i}`, new THREE.ConeGeometry(0.25, 1.72, 5), materials.get(i % 2 === 0 ? 'void' : 'blackSlate'), skirt);
    shard.position.set(Math.sin(angle) * 0.52, 0.73, Math.cos(angle) * 0.42);
    shard.rotation.z = Math.sin(angle) * 0.17;
    shard.rotation.x = Math.cos(angle) * 0.17;
    skirtShards.push(shard);
  }

  const orbitingSigils: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i += 1) {
    const sigil = builder.mesh(`orbitingSigil.${i}`, new THREE.TorusGeometry(0.2, 0.035, 6, 18), materials.get('runeLight'), archon, false);
    orbitingSigils.push(sigil);
  }
  addContactShadow(builder, materials, 1.45, 1.12);
  const hitSocket = addSocket(builder, 'hitSocket', torso, new THREE.Vector3(0, 0, -0.72));
  const castSocket = addSocket(builder, 'castSocket', core, new THREE.Vector3(0, 0, -0.3));
  const deathSocket = addSocket(builder, 'deathSocket', archon, new THREE.Vector3(0, 1.75, 0));
  const collision = builder.collision('collisionProxy', new THREE.CapsuleGeometry(0.9, 2.2, 5, 10));
  collision.position.y = 1.65;

  return builder.finish(collision, { hit: hitSocket, cast: castSocket, death: deathSocket }, (_delta, elapsed, intensity) => {
    archon.position.y = 0.22 + Math.sin(elapsed * 1.6) * 0.12;
    crownRoot.rotation.y = elapsed * 0.18;
    halo.rotation.z = Math.PI * 0.18 + Math.sin(elapsed * 0.9) * 0.11;
    core.rotation.y = elapsed * 2.2;
    core.scale.setScalar(0.88 + Math.sin(elapsed * 4.8) * 0.12 * intensity);
    armRoots.forEach((arm, index) => { arm.rotation.z = Math.sin(elapsed * 1.4 + index * 1.2) * 0.12; });
    skirtShards.forEach((shard, index) => { shard.rotation.y = elapsed * (index % 2 === 0 ? 0.14 : -0.12); });
    orbitingSigils.forEach((sigil, index) => {
      const angle = elapsed * (0.5 + index * 0.07) + index * Math.PI * 0.5;
      sigil.position.set(Math.cos(angle) * 1.5, 1.75 + Math.sin(angle * 1.7) * 0.55, Math.sin(angle) * 1.1);
      sigil.lookAt(0, 1.7, 0);
    });
    crownSpikes.forEach((spike, index) => { spike.scale.y = 0.92 + Math.sin(elapsed * 2.1 + index) * 0.08; });
  });
}

export function createCelestialAstrolabe(materials: MaterialLibrary): AuthoredModel {
  const builder = new ModelBuilder('relic.celestialAstrolabe');
  const base = builder.mesh('tripodBase', new THREE.CylinderGeometry(0.62, 0.82, 0.36, 8), materials.get('blackSlate'));
  base.position.y = 0.18;
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    addBeam(builder, builder.root, `tripodLeg.${i}`, new THREE.Vector3(0, 0.34, 0), new THREE.Vector3(Math.sin(angle) * 0.76, 0.03, Math.cos(angle) * 0.76), 0.08, materials.get('lunarSilver'));
  }
  const rings = builder.group('orreryRings');
  rings.position.y = 1.22;
  const ringMeshes: THREE.Mesh[] = [];
  [0.72, 0.54, 0.38].forEach((radius, index) => {
    const ring = builder.mesh(`astronomicalRing.${index}`, new THREE.TorusGeometry(radius, 0.045 - index * 0.006, 7, 32), index === 1 ? materials.get('lunarSilver') : materials.get('celestialGold'), rings);
    ring.rotation.set(index * 0.62, index * 0.44, index * 0.35);
    ringMeshes.push(ring);
  });
  const core = builder.mesh('suspendedMoonstone', new THREE.IcosahedronGeometry(0.24, 2), materials.get('moonstone'), rings);
  const plinthRune = builder.mesh('plinthRune', new THREE.CircleGeometry(0.48, 32), materials.get('runeLight'), builder.root, false);
  plinthRune.rotation.x = -Math.PI / 2;
  plinthRune.position.y = 0.375;
  addContactShadow(builder, materials, 0.85, 0.85);
  const interactSocket = addSocket(builder, 'interactSocket', rings, new THREE.Vector3(0, 0, 0));
  const restorationSocket = addSocket(builder, 'restorationSocket', core, new THREE.Vector3(0, 0, 0));
  const collision = builder.collision('collisionProxy', new THREE.CylinderGeometry(0.74, 0.74, 1.72, 10));
  collision.position.y = 0.86;

  return builder.finish(collision, { interact: interactSocket, restoration: restorationSocket }, (delta, elapsed, intensity) => {
    ringMeshes.forEach((ring, index) => { ring.rotation.z += (index % 2 === 0 ? 1 : -1) * delta * 0.42 * intensity; });
    core.rotation.set(elapsed * 0.7, elapsed * 1.1, elapsed * 0.3);
    core.position.y = Math.sin(elapsed * 2.2) * 0.06;
    plinthRune.rotation.z = elapsed * 0.18;
  });
}

export function createMoonwellRelic(materials: MaterialLibrary): AuthoredModel {
  const builder = new ModelBuilder('relic.moonwell');
  const basin = builder.mesh('crescentBasin', new THREE.CylinderGeometry(0.86, 1.05, 0.42, 12), materials.get('blackSlate'));
  basin.position.y = 0.22;
  const lip = builder.mesh('silverBasinLip', new THREE.TorusGeometry(0.86, 0.085, 8, 32), materials.get('lunarSilver'));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.44;
  const pool = builder.mesh('liquidMoonPool', new THREE.CircleGeometry(0.78, 32), materials.get('glass'), builder.root, false);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.455;
  const arch = builder.group('crescentArch');
  arch.position.y = 1.15;
  const crescent = builder.mesh('moonCrescent', new THREE.TorusGeometry(0.72, 0.09, 8, 32, Math.PI * 1.55), materials.get('celestialGold'), arch);
  crescent.rotation.z = Math.PI * 0.73;
  const tear = builder.mesh('levitatingMoonTear', new THREE.OctahedronGeometry(0.23, 2), materials.get('moonstone'), arch);
  tear.position.y = 0.06;
  tear.scale.y = 1.35;
  const motes: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i += 1) {
    const mote = builder.mesh(`moonMote.${i}`, new THREE.TetrahedronGeometry(0.055, 0), materials.get('spirit'), arch, false);
    motes.push(mote);
  }
  addContactShadow(builder, materials, 1.02, 0.9);
  const interactSocket = addSocket(builder, 'interactSocket', tear, new THREE.Vector3());
  const restorationSocket = addSocket(builder, 'restorationSocket', pool, new THREE.Vector3());
  const collision = builder.collision('collisionProxy', new THREE.CylinderGeometry(0.92, 0.92, 0.9, 12));
  collision.position.y = 0.45;

  return builder.finish(collision, { interact: interactSocket, restoration: restorationSocket }, (_delta, elapsed, intensity) => {
    tear.rotation.y = elapsed * 0.9;
    tear.position.y = 0.06 + Math.sin(elapsed * 2.5) * 0.08;
    pool.rotation.z = -elapsed * 0.12;
    motes.forEach((mote, index) => {
      const angle = elapsed * (0.55 + index * 0.035) + index * Math.PI * 0.4;
      mote.position.set(Math.cos(angle) * (0.38 + index * 0.05), Math.sin(angle * 1.6) * 0.22, Math.sin(angle) * (0.38 + index * 0.05));
      mote.scale.setScalar(0.7 + intensity * 0.3);
    });
  });
}

export function createConstellationReliquary(materials: MaterialLibrary): AuthoredModel {
  const builder = new ModelBuilder('relic.constellationReliquary');
  const root = builder.group('constellationReliquaryBody');
  const starMaterial = builder.cloneMaterial(
    materials.get<THREE.MeshStandardMaterial>('spirit'),
    'material.constellationReliquaryStar',
    (material) => {
      material.color.set('#ffd0b4');
      material.emissive.set('#a33d55');
      material.emissiveIntensity = 1.25;
    },
  );
  const base = builder.mesh(
    'twelveSidedReliquaryPlinth',
    new THREE.CylinderGeometry(0.88, 1.14, 0.48, 12),
    materials.get('blackSlate'),
    root,
  );
  base.position.y = 0.24;
  const plinthBand = builder.mesh(
    'goldenEphemerisBand',
    new THREE.TorusGeometry(0.9, 0.065, 7, 36),
    materials.get('celestialGold'),
    root,
  );
  plinthBand.position.y = 0.47;
  plinthBand.rotation.x = Math.PI / 2;

  const cage = builder.group('astrologyCage', root);
  cage.position.y = 0.44;
  for (let index = 0; index < 3; index += 1) {
    const angle = index * Math.PI * 2 / 3;
    const foot = new THREE.Vector3(Math.sin(angle) * 0.7, 0, Math.cos(angle) * 0.7);
    const crown = new THREE.Vector3(Math.sin(angle) * 0.18, 1.72, Math.cos(angle) * 0.18);
    addBeam(builder, cage, `reliquaryArch.${index}`, foot, crown, 0.055, materials.get('lunarSilver'), 7);
  }

  const constellationCore = builder.mesh(
    'suspendedConstellationCore',
    new THREE.DodecahedronGeometry(0.29, 1),
    starMaterial,
    cage,
    false,
  );
  constellationCore.position.y = 1.04;
  const orbitRoot = builder.group('constellationOrbitRoot', cage);
  orbitRoot.position.y = 1.04;
  const orbitalRings: THREE.Mesh[] = [];
  [0.52, 0.7].forEach((radius, index) => {
    const ring = builder.mesh(
      `constellationOrbit.${index}`,
      new THREE.TorusGeometry(radius, 0.035, 7, 28),
      index === 0 ? materials.get('celestialGold') : materials.get('lunarSilver'),
      orbitRoot,
      false,
    );
    ring.rotation.set(index * 0.82 + 0.38, index * 0.64, index * 0.28);
    orbitalRings.push(ring);
  });
  const orbitalRingBaseRotations = orbitalRings.map((ring) => ring.rotation.clone());
  const constellationNodes: THREE.Mesh[] = [];
  for (let index = 0; index < 6; index += 1) {
    const node = builder.mesh(
      `constellationNode.${index}`,
      new THREE.OctahedronGeometry(index % 3 === 0 ? 0.09 : 0.06, 0),
      index % 2 === 0 ? starMaterial : materials.get('moonstone'),
      orbitRoot,
      false,
    );
    constellationNodes.push(node);
  }
  const runeDisc = builder.mesh(
    'constellationRuneDisc',
    new THREE.CircleGeometry(0.67, 32),
    materials.get('runeLight'),
    root,
    false,
  );
  runeDisc.rotation.x = -Math.PI / 2;
  runeDisc.position.y = 0.495;

  addContactShadow(builder, materials, 1.08, 1.02);
  const interactSocket = addSocket(builder, 'interactSocket', constellationCore, new THREE.Vector3());
  const restorationSocket = addSocket(builder, 'restorationSocket', orbitRoot, new THREE.Vector3());
  const collision = builder.collision('collisionProxy', new THREE.CylinderGeometry(0.96, 0.96, 1.86, 12));
  collision.position.y = 0.93;

  return builder.finish(collision, { interact: interactSocket, restoration: restorationSocket }, (_delta, elapsed, intensity) => {
    constellationCore.rotation.set(elapsed * 0.38, elapsed * 0.72, elapsed * 0.24);
    constellationCore.scale.setScalar(0.9 + Math.sin(elapsed * 3.4) * 0.06 + intensity * 0.035);
    orbitRoot.rotation.y = elapsed * 0.24 * intensity;
    orbitalRings.forEach((ring, index) => {
      const base = orbitalRingBaseRotations[index];
      ring.rotation.set(
        base.x,
        base.y + Math.sin(elapsed * (0.42 + index * 0.08)) * 0.16,
        base.z + elapsed * (index % 2 === 0 ? 0.22 : -0.19) * intensity,
      );
    });
    constellationNodes.forEach((node, index) => {
      const angle = index * Math.PI / 3 + elapsed * (0.28 + (index % 2) * 0.08);
      const radius = index % 2 === 0 ? 0.48 : 0.66;
      node.position.set(
        Math.cos(angle) * radius,
        Math.sin(angle * 1.7) * 0.2,
        Math.sin(angle) * radius,
      );
      node.scale.setScalar(0.82 + Math.sin(elapsed * 4.2 + index) * 0.12);
    });
    runeDisc.rotation.z = -elapsed * 0.11;
  });
}
