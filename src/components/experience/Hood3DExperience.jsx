'use client';
// Hood3DExperience — scroll-driven Three.js assembly/cleaning experience.
import React from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { gsap } from 'gsap';
import { track } from '@/lib/analytics';

const TWEAKS = { grease: 1.3, airflow: true, bgSpeed: 1.5, bgSwirl: 1.3 };

const SECTIONS = [
  { id: 'open', kicker: 'VENTWASH — COMMERCIAL KITCHEN EXHAUST CLEANING', title: 'This is a kitchen at *its best*.', body: 'Bare-metal hood. Clear duct. A rooftop fan that pulls like new. Hold this picture — because without care, it never stays this way.', side: 'center', image: 'open' },
  { id: 'intro', kicker: 'EVERY SERVICE. EVERY FLAME.', title: 'Your kitchen *breathes* through its hood.', body: 'Every hour on the line pushes grease-laden vapor into the canopy, the filters, the duct and the fan — and it never comes back out on its own. This is what your exhaust system lives through.', side: 'left', video: 'intro' },
  { id: 'hero', kicker: 'NFPA 96 COMMERCIAL KITCHEN EXHAUST CLEANING', title: 'Grease *never* sleeps.', body: 'VentWash cleans your commercial kitchen exhaust system hood-to-roof — canopy, baffle filters, ducts and exhaust fan — to the NFPA 96 bare-metal standard. Scroll to see the full deep clean.', side: 'center' },
  { id: 'explode', kicker: 'FULL-SYSTEM EXHAUST CLEANING', title: 'Every part comes *apart*.', body: 'Cheap wipe-downs stop at the visible steel while grease hides in the plenum, duct and fan. Our certified technicians open the entire exhaust path — cookline to rooftop.', side: 'left' },
  { id: 'canopy', kicker: '01 — HOOD & CANOPY CLEANING', title: 'Degreased to *bare metal*.', body: 'Hand-scraped and pressure-washed inside and out, then polished. Grease-laden vapor residue is removed — not smeared around.', side: 'right', part: 'canopy', items: ['Canopy shell & end panels', 'Exhaust collar & flange', 'Supply plenum face', 'Grease trough & drain cup', 'Wall brackets & trim', 'Service sticker applied'] },
  { id: 'filters', kicker: '02 — BAFFLE FILTER SERVICE', title: 'Soaked. Scrubbed. *Re-seated*.', body: 'Filters come out for a degreaser bath and pressure wash, then go back at the correct angle — or get replaced when they’re past saving. Clean filters restore airflow and cut fire risk.', side: 'left', part: 'filters', items: ['Baffle panels × 5', 'Filter frames & rails', 'Pull handles', 'Drip edges re-seated at 45°'] },
  { id: 'fire', kicker: '03 — FIRE SUPPRESSION AREA', title: 'Clean around *the line*.', body: 'Nozzles, piping and tank are wiped down with caps and seals checked — your suppression system stays operational and inspection-ready while we work.', side: 'right', part: 'fire', items: ['Wet-chem agent tank', 'Discharge valve & hose', 'Distribution piping', 'Spray nozzles × 5 — caps checked', 'Control box & links'] },
  { id: 'duct', kicker: '04 — EXHAUST DUCT CLEANING', title: 'Scraped to *the metal*.', body: 'Access panels opened and the full grease duct run degreased to bare metal per NFPA 96 — with before-and-after photo documentation.', side: 'left', part: 'duct', items: ['Duct sections — full run', 'Flange joints & bolts', 'Standing corner seams', 'Access door & latches', 'Photo documentation'] },
  { id: 'fan', kicker: '05 — ROOFTOP EXHAUST FAN', title: 'Opened, degreased, *rebalanced*.', body: 'Fan tipped on its hinge, bowl and blades degreased, belts checked, rooftop grease containment emptied — so the motor pulls like new.', side: 'right', part: 'fan', items: ['Aluminum dome & bowl', 'Blower wheel — degreased', 'Drive motor & belts', 'Mesh guard band', 'Curb, base plate & bolts', 'Hinge kit & grease cup'] },
  { id: 'mua', kicker: '06 — MAKE-UP AIR UNIT', title: '*Fresh* air, fresh filters.', body: 'Make-up air unit cleaned and re-filtered to keep your kitchen balanced — no whistling doors, no smoke rolling off the line.', side: 'left', part: 'mua', items: ['Unit cabinet & curb', 'Intake hood & bird screen', 'Louver panel', 'Intake filters — replaced', 'Drop duct & supply grille', 'Conduit & disconnect switch'] },
  { id: 'rebuild', kicker: 'REASSEMBLY & DOCUMENTATION', title: 'Back together. *Inspection-ready*.', body: 'Every panel re-hung and gasketed, systems restarted, service sticker applied — plus a photo report your fire marshal and insurer will actually accept.', side: 'right' },
  { id: 'finale', kicker: 'BOOK YOUR HOOD CLEANING', title: 'Airflow, *restored*.', body: 'Smoke off the line, up the duct, out the roof — and clean make-up air back in. After-hours scheduling. Licensed & insured. Free quotes.', side: 'center', cta: true },
  { id: 'outro', kicker: 'TO SPEC. TO SERVICE.', title: 'From *blueprint* to bare metal.', body: 'Every system is cleaned back to its drawing — hood, filters, grease duct and fan restored to the NFPA 96 bare-metal standard, documented panel by panel for your fire marshal and insurer.', side: 'left', video: 'outro' },
  { id: 'end', kicker: 'VENTWASH — HOOD TO ROOF', title: 'Clean. Compliant. *Ready to cook*.', body: 'This is how your kitchen should breathe. Book your free quote and we’ll keep it this way — on a schedule your inspector will love.', side: 'center', endCta: true, compact: true },
];
const MARQ = ' NFPA 96 — KITCHEN EXHAUST CLEANING — HOOD TO ROOF — BARE-METAL STANDARD —';
const ORDER3D = ['range', 'canopy', 'filters', 'fire', 'duct', 'fan', 'mua'];
const NAME3D = { range: 'COOKLINE', canopy: 'HOOD CANOPY', filters: 'BAFFLE FILTERS', fire: 'FIRE SUPPRESSION', duct: 'GREASE DUCT', fan: 'ROOF EXHAUST FAN', mua: 'MAKE-UP AIR UNIT' };
const ANCHOR3D = { range: [0.88, 0.75, 0.45], canopy: [1.1, 2.45, 0.35], filters: [0.7, 1.85, 0.35], fire: [1.52, 2.42, 0.12], duct: [0.3, 3.4, 0.3], fan: [0.55, 4.55, 0.15], mua: [-2.3, 4.35, 0.25] };
const PART_SEC = { canopy: 4, filters: 5, fire: 6, duct: 7, fan: 8, mua: 9 };
const VIDEO_SRC = { intro: '/animations/MAINSTART.scrub.mp4', outro: '/animations/FINALEND.scrub.mp4' };
const END_IMG = '/animations/final-after.png';
const N = SECTIONS.length;
const SEC_VH = 170;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
// scroll-scrub a video: seek to `t` seconds. The .scrub.mp4 files are encoded
// all-intra (every frame a keyframe) so seeks land within a frame. Skips while
// a previous seek is still in flight and ignores sub-frame deltas.
function scrubVideo(el, t) {
  if (el.readyState < 2 || el.seeking) return;
  if (Math.abs(el.currentTime - t) > 0.034) el.currentTime = t;
}

// ---------- materials ----------
function makeEnvTexture(renderer) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#e8edf2'); grad.addColorStop(0.45, '#aab4bf'); grad.addColorStop(0.55, '#6b7683'); grad.addColorStop(1, '#3a424c');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(0, 30, 512, 26); g.fillRect(60, 90, 160, 40); g.fillRect(300, 80, 130, 34);
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, 150, 512, 12);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(tex).texture;
  tex.dispose(); pm.dispose();
  return env;
}

const DIRT_PARS = `
uniform float uDirt; uniform float uWipe; uniform float uXmin; uniform float uXmax; uniform float uBlotch;
varying vec3 vWPos;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float dirtAmt(){
  float edge = mix(uXmin - 0.12, uXmax + 0.12, uWipe);
  float n = vnoise(vWPos.xy*5.0 + vWPos.z*3.0) * 0.6 + vnoise(vWPos.zy*9.0 + 7.3) * 0.4;
  float blotch = smoothstep(0.30, 0.72, n) * uBlotch + (1.0 - uBlotch) * 0.55;
  return uDirt * step(edge, vWPos.x) * blotch;
}`;

function patchDirt(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + DIRT_PARS)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float dAmt = dirtAmt();
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.42,0.30,0.14) + vec3(0.06,0.04,0.01), dAmt * 0.85);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = min(1.0, roughnessFactor + dAmt * 0.55);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { float edge = mix(uXmin - 0.12, uXmax + 0.12, uWipe);
    float on = (uWipe > 0.002 && uWipe < 0.998) ? 1.0 : 0.0;
    float sweep = exp(-pow((vWPos.x - edge) / 0.055, 2.0)) * on;
    totalEmissiveRadiance += vec3(1.0, 1.0, 0.94) * sweep * 0.85 * uDirt; }`);
  };
  mat.needsUpdate = true;
}

// ---------- procedural metal textures ----------
function brushedTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8c9196'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const y = Math.random() * 256, w = 40 + Math.random() * 200, x = Math.random() * 256 - 100;
    const l = Math.random();
    g.strokeStyle = l > 0.5 ? `rgba(255,255,255,${0.03 + l * 0.05})` : `rgba(0,0,0,${0.03 + l * 0.06})`;
    g.lineWidth = 0.6 + Math.random();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + (Math.random() - 0.5) * 1.5); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function galvTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#9aa0a5'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 6 + Math.random() * 22;
    const l = 140 + Math.random() * 60;
    g.fillStyle = `rgba(${l},${l + 4},${l + 8},${0.25 + Math.random() * 0.3})`;
    g.beginPath();
    const n = 5 + (Math.random() * 3 | 0);
    for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI * 2; const rr = r * (0.6 + Math.random() * 0.5); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------- geometry helpers ----------
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 28) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function hexBolt(r, h, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 6), mat);
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}
function tube(pts, r, mat) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => V3(p[0], p[1], p[2])));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, r, 10), mat);
  m.castShadow = true;
  return m;
}
function labelTexture(draw, w = 256, h = 160) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function buildScene(scene, env, T) {
  const brushed = brushedTexture(), galvT = galvTexture();
  const steel = () => new THREE.MeshStandardMaterial({ color: 0xd6dade, metalness: 1.0, roughness: 0.3, roughnessMap: brushed, bumpMap: brushed, bumpScale: 0.0012, envMap: env, envMapIntensity: 1.15 });
  const alum = () => new THREE.MeshStandardMaterial({ color: 0xe2e5e8, metalness: 1.0, roughness: 0.24, roughnessMap: brushed, envMap: env, envMapIntensity: 1.25 });
  const galv = () => new THREE.MeshStandardMaterial({ color: 0xb4bac0, metalness: 0.88, roughness: 0.52, roughnessMap: galvT, bumpMap: galvT, bumpScale: 0.0015, envMap: env, envMapIntensity: 0.85 });
  const tankSteel = steel;
  const steelDark = () => new THREE.MeshStandardMaterial({ color: 0x7a828b, metalness: 0.9, roughness: 0.42, roughnessMap: brushed, envMap: env, envMapIntensity: 0.8 });
  const darkBody = () => new THREE.MeshStandardMaterial({ color: 0x2b3138, metalness: 0.65, roughness: 0.55, envMap: env, envMapIntensity: 0.5 });
  const red = () => new THREE.MeshStandardMaterial({ color: 0xb23530, metalness: 0.35, roughness: 0.38, envMap: env, envMapIntensity: 0.7 });
  const brass = () => new THREE.MeshStandardMaterial({ color: 0xbd9a58, metalness: 1.0, roughness: 0.3, envMap: env, envMapIntensity: 1.0 });

  const parts = {}; // id -> {group, home, exploded(offset), uniforms[], mats[]}
  function makePart(id, explodedOffset) {
    const group = new THREE.Group();
    scene.add(group);
    const uniforms = { uDirt: { value: 1 }, uWipe: { value: 0 }, uXmin: { value: -1 }, uXmax: { value: 1 }, uBlotch: { value: 1 } };
    parts[id] = { group, off: explodedOffset, u: uniforms, mats: [] };
    return parts[id];
  }
  function mat(part, factory) { const m = factory(); patchDirt(m, part.u); part.mats.push(m); return m; }

  // RANGE (context, cleans at rebuild)
  {
    const p = makePart('range', V3(0, 0, 1.6));
    const g = p.group, ms = mat(p, steel), md = mat(p, darkBody), mg = mat(p, steelDark);
    g.add(box(1.7, 0.78, 0.85, ms, 0, 0.47, 0));
    g.add(box(1.7, 0.09, 0.85, md, 0, 0.905, 0));
    g.add(box(1.7, 0.5, 0.06, ms, 0, 1.2, -0.41));
    g.add(box(1.6, 0.05, 0.05, mg, 0, 1.43, -0.38));
    for (let i = 0; i < 4; i++) {
      g.add(cyl(0.1, 0.11, 0.03, md, -0.6 + i * 0.4, 0.965, 0.02));
      g.add(cyl(0.045, 0.045, 0.045, mg, -0.6 + i * 0.4, 0.975, 0.02));
      const g1 = box(0.24, 0.014, 0.014, md, -0.6 + i * 0.4, 0.995, 0.02); g1.rotation.y = 0.785; g.add(g1);
      const g2 = box(0.24, 0.014, 0.014, md, -0.6 + i * 0.4, 0.995, 0.02); g2.rotation.y = -0.785; g.add(g2);
    }
    // gas flames (alive kitchen)
    T.flames = [];
    const flameM = new THREE.MeshBasicMaterial({ color: 0x5f9fe0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const flameI = new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const fg = new THREE.Group();
      const fo = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.1, 12), flameM); fo.position.y = 0.05; fg.add(fo);
      const fi = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.06, 10), flameI); fi.position.y = 0.035; fg.add(fi);
      fg.position.set(-0.6 + i * 0.4, 0.99, 0.02);
      g.add(fg); T.flames.push(fg);
    }
    g.add(box(1.15, 0.42, 0.05, mg, -0.2, 0.42, 0.435));
    g.add(box(0.95, 0.3, 0.02, new THREE.MeshStandardMaterial({ color: 0x11151a, metalness: 0.3, roughness: 0.12, envMap: env, envMapIntensity: 1.3 }), -0.2, 0.42, 0.465));
    g.add(box(0.9, 0.05, 0.06, ms, -0.2, 0.60, 0.48));
    for (let i = 0; i < 5; i++) {
      const k = cyl(0.032, 0.032, 0.05, ms, 0.42 + (i % 3) * 0.14, 0.8 - Math.floor(i / 3) * 0.14, 0.45); k.rotation.x = Math.PI / 2; g.add(k);
      g.add(box(0.008, 0.02, 0.055, md, 0.42 + (i % 3) * 0.14, 0.815 - Math.floor(i / 3) * 0.14, 0.45));
    }
    for (const sx of [-0.76, 0.76]) for (const sz of [-0.34, 0.34]) g.add(cyl(0.03, 0.025, 0.12, mg, sx, 0.05, sz));
  }
  // CANOPY (canopy shell + exposed plenum + trough, per reference)
  {
    const p = makePart('canopy', V3(0, 1.15, 0));
    const g = p.group, ms = mat(p, steel), md = mat(p, darkBody), mg = mat(p, steelDark);
    const prof = new THREE.Shape();
    prof.moveTo(-0.55, 0); prof.lineTo(0.62, 0); prof.lineTo(0.62, 0.30); prof.lineTo(0.20, 0.62); prof.lineTo(-0.55, 0.62); prof.closePath();
    const geo = new THREE.ExtrudeGeometry(prof, { depth: 2.6, bevelEnabled: false });
    geo.rotateY(-Math.PI / 2); geo.translate(1.3, 0, 0);
    const body = new THREE.Mesh(geo, ms); body.castShadow = body.receiveShadow = true;
    body.position.y = 1.98; g.add(body);
    g.add(box(2.68, 0.06, 1.26, ms, 0, 1.95, 0.02));
    g.add(cyl(0.24, 0.24, 0.16, mg, 0, 2.68, -0.05));
    g.add(cyl(0.31, 0.31, 0.03, ms, 0, 2.61, -0.05));
    g.add(box(0.06, 0.16, 0.14, mg, -0.9, 2.55, 0.3)); g.add(box(0.06, 0.16, 0.14, mg, 0.9, 2.55, 0.3));
    // plenum (open front, interior visible)
    g.add(box(2.3, 0.5, 0.04, ms, 0, 1.72, -0.42));
    g.add(box(0.04, 0.5, 0.86, ms, -1.15, 1.72, 0));
    g.add(box(0.04, 0.5, 0.86, ms, 1.15, 1.72, 0));
    g.add(box(2.3, 0.14, 0.04, ms, 0, 1.90, 0.44));
    g.add(box(2.26, 0.44, 0.02, md, 0, 1.72, -0.40));
    // grease trough + cup
    g.add(box(2.3, 0.05, 0.26, mg, 0, 1.485, 0.34));
    g.add(box(2.3, 0.1, 0.03, ms, 0, 1.52, 0.465));
    g.add(box(0.22, 0.12, 0.15, mg, 0.35, 1.41, 0.37));
    // seams + corner welds
    for (const sx of [-0.87, 0, 0.87]) g.add(box(0.012, 0.3, 0.005, mg, sx, 2.12, 0.625));
    // VentWash service sticker
    const stTex = labelTexture((c2, w2, h2) => {
      c2.fillStyle = '#f4f8fb'; c2.fillRect(0, 0, w2, h2);
      c2.fillStyle = '#3E6FA6'; c2.fillRect(0, 0, w2, 44);
      c2.fillStyle = '#fff'; c2.font = '700 30px Archivo, sans-serif'; c2.textAlign = 'center';
      c2.fillText('VENTWASH', w2 / 2, 32);
      c2.fillStyle = '#1a2129'; c2.font = '500 20px IBM Plex Mono, monospace';
      c2.fillText('NFPA 96 SERVICE', w2 / 2, 82);
      c2.fillText('CLEANED: 07/2026', w2 / 2, 116);
      c2.strokeStyle = '#3E6FA6'; c2.lineWidth = 4; c2.strokeRect(4, 4, w2 - 8, h2 - 8);
    });
    const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.17), new THREE.MeshBasicMaterial({ map: stTex }));
    sticker.position.set(0.78, 2.12, 0.627); g.add(sticker);
  }
  // FILTERS (angled baffle row in plenum)
  {
    const p = makePart('filters', V3(0, 0.75, 0.9));
    const g = p.group, ms = mat(p, steel), md = mat(p, steelDark);
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Group();
      // frame
      f.add(box(0.42, 0.03, 0.05, md, 0, 0.215, 0)); f.add(box(0.42, 0.03, 0.05, md, 0, -0.215, 0));
      f.add(box(0.03, 0.46, 0.05, md, -0.195, 0, 0)); f.add(box(0.03, 0.46, 0.05, md, 0.195, 0, 0));
      // real baffle channels: alternating angled plates in two depths
      for (let k = 0; k < 6; k++) {
        const pl = box(0.062, 0.4, 0.016, k % 2 ? ms : md, -0.155 + k * 0.062, 0, k % 2 ? 0.014 : -0.014);
        pl.rotation.y = k % 2 ? 0.6 : -0.6;
        f.add(pl);
      }
      const h = cyl(0.012, 0.012, 0.12, md, 0, 0.13, 0.035); h.rotation.z = Math.PI / 2; f.add(h);
      const h2 = cyl(0.012, 0.012, 0.12, md, 0, -0.13, 0.035); h2.rotation.z = Math.PI / 2; f.add(h2);
      f.position.set(-0.92 + i * 0.46, 1.72, 0.06);
      f.rotation.x = -0.85;
      g.add(f);
    }
  }
  // FIRE SUPPRESSION (stainless tank, brass valve, red control box, nozzle line)
  {
    const p = makePart('fire', V3(1.15, 0.25, 0));
    const g = p.group, ms = mat(p, steel), mr = mat(p, red), mb = mat(p, brass), md = mat(p, steelDark);
    p.u.uBlotch.value = 0.6;
    g.add(cyl(0.095, 0.095, 0.48, mat(p, tankSteel), 1.52, 2.1, 0));
    g.add(cyl(0.05, 0.095, 0.07, ms, 1.52, 2.375, 0));
    g.add(cyl(0.022, 0.022, 0.08, mb, 1.52, 2.44, 0));
    const vh = cyl(0.012, 0.012, 0.1, mb, 1.55, 2.47, 0); vh.rotation.z = Math.PI / 2; g.add(vh);
    g.add(box(0.05, 0.34, 0.16, md, 1.38, 2.05, 0));
    g.add(box(0.2, 0.28, 0.12, mr, 1.52, 1.62, 0.02));
    g.add(cyl(0.035, 0.035, 0.026, ms, 1.52, 1.66, 0.09));
    // tank label band
    const tkTex = labelTexture((c2, w2, h2) => {
      c2.fillStyle = '#b23530'; c2.fillRect(0, 0, w2, h2);
      c2.fillStyle = '#fff'; c2.font = '700 34px Archivo, sans-serif'; c2.textAlign = 'center';
      c2.fillText('WET CHEM', w2 / 2, 62);
      c2.font = '500 22px IBM Plex Mono, monospace'; c2.fillText('UL 300', w2 / 2, 104);
    }, 256, 140);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.099, 0.099, 0.2, 24, 1, true, -1.1, 2.2), new THREE.MeshBasicMaterial({ map: tkTex, side: THREE.DoubleSide }));
    band.position.set(1.52, 2.12, 0); g.add(band);
    // supply hose from tank into plenum
    g.add(tube([[1.52, 2.36, 0], [1.45, 2.3, 0.06], [1.3, 2.1, 0.1], [1.18, 1.9, 0.1]], 0.018, md));
    const pipe = cyl(0.024, 0.024, 2.3, md, 0.1, 1.82, 0.12); pipe.rotation.z = Math.PI / 2; g.add(pipe);
    for (let i = 0; i < 5; i++) {
      g.add(cyl(0.018, 0.018, 0.1, mb, -0.8 + i * 0.45, 1.77, 0.12));
      g.add(cyl(0.001, 0.032, 0.05, mb, -0.8 + i * 0.45, 1.70, 0.12));
    }
  }
  // DUCT (galvanized, flanged joints, access door)
  {
    const p = makePart('duct', V3(1.6, 0.55, 0));
    const g = p.group, ms = mat(p, galv), md = mat(p, steelDark);
    g.add(box(0.55, 0.56, 0.55, ms, 0, 2.96, 0));
    g.add(box(0.55, 0.56, 0.55, ms, 0, 3.56, 0));
    g.add(box(0.62, 0.05, 0.62, md, 0, 3.26, 0));
    g.add(box(0.62, 0.05, 0.62, md, 0, 2.66, 0));
    for (const fy of [2.66, 3.26]) for (const bx of [-0.24, 0.24]) g.add(hexBolt(0.02, 0.03, md, bx, fy, 0.32));
    // standing corner seams
    for (const sx of [-0.27, 0.27]) { g.add(box(0.028, 1.16, 0.028, md, sx, 3.26, 0.27)); }
    g.add(box(0.3, 0.24, 0.02, md, 0, 2.96, 0.285));
    g.add(box(0.32, 0.26, 0.008, ms, 0, 2.96, 0.292));
    for (const dy of [-0.08, 0.08]) { const l = cyl(0.014, 0.014, 0.05, md, 0.19, 2.96 + dy, 0.30); l.rotation.x = Math.PI / 2; g.add(l); }
  }
  // FAN (upblast mushroom: curb, upstand, spinning wheel + motor, mesh band, dome)
  {
    const p = makePart('fan', V3(0, 1.15, 0));
    const g = p.group, ms = mat(p, alum), mg = mat(p, galv), md = mat(p, steelDark);
    g.add(box(0.82, 0.26, 0.82, mg, 0, 4.0, 0));
    g.add(box(1.0, 0.045, 1.0, mg, 0, 4.15, 0));
    for (const bx of [-0.44, 0.44]) for (const bz of [-0.44, 0.44]) g.add(hexBolt(0.022, 0.035, md, bx, 4.17, bz));
    // hinge kit + rooftop grease cup
    g.add(box(0.06, 0.16, 0.05, md, -0.42, 4.26, 0));
    g.add(cyl(0.02, 0.02, 0.1, md, -0.42, 4.34, 0));
    g.add(cyl(0.05, 0.045, 0.09, ms, 0.5, 4.22, 0.34));
    g.add(cyl(0.055, 0.055, 0.012, md, 0.5, 4.27, 0.34));
    g.add(cyl(0.36, 0.4, 0.12, ms, 0, 4.23, 0));
    // spinning centrifugal wheel + motor
    const wheel = new THREE.Group(); wheel.position.set(0, 4.36, 0);
    wheel.add(cyl(0.06, 0.06, 0.2, md, 0, 0, 0));
    for (let i = 0; i < 10; i++) {
      const b = box(0.03, 0.2, 0.14, md, 0, 0, 0);
      const a = (i / 10) * Math.PI * 2;
      b.position.set(Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24);
      b.rotation.y = -a + 0.5;
      wheel.add(b);
    }
    wheel.add(cyl(0.09, 0.09, 0.14, md, 0, 0.16, 0));
    g.add(wheel); T.fanWheel = wheel;
    // mesh band (wheel visible through it)
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.17, 36, 3, true), new THREE.MeshBasicMaterial({ color: 0x3a4046, wireframe: true, transparent: true, opacity: 0.7 }));
    band.position.set(0, 4.37, 0); g.add(band);
    const pts = [[0.03, 0.36], [0.30, 0.34], [0.48, 0.26], [0.585, 0.13], [0.585, 0.05], [0.52, 0.0]].map(a => new THREE.Vector2(a[0], a[1]));
    const dome = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), ms);
    dome.castShadow = dome.receiveShadow = true;
    dome.position.y = 4.46; g.add(dome);
    g.add(cyl(0.09, 0.09, 0.05, md, 0, 4.84, 0));
  }
  // MUA (galvanized box, intake hood, louvers, drop duct + supply grille)
  {
    const p = makePart('mua', V3(-1.35, 0.85, 0));
    const g = p.group, ms = mat(p, galv), md = mat(p, steelDark);
    p.u.uBlotch.value = 0.5; p.u.uDirt.value = 0.55;
    g.add(box(1.15, 0.52, 0.8, ms, -2.05, 4.16, 0));
    g.add(box(0.9, 0.1, 0.6, md, -2.05, 3.92, 0));
    const wedge = new THREE.Shape();
    wedge.moveTo(0, 0); wedge.lineTo(0.38, 0); wedge.lineTo(0.38, 0.36); wedge.closePath();
    const wgeo = new THREE.ExtrudeGeometry(wedge, { depth: 0.6, bevelEnabled: false });
    wgeo.rotateY(Math.PI); wgeo.translate(-2.625, 3.96, 0.3);
    const wm = new THREE.Mesh(wgeo, ms); wm.castShadow = wm.receiveShadow = true; g.add(wm);
    g.add(box(0.02, 0.3, 0.56, md, -2.995, 4.11, 0));
    for (let i = 0; i < 5; i++) g.add(box(0.5, 0.028, 0.02, md, -1.72, 4.0 + i * 0.08, 0.405));
    g.add(box(0.34, 0.5, 0.34, ms, -1.62, 3.6, 0));
    g.add(box(0.34, 0.34, 0.6, ms, -1.62, 3.28, 0.14));
    g.add(box(0.4, 0.4, 0.05, md, -1.62, 3.28, 0.46));
    for (let i = 0; i < 4; i++) g.add(box(0.36, 0.02, 0.02, ms, -1.62, 3.16 + i * 0.08, 0.47));
    // electrical conduit across roof to fan + disconnect switch
    g.add(tube([[-1.5, 4.0, -0.3], [-1.0, 3.92, -0.34], [-0.5, 3.9, -0.34], [-0.35, 3.95, -0.3]], 0.018, md));
    g.add(box(0.1, 0.14, 0.06, md, -1.44, 4.02, -0.32));
    g.add(box(0.03, 0.05, 0.02, new THREE.MeshStandardMaterial({ color: 0xb23530, metalness: 0.3, roughness: 0.4 }), -1.44, 4.0, -0.28));
  }
  // ROOF SLAB (static context)
  {
    const m = new THREE.MeshStandardMaterial({ color: 0x88909a, metalness: 0.2, roughness: 0.85, envMap: env, envMapIntensity: 0.35 });
    const slabL = box(2.6, 0.14, 2.6, m, -1.75, 3.8, 0);
    const slabR = box(2.9, 0.14, 2.6, m, 1.9, 3.8, 0);
    const slabF = box(0.9, 0.14, 0.95, m, 0, 3.8, 0.82);
    const slabB = box(0.9, 0.14, 0.95, m, 0, 3.8, -0.82);
    scene.add(slabL, slabR, slabF, slabB);
    [slabL, slabR, slabF, slabB].forEach(s => { s.userData.roof = true; });
    T.roof = [slabL, slabR, slabF, slabB];
  }
  // compute world x-ranges for wipe
  Object.values(parts).forEach(p => {
    const bb = new THREE.Box3().setFromObject(p.group);
    p.bbMin = bb.min.x; p.bbMax = bb.max.x;
    p.u.uXmin.value = bb.min.x; p.u.uXmax.value = bb.max.x;
    p.home = p.group.position.clone();
  });
  // pickable meshes for hover raycast
  T.pickMeshes = [];
  Object.entries(parts).forEach(([id, p]) => p.group.traverse(o => { if (o.isMesh) { o.userData.pid = id; T.pickMeshes.push(o); } }));
  // real-world GLB models: drop files into models/<part>.glb to replace built parts
  const SLOTS = {
    range: { c: [0, 0.5, 0], s: 1.75 }, canopy: { c: [0, 2.05, 0], s: 2.75 },
    filters: { c: [0, 1.72, 0.06], s: 2.3 }, fire: { c: [1.35, 2.0, 0.05], s: 1.1 },
    duct: { c: [0, 3.25, 0], s: 1.8 }, fan: { c: [0, 4.4, 0], s: 1.2 }, mua: { c: [-2.0, 4.0, 0], s: 1.9 },
  };
  if (GLTFLoader) {
    const GL = new GLTFLoader();
    Object.entries(SLOTS).forEach(([id, slot]) => {
      fetch(`models/${id}.glb`, { method: 'HEAD' }).then(r => {
        if (!r.ok) return;
        GL.load(`models/${id}.glb`, (gltf) => {
          const p = parts[id]; if (!p) return;
          const obj = gltf.scene;
          const bb = new THREE.Box3().setFromObject(obj);
          const size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
          const sc = slot.s / Math.max(size.x, size.y, size.z);
          obj.scale.setScalar(sc);
          obj.position.set(slot.c[0] - ctr.x * sc, slot.c[1] - ctr.y * sc, slot.c[2] - ctr.z * sc);
          obj.traverse(o => {
            if (o.isMesh) {
              o.castShadow = o.receiveShadow = true;
              o.userData.pid = id; T.pickMeshes.push(o);
              if (o.material) { o.material.envMap = env; o.material.envMapIntensity = 0.9; patchDirt(o.material, p.u); }
            }
          });
          while (p.group.children.length) p.group.remove(p.group.children[0]);
          p.group.add(obj);
          const nb = new THREE.Box3().setFromObject(p.group);
          p.bbMin = nb.min.x; p.bbMax = nb.max.x;
        });
      }).catch(() => { });
    });
  }
  return parts;
}

// ---------- airflow arrows ----------
// Schematic 3D arrows riding the real air path, always on. Waypoints are
// anchored to parts, so when the system explodes apart the flow visibly
// threads the displaced hood, duct and fan. Rendered without depth test
// (x-ray) so the flow stays readable inside closed steel.
function buildFlowArrows(scene, parts) {
  const UP = new THREE.Vector3(0, 1, 0);
  // [partId or null, x, y, z] — base position in assembled (home) space.
  const EX_PATH = [
    ['range', 0.10, 1.05, 0.05],
    ['filters', 0, 1.52, 0.30],
    ['filters', 0, 1.78, 0.02],
    ['canopy', 0, 2.02, -0.05],
    ['canopy', 0, 2.72, -0.05],
    ['duct', 0, 2.92, 0],
    ['duct', 0, 3.58, 0],
    ['fan', 0, 4.28, 0],
    ['fan', 0, 4.78, 0],
    ['fan', 0.22, 5.35, 0.08],
  ];
  const IN_PATH = [
    ['mua', -2.95, 4.05, 0.28],
    ['mua', -2.35, 4.12, 0],
    ['mua', -1.62, 3.62, 0],
    ['mua', -1.62, 3.30, 0.30],
    [null, -1.35, 2.45, 0.55],
    [null, -0.75, 1.35, 0.60],
  ];
  // flat 2D arrow glyph pointing +X (tail bar + triangular head), ~0.10 long
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(-0.062, -0.015); arrowShape.lineTo(0.005, -0.015); arrowShape.lineTo(0.005, -0.037);
  arrowShape.lineTo(0.064, 0); arrowShape.lineTo(0.005, 0.037); arrowShape.lineTo(0.005, 0.015);
  arrowShape.lineTo(-0.062, 0.015); arrowShape.closePath();
  const arrowGeo = new THREE.ShapeGeometry(arrowShape);
  const EX_DIRTY = new THREE.Color(0.47, 0.30, 0.10);   // greased, bad air — deep amber for contrast
  const EX_CLEAN = new THREE.Color(0.16, 0.50, 0.92);   // pure air
  const IN_COLOR = new THREE.Color(0.26, 0.56, 0.94);   // fresh make-up air
  function stream(path, lanes, perLane, opacity, speed, plume) {
    const n = lanes * perLane;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(arrowGeo, mat, n);
    mesh.frustumCulled = false; mesh.renderOrder = 5;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) mesh.setColorAt(i, white);
    scene.add(mesh);
    const pts = path.map(() => new THREE.Vector3());
    const curve = new THREE.CatmullRomCurve3(pts);
    const meta = [];
    for (let lane = 0; lane < lanes; lane++) for (let k = 0; k < perLane; k++) {
      meta.push({
        phase: (k + Math.random() * 0.7) / perLane,
        lane: lane - (lanes - 1) / 2,
        jx: Math.random() - 0.5, jz: Math.random() - 0.5,
        v: 0.85 + Math.random() * 0.3,
        tint: 0.88 + Math.random() * 0.24,
      });
    }
    return { path, n, mesh, pts, curve, meta, speed, plume };
  }
  const exhaust = stream(EX_PATH, 3, 12, 0.92, 0.075, true);
  const intake = stream(IN_PATH, 2, 7, 0.92, 0.06, false);
  const streams = [exhaust, intake];
  const dP = new THREE.Vector3(), pos = new THREE.Vector3(), tan = new THREE.Vector3(),
    side = new THREE.Vector3(), camR = new THREE.Vector3(), camU = new THREE.Vector3(),
    q = new THREE.Quaternion(), qz = new THREE.Quaternion(), sc = new THREE.Vector3(),
    m4 = new THREE.Matrix4(), tmpC = new THREE.Color(), Z = new THREE.Vector3(0, 0, 1);
  return {
    // cleanT: 0 = fully greased system, 1 = every part wiped clean.
    update(time, on, cleanT, camera) {
      for (const s of streams) s.mesh.visible = on;
      if (!on || !camera) return;
      camR.setFromMatrixColumn(camera.matrixWorld, 0);
      camU.setFromMatrixColumn(camera.matrixWorld, 1);
      for (const s of streams) {
        for (let k = 0; k < s.path.length; k++) {
          const [pid, x, y, z] = s.path[k];
          s.pts[k].set(x, y, z);
          if (pid && parts[pid]) {
            dP.copy(parts[pid].group.position).sub(parts[pid].home);
            s.pts[k].add(dP);
          }
        }
        s.curve.updateArcLengths();
        const isEx = s === exhaust;
        for (let i = 0; i < s.n; i++) {
          const d = s.meta[i];
          const u = (time * s.speed * d.v + d.phase) % 1;
          pos.copy(s.curve.getPointAt(u));
          tan.copy(s.curve.getTangentAt(u)).normalize();
          // parallel lanes offset perpendicular to the flow, breathing slightly
          side.crossVectors(tan, UP);
          if (side.lengthSq() < 1e-4) side.set(1, 0, 0); else side.normalize();
          const laneAmp = 0.10 + Math.sin(u * Math.PI) * 0.05;
          pos.addScaledVector(side, d.lane * laneAmp + d.jx * 0.05);
          pos.y += d.jz * 0.045;
          if (isEx && s.plume) {
            const spread = Math.max(0, (u - 0.86) / 0.14);
            pos.x += d.jx * spread * 1.0; pos.z += d.jz * spread * 1.0;
          }
          // billboard: face the camera, +X aligned with the screen-space flow direction
          const ang = Math.atan2(tan.dot(camU), tan.dot(camR));
          q.copy(camera.quaternion).multiply(qz.setFromAxisAngle(Z, ang));
          const grow = sstep(0, 0.05, u) * (1 - sstep(0.92, 1, u));
          sc.set(grow, grow, grow);
          m4.compose(pos, q, sc);
          s.mesh.setMatrixAt(i, m4);
          // greased amber -> pure blue as the system gets cleaned, arrow by arrow
          if (isEx) tmpC.copy(EX_DIRTY).lerp(EX_CLEAN, clamp01(cleanT + (d.tint - 1) * 0.15)).multiplyScalar(d.tint);
          else tmpC.copy(IN_COLOR).multiplyScalar(d.tint);
          s.mesh.setColorAt(i, tmpC);
        }
        s.mesh.instanceMatrix.needsUpdate = true;
        if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
      }
    }
  };
}

// ---------- camera path ----------
const CAMS = [
  { pos: V3(4.6, 2.6, 6.4), tgt: V3(0, 2.1, 0) },          // open image (3D hidden behind it)
  { pos: V3(4.6, 2.6, 6.4), tgt: V3(0, 2.1, 0) },          // intro video (3D hidden behind it)
  { pos: V3(4.6, 2.6, 6.4), tgt: V3(0, 2.1, 0) },          // hero
  { pos: V3(6.4, 3.4, 7.6), tgt: V3(0.2, 2.4, 0) },        // explode
  { pos: V3(2.4, 3.4, 4.6), tgt: V3(0, 3.15, 0) },         // canopy (exploded +1.15)
  { pos: V3(1.7, 2.5, 3.9), tgt: V3(0, 2.5, 0.9) },       // filters
  { pos: V3(3.7, 2.5, 2.9), tgt: V3(2.2, 2.25, 0.1) },     // fire
  { pos: V3(3.9, 3.6, 3.4), tgt: V3(1.6, 3.7, 0) },        // duct
  { pos: V3(2.3, 5.9, 3.3), tgt: V3(0, 5.5, 0) },          // fan
  { pos: V3(-4.6, 5.2, 3.8), tgt: V3(-3.3, 4.9, 0) },      // mua
  { pos: V3(5.6, 3.2, 7.0), tgt: V3(0, 2.3, 0) },          // rebuild
  { pos: V3(3.8, 2.9, 6.8), tgt: V3(-0.1, 2.5, 0) },       // finale
  { pos: V3(3.8, 2.9, 6.8), tgt: V3(-0.1, 2.5, 0) },       // outro video (3D hidden behind it)
  { pos: V3(3.8, 2.9, 6.8), tgt: V3(-0.1, 2.5, 0) },       // end image
];

// ---------- flowing mesh gradient background (zero-dep WebGL shader) ----------
const MESH_FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uPhase; uniform float uSwirl;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ return 0.6*noise(p) + 0.28*noise(p*2.1+5.2) + 0.12*noise(p*4.3+9.7); }
void main(){
  float t = uPhase;
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / min(uRes.x, uRes.y);
  // swirl distortion (vortex around a slowly wandering center)
  vec2 sc = 0.3*vec2(sin(t*0.11), cos(t*0.09));
  vec2 q = uv - sc;
  float r = length(q);
  float ang = uSwirl * exp(-r*1.6) * (0.8*sin(t*0.13) + 1.0);
  float ca = cos(ang), sa = sin(ang);
  vec2 p = sc + mat2(ca,-sa,sa,ca)*q;
  // organic noise warp
  p += 0.22*vec2(fbm(p*1.7 + t*0.05) - 0.5, fbm(p*1.7 - t*0.06 + 3.1) - 0.5);
  // color spots on drifting trajectories
  vec3 acc = vec3(0.0); float wsum = 0.0;
  vec2 sp; float w;
  sp = vec2(-0.55,0.42) + 0.24*vec2(sin(t*0.21), cos(t*0.17));
  w = 1.0/pow(length(p-sp)+0.06, 2.4); acc += w*vec3(0.957,0.973,0.984); wsum += w;
  sp = vec2(0.62,0.45) + 0.28*vec2(sin(t*0.16+2.1), cos(t*0.22+1.2));
  w = 1.0/pow(length(p-sp)+0.06, 2.4); acc += w*vec3(0.843,0.902,0.941); wsum += w;
  sp = vec2(0.05,-0.12) + 0.34*vec2(sin(t*0.13+4.2), cos(t*0.19+3.3));
  w = 1.0/pow(length(p-sp)+0.06, 2.4); acc += w*vec3(0.663,0.796,0.878); wsum += w;
  sp = vec2(-0.62,-0.4) + 0.3*vec2(sin(t*0.18+1.0), cos(t*0.14+5.1));
  w = 1.0/pow(length(p-sp)+0.06, 2.4); acc += w*vec3(0.498,0.659,0.816); wsum += w;
  sp = vec2(0.55,-0.5) + 0.26*vec2(sin(t*0.24+5.6), cos(t*0.11+0.4));
  w = 0.6/pow(length(p-sp)+0.07, 2.4); acc += w*vec3(0.243,0.435,0.651); wsum += w;
  sp = vec2(0.0,0.62) + 0.22*vec2(sin(t*0.15+3.0), cos(t*0.2+2.2));
  w = 1.0/pow(length(p-sp)+0.06, 2.4); acc += w*vec3(0.914,0.933,0.949); wsum += w;
  sp = vec2(-0.15,-0.72) + 0.2*vec2(sin(t*0.1+0.7), cos(t*0.16+4.4));
  w = 0.4/pow(length(p-sp)+0.08, 2.4); acc += w*vec3(0.153,0.294,0.427); wsum += w;
  vec3 col = acc / wsum;
  col = mix(col, vec3(0.955,0.968,0.978), 0.2); // keep it airy for legibility
  col += (hash(gl_FragCoord.xy + fract(t)*7.0) - 0.5) * 0.028; // grain mix
  gl_FragColor = vec4(col, 1.0);
}`;
function MeshGradientBG({ speed, swirl }) {
  const cnv = React.useRef(null);
  const pr = React.useRef({ speed, swirl }); pr.current = { speed, swirl };
  React.useEffect(() => {
    const c = cnv.current;
    const gl = c.getContext('webgl', { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) return;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, 'attribute vec2 aPos; void main(){ gl_Position = vec4(aPos,0.,1.); }');
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, MESH_FRAG); gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) { console.warn('mesh shader:', gl.getShaderInfoLog(fs)); return; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'uRes'), uPhase = gl.getUniformLocation(prog, 'uPhase'), uSwirl = gl.getUniformLocation(prog, 'uSwirl');
    let raf, phase = 0, last = performance.now(), disposed = false;
    const resize = () => { c.width = window.innerWidth; c.height = window.innerHeight; gl.viewport(0, 0, c.width, c.height); };
    resize(); window.addEventListener('resize', resize);
    const loop = (now) => {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      phase += dt * (pr.current.speed ?? 0.8);
      gl.uniform2f(uRes, c.width, c.height);
      gl.uniform1f(uPhase, phase);
      gl.uniform1f(uSwirl, pr.current.swirl ?? 0.6);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(loop);
    return () => { disposed = true; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={cnv} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}></canvas>;
}

// ---------- award-site UI pieces ----------
function splitAccent(text) {
  const out = [];
  text.split('*').forEach((chunk, ci) => {
    const accent = ci % 2 === 1;
    chunk.split(' ').forEach(w => { if (w !== '') out.push({ w, accent }); });
  });
  return out;
}
function RevealTitle({ text, active, size }) {
  const words = React.useMemo(() => splitAccent(text), [text]);
  const rootRef = React.useRef(null);
  const entered = React.useRef(false);
  React.useEffect(() => {
    const spans = rootRef.current ? rootRef.current.querySelectorAll('[data-w]') : [];
    if (!spans.length) return;
    const g = gsap;
    if (!g) { spans.forEach((el, i) => { el.style.transition = `transform .85s cubic-bezier(.19,1,.22,1) ${80 + i * 65}ms`; el.style.transform = active ? 'translateY(0)' : 'translateY(115%)'; }); return; }
    if (!active && !entered.current) return;
    g.killTweensOf(spans);
    if (active) { entered.current = true; g.fromTo(spans, { yPercent: 118, y: 0, rotate: 5 }, { yPercent: 0, y: 0, rotate: 0, duration: 1.2, ease: 'expo.out', stagger: 0.07, delay: 0.1 }); }
    else g.to(spans, { yPercent: -118, y: 0, duration: 0.6, ease: 'power2.inOut', stagger: 0.04 });
  }, [active]);
  return <div ref={rootRef} style={{ fontWeight: 800, fontSize: size, lineHeight: 1.04, letterSpacing: '-0.015em' }}>
    {words.map((it, i) => (
      <span key={i} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.1em', marginBottom: '-0.1em' }}>
        <span data-w="1" style={{
          display: 'inline-block', whiteSpace: 'pre', transformOrigin: '0% 100%',
          fontFamily: it.accent ? "'Instrument Serif',serif" : 'inherit',
          fontStyle: it.accent ? 'italic' : 'normal',
          fontWeight: it.accent ? 400 : 800,
          fontSize: it.accent ? '1.06em' : '1em',
          color: it.accent ? '#3E6FA6' : 'inherit',
          transform: 'translateY(118%)',
        }}>{it.w + (i < words.length - 1 ? ' ' : '')}</span>
      </span>
    ))}
  </div>;
}
function RevealBlock({ active, delay = 0, mask, style, children }) {
  const r = React.useRef(null);
  const enteredB = React.useRef(false);
  React.useEffect(() => {
    const el = r.current; if (!el) return;
    const g = gsap;
    if (!g) { el.style.opacity = active ? 1 : 0; el.style.transform = active ? 'none' : 'translateY(24px)'; el.style.visibility = active ? 'visible' : 'hidden'; return; }
    if (!active && !enteredB.current) return;
    if (active) enteredB.current = true;
    g.killTweensOf(el);
    if (mask) {
      if (active) g.fromTo(el, { yPercent: 118, y: 0 }, { yPercent: 0, y: 0, duration: 0.95, ease: 'expo.out', delay });
      else g.to(el, { yPercent: -118, y: 0, duration: 0.45, ease: 'power2.in' });
    } else {
      if (active) g.fromTo(el, { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.95, ease: 'expo.out', delay });
      else g.to(el, { y: -16, autoAlpha: 0, duration: 0.4, ease: 'power2.in' });
    }
  }, [active]);
  return <div ref={r} style={{ ...style, opacity: mask ? 1 : 0, transform: mask ? 'translateY(118%)' : 'translateY(30px)' }}>{children}</div>;
}
function RevealList({ active, items, delay = 0.45 }) {
  const r = React.useRef(null);
  const ent = React.useRef(false);
  React.useEffect(() => {
    const rows = r.current ? r.current.children : [];
    if (!rows.length) return;
    const g = gsap;
    if (!g) { for (const row of rows) { row.style.opacity = active ? 1 : 0; } return; }
    if (!active && !ent.current) return;
    if (active) ent.current = true;
    g.killTweensOf(rows);
    if (active) g.fromTo(rows, { x: -16, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.6, ease: 'expo.out', stagger: 0.07, delay });
    else g.to(rows, { x: -10, autoAlpha: 0, duration: 0.3, ease: 'power2.in', stagger: 0.02 });
  }, [active]);
  return <div ref={r} style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 9 }}>
    {items.map((it, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: 0 }}>
        <span style={{ width: 7, height: 7, background: 'transparent', border: '1.5px solid #3E6FA6', flexShrink: 0 }}></span>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, letterSpacing: '.04em', color: '#37424d', whiteSpace: 'nowrap' }}>{it}</span>
      </div>
    ))}
  </div>;
}
function WipeBtn({ label, primary, small, onClick }) {
  const [h, setH] = React.useState(false);
  const ref = React.useRef(null);
  const onMove = (e) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    el.style.transform = `translate(${dx * 0.18}px, ${dy * 0.3}px)`;
  };
  const onLeave = () => { setH(false); const el = ref.current; if (el) el.style.transform = 'translate(0,0)'; };
  return <div ref={ref} data-hover="1" onClick={onClick} onMouseEnter={() => setH(true)} onMouseMove={onMove} onMouseLeave={onLeave}
    style={{ position: 'relative', overflow: 'hidden', display: 'inline-block', padding: small ? '10px 18px' : '14px 28px', borderRadius: 3, cursor: 'pointer', fontWeight: 700, fontSize: small ? 13.5 : 15, userSelect: 'none', transition: 'transform .3s cubic-bezier(.22,1,.36,1)', background: primary ? '#1a2129' : 'transparent', border: primary ? 'none' : '1.5px solid #1a2129' }}>
    <div style={{ position: 'absolute', inset: 0, background: '#3E6FA6', transform: h ? 'translateY(0)' : 'translateY(101%)', transition: 'transform .45s cubic-bezier(.19,1,.22,1)' }}></div>
    <span style={{ position: 'relative', zIndex: 1, color: primary ? '#f2f5f8' : (h ? '#fff' : '#1a2129'), transition: 'color .3s' }}>{label}</span>
  </div>;
}
function grainURL() {
  const c = document.createElement('canvas'); c.width = 120; c.height = 120;
  const g = c.getContext('2d'), d = g.createImageData(120, 120);
  for (let i = 0; i < d.data.length; i += 4) { const v = 90 + Math.random() * 120; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 26; }
  g.putImageData(d, 0, 0);
  return c.toDataURL();
}

function Hood3DExperience() {
  const tw = TWEAKS;
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [loaded, setLoaded] = React.useState(false);
  const [pct, setPct] = React.useState(0);
  const [grain, setGrain] = React.useState('');
  const mountRef = React.useRef(null);
  const capRefs = React.useRef([]);
  const dotRefs = React.useRef([]);
  const uiRefs = React.useRef({});
  const hoverRef = React.useRef(false);
  const stateRef = React.useRef({ target: 0, cur: 0, ai: 0, rx: -100, ry: -100, hs: 1, uy: 0, up: 0, uyV: 0, upV: 0 });
  const twRef = React.useRef(tw); twRef.current = tw;

  React.useEffect(() => {
    setGrain(grainURL());
    let v = 0; const id = setInterval(() => {
      v = Math.min(100, v + 2.5 + Math.random() * 8); setPct(Math.floor(v));
      if (v >= 100) { clearInterval(id); setTimeout(() => setLoaded(true), 300); }
    }, 60);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    let raf, disposed = false, renderer, scene, camera, parts, flow, fanWheel, flames, pickMeshes, hoverPid = null;
    const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
    const drag = { on: false, x: 0, y: 0, moved: 0 };
    function onPD(e) { if (e.pointerType === 'mouse' && e.button !== 0) return; if (e.target && e.target.closest && e.target.closest('[data-hover], header, a, button, input, textarea, select, label')) return; drag.on = true; drag.moved = 0; drag.x = e.clientX; drag.y = e.clientY; const st = stateRef.current; st.uyV = 0; st.upV = 0; }
    function onPM(e) {
      if (!drag.on) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      const st = stateRef.current;
      st.uyV = dx * 0.0045; st.upV = dy * 0.0032;
      st.uy += st.uyV; st.up = Math.max(-0.4, Math.min(0.5, st.up + st.upV));
    }
    function onPU() { drag.on = false; }
    function init() {
      if (disposed) return;
      const el = mountRef.current;
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      el.appendChild(renderer.domElement);
      el.style.touchAction = 'pan-y';
      window.addEventListener('pointerdown', onPD);
      window.addEventListener('pointermove', onPM);
      window.addEventListener('pointerup', onPU);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 60);
      const env = makeEnvTexture(renderer);

      const hemi = new THREE.HemisphereLight(0xf2f5f8, 0x9aa2ab, 0.75); scene.add(hemi);
      const key = new THREE.DirectionalLight(0xffffff, 1.15);
      key.position.set(5, 8, 6); key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -6; key.shadow.camera.right = 6;
      key.shadow.camera.top = 8; key.shadow.camera.bottom = -2;
      key.shadow.bias = -0.0004;
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xdbe6f2, 0.5); rim.position.set(-6, 4, -4); scene.add(rim);

      const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.22 }));
      ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
      const floorTint = new THREE.Mesh(new THREE.CircleGeometry(6.5, 48), new THREE.MeshBasicMaterial({ color: 0xd8e5ee, transparent: true, opacity: 0.5 }));
      floorTint.rotation.x = -Math.PI / 2; floorTint.position.y = -0.005; scene.add(floorTint);

      const T = {};
      parts = buildScene(scene, env, T);
      fanWheel = T.fanWheel;
      flames = T.flames || [];
      pickMeshes = T.pickMeshes || [];
      flow = buildFlowArrows(scene, parts);

      window.addEventListener('resize', onResize);
      window.addEventListener('mousemove', onMouse);
      loop(0);
    }
    function onResize() {
      if (!renderer) return;
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    }
    function onMouse(e) {
      mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
      mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
      mouse.px = e.clientX; mouse.py = e.clientY;
    }
    function sectionLocal(P, i) { return clamp01(P * N - i); }
    function loop(tms) {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      const time = tms / 1000;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      stateRef.current.target = max > 0 ? clamp01(window.scrollY / max) : 0;
      const st = stateRef.current;
      // frame-rate-independent easing: identical feel at 60Hz, no extra lag at 120/144Hz
      const dtl = Math.min(0.05, (tms - (st.lastT ?? tms)) / 1000); st.lastT = tms;
      st.cur = lerp(st.cur, st.target, 1 - Math.pow(1 - 0.075, dtl * 60));
      const P = st.cur;
      mouse.sx = lerp(mouse.sx, mouse.x, 0.05);
      mouse.sy = lerp(mouse.sy, mouse.y, 0.05);
      const t = twRef.current || {};
      const grease = t.grease ?? 1;

      // explode factor
      const E = sstep(0, 1, sectionLocal(P, 3)) * (1 - sstep(0.05, 0.9, sectionLocal(P, 10)));
      // per-part
      const partSec = PART_SEC;
      Object.entries(parts).forEach(([id, p]) => {
        const e = id === 'range' ? E * 0.5 : E;
        const eo = Easing_outBack(e);
        p.group.position.set(p.home.x + p.off.x * eo, p.home.y + p.off.y * eo, p.home.z + p.off.z * eo);
        const baseDirt = (id === 'range' ? 0 : id === 'mua' ? 0.55 : 1) * grease;
        p.u.uDirt.value = baseDirt;
        let wipe = 0;
        if (partSec[id] != null) wipe = sstep(0.22, 0.8, sectionLocal(P, partSec[id]));
        else wipe = sstep(0.15, 0.75, sectionLocal(P, 10)); // range cleans during rebuild
        p.u.uWipe.value = wipe;
        const dx = p.group.position.x - p.home.x;
        p.u.uXmin.value = p.bbMin + dx; p.u.uXmax.value = p.bbMax + dx;
      });
      // floating drift while exploded
      Object.entries(parts).forEach(([id, p], i) => {
        p.group.position.y += E * Math.sin(time * 0.8 + i * 1.7) * 0.02;
      });

      // camera
      const segF = clamp01(P) * (N - 1);
      const i0 = Math.min(N - 2, Math.floor(segF));
      const f = sstep(0, 1, segF - i0);
      const pos = CAMS[i0].pos.clone().lerp(CAMS[i0 + 1].pos, f);
      const tgt = CAMS[i0].tgt.clone().lerp(CAMS[i0 + 1].tgt, f);
      // idle drift at hero & finale (video/end sections keep the finale drift, hidden)
      const idle = (1 - sstep(2.1, 2.7, segF)) + sstep(10.1, 10.65, segF);
      pos.x += Math.sin(time * 0.22) * 0.35 * idle;
      pos.y += Math.sin(time * 0.17) * 0.14 * idle;
      pos.x += mouse.sx * 0.32; pos.y -= mouse.sy * 0.22;
      // user orbit (drag to rotate; eases back as you scroll)
      const stO = stateRef.current;
      if (!drag.on) {
        stO.uy += stO.uyV; stO.up = Math.max(-0.4, Math.min(0.5, stO.up + stO.upV));
        stO.uyV *= 0.9; stO.upV *= 0.9;
        const decay = Math.abs(st.target - st.cur) > 0.0005 ? 0.9 : 0.995;
        stO.uy *= decay; stO.up *= decay;
      }
      if (Math.abs(stO.uy) > 0.0001 || Math.abs(stO.up) > 0.0001) {
        const off = pos.clone().sub(tgt);
        off.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -stO.uy));
        const right = new THREE.Vector3().crossVectors(off, new THREE.Vector3(0, 1, 0)).normalize();
        off.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(right, stO.up));
        pos.copy(tgt).add(off);
      }
      camera.position.copy(pos);
      camera.lookAt(tgt);

      // fan motor always running
      if (fanWheel) fanWheel.rotation.y = time * 7;
      // gas flames flicker (hide while exploded)
      if (flames) for (let i = 0; i < flames.length; i++) {
        const fg = flames[i];
        const fl = (0.85 + 0.22 * Math.sin(time * 13 + i * 2.1) + 0.1 * Math.sin(time * 29 + i * 5.3)) * (1 - E);
        fg.visible = fl > 0.05;
        fg.scale.set(1, Math.max(0.001, fl), 1);
      }

      // airflow arrows — always on; air purity tracks how much of the system is clean
      let cleanT = 0;
      ORDER3D.forEach(id => { cleanT += parts[id].u.uWipe.value; });
      cleanT /= ORDER3D.length;
      flow.update(time, t.airflow !== false, cleanT, camera);

      // video intro/outro + final-image fades
      {
        const UV = uiRefs.current;
        const pn0 = P * N;
        // story bookends: open on the clean kitchen, fade into the greasy
        // reality video, and return to the same clean image at the end.
        const openVo = 1 - sstep(0.5, 1.05, pn0);
        const introVo = sstep(0.45, 0.95, pn0) * (1 - sstep(1.55, 2.0, pn0));
        const outroVo = sstep(11.5, 12.05, pn0);
        if (UV.openImg) UV.openImg.style.opacity = openVo.toFixed(3);
        if (UV.vidIntro && UV.vidIntroEl) {
          UV.vidIntro.style.opacity = introVo.toFixed(3);
          const el = UV.vidIntroEl;
          // scroll scrubs the clip across its visible window (pn 0.6 -> 1.9)
          if (introVo > 0.02 && el.duration) scrubVideo(el, clamp01((pn0 - 0.6) / 1.3) * (el.duration - 0.05));
        }
        if (UV.vidOutro && UV.vidOutroEl) {
          UV.vidOutro.style.opacity = outroVo.toFixed(3);
          const el = UV.vidOutroEl;
          // scrubs from when it appears until the end image has taken over
          if (outroVo > 0.02 && el.duration) scrubVideo(el, clamp01((pn0 - 11.6) / 1.3) * (el.duration - 0.05));
        }
        if (UV.endImg) UV.endImg.style.opacity = sstep(12.35, 13.35, pn0).toFixed(3);
        // when a video/image fully covers the viewport, skip the WebGL draw
        st.mediaCover = openVo > 0.985 || introVo > 0.985 || outroVo > 0.985;
      }

      // captions + dots
      SECTIONS.forEach((s, i) => {
        const el = capRefs.current[i]; if (!el) return;
        const center = (i + 0.5) / N;
        const d = Math.abs(P - center) * N;
        const vis = i === 0 ? clamp01(1 - (P * N - 0.18) / 0.6) : i === N - 1 ? clamp01((P * N - (N - 1)) / 0.55) : clamp01(1.28 - d * 1.32);
        el.style.opacity = vis.toFixed(3);
        el.style.transform = `translate(0, calc(-50% + ${((1 - vis) * 26).toFixed(1)}px))`;
        el.style.pointerEvents = vis > 0.5 ? 'auto' : 'none';
        const dot = dotRefs.current[i];
        if (dot) { dot.style.background = d < 0.5 ? '#3E6FA6' : 'rgba(30,40,50,.25)'; dot.style.transform = d < 0.5 ? 'scale(1.45)' : 'scale(1)'; }
      });

      // ---- award-site UI drivers ----
      const U = uiRefs.current, st2 = stateRef.current;
      const vel = Math.abs(st2.target - st2.cur);
      const pn = P * N;
      const ai = Math.max(0, Math.min(N - 1, Math.floor(pn)));
      if (st2.ai !== ai) { st2.ai = ai; setActiveIdx(ai); }
      if (U.bar) U.bar.style.width = `${(P * 100).toFixed(2)}%`;
      if (U.cnt) U.cnt.textContent = `${String(ai + 1).padStart(2, '0')} / ${String(N).padStart(2, '0')} — ${SECTIONS[ai].id.toUpperCase()}`;
      if (U.mark) { const mo = sstep(0.15, 0.6, sectionLocal(P, 11)) * (1 - sstep(0.4, 0.9, sectionLocal(P, 12))); U.mark.style.opacity = (mo * 0.9).toFixed(3); U.mark.style.transform = `translateY(${((1 - mo) * 40).toFixed(1)}px)`; }
      const mdrift = time * 150 + P * 1100;
      if (U.mAin) {
        const w = U.mAin.scrollWidth / 2 || 1;
        U.mAin.style.transform = `translateX(${-((mdrift + vel * 3000) % w).toFixed(1)}px)`;
        U.mA.style.opacity = (sstep(2.72, 3.05, pn) * (1 - sstep(3.75, 4.15, pn))).toFixed(3);
      }
      if (U.mBin) {
        const w = U.mBin.scrollWidth / 2 || 1;
        U.mBin.style.transform = `translateX(${((mdrift * 0.8 + vel * 3000) % w - w).toFixed(1)}px)`;
        U.mB.style.opacity = (sstep(9.85, 10.35, pn) * (1 - sstep(11.1, 11.5, pn))).toFixed(3);
      }

      // hover raycast + part highlight — only while the 3D model is the visible
      // layer (not under the intro/outro videos or the end image)
      const modelLayerActive = pn > 1.9 && pn < 11.7;
      if (modelLayerActive && pickMeshes && pickMeshes.length && !drag.on && mouse.px != null) {
        const rc = stateRef.current._rc || (stateRef.current._rc = new THREE.Raycaster());
        rc.setFromCamera({ x: (mouse.px / window.innerWidth) * 2 - 1, y: -(mouse.py / window.innerHeight) * 2 + 1 }, camera);
        const hit = rc.intersectObjects(pickMeshes, false)[0];
        const pid = hit ? hit.object.userData.pid : null;
        if (pid !== hoverPid) {
          if (hoverPid && parts[hoverPid]) parts[hoverPid].mats.forEach(m => m.emissive && m.emissive.setHex(0x000000));
          hoverPid = pid;
          if (hoverPid && parts[hoverPid]) parts[hoverPid].mats.forEach(m => m.emissive && m.emissive.setHex(0x0e2438));
        }
      } else if (hoverPid) {
        if (parts[hoverPid]) parts[hoverPid].mats.forEach(m => m.emissive && m.emissive.setHex(0x000000));
        hoverPid = null;
      }
      // 3D part labels (appear on the active cleaning section, on explode, or on hover)
      {
        const shown = st2.lblShown || (st2.lblShown = {});
        const showSet = {};
        if (ai === 3 && E > 0.35) ORDER3D.forEach(id => { if (id !== 'range') showSet[id] = 1; });
        else Object.entries(PART_SEC).forEach(([id, sIdx]) => { if (sIdx === ai) showSet[id] = 1; });
        if (hoverPid) showSet[hoverPid] = 1;
        const w = window.innerWidth, h = window.innerHeight;
        ORDER3D.forEach((id, li) => {
          const root = U['lbl_' + id]; const p = parts[id];
          if (!root || !p) return;
          const a = ANCHOR3D[id];
          const v = new THREE.Vector3(a[0] + p.group.position.x - p.home.x, a[1] + p.group.position.y - p.home.y, a[2] + p.group.position.z - p.home.z).project(camera);
          const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
          const flip = sx > w * 0.7;
          root.style.flexDirection = flip ? 'row-reverse' : 'row';
          const ln = U['lbn_' + id]; if (ln) ln.style.transformOrigin = flip ? '100% 50%' : '0% 50%';
          root.style.transform = `translate(${(flip ? sx - 6 - root.offsetWidth + 12 : sx - 6).toFixed(1)}px, ${(sy - 6).toFixed(1)}px)`;
          const show = !!showSet[id] && v.z < 1;
          if (show !== !!shown[id]) {
            shown[id] = show;
            const g2 = gsap, dot = U['lbd_' + id], chip = U['lbc_' + id];
            if (g2 && dot && chip && ln) {
              g2.killTweensOf([root, dot, ln, chip]);
              if (show) {
                g2.set(root, { autoAlpha: 1 });
                g2.fromTo(dot, { scale: 0 }, { scale: 1, duration: 0.45, ease: 'back.out(2.2)', delay: li * 0.05 });
                g2.fromTo(ln, { scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: 'power2.out', delay: 0.12 + li * 0.05 });
                g2.fromTo(chip, { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.55, ease: 'expo.out', delay: 0.2 + li * 0.05 });
              } else g2.to(root, { autoAlpha: 0, duration: 0.28, ease: 'power2.in' });
            } else { root.style.opacity = show ? 1 : 0; root.style.visibility = show ? 'visible' : 'hidden'; }
          }
          const stat = U['lbs_' + id];
          if (stat && show) {
            const wp = p.u.uWipe.value;
            stat.textContent = id === 'range' ? 'STAYS CLEAN' : wp <= 0.01 ? 'GREASED' : wp >= 0.99 ? 'CLEAN — BARE METAL' : 'DEGREASING…';
          }
        });
      }

      if (U.rot) U.rot.style.opacity = ((pn > 2.85 && pn < 10.6) ? 0.85 : 0).toFixed(2);

      if (!st.mediaCover) renderer.render(scene, camera);
    }
    function Easing_outBack(x) { const c1 = 1.20158, c3 = c1 + 1; return x <= 0 ? 0 : x >= 1 ? 1 : 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
    init();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('pointermove', onPM);
      window.removeEventListener('pointerup', onPU);
      window.removeEventListener('pointerdown', onPD);
      if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
    };
  }, []);

  React.useEffect(() => {
    if (!loaded) return;
    window.scrollTo(0, 0);
    if (gsap) gsap.fromTo('[data-hdr]', { y: -28, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1, ease: 'expo.out', stagger: 0.09, delay: 0.25 });
  }, [loaded]);

  const completedRef = React.useRef(false);
  React.useEffect(() => {
    if (!loaded) return;
    track('section_viewed', { section_id: SECTIONS[activeIdx].id, section_index: activeIdx });
    if (activeIdx === N - 1 && !completedRef.current) {
      completedRef.current = true;
      track('experience_completed');
    }
  }, [activeIdx, loaded]);

  const scrollToSec = (i) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: ((i + 0.5) / N) * max, behavior: 'smooth' });
  };

  const capStyle = (s) => ({
    position: 'absolute', top: '50%', transform: 'translate(0, -50%)',
    left: s.side === 'left' ? 'clamp(24px,7vw,120px)' : s.side === 'center' ? '50%' : 'auto',
    right: s.side === 'right' ? 'clamp(24px,7vw,120px)' : 'auto',
    maxWidth: s.side === 'center' ? 1000 : 600,
    marginLeft: s.side === 'center' ? 'max(-500px,-46vw)' : 0,
    width: s.side === 'center' ? '90vw' : 'auto',
    textAlign: s.side === 'center' ? 'center' : 'left',
    opacity: 0, transition: 'opacity .15s linear',
  });

  return (
    <div style={{ fontFamily: "'Archivo',sans-serif", color: '#1a2129' }}
      onMouseOver={(e) => { if (e.target.closest && e.target.closest('[data-hover]')) hoverRef.current = true; }}
      onMouseOut={(e) => { if (e.target.closest && e.target.closest('[data-hover]')) hoverRef.current = false; }}>
      <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(180deg, #f3f8fb 0%, #e4eef5 42%, #cfe2ee 70%, #b3d0e2 100%)', zIndex: 0, overflow: 'hidden' }}>
        <MeshGradientBG speed={tw.bgSpeed ?? 0.8} swirl={tw.bgSwirl ?? 0.6} />
        <div ref={(el) => { uiRefs.current.mark = el; }} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '15.5vw', letterSpacing: '-0.02em', color: 'transparent', WebkitTextStroke: '2px rgba(30,42,54,.22)', opacity: 0, userSelect: 'none' }}>VENTWASH</div>
      </div>
      <div ref={mountRef} style={{ position: 'fixed', inset: 0, zIndex: 1 }}></div>

      {/* story videos + end card (opacity scroll-driven in the render loop) */}
      <div ref={(el) => { uiRefs.current.vidIntro = el; }} style={{ position: 'fixed', inset: 0, zIndex: 3, opacity: 0, pointerEvents: 'none' }}>
        <video ref={(el) => { uiRefs.current.vidIntroEl = el; }} src={VIDEO_SRC.intro} muted playsInline preload="auto"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(234,242,248,.88) 0%, rgba(234,242,248,.55) 34%, rgba(234,242,248,0) 62%)' }}></div>
      </div>
      <div ref={(el) => { uiRefs.current.vidOutro = el; }} style={{ position: 'fixed', inset: 0, zIndex: 3, opacity: 0, pointerEvents: 'none' }}>
        <video ref={(el) => { uiRefs.current.vidOutroEl = el; }} src={VIDEO_SRC.outro} muted playsInline preload="auto"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(234,242,248,.88) 0%, rgba(234,242,248,.55) 34%, rgba(234,242,248,0) 62%)' }}></div>
      </div>
      <div ref={(el) => { uiRefs.current.endImg = el; }} style={{ position: 'fixed', inset: 0, zIndex: 3, opacity: 0, pointerEvents: 'none' }}>
        <img src={END_IMG} alt="Freshly cleaned commercial kitchen — hood, duct and rooftop fan spotless" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 55%, rgba(234,242,248,.72) 0%, rgba(234,242,248,.3) 45%, rgba(234,242,248,0) 75%)' }}></div>
      </div>
      <div ref={(el) => { uiRefs.current.openImg = el; }} style={{ position: 'fixed', inset: 0, zIndex: 3, opacity: 1, pointerEvents: 'none' }}>
        <img src={END_IMG} alt="Commercial kitchen with a freshly cleaned hood and exhaust system" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 55%, rgba(234,242,248,.72) 0%, rgba(234,242,248,.3) 45%, rgba(234,242,248,0) 75%)' }}></div>
      </div>

      <header style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px clamp(20px,4vw,44px)' }}>
        <div data-hdr="1" style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 19, letterSpacing: '.02em' }}>VENT<span style={{ color: '#3E6FA6' }}>WASH</span></div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, color: '#5b6570', letterSpacing: '.08em' }}>COMMERCIAL KITCHEN EXHAUST CLEANING</div>
        </div>
        <div data-hdr="1" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: '#5b6570' }}>NFPA 96 · LICENSED &amp; INSURED</div>
          <WipeBtn primary small label="Get a free quote" onClick={() => { track('quote_cta_clicked', { location: 'header' }); window.dispatchEvent(new CustomEvent('vw:quote-open')); }} />
        </div>
      </header>

      <div style={{ position: 'fixed', inset: 0, zIndex: 4, pointerEvents: 'none' }}>
        {SECTIONS.map((s, i) => {
          const act = loaded && activeIdx === i;
          return (
          <div key={s.id} ref={(el) => { capRefs.current[i] = el; }} data-screen-label={s.id} style={capStyle(s)}>
            <div style={{ overflow: 'hidden', marginBottom: 14 }}>
              <RevealBlock active={act} mask style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15, letterSpacing: '.16em', color: '#3E6FA6' }}>{s.kicker}</RevealBlock>
            </div>
            <RevealTitle text={s.title} active={act} size={s.compact ? 'clamp(36px,4.6vw,64px)' : s.side === 'center' ? 'clamp(64px,9vw,150px)' : 'clamp(44px,5.2vw,84px)'} />
            <RevealBlock active={act} delay={0.32} style={{ fontSize: s.compact ? 16.5 : s.side === 'center' ? 21 : 18.5, lineHeight: 1.55, color: '#414c57', marginTop: s.compact ? 12 : 18, maxWidth: s.compact ? 560 : s.side === 'center' ? 680 : 500, marginLeft: s.side === 'center' ? 'auto' : 0, marginRight: s.side === 'center' ? 'auto' : 0 }}>{s.body}</RevealBlock>
            {s.items ? <RevealList active={act} items={s.items} /> : null}
            {s.cta ? <RevealBlock active={act} delay={0.5} style={{ marginTop: 30, pointerEvents: 'auto' }}>
              <div style={{ display: 'inline-flex', gap: 12 }}>
                <WipeBtn primary label="Get a free quote" onClick={() => { track('quote_cta_clicked', { location: 'finale' }); window.dispatchEvent(new CustomEvent('vw:quote-open')); }} />
                <WipeBtn label="Call (973) 291-9726" onClick={() => { track('call_cta_clicked', { location: 'finale' }); window.location.href = 'tel:+19732919726'; }} />
                <WipeBtn label="WhatsApp us" onClick={() => { track('whatsapp_cta_clicked', { location: 'finale' }); window.open('https://wa.me/17868609286?text=' + encodeURIComponent('Hi VentWash — I\'d like a quote for kitchen hood cleaning.'), '_blank', 'noopener'); }} />
              </div>
              <div style={{ marginTop: 24, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, letterSpacing: '.08em', color: '#4c5661' }}>NFPA 96 COMPLIANT · PHOTO REPORTS · SERVICE STICKERS · AFTER-HOURS CREWS</div>
              <div style={{ marginTop: 18, fontStyle: 'italic', fontSize: 17, color: '#414c57', maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>“They don’t just clean — every system is documented for our inspections. Passed the fire marshal without a note.” <span style={{ fontStyle: 'normal', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5, color: '#5b6570' }}>— RESTAURANT GM</span></div>
            </RevealBlock> : null}
            {s.endCta ? <RevealBlock active={act} delay={0.5} style={{ marginTop: 20, pointerEvents: 'auto' }}>
              <div style={{ display: 'inline-flex', gap: 12 }}>
                <WipeBtn small primary label="Get a free quote" onClick={() => { track('quote_cta_clicked', { location: 'end' }); window.dispatchEvent(new CustomEvent('vw:quote-open')); }} />
                <WipeBtn small label="Call (973) 291-9726" onClick={() => { track('call_cta_clicked', { location: 'end' }); window.location.href = 'tel:+19732919726'; }} />
              </div>
              <div style={{ marginTop: 14, fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, letterSpacing: '.08em', color: '#4c5661' }}>NFPA 96 COMPLIANT · PHOTO REPORTS · AFTER-HOURS CREWS</div>
            </RevealBlock> : null}
            {i === 0 ? <RevealBlock active={act} delay={0.85} style={{ marginTop: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5, letterSpacing: '.22em', color: '#5b6570' }}>SCROLL</div>
              <div style={{ width: 1.5, height: 44, background: 'rgba(26,33,41,.2)', overflow: 'hidden' }}>
                <div style={{ width: '100%', height: 16, background: '#3E6FA6', animation: 'vwScrollLine 1.7s cubic-bezier(.65,0,.35,1) infinite' }}></div>
              </div>
            </RevealBlock> : null}
          </div>
          );
        })}
      </div>

      <div ref={(el) => { uiRefs.current.mA = el; }} style={{ position: 'fixed', left: '-4vw', right: '-4vw', top: '15%', zIndex: 2, transform: 'rotate(-2deg)', opacity: 0, overflow: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
        <div ref={(el) => { uiRefs.current.mAin = el; }} style={{ display: 'inline-block', whiteSpace: 'nowrap', fontWeight: 800, fontSize: 'clamp(48px,6.5vw,110px)', letterSpacing: '-0.01em', WebkitTextStroke: '1.5px #33465a', color: 'transparent' }}>{(MARQ + MARQ + MARQ + MARQ) + (MARQ + MARQ + MARQ + MARQ)}</div>
      </div>
      <div ref={(el) => { uiRefs.current.mB = el; }} style={{ position: 'fixed', left: '-4vw', right: '-4vw', bottom: '11%', zIndex: 2, opacity: 0, overflow: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
        <div ref={(el) => { uiRefs.current.mBin = el; }} style={{ display: 'inline-block', whiteSpace: 'nowrap', fontWeight: 800, fontSize: 'clamp(40px,5vw,86px)', letterSpacing: '-0.01em', color: 'rgba(38,52,66,.14)' }}>{(MARQ + MARQ + MARQ + MARQ) + (MARQ + MARQ + MARQ + MARQ)}</div>
      </div>

      {/* Floating call pill — fixed, so the AI answering line is reachable from
          every section of the scroll story. Bottom-left keeps it clear of the
          section dots (right) and the header CTA (top). */}
      <a
        href="tel:+19732919726"
        onClick={() => track('call_cta_clicked', { location: 'floating' })}
        aria-label="Call VentWash at (973) 291-9726"
        className="vw-call-float"
        style={{
          position: 'fixed', left: 22, bottom: 22, zIndex: 20,
          display: 'inline-flex', alignItems: 'center', gap: 10,
          padding: '12px 18px', borderRadius: 999,
          background: '#1a2129', color: '#f3f8fb', textDecoration: 'none',
          fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5, letterSpacing: '.08em',
          boxShadow: '0 10px 30px rgba(26,33,41,.32)',
          pointerEvents: 'auto', animation: 'vwCallFloat 3.4s ease-in-out infinite',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#3E6FA6'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '#1a2129'; }}
      >
        <span style={{ position: 'relative', display: 'inline-flex', width: 18, height: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span className="vw-call-ring" style={{ position: 'absolute', inset: -4, borderRadius: '50%', border: '2px solid #3E6FA6', animation: 'vwCallRing 2.4s ease-out infinite', pointerEvents: 'none' }}></span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        </span>
        <span className="vw-call-label">(973) 291-9726</span>
      </a>

      <div style={{ position: 'fixed', right: 22, top: '50%', transform: 'translateY(-50%)', zIndex: 5, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SECTIONS.map((s, i) => (
          <div key={s.id} ref={(el) => { dotRefs.current[i] = el; }} onClick={() => scrollToSec(i)} title={s.kicker} data-hover="1"
            style={{ width: 9, height: 9, borderRadius: '50%', background: 'rgba(30,40,50,.25)', cursor: 'pointer', transition: 'transform .2s, background .2s' }}></div>
        ))}
      </div>

      {ORDER3D.map((id) => (
        <div key={id} ref={(el) => { uiRefs.current['lbl_' + id] = el; }} style={{ position: 'fixed', left: 0, top: 0, zIndex: 3, display: 'flex', alignItems: 'center', opacity: 0, visibility: 'hidden', pointerEvents: 'none' }}>
          <div ref={(el) => { uiRefs.current['lbd_' + id] = el; }} style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid #3E6FA6', background: 'rgba(243,248,251,.95)', boxShadow: '0 0 0 4px rgba(62,111,166,.15)', flexShrink: 0 }}></div>
          <div ref={(el) => { uiRefs.current['lbn_' + id] = el; }} style={{ width: 36, height: 1.5, background: '#3E6FA6', flexShrink: 0 }}></div>
          <div ref={(el) => { uiRefs.current['lbc_' + id] = el; }} style={{ background: 'rgba(16,21,27,.92)', padding: '8px 12px', borderRadius: 3 }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, fontWeight: 500, letterSpacing: '.08em', color: '#eef2f6', whiteSpace: 'nowrap' }}>{NAME3D[id]}</div>
            <div ref={(el) => { uiRefs.current['lbs_' + id] = el; }} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, letterSpacing: '.08em', color: '#8fb4da', marginTop: 2, whiteSpace: 'nowrap' }}>GREASED</div>
          </div>
        </div>
      ))}

      <div ref={(el) => { uiRefs.current.bar = el; }} style={{ position: 'fixed', left: 0, top: 0, height: 2, width: 0, background: '#3E6FA6', zIndex: 55 }}></div>
      <div ref={(el) => { uiRefs.current.cnt = el; }} style={{ position: 'fixed', left: 'clamp(20px,4vw,44px)', bottom: 20, zIndex: 5, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, letterSpacing: '.12em', color: '#4c5661' }}>01 / 10 — HERO</div>
      <div ref={(el) => { uiRefs.current.rot = el; }} style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 5, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, letterSpacing: '.18em', color: '#4c5661', opacity: 0, transition: 'opacity .4s', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', border: '1.5px solid #4c5661', position: 'relative' }}><span style={{ position: 'absolute', left: 3, top: 3, width: 5, height: 5, borderRadius: '50%', background: '#3E6FA6' }}></span></span>
        DRAG TO ROTATE · SCROLL TO CONTINUE
      </div>
      <div style={{ position: 'fixed', right: 'clamp(20px,4vw,44px)', bottom: 20, zIndex: 5, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, letterSpacing: '.12em', color: '#4c5661' }}>© 2026 VENTWASH</div>

      {grain ? <div style={{ position: 'fixed', inset: 0, zIndex: 6, pointerEvents: 'none', backgroundImage: `url(${grain})`, backgroundSize: '120px 120px', opacity: 0.5, mixBlendMode: 'multiply' }}></div> : null}

      <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: '#0f151b', color: '#e8eef4', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: loaded ? 'translateY(-100%)' : 'translateY(0)', transition: 'transform 1s cubic-bezier(.77,0,.18,1) .15s', pointerEvents: loaded ? 'none' : 'auto' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 'clamp(48px,8.5vw,120px)', letterSpacing: '-0.02em' }}>VENT<span style={{ fontFamily: "'Instrument Serif',serif", fontStyle: 'italic', fontWeight: 400, color: '#7fa8d0' }}>WASH</span></div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13.5, letterSpacing: '.24em', color: '#8fa3b5', marginTop: 12 }}>HOOD TO ROOF — BARE METAL</div>
        </div>
        <div style={{ position: 'absolute', right: 'clamp(20px,4vw,44px)', bottom: 24, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, letterSpacing: '.1em', color: '#8fa3b5' }}>{pct}%</div>
      </div>

      <div style={{ height: `${N * SEC_VH}vh`, position: 'relative', zIndex: 2 }}></div>
    </div>
  );
}

export default Hood3DExperience;
