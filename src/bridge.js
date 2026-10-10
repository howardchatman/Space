import * as THREE from 'three';

const Z = new THREE.Vector3(0, 0, 1);

function bar(material, from, to, width, depth) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, depth, dir.length()), material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Z, dir.normalize());
  return mesh;
}

/** Console screen art: tactical rings, system bars or scrolling log lines. */
function consoleTexture(color, kind, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const g = canvas.getContext('2d');
  g.fillStyle = '#03050a';
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = color;
  g.fillStyle = color;
  let r = seed;
  const rnd = () => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
  if (kind === 'tactical') {
    g.globalAlpha = 0.5;
    for (const rad of [22, 44, 66]) {
      g.beginPath();
      g.arc(128, 80, rad, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(128, 8);
    g.lineTo(128, 152);
    g.moveTo(56, 80);
    g.lineTo(200, 80);
    g.stroke();
    g.globalAlpha = 1;
    for (let i = 0; i < 7; i++) g.fillRect(70 + rnd() * 116, 24 + rnd() * 112, 4, 4);
  } else if (kind === 'systems') {
    for (let i = 0; i < 6; i++) {
      g.globalAlpha = 0.3;
      g.fillRect(20, 16 + i * 23, 216, 12);
      g.globalAlpha = 0.9;
      g.fillRect(20, 16 + i * 23, 216 * (0.4 + rnd() * 0.6), 12);
    }
  } else {
    g.globalAlpha = 0.85;
    for (let i = 0; i < 9; i++) g.fillRect(16, 14 + i * 15, 60 + rnd() * 160, 5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The warship's bridge around the captain's eye: a wide forward window with a few frame bars, side
 * windows, a ceiling, the crew's console row below the forward window and a back wall.
 * Built in the bridge anchor's space (-Z ahead, meters). The camera sits at the origin.
 */
export function buildBridge({ flare, ice, hostile }) {
  const group = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.62, metalness: 0.5 });
  const panel = new THREE.MeshLambertMaterial({ color: 0x111317 });
  const deck = new THREE.MeshLambertMaterial({ color: 0x0c0d10 });

  const front = -6;
  const back = 14;
  const top = 3.4;
  const sill = -3.1;
  const floor = -4.8;
  const side = 15;

  // Forward window: sill, header and mullions well off the center line.
  group.add(
    bar(frame, new THREE.Vector3(-side, sill, front), new THREE.Vector3(side, sill, front), 0.35, 0.3),
    bar(frame, new THREE.Vector3(-side, top - 0.15, front), new THREE.Vector3(side, top - 0.15, front), 0.4, 0.3),
  );
  for (const x of [-11, -5.4, 5.4, 11]) {
    group.add(bar(frame, new THREE.Vector3(x, sill, front), new THREE.Vector3(x, top, front), 0.28, 0.3));
  }
  // Side windows: open frames along each wall.
  for (const s of [-1, 1]) {
    const x = s * side;
    group.add(
      bar(frame, new THREE.Vector3(x, sill, front), new THREE.Vector3(x, sill, back), 0.3, 0.3),
      bar(frame, new THREE.Vector3(x, top - 0.15, front), new THREE.Vector3(x, top - 0.15, back), 0.3, 0.3),
    );
    for (let z = front; z <= back - 4; z += 4.5) {
      group.add(bar(frame, new THREE.Vector3(x, sill, z), new THREE.Vector3(x, top, z), 0.28, 0.28));
    }
    const wallBelow = new THREE.Mesh(new THREE.PlaneGeometry(back - front, sill - floor), panel);
    wallBelow.position.set(x, (sill + floor) / 2, (front + back) / 2);
    wallBelow.rotation.y = -s * Math.PI / 2;
    group.add(wallBelow);
  }

  // Ceiling with light strips, floor and back wall.
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(side * 2, back - front), panel);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, top, (front + back) / 2);
  group.add(ceiling);
  const stripMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.5, 0.42) });
  for (const x of [-6, 0, 6]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.3, back - front - 4), stripMaterial);
    strip.rotation.x = Math.PI / 2;
    strip.position.set(x, top - 0.02, (front + back) / 2 + 1);
    group.add(strip);
  }
  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(side * 2, back - front), deck);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(0, floor, (front + back) / 2);
  group.add(floorMesh);
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(side * 2, top - floor), panel);
  backWall.rotation.y = Math.PI;
  backWall.position.set(0, (top + floor) / 2, back);
  group.add(backWall);
  const doorMaterial = new THREE.MeshBasicMaterial({ color: flare.clone().multiplyScalar(0.5) });
  for (const x of [-1.3, 1.3]) {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 4.2), doorMaterial);
    edge.rotation.y = Math.PI;
    edge.position.set(x, floor + 2.1, back - 0.02);
    group.add(edge);
  }

  // Crew consoles below the forward window: slanted desks with screens.
  const screens = [
    ['tactical', hostile], ['systems', ice], ['log', flare], ['tactical', ice], ['systems', flare], ['log', ice],
  ];
  const consoleWidth = 4.2;
  screens.forEach(([kind, color], i) => {
    const x = (i - (screens.length - 1) / 2) * (consoleWidth + 0.5);
    const desk = new THREE.Mesh(new THREE.BoxGeometry(consoleWidth, 1.1, 1.6), panel);
    desk.position.set(x, sill - 0.9, front + 1.4);
    desk.rotation.x = 0.45;
    group.add(desk);
    const hex = `#${color.getHexString(THREE.SRGBColorSpace)}`;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.9),
      new THREE.MeshBasicMaterial({ map: consoleTexture(hex, kind, i * 977 + 13), color: new THREE.Color(0.32, 0.32, 0.32) }),
    );
    screen.position.set(-0.9, 0.56, 0);
    screen.rotation.x = -Math.PI / 2;
    desk.add(screen);
    const screen2 = screen.clone();
    screen2.material = screen.material.clone();
    screen2.material.map = consoleTexture(hex, kind === 'log' ? 'systems' : 'log', i * 131 + 7);
    screen2.position.x = 0.9;
    desk.add(screen2);
  });

  // No light here: lights inside groups that get hidden would change the light count and force
  // every material to recompile. The game owns one interior light on the camera instead.
  return group;
}
