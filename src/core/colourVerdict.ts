import type { ColourReport } from './colourCheck';

/**
 * One plain verdict on a photo's colours, for Colour-vision support (Dave, a colour-blind user, 27 Nov: "I just want
 * 'Colours look normal' or 'Colours look over-saturated, click here to correct'"). Worked out only from what
 * checkColour measured, at its own thresholds; nothing new is judged here. The single most important issue leads, the
 * others wait under "More". With no measurement the verdict is "not sure": unknown stays unknown.
 */
export type ColourVerdictKind =
  | 'normal' | 'overSaturated' | 'underSaturated' | 'tooWarm' | 'tooCool' | 'greenTint' | 'magentaTint' | 'castLeft' | 'castNatural' | 'redGreenAlike' | 'unsure';

/** The one undoable adjustment "Correct" makes: this much added to this slider. */
export interface ColourFix { setting: 'saturation' | 'temperature' | 'tint'; delta: number }

export interface ColourIssue {
  kind: ColourVerdictKind;
  /** Absent when there is nothing to correct (normal, not sure) or the answer is to look (red and green alike). */
  fix?: ColourFix;
}

export interface ColourVerdict extends ColourIssue {
  /** Other things found, less important than the verdict, most important first. */
  more: ColourIssue[];
}

const CAST = {
  warm: { kind: 'tooWarm', setting: 'temperature', sign: -1 },
  cool: { kind: 'tooCool', setting: 'temperature', sign: 1 },
  // Tint runs from green (down) to magenta (up), so a green cast is corrected upwards.
  green: { kind: 'greenTint', setting: 'tint', sign: 1 },
  magenta: { kind: 'magentaTint', setting: 'tint', sign: -1 },
} as const;

export function colourVerdict(report: ColourReport | null | undefined): ColourVerdict {
  if (!report) return { kind: 'unsure', more: [] };
  // Each issue with how much it matters; the highest leads.
  const found: Array<ColourIssue & { weight: number }> = [];
  for (const finding of report.findings) {
    if (finding.id === 'clippedColour') found.push({ kind: 'overSaturated', fix: { setting: 'saturation', delta: -12 }, weight: 90 });
    else if (finding.id === 'strongColour') {
      const warning = finding.severity === 'warning';
      found.push({ kind: 'overSaturated', fix: { setting: 'saturation', delta: warning ? -12 : -8 }, weight: warning ? 85 : 40 });
    } else if (finding.id === 'cast') {
      const cast = CAST[finding.direction];
      const clear = finding.amount === 'clear';
      // Re-measured (src/core/castCurve.ts): expected warm light is natural, a cast nothing visible can fix is said plainly
      // with no useless nudge, and a fixable one carries the correction actually measured rather than a fixed amount.
      if (finding.status === 'natural') found.push({ kind: 'castNatural', weight: 20 });
      else if (finding.status === 'left') found.push({ kind: 'castLeft', weight: 20 });
      else found.push({ kind: cast.kind, fix: { setting: cast.setting, delta: finding.fixDelta ?? cast.sign * (clear ? 10 : 5) }, weight: clear ? 80 : 50 });
    } else if (finding.id === 'muted') found.push({ kind: 'underSaturated', fix: { setting: 'saturation', delta: 12 }, weight: 60 });
    else if (finding.id === 'redGreenAlike') found.push({ kind: 'redGreenAlike', weight: 30 });
  }
  found.sort((a, b) => b.weight - a.weight);
  // One line per kind: clipped and very strong colour are the same verdict.
  const issues: ColourIssue[] = [];
  for (const { weight: _weight, ...issue } of found) if (!issues.some((kept) => kept.kind === issue.kind)) issues.push(issue);
  if (!issues.length) return { kind: 'normal', more: [] };
  return { ...issues[0], more: issues.slice(1) };
}
