import * as THREE from 'three';
import { rand } from './util/math.js';

// Left to right along the console row in bridge.js. Damage control reports come from engineering.
const STATIONS = ['Sensors', 'Engineering', 'Helm', 'Weapons', 'Flight deck', 'Comms'];
const ALIASES = { 'Damage control': 'Engineering' };
const SKIN = [0xc58c6a, 0x8d5a3b, 0xe0b48f, 0x5e3a26, 0xb07a52, 0xd9a07a];
const HAIR = [0x1b1512, 0x3a2618, 0x0f0d0c, 0x6b4a2a, 0x24180f, 0x8a7350];

/**
 * The bridge crew: one officer seated at each console, seen from behind. They type, breathe and glance
 * around; when their station reports, they turn and look back at the captain while they speak.
 * Built in the bridge's space to match the console row (consoles 4.7 m apart, desks at z = -4.6).
 */
export class BridgeCrew {
  constructor(bridge, { flare, ice, hostile }) {
    this.figures = [];
    const uniform = {
      Sensors: ice,
      Engineering: flare,
      Helm: flare,
      Weapons: hostile,
      'Flight deck': ice,
      Comms: ice,
    };
    const dark = new THREE.MeshLambertMaterial({ color: 0x15171c });
    STATIONS.forEach((station, i) => {
      const x = (i - (STATIONS.length - 1) / 2) * 4.7;
      const figure = this.#build(x, {
        uniform: new THREE.MeshLambertMaterial({ color: uniform[station].clone().multiplyScalar(0.2).lerp(new THREE.Color(0x1d2027), 0.5) }),
        skin: new THREE.MeshLambertMaterial({ color: SKIN[i % SKIN.length] }),
        hair: new THREE.MeshLambertMaterial({ color: HAIR[(i * 4 + 1) % HAIR.length] }),
        dark,
      });
      figure.station = station;
      bridge.add(figure.root);
      this.figures.push(figure);
    });
  }

  /** The station that just reported turns to look back at the captain. */
  speak(station) {
    const name = ALIASES[station] ?? station;
    const f = this.figures.find((x) => x.station === name);
    if (f) f.talk = 2.4;
  }

  update(dt, time) {
    for (const f of this.figures) {
      f.talk = Math.max(0, f.talk - dt);
      f.glanceTimer -= dt;
      if (f.glanceTimer <= 0) {
        f.glanceTimer = rand(3, 9);
        f.glance = Math.random() < 0.6 ? 0 : rand(-0.5, 0.5);
      }
      // Turn toward the captain (behind them, toward the middle of the room) while talking.
      const back = -Math.sign(f.x || 1);
      const talking = f.talk > 0 ? Math.min(1, f.talk * 2, (2.4 - f.talk) * 4) : 0;
      const headYaw = THREE.MathUtils.lerp(f.glance, back * 1.25, talking);
      const torsoYaw = back * 0.35 * talking;
      f.head.rotation.y += (headYaw - f.head.rotation.y) * Math.min(1, dt * 6);
      f.torso.rotation.y += (torsoYaw - f.torso.rotation.y) * Math.min(1, dt * 5);
      f.head.rotation.x = talking > 0 ? Math.sin(time * 9 + f.phase) * 0.06 * talking : -0.12;
      // Breathing, and hands working the console when not talking.
      f.torso.scale.y = 1 + Math.sin(time * 1.6 + f.phase) * 0.012;
      const typing = 1 - talking;
      f.arms[0].rotation.x = f.armRest + Math.sin(time * 7.3 + f.phase) * 0.05 * typing;
      f.arms[1].rotation.x = f.armRest + Math.sin(time * 6.1 + f.phase * 2) * 0.05 * typing;
    }
  }

  #build(x, m) {
    const floor = -4.8;
    const seat = floor + 0.78;
    const root = new THREE.Group();
    root.position.set(x, 0, -3.15);

    // Chair: pedestal, seat and a low back.
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.2, seat - floor - 0.06, 8), m.dark);
    pedestal.position.y = (seat + floor) / 2 - 0.03;
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.1, 0.52), m.dark);
    cushion.position.y = seat - 0.05;
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.08), m.dark);
    chairBack.position.set(0, seat + 0.32, 0.28);
    chairBack.rotation.x = -0.12;
    root.add(pedestal, cushion, chairBack);

    // Thighs reach forward under the desk.
    const thighs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.5), m.uniform);
    thighs.position.set(0, seat + 0.08, -0.16);
    root.add(thighs);

    // Torso, pivoting at the hips, leaning a little into the console.
    const torso = new THREE.Group();
    torso.position.set(0, seat + 0.12, 0.02);
    torso.rotation.x = -0.12;
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.36, 4, 10), m.uniform);
    chest.scale.set(1.15, 1, 0.75);
    chest.position.y = 0.37;
    torso.add(chest);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 8), m.skin);
    neck.position.y = 0.74;
    torso.add(neck);

    const head = new THREE.Group();
    head.position.y = 0.8;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), m.skin);
    skull.scale.set(0.9, 1.08, 1);
    skull.position.y = 0.1;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), m.hair);
    hair.scale.set(0.92, 1.08, 1.04);
    hair.position.set(0, 0.11, 0.01);
    hair.rotation.x = 0.35; // covers the back of the head, which is what the captain sees
    head.add(skull, hair);
    torso.add(head);

    // Arms from the shoulders down to the desk.
    const arms = [-1, 1].map((s) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.25, 0.6, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.26, 4, 8), m.uniform);
      upper.position.y = -0.16;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.32;
      elbow.rotation.x = 0.95;
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.24, 4, 8), m.uniform);
      fore.position.y = -0.15;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), m.skin);
      hand.position.y = -0.31;
      elbow.add(fore, hand);
      shoulder.add(elbow);
      shoulder.rotation.z = s * 0.12;
      torso.add(shoulder);
      return shoulder;
    });
    const armRest = 0.45;
    for (const a of arms) a.rotation.x = armRest;
    root.add(torso);

    return { root, torso, head, arms, armRest, x, talk: 0, glance: 0, glanceTimer: rand(1, 6), phase: rand(0, 10) };
  }
}
