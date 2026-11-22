/**
 * How much help a photographer wants, without introducing a separate "AI" mode.
 * The camera, editing and export pipelines remain fully usable in every mode.
 */
export const GUIDANCE_MODES = ['soar', 'glide', 'solo'] as const;
export type GuidanceMode = typeof GUIDANCE_MODES[number];

export const DEFAULT_GUIDANCE_MODE: GuidanceMode = 'glide';

export const GUIDANCE_CHOICES: ReadonlyArray<{
  value: GuidanceMode;
  label: string;
  description: string;
}> = [
  { value: 'soar', label: 'Auto Pilot', description: 'Safe, reversible improvements where InFlight has strong evidence.' },
  { value: 'glide', label: 'Co Pilot', description: 'Quiet suggestions while you edit. You choose what to apply.' },
  { value: 'solo', label: 'Solo', description: 'Complete control. Advice only when you ask for it.' },
] as const;

export function parseGuidanceMode(value: unknown): GuidanceMode {
  return (GUIDANCE_MODES as readonly unknown[]).includes(value) ? value as GuidanceMode : DEFAULT_GUIDANCE_MODE;
}

/** A completed export is never blocked by guidance and never silently altered by it. */
export function observeGuidance(mode: GuidanceMode, event: 'idle' | 'manual' | 'finish' | 'export'): boolean {
  return event === 'manual' || mode !== 'solo';
}

/**
 * Auto changes may run only for high-confidence, not-manually-refined proposals.
 * A suggestion or diagnostic is never permission to change existing user edits.
 */
export function mayApplyGuidance(
  mode: GuidanceMode,
  confidence: 'high' | 'medium' | 'low',
  manuallyRefined: boolean,
): boolean {
  return mode === 'soar' && confidence === 'high' && !manuallyRefined;
}
