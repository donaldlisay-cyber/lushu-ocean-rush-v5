import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/* ============================================================
   鹿蜀海洋大冒险 · 抓鱼大作战  v3
   ============================================================ */

// ---------- 配置 ----------
const LANES = [-2.5, 0, 2.5];
const PLAYER_Z = 0;
const SPAWN_Z = -95;
const DESPAWN_Z = 9;
const BASE_SPEED = 9;
const MAX_SPEED = 26;
const SPEED_RAMP = 0.3;
const GRAVITY = -24;
const JUMP_VEL = 9.4;
const DUCK_TIME = 0.55;

const PLAYER = { targetHeight: 2.1, halfWidth: 0.6, normalHalfHeight: 1.0, duckHalfHeight: 0.35, halfDepth: 0.8 };

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const loadingEl = $('loading'), loadBar = $('loadBar');
const hudEl = $('hud'), startScreen = $('startScreen'), overScreen = $('overScreen');
const scoreEl = $('score'), fishCountEl = $('fishCount'), heartsEl = $('hearts');
const comboEl = $('combo'), toastEl = $('toast'), flashEl = $('flash');
const powerupBar = $('powerupBar');
const milestoneEl = $('milestone');

// ---------- 渲染器 / 场景 / 相机 ----------
const container = $('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x86d2e6, 45, 175);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 4.6, 8.4);
camera.lookAt(0, 1.5, -6);

// ---------- 光照 ----------
scene.add(new THREE.HemisphereLight(0xd8f0ff, 0x0b5f94, 0.9));
const sun = new THREE.DirectionalLight(0xfff3d0, 2.4);
sun.position.set(8, 18, 5);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x9ad4ff, 0.5));

// ---------- 天空（纯色渐变，无漂浮物） ----------
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `varying vec3 vP; void main(){
    float h=normalize(vP).y;
    vec3 top=vec3(0.16,0.50,0.92); vec3 mid=vec3(0.48,0.80,0.98); vec3 hor=vec3(0.95,0.98,0.99);
    vec3 c=h>0.0?mix(mid,top,smoothstep(0.0,0.55,h)):mix(mid,hor,smoothstep(0.0,-0.22,h));
    gl_FragColor=vec4(c,1.0); }`
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(200, 24, 16), skyMat));

// ---------- 海洋 ----------
const waterMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(0x0a5f9e) },
    uMid: { value: new THREE.Color(0x1d8ecf) },
    uShallow: { value: new THREE.Color(0x48c4e8) },
    uFoam: { value: new THREE.Color(0xeafcff) },
  },
  vertexShader: `
    uniform float uTime; varying float vWave; varying vec3 vW;
    void main(){
      vec3 p = position;
      float w = sin(p.x*0.28+uTime*1.7)*0.16 + cos(p.z*0.34+uTime*1.3)*0.13
              + sin((p.x+p.z)*0.16+uTime*0.9)*0.18 + sin(p.x*0.6+uTime*2.4)*0.04 + cos(p.z*0.8+uTime*2.1)*0.04;
      p.y += w; vWave = w;
      vec4 wp = modelMatrix*vec4(p,1.0); vW = wp.xyz;
      gl_Position = projectionMatrix*viewMatrix*wp;
    }`,
  fragmentShader: `
    uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uShallow; uniform vec3 uFoam;
    varying float vWave; varying vec3 vW;
    void main(){
      float t = clamp(vWave*2.2+0.5, 0.0, 1.0);
      vec3 c = t<0.5 ? mix(uDeep,uMid,t*2.0) : mix(uMid,uShallow,(t-0.5)*2.0);
      c = mix(c, uFoam, smoothstep(0.72,1.0,t)*0.75);
      c *= smoothstep(160.0, 95.0, distance(vW.xz, vec2(0.0)));
      gl_FragColor = vec4(c, 1.0);
    }`
});
const waterGeo = new THREE.PlaneGeometry(320, 440, 90, 90);
waterGeo.rotateX(-Math.PI / 2);
const water = new THREE.Mesh(waterGeo, waterMat);
water.position.y = -0.2;
scene.add(water);

// ---------- 泳道（清晰可见） ----------
const laneGroup = new THREE.Group();
scene.add(laneGroup);
(function buildLanes() {
  // 三条浅色跑道
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xd9f4ff, transparent: true, opacity: 0.18, depthWrite: false });
  LANES.forEach(x => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 400), stripMat);
    s.rotation.x = -Math.PI / 2; s.position.set(x, -0.13, -95);
    laneGroup.add(s);
  });
  // 泳道分隔虚线（随世界流动，增强动感）
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  const dashGeo = new THREE.PlaneGeometry(0.14, 2.2);
  for (const x of [-1.25, 1.25]) {
    for (let z = 10; z > -180; z -= 6) {
      const d = new THREE.Mesh(dashGeo, dashMat);
      d.rotation.x = -Math.PI / 2; d.position.set(x, -0.12, z);
      d.userData.baseZ = z;
      laneGroup.add(d);
    }
  }
})();

// ---------- 音频 ----------
const Audio = {
  ctx: null,
  ensure() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  tone(freq, dur, type = 'sine', vol = 0.18, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  catch(combo) { const b = 520 * Math.pow(1.059, Math.min(combo, 18)); this.tone(b, 0.12, 'triangle', 0.2); this.tone(b * 1.5, 0.14, 'sine', 0.15, b); },
  powerup() { [660, 880, 1320].forEach((f, i) => setTimeout(() => this.tone(f, 0.1, 'sine', 0.18), i * 60)); },
  hit() { this.tone(160, 0.35, 'sawtooth', 0.22, -110); this.tone(90, 0.4, 'square', 0.15, -50); },
  milestone() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.16, 'triangle', 0.2), i * 90)); },
  jump() { this.tone(300, 0.14, 'sine', 0.14, 240); },
  duck() { this.tone(440, 0.12, 'sine', 0.12, -190); },
  over() { [440, 350, 270, 180].forEach((f, i) => setTimeout(() => this.tone(f, 0.28, 'triangle', 0.2), i * 120)); },
};

// ---------- 工具 ----------
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
function loadGLB(url) { return new Promise((res, rej) => loader.load(url, res, undefined, rej)); }

function fitToHeight(obj, height) {
  obj.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(obj);
  const s = height / box.getSize(new THREE.Vector3()).y;
  obj.scale.multiplyScalar(s);
  obj.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= box.min.y;
}

// ---------- 粒子 ----------
const particleGeo = new THREE.SphereGeometry(0.085, 6, 6);
const particleMats = new Map();
class Particles {
  constructor() { this.items = []; }
  emit(pos, color, count, opts = {}) {
    let mat = particleMats.get(color);
    if (!mat) { mat = new THREE.MeshBasicMaterial({ color }); particleMats.set(color, mat); }
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(particleGeo, mat);
      m.position.copy(pos);
      const sp = opts.speed ?? 4.5;
      const v = new THREE.Vector3((Math.random() - 0.5) * sp * 1.6, Math.random() * sp * (opts.up ? 1.4 : 0.9), (Math.random() - 0.5) * sp * 1.6);
      if (opts.backward) v.z = Math.abs(v.z) * 0.6 + 1.5;
      this.items.push({ m, v, life: opts.life ?? 0.65, gravity: opts.gravity ?? -6 });
      scene.add(m);
    }
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      if (p.life <= 0) { scene.remove(p.m); this.items.splice(i, 1); continue; }
      p.v.y += p.gravity * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.m.scale.setScalar(Math.max(0.05, p.life / 0.65));
    }
  }
}
const particles = new Particles();

// ---------- 漂浮文字 ----------
const popups = [];
function spawnPopup(pos, text, color, size = 1) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = '900 64px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.strokeText(text, 128, 64);
  ctx.fillStyle = color; ctx.fillText(text, 128, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(2.2 * size, 1.1 * size, 1); sp.position.copy(pos);
  scene.add(sp); popups.push({ sp, life: 0.9, vy: 2.2 });
}
function updatePopups(dt) {
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.life -= dt; p.sp.position.y += p.vy * dt;
    p.sp.material.opacity = Math.min(1, p.life / 0.4);
    if (p.life <= 0) { scene.remove(p.sp); p.sp.material.map.dispose(); p.sp.material.dispose(); popups.splice(i, 1); }
  }
}

// 发光光环（可吃=金色/绿，障碍=红色）
function makeGlowRing(color, radius = 0.7) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.045, 8, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false })
  );
  ring.rotation.x = Math.PI / 2;
  return ring;
}

// ---------- 玩家 ----------
let playerModel = null, playerHolder = null, playerShadow = null, shieldBubble = null;
let lane = 1, laneX = LANES[1];
let playerY = 0, playerVelY = 0, jumping = false, ducking = false, duckTimer = 0, invincible = 0;
let splashTimer = 0;

const playerGroup = new THREE.Group();
scene.add(playerGroup);

async function buildPlayer() {
  const gltf = await loadGLB('models/lushu_boy.glb');
  playerModel = gltf.scene;
  playerModel.rotation.y = Math.PI;
  playerModel.traverse(o => { if (o.isMesh) { o.castShadow = true; if (o.material) o.material.roughness = 0.55; } });
  fitToHeight(playerModel, PLAYER.targetHeight);
  playerHolder = new THREE.Group();
  playerHolder.add(playerModel);
  playerGroup.add(playerHolder);

  playerShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.9, 24),
    new THREE.MeshBasicMaterial({ color: 0x04324f, transparent: true, opacity: 0.32, depthWrite: false })
  );
  playerShadow.rotation.x = -Math.PI / 2; playerShadow.position.y = -0.16;
  playerGroup.add(playerShadow);

  // 护盾气泡
  shieldBubble = new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0x4ac8ff, transparent: true, opacity: 0.18, depthWrite: false })
  );
  shieldBubble.position.y = 1.1;
  shieldBubble.visible = false;
  playerGroup.add(shieldBubble);
}

// ---------- 鱼类 ----------
const fishDefs = [
  { file: 'models/fish/puffer.glb', name: '河豚', points: 15, color: 0xffb84d, len: 1.4, weight: 3 },
  { file: 'models/fish/mantaray.glb', name: '蝠鲼', points: 25, color: 0x5a8fae, len: 2.2, weight: 2 },
  { file: 'models/fish/shark.glb', name: '鲨鱼', points: 30, color: 0x5f7f96, len: 2.4, weight: 1 },
  { file: 'models/fish/octopus.glb', name: '章鱼', points: 20, color: 0xff7a9a, len: 1.7, weight: 2, radial: true },
  { file: 'models/fish/anglerfish.glb', name: '灯笼鱼', points: 18, color: 0x4a6f9a, len: 1.4, weight: 3 },
];

function boneHeadDir(obj) {
  let head = null, tail = null;
  obj.traverse(o => {
    if (!o.isBone) return;
    const n = (o.name || '').toLowerCase();
    if (!head && (n === 'head' || n === 'head_end' || n === 'main1' || n === 'root')) head = o;
    if (!tail && (n.includes('tail') || n.includes('main6'))) tail = o;
  });
  if (head && tail) {
    const h = head.getWorldPosition(new THREE.Vector3());
    const t = tail.getWorldPosition(new THREE.Vector3());
    return h.sub(t);
  }
  return null;
}
function collectMaxY(obj, z0, z1) {
  let maxY = -Infinity;
  const v = new THREE.Vector3();
  obj.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position, m = o.matrixWorld;
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
      if (v.z >= z0 && v.z <= z1) maxY = Math.max(maxY, Math.abs(v.y));
    }
  });
  return maxY;
}
function orientFish(gltf, targetLen, opts = {}) {
  const holder = new THREE.Group();
  const model = gltf.scene;
  holder.add(model);
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(holder);
  const max0 = Math.max(...box.getSize(new THREE.Vector3()).toArray());
  holder.scale.setScalar(targetLen / max0);
  holder.updateMatrixWorld(true);
  const c = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  model.position.sub(c);
  if (opts.radial) return holder;
  holder.updateMatrixWorld(true);
  const d = boneHeadDir(holder);
  if (d && d.lengthSq() > 1e-6) {
    d.normalize();
    holder.rotation.y = Math.PI - Math.atan2(d.x, d.z);
  } else {
    box = new THREE.Box3().setFromObject(holder);
    const sz = box.getSize(new THREE.Vector3());
    if (sz.x >= sz.y && sz.x >= sz.z) holder.rotation.y = Math.PI / 2;
    else if (sz.y >= sz.x && sz.y >= sz.z) holder.rotation.x = Math.PI / 2;
    box = new THREE.Box3().setFromObject(holder);
    const L = box.getSize(new THREE.Vector3()).z;
    if (collectMaxY(holder, box.min.z, box.min.z + L * 0.18) > collectMaxY(holder, box.max.z - L * 0.18, box.max.z)) holder.rotation.y += Math.PI;
  }
  return holder;
}

// 程序化石头鱼
function fin(w, h, color) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(w, h * 0.35); shape.lineTo(0, h); shape.lineTo(-w * 0.2, h * 0.35); shape.closePath();
  return new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7, side: THREE.DoubleSide }));
}
function makeStonefish() {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(0.5, 1);
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    const bump = 0.9 + Math.random() * 0.28;
    pos.setXYZ(i, x * bump, y * bump * 0.6, z * bump * 1.25);
    const m = 0.32 + Math.random() * 0.22;
    colors[i * 3] = m + 0.12; colors[i * 3 + 1] = m + 0.08; colors[i * 3 + 2] = m - 0.04;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  body.scale.set(0.95, 0.55, 1.35); g.add(body);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
  [-0.13, 0.13].forEach(x => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat); e.position.set(x, 0.1, 0.55); g.add(e); });
  const dorsal = fin(0.5, 0.45, 0x6b5a42); dorsal.rotation.z = Math.PI / 2; dorsal.position.set(0, 0.35, -0.05); g.add(dorsal);
  const tail = fin(0.42, 0.5, 0x5f5140); tail.position.set(0, 0.02, -0.62); g.add(tail);
  g.userData.tail = tail;
  return g;
}
const proceduralDefs = [
  { make: makeStonefish, name: '石头鱼', points: 22, color: 0x8a7a5a, len: 1.2, weight: 3 },
];

// ---------- 道具 ----------
const powerupDefs = [
  { type: 'shield', name: '护盾', color: 0x4ac8ff, emoji: '🛡️', dur: 0 },
  { type: 'magnet', name: '磁铁', color: 0xff5a6a, emoji: '🧲', dur: 7 },
  { type: 'double', name: '双倍分', color: 0xffd54d, emoji: '✨', dur: 8 },
  { type: 'boost', name: '加速', color: 0x7dff8a, emoji: '⚡', dur: 3 },
];
function makePowerup(def) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.32, 0),
    new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.2 })
  );
  g.add(core);
  const ring = makeGlowRing(def.color, 0.55); ring.position.y = -0.05; g.add(ring);
  g.userData.core = core; g.userData.ring = ring; g.userData.type = def.type;
  return g;
}

// ---------- 障碍物 ----------
function makeRock() {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(0.75, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + (Math.random() - 0.5) * 0.4, pos.getY(i) + (Math.random() - 0.5) * 0.35, pos.getZ(i) + (Math.random() - 0.5) * 0.4);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7a8894, flatShading: true, roughness: 0.9 }));
  m.position.y = 0.5; m.scale.set(1, 0.8, 1); g.add(m);
  const warn = makeGlowRing(0xff4444, 0.85); warn.position.y = -0.12; g.add(warn);
  g.userData.kind = 'rock'; g.userData.warn = warn;
  return g;
}
function makeJellyfish() {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xff8bd0, roughness: 0.4, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  g.add(dome);
  const tentMat = new THREE.MeshStandardMaterial({ color: 0xff6fc0, transparent: true, opacity: 0.6, roughness: 0.5 });
  for (let i = 0; i < 6; i++) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.9 + Math.random() * 0.5, 5), tentMat);
    t.position.set((Math.random() - 0.5) * 0.6, -0.5, (Math.random() - 0.5) * 0.6); g.add(t);
  }
  const warn = makeGlowRing(0xff4444, 0.85); warn.position.y = -0.25; g.add(warn);
  g.userData.kind = 'jelly'; g.userData.warn = warn;
  return g;
}
function makeWhirlpool() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.14, 10, 30), new THREE.MeshStandardMaterial({ color: 0x0a3d5c, roughness: 0.3 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = -0.12; g.add(ring);
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.6, 24), new THREE.MeshStandardMaterial({ color: 0x062838, roughness: 0.2, side: THREE.DoubleSide }));
  core.rotation.x = -Math.PI / 2; core.position.y = -0.15; g.add(core);
  const warn = makeGlowRing(0xff3333, 1.0); warn.position.y = -0.1; g.add(warn);
  g.userData.kind = 'whirl'; g.userData.ring = ring; g.userData.warn = warn;
  return g;
}
function makeLogBarrier() {
  // 横跨三泳道的横木，必须跳
  const g = new THREE.Group();
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 7.2, 8), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.8, flatShading: true }));
  log.rotation.z = Math.PI / 2; log.position.y = 0.72; g.add(log);
  const endMat = new THREE.MeshStandardMaterial({ color: 0x6b4630, roughness: 0.8 });
  [-3.6, 3.6].forEach(x => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 8), endMat);
    p.position.set(x, -0.05, 0); g.add(p);
  });
  const warn = makeGlowRing(0xff2222, 3.9); warn.position.y = -0.12; g.add(warn);
  g.userData.kind = 'log'; g.userData.warn = warn;
  return g;
}
const obstacleDefs = [
  { make: makeRock, weight: 3, kind: 'rock', y: 0.5, hh: 0.6, hw: 0.6 },
  { make: makeJellyfish, weight: 2, kind: 'jelly', y: 1.4, hh: 0.65, hw: 0.6 },
  { make: makeWhirlpool, weight: 2, kind: 'whirl', y: 0, hh: 0.2, hw: 0.85 },
  { make: makeLogBarrier, weight: 2, kind: 'log', y: 0.72, hh: 0.34, hw: 3.9, spans: true },
];

// ---------- 游戏状态 ----------
let running = false;
let worldSpeed = BASE_SPEED, distance = 0, score = 0, fishCaught = 0, combo = 0, maxCombo = 0, hearts = 3;
let best = Number(localStorage.getItem('lushu_best') || 0);
let shield = false, magnetTimer = 0, doubleTimer = 0, boostTimer = 0;
let lastMilestone = 0;
const MILESTONE_GAP = 500;

const activeFish = [], activePowerups = [], activeObstacles = [], mixers = [], dyingObjects = [];
let spawnTimer = 0, powerupTimer = 6;

function randomItem(defs) {
  const total = defs.reduce((s, d) => s + (d.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const d of defs) { r -= (d.weight ?? 1); if (r <= 0) return d; }
  return defs[0];
}

// ---------- 预加载 & 实例化 ----------
const fishModelCache = {};
async function preloadFishModels() {
  await Promise.all(fishDefs.map(async d => {
    try {
      const gltf = await loadGLB(d.file);
      const holder = orientFish(gltf, d.len, { radial: d.radial });
      holder.userData.clips = gltf.animations;
      fishModelCache[d.file] = holder;
    } catch (e) { console.warn('fish load fail', d.file, e); }
  }));
}
function findClip(clips) { return clips.find(a => /swim|idle|float/i.test(a.name)) || clips[0]; }

function spawnFish() {
  const useReal = Math.random() < 0.6;
  let def, obj;
  if (useReal && Object.keys(fishModelCache).length) {
    def = randomItem(fishDefs);
    const template = fishModelCache[def.file];
    if (template) {
      obj = cloneSkeleton(template);
      if (template.userData.clips && template.userData.clips.length) {
        const clip = findClip(template.userData.clips);
        if (clip) { const mixer = new THREE.AnimationMixer(obj); mixer.clipAction(clip).play(); obj.userData.mixer = mixer; }
      }
    } else { def = randomItem(proceduralDefs); obj = def.make(); }
  } else { def = randomItem(proceduralDefs); obj = def.make(); }

  const ln = Math.floor(Math.random() * 3);
  const y = 0.35 + Math.random() * 1.9;
  obj.position.set(LANES[ln], y, SPAWN_Z);
  if (!def.file) obj.rotation.y = Math.PI;
  // 金色光环 = 可吃
  const ring = makeGlowRing(0xffd54d, 0.65);
  ring.position.y = -y + 0.05;
  obj.add(ring);
  scene.add(obj);
  const f = { obj, name: def.name, points: def.points, color: def.color, ln, y, hh: def.len * 0.32, halfW: def.len * 0.34, caught: false, mixer: obj.userData.mixer || null, radial: !!def.radial, ring };
  if (obj.userData.tail) f.tail = obj.userData.tail;
  if (f.mixer) mixers.push(f.mixer);
  activeFish.push(f);
  return f;
}

function spawnPowerup() {
  const def = randomItem(powerupDefs);
  const obj = makePowerup(def);
  const ln = Math.floor(Math.random() * 3);
  const y = 1.1;
  obj.position.set(LANES[ln], y, SPAWN_Z);
  scene.add(obj);
  activePowerups.push({ obj, def, ln, y, hh: 0.5, halfW: 0.55 });
}

function spawnObstacle() {
  const def = randomItem(obstacleDefs);
  const ln = def.spans ? 1 : Math.floor(Math.random() * 3);
  const obj = def.make();
  obj.position.set(def.spans ? 0 : LANES[ln], def.y, SPAWN_Z);
  scene.add(obj);
  activeObstacles.push({ obj, kind: def.kind, ln, y: def.y, hh: def.hh, hw: def.hw, hd: 0.6 });
}

function ensureFair() {
  const occupied = new Set(activeObstacles.filter(o => o.kind !== 'log').map(o => o.ln));
  if (occupied.size >= 3) {
    let far = null;
    activeObstacles.forEach(o => { if (o.kind !== 'log' && (!far || o.obj.position.z < far.obj.position.z)) far = o; });
    if (far) { scene.remove(far.obj); activeObstacles.splice(activeObstacles.indexOf(far), 1); }
  }
}

// ---------- 碰撞 ----------
function playerBox() {
  const px = playerHolder ? playerHolder.position.x : LANES[lane];
  let py, ph;
  if (ducking) { py = 0.35; ph = PLAYER.duckHalfHeight; }
  else { py = 1.0 + playerY; ph = PLAYER.normalHalfHeight; }
  return { px, py, ph, hw: PLAYER.halfWidth, hd: PLAYER.halfDepth };
}
function overlapY(py, ph, oy, oh) { return Math.abs(py - oy) < (ph + oh); }

function gainPoints(base) { return Math.round(base * (1 + Math.min(combo - 1, 10) * 0.1) * (doubleTimer > 0 ? 2 : 1)); }

function catchFish(f) {
  if (f.caught) return;
  f.caught = true;
  combo++; maxCombo = Math.max(maxCombo, combo);
  fishCaught++;
  const gain = gainPoints(f.points);
  score += gain;

  particles.emit(f.obj.position.clone(), f.color, 24, { up: true });
  particles.emit(f.obj.position.clone(), 0xffd54d, 10, { up: true, speed: 2.6 });
  spawnPopup(f.obj.position.clone().add(new THREE.Vector3(0, 1.3, 0)), `+${gain}${doubleTimer > 0 ? ' ✨' : ''}`, '#ffd54d', f.points >= 30 ? 1.3 : 0.9);
  toast(`抓到 ${f.name}！+${gain}`);
  Audio.catch(combo);
  flashEl.style.opacity = 0.75; setTimeout(() => flashEl.style.opacity = 0, 90);
  comboEl.textContent = combo >= 2 ? `连击 x${combo}` : '';
  comboEl.classList.remove('show'); void comboEl.offsetWidth; comboEl.classList.add('show');

  activeFish.splice(activeFish.indexOf(f), 1);
  if (f.mixer) mixers.splice(mixers.indexOf(f.mixer), 1);
  f.obj.userData.dieT = 0;
  f.obj.userData.target = playerHolder.position.clone().add(new THREE.Vector3(0, 1.2, -0.5));
  dyingObjects.push(f.obj);
  updateHUD();
}

function catchPowerup(p) {
  activePowerups.splice(activePowerups.indexOf(p), 1);
  scene.remove(p.obj);
  Audio.powerup();
  particles.emit(p.obj.position.clone(), p.def.color, 30, { up: true, speed: 5 });
  spawnPopup(p.obj.position.clone().add(new THREE.Vector3(0, 1, 0)), p.def.emoji + ' ' + p.def.name, '#ffffff', 1.1);
  toast(`获得 ${p.def.emoji} ${p.def.name}！`);
  if (p.def.type === 'shield') { shield = true; shieldBubble.visible = true; }
  else if (p.def.type === 'magnet') { magnetTimer = p.def.dur; }
  else if (p.def.type === 'double') { doubleTimer = p.def.dur; }
  else if (p.def.type === 'boost') { boostTimer = p.def.dur; }
  updatePowerupBar();
}

function hitObstacle() {
  if (invincible > 0) return;
  if (shield) { shield = false; shieldBubble.visible = false; invincible = 1.6; updatePowerupBar(); return; }
  hearts--; combo = 0; invincible = 1.6;
  comboEl.classList.remove('show');
  flashEl.classList.add('hit'); flashEl.style.opacity = 0.9;
  setTimeout(() => { flashEl.classList.remove('hit'); flashEl.style.opacity = 0; }, 110);
  Audio.hit();
  spawnPopup(playerHolder.position.clone().add(new THREE.Vector3(0, 2.2, 0)), '💥', '#ff6b6b', 1.1);
  updateHUD();
  if (hearts <= 0) gameOver();
}

// ---------- HUD ----------
function updateHUD() {
  scoreEl.textContent = Math.floor(score);
  fishCountEl.textContent = fishCaught;
  let h = '';
  for (let i = 0; i < 3; i++) h += `<span class="heart${i >= hearts ? ' lost' : ''}">❤️</span>`;
  heartsEl.innerHTML = h;
}
function updatePowerupBar() {
  const parts = [];
  if (shield) parts.push('🛡️');
  if (magnetTimer > 0) parts.push('🧲' + Math.ceil(magnetTimer) + 's');
  if (doubleTimer > 0) parts.push('✨' + Math.ceil(doubleTimer) + 's');
  if (boostTimer > 0) parts.push('⚡' + Math.ceil(boostTimer) + 's');
  powerupBar.textContent = parts.join(' ');
}
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400);
}

// ---------- 输入 ----------
function setLane(d) { lane = Math.max(0, Math.min(2, lane + d)); }
function doJump() { if (!running || jumping || ducking) return; jumping = true; playerVelY = JUMP_VEL; Audio.jump(); }
function doDuck() { if (!running || jumping) return; ducking = true; duckTimer = DUCK_TIME; Audio.duck(); }

window.addEventListener('keydown', e => {
  if (!running) return;
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': setLane(-1); break;
    case 'ArrowRight': case 'KeyD': setLane(1); break;
    case 'ArrowUp': case 'KeyW': case 'Space': e.preventDefault(); doJump(); break;
    case 'ArrowDown': case 'KeyS': e.preventDefault(); doDuck(); break;
  }
});
let touchStart = null;
window.addEventListener('touchstart', e => { touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
window.addEventListener('touchend', e => {
  if (!touchStart || !running) return;
  const dx = e.changedTouches[0].clientX - touchStart.x, dy = e.changedTouches[0].clientY - touchStart.y;
  if (Math.abs(dx) > Math.abs(dy)) setLane(dx > 0 ? 1 : -1);
  else if (dy < -30) doJump();
  else if (dy > 30) doDuck();
  touchStart = null;
}, { passive: true });

// ---------- 主循环 ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  waterMat.uniforms.uTime.value = t;
  // 泳道虚线流动
  laneGroup.children.forEach(o => {
    if (o.userData.baseZ !== undefined) { o.position.z = o.userData.baseZ + ((t * worldSpeed) % 6); }
  });

  if (!running) { renderer.render(scene, camera); return; }

  worldSpeed = Math.min(MAX_SPEED, worldSpeed + SPEED_RAMP * dt);

  // 加速道具：临时提速 + 无敌
  if (boostTimer > 0) {
    boostTimer -= dt;
    invincible = Math.max(invincible, 0.1);
    if (boostTimer <= 0) updatePowerupBar();
  }
  const speed = boostTimer > 0 ? worldSpeed + 9 : worldSpeed;

  distance += speed * dt;
  score += speed * dt * 0.4 * (doubleTimer > 0 ? 2 : 1);

  // 里程碑检测
  const ms = Math.floor(distance / MILESTONE_GAP);
  if (ms > lastMilestone) {
    lastMilestone = ms;
    const label = ms * MILESTONE_GAP;
    milestoneEl.textContent = `🏆 ${label} 米`;
    milestoneEl.classList.remove('show'); void milestoneEl.offsetWidth; milestoneEl.classList.add('show');
    Audio.milestone();
  }

  if (jumping) {
    playerVelY += GRAVITY * dt;
    playerY += playerVelY * dt;
    if (playerY <= 0) { playerY = 0; jumping = false; playerVelY = 0; }
  }
  if (ducking) { duckTimer -= dt; if (duckTimer <= 0) ducking = false; }
  if (invincible > 0) invincible -= dt;
  if (magnetTimer > 0) { magnetTimer -= dt; if (magnetTimer <= 0) updatePowerupBar(); }
  if (doubleTimer > 0) { doubleTimer -= dt; if (doubleTimer <= 0) updatePowerupBar(); }

  laneX += (LANES[lane] - laneX) * Math.min(1, dt * 12);

  // 奔跑动画（降低抖动幅度）
  const gallopFreq = 5 + worldSpeed * 0.3;
  const gallop = Math.sin(t * gallopFreq) * 0.05 + Math.sin(t * gallopFreq * 2 + 0.8) * 0.025;
  const lean = ducking ? 0.28 : 0.08 + Math.sin(t * gallopFreq + 0.4) * 0.03;

  if (playerHolder) {
    playerHolder.position.x = laneX;
    playerHolder.position.y = playerY + gallop * (jumping ? 0.35 : 1);
    playerHolder.rotation.z += ((LANES[lane] - laneX) * -0.09 - playerHolder.rotation.z) * Math.min(1, dt * 10);
    playerHolder.rotation.x = jumping ? -0.12 : -lean;
    playerHolder.rotation.y = Math.sin(t * gallopFreq * 0.5) * 0.025;
    playerModel.visible = !(invincible > 0 && Math.floor(t * 14) % 2 === 0);
  }
  if (shieldBubble) { shieldBubble.visible = shield; shieldBubble.position.y = 1.1 + Math.sin(t * 4) * 0.05; }
  splashTimer -= dt;
  if (splashTimer <= 0 && !jumping) {
    splashTimer = 0.18;
    const foot = playerHolder.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.05, 0.4));
    particles.emit(foot, 0xbfeaff, 1, { speed: 2.5, up: true, backward: true, life: 0.3, gravity: -9 });
  }
  if (playerShadow) {
    playerShadow.scale.setScalar(1 - Math.min(1, playerY * 0.5));
    playerShadow.position.x = laneX;
    playerShadow.material.opacity = 0.32 - Math.min(0.24, playerY * 0.24);
  }

  camera.position.x += (laneX * 0.5 - camera.position.x) * Math.min(1, dt * 6);
  camera.position.y += (4.5 + Math.sin(t * 1.2) * 0.05 - camera.position.y) * Math.min(1, dt * 4);
  camera.lookAt(laneX * 0.4, 1.5, -6);

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    const difficulty = Math.min(1, distance / 4000);   // 0→1，随距离递增难度
    if (Math.random() < 0.66) { spawnFish(); spawnTimer = 0.26 + Math.random() * 0.4; }
    else { spawnObstacle(); spawnTimer = (0.7 + Math.random() * 0.6) * (1 - difficulty * 0.55); }
    ensureFair();
  }
  powerupTimer -= dt;
  if (powerupTimer <= 0) { spawnPowerup(); powerupTimer = 8 + Math.random() * 6; }

  const pb = playerBox();

  // 鱼
  for (let i = activeFish.length - 1; i >= 0; i--) {
    const f = activeFish[i];
    f.obj.position.z += speed * dt;
    // 磁铁吸引
    if (magnetTimer > 0) {
      const dx = pb.px - f.obj.position.x, dz = PLAYER_Z - f.obj.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 9) {
        f.obj.position.x += dx * dt * 3;
        f.obj.position.z += dz * dt * 3;
      }
    }
    f.obj.position.y = f.y + Math.sin(t * 3 + f.obj.position.x) * 0.13;
    if (f.radial) f.obj.rotation.y += dt * 0.6;
    if (f.ring) { f.ring.rotation.z += dt * 2; f.ring.material.opacity = 0.5 + Math.sin(t * 5) * 0.2; }
    if (f.obj.position.z > DESPAWN_Z) { scene.remove(f.obj); if (f.mixer) mixers.splice(mixers.indexOf(f.mixer), 1); activeFish.splice(i, 1); continue; }
    if (f.tail) f.tail.rotation.y = Math.sin(t * 10 + f.obj.position.x) * 0.55;
    if (!f.caught && Math.abs(pb.px - f.obj.position.x) < (pb.hw + f.halfW) &&
        overlapY(pb.py, pb.ph, f.obj.position.y, f.hh) &&
        Math.abs(PLAYER_Z - f.obj.position.z) < (pb.hd + 0.5)) {
      catchFish(f);
    }
  }

  // 道具
  for (let i = activePowerups.length - 1; i >= 0; i--) {
    const p = activePowerups[i];
    p.obj.position.z += speed * dt;
    p.obj.position.y = p.y + Math.sin(t * 3 + p.obj.position.x) * 0.15;
    if (p.obj.userData.core) p.obj.userData.core.rotation.y += dt * 2;
    if (p.obj.userData.ring) { p.obj.userData.ring.rotation.z -= dt * 1.5; p.obj.userData.ring.material.opacity = 0.5 + Math.sin(t * 6) * 0.25; }
    if (p.obj.position.z > DESPAWN_Z) { scene.remove(p.obj); activePowerups.splice(i, 1); continue; }
    if (Math.abs(pb.px - p.obj.position.x) < (pb.hw + p.halfW) &&
        overlapY(pb.py, pb.ph, p.obj.position.y, p.hh) &&
        Math.abs(PLAYER_Z - p.obj.position.z) < (pb.hd + 0.5)) {
      catchPowerup(p);
    }
  }

  // 障碍
  for (let i = activeObstacles.length - 1; i >= 0; i--) {
    const o = activeObstacles[i];
    o.obj.position.z += speed * dt;
    if (o.obj.userData.kind === 'whirl' && o.obj.userData.ring) o.obj.userData.ring.rotation.z += dt * 4;
    if (o.obj.userData.warn) { o.obj.userData.warn.rotation.z += dt * 2; o.obj.userData.warn.material.opacity = 0.55 + Math.sin(t * 7) * 0.25; }
    if (o.obj.position.z > DESPAWN_Z) { scene.remove(o.obj); activeObstacles.splice(i, 1); continue; }
    let hit = Math.abs(pb.px - o.obj.position.x) < (pb.hw + o.hw) &&
              overlapY(pb.py, pb.ph, o.y, o.hh) &&
              Math.abs(PLAYER_Z - o.obj.position.z) < (pb.hd + o.hd);
    if (o.kind === 'jelly' && ducking) hit = false;
    if (hit) hitObstacle();
  }

  // 被吸入的鱼
  for (let i = dyingObjects.length - 1; i >= 0; i--) {
    const o = dyingObjects[i];
    o.userData.dieT = (o.userData.dieT ?? 0) + dt;
    const tt = o.userData.dieT;
    o.position.lerp(o.userData.target, 1 - Math.pow(0.01, dt));
    o.scale.setScalar(Math.max(0.01, 1 - tt * 3.2));
    o.rotation.y += dt * 6;
    if (tt > 0.35) { scene.remove(o); dyingObjects.splice(i, 1); }
  }

  for (const m of mixers) m.update(dt);
  particles.update(dt);
  updatePopups(dt);
  updateHUD();
  renderer.render(scene, camera);
}

// ---------- 流程 ----------
async function init() {
  try {
    loadBar.style.width = '25%';
    await buildPlayer();
    loadBar.style.width = '55%';
    await preloadFishModels();
    loadBar.style.width = '90%';
    loadingEl.style.display = 'none';
    hudEl.classList.remove('hidden');
    updateHUD();
    startScreen.classList.remove('hidden');
    animate();
  } catch (e) {
    console.error(e);
    loadingEl.querySelector('.p').textContent = '加载失败，请刷新重试：' + e.message;
  }
}

function clearWorld() {
  activeFish.forEach(f => scene.remove(f.obj)); activeFish.length = 0;
  activePowerups.forEach(p => scene.remove(p.obj)); activePowerups.length = 0;
  activeObstacles.forEach(o => scene.remove(o.obj)); activeObstacles.length = 0;
  dyingObjects.forEach(o => scene.remove(o)); dyingObjects.length = 0;
  popups.forEach(p => scene.remove(p.sp)); popups.length = 0;
  mixers.length = 0;
}

function startGame() {
  Audio.ensure();
  clearWorld();
  running = true;
  worldSpeed = BASE_SPEED; distance = 0; score = 0; fishCaught = 0;
  combo = 0; maxCombo = 0; hearts = 3; lane = 1; laneX = LANES[1];
  playerY = 0; jumping = false; ducking = false; invincible = 0;
  shield = false; magnetTimer = 0; doubleTimer = 0; boostTimer = 0;
  lastMilestone = 0;
  shieldBubble.visible = false;
  spawnTimer = 0.5; powerupTimer = 6;
  if (playerHolder) { playerHolder.position.set(LANES[1], 0, PLAYER_Z); playerHolder.rotation.set(0, 0, 0); }
  startScreen.classList.add('hidden'); overScreen.classList.add('hidden');
  updateHUD(); updatePowerupBar();
}

function gameOver() {
  running = false;
  Audio.over();
  if (Math.floor(score) > best) { best = Math.floor(score); localStorage.setItem('lushu_best', best); }
  $('finalScore').textContent = Math.floor(score);
  $('finalFish').textContent = fishCaught;
  $('finalCombo').textContent = maxCombo;
  $('bestScore').textContent = `🏆 历史最佳 ${best}`;
  overScreen.classList.remove('hidden');
}

$('startBtn').addEventListener('click', startGame);
$('restartBtn').addEventListener('click', startGame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
