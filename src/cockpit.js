import * as THREE from 'three';

const Z = new THREE.Vector3(0, 0, 1);

/** A bar of the given thickness running between two points. */
function strut(material, from, to, width, depth) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, depth, dir.length()), material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Z, dir.normalize());
  return mesh;
}

/** A small screen texture: faint grid and trace lines, like an idle instrument display. */
function screenTexture(color, kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const g = canvas.getContext('2d');
  g.fillStyle = '#020306';
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = color;
  g.globalAlpha = 0.25;
  g.lineWidth = 1;
  for (let x = 16; x < 256; x += 24) {
    g.beginPath();
    g.moveTo(x, 8);
    g.lineTo(x, 152);
    g.stroke();
  }
  for (let y = 16; y < 160; y += 24) {
    g.beginPath();
    g.moveTo(8, y);
    g.lineTo(248, y);
    g.stroke();
  }
  g.globalAlpha = 0.9;
  g.lineWidth = 2;
  g.beginPath();
  if (kind === 'wave') {
    for (let x = 8; x < 248; x += 4) g.lineTo(x, 80 + Math.sin(x / 14) * 26 * Math.sin(x / 60));
  } else {
    g.arc(128, 80, 56, 0, Math.PI * 2);
    g.moveTo(128, 80);
    g.lineTo(170, 42);
  }
  g.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Dark composite panel with seams and fastener heads, so the dash isn't a flat slab. */
function panelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 288;
  const g = canvas.getContext('2d');
  g.fillStyle = '#17191d';
  g.fillRect(0, 0, 1024, 288);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.04})`;
    g.fillRect(Math.random() * 1024, Math.random() * 288, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.lineWidth = 3;
  for (const x of [190, 512, 834]) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 288);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, 210);
  g.lineTo(1024, 210);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.12)';
  for (const x of [178, 202, 500, 524, 822, 846]) {
    for (const y of [24, 186, 234, 266]) g.fillRect(x - 2, y - 2, 4, 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * The cockpit around the pilot's eye: canopy struts in the upper corners and a dashboard along the
 * bottom of the view. It is parented to the camera and lit by the real sun, so the light on the frame
 * shifts as the ship turns. Coordinates are in camera space: -Z ahead, +Y up, units in meters.
 */
export function buildCockpit({ flare, ice }) {
  const group = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x26292e, roughness: 0.68, metalness: 0.45 });
  // Matte panels: no sun glints across the dash.
  const panel = new THREE.MeshLambertMaterial({ color: 0x15171b });
  const panelTop = new THREE.MeshLambertMaterial({ map: panelTexture() });

  // Canopy: two forward struts rising from the dashboard corners to a bow just above the view.
  const bowL = new THREE.Vector3(-0.72, 1.02, -1.3);
  const bowR = new THREE.Vector3(0.72, 1.02, -1.3);
  group.add(
    strut(frame, new THREE.Vector3(-1.75, -0.68, -1.0), bowL, 0.09, 0.06),
    strut(frame, new THREE.Vector3(1.75, -0.68, -1.0), bowR, 0.09, 0.06),
    strut(frame, bowL, bowR, 0.08, 0.06),
    strut(frame, bowL, new THREE.Vector3(-1.1, 1.25, 0.4), 0.08, 0.06),
    strut(frame, bowR, new THREE.Vector3(1.1, 1.25, 0.4), 0.08, 0.06),
  );

  // Dashboard, tilted toward the pilot. Screens and lamps sit on its face, in its local space.
  const dash = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.55, 1.0), [panel, panel, panelTop, panel, panel, panel]);
  dash.position.set(0, -1.06, -1.05);
  dash.rotation.x = 0.35;
  group.add(dash);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 0.1), panel);
  lip.position.set(0, 0.3, -0.47);
  dash.add(lip);

  const screens = [
    { x: -0.8, color: ice, kind: 'scope' },
    { x: 0.8, color: flare, kind: 'wave' },
  ];
  for (const s of screens) {
    const hex = `#${s.color.getHexString(THREE.SRGBColorSpace)}`;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.3),
      new THREE.MeshBasicMaterial({ map: screenTexture(hex, s.kind), color: new THREE.Color(0.6, 0.6, 0.6) }),
    );
    screen.rotation.x = -Math.PI / 2;
    screen.position.set(s.x, 0.278, -0.22);
    dash.add(screen);
  }

  // Status lights at the outer ends of the panel, clear of the radar in the middle.
  for (let i = 0; i < 6; i++) {
    const on = i % 3 !== 2;
    const side = i < 3 ? -1 : 1;
    const color = (side < 0 ? ice : flare).clone().multiplyScalar(on ? 0.8 : 0.08);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.03), new THREE.MeshBasicMaterial({ color }));
    lamp.position.set(side * (1.2 + (i % 3) * 0.11), 0.28, -0.3);
    dash.add(lamp);
  }

  // The interior light lives on the camera (see Game), so hiding the cockpit doesn't change the light count.

  return group;
}

/**
 * Brief flashes at the cannon muzzles, parented to the camera so they stay with the ship.
 * Returns a map from muzzle name to sprite; set a sprite's `userData.life` to show it.
 */
export function addMuzzleFlashes(camera, muzzles, color, texture) {
  const flashes = {};
  for (const [name, position] of Object.entries(muzzles)) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      color: color.clone().multiplyScalar(1.2),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
    sprite.position.copy(position);
    sprite.scale.setScalar(0.9);
    sprite.visible = false;
    sprite.userData.life = 0;
    camera.add(sprite);
    flashes[name] = sprite;
  }
  return flashes;
}
