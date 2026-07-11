import * as THREE from 'three';

export type ProceduralTextureSet = {
  slate: THREE.CanvasTexture;
  frost: THREE.CanvasTexture;
  runes: THREE.CanvasTexture;
  aurora: THREE.CanvasTexture;
};

type TexturePainter = (context: CanvasRenderingContext2D, size: number) => void;

function createCanvasTexture(
  name: string,
  size: number,
  painter: TexturePainter,
  colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(`Could not create procedural texture: ${name}.`);

  painter(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = name;
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function seededNoise(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function paintSlate(context: CanvasRenderingContext2D, size: number): void {
  const random = seededNoise(0x51a7e);
  context.fillStyle = '#12191d';
  context.fillRect(0, 0, size, size);

  for (let i = 0; i < 540; i += 1) {
    const value = 20 + Math.floor(random() * 25);
    context.fillStyle = `rgba(${value}, ${value + 7}, ${value + 10}, ${0.08 + random() * 0.16})`;
    const radius = 0.4 + random() * 2.2;
    context.fillRect(random() * size, random() * size, radius * 2.8, radius);
  }

  context.lineCap = 'round';
  for (let crack = 0; crack < 16; crack += 1) {
    let x = random() * size;
    let y = random() * size;
    context.beginPath();
    context.moveTo(x, y);
    for (let segment = 0; segment < 5; segment += 1) {
      x += (random() - 0.5) * 34;
      y += (random() - 0.5) * 20;
      context.lineTo(x, y);
    }
    context.strokeStyle = `rgba(1, 5, 8, ${0.18 + random() * 0.2})`;
    context.lineWidth = 0.7 + random() * 1.2;
    context.stroke();
  }
}

function paintFrost(context: CanvasRenderingContext2D, size: number): void {
  const random = seededNoise(0xf2057);
  context.fillStyle = '#d6e5e8';
  context.fillRect(0, 0, size, size);
  for (let i = 0; i < 420; i += 1) {
    const blue = 214 + Math.floor(random() * 35);
    context.fillStyle = `rgba(${blue - 10}, ${blue}, ${blue + 5}, ${0.05 + random() * 0.2})`;
    const length = 1 + random() * 11;
    context.save();
    context.translate(random() * size, random() * size);
    context.rotate(random() * Math.PI);
    context.fillRect(-length * 0.5, -0.5, length, 1);
    context.restore();
  }
}

function paintRunes(context: CanvasRenderingContext2D, size: number): void {
  context.clearRect(0, 0, size, size);
  context.strokeStyle = '#b9fbff';
  context.fillStyle = '#b9fbff';
  context.lineWidth = 4;
  context.shadowBlur = 7;
  context.shadowColor = '#4ed6e8';

  const cell = size / 4;
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const cx = column * cell + cell * 0.5;
      const cy = row * cell + cell * 0.5;
      const radius = cell * 0.28;
      context.beginPath();
      context.arc(cx, cy, radius, -Math.PI * 0.8, Math.PI * 0.65);
      context.stroke();
      context.beginPath();
      context.moveTo(cx - radius * 0.75, cy + radius * 0.5);
      context.lineTo(cx, cy - radius * 0.8);
      context.lineTo(cx + radius * 0.7, cy + radius * 0.45);
      context.stroke();
      context.beginPath();
      context.arc(cx, cy, 3, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function paintAurora(context: CanvasRenderingContext2D, size: number): void {
  context.fillStyle = '#07101b';
  context.fillRect(0, 0, size, size);
  const gradient = context.createLinearGradient(0, 0, size, 0);
  gradient.addColorStop(0, 'rgba(53, 212, 190, 0)');
  gradient.addColorStop(0.18, 'rgba(53, 212, 190, 0.68)');
  gradient.addColorStop(0.48, 'rgba(126, 115, 255, 0.5)');
  gradient.addColorStop(0.74, 'rgba(100, 245, 221, 0.72)');
  gradient.addColorStop(1, 'rgba(53, 212, 190, 0)');
  context.fillStyle = gradient;
  for (let band = 0; band < 6; band += 1) {
    const y = size * (0.12 + band * 0.15);
    context.beginPath();
    context.moveTo(0, y);
    for (let x = 0; x <= size; x += 8) {
      const wave = Math.sin(x * 0.045 + band * 1.7) * (10 + band * 1.6);
      context.lineTo(x, y + wave);
    }
    context.lineTo(size, y + 28);
    context.lineTo(0, y + 28);
    context.closePath();
    context.globalAlpha = 0.12 + band * 0.035;
    context.fill();
  }
  context.globalAlpha = 1;
}

export function createProceduralTextures(): ProceduralTextureSet {
  const slate = createCanvasTexture('proceduralBlackSlate', 256, paintSlate);
  slate.repeat.set(8, 8);
  const frost = createCanvasTexture('proceduralFrost', 128, paintFrost);
  frost.repeat.set(5, 5);
  const runes = createCanvasTexture('proceduralRuneAtlas', 256, paintRunes);
  const aurora = createCanvasTexture('proceduralAurora', 256, paintAurora);
  return { slate, frost, runes, aurora };
}

export function setProceduralTextureAnisotropy(textures: ProceduralTextureSet, anisotropy: number): void {
  const value = Math.max(1, Math.floor(anisotropy));
  Object.values(textures).forEach((texture) => {
    texture.anisotropy = value;
  });
}

export function disposeProceduralTextures(textures: ProceduralTextureSet): void {
  Object.values(textures).forEach((texture) => texture.dispose());
}
