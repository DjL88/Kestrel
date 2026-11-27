import { CURVE_LUT_SIZE, MIXER_HUE_DEGREES, MIXER_LUMINANCE_EV, MIXER_SATURATION } from '../core/curveMixer';
import { DETAIL_CORE, detailParams, editParams, hasDetail, type PhotoEdit } from '../core/photoEdits';

const CURVE_VEC4S = Math.ceil(CURVE_LUT_SIZE / 4);

const VERTEX = `#version 300 es
in vec2 p;
out vec2 uv;
void main() {
  uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// Mirrors applyPhotoEdit in src/core/photoEdits.ts. Keep the two in step.
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec3 channelGain;
uniform float brightness, colour, contrast, highlights, shadows, blackPoint, whitePoint, vibrance;
// Tone curve: the same CURVE_LUT_SIZE table the CPU reads, four entries per vec4. Colour mixer: 24 values, six vec4s.
uniform bool useCurve, useMixer, useGrade;
// Colour grading (src/core/colourGrade.ts gradePixel): shadow, midtone and highlight offsets and the balance pivot.
uniform vec3 gradeS, gradeM, gradeH;
uniform float gradePivot;
// Camera calibration (src/core/calibration.ts), on linear light right after white balance.
uniform bool useCalib;
uniform mat3 calib;
uniform vec4 curveLut[${CURVE_VEC4S}];
uniform vec4 mixerP[6];
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
float curveAt(int i) { return curveLut[i / 4][i % 4]; }
float applyCurve(float v) {
  float at = clamp(v, 0.0, 1.0) * float(${CURVE_LUT_SIZE - 1});
  int low = min(int(floor(at)), ${CURVE_LUT_SIZE - 2});
  return mix(curveAt(low), curveAt(low + 1), at - float(low));
}
float mixerAt(int i) { return mixerP[i / 4][i % 4]; }
// Mirrors mixPixel in src/core/curveMixer.ts: band and greyness judged on display values, change made on linear HSV.
float hueOf(vec3 c, float high, float delta) {
  float hue;
  if (high == c.r) hue = 60.0 * mod((c.g - c.b) / delta, 6.0);
  else if (high == c.g) hue = 60.0 * ((c.b - c.r) / delta + 2.0);
  else hue = 60.0 * ((c.r - c.g) / delta + 4.0);
  return hue < 0.0 ? hue + 360.0 : hue;
}
vec3 mixColour(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 e = toEncoded(c);
  float eHigh = max(e.r, max(e.g, e.b));
  float eDelta = eHigh - min(e.r, min(e.g, e.b));
  float guard = smoothstep(0.02, 0.15, eHigh > 0.0 ? eDelta / eHigh : 0.0);
  float high = max(c.r, max(c.g, c.b));
  float delta = high - min(c.r, min(c.g, c.b));
  if (guard == 0.0 || delta <= 0.0) return c;
  float seen = hueOf(e, eHigh, eDelta);
  float centres[9] = float[9](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0, 360.0);
  int index = 7;
  for (int i = 0; i < 7; i++) { if (seen >= centres[i] && seen < centres[i + 1]) { index = i; break; } }
  float t = (seen - centres[index]) / (centres[index + 1] - centres[index]);
  t = t * t * (3.0 - 2.0 * t);
  int next = (index + 1) % 8;
  float hueShift = mix(mixerAt(index), mixerAt(next), t) * guard;
  float satShift = mix(mixerAt(8 + index), mixerAt(8 + next), t) * guard;
  float lumShift = mix(mixerAt(16 + index), mixerAt(16 + next), t) * guard;
  float hue = hueOf(c, high, delta);
  float sat = delta / high;
  float newHue = mod(hue + hueShift * ${MIXER_HUE_DEGREES.toFixed(1)}, 360.0);
  float newSat = clamp(sat * (1.0 + satShift * ${MIXER_SATURATION.toFixed(2)}), 0.0, 1.0);
  float value = high * exp2(lumShift * ${MIXER_LUMINANCE_EV.toFixed(2)});
  float chroma = value * newSat;
  float h = newHue / 60.0;
  float x = chroma * (1.0 - abs(mod(h, 2.0) - 1.0));
  vec3 rgb;
  if (h < 1.0) rgb = vec3(chroma, x, 0.0);
  else if (h < 2.0) rgb = vec3(x, chroma, 0.0);
  else if (h < 3.0) rgb = vec3(0.0, chroma, x);
  else if (h < 4.0) rgb = vec3(0.0, x, chroma);
  else if (h < 5.0) rgb = vec3(x, 0.0, chroma);
  else rgb = vec3(chroma, 0.0, x);
  return rgb + vec3(value - chroma);
}

void main() {
  vec4 texel = texture(src, uv);
  vec3 c = toLinear(texel.rgb) * channelGain;
  if (useCalib) c = max(calib * c, vec3(0.0));
  if (highlights != 0.0 || shadows != 0.0 || blackPoint != 0.0 || whitePoint != 1.0) {
    c = (c - blackPoint) / (whitePoint - blackPoint);
    float perceived = toEncoded(vec3(luma(c))).r;
    float f = max(0.0, 1.0 + shadows * (1.0 - smoothstep(0.0, 0.6, perceived)) + highlights * smoothstep(0.4, 1.0, perceived));
    c *= f;
  }
  // Match the CPU midtone curve. Endpoints are fixed, so pure white/black are not lifted.
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
  c = vec3(y) + (c - vec3(y)) * saturation;
  if (useMixer) c = mixColour(c);
  vec3 e = toEncoded(c);
  if (contrast != 1.0) e = clamp(0.5 + (e - 0.5) * contrast, 0.0, 1.0);
  if (useGrade) {
    float l = luma(e);
    float ws = 1.0 - smoothstep(0.0, gradePivot, l);
    float wh = smoothstep(gradePivot, 1.0, l);
    float wm = max(0.0, 1.0 - ws - wh);
    e = clamp(e + ws * gradeS + wm * gradeM + wh * gradeH, 0.0, 1.0);
  }
  if (useCurve) e = vec3(applyCurve(e.r), applyCurve(e.g), applyCurve(e.b));
  outColour = vec4(e, texel.a);
}`;

// Second pass: texture, clarity and sharpening. Blurs come from mipmap levels of the first pass,
// which approximate the box blurs used by applyDetail on the CPU.
const DETAIL = `#version 300 es
precision highp float;
uniform sampler2D tone;
uniform float sharpen, texture_, clarity, sharpenLod, textureLod_, clarityLod;
float coreDetail(float b) { return b * b * b / (b * b + ${DETAIL_CORE} * ${DETAIL_CORE}); }
in vec2 uv;
out vec4 outColour;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  // The first pass wrote this texture bottom-up, so flip the lookup.
  vec2 at = vec2(uv.x, 1.0 - uv.y);
  vec4 t = texture(tone, at);
  float l = luma(t.rgb);
  float add = 0.0;
  // Same as applyDetail in photoEdits.ts: positive Texture and Clarity boost a soft-cored band measured from a lightly
  // smoothed copy, so noise in smooth backgrounds is not amplified; negative amounts soften everything.
  float fine = luma(textureLod(tone, at, sharpenLod).rgb);
  if (sharpen != 0.0) add += sharpen * (l - fine);
  if (texture_ != 0.0) {
    float tb = luma(textureLod(tone, at, textureLod_).rgb);
    add += texture_ * (texture_ > 0.0 ? coreDetail(fine - tb) : l - tb);
  }
  if (clarity != 0.0) {
    float cb = luma(textureLod(tone, at, clarityLod).rgb);
    add += clarity * 4.0 * l * (1.0 - l) * (clarity > 0.0 ? coreDetail(fine - cb) : l - cb);
  }
  outColour = vec4(clamp(t.rgb + add, 0.0, 1.0), t.a);
}`;

interface Gpu {
  detailProgram: WebGLProgram;
  toneTexture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  toneSize: [number, number];
  canvas: HTMLCanvasElement | OffscreenCanvas;
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

function setup(): Gpu | null {
  try {
    // A page canvas on the page; in a worker (the live draft worker), an OffscreenCanvas: the same shaders, the same answer.
    const canvas: HTMLCanvasElement | OffscreenCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1);
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.useProgram(program);
    const location = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, name, value);
    const detailProgram = gl.createProgram()!;
    gl.attachShader(detailProgram, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(detailProgram, compile(gl, gl.FRAGMENT_SHADER, DETAIL));
    gl.linkProgram(detailProgram);
    if (!gl.getProgramParameter(detailProgram, gl.LINK_STATUS)) return null;
    const toneTexture = gl.createTexture()!;
    const framebuffer = gl.createFramebuffer()!;
    canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); gpu = undefined; });
    return { canvas, gl, program, texture, detailProgram, toneTexture, framebuffer, toneSize: [0, 0], maxSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
  } catch {
    return null;
  }
}

/** Render an edit on the GPU into the given canvas. Returns false when the CPU path should run instead. */
export function renderEditOnGpu(target: HTMLCanvasElement, edit: PhotoEdit, imageEdge = Math.max(target.width, target.height)): boolean {
  if (gpu === undefined) gpu = setup();
  if (!gpu || gpu.gl.isContextLost()) return false;
  const { canvas, gl, program, texture, maxSize } = gpu;
  const params = editParams(edit);
  // Three channel tables would exceed the fragment uniform budget of many GPUs, so channel curves render on the CPU path.
  if (params.channelLuts) return false;
  const detail = hasDetail(edit);
  const { width, height } = target;
  if (!width || !height || width > maxSize || height > maxSize) return false;
  const context = target.getContext('2d');
  if (!context) return false;
  try {
    // Read and write the picture in the target canvas's own colour space, so a Display P3 screen canvas is not
    // squeezed into sRGB on the way to the GPU and back. Browsers without these settings keep sRGB, as before.
    const space = context.getContextAttributes?.().colorSpace ?? 'srgb';
    const colourAware = gl as WebGL2RenderingContext & { drawingBufferColorSpace?: PredefinedColorSpace; unpackColorSpace?: PredefinedColorSpace };
    if ('drawingBufferColorSpace' in colourAware && colourAware.drawingBufferColorSpace !== space) colourAware.drawingBufferColorSpace = space;
    if ('unpackColorSpace' in colourAware && colourAware.unpackColorSpace !== space) colourAware.unpackColorSpace = space;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, target);
    gl.uniform3f(gl.getUniformLocation(program, 'channelGain'), ...params.channelGain);
    for (const [name, value] of Object.entries({
      brightness: params.brightness, colour: params.colour, contrast: params.contrast,
      highlights: params.highlights, shadows: params.shadows, blackPoint: params.blackPoint,
      whitePoint: params.whitePoint, vibrance: params.vibrance,
    })) gl.uniform1f(gl.getUniformLocation(program, name), value);
    gl.uniform1i(gl.getUniformLocation(program, 'useCurve'), params.curve ? 1 : 0);
    if (params.curve) {
      const padded = new Float32Array(CURVE_VEC4S * 4);
      padded.set(params.curve);
      gl.uniform4fv(gl.getUniformLocation(program, 'curveLut'), padded);
    }
    gl.uniform1i(gl.getUniformLocation(program, 'useMixer'), params.mixer ? 1 : 0);
    if (params.mixer) gl.uniform4fv(gl.getUniformLocation(program, 'mixerP'), params.mixer);
    gl.uniform1i(gl.getUniformLocation(program, 'useCalib'), params.calibration ? 1 : 0);
    // GLSL matrices are column-major and ours is row-major, so pass it transposed.
    if (params.calibration) {
      const m = params.calibration;
      gl.uniformMatrix3fv(gl.getUniformLocation(program, 'calib'), false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
    }
    gl.uniform1i(gl.getUniformLocation(program, 'useGrade'), params.grade ? 1 : 0);
    if (params.grade) {
      gl.uniform3fv(gl.getUniformLocation(program, 'gradeS'), params.grade.subarray(0, 3));
      gl.uniform3fv(gl.getUniformLocation(program, 'gradeM'), params.grade.subarray(3, 6));
      gl.uniform3fv(gl.getUniformLocation(program, 'gradeH'), params.grade.subarray(6, 9));
      gl.uniform1f(gl.getUniformLocation(program, 'gradePivot'), params.grade[9]);
    }
    if (detail) {
      // Pass 1 renders the tone edit into a texture, and pass 2 adds detail while reading its mipmaps.
      const { toneTexture, framebuffer, detailProgram } = gpu;
      gl.bindTexture(gl.TEXTURE_2D, toneTexture);
      if (gpu.toneSize[0] !== width || gpu.toneSize[1] !== height) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gpu.toneSize = [width, height];
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, toneTexture, 0);
      gl.bindTexture(gl.TEXTURE_2D, texture); // read the photo, never the texture being written
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, toneTexture);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.useProgram(detailProgram);
      const d = detailParams(edit, imageEdge);
      const lod = (radius: number) => Math.log2(2 * radius + 1);
      for (const [name, value] of Object.entries({
        sharpen: d.sharpen, texture_: d.texture, clarity: d.clarity,
        sharpenLod: lod(d.sharpenRadius), textureLod_: lod(d.textureRadius), clarityLod: lod(d.clarityRadius),
      })) gl.uniform1f(gl.getUniformLocation(detailProgram, name), value);
      gl.uniform1i(gl.getUniformLocation(detailProgram, 'tone'), 0);
      const location = gl.getAttribLocation(detailProgram, 'p');
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.useProgram(program);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    } else {
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
