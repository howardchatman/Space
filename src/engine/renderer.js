import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * WebGL renderer plus the post-processing chain: the scene renders in HDR, bright things (the sun,
 * lasers, explosions) bleed light through a bloom pass, then a filmic tone curve maps it to the screen.
 */
export class Pipeline {
  constructor(canvas, { lowPower = false } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.lowPower = lowPower;
    // Sun shadows on the ships and rocks near the camera. Fixed at startup: toggling it recompiles shaders.
    this.shadows = !lowPower;
    this.renderer.shadowMap.enabled = this.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  attach(scene, camera) {
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: this.lowPower ? 0 : 4,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.55, 0.9);
    // One NaN pixel (a model's broken normal, say) would be smeared by the bloom blur into black blocks
    // across the whole view, so the bloom ignores anything that isn't a finite, non-negative color.
    const highPass = this.bloom.materialHighPassFilter;
    const read = 'vec4 texel = texture2D( tDiffuse, vUv );';
    if (!highPass.fragmentShader.includes(read)) throw new Error('Bloom shader changed: re-add the NaN guard');
    highPass.fragmentShader = highPass.fragmentShader.replace(read, `${read}
      if ( any( isnan( texel ) ) ) texel = vec4( 0.0 );
      texel = clamp( texel, 0.0, 60000.0 );`);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(width, height, dpr) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
  }

  render() {
    this.composer.render();
  }
}
