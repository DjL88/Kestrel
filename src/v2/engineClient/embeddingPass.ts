import { v2Text } from '../../i18n/areas/v2';

/** Said once when the look-alike model cannot run, so the quiet fallback to time-based bursts is never a surprise. In the person's language. */
export const visualGroupingUnavailable = (): string => v2Text.burstGrouping.unavailable;

export interface EmbeddingPass<Frame extends { id: string }, Picture, Embedding> {
  /** The next photo to embed, or undefined when none is left. */
  next: () => Frame | undefined;
  /** False once the editor closes or the project changes. */
  stillCurrent: () => boolean;
  picture: (frame: Frame) => Promise<Picture | null>;
  /** Throws when the model is missing or fails its check. */
  embed: (picture: Picture) => Promise<Embedding | null>;
  onEmbedded: (frameId: string, embedding: Embedding) => void;
  onBatchDone: () => void;
  onUnavailable: (message: string) => void;
  /** Never offer this photo again in this pass (no picture, or done). */
  skip: (frameId: string) => void;
  /** Wait until the person has paused (no recent input) before the heavy model work. Optional. */
  untilQuiet?: () => Promise<void>;
  /** Yield between photos so the interface stays responsive. */
  pause: () => Promise<void>;
  batch: number;
}

/**
 * One background pass over the photos still to embed, on this device. 'halted' means the model could not run and
 * grouping stays time-based for this session; 'stopped' means the editor or project changed; 'done' means none is left.
 */
export async function runEmbeddingPass<Frame extends { id: string }, Picture, Embedding>(
  pass: EmbeddingPass<Frame, Picture, Embedding>,
): Promise<'done' | 'halted' | 'stopped'> {
  let sinceBatch = 0;
  try {
    for (;;) {
      if (!pass.stillCurrent()) return 'stopped';
      const frame = pass.next();
      if (!frame) return 'done';
      const picture = await pass.picture(frame).catch(() => null);
      if (!pass.stillCurrent()) return 'stopped';
      if (!picture) { pass.skip(frame.id); continue; }
      if (pass.untilQuiet) {
        await pass.untilQuiet();
        if (!pass.stillCurrent()) return 'stopped';
      }
      let embedding: Embedding | null = null;
      try {
        embedding = await pass.embed(picture);
      } catch {
        pass.onUnavailable(visualGroupingUnavailable());
        return 'halted';
      }
      if (!pass.stillCurrent()) return 'stopped';
      pass.skip(frame.id);
      if (embedding) { pass.onEmbedded(frame.id, embedding); sinceBatch += 1; }
      if (sinceBatch >= pass.batch) { pass.onBatchDone(); sinceBatch = 0; }
      await pass.pause();
    }
  } finally {
    if (sinceBatch > 0) pass.onBatchDone();
  }
}
