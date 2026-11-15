import { editParams, type PhotoEdit } from '../core/photoEdits';

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
uniform float gain, warmth, colour, contrast, highlights, shadows, blackPoint, whitePoint, vibrance;
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
  float y = luma(c);
  float saturation = 1.0 + colour;
  if (vibrance != 0.0) {
    float high = max(c.r, max(c.g, c.b));
    float chroma = high > 0.0 ? (high - min(c.r, min(c.g, c.b))) / high : 0.0;
    saturation += vibrance * (1.0 - min(1.0, chroma));
  }
  c = vec3(y) + (c - vec3(y)) * saturation;
  vec3 e = toEncoded(c);
  if (contrast != 1.0) e = clamp(0.5 + (e - 0.5) * contrast, 0.0, 1.0);
  outColour = vec4(e, texel.a);
}`;

interface Gpu {
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
    canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); gpu = undefined; });
    return { canvas, gl, program, texture, maxSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
  } catch {
    return null;
  }
}

/** Render an edit on the GPU into the given canvas. Returns false when the CPU path should run instead. */
export function renderEditOnGpu(target: HTMLCanvasElement, edit: PhotoEdit): boolean {
  if (gpu === undefined) gpu = setup();
  if (!gpu || gpu.gl.isContextLost()) return false;
  const { canvas, gl, program, texture, maxSize } = gpu;
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
      gain: params.gain, warmth: params.warmth, colour: params.colour, contrast: params.contrast,
      highlights: params.highlights, shadows: params.shadows, blackPoint: params.blackPoint,
      whitePoint: params.whitePoint, vibrance: params.vibrance,
    })) gl.uniform1f(gl.getUniformLocation(program, name), value);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    context.globalCompositeOperation = 'copy';
    context.drawImage(canvas, 0, 0);
    context.globalCompositeOperation = 'source-over';
    return true;
  } catch {
    return false;
  }
}
