// The 3D scene contains the black hole, notes, dust, nebulae and comets.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { forceSimulation, forceLink, forceManyBody } from 'd3-force-3d';
import {
  BH_VERT, BH_FRAG, SKY_VERT, SKY_FRAG, STAR_VERT, STAR_FRAG, DUST_VERT,
  BG_VERT, BG_FRAG, LINE_VERT, LINE_FRAG, COMET_VERT, COMET_FRAG, COMET_HEAD_VERT, COMET_HEAD_FRAG, NEB_VERT, NEB_FRAG,
} from './shaders.js';

// World units per Schwarzschild radius. The disk spans 3 to 12 radii and the ray tracer uses a bounding sphere of 14 radii.
export const RS = 19.5;
const BH = { rin: 3.0, rout: 12.0, rbound: 14.0 };
export const KEEP_OUT = BH.rbound * RS * 1.25;

// Keplerian angular velocity is sqrt(GM / r³). Clusters move more slowly than dust for legibility. Comets use the same law on a faster clock.
const GM_DUST = 18500;
const GM_NODES = GM_DUST * 0.45;
const GM_COMET = 2.6e6;

const TAU = Math.PI * 2;
// How far the camera may move away. Beyond this the galaxy is a small spot; the cluster names fade
// out shortly before (LABEL_FADE, used by the overlay).
export const MAX_DISTANCE = 2800;
export const LABEL_FADE = [2150, 2650];
const IDLE_MS = 5000; // Idle delay before switching from 60 to 30 fps.
const SIM_SETTLE_MS = 6000; // Time to keep layout forces active after a data change.
const STAR_WHITE = [1.0, 0.95, 0.88];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r());
}
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const PALETTE_ORDER = [5, 0, 3, 1, 2, 4, 6];

// Tasks (note properties, see model.js): stars of open tasks get their own colors, overdue ones pulse.
// taskState: 'overdue' | 'open' | 'partial' | 'done' | null (the note is no task)
const TASK_COLORS = { overdue: [1.45, 0.5, 0.42], open: [1.4, 0.95, 0.5], partial: [1.25, 1.15, 0.62] };
export function taskState(n) {
  const t = n.task;
  if (!t) return null;
  if (t.status === 'done') return 'done';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (t.due != null && t.due < today.getTime()) return 'overdue';
  return t.status === 'partial' ? 'partial' : 'open';
}
// Four domain-warped noise textures share a 2 by 2 atlas.
let NEB_ATLAS = null;
function nebulaAtlas() {
  if (NEB_ATLAS) return NEB_ATLAS;
  const S = 256, R = rng(99);
  const G = 64;
  const grid = new Float32Array((G + 1) * (G + 1)).map(() => R());
  const val = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const g = (i, j) => grid[(((j % G) + G) % G) * (G + 1) + (((i % G) + G) % G)];
    return g(xi, yi) * (1 - u) * (1 - v) + g(xi + 1, yi) * u * (1 - v) + g(xi, yi + 1) * (1 - u) * v + g(xi + 1, yi + 1) * u * v;
  };
  const fbm = (x, y) => {
    let f = 0, a = 0.5;
    for (let o = 0; o < 5; o++) { f += a * val(x, y); x = x * 2.03 + 3.1; y = y * 2.03 + 1.7; a *= 0.5; }
    return f;
  };
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S * 2;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S * 2, S * 2);
  for (let t = 0; t < 4; t++) {
    const ox = (t % 2) * S, oy = Math.floor(t / 2) * S, sh = t * 17.3;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const fx = (x / S) * 3 + sh, fy = (y / S) * 3 + sh * 0.7;
        const wx = fbm(fx + 4.2, fy + 1.3), wy = fbm(fx - 2.7, fy + 5.1);
        const n = fbm(fx + wx * 2.2, fy + wy * 2.2);
        const dx = x / S - 0.5, dy = y / S - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) * 2;
        const fall = Math.max(0, 1 - d);
        const v = Math.pow(Math.max(0, n - 0.3) * 1.8, 1.6) * fall * fall * (3 - 2 * fall);
        const i = ((oy + y) * S * 2 + ox + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, v * 255);
        img.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  NEB_ATLAS = new THREE.CanvasTexture(canvas);
  NEB_ATLAS.minFilter = THREE.LinearMipmapLinearFilter;
  return NEB_ATLAS;
}

export class Galaxy {
  constructor(container, opts = {}) {
    this.container = container;
    this.doc = container.ownerDocument;
    this.win = this.doc.defaultView;
    this.opts = opts;
    this.mode = opts.mode || 'global';
    this.colors = opts.colors;
    this.paused = false;
    this.time = 0;
    this.orbitTime = 0;
    this.nodes = [];
    this.links = [];
    this.nodeById = new Map();
    this.clusters = [];
    this.clusterByKey = new Map();
    this.centroids = new Map();
    this.neighbors = new Map();
    this.hover = null;
    this.follow = null;
    this.fly = null;
    this.lastInteract = -1e9;
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsN = 0;
    this._v = new THREE.Vector3();
    this.uScale = { value: 1 };
    this.uRes = { value: new THREE.Vector2(1, 1) }; // Drawing buffer size in device pixels, for comet tails
    this.uDpr = { value: 1 };
    this._activeAt = performance.now();
    this._simUntil = 0;
    this.uTime = { value: 0 };
    this.uFocus = { value: 1700 }; // The focus distance runs from the camera to its target.
    // The expanding intro front reveals stars, dust and links before the sky, nebulae and comets fade in.
    this.uReveal = { value: 1e7 };
    this.uLens = { value: RS }; // Black hole mass used to lens stars and dust.
    this.uIntro = { value: 1 };
    this._setupIntro(opts.intro);
    try {
      this._initRenderer();
      this._initScene();
      this._initEvents();
    } catch (e) {
      this.dispose();
      throw e;
    }
    this._frame = this._frame.bind(this);
    this._raf = this.win.requestAnimationFrame(this._frame);
  }

  // Scene setup
  _initRenderer() {
    const r = (this.renderer = new THREE.WebGLRenderer({
      canvas: this.doc.createElement('canvas'),
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    }));
    this.pixelRatio = Math.min(this.win.devicePixelRatio || 1, 1.5);
    r.setPixelRatio(this.pixelRatio);
    r.setClearColor(0x000000, 1);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 2, 30000);
    // The star field faces the camera in the XY plane. The disk lies in XZ and appears almost edge-on.
    this.homeCam = this.mode === 'local' ? new THREE.Vector3(0, 80, 1400) : new THREE.Vector3(0, 95, 1700);
    this.camera.position.copy(this.homeCam);

    const c = (this.controls = new OrbitControls(this.camera, r.domElement));
    Object.assign(c, {
      enableDamping: true, dampingFactor: 0.06, rotateSpeed: 0.55, zoomSpeed: 0.9, panSpeed: 0.6,
      minDistance: 90, maxDistance: MAX_DISTANCE, autoRotate: true, autoRotateSpeed: 0,
    });
    c.addEventListener('start', () => {
      this.wake();
      this.lastInteract = performance.now();
      this.fly = null;
    });

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.3, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resizeObserver = new this.win.ResizeObserver(() => this._resize());
    this.resizeObserver.observe(this.container);
    this._resize();
  }

  _initScene() {
    const R = rng(7);

    // Sky and haze
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: { uTint: { value: new THREE.Color(1, 1, 1) }, uTime: this.uTime, uIntro: this.uIntro },
      side: THREE.BackSide, depthWrite: false, transparent: true,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), this.skyMat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.scene.add(sky);

    // Distant stars
    {
      const n = 1300;
      const pos = new Float32Array(n * 3);
      const size = new Float32Array(n);
      const bright = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const z = R() * 2 - 1;
        const a = R() * TAU;
        const s = Math.sqrt(1 - z * z);
        pos.set([Math.cos(a) * s * 7600, z * 7600, Math.sin(a) * s * 7600], i * 3);
        size[i] = 1.2 + Math.pow(R(), 6) * 2.6;
        bright[i] = 0.15 + Math.pow(R(), 3) * 0.75;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
      const pts = new THREE.Points(g, new THREE.ShaderMaterial({
        vertexShader: BG_VERT, fragmentShader: BG_FRAG, uniforms: { uIntro: this.uIntro }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      pts.renderOrder = -9;
      pts.frustumCulled = false;
      this.scene.add(pts);
    }

    // Trace light paths per pixel on the back faces of the bounding sphere.
    this.bhMat = new THREE.ShaderMaterial({
      vertexShader: BH_VERT, fragmentShader: BH_FRAG,
      uniforms: {
        uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uRin: { value: BH.rin }, uRout: { value: BH.rout },
        uRbound: { value: BH.rbound }, uRs: { value: RS }, uAccent: { value: new THREE.Color(1, 0.8, 0.6) },
        uAccentMix: { value: 0.05 }, uBright: { value: 0.42 }, uBeam: { value: 1.0 },
        // Tilt the disk slightly to reveal its upper surface.
        uN: { value: new THREE.Vector3(-0.13, 1, 0.07).normalize() },
        uIgnite: { value: this.intro ? 0 : 1 },
      },
      side: THREE.BackSide, transparent: true, depthWrite: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.bh = new THREE.Mesh(new THREE.SphereGeometry(BH.rbound * RS, 64, 32), this.bhMat);
    this.bh.renderOrder = -5;
    this.bh.frustumCulled = false;
    this.scene.add(this.bh);

    // Warm glow from the disk
    {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      const gr = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      // Keep the center clear so the black hole shadow stays dark.
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.16, 'rgba(255,255,255,0)');
      gr.addColorStop(0.26, 'rgba(255,255,255,0.45)');
      gr.addColorStop(0.6, 'rgba(255,255,255,0.08)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(c);
      this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        color: new THREE.Color(1.0, 0.62, 0.3), opacity: 0.38,
      }));
      this.glow.scale.set(BH.rout * RS * 2.6, BH.rout * RS * 1.5, 1);
      this.glow.renderOrder = -5.5;
      this.scene.add(this.glow);
    }

    this._buildComets();
    this._buildSmoke();

    // setData supplies the geometry for stars and links.
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      uniforms: {
        uScale: this.uScale, uTime: this.uTime, uMinPx: { value: 2.0 }, uFocus: this.uFocus, uReveal: this.uReveal,
        uLensRs: this.uLens, uSecondary: { value: 0 }, uDpr: this.uDpr,
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    // Render the same geometry again for secondary images.
    this.starMat2 = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      uniforms: { ...this.starMat.uniforms, uSecondary: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.lineMat = new THREE.ShaderMaterial({
      vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, uniforms: { uFocus: this.uFocus, uReveal: this.uReveal },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  // Place dust in a thin shell around the black hole and in clouds around clusters.
  _buildDust() {
    if (this.dust) {
      this.scene.remove(this.dust);
      this.scene.remove(this.dust2);
      this.dust.geometry.dispose();
    }
    const R = rng(this.mode === 'local' ? 11 : 3);
    const list = this.clusters.filter((c) => c.key !== '__center').slice(0, 32);
    this.dustClusters = list;
    const shell = this.mode === 'local' ? 600 : 1000;
    const infall = this.mode === 'local' ? 180 : 320; // Particles spiraling into the black hole
    const per = list.map((c) => Math.round(Math.min(130, 20 + c.ideas * 0.3)));
    const N = shell + infall + per.reduce((a, b) => a + b, 0);
    const aR = new Float32Array(N), aA = new Float32Array(N), aH = new Float32Array(N), aCl = new Float32Array(N);
    const aSize = new Float32Array(N), aBright = new Float32Array(N), aColor = new Float32Array(N * 3);
    this.dustTint = new Float32Array(N);
    let i = 0;
    for (; i < infall; i++) {
      aR[i] = KEEP_OUT * (0.55 + R() * 0.7);
      aA[i] = R() * TAU;
      aH[i] = gauss(R) * aR[i] * 0.3;
      aCl[i] = -2;
      aSize[i] = 0.9 + R() * 1.0;
      aBright[i] = 0.5 + R() * 0.6;
      this.dustTint[i] = 0.25 + Math.pow(R(), 2) * 0.5;
    }
    for (; i < infall + shell; i++) {
      const r = KEEP_OUT * (0.86 + Math.pow(R(), 1.6) * 0.7);
      aR[i] = r;
      aA[i] = R() * TAU;
      aH[i] = gauss(R) * r * 0.55;
      aCl[i] = -1;
      aSize[i] = 1.0 + R() * 1.2;
      aBright[i] = 0.45 + R() * 0.6;
      this.dustTint[i] = Math.pow(R(), 2) * 0.45;
    }
    list.forEach((c, k) => {
      const sp = c.spread * 1.25;
      for (let j = 0; j < per[k]; j++, i++) {
        aR[i] = Math.abs(gauss(R)) * sp + 4;
        aA[i] = R() * TAU;
        aH[i] = gauss(R) * sp * 0.6;
        aCl[i] = k;
        aSize[i] = 1.0 + R() * 1.3;
        aBright[i] = 0.2 + R() * 0.4;
        this.dustTint[i] = Math.pow(R(), 2) * 0.45;
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aR', new THREE.BufferAttribute(aR, 1));
    g.setAttribute('aA', new THREE.BufferAttribute(aA, 1));
    g.setAttribute('aH', new THREE.BufferAttribute(aH, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    g.setAttribute('aBright', new THREE.BufferAttribute(aBright, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
    g.setAttribute('aCl', new THREE.BufferAttribute(aCl, 1));
    this.dustMat?.dispose();
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT, fragmentShader: STAR_FRAG,
      uniforms: {
        uTime: { value: 0 }, uGM: { value: GM_DUST }, uScale: this.uScale, uFocus: this.uFocus, uReveal: this.uReveal,
        uCenters: { value: Array.from({ length: 32 }, () => new THREE.Vector3(0, 1e5, 0)) },
        uLensRs: this.uLens, uSecondary: { value: 0 },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.dustMat2?.dispose();
    this.dustMat2 = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT, fragmentShader: STAR_FRAG,
      uniforms: { ...this.dustMat.uniforms, uSecondary: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(g, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 0;
    this.scene.add(this.dust);
    this.dust2 = new THREE.Points(g, this.dustMat2);
    this.dust2.frustumCulled = false;
    this.dust2.renderOrder = 0;
    this.scene.add(this.dust2);
  }

  _buildComets() {
    // Look adapted from second-brain-black-hole: short fading tails and glowing heads instead of full orbit lines.
    // The orbits remain slightly elliptical Kepler orbits.
    const R = rng(this.mode === 'local' ? 23 : 5);
    this.comets = [];
    const count = this.mode === 'local' ? 6 : 13;
    const STEPS = 28;
    // Ribbon with two vertices per orbit sample, shared by all comets (each orbit lives in its uniforms).
    const aS = new Float32Array((STEPS + 1) * 2), aSide = new Float32Array((STEPS + 1) * 2);
    const idx = [];
    for (let k = 0; k <= STEPS; k++) {
      aS[k * 2] = aS[k * 2 + 1] = k / STEPS;
      aSide[k * 2] = -1;
      aSide[k * 2 + 1] = 1;
      if (k < STEPS) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((STEPS + 1) * 6), 3));
    g.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    g.setIndex(idx);
    this.cometGeo = g;
    const heads = new Float32Array(count * 3);
    const headBright = new Float32Array(count);
    this.cometColor = new THREE.Color(1, 1, 1);
    for (let k = 0; k < count; k++) {
      const a = (this.mode === 'local' ? 560 : 640) + R() * 380;
      const e = 0.02 + R() * 0.12;
      // Limit orbital tilt to about 50 degrees so arcs trace the outer sphere in projection.
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 1.7, (R() - 0.5) * 1.7, R() * TAU));
      const w = R() * TAU;
      const P = new THREE.Vector3(Math.cos(w), Math.sin(w), 0).applyQuaternion(q); // XY reference plane
      const Q = new THREE.Vector3(-Math.sin(w), Math.cos(w), 0).applyQuaternion(q);
      const bright = 0.5 + R() * 0.5;
      headBright[k] = bright;
      const mat = new THREE.ShaderMaterial({
        vertexShader: COMET_VERT, fragmentShader: COMET_FRAG,
        uniforms: {
          uM: { value: 0 }, uA: { value: a }, uE: { value: e }, uP: { value: P }, uQ: { value: Q },
          uTail: { value: 0.65 + R() * 0.7 }, uRes: this.uRes, uDpr: this.uDpr,
          uColor: { value: this.cometColor }, uBright: { value: bright }, uIntro: this.uIntro,
        },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const tail = new THREE.Mesh(g, mat);
      tail.frustumCulled = false;
      tail.renderOrder = 3;
      this.scene.add(tail);
      this.comets.push({ a, e, P, Q, n: Math.sqrt(GM_COMET / (a * a * a)), M: R() * TAU, mat });
    }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(heads, 3));
    hg.setAttribute('aBright', new THREE.BufferAttribute(headBright, 1));
    this.cometHeads = new THREE.Points(hg, new THREE.ShaderMaterial({
      vertexShader: COMET_HEAD_VERT, fragmentShader: COMET_HEAD_FRAG,
      uniforms: { uDpr: this.uDpr, uColor: { value: this.cometColor }, uIntro: this.uIntro },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.cometHeads.frustumCulled = false;
    this.cometHeads.renderOrder = 3;
    this.scene.add(this.cometHeads);
  }

  _buildSmoke() {
    // Generate the soft-edged fractal noise texture once on the CPU.
    const S = 256;
    const R = rng(13);
    const grid = new Float32Array(33 * 33).map(() => R());
    const val = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const g = (i, j) => grid[((j & 31) * 33) + (i & 31)];
      return g(xi, yi) * (1 - u) * (1 - v) + g(xi + 1, yi) * u * (1 - v) + g(xi, yi + 1) * (1 - u) * v + g(xi + 1, yi + 1) * u * v;
    };
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let f = 0, a = 0.5, fx = (x / S) * 4, fy = (y / S) * 4;
        for (let o = 0; o < 5; o++) {
          f += a * val(fx, fy);
          fx *= 2.03; fy *= 2.03; a *= 0.5;
        }
        const dx = x / S - 0.5, dy = y / S - 0.5;
        const fall = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2);
        const v = Math.max(0, f - 0.38) * 1.9 * fall * fall;
        const i = (y * S + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.min(255, v * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.smoke = [];
    const n = this.mode === 'local' ? 8 : 14;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        opacity: 0.012 + R() * 0.03, rotation: R() * TAU, color: new THREE.Color(0.8, 0.8, 0.82),
      });
      const s = new THREE.Sprite(mat);
      s.userData.opacity = mat.opacity;
      const ang = R() * TAU;
      const rad = 950 + R() * 900;
      s.position.set(Math.cos(ang) * rad, gauss(R) * 260, Math.sin(ang) * rad);
      const sc = 700 + R() * 1300;
      s.scale.set(sc, sc * (0.6 + R() * 0.5), 1);
      s.renderOrder = -6; // Draw behind the black hole to preserve its shadow.
      this.smoke.push(s);
      this.scene.add(s);
    }
  }

  _initEvents() {
    const el = this.renderer.domElement;
    this._down = null;
    this._onMove = (e) => {
      this._mouse = { x: e.clientX, y: e.clientY };
      this._needPick = true;
      this.wake();
    };
    // Test whether the pointer hits the shadow or inner ring.
    this._onHole = (cx, cy) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const p = this.project(0, 0, 0, {});
      return p.front && Math.hypot(cx - rect.left - p.x, cy - rect.top - p.y) < this.holeRadius() * 1.9;
    };
    this._onWheel = () => this.wake();
    this._onDown = (e) => {
      this.wake();
      this._down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    this._onUp = (e) => {
      const d = this._down;
      this._down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      const node = this._pick(e.clientX, e.clientY);
      if (node) this.opts.onOpenNode?.(node, e.ctrlKey || e.metaKey || e.button === 1);
      else if (this._onHole(e.clientX, e.clientY)) this.opts.onHole?.();
    };
    this._onLeave = () => {
      this._mouse = null;
      this.setHover(null);
    };
    this._onDbl = (e) => {
      const node = this._pick(e.clientX, e.clientY);
      if (node) this.focusNode(node.id);
    };
    el.addEventListener('pointermove', this._onMove);
    el.addEventListener('pointerdown', this._onDown);
    el.addEventListener('pointerup', this._onUp);
    el.addEventListener('pointerleave', this._onLeave);
    el.addEventListener('dblclick', this._onDbl);
    el.addEventListener('wheel', this._onWheel, { passive: true });
  }

  // Restore the full frame rate on user input.
  wake() {
    this._activeAt = performance.now();
  }

  _resize() {
    this._clearFirstFrameFence();
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    this.uScale.value = buf.y / (2 * t);
    this.uRes.value.copy(buf);
    this.uDpr.value = buf.y / Math.max(h, 1);
    this.cssScale = h / (2 * t);
  }

  // Graph data
  setData(data) {
    const old = this.nodeById;
    this.clusterHover = null;
    this.centerId = data.centerId || null;
    this.clusters = data.clusters.map((c) => ({ ...c }));
    this.clusterByKey = new Map(this.clusters.map((c) => [c.key, c]));
    this._layoutAnchors();

    const R = rng(1234 + data.nodes.length);
    const nodes = data.nodes.map((n) => {
      const o = old.get(n.id);
      return { ...n, x: o?.x, y: o?.y, z: o?.z, vx: o?.vx || 0, vy: o?.vy || 0, vz: o?.vz || 0 };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    let fresh = 0;
    for (const n of nodes) {
      if (n.id === this.centerId) {
        n.fx = n.fy = n.fz = 0;
        n.x = n.y = n.z = 0;
        continue;
      }
      if (n.x != null) continue;
      fresh++;
      const cl = this.clusterByKey.get(n.cluster);
      let base = cl?.anchor || { x: 0, y: 0, z: 0 };
      let spread = cl?.spread || 30;
      if (cl?.dir && n.type !== 'section') {
        const sc = cl.sector;
        // Sample directions within the cluster cone and distribute radii uniformly by volume.
        const cosA = 1 - R() * (1 - Math.cos(Math.min(sc.half, Math.PI)));
        const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
        const ph = R() * TAU;
        const t1 = new THREE.Vector3(1, 0, 0).cross(cl.dir);
        if (t1.lengthSq() < 1e-6) t1.set(0, 0, 1);
        t1.normalize();
        const t2 = cl.dir.clone().cross(t1);
        const u = cl.dir.clone().multiplyScalar(cosA).addScaledVector(t1, sinA * Math.cos(ph)).addScaledVector(t2, sinA * Math.sin(ph));
        const rr = Math.cbrt(sc.r0 ** 3 + R() * (sc.r1 ** 3 - sc.r0 ** 3));
        base = { x: u.x * rr, y: u.y * rr, z: u.z * rr };
        spread = 6;
      }
      if (n.type === 'section') {
        const parent = byId.get(n.page);
        if (parent?.x != null && parent.id !== this.centerId) {
          base = parent;
          spread = 12;
        }
      }
      n.x = base.x + gauss(R) * spread;
      n.y = base.y + gauss(R) * spread;
      n.z = base.z + gauss(R) * spread;
      if (n.cluster === '__center') {
        // Arrange the central note's sections in a ring in the star-field plane.
        const d = new THREE.Vector3(gauss(R), gauss(R), gauss(R) * 0.2).normalize().multiplyScalar(KEEP_OUT + 50);
        n.x = d.x; n.y = d.y; n.z = d.z;
      }
    }
    this.nodes = nodes;
    this.nodeById = byId;
    this.links = data.links.filter((l) => byId.has(l.source) && byId.has(l.target)).map((l) => ({ ...l }));

    this.neighbors = new Map(nodes.map((n) => [n.id, new Set()]));
    for (const l of this.links) {
      this.neighbors.get(l.source).add(l.target);
      this.neighbors.get(l.target).add(l.source);
    }

    this._styleNodes();
    this._buildDust();
    this._dustInit = false;
    this._buildSim(fresh / Math.max(1, nodes.length));
    this._buildNebula();
    this._buildBuffers();
    this._recolor();
  }

  // Layer soft gas around each cluster's stars.
  _buildNebula() {
    if (this.neb) {
      this.scene.remove(this.neb);
      this.neb.geometry.dispose();
    }
    const R = rng(this.mode === 'local' ? 31 : 17);
    const list = this.dustClusters || [];
    const offs = [], cls = [], sizes = [], rots = [], spins = [], texs = [], alphas = [];
    list.forEach((c, k) => {
      const members = this.nodes.filter((n) => n.cluster === c.key && n.type !== 'file');
      if (!members.length) return;
      let cx = 0, cy = 0, cz = 0;
      for (const n of members) { cx += n.x; cy += n.y; cz += n.z; }
      cx /= members.length; cy /= members.length; cz /= members.length;
      let ext = 0;
      for (const n of members) ext += Math.hypot(n.x - cx, n.y - cy, n.z - cz);
      ext = Math.max(40, ext / members.length);
      const count = Math.round(Math.min(16, 4 + Math.sqrt(members.length) * 0.9));
      for (let j = 0; j < count; j++) {
        // Offset the cloud from a randomly chosen member so it follows the star distribution.
        const m = members[Math.floor(R() * members.length)];
        offs.push(m.x - cx + gauss(R) * ext * 0.25, m.y - cy + gauss(R) * ext * 0.25, m.z - cz + gauss(R) * ext * 0.25);
        cls.push(k);
        sizes.push(ext * (0.9 + R() * 1.1));
        rots.push(R() * TAU);
        spins.push((R() - 0.5) * 0.03);
        texs.push(Math.floor(R() * 4));
        alphas.push(0.05 + R() * 0.07);
      }
    });
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(offs), 3));
    g.setAttribute('aCl', new THREE.InstancedBufferAttribute(new Float32Array(cls), 1));
    g.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(sizes), 1));
    g.setAttribute('aRot', new THREE.InstancedBufferAttribute(new Float32Array(rots), 1));
    g.setAttribute('aSpin', new THREE.InstancedBufferAttribute(new Float32Array(spins), 1));
    g.setAttribute('aTex', new THREE.InstancedBufferAttribute(new Float32Array(texs), 1));
    g.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(new Float32Array(alphas), 1));
    g.instanceCount = cls.length;
    if (!this.nebMat) {
      this.nebMat = new THREE.ShaderMaterial({
        vertexShader: NEB_VERT, fragmentShader: NEB_FRAG,
        uniforms: {
          uCenters: { value: this.dustMat.uniforms.uCenters.value },
          uColors: { value: Array.from({ length: 32 }, () => new THREE.Vector3(0.6, 0.6, 0.6)) },
          uTime: { value: 0 }, uRotY: { value: 0 }, uFocus: this.uFocus, uReveal: this.uReveal,
          uTex: { value: nebulaAtlas() },
        },
        transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
    }
    this.nebMat.uniforms.uCenters.value = this.dustMat.uniforms.uCenters.value;
    this.nebMat.uniforms.uRotY.value = 0;
    this.neb = new THREE.Mesh(g, this.nebMat);
    this.neb.frustumCulled = false;
    this.neb.renderOrder = 1.5; // Draw after the black hole, which occludes the gas, and before links and stars.
    this.scene.add(this.neb);
    this._colorNebula();
  }

  // Fixed nebula color [r, g, b] in 0..1 from the settings, or null to use the cluster colors.
  _fixedNebula() {
    return this.opts.nebulaColor?.() || null;
  }

  // Apply changed nebula settings.
  refreshNebula() {
    this._recolor();
  }

  _colorNebula() {
    if (!this.nebMat || !this.dustClusters) return;
    const cols = this.nebMat.uniforms.uColors.value;
    const fixed = this._fixedNebula();
    this.dustClusters.forEach((c, k) => {
      if (fixed) return cols[k].set(fixed[0], fixed[1], fixed[2]);
      const cc = c.color || [0.7, 0.7, 0.7];
      // Desaturate the cluster color to give the gas a softer glow.
      cols[k].set(cc[0] * 0.75 + 0.12, cc[1] * 0.75 + 0.12, cc[2] * 0.75 + 0.12);
    });
  }

  _layoutAnchors() {
    const list = this.clusters.filter((c) => c.key !== '__center').sort((a, b) => b.ideas - a.ideas);
    list.forEach((c, i) => {
      c.order = i; // Size rank determines color.
      c.spread = 22 + Math.sqrt(c.ideas) * 5;
    });
    const isHub = (c) => c.key === '' || list.some((o) => o !== c && o.key.startsWith(c.key + '/'));
    const outer = list.filter((c) => !isHub(c)).sort((a, b) => a.key.localeCompare(b.key));
    const hubs = list.filter(isHub);
    const N = Math.max(1, outer.length);
    const local = this.mode === 'local';
    const R0 = KEEP_OUT + 5;
    const R1 = local ? 500 : 580;
    const HUB = 90;
    this._omega = Math.sqrt(GM_NODES / (R1 * R1 * R1));
    const weight = (c) => Math.sqrt(c.ideas) + 4;
    const W = outer.reduce((acc, c) => acc + weight(c), 0) || 1;
    const fib = [];
    for (let i = 0; i < N; i++) {
      const yy = N > 1 ? 1 - (2 * (i + 0.5)) / N : 0;
      const rr = Math.sqrt(1 - yy * yy);
      const th = i * 2.39996 + 0.7;
      fib.push(new THREE.Vector3(Math.cos(th) * rr, yy * 0.85, Math.sin(th) * rr).normalize());
    }
    // Visit the nearest unused point so consecutive positions stay close together.
    const order = [];
    const left = fib.slice();
    let cur = left.splice(0, 1)[0];
    while (cur) {
      order.push(cur);
      let bi = -1, bd = Infinity;
      left.forEach((q, j) => {
        const d = q.distanceToSquared(cur);
        if (d < bd) { bd = d; bi = j; }
      });
      cur = bi >= 0 ? left.splice(bi, 1)[0] : null;
    }
    const place = (c, dir, half, r0, r1) => {
      c.dir = dir.clone().normalize();
      c.sector = { half, r0, r1 };
      const R = (r0 + r1) / 2;
      c.anchor = { x: c.dir.x * R, y: c.dir.y * R, z: c.dir.z * R, R };
      c.axis = new THREE.Vector3(0, 1, 0); // Rotate the sphere slowly around its vertical axis.
    };
    const hasHub = (c) => hubs.some((h) => h.key !== '' && c.key.startsWith(h.key + '/'));
    outer.forEach((c, i) => {
      const omegaShare = ((4 * Math.PI * weight(c)) / W) * 1.15; // Overlap adjacent regions slightly to avoid gaps.
      const half = Math.acos(Math.max(-0.95, 1 - omegaShare / (2 * Math.PI)));
      place(c, order[i], half, R0 + (hasHub(c) ? HUB : 0), R1);
    });
    hubs.forEach((c) => {
      const kids = outer.filter((o) => c.key === '' || o.key.startsWith(c.key + '/'));
      if (!kids.length || c.key === '') {
        place(c, new THREE.Vector3(0, 1, 0), Math.PI, R0, R0 + HUB * 0.7); // Distribute the innermost clusters around the center.
        return;
      }
      const d = kids.reduce((acc, k) => acc.add(k.dir), new THREE.Vector3());
      const half = Math.min(Math.PI, Math.max(...kids.map((k) => k.dir.angleTo(d.clone().normalize()) + k.sector.half * 0.6)));
      place(c, d.lengthSq() > 1e-6 ? d : new THREE.Vector3(0, 1, 0), half, R0, R0 + HUB);
    });
    const center = this.clusterByKey.get('__center');
    if (center) {
      center.anchor = { x: 0, y: 0, z: 0, R: 0 };
      center.axis = new THREE.Vector3(0, 0, 1);
      center.dir = null;
      center.spread = 40;
    }
    // Assign cluster colors from the active palette.
    const pal = this.colors?.palette?.length ? this.colors.palette : [[0.85, 0.6, 0.5]];
    list.forEach((c, i) => {
      c.color = pal[PALETTE_ORDER[i % PALETTE_ORDER.length] % pal.length];
    });
    if (center) center.color = this.colors?.accent || [1, 0.8, 0.6];
  }

  _styleNodes() {
    for (const n of this.nodes) {
      n.phase = Math.random();
      if (n.type === 'page') {
        n.size = Math.min(8, 4.2 + 0.45 * Math.sqrt(n.degree * 2 + (n.sections || 0)));
        n.alpha = n.depth === 2 ? 0.6 : 1;
      } else if (n.type === 'section') {
        n.size = Math.max(3.0, 3.6 - (n.level - 1) * 0.3) * (n.cluster === '__center' ? 1.5 : 1);
        n.alpha = 1;
      } else {
        n.size = 2.4;
        n.alpha = 0.5;
      }
      if (n.id === this.centerId) n.alpha = 0;
    }
  }

  _buildSim(freshShare) {
    this.sim?.stop();
    const self = this;
    const nodes = this.nodes;
    const centerId = this.centerId;
    const clusterForce = () => {
      for (const n of nodes) {
        if (n.fx != null || n.cluster === '__center') continue;
        const cl = self.clusterByKey.get(n.cluster);
        const sc = cl?.sector, dir = cl?.dir;
        if (!sc || !dir) continue;
        const r = Math.hypot(n.x, n.y, n.z) || 1;
        const ux = n.x / r, uy = n.y / r, uz = n.z / r;
        const cosT = Math.max(-1, Math.min(1, ux * dir.x + uy * dir.y + uz * dir.z));
        const th = Math.acos(cosT);
        // Vary each star's boundary slightly to soften the cluster edge.
        if (n.jit == null) {
          const h = (Math.imul(n.index + 7, 2654435761) >>> 0) / 4294967296;
          const h2 = (Math.imul(n.index + 13, 2246822519) >>> 0) / 4294967296;
          n.jit = { r: (h - 0.5) * 110, a: (h2 - 0.5) * 0.3 };
        }
        const half = sc.half + n.jit.a;
        // Pull stars gently toward the cone center, with a stronger force on notes.
        let fa = th * (n.type === 'page' ? 0.0006 : 0.0001);
        if (th > half) fa += (th - half) * 0.02;
        const tx = dir.x - ux * cosT, ty = dir.y - uy * cosT, tz = dir.z - uz * cosT;
        const tl = Math.hypot(tx, ty, tz);
        if (tl > 1e-6) {
          const k = (fa * r) / tl;
          n.vx += tx * k;
          n.vy += ty * k;
          n.vz += tz * k;
        }
        const rm = (sc.r0 + sc.r1) / 2;
        let fr = (rm - r) * (n.type === 'page' ? 0.001 : 0.0002);
        const r0 = sc.r0 + Math.max(0, n.jit.r) * 0.4, r1 = sc.r1 + n.jit.r;
        if (r < r0) fr += (r0 - r) * 0.03;
        else if (r > r1) fr += (r1 - r) * 0.02;
        n.vx += ux * fr;
        n.vy += uy * fr;
        n.vz += uz * fr;
      }
    };
    const keepOut = () => {
      for (const n of nodes) {
        if (n.fx != null) continue;
        const r = Math.hypot(n.x, n.y, n.z) || 1;
        if (r < KEEP_OUT) {
          const f = ((KEEP_OUT - r) / r) * 0.25;
          n.vx += n.x * f;
          n.vy += n.y * f;
          n.vz += n.z * f;
        }
      }
    };
    // Give each section of the central note a slot on a ring in the disk plane. The slots orbit at the ring's angular velocity.
    const RING = (this.RING = KEEP_OUT + 45);
    const ringNodes = nodes.filter((n) => n.cluster === '__center' && n.fx == null);
    ringNodes.forEach((n, i) => {
      if (n.slot == null) n.slot = (i / Math.max(1, ringNodes.length)) * TAU;
    });
    const ring = () => {
      for (const n of ringNodes) {
        const tx = Math.cos(n.slot) * RING, ty = Math.sin(n.slot) * RING;
        n.vx += (tx - n.x) * 0.03;
        n.vy += (ty - n.y) * 0.03;
        n.vz += (0 - n.z) * 0.03;
      }
    };
    const sameCluster = (l) => l.source.cluster === l.target.cluster;
    this.sim = forceSimulation(nodes, 3)
      .alphaDecay(0.02)
      .velocityDecay(0.38)
      .force('link', forceLink(this.links).id((d) => d.id)
        .distance((l, i) => {
          // Stable pseudorandom link lengths give each constellation its shape.
          const j = ((Math.imul(i + 1, 2654435761) >>> 0) % 1000) / 1000;
          if (l.kind === 'tree') return l.source.type === 'page' ? 22 + j * 10 : 14 + j * 16;
          return sameCluster(l) ? 60 : 120;
        })
        .strength((l) => {
          if (l.kind === 'tree') return l.source.cluster === '__center' || l.source.id === centerId ? 0 : 0.7;
          return sameCluster(l) ? 0.05 : 0.012;
        }))
      .force('charge', forceManyBody().strength((n) => (n.type === 'page' ? -60 : n.type === 'section' ? -28 : -8)).distanceMax(260).theta(0.9))
      .force('cluster', clusterForce)
      .force('keepout', keepOut)
      .force('ring', ring)
      .stop();
    // Settle a fresh layout before displaying it. Small edits need fewer ticks.
    const warm = freshShare > 0.3 ? 200 : freshShare > 0 ? 12 : 0;
    this.sim.alpha(freshShare > 0.3 ? 1 : 0.2);
    this.sim.alphaTarget(0.015);
    this._hasSlots = nodes.some((n) => n.slot != null);
    this._simUntil = performance.now() + SIM_SETTLE_MS;
    // Run the first warm-up during the intro. Spread later warm-ups across frames while the reveal hides the motion.
    const first = !this._settledOnce;
    this._settledOnce = true;
    if (first || warm < 40) {
      for (let i = 0; i < warm; i++) this.sim.tick();
      this._warm = null;
    } else {
      let m = 0;
      for (const n of nodes) if (n.x != null) m = Math.max(m, Math.hypot(n.x, n.y, n.z));
      this._warm = { left: warm, total: warm, radius: Math.max(m, KEEP_OUT * 1.6) * 1.5 };
      this.uReveal.value = 1;
    }
  }

  _buildBuffers() {
    if (this.stars) {
      this.scene.remove(this.stars);
      this.stars.geometry.dispose();
    }
    if (this.lines) {
      this.scene.remove(this.lines);
      this.lines.geometry.dispose();
    }
    const n = this.nodes.length;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(this.nodes.map((x) => x.phase)), 1));
    g.setAttribute('aPulse', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aMark', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 2;
    this.scene.add(this.stars);
    if (this.stars2) this.scene.remove(this.stars2);
    this.stars2 = new THREE.Points(g, this.starMat2);
    this.stars2.frustumCulled = false;
    this.stars2.renderOrder = 2;
    this.scene.add(this.stars2);

    const m = this.links.length;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m * 6), 3));
    lg.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(m * 6), 3));
    lg.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(m * 2), 1));
    this.lines = new THREE.LineSegments(lg, this.lineMat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 1;
    this.scene.add(this.lines);
    this._writePositions();
  }

  setColors(colors) {
    this.colors = colors;
    const pal = colors?.palette?.length ? colors.palette : [[0.85, 0.6, 0.5]];
    const list = this.clusters.filter((c) => c.key !== '__center').sort((a, b) => a.order - b.order);
    list.forEach((c, i) => (c.color = pal[PALETTE_ORDER[i % PALETTE_ORDER.length] % pal.length]));
    const center = this.clusterByKey.get('__center');
    if (center) center.color = colors.accent;
    this._recolor();
  }

  clusterColorCss(key) {
    const c = this.clusterByKey.get(key)?.color;
    return c ? `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})` : 'rgb(200,200,200)';
  }

  _recolor() {
    const acc = this.colors?.accent || [1, 0.8, 0.6];
    this.bhMat.uniforms.uAccent.value.setRGB(acc[0], acc[1], acc[2]);
    this.skyMat.uniforms.uTint.value.setRGB(acc[0], acc[1], acc[2]);
    this._colorNebula();
    this.glow?.material.color.setRGB(0.8 + acc[0] * 0.2, 0.5 + acc[1] * 0.15, 0.22 + acc[2] * 0.1);
    // Tint the background smoke slightly with the accent or the fixed nebula color.
    const tint = this._fixedNebula() || acc;
    for (const s of this.smoke) s.material.color.setRGB(0.72 + tint[0] * 0.12, 0.72 + tint[1] * 0.12, 0.74 + tint[2] * 0.12);
    // Tint a fraction of the warm white dust with the accent color.
    const dc = this.dust?.geometry.getAttribute('aColor');
    if (dc) {
    for (let i = 0; i < dc.count; i++) {
      const c = mix3(STAR_WHITE, acc, this.dustTint[i]);
      dc.setXYZ(i, c[0], c[1], c[2]);
    }
    dc.needsUpdate = true;
    }
    if (this.cometColor) this.cometColor.setRGB(0.92 + acc[0] * 0.08, 0.92 + acc[1] * 0.08, 0.95 + acc[2] * 0.05);
    this._restyle();
  }

  // Colors, sizes and brightness of the stars and links. They depend on what is under the pointer
  // (a star or a cluster name) and on the task filter, so this runs on every such change.
  _restyle() {
    if (!this.stars) return;
    const acc = this.colors?.accent || [1, 0.8, 0.6];
    const hv = this.hover;
    const nb = hv ? this.neighbors.get(hv.id) : null;
    // A cluster name under the pointer lights its cluster; a star under the pointer goes first.
    const hc = hv ? null : this.clusterHover;
    const col = this.stars.geometry.getAttribute('aColor');
    const al = this.stars.geometry.getAttribute('aAlpha');
    const sz = this.stars.geometry.getAttribute('aSize');
    const pu = this.stars.geometry.getAttribute('aPulse');
    const mk = this.stars.geometry.getAttribute('aMark');
    const filter = this.taskFilter;
    this.nodes.forEach((n, i) => {
      const cc = this.clusterByKey.get(n.cluster)?.color || acc;
      let c, a = n.alpha, s = n.size;
      if (n.type === 'page') c = mix3(STAR_WHITE, cc, 0.4).map((x) => x * 1.15);
      else if (n.type === 'section') c = mix3(STAR_WHITE, cc, 0.22).map((x) => x * (1.3 - (n.level - 1) * 0.08));
      else c = [0.55, 0.55, 0.58];
      const st = taskState(n);
      if (st && st !== 'done') {
        c = TASK_COLORS[st];
        s *= st === 'overdue' ? 1.3 : 1.15;
      }
      pu.setX(i, st === 'overdue' ? 1 : 0);
      if (filter) {
        if (st && st !== 'done') {
          s *= 1.35;
          a = Math.max(a, 1);
        } else a *= n.type === 'page' ? 0.1 : 0.05;
      }
      if (hv) {
        if (n === hv) {
          // The star itself stays a point: it is marked by its rays (aMark), not by its size.
          c = mix3([1, 1, 1], acc, 0.5).map((x) => x * 1.3);
          s *= 1.25;
          a = Math.max(a, 1);
        } else if (nb?.has(n.id)) {
          c = mix3(c, acc, 0.55).map((x) => x * 1.25);
          s *= 1.2;
        } else a *= 0.25;
      } else if (hc != null) {
        if (n.cluster === hc) {
          c = mix3(c, cc, 0.3).map((x) => x * 1.15);
          s *= 1.12;
        } else a *= 0.22;
      }
      mk.setX(i, n === hv ? 1 : 0);
      col.setXYZ(i, c[0], c[1], c[2]);
      al.setX(i, a);
      sz.setX(i, s);
    });
    col.needsUpdate = al.needsUpdate = sz.needsUpdate = pu.needsUpdate = mk.needsUpdate = true;

    const lc = this.lines.geometry.getAttribute('aColor');
    const la = this.lines.geometry.getAttribute('aAlpha');
    this.links.forEach((l, i) => {
      const s = l.source, t = l.target;
      const cc = this.clusterByKey.get(s.cluster)?.color || acc;
      let c, a, a2;
      if (l.kind === 'tree') {
        c = mix3([1, 1, 1], cc, 0.08);
        a = s.cluster === '__center' || s.id === this.centerId ? 0.05 : 0.032;
      } else if (l.kind === 'embed') {
        c = [0.8, 0.8, 0.85];
        a = 0.035;
      } else {
        c = mix3([1, 1, 1], cc, 0.12);
        a = s.cluster === t.cluster ? 0.022 : 0.01;
      }
      if (filter) a *= 0.15;
      a2 = a;
      if (hv) {
        if (s === hv || t === hv) {
          // The links of the star start bright at the star and fade towards the other end.
          c = acc;
          a = s === hv ? 0.6 : 0.1;
          a2 = t === hv ? 0.6 : 0.1;
        } else a = a2 = a * 0.25;
      } else if (hc != null) {
        if (s.cluster === hc && t.cluster === hc) a = a2 = a * 1.6;
        else a = a2 = a * 0.25;
      }
      lc.setXYZ(i * 2, c[0], c[1], c[2]);
      lc.setXYZ(i * 2 + 1, c[0], c[1], c[2]);
      la.setX(i * 2, a);
      la.setX(i * 2 + 1, a2);
    });
    lc.needsUpdate = la.needsUpdate = true;
  }
  // Take over changed task states without a new layout
  updateTasks(nodes) {
    for (const m of nodes) {
      const n = this.nodeById.get(m.id);
      if (n) n.task = m.task;
    }
    this._restyle();
  }
  // Filter: only open tasks stay bright
  setTaskFilter(on) {
    this.taskFilter = on;
    this._restyle();
  }

  // The cluster whose name is under the pointer (null: none): its stars stay bright, the others dim.
  setClusterHover(key) {
    if (this.clusterHover === key) return;
    this.clusterHover = key;
    this.wake();
    this._restyle();
  }
  // Open tasks, overdue ones first, then by due date
  openTasks() {
    const rank = { overdue: 0, open: 1, partial: 2 };
    return this.nodes
      .filter((n) => n.type === 'page' && n.alpha > 0 && rank[taskState(n)] != null)
      .sort((a, b) => rank[taskState(a)] - rank[taskState(b)] || (a.task.due ?? Infinity) - (b.task.due ?? Infinity));
  }

  // An anchored preview follows its star without pointer input.
  setHover(node, anchored = false) {
    if (this.hover === node) return;
    this.hover = node;
    this._restyle();
    this.opts.onHover?.(node, anchored ? null : this._mouse);
  }

  // Motion and camera
  _physics(dt) {
    // Rotate around the cluster's orbital axis using Rodrigues' formula. Keplerian angular velocity increases at smaller radii.
    const rot = (o, k, a, vx, vy, vz) => {
      const c = Math.cos(a), s = Math.sin(a);
      const x = o[vx], y = o[vy], z = o[vz];
      const d = (k.x * x + k.y * y + k.z * z) * (1 - c);
      o[vx] = x * c + (k.y * z - k.z * y) * s + k.x * d;
      o[vy] = y * c + (k.z * x - k.x * z) * s + k.y * d;
      o[vz] = z * c + (k.x * y - k.y * x) * s + k.z * d;
    };
    for (const n of this.nodes) {
      if (n.fx != null) continue;
      const k = this.clusterByKey.get(n.cluster)?.axis;
      if (!k) continue;
      const r = Math.hypot(n.x, n.y, n.z);
      if (r < 1) continue;
      // Rotate clusters together to preserve their relative positions. Dust, disk gas and comets use Keplerian orbits.
      const a = this._omega * dt;
      rot(n, k, a, 'x', 'y', 'z');
      rot(n, k, a, 'vx', 'vy', 'vz');
    }
    if (this.RING) {
      const w = Math.sqrt(GM_NODES / (this.RING * this.RING * this.RING)) * dt;
      for (const n of this.nodes) if (n.slot != null) n.slot += w;
    }
    for (const cl of this.clusters) {
      const an = cl.anchor;
      if (!an || !an.R || !cl.axis) continue;
      rot(an, cl.axis, this._omega * dt, 'x', 'y', 'z');
    }
    for (const cl of this.clusters) if (cl.dir) rot(cl.dir, cl.axis, this._omega * dt, 'x', 'y', 'z');
    if (this.nebMat) this.nebMat.uniforms.uRotY.value += this._omega * dt;
    // Apply forces every frame while settling to avoid jitter. Once the layout stabilizes, only the local section ring still needs forces.
    if (this._hasSlots || performance.now() < this._simUntil) this.sim?.tick();
  }

  _writePositions() {
    if (!this.stars) return;
    const p = this.stars.geometry.getAttribute('position');
    const arr = p.array;
    this.nodes.forEach((n, i) => {
      arr[i * 3] = n.x;
      arr[i * 3 + 1] = n.y;
      arr[i * 3 + 2] = n.z;
    });
    p.needsUpdate = true;
    const lp = this.lines.geometry.getAttribute('position');
    const la = lp.array;
    this.links.forEach((l, i) => {
      const s = l.source, t = l.target;
      la[i * 6] = s.x; la[i * 6 + 1] = s.y; la[i * 6 + 2] = s.z;
      la[i * 6 + 3] = t.x; la[i * 6 + 4] = t.y; la[i * 6 + 5] = t.z;
    });
    lp.needsUpdate = true;
  }

  _computeCentroids() {
    const acc = new Map();
    for (const n of this.nodes) {
      if (n.cluster === '__center' || n.type === 'file') continue;
      let a = acc.get(n.cluster);
      if (!a) acc.set(n.cluster, (a = { x: 0, y: 0, z: 0, n: 0, r2: 0 }));
      a.x += n.x; a.y += n.y; a.z += n.z; a.n++;
    }
    for (const [k, a] of acc) {
      a.x /= a.n; a.y /= a.n; a.z /= a.n;
      this.centroids.set(k, a);
    }
    for (const k of [...this.centroids.keys()]) if (!acc.has(k)) this.centroids.delete(k);
  }

  clusterRadius(key) {
    const c = this.centroids.get(key);
    if (!c) return 60;
    let s = 0, n = 0;
    for (const x of this.nodes) {
      if (x.cluster !== key) continue;
      s += Math.hypot(x.x - c.x, x.y - c.y, x.z - c.z);
      n++;
    }
    return n ? (s / n) * 1.6 : 60;
  }

  _updateComets(dt) {
    const hp = this.cometHeads.geometry.getAttribute('position');
    this.comets.forEach((c, i) => {
      c.M = (c.M + c.n * dt) % TAU;
      c.mat.uniforms.uM.value = c.M;
      // Solve Kepler's equation M = E - e sin(E) with Newton's method.
      let E = c.M;
      for (let k = 0; k < 6; k++) E -= (E - c.e * Math.sin(E) - c.M) / (1 - c.e * Math.cos(E));
      const nu = 2 * Math.atan2(Math.sqrt(1 + c.e) * Math.sin(E / 2), Math.sqrt(1 - c.e) * Math.cos(E / 2));
      const r = (c.a * (1 - c.e * c.e)) / (1 + c.e * Math.cos(nu));
      const x = Math.cos(nu) * r, y = Math.sin(nu) * r;
      hp.setXYZ(i, c.P.x * x + c.Q.x * y, c.P.y * x + c.Q.y * y, c.P.z * x + c.Q.z * y);
    });
    hp.needsUpdate = true;
  }

  flyTo(target, camPos, follow = null, dur = 1.5) {
    this.wake();
    this.fly = { t: 0, dur, fromT: this.controls.target.clone(), toT: target.clone(), fromP: this.camera.position.clone(), toP: camPos.clone() };
    this.follow = follow;
    this.lastInteract = performance.now();
  }

  // Move the camera and target together toward the highlighted star to keep it in place on screen and limit the change in apparent disk size.
  nudgeToward(node, share = 0.14, dur = 1.4) {
    this.setHover(node, true);
    const delta = new THREE.Vector3(node.x, node.y, node.z).sub(this.camera.position).multiplyScalar(share);
    this.fly = {
      t: 0, dur,
      fromT: this.controls.target.clone(), toT: this.controls.target.clone().add(delta),
      fromP: this.camera.position.clone(), toP: this.camera.position.clone().add(delta),
    };
    this.follow = null;
  }

  saveView() {
    return { p: this.camera.position.clone(), t: this.controls.target.clone(), follow: this.follow };
  }

  restoreView(v) {
    if (!v) return;
    this.fly = null;
    this.follow = v.follow;
    this.camera.position.copy(v.p);
    this.controls.target.copy(v.t);
    this.controls.update();
    this.setHover(null);
  }

  flyToCluster(key) {
    const c = this.centroids.get(key);
    if (!c) return;
    const p = new THREE.Vector3(c.x, c.y, c.z);
    const dir = p.clone().normalize().add(this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(0.8)).normalize();
    const dist = 170 + this.clusterRadius(key) * 2.4;
    this.flyTo(p, p.clone().addScaledVector(dir, dist), { cluster: key });
  }

  focusNode(id) {
    const n = this.nodeById.get(id);
    if (!n) return;
    const p = new THREE.Vector3(n.x, n.y, n.z);
    const dir = this.camera.position.clone().sub(p).normalize();
    this.flyTo(p, p.clone().addScaledVector(dir, n.type === 'page' ? 150 : 90), { node: id });
    this.hover = null;
    this.setHover(n, true);
  }

  // Apparent shadow radius in CSS pixels
  holeRadius() {
    const d = Math.max(1, this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0)));
    return ((2.598 * RS) / d) * this.cssScale;
  }

  home() {
    this.flyTo(new THREE.Vector3(0, 0, 0), this.homeCam.clone(), null, 1.6);
  }

  zoomBy(f) {
    const t = this.controls.target.clone();
    const off = this.camera.position.clone().sub(t);
    off.setLength(Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, off.length() * f)));
    this.flyTo(t, t.clone().add(off), this.follow, 0.5);
  }

  // Keyboard: turn the camera around its target while a key is held. az and el are -1, 0 or 1.
  setOrbitInput(az, el) {
    this._orbitIn = az || el ? { az, el } : null;
    this.wake();
  }

  _orbitByKeys(dt) {
    const want = this._orbitIn;
    const v = (this._orbitVel ||= { az: 0, el: 0 });
    // Ease in and out, so the turn starts and stops softly.
    const k = Math.min(1, dt * 7);
    v.az += ((want?.az || 0) - v.az) * k;
    v.el += ((want?.el || 0) - v.el) * k;
    if (Math.abs(v.az) < 0.002 && Math.abs(v.el) < 0.002) {
      v.az = v.el = 0;
      return;
    }
    if (this.fly || this.intro) return;
    this.wake();
    this.lastInteract = performance.now();
    const t = this.controls.target;
    const sph = (this._orbitSph ||= new THREE.Spherical()).setFromVector3(this._v.copy(this.camera.position).sub(t));
    sph.theta += v.az * dt * 0.9;
    sph.phi = Math.min(Math.PI - 0.12, Math.max(0.12, sph.phi + v.el * dt * 0.7));
    this.camera.position.copy(t).add(this._v.setFromSpherical(sph));
  }

  setPaused(p) {
    this.paused = p;
  }

  _followTarget() {
    if (!this.follow) return null;
    if (this.follow.cluster) {
      const c = this.centroids.get(this.follow.cluster);
      return c ? this._v.set(c.x, c.y, c.z) : null;
    }
    const n = this.nodeById.get(this.follow.node);
    return n ? this._v.set(n.x, n.y, n.z) : null;
  }

  // The intro ignites the disk from the inside out and moves the camera inward. Stars, dust and links appear first, followed by gas, sky, comets and the interface.
  _setupIntro(mode) {
    this.intro = null;
    if (mode !== 'hold' && mode !== 'play') return;
    const still = !!this.win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.intro = { run: mode === 'play', t: 0, wait: 0, dur: still ? 0.6 : mode === 'hold' ? 2.9 : 2.3, still, flash: 0, ui: false };
    this.uReveal.value = 1;
    this.uIntro.value = 0;
  }
  // Play the opening again (desktop launcher on a galaxy that is already there). mode 'held' waits
  // for beginIntro, which the loading screen calls when it lets go.
  restartIntro(mode, onReady) {
    this.fly = null;
    this.follow = null;
    this._setupIntro(mode);
    if (!this.intro) return;
    this.bhMat.uniforms.uIgnite.value = 0;
    for (const sm of this.smoke || []) sm.material.opacity = 0;
    if (onReady) {
      this._clearFirstFrameFence();
      this.opts.onFirstFrame = onReady;
    }
  }
  beginIntro() {
    if (this.intro) this.intro.run = true;
  }

  // Return true while the intro controls the camera.
  _intro(dt) {
    const it = this.intro;
    if (!it) return false;
    if (!it.run && (it.wait += dt) > 8) it.run = true;
    if (it.run) it.t += dt;
    const k = Math.min(1, it.t / it.dur);
    // Peak speed occurs one third of the way through the motion. The derivative is 12k(1-k)².
    const glide = (x) => {
      const c = Math.min(1, Math.max(0, x));
      return 1 - Math.pow(1 - c, 3) * (1 + 3 * c);
    };
    const outCubic = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
    if (it.radius == null && it.run) {
      let m = 0;
      for (const n of this.nodes) m = Math.max(m, Math.hypot(n.x, n.y, n.z));
      it.radius = Math.max(m, KEEP_OUT * 1.6) * 1.45;
    }
    this.uReveal.value = Math.max(1, (it.radius || 1) * outCubic((k - 0.02) / 0.72));
    this.uIntro.value = THREE.MathUtils.smoothstep(k, 0.12, 0.8);
    this.bhMat.uniforms.uIgnite.value = glide(k / 0.55);
    for (const sm of this.smoke || []) sm.material.opacity = sm.userData.opacity * this.uIntro.value;
    it.flash = Math.exp(-Math.pow((k - 0.1) / 0.09, 2)) * (it.still ? 0 : 1);
    if (!it.ui && k > (it.still ? 0.2 : 0.5)) {
      it.ui = true;
      this.opts.onIntroUi?.();
    }

    // Approach along a spherical arc from above and to the side.
    const home = this.homeCam;
    const d0 = home.length();
    const az0 = Math.atan2(home.x, home.z);
    const el0 = Math.asin(home.y / d0);
    const e = it.still ? 1 : glide(k);
    const d = d0 * (2.6 - 1.6 * e);
    const az = az0 + 0.8 * (1 - e);
    const el = el0 + 0.34 * (1 - e);
    this.fly = null;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);

    if (k >= 1) {
      this.intro = null;
      this.uReveal.value = 1e7;
      this.uIntro.value = 1;
      this.bhMat.uniforms.uIgnite.value = 1;
      for (const sm of this.smoke || []) sm.material.opacity = sm.userData.opacity;
      return false;
    }
    return true;
  }

  // Project a world point into CSS pixels.
  project(x, y, z, out = {}) {
    const v = this._v.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
    out.depth = -v.z;
    out.front = v.z < -1;
    v.applyMatrix4(this.camera.projectionMatrix);
    out.x = (v.x + 1) * 0.5 * this.width;
    out.y = (1 - v.y) * 0.5 * this.height;
    return out;
  }

  // Label nearby notes, including all direct neighbors in local view.
  labelCandidates(limit = 26) {
    const out = [];
    const o = {};
    if (this.taskFilter) {
      for (const n of this.openTasks()) {
        this.project(n.x, n.y, n.z, o);
        if (o.front && o.x >= 0 && o.y >= 0 && o.x <= this.width && o.y <= this.height) out.push(n);
      }
      return out.slice(0, limit);
    }
    for (const n of this.nodes) {
      if (n.type !== 'page' || n.alpha <= 0) continue;
      this.project(n.x, n.y, n.z, o);
      if (!o.front || o.x < 0 || o.y < 0 || o.x > this.width || o.y > this.height) continue;
      const px = (n.size * this.cssScale) / o.depth;
      const local = this.mode === 'local' && n.depth === 1;
      if (px < 11 && !local) continue;
      out.push({ node: n, px: px + (local ? 100 : 0) });
    }
    out.sort((a, b) => b.px - a.px);
    return out.slice(0, limit).map((x) => x.node);
  }

  _pick(cx, cy) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = cx - rect.left, y = cy - rect.top;
    let best = null, bestScore = 1;
    const o = {};
    for (const n of this.nodes) {
      if (n.alpha <= 0) continue;
      this.project(n.x, n.y, n.z, o);
      if (!o.front) continue;
      // The drawn size levels off near the camera (capSize in the star shader); so does the target.
      const px = Math.min((n.size * this.cssScale) / o.depth, 22);
      const rad = Math.max(7, px * 0.75);
      const d = Math.hypot(o.x - x, o.y - y) / rad;
      const score = d * (n.type === 'page' ? 0.8 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  // Render loop
  _frame(t) {
    this._raf = this.win.requestAnimationFrame(this._frame);
    const now = t / 1000;
    if (!this.container.isConnected || this.width < 2 || this.height < 2 || this.container.clientWidth < 2 || this.doc.hidden || this.opts.held?.()) {
      this._lastT = 0;
      return;
    }
    // Limit rendering to about 60 fps on high-refresh displays. Idle motion needs only 30 fps.
    this._idle = performance.now() - this._activeAt > IDLE_MS && !this.fly && !this.intro && !this._warm && !this._down;
    if (this._lastT && now - this._lastT < (this._idle ? 1 / 31 : 1 / 62)) return;
    const dt = Math.min(0.05, this._lastT ? now - this._lastT : 0.016);
    this._lastT = now;
    this._dt = dt;

    this.time += dt;
    this.uTime.value = this.time;
    if (this._warm) {
      // Settle the layout in roughly 6 ms chunks.
      const w = this._warm;
      const t0 = performance.now();
      while (w.left > 0 && performance.now() - t0 < 6) {
        this.sim.tick();
        w.left--;
      }
      const k = 1 - w.left / w.total;
      this.uReveal.value = Math.max(1, w.radius * k * k * (3 - 2 * k));
      if (!w.left) {
        this._warm = null;
        this.uReveal.value = 1e7;
        this._simUntil = performance.now() + SIM_SETTLE_MS;
      }
    }
    if (!this.paused) {
      this.orbitTime += dt;
      this._physics(dt);
      this._updateComets(dt);
    }
    this.bhMat.uniforms.uTime.value = this.time;
    this._computeCentroids();
    if (this.dust) {
      this.dustMat.uniforms.uTime.value = this.orbitTime;
      const cs = this.dustMat.uniforms.uCenters.value;
      // Smooth the cloud's motion as it follows its cluster.
      const f = this._dustInit ? Math.min(1, this._dt * 1.5) : 1;
      this._dustInit = true;
      this.dustClusters.forEach((c, k) => {
        const p = this.centroids.get(c.key) || c.anchor;
        if (p) cs[k].lerp(this._v.set(p.x, p.y, p.z), f);
      });
    }

    // Camera flight, tracking and idle rotation
    const before = this._followTarget()?.clone();
    if (this.fly) {
      const f = this.fly;
      f.t += dt;
      const k = ease(Math.min(1, f.t / f.dur));
      const ft = this._followTarget();
      const toT = ft ? ft.clone() : f.toT;
      const toP = ft ? f.toP.clone().add(ft.clone().sub(f.toT)) : f.toP;
      this.controls.target.lerpVectors(f.fromT, toT, k);
      this.camera.position.lerpVectors(f.fromP, toP, k);
      if (k >= 1) this.fly = null;
    } else if (before && this._prevFollow) {
      const delta = before.clone().sub(this._prevFollow);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }
    const introCam = this._intro(dt);
    this._prevFollow = this._followTarget()?.clone() || null;
    // Pan through roughly ±15 degrees over a 100-second idle cycle.
    this.controls.autoRotate = !this.paused && !this.fly && !introCam && performance.now() - this.lastInteract > 7000;
    this.controls.autoRotateSpeed = 0.16 * Math.cos(this.time * 0.063);
    this.controls.enabled = !this.fly && !introCam;
    this._orbitByKeys(dt);
    this.controls.update(dt);

    this.bhMat.uniforms.uCam.value.copy(this.camera.position).multiplyScalar(1 / RS);
    this.uFocus.value = this.camera.position.distanceTo(this.controls.target);
    if (this.nebMat) this.nebMat.uniforms.uTime.value = this.time;
    // Reduce glow and bloom as the disk grows on screen so scattered light does not wash out the shadow. Full glow corresponds to about 140 pixels.
    const cd = Math.max(1, this.camera.position.length());
    const appR = ((BH.rout * RS) / cd) * this.cssScale;
    const big = Math.min(1, Math.max(0, (appR - 110) / 150));
    const farS = 1 - big * big * (3 - 2 * big);
    const ignite = this.bhMat.uniforms.uIgnite.value;
    if (this.glow) this.glow.material.opacity = 0.3 * farS * ignite;
    // Close up there is no bloom at all: the disk fills much of the view with bright gas, and even a
    // few percent of its scattered light lie as a gray veil over the shadow and the gap around it.
    this.bloom.strength = 0.7 * farS + 0.45 * (this.intro?.flash || 0);
    this.bloom.radius = 0.12 + 0.24 * farS;
    this.bloom.enabled = this.bloom.strength > 0.004;
    this._writePositions();

    if (this._needPick && this._mouse && !this._down) {
      this._needPick = false;
      const node = this._pick(this._mouse.x, this._mouse.y);
      this.setHover(node);
      const hole = !node && this._onHole(this._mouse.x, this._mouse.y);
      if (hole !== this.holeHover) {
        this.holeHover = hole;
        this.opts.onHoleHover?.(hole);
      }
    }

    try {
      this.composer.render(dt);
      this.opts.onFrame?.(this);
      if (this.opts.onFirstFrame) this._checkFirstFrame();
    } catch (error) {
      if (!this.opts.onFirstFrame) throw error;
      this.opts.onFirstFrameError(error);
      return;
    }

    this._fpsAcc += dt;
    this._fpsN++;
    if (this._fpsAcc > 0.5) {
      this.fps = Math.round(this._fpsN / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsN = 0;
      // Lower the render resolution when active frames are slow. Exclude the deliberate 30 fps idle limit.
      this._slow = this.fps < 40 && !this._idle ? (this._slow || 0) + 1 : 0;
      if (this._slow >= 3 && this.pixelRatio > 0.6) {
        this.pixelRatio = Math.max(0.6, this.pixelRatio - 0.25);
        this.renderer.setPixelRatio(this.pixelRatio);
        this._resize();
        this._slow = 0;
      }
    }
  }

  // Report the first frame only once the GPU has really drawn it (fence), so the loading screen
  // does not open onto an empty canvas.
  _checkFirstFrame() {
    const gl = this.renderer.getContext();
    if (gl.isContextLost()) throw new Error('The WebGL context was lost while loading.');
    if (this.firstFrameFence) {
      if (gl.clientWaitSync(this.firstFrameFence, 0, 0) === gl.TIMEOUT_EXPIRED) return;
      this._clearFirstFrameFence();
    } else {
      this.firstFrameFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (this.firstFrameFence) {
        gl.flush();
        return;
      }
    }
    const ready = this.opts.onFirstFrame;
    ready();
    this.opts.onFirstFrame = null;
  }
  _clearFirstFrameFence() {
    if (!this.firstFrameFence) return;
    this.renderer.getContext().deleteSync(this.firstFrameFence);
    this.firstFrameFence = null;
  }
  dispose() {
    this.win.cancelAnimationFrame(this._raf);
    this.sim?.stop();
    this.resizeObserver?.disconnect();
    if (!this.renderer) return;
    this._clearFirstFrameFence();
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this._onMove);
    el.removeEventListener('pointerdown', this._onDown);
    el.removeEventListener('pointerup', this._onUp);
    el.removeEventListener('pointerleave', this._onLeave);
    el.removeEventListener('dblclick', this._onDbl);
    el.removeEventListener('wheel', this._onWheel);
    // OrbitControls removes document listeners through ownerDocument.
    if (el.ownerDocument !== this.doc) this.doc.adoptNode(el);
    this.controls?.dispose();
    this.scene?.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (m) {
        m.map?.dispose?.();
        m.dispose?.();
      }
    });
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    el.remove();
  }
}
