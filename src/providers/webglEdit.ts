import {
  detailParams,
  editParams,
  evaluateToneCurveLut,
  hasDetail,
  isIdentityToneCurve,
  wbMultipliers,
  type PhotoEdit,
} from '../core/photoEdits';

const VERTEX = `#version 300 es
in vec2 p;
out vec2 uv;
void main() {
  uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// Mirrors applyPhotoEditLinearInPlace in src/core/photoEdits.ts pixel-for-pixel.
const TONE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform sampler2D curveLut;
uniform float gain, brightness, contrastAmount, highlights, shadows, blackPoint, whitePoint, vibrance, colour;
uniform vec3 wbMul;
uniform int hasCurve;
in vec2 uv;
out vec4 outColour;

vec3 toLinear(vec3 c) {
  return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, lessThanEqual(c, vec3(0.04045)));
}
vec3 toEncoded(vec3 v) {
  v = clamp(v, 0.0, 1.0);
  return mix(1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, v * 12.92, lessThanEqual(v, vec3(0.0031308)));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 rollOffHighlights(vec3 c) {
  float peak = max(c.r, max(c.g, c.b));
  if (peak <= 1.0) return c;
  vec3 scaled = c / peak;
  float lum = min(1.0, luma(c));
  float desat = min(0.45, ((peak - 1.0) / (peak + 0.85)) * 0.65);
  return mix(scaled, vec3(lum), desat);
}

float sCurve(float x, float amount) {
  float c = clamp(x, 0.0, 1.0);
  return clamp(c + amount * c * (1.0 - c) * (c - 0.5), 0.0, 1.0);
}

void main() {
  vec4 texel = texture(src, uv);
  vec3 c = toLinear(texel.rgb) * gain * wbMul;
  if (highlights != 0.0 || shadows != 0.0 || blackPoint != 0.0 || whitePoint != 1.0) {
    c = (c - blackPoint) / (whitePoint - blackPoint);
    float rawY = max(0.0, luma(c));
    float perceived = rawY <= 1.0 ? toEncoded(vec3(rawY)).r : 1.0 + 0.25 * log2(rawY);
    float f = max(0.0, 1.0 + shadows * (1.0 - smoothstep(0.0, 0.6, perceived)) + highlights * smoothstep(0.35, 1.1, perceived));
    c *= f;
  }
  float midtone = luma(c);
  if (brightness != 0.0 && midtone > 0.0 && midtone < 1.0) {
    float perceived = toEncoded(vec3(midtone)).r;
    float adjusted = perceived + 4.0 * brightness * perceived * (1.0 - perceived);
    float requestedFactor = toLinear(vec3(adjusted)).r / midtone;
    float peak = max(c.r, max(c.g, c.b));
    float factor = requestedFactor > 1.0 && peak > 0.0
      ? min(requestedFactor, max(1.0, 0.992 / peak)) : requestedFactor;
    c *= factor;
  }
  float y = luma(c);
  bool monochrome = colour <= -1.0;
  float saturation = monochrome ? 0.0 : 1.0 + colour;
  if (!monochrome && vibrance != 0.0) {
    float high = max(c.r, max(c.g, c.b));
    float chroma = high > 0.0 ? (high - min(c.r, min(c.g, c.b))) / high : 0.0;
    saturation += vibrance * (1.0 - min(1.0, chroma));
  }
  c = max(vec3(0.0), vec3(y) + (c - vec3(y)) * saturation);
  c = rollOffHighlights(c);
  vec3 e = toEncoded(c);
  if (contrastAmount != 0.0) {
    e = vec3(
      sCurve(e.r, contrastAmount),
      sCurve(e.g, contrastAmount),
      sCurve(e.b, contrastAmount)
    );
  }
  if (hasCurve == 1) {
    e = vec3(
      texture(curveLut, vec2(e.r, 0.5)).r,
      texture(curveLut, vec2(e.g, 0.5)).r,
      texture(curveLut, vec2(e.b, 0.5)).r
    );
  }
  outColour = vec4(e, texel.a);
}`;

// Pass 2a: Separable horizontal box blur across all three radii simultaneously.
const BLUR_H = `#version 300 es
precision highp float;
uniform sampler2D tone;
uniform vec2 texelSize;
uniform int rSharp, rTex, rClar;
in vec2 uv;
out vec4 outBlur;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float boxH(vec2 at, int radius) {
  if (radius <= 0) return luma(texture(tone, at).rgb);
  int stepPx = max(1, radius / 24);
  float sum = 0.0;
  float count = 0.0;
  for (int k = -48; k <= 48; k++) {
    int dx = k * stepPx;
    if (abs(dx) > radius) continue;
    vec2 p = clamp(at + vec2(float(dx) * texelSize.x, 0.0), vec2(0.0), vec2(1.0));
    sum += luma(texture(tone, p).rgb);
    count += 1.0;
  }
  return sum / max(1.0, count);
}

void main() {
  vec2 at = vec2(uv.x, 1.0 - uv.y);
  float center = luma(texture(tone, at).rgb);
  outBlur = vec4(
    rSharp > 0 ? boxH(at, rSharp) : center,
    rTex > 0 ? boxH(at, rTex) : center,
    rClar > 0 ? boxH(at, rClar) : center,
    center
  );
}`;

// Pass 2b: Separable vertical box blur reading pass 2a horizontal totals.
const BLUR_V = `#version 300 es
precision highp float;
uniform sampler2D blurH;
uniform vec2 texelSize;
uniform int rSharp, rTex, rClar;
in vec2 uv;
out vec4 outBlur;

float boxV(vec2 at, int radius, int ch) {
  if (radius <= 0) {
    vec4 s = texture(blurH, at);
    return ch == 0 ? s.r : ch == 1 ? s.g : s.b;
  }
  int stepPx = max(1, radius / 24);
  float sum = 0.0;
  float count = 0.0;
  for (int k = -48; k <= 48; k++) {
    int dy = k * stepPx;
    if (abs(dy) > radius) continue;
    vec2 p = clamp(at + vec2(0.0, float(dy) * texelSize.y), vec2(0.0), vec2(1.0));
    vec4 s = texture(blurH, p);
    sum += ch == 0 ? s.r : ch == 1 ? s.g : s.b;
    count += 1.0;
  }
  return sum / max(1.0, count);
}

void main() {
  vec2 at = vec2(uv.x, 1.0 - uv.y);
  vec4 center = texture(blurH, at);
  outBlur = vec4(
    rSharp > 0 ? boxV(at, rSharp, 0) : center.r,
    rTex > 0 ? boxV(at, rTex, 1) : center.g,
    rClar > 0 ? boxV(at, rClar, 2) : center.b,
    center.a
  );
}`;

// Pass 3: Hue-preserving luminance-ratio detail synthesis.
const DETAIL = `#version 300 es
precision highp float;
uniform sampler2D tone;
uniform sampler2D blurV;
uniform float sharpen, texture_, clarity;
in vec2 uv;
out vec4 outColour;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec2 at = vec2(uv.x, 1.0 - uv.y);
  vec4 t = texture(tone, at);
  vec4 b = texture(blurV, at);
  float l = luma(t.rgb);
  float add = 0.0;
  if (sharpen != 0.0) add += sharpen * (l - b.r);
  if (texture_ != 0.0) add += texture_ * (l - b.g);
  if (clarity != 0.0) add += clarity * 4.0 * l * (1.0 - l) * (l - b.b);
  vec3 rgb = t.rgb;
  if (add != 0.0) {
    if (l > 0.02) {
      vec3 ratio = min(vec3(3.0), rgb / l);
      rgb = clamp(rgb + add * ratio, 0.0, 1.0);
    } else {
      rgb = clamp(rgb + add, 0.0, 1.0);
    }
  }
  outColour = vec4(rgb, t.a);
}`;

interface Gpu {
  blurHProgram: WebGLProgram;
  blurVProgram: WebGLProgram;
  detailProgram: WebGLProgram;
  toneTexture: WebGLTexture;
  blurHTexture: WebGLTexture;
  blurVTexture: WebGLTexture;
  curveTexture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  fboSize: [number, number];
  useFloatFbo: boolean;
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
  maxSize: number;
}

let gpu: Gpu | null | undefined;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader failed');
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, fragSource: string): WebGLProgram | null {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragSource));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
  return p;
}

function initNearestTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function setup(): Gpu | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    const program = linkProgram(gl, TONE_FRAGMENT);
    const blurHProgram = linkProgram(gl, BLUR_H);
    const blurVProgram = linkProgram(gl, BLUR_V);
    const detailProgram = linkProgram(gl, DETAIL);
    if (!program || !blurHProgram || !blurVProgram || !detailProgram) return null;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.useProgram(program);
    const location = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);

    const texture = initNearestTexture(gl);
    const toneTexture = initNearestTexture(gl);
    const blurHTexture = initNearestTexture(gl);
    const blurVTexture = initNearestTexture(gl);
    const curveTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, curveTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const identityLut = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i += 1) {
      identityLut[i * 4] = i;
      identityLut[i * 4 + 1] = i;
      identityLut[i * 4 + 2] = i;
      identityLut[i * 4 + 3] = 255;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, identityLut);

    const framebuffer = gl.createFramebuffer()!;
    const useFloatFbo = Boolean(gl.getExtension('EXT_color_buffer_float'));
    canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); gpu = undefined; });
    return {
      canvas, gl, program, blurHProgram, blurVProgram, detailProgram,
      texture, toneTexture, blurHTexture, blurVTexture, curveTexture, framebuffer,
      fboSize: [0, 0], useFloatFbo, maxSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
  } catch {
    return null;
  }
}

function allocateFboTextures(gpuCtx: Gpu, width: number, height: number): boolean {
  const { gl, toneTexture, blurHTexture, blurVTexture, framebuffer, useFloatFbo } = gpuCtx;
  const internalFormat = useFloatFbo ? gl.RGBA16F : gl.RGBA8;
  const type = useFloatFbo ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  for (const tex of [toneTexture, blurHTexture, blurVTexture]) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, type, null);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, toneTexture, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok && useFloatFbo) {
    gpuCtx.useFloatFbo = false;
    return allocateFboTextures(gpuCtx, width, height);
  }
  return ok;
}

function bindQuad(gl: WebGL2RenderingContext, prog: WebGLProgram) {
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

/** Render an edit on the GPU into the given canvas. Returns false when the CPU path should run instead. */
export function renderEditOnGpu(target: HTMLCanvasElement, edit: PhotoEdit, imageEdge = Math.max(target.width, target.height)): boolean {
  if (gpu === undefined) gpu = setup();
  if (!gpu || gpu.gl.isContextLost()) return false;
  const { canvas, gl, program, texture, curveTexture, maxSize } = gpu;
  const detail = hasDetail(edit);
  const { width, height } = target;
  if (!width || !height || width > maxSize || height > maxSize) return false;
  const context = target.getContext('2d');
  if (!context) return false;
  try {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    bindQuad(gl, program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, target);
    gl.uniform1i(gl.getUniformLocation(program, 'src'), 0);

    const hasCurve = !isIdentityToneCurve(edit.toneCurve);
    if (hasCurve) {
      const lut = evaluateToneCurveLut(edit.toneCurve, 256);
      const bytes = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i += 1) {
        const b = Math.round(lut[i] * 255);
        bytes[i * 4] = b;
        bytes[i * 4 + 1] = b;
        bytes[i * 4 + 2] = b;
        bytes[i * 4 + 3] = 255;
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, curveTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    }
    gl.uniform1i(gl.getUniformLocation(program, 'curveLut'), 1);
    gl.uniform1i(gl.getUniformLocation(program, 'hasCurve'), hasCurve ? 1 : 0);

    const params = editParams(edit);
    const [rMul, gMul, bMul] = wbMultipliers(params.warmth, params.tint);
    gl.uniform3f(gl.getUniformLocation(program, 'wbMul'), rMul, gMul, bMul);
    for (const [name, value] of Object.entries({
      gain: params.gain,
      brightness: params.brightness,
      colour: params.colour,
      contrastAmount: params.contrastAmount,
      highlights: params.highlights,
      shadows: params.shadows,
      blackPoint: params.blackPoint,
      whitePoint: params.whitePoint,
      vibrance: params.vibrance,
    })) {
      gl.uniform1f(gl.getUniformLocation(program, name), value);
    }

    if (detail) {
      const { toneTexture, blurHTexture, blurVTexture, framebuffer, blurHProgram, blurVProgram, detailProgram } = gpu;
      if (gpu.fboSize[0] !== width || gpu.fboSize[1] !== height) {
        if (!allocateFboTextures(gpu, width, height)) return false;
        gpu.fboSize = [width, height];
      }
      // Pass 1: Tone into RGBA16F FBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, toneTexture, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      const d = detailParams(edit, imageEdge);
      const rSharp = d.sharpen ? d.sharpenRadius : 0;
      const rTex = d.texture ? d.textureRadius : 0;
      const rClar = d.clarity ? d.clarityRadius : 0;

      // Pass 2a: Separable horizontal box blur
      gl.useProgram(blurHProgram);
      bindQuad(gl, blurHProgram);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurHTexture, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, toneTexture);
      gl.uniform1i(gl.getUniformLocation(blurHProgram, 'tone'), 0);
      gl.uniform2f(gl.getUniformLocation(blurHProgram, 'texelSize'), 1 / width, 1 / height);
      gl.uniform1i(gl.getUniformLocation(blurHProgram, 'rSharp'), rSharp);
      gl.uniform1i(gl.getUniformLocation(blurHProgram, 'rTex'), rTex);
      gl.uniform1i(gl.getUniformLocation(blurHProgram, 'rClar'), rClar);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Pass 2b: Separable vertical box blur
      gl.useProgram(blurVProgram);
      bindQuad(gl, blurVProgram);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurVTexture, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, blurHTexture);
      gl.uniform1i(gl.getUniformLocation(blurVProgram, 'blurH'), 0);
      gl.uniform2f(gl.getUniformLocation(blurVProgram, 'texelSize'), 1 / width, 1 / height);
      gl.uniform1i(gl.getUniformLocation(blurVProgram, 'rSharp'), rSharp);
      gl.uniform1i(gl.getUniformLocation(blurVProgram, 'rTex'), rTex);
      gl.uniform1i(gl.getUniformLocation(blurVProgram, 'rClar'), rClar);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Pass 3: Composite luminance-ratio detail directly to screen buffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(detailProgram);
      bindQuad(gl, detailProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, toneTexture);
      gl.uniform1i(gl.getUniformLocation(detailProgram, 'tone'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, blurVTexture);
      gl.uniform1i(gl.getUniformLocation(detailProgram, 'blurV'), 1);
      gl.uniform1f(gl.getUniformLocation(detailProgram, 'sharpen'), d.sharpen);
      gl.uniform1f(gl.getUniformLocation(detailProgram, 'texture_'), d.texture);
      gl.uniform1f(gl.getUniformLocation(detailProgram, 'clarity'), d.clarity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.activeTexture(gl.TEXTURE0);
      gl.useProgram(program);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    context.globalCompositeOperation = 'copy';
    context.drawImage(canvas, 0, 0);
    context.globalCompositeOperation = 'source-over';
    return true;
  } catch {
    return false;
  }
}
