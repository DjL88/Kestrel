import { detailParams, editParams, hasDetail, type PhotoEdit } from '../core/photoEdits';

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
uniform float gain, brightness, warmth, colour, contrast, highlights, shadows, blackPoint, whitePoint, vibrance;
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

void main() {
  vec4 texel = texture(src, uv);
  vec3 c = toLinear(texel.rgb) * gain * vec3(1.0 + warmth, 1.0, 1.0 - warmth);
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
  vec3 e = toEncoded(c);
  if (contrast != 1.0) e = clamp(0.5 + (e - 0.5) * contrast, 0.0, 1.0);
  outColour = vec4(e, texel.a);
}`;

// Second pass: texture, clarity and sharpening. Blurs come from mipmap levels of the first pass,
// which approximate the box blurs used by applyDetail on the CPU.
const DETAIL = `#version 300 es
precision highp float;
uniform sampler2D tone;
uniform float sharpen, texture_, clarity, sharpenLod, textureLod_, clarityLod;
in vec2 uv;
out vec4 outColour;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  // The first pass wrote this texture bottom-up, so flip the lookup.
  vec2 at = vec2(uv.x, 1.0 - uv.y);
  vec4 t = texture(tone, at);
  float l = luma(t.rgb);
  float add = 0.0;
  if (sharpen != 0.0) add += sharpen * (l - luma(textureLod(tone, at, sharpenLod).rgb));
  if (texture_ != 0.0) add += texture_ * (l - luma(textureLod(tone, at, textureLod_).rgb));
  if (clarity != 0.0) add += clarity * 4.0 * l * (1.0 - l) * (l - luma(textureLod(tone, at, clarityLod).rgb));
  outColour = vec4(clamp(t.rgb + add, 0.0, 1.0), t.a);
}`;

interface Gpu {
  detailProgram: WebGLProgram;
  toneTexture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  toneSize: [number, number];
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

function setup(): Gpu | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
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
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, target);
    const params = editParams(edit);
    for (const [name, value] of Object.entries({
      gain: params.gain, brightness: params.brightness, warmth: params.warmth, colour: params.colour, contrast: params.contrast,
      highlights: params.highlights, shadows: params.shadows, blackPoint: params.blackPoint,
      whitePoint: params.whitePoint, vibrance: params.vibrance,
    })) gl.uniform1f(gl.getUniformLocation(program, name), value);
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
