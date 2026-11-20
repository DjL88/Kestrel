// Generates the synthetic sample photos for the website's editing demo (site/demo/).
//
// Every image is drawn from code in a headless browser canvas, so nothing here is anyone's photograph and there is
// no licence to track. For each scene it writes:
//   <id>.webp           the "camera" image: dim or flat, with sensor-like noise, so the edit sliders have work to do
//   <id>-denoised.webp  the same image without the added noise (a stand-in for a denoised result, not Kestrel's model)
//   <id>-mask.png       a white-on-black subject mask (a stand-in for subject detection, not a live model)
//   <id>-thumb.webp     a small picker thumbnail
//
// Usage: node scripts/site/generate-demo-photos.mjs   (needs `npm ci`; uses Playwright's Chromium)
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'site', 'demo', 'photos');

const pageScript = () => {
  const W = 1200, H = 800;
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const canvas = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const ellipse = (g, x, y, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); };
  const poly = (g, pts) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); g.fill(); };
  const ridge = (g, r, base, amp, step, colour) => { g.fillStyle = colour; g.beginPath(); g.moveTo(0, H); let y = base;
    for (let x = 0; x <= W + step; x += step) { y = Math.max(base - amp, Math.min(base + amp, y + (r() - 0.5) * amp * 0.9)); g.lineTo(x, y); }
    g.lineTo(W, H); g.closePath(); g.fill(); };
  const circle = (g, x, y, rad) => { g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); };

  // Each scene draws a background and a subject. `ink` replaces every subject colour when drawing the mask.
  const scenes = {
    'kestrel-dusk': {
      background(g, r) {
        const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#2b3d63'); sky.addColorStop(0.55, '#d9894a'); sky.addColorStop(0.72, '#f1c07a');
        g.fillStyle = sky; g.fillRect(0, 0, W, H);
        const sun = g.createRadialGradient(860, 540, 10, 860, 540, 220); sun.addColorStop(0, 'rgba(255,236,190,1)'); sun.addColorStop(0.25, 'rgba(255,214,150,.75)'); sun.addColorStop(1, 'rgba(255,200,140,0)');
        g.fillStyle = sun; g.fillRect(0, 0, W, H);
        ridge(g, r, 560, 40, 30, '#5a4660'); ridge(g, r, 620, 30, 24, '#3a3048'); ridge(g, r, 700, 20, 20, '#231d2a');
        g.fillStyle = '#2b211c'; g.fillRect(330, 470, 44, 340); g.fillStyle = '#3b2d25'; g.fillRect(336, 470, 10, 340);
        g.strokeStyle = '#2b211c'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 600); g.quadraticCurveTo(200, 640, 352, 590); g.quadraticCurveTo(700, 560, 1200, 640); g.stroke();
      },
      subject(g, ink) {
        const c = (v) => ink || v;
        g.fillStyle = c('#6f3c22'); poly(g, [[338, 440], [372, 440], [366, 560], [344, 560]]);
        g.fillStyle = c('#a0562d'); ellipse(g, 354, 420, 40, 66, -0.08);
        g.fillStyle = c('#dcae84'); ellipse(g, 366, 432, 22, 46, -0.1);
        g.fillStyle = c('#7a4224'); ellipse(g, 336, 418, 26, 58, -0.25);
        g.fillStyle = c('#7c7f8c'); circle(g, 362, 346, 30);
        g.fillStyle = c('#e8d9c4'); ellipse(g, 374, 356, 14, 12);
        g.fillStyle = c('#3a3a3a'); poly(g, [[388, 340], [404, 350], [388, 356]]);
        g.fillStyle = c('#121212'); circle(g, 374, 340, 5);
        g.fillStyle = c('#e7b13c'); poly(g, [[344, 478], [352, 478], [350, 474]]); poly(g, [[358, 478], [366, 478], [362, 474]]);
      },
      tone: { gain: 0.55, lift: 0.02, contrast: 0.85, cast: [1, 1, 1.04] }, noise: 15,
    },
    'highland-loch': {
      tilt: -3.2,
      background(g, r) {
        const sky = g.createLinearGradient(0, 0, 0, 470); sky.addColorStop(0, '#7ea6cf'); sky.addColorStop(1, '#e3ebf0'); g.fillStyle = sky; g.fillRect(0, 0, W, 480);
        g.fillStyle = 'rgba(255,255,255,.55)'; for (let i = 0; i < 9; i++) { ellipse(g, 120 + r() * 1000, 90 + r() * 160, 80 + r() * 90, 18 + r() * 14); }
        ridge(g, r, 330, 90, 60, '#6f7f90'); ridge(g, r, 400, 50, 40, '#4c5d6c');
        g.fillStyle = '#3c4c3a'; g.fillRect(0, 455, W, 30);
        const loch = g.createLinearGradient(0, 480, 0, H); loch.addColorStop(0, '#9cb3c4'); loch.addColorStop(1, '#2e4556'); g.fillStyle = loch; g.fillRect(0, 480, W, H - 480);
        g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 2; for (let i = 0; i < 40; i++) { const y = 500 + r() * 300, x = r() * W; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 40 + r() * 120, y); g.stroke(); }
      },
      subject(g, ink) {
        const c = (v) => ink || v;
        g.fillStyle = c('#8a3a2e'); poly(g, [[640, 560], [790, 560], [770, 590], [662, 590]]);
        g.fillStyle = c('#e9e2d3'); poly(g, [[712, 556], [712, 420], [770, 556]]);
        g.fillStyle = c('#d8cfbe'); poly(g, [[706, 556], [706, 440], [664, 556]]);
        g.fillStyle = c('#2b2b2b'); g.fillRect(708, 410, 4, 150);
      },
      tone: { gain: 0.9, lift: 0.1, contrast: 0.62, cast: [0.94, 0.99, 1.1] }, noise: 6,
    },
    'lighthouse-coast': {
      background(g, r) {
        const sky = g.createLinearGradient(0, 0, 0, 500); sky.addColorStop(0, '#8e99a5'); sky.addColorStop(1, '#d3d8dc'); g.fillStyle = sky; g.fillRect(0, 0, W, 520);
        g.fillStyle = 'rgba(70,80,92,.35)'; for (let i = 0; i < 7; i++) ellipse(g, r() * W, 60 + r() * 200, 160 + r() * 140, 30 + r() * 20);
        const sea = g.createLinearGradient(0, 500, 0, H); sea.addColorStop(0, '#5a7585'); sea.addColorStop(1, '#2d4250'); g.fillStyle = sea; g.fillRect(0, 500, W, 300);
        g.strokeStyle = 'rgba(235,240,240,.35)'; g.lineWidth = 2; for (let i = 0; i < 60; i++) { const y = 510 + r() * 290, x = r() * W; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 20 + r() * 60, y + 1); g.stroke(); }
        g.fillStyle = '#5b5040'; poly(g, [[560, 800], [620, 600], [700, 560], [1200, 540], [1200, 800]]);
        g.fillStyle = '#56703c'; poly(g, [[640, 585], [700, 556], [1200, 536], [1200, 575], [700, 590]]);
      },
      subject(g, ink) {
        const c = (v) => ink || v;
        g.fillStyle = c('#f1ede4'); poly(g, [[820, 560], [900, 560], [884, 300], [836, 300]]);
        g.fillStyle = c('#b2433f'); poly(g, [[827, 470], [893, 470], [889, 420], [831, 420]]); poly(g, [[833, 380], [887, 380], [885, 345], [835, 345]]);
        g.fillStyle = c('#2f3438'); g.fillRect(826, 290, 68, 12);
        g.fillStyle = c('#f6e7a8'); g.fillRect(838, 250, 44, 40);
        g.fillStyle = c('#2f3438'); poly(g, [[832, 252], [888, 252], [860, 222]]);
        g.fillStyle = c('#e7e1d6'); g.fillRect(900, 520, 70, 40); g.fillStyle = c('#7c3a34'); poly(g, [[896, 522], [974, 522], [935, 500]]);
      },
      tone: { gain: 0.85, lift: 0.08, contrast: 0.72, cast: [1, 1, 1] }, noise: 8,
    },
    'night-street': {
      background(g, r) {
        const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#0c0f18'); sky.addColorStop(1, '#232838'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
        g.fillStyle = '#161922'; for (let i = 0; i < 8; i++) { const x = i * 160 - 20 + r() * 30, h = 220 + r() * 260; g.fillRect(x, H - 200 - h, 130, h); }
        for (let i = 0; i < 70; i++) { g.fillStyle = r() > 0.5 ? 'rgba(255,196,110,.8)' : 'rgba(170,200,255,.55)'; g.fillRect(r() * W, 160 + r() * 380, 10, 14); }
        g.globalAlpha = 0.35; for (let i = 0; i < 26; i++) { g.fillStyle = ['#ffb35c', '#ff6f61', '#7fb8ff', '#ffe39a'][i % 4]; circle(g, r() * W, 520 + r() * 200, 14 + r() * 36); } g.globalAlpha = 1;
        g.fillStyle = '#1d1f26'; g.fillRect(0, 640, W, 160);
        const glow = g.createRadialGradient(430, 260, 4, 430, 260, 260); glow.addColorStop(0, 'rgba(255,214,150,.9)'); glow.addColorStop(1, 'rgba(255,190,120,0)'); g.fillStyle = glow; g.fillRect(0, 0, W, H);
      },
      subject(g, ink) {
        const c = (v) => ink || v;
        g.fillStyle = c('#2f343d'); g.fillRect(420, 270, 18, 420); g.fillRect(404, 680, 50, 16);
        g.fillStyle = c('#3a404a'); poly(g, [[398, 262], [460, 262], [448, 238], [410, 238]]);
        g.fillStyle = c('#ffe2a8'); g.fillRect(410, 262, 38, 12);
        // A cyclist silhouette crossing under the lamp.
        g.strokeStyle = c('#0b0c10'); g.lineWidth = 6; g.beginPath(); g.arc(640, 640, 42, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(770, 640, 42, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.moveTo(640, 640); g.lineTo(700, 580); g.lineTo(770, 640); g.moveTo(700, 580); g.lineTo(752, 576); g.stroke();
        g.fillStyle = c('#0b0c10'); poly(g, [[690, 584], [712, 584], [728, 500], [706, 496]]); circle(g, 724, 478, 18); poly(g, [[712, 520], [760, 560], [752, 572], [704, 534]]);
      },
      tone: { gain: 0.7, lift: 0.03, contrast: 0.9, cast: [1.06, 1, 0.94] }, noise: 24,
    },
    'garden-flower': {
      background(g, r) {
        const bg = g.createRadialGradient(600, 400, 40, 600, 400, 780); bg.addColorStop(0, '#5f7d3f'); bg.addColorStop(1, '#1e2c18'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
        g.globalAlpha = 0.25; for (let i = 0; i < 40; i++) { g.fillStyle = ['#9fbf6a', '#d7e39a', '#4f6b31', '#f0d3e0'][i % 4]; circle(g, r() * W, r() * H, 20 + r() * 70); } g.globalAlpha = 1;
      },
      subject(g, ink) {
        const c = (v) => ink || v;
        g.fillStyle = c('#3f6b2a'); g.fillRect(592, 470, 16, 340); g.save(); g.translate(600, 640); g.rotate(-0.6); g.fillStyle = c('#4c7d32'); ellipse(g, 60, 0, 70, 22); g.restore();
        for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; g.save(); g.translate(600, 380); g.rotate(a);
          g.fillStyle = c(i % 2 ? '#d86a92' : '#e07fa2'); ellipse(g, 0, -92, 34, 88); g.restore(); }
        g.fillStyle = c('#d9a830'); circle(g, 600, 380, 58); g.fillStyle = c('#a8741c'); circle(g, 600, 380, 34);
      },
      tone: { gain: 0.8, lift: 0.04, contrast: 0.8, cast: [1.08, 1.0, 0.9] }, noise: 10,
    },
  };

  const draw = (scene, layer) => {
    const c = canvas(), g = c.getContext('2d');
    g.save();
    if (scene.tilt) { g.translate(W / 2, H / 2); g.rotate((scene.tilt * Math.PI) / 180); g.scale(1.1, 1.1); g.translate(-W / 2, -H / 2); }
    if (layer === 'mask') { g.fillStyle = '#000'; g.fillRect(-W, -H, W * 3, H * 3); scene.subject(g, '#fff'); }
    else { scene.background(g, rng(7)); scene.subject(g, null); }
    g.restore();
    return c;
  };
  const toned = (scene, src, noisy) => {
    const c = canvas(), g = c.getContext('2d'); g.drawImage(src, 0, 0);
    const img = g.getImageData(0, 0, W, H), d = img.data, r = rng(42);
    const { gain, lift, contrast, cast } = scene.tone;
    const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += r(); return (s - 2) * 1.73; };
    for (let i = 0; i < d.length; i += 4) {
      const lum = noisy ? gauss() * scene.noise : 0;
      for (let k = 0; k < 3; k++) {
        let v = d[i + k] / 255; v = (v - 0.5) * contrast + 0.5; v = v * gain * cast[k] + lift;
        v = v * 255 + lum + (noisy ? gauss() * scene.noise * 0.45 : 0);
        d[i + k] = Math.max(0, Math.min(255, v));
      }
    }
    g.putImageData(img, 0, 0); return c;
  };
  const thumb = (src) => { const c = canvas(240, 160); c.getContext('2d').drawImage(src, 0, 0, 240, 160); return c.toDataURL('image/webp', 0.8); };
  const result = {};
  for (const [id, scene] of Object.entries(scenes)) {
    const clean = draw(scene, 'photo');
    const noisy = toned(scene, clean, true);
    result[id] = {
      photo: noisy.toDataURL('image/webp', 0.86),
      denoised: toned(scene, clean, false).toDataURL('image/webp', 0.9),
      mask: (() => { const m = draw(scene, 'mask'), s = canvas(600, 400), sg = s.getContext('2d'); sg.filter = 'blur(1.5px)'; sg.drawImage(m, 0, 0, 600, 400); return s.toDataURL('image/png'); })(),
      thumb: thumb(noisy),
    };
  }
  return result;
};

const browser = await chromium.launch(process.env.KESTREL_CHROME_PATH ? { executablePath: process.env.KESTREL_CHROME_PATH } : {});
try {
  const page = await browser.newPage();
  const images = await page.evaluate(pageScript);
  await mkdir(out, { recursive: true });
  for (const [id, files] of Object.entries(images)) {
    const write = (name, url) => writeFile(path.join(out, name), Buffer.from(url.split(',')[1], 'base64'));
    await write(`${id}.webp`, files.photo);
    await write(`${id}-denoised.webp`, files.denoised);
    await write(`${id}-mask.png`, files.mask);
    await write(`${id}-thumb.webp`, files.thumb);
    console.log(`wrote ${id}`);
  }
} finally {
  await browser.close();
}
