// InFlight website: "Try the editing tools" demo.
// A small WebGL preview of the editing controls on sample images. It is NOT InFlight's RAW engine:
// denoise swaps to a pre-made cleaner image (or a labelled blur when there is none), and the subject
// mask is a pre-made image per photo, not live subject detection. The page says so in words.
(() => {
  'use strict';
  const root = document.getElementById('demo');
  if (!root) return;

  // Every visible word comes from the site's one string table (i18n-strings.js) via KestrelI18n.
  const i18n = window.KestrelI18n;
  const t = (key, vars) => (i18n ? i18n.t(key, vars) : key);
  // photos.json text may be a plain string or one entry per language: { "en-GB": "…", "fr": "…" }.
  const word = (value) => {
    if (!value || typeof value !== 'object') return value || '';
    const lang = i18n ? i18n.language : 'en-GB';
    return value[lang] || value[lang.split('-')[0]] || value['en-GB'] || Object.values(value)[0] || '';
  };
  const TOUR = [
    { target: '[data-tour="photos"]' }, { target: '[data-tour="light"]', tab: 'light' }, { target: '[data-tour="colour"]', tab: 'colour' },
    { target: '[data-tour="detail"]', tab: 'detail' }, { target: '[data-tour="mask"]', tab: 'mask' }, { target: '[data-tour="crop"]', tab: 'crop' },
    { target: '[data-tour="compare"]' },
  ];
  const T = {
    get loading() { return t('demoLoading'); }, get noWebgl() { return t('demoNoWebgl'); }, get loadFailed() { return t('demoLoadFailed'); },
    get splitOn() { return t('demoSplitOn'); }, get splitOff() { return t('demoSplitOff'); },
    get denoiseModeClean() { return t('demoDenoiseClean'); }, get denoiseModeBlur() { return t('demoDenoiseBlur'); },
    get maskNone() { return t('demoMaskNone'); }, get maskMissing() { return t('demoMaskMissing'); }, get reset() { return t('demoResetDone'); },
    maskFound: (subject) => t('demoMaskFound', { subject }),
    photoLabel: (title, n, total) => t('demoPhotoLabel', { title, n, total }),
    step: (n, total) => t('tourStep', { n, total }),
    get tour() { return TOUR.map((s, i) => ({ ...s, title: t('tour' + (i + 1) + 'Title'), body: t('tour' + (i + 1) + 'Body') })); },
  };

  const $ = (sel, el = root) => el.querySelector(sel);
  const $$ = (sel, el = root) => Array.from(el.querySelectorAll(sel));

  // ---------- state ----------
  const NEUTRAL = {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    temperature: 0, tint: 0, vibrance: 0, saturation: 0, clarity: 0, denoise: 0,
    maskExposure: 0, maskSaturation: 0, maskWarmth: 0, angle: 0,
  };
  const state = { ...NEUTRAL, aspect: 'original', maskOn: false, maskTarget: 'subject', overlay: true, split: false, splitAt: 50, original: false };
  let photos = [];
  let current = null;

  // ---------- WebGL ----------
  const canvas = $('#demo-canvas');
  const status = $('#demo-status');
  let statusKey = '';
  const setStatus = (key) => { statusKey = key; status.textContent = key ? T[key] : ''; };
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
  const VERT = `attribute vec2 p; varying vec2 v; void main(){ v = vec2((p.x+1.)*.5, (1.-p.y)*.5); gl_Position = vec4(p,0.,1.); }`;
  const FRAG = `precision mediump float;
varying vec2 v;
uniform sampler2D uImg, uClean, uMask;
uniform float uHasClean, uHasMask;
uniform vec2 uTexel;
uniform float uImgAspect, uOutAspect, uAngle, uScale;
uniform float uExposure, uContrast, uHighlights, uShadows, uWhites, uBlacks;
uniform float uTemp, uTint, uVibrance, uSaturation, uClarity, uDenoise;
uniform float uMaskOn, uMaskInvert, uOverlay, uMExposure, uMSaturation, uMWarmth;
uniform float uSplit, uOriginal;
float luma(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
vec3 blur(vec2 uv, float r){
  vec3 s = texture2D(uImg, uv).rgb * .2;
  s += texture2D(uImg, uv + uTexel*vec2( r, 0.)).rgb * .1; s += texture2D(uImg, uv + uTexel*vec2(-r, 0.)).rgb * .1;
  s += texture2D(uImg, uv + uTexel*vec2(0.,  r)).rgb * .1; s += texture2D(uImg, uv + uTexel*vec2(0., -r)).rgb * .1;
  s += texture2D(uImg, uv + uTexel*vec2( r,  r)).rgb * .1; s += texture2D(uImg, uv + uTexel*vec2(-r, -r)).rgb * .1;
  s += texture2D(uImg, uv + uTexel*vec2( r, -r)).rgb * .1; s += texture2D(uImg, uv + uTexel*vec2(-r,  r)).rgb * .1;
  return s;
}
// Demo stand-in for denoising when no pre-made cleaner image exists: an edge-preserving (bilateral) blur, which
// smooths flat areas and keeps edges. It is labelled as a blur on the page; it is not InFlight's denoiser.
vec3 smoothed(vec2 uv){
  vec3 centre = texture2D(uImg, uv).rgb;
  vec3 sum = centre; float wsum = 1.;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      if (x == 0 && y == 0) continue;
      vec2 o = vec2(float(x), float(y)) * 1.6;
      vec3 c = texture2D(uImg, uv + uTexel * o).rgb;
      vec3 d = c - centre;
      float w = exp(-dot(d, d) / .012) * exp(-dot(o, o) / 18.);
      sum += c * w; wsum += w;
    }
  }
  return sum / wsum;
}
vec3 base(vec2 uv){
  vec3 n = texture2D(uImg, uv).rgb;
  if (uDenoise <= 0.) return n;
  vec3 c = uHasClean > .5 ? texture2D(uClean, uv).rgb : smoothed(uv);
  return mix(n, c, uDenoise);
}
void main(){
  vec2 c = (v - .5) * vec2(uOutAspect, 1.) * uScale;
  float s = sin(uAngle), k = cos(uAngle);
  c = vec2(c.x*k - c.y*s, c.x*s + c.y*k);
  vec2 uv = c / vec2(uImgAspect, 1.) + .5;
  bool before = uOriginal > .5 || (uSplit >= 0. && v.x < uSplit);
  vec3 col = before ? texture2D(uImg, uv).rgb : base(uv);
  if (!before) {
    col.r *= 1. + uTemp*.22; col.b *= 1. - uTemp*.22; col.g *= 1. - uTint*.16; col.rb *= 1. + uTint*.06;
    col *= exp2(uExposure);
    float L = luma(col);
    float hw = smoothstep(.45, 1., L), sw = 1. - smoothstep(0., .5, L);
    col += (uHighlights*.35*hw + uShadows*.35*sw) * (col + .04);
    float bp = -uBlacks*.12, wp = 1. - uWhites*.22;
    col = (col - bp) / max(wp - bp, .05);
    col = clamp(col, 0., 1.5);
    vec3 curved = col*col*(3. - 2.*col);
    col = uContrast >= 0. ? mix(col, curved, uContrast) : mix(col, vec3(.5) + (col-.5)*.5, -uContrast);
    if (uClarity != 0.) {
      // Local contrast: the pixel against a wide blur of its neighbourhood.
      float d = luma(base(uv)) - luma(blur(uv, 7.));
      float mid = 1. - abs(luma(col)*2. - 1.);
      col += d * uClarity * 1.8 * mid;
    }
    float g = luma(col);
    float sat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
    col = mix(vec3(g), col, 1. + uVibrance*(1. - clamp(sat*1.6, 0., 1.)));
    col = mix(vec3(luma(col)), col, 1. + uSaturation);
    if (uMaskOn > .5 && uHasMask > .5) {
      float m = texture2D(uMask, uv).r;
      if (uMaskInvert > .5) m = 1. - m;
      col *= exp2(uMExposure * m);
      col = mix(vec3(luma(col)), col, 1. + uMSaturation*m);
      col.r *= 1. + uMWarmth*.2*m; col.b *= 1. - uMWarmth*.2*m;
      if (uOverlay > .5) {
        float stripe = step(.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 16.));
        col = mix(col, mix(vec3(.77,.31,.39), vec3(.96,.94,.9), stripe*.35), m*.45);
      }
    }
  }
  if (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1.) col = vec3(.07);
  gl_FragColor = vec4(clamp(col, 0., 1.), 1.);
}`;

  let program = null, textures = {}, uniforms = {};
  function setupGl() {
    if (!gl) return false;
    const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s; };
    try {
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link');
    } catch (error) { console.warn('InFlight demo: WebGL unavailable', error); return false; }
    gl.useProgram(program);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(program, i); uniforms[info.name] = gl.getUniformLocation(program, info.name); }
    ['uImg', 'uClean', 'uMask'].forEach((name, unit) => { textures[name] = gl.createTexture(); gl.uniform1i(uniforms[name], unit); });
    return true;
  }
  function upload(name, unit, image) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, textures[name]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  }

  const ASPECTS = { original: null, '1:1': 1, '4:5': 0.8, '3:2': 1.5, '16:9': 16 / 9 };
  function outputAspect() { return ASPECTS[state.aspect] || (current ? current.width / current.height : 1.5); }

  let frame = 0;
  function render() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }
  function draw() {
    if (!current || !program) return;
    const outA = outputAspect();
    const maxW = Math.min(current.width, 1200);
    const w = Math.round(outA >= 1 ? maxW : maxW * outA), h = Math.round(w / outA);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    const imgA = current.width / current.height;
    const a = (state.angle * Math.PI) / 180, cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
    // Largest crop of this shape that, once rotated, still fits inside the photo (no empty corners).
    const scale = Math.min(imgA / (outA * cos + sin), 1 / (outA * sin + cos));
    const set = (name, value) => uniforms[name] && gl.uniform1f(uniforms[name], value);
    gl.uniform2f(uniforms.uTexel, 1 / current.width, 1 / current.height);
    set('uImgAspect', imgA); set('uOutAspect', outA); set('uAngle', -a); set('uScale', scale); // positive straighten turns the picture clockwise
    set('uExposure', state.exposure); set('uContrast', state.contrast / 100);
    set('uHighlights', state.highlights / 100); set('uShadows', state.shadows / 100);
    set('uWhites', state.whites / 100); set('uBlacks', state.blacks / 100);
    set('uTemp', state.temperature / 100); set('uTint', state.tint / 100);
    set('uVibrance', state.vibrance / 100); set('uSaturation', state.saturation / 100);
    set('uClarity', state.clarity / 100); set('uDenoise', state.denoise / 100);
    set('uHasClean', current.clean ? 1 : 0); set('uHasMask', current.mask ? 1 : 0);
    set('uMaskOn', state.maskOn ? 1 : 0); set('uMaskInvert', state.maskTarget === 'background' ? 1 : 0);
    set('uOverlay', state.overlay ? 1 : 0);
    set('uMExposure', state.maskExposure); set('uMSaturation', state.maskSaturation / 100); set('uMWarmth', state.maskWarmth / 100);
    set('uSplit', state.split ? state.splitAt / 100 : -1); set('uOriginal', state.original ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    root.dataset.rendered = String((Number(root.dataset.rendered) || 0) + 1);
  }

  // ---------- loading ----------
  const loadImage = (url) => new Promise((resolve, reject) => {
    const img = new Image(); img.decoding = 'async';
    img.crossOrigin = 'anonymous'; // photos may come from a storage bucket; WebGL needs CORS-approved pixels
    img.onload = () => resolve(img); img.onerror = () => reject(new Error('image ' + url)); img.src = url;
  });
  const configUrl = new URL(root.dataset.photos || 'demo/photos.json', document.baseURI);
  const resolveUrl = (path) => (path ? new URL(path, configUrl).href : '');

  let loadToken = 0;
  async function selectPhoto(index) {
    const photo = photos[index]; if (!photo) return;
    const token = ++loadToken;
    $$('.demo-thumb').forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
    root.setAttribute('aria-busy', 'true'); setStatus('loading');
    try {
      const [img, clean, mask] = await Promise.all([
        loadImage(resolveUrl(photo.src)),
        photo.denoised ? loadImage(resolveUrl(photo.denoised)).catch(() => null) : null,
        photo.mask ? loadImage(resolveUrl(photo.mask)).catch(() => null) : null,
      ]);
      if (token !== loadToken) return;
      current = { photo, width: img.naturalWidth, height: img.naturalHeight, clean: !!clean, mask: !!mask, img };
      canvas.setAttribute('aria-label', word(photo.alt) || word(photo.title));
      $('#demo-fallback').src = img.src; $('#demo-fallback').alt = word(photo.alt) || word(photo.title);
      if (program) { upload('uImg', 0, img); upload('uClean', 1, clean); upload('uMask', 2, mask); }
      updateDenoiseNote();
      state.maskOn = false; updateMaskUi();
      setStatus(program ? '' : 'noWebgl');
      draw();
    } catch (error) {
      console.warn(error); setStatus('loadFailed');
    } finally { if (token === loadToken) root.removeAttribute('aria-busy'); }
  }

  function buildPicker() {
    const list = $('#demo-photos'); list.textContent = '';
    photos.forEach((photo, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'demo-thumb'; b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', T.photoLabel(word(photo.title), i + 1, photos.length));
      const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.width = 120; img.height = 80;
      img.src = resolveUrl(photo.thumb || photo.src);
      const span = document.createElement('span'); span.className = 'demo-thumb-title'; span.textContent = word(photo.title);
      b.append(img, span); b.addEventListener('click', () => selectPhoto(i));
      li.append(b); list.append(li);
    });
  }

  // ---------- controls ----------
  const fmt = {
    exposure: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} EV`,
    maskExposure: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} EV`,
    angle: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}°`,
    denoise: (v) => `${Math.round(v)}%`,
  };
  const format = (key, v) => (fmt[key] ? fmt[key](v) : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`);
  function syncSlider(input) {
    const key = input.dataset.key, v = Number(input.value), min = Number(input.min), max = Number(input.max);
    const neutral = NEUTRAL[key] ?? 0;
    const pct = (x) => ((x - min) / (max - min)) * 100;
    const a = pct(Math.min(v, neutral)), b = pct(Math.max(v, neutral));
    const row = input.closest('.demo-slider');
    row.style.setProperty('--fill-start', a + '%'); row.style.setProperty('--fill-width', (b - a) + '%');
    row.style.setProperty('--origin', pct(neutral) + '%');
    const out = row.querySelector('.demo-value'); out.textContent = format(key, v);
    row.classList.toggle('changed', Math.abs(v - neutral) > 1e-6);
    input.setAttribute('aria-valuetext', format(key, v));
  }
  $$('input[type=range][data-key]').forEach((input) => {
    input.addEventListener('input', () => { state[input.dataset.key] = Number(input.value); syncSlider(input); render(); });
    const resetBtn = input.closest('.demo-slider').querySelector('.demo-value');
    resetBtn.addEventListener('click', () => { input.value = String(NEUTRAL[input.dataset.key]); input.dispatchEvent(new Event('input')); });
    syncSlider(input);
  });

  // Tabs (arrow keys move between them, as in the app's panel tabs).
  const tabs = $$('[role=tab]');
  function selectTab(name, focus = false) {
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
    });
    root.dataset.tab = name;
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (d) { e.preventDefault(); selectTab(tabs[(i + d + tabs.length) % tabs.length].dataset.tab, true); }
      if (e.key === 'Home') { e.preventDefault(); selectTab(tabs[0].dataset.tab, true); }
      if (e.key === 'End') { e.preventDefault(); selectTab(tabs[tabs.length - 1].dataset.tab, true); }
    });
  });

  // Masking
  function updateMaskUi() {
    const note = $('#demo-mask-note');
    const has = current && current.mask;
    $('#demo-select-subject').disabled = !has;
    $('#demo-mask-controls').hidden = !state.maskOn;
    $('#demo-select-subject').setAttribute('aria-pressed', String(state.maskOn));
    note.textContent = !has ? T.maskMissing : state.maskOn ? T.maskFound(word(current.photo.subject) || word(current.photo.title)) : T.maskNone;
  }
  $('#demo-select-subject').addEventListener('click', () => { state.maskOn = !state.maskOn; updateMaskUi(); render(); });
  $$('input[name=demo-mask-target]').forEach((r) => r.addEventListener('change', () => { state.maskTarget = r.value; render(); }));
  $('#demo-overlay').addEventListener('change', (e) => { state.overlay = e.target.checked; render(); });

  // Crop
  $$('input[name=demo-aspect]').forEach((r) => r.addEventListener('change', () => { state.aspect = r.value; render(); }));

  // Before/after
  const splitBtn = $('#demo-split');
  const splitRange = $('#demo-split-range');
  function updateSplit() {
    splitBtn.setAttribute('aria-pressed', String(state.split));
    splitBtn.textContent = state.split ? T.splitOn : T.splitOff;
    $('#demo-compare').hidden = !state.split;
    root.style.setProperty('--split', state.splitAt + '%');
    render();
  }
  splitBtn.addEventListener('click', () => { state.split = !state.split; updateSplit(); });
  splitRange.addEventListener('input', () => { state.splitAt = Number(splitRange.value); updateSplit(); });
  const originalBtn = $('#demo-original');
  const hold = (on) => { state.original = on; originalBtn.setAttribute('aria-pressed', String(on)); render(); };
  originalBtn.addEventListener('pointerdown', () => hold(true));
  ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach((ev) => originalBtn.addEventListener(ev, () => hold(false)));
  originalBtn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); hold(true); } });
  originalBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') hold(false); });

  function resetEdits() {
    Object.assign(state, NEUTRAL, { aspect: 'original', maskOn: false, maskTarget: 'subject', overlay: true, split: false, splitAt: 50 });
    $$('input[type=range][data-key]').forEach((input) => { input.value = String(NEUTRAL[input.dataset.key]); syncSlider(input); });
    $('input[name=demo-aspect][value=original]').checked = true;
    $('input[name=demo-mask-target][value=subject]').checked = true;
    $('#demo-overlay').checked = true; splitRange.value = '50';
    updateMaskUi(); updateSplit(); render();
  }
  $('#demo-reset').addEventListener('click', () => { resetEdits(); setStatus('reset'); });

  // ---------- guided tour ----------
  const tour = $('#demo-tour');
  const tourBtn = $('#demo-tour-start');
  let step = -1;
  function placeTour() {
    const s = T.tour[step]; const target = $(s.target); if (!target) return;
    $$('.demo-tour-target').forEach((el) => el.classList.remove('demo-tour-target'));
    target.classList.add('demo-tour-target');
    if (window.matchMedia('(max-width: 700px)').matches) {
      // Phones: the tip is a sheet at the bottom; keep what it describes visible above it.
      tour.style.left = ''; tour.style.top = ''; tour.classList.add('sheet');
      const room = window.innerHeight - tour.offsetHeight - 24, t = target.getBoundingClientRect();
      if (t.bottom > room || t.top < 8) window.scrollBy({ top: t.top - Math.max(8, room - t.height), behavior: 'auto' });
      return;
    }
    tour.classList.remove('sheet');
    const r = target.getBoundingClientRect(), box = root.getBoundingClientRect();
    const width = Math.min(340, box.width - 24);
    let left = Math.max(12, Math.min(r.left - box.left, box.width - width - 12));
    let top = r.bottom - box.top + 10;
    if (r.bottom + 220 > window.innerHeight && r.top - box.top > 230) top = r.top - box.top - tour.offsetHeight - 10;
    tour.style.width = width + 'px'; tour.style.left = left + 'px'; tour.style.top = top + 'px';
  }
  function showStep(n) {
    step = Math.max(0, Math.min(T.tour.length - 1, n));
    const s = T.tour[step];
    if (s.tab) selectTab(s.tab);
    $('#demo-tour-count').textContent = T.step(step + 1, T.tour.length);
    $('#demo-tour-title').textContent = s.title;
    $('#demo-tour-body').textContent = s.body;
    $('#demo-tour-back').disabled = step === 0;
    $('#demo-tour-next').hidden = step === T.tour.length - 1;
    $('#demo-tour-done').hidden = step !== T.tour.length - 1;
    tour.hidden = false;
    $(s.target)?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    placeTour();
    (step === T.tour.length - 1 ? $('#demo-tour-done') : $('#demo-tour-next')).focus({ preventScroll: true });
  }
  function closeTour() {
    if (tour.hidden) return;
    tour.hidden = true; step = -1;
    $$('.demo-tour-target').forEach((el) => el.classList.remove('demo-tour-target'));
    tourBtn.focus();
  }
  tourBtn.addEventListener('click', () => showStep(0));
  $('#demo-tour-next').addEventListener('click', () => showStep(step + 1));
  $('#demo-tour-back').addEventListener('click', () => showStep(step - 1));
  $('#demo-tour-done').addEventListener('click', closeTour);
  $('#demo-tour-close').addEventListener('click', closeTour);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !tour.hidden) { e.preventDefault(); closeTour(); } });
  window.addEventListener('resize', () => { if (!tour.hidden) placeTour(); });

  function updateDenoiseNote() { if (current) $('#demo-denoise-note').textContent = current.clean ? T.denoiseModeClean : T.denoiseModeBlur; }
  function labelResets() { $$('[data-reset-for]').forEach((b) => b.setAttribute('aria-label', t('demoResetSlider', { name: t(b.dataset.resetFor) }))); }
  // A language change re-labels everything this script wrote (the rest of the page is handled by KestrelI18n).
  i18n?.onChange(() => {
    labelResets(); updateDenoiseNote(); updateMaskUi(); updateSplit();
    $$('.demo-thumb').forEach((b, i) => {
      b.setAttribute('aria-label', T.photoLabel(word(photos[i].title), i + 1, photos.length));
      b.querySelector('.demo-thumb-title').textContent = word(photos[i].title);
    });
    if (current) { canvas.setAttribute('aria-label', word(current.photo.alt) || word(current.photo.title)); }
    if (statusKey) setStatus(statusKey);
    if (!tour.hidden) {
      const s = T.tour[step];
      $('#demo-tour-count').textContent = T.step(step + 1, T.tour.length);
      $('#demo-tour-title').textContent = s.title; $('#demo-tour-body').textContent = s.body;
    }
  });
  labelResets();

  // ---------- walkthrough ----------
  // An animated run through the tools. It plays once by itself when the demo comes into view (never with reduced
  // motion), shows what it is doing in words, and stops at once on Stop, Escape or any touch of the controls.
  const walkBtn = $('#demo-walk');
  const caption = $('#demo-caption');
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STOP = Symbol('stop');
  let walking = null;
  let interacted = false;
  const sliderInput = (key) => $(`input[data-key="${key}"]`);
  function setSlider(key, value) { const input = sliderInput(key); input.value = String(value); input.dispatchEvent(new Event('input')); }
  function tween(from, to, ms, apply, run) {
    if (reduced() || ms <= 0) { apply(to); return Promise.resolve(); }
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = (now) => {
        if (run.stopped) { resolve(); return; }
        const p = Math.min(1, (now - start) / ms), eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        apply(from + (to - from) * eased);
        if (p < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
  }
  async function walkthrough(auto) {
    if (walking || !current) return;
    const run = { stopped: false, timers: [] };
    walking = run;
    closeTour();
    root.classList.add('walking');
    walkBtn.setAttribute('aria-pressed', 'true'); i18n ? i18n.bind(walkBtn, 'walkStop') : (walkBtn.textContent = 'Stop');
    caption.setAttribute('aria-live', auto ? 'off' : 'polite');
    caption.hidden = false;
    const total = 9;
    const check = () => { if (run.stopped) throw STOP; };
    const pause = (ms) => new Promise((resolve) => { run.timers.push(setTimeout(resolve, reduced() ? Math.max(ms, 1600) : ms)); }).then(check);
    const say = (n) => { check(); caption.dataset.step = String(n); $('.text', caption).textContent = t('walk' + n); $('.count', caption).textContent = `${n}/${total}`; };
    const slide = (key, to, ms) => tween(Number(sliderInput(key).value), to, ms, (v) => setSlider(key, v), run).then(check);
    try {
      resetEdits(); selectTab('light');
      say(1); await slide('exposure', 0.35, 1200); await pause(500);
      say(2); await slide('shadows', 45, 1000); await slide('highlights', -40, 1000); await pause(500);
      selectTab('colour'); say(3); await slide('temperature', 12, 900); await slide('vibrance', 30, 900); await pause(500);
      selectTab('detail'); say(4); await slide('denoise', 80, 1200); await slide('clarity', 25, 900); await pause(600);
      if (current.mask) {
        selectTab('mask'); say(5); state.maskOn = true; state.overlay = true; $('#demo-overlay').checked = true; updateMaskUi(); render(); await pause(1500);
        say(6); state.overlay = false; $('#demo-overlay').checked = false; render(); await slide('maskExposure', 0.5, 1200); await pause(600);
      }
      selectTab('crop'); say(7); $('input[name=demo-aspect][value="4:5"]').checked = true; state.aspect = '4:5'; render(); await pause(1700);
      $('input[name=demo-aspect][value=original]').checked = true; state.aspect = 'original'; render();
      selectTab('light'); say(8); state.split = true; state.splitAt = 85; updateSplit();
      const sweep = (to, ms) => tween(state.splitAt, to, ms, (v) => { state.splitAt = v; splitRange.value = String(Math.round(v)); updateSplit(); }, run).then(check);
      await sweep(15, 1800); await sweep(50, 1000); await pause(600);
      say(9); await pause(2600);
      endWalk(false);
    } catch (error) {
      if (error !== STOP) { console.warn(error); endWalk(true); }
    }
  }
  function endWalk(stopped) {
    const run = walking; if (!run) return;
    run.stopped = true; run.timers.forEach(clearTimeout);
    walking = null;
    root.classList.remove('walking');
    caption.hidden = true;
    walkBtn.setAttribute('aria-pressed', 'false'); i18n ? i18n.bind(walkBtn, 'walkPlay') : (walkBtn.textContent = 'Play');
    if (stopped && document.activeElement === document.body) walkBtn.focus();
  }
  walkBtn.addEventListener('click', () => { interacted = true; if (walking) endWalk(true); else walkthrough(false); });
  // Any hand on the controls takes over from the walkthrough.
  const takeOver = (event) => { if (event.target.closest('#demo-walk')) return; interacted = true; if (walking) endWalk(true); };
  root.addEventListener('pointerdown', takeOver, true);
  root.addEventListener('keydown', takeOver, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && walking) endWalk(true); });
  i18n?.onChange(() => { if (walking && caption.dataset.step) { $('.text', caption).textContent = t('walk' + caption.dataset.step); } });
  function autoplayWhenSeen() {
    if (!('IntersectionObserver' in window)) return;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      setTimeout(() => { if (!interacted && !reduced() && document.visibilityState === 'visible' && tour.hidden) walkthrough(true); }, 700);
    }, { threshold: 0.6 });
    seen.observe($('.demo-stage'));
  }

  // ---------- start ----------
  const webgl = setupGl();
  if (!webgl) { root.classList.add('no-webgl'); walkBtn.hidden = true; }
  updateSplit();
  const usable = (list) => (Array.isArray(list) ? list : []).filter((p) => p && p.src).slice(0, 5);
  fetch(configUrl, { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error('photos.json'); return r.json(); })
    .then(async (config) => {
      photos = usable(config.photos);
      // If the main photos can't be reached (for example, not uploaded yet), use the fallback list instead.
      const fallback = usable(config.fallback);
      if (fallback.length && (!photos.length || !(await loadImage(resolveUrl(photos[0].src)).then(() => true, () => false)))) photos = fallback;
      if (!photos.length) throw new Error('no photos');
      buildPicker(); await selectPhoto(0);
      if (webgl) autoplayWhenSeen();
    })
    .catch((error) => { console.warn(error); setStatus('loadFailed'); });
})();
