import * as THREE from 'three';

const cache = new Map();

function canvasTexture(key, size, paint) {
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, texture);
  return texture;
}

/** Soft round glow with a hot core: suns, engine plumes, fireballs. */
export function glowTexture() {
  return canvasTexture('glow', 256, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.08, 'rgba(255,255,255,0.8)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.22)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.05)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

/** A star seen from space: a small blinding disc with a long, faint glare falloff. */
export function sunTexture() {
  return canvasTexture('sun', 512, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.035, 'rgba(255,255,255,1)');
    grad.addColorStop(0.06, 'rgba(255,255,255,0.3)');
    grad.addColorStop(0.14, 'rgba(255,255,255,0.07)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.015)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

/** Thin bright ring for shockwaves. */
export function ringTexture() {
  return canvasTexture('ring', 256, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.75, 'rgba(255,255,255,0.7)');
    grad.addColorStop(0.85, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}
