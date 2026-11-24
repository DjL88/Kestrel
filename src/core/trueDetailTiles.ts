/** Developed display-encoded RGB16, not sensor CFA. Model input/output:
 * RGB float32 NCHW [1,3,256,256], range 0..1, restored image (not residual).
 * A model must be independently validated for this exact contract and context.
 */
export const TRUEDETAIL_TILE = 256;
export const TRUEDETAIL_HALO = 32;
export type TileInference = (input: Float32Array, signal?: AbortSignal) => Promise<Float32Array>;

export interface TrueDetailOptions {
  strength: number;
  /** Subject coverage in the same framed coordinates, 0..1 per pixel. */
  subjectAlpha?: Float32Array;
  subjectProtection?: number;
  signal?: AbortSignal;
  progress?: (done: number, total: number) => void;
}

/** No output escapes until every tile has passed validation. The original
 * is never mutated. Only one inference tile is live at a time. The returned
 * RGB16 working copy is intentionally separate from any persisted original.
 */
export async function runTrueDetailTiles(source: Uint16Array, width: number, height: number,
  infer: TileInference, options: TrueDetailOptions): Promise<Uint16Array> {
  const count = width*height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width<1 || height<1 ||
      count>80_000_000 || source.length!==count*3) throw new RangeError('Invalid RGB16 image');
  const {strength,subjectAlpha,signal,progress}=options;
  const protection=options.subjectProtection ?? 0.4;
  if (![strength,protection].every(v=>Number.isFinite(v)&&v>=0&&v<=1) ||
      (subjectAlpha && subjectAlpha.length!==count)) throw new RangeError('Invalid TrueDetail strength or mask');
  if (subjectAlpha) for(const a of subjectAlpha) if(!Number.isFinite(a)||a<0||a>1) throw new RangeError('Invalid subject coverage');
  signal?.throwIfAborted();
  const result=source.slice();
  if(!strength) return result;
  const size=TRUEDETAIL_TILE, halo=TRUEDETAIL_HALO, step=size-2*halo, plane=size*size;
  const total=Math.ceil(width/step)*Math.ceil(height/step);
  let done=0;
  for(let y=0;y<height;y+=step) for(let x=0;x<width;x+=step) {
    signal?.throwIfAborted();
    const input=new Float32Array(plane*3);
    for(let ty=0;ty<size;ty++) for(let tx=0;tx<size;tx++) {
      const sx=Math.max(0,Math.min(width-1,x+tx-halo)), sy=Math.max(0,Math.min(height-1,y+ty-halo));
      for(let c=0;c<3;c++) input[c*plane+ty*size+tx]=source[(sy*width+sx)*3+c]/65535;
    }
    const candidate=await infer(input,signal);
    signal?.throwIfAborted();
    if(!(candidate instanceof Float32Array)||candidate.length!==input.length) throw new Error('Unexpected denoise output shape');
    for(const v of candidate) if(!Number.isFinite(v)||v<0||v>1) throw new Error('Invalid denoise output samples');
    // Discard padded margins; each destination pixel is written exactly once.
    for(let dy=0;dy<Math.min(step,height-y);dy++) for(let dx=0;dx<Math.min(step,width-x);dx++) {
      const p=(y+dy)*width+x+dx, t=(dy+halo)*size+dx+halo;
      const amount=strength*(1-(subjectAlpha?.[p]??0)*(1-protection));
      for(let c=0;c<3;c++) {
        const original=source[p*3+c];
        result[p*3+c]=Math.round(original+(candidate[c*plane+t]*65535-original)*amount);
      }
    }
    progress?.(++done,total);
  }
  signal?.throwIfAborted();
  return result;
}
