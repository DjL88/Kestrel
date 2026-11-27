import type { ColourArea, ColourFamily, ColourFinding, ColourReport } from '../../core/colourCheck';
import { COLOUR_SENSE_TOLERANCE, type ChannelName, type ColourSenseResult } from '../../core/colourSense';
import type { ColourMatchResult } from '../../core/colourMatch';
import { colourText as t } from '../../i18n/areas/colour';

/**
 * Colour match in words: does the subject carry the colours this subject should have? `kept` is true when every
 * expected colour was found. A difference always carries the caveat, because light, age, moult and a wrong name all
 * change colour.
 */
export function describeColourMatch(result: ColourMatchResult | null | undefined): ColourSenseNote | undefined {
  if (!result) return undefined;
  const measured = result.measured.slice(0, 2).map((entry) => t.family[entry.family]);
  const mostly = measured.length > 1 ? t.and(measured[0], measured[1]) : measured[0] ?? '';
  const sentences = result.parts.map((part) => {
    const colour = t.family[part.expected[0]];
    const where = t.matchPart[part.part];
    return part.verdict === 'matches' ? t.matchFound(colour, where) : t.matchMissing(colour, where, mostly);
  });
  if (result.verdict === 'differs') sentences.push(t.matchCaveat);
  return { kept: result.verdict === 'matches', label: t.matchLabel(result.subject), text: sentences.join(' ') };
}

/** ColourSense for one suggestion: whether the subject keeps its colour, in words. `fix` is the one-tap way back when
 * the subject's colour moved warmer or cooler: 'cooler' when it moved warmer, 'warmer' when it moved cooler. */
export interface ColourSenseNote { kept: boolean; label: string; text: string; fix?: 'cooler' | 'warmer' }

/** How warm each colour name reads, from blue (coolest) to orange (warmest). Greys, black and white have no warmth. */
const WARMTH: Partial<Record<ColourFamily, number>> = { blue: 0, teal: 1, purple: 1, green: 2, lime: 3, pink: 3, yellow: 4, brown: 4, red: 4, orange: 5 };

/** Which way to nudge the warmth back after the subject's colour name moved, or nothing when it didn't move warmer or cooler. */
export function warmthFix(before: ColourFamily, after: ColourFamily): ColourSenseNote['fix'] {
  const from = WARMTH[before];
  const to = WARMTH[after];
  if (from === undefined || to === undefined || from === to) return undefined;
  return to > from ? 'cooler' : 'warmer';
}

const channelList = (channels: ChannelName[]) => {
  const words = channels.map((channel) => t.family[channel]);
  return words.length === 3 ? t.and(`${words[0]}, ${words[1]}`, words[2]) : words.length === 2 ? t.and(words[0], words[1]) : words[0];
};

/**
 * The subject-colour check in words, for colour-blind photographers who cannot judge the shift by eye. Nothing is said
 * when the check could not judge (no subject, or mismatched pictures): unknown stays unknown.
 */
export function describeColourSense(result: ColourSenseResult | undefined): ColourSenseNote | undefined {
  if (!result || result.verdict === 'unknown') return undefined;
  if (result.verdict === 'kept') return { kept: true, label: t.senseLabel, text: t.senseKept(t.family[result.after]) };
  const parts: string[] = [];
  if (result.outside.includes('hue')) {
    parts.push(result.before !== result.after
      ? t.senseHueTowards(t.family[result.before], t.family[result.after])
      : t.senseHueShade(t.family[result.after]));
  }
  if (result.outside.includes('saturation')) {
    if (result.nearGrey) parts.push(result.saturationChange > 0 ? t.senseGreyTinted : t.senseGreyUntinted);
    else {
      const percent = Math.round(Math.abs(result.saturationChange) * 100);
      parts.push(result.saturationChange > 0 ? t.senseStronger(percent) : t.senseWeaker(percent));
    }
  }
  if (result.outside.includes('clipping')) {
    const clipped = (['red', 'green', 'blue'] as const).filter((channel) => result.newlyClipped[channel] >= COLOUR_SENSE_TOLERANCE.clipping);
    if (clipped.length) parts.push(t.senseClipped(channelList(clipped)));
  }
  const fix = result.outside.includes('hue') ? warmthFix(result.before, result.after) : undefined;
  return { kept: false, label: t.senseLabel, text: parts.join(' '), ...(fix ? { fix } : {}) };
}

/** One colour-check finding as a sentence, with its kind said in a word as well as an icon, never by colour alone. */
export interface ColourNote { severity: ColourFinding['severity']; label: string; text: string }

/** The colour check in words, for the Colour-vision support setting. */
export interface ColourWords { palette: string[]; notes: ColourNote[] }

const names = (families: ColourFamily[]) => families.length > 1 ? t.and(t.family[families[0]], t.family[families[1]]) : t.family[families[0]] ?? '';

/** The sentence for one finding, from the colour translation area. */
export function describeColourFinding(finding: ColourFinding): string {
  switch (finding.id) {
    case 'strongColour': return t.strongColour(names(finding.families), Math.round(finding.share * 100));
    case 'clippedColour': return t.clippedColour(names(finding.families));
    case 'cast': return finding.amount === 'clear' ? `${t.cast[finding.direction]} ${t.castClear}` : t.cast[finding.direction];
    case 'muted': return t.muted;
    case 'redGreenAlike': return `${t.redGreen(t.family[finding.families[0]], t.family[finding.families[1]])} ${t.redGreenHint}`;
    case 'subjectColour': return t.subject(t.family[finding.subject], t.strength[finding.subjectStrength], t.family[finding.surroundings]);
    case 'editChange': return finding.change > 0 ? t.editStronger(Math.round(finding.change * 100)) : t.editWeaker(Math.round(-finding.change * 100));
  }
}

const LABEL = { warning: () => t.watchOut, tip: () => t.tip, info: () => t.note } as const;

/** The main colours by name and every finding as a sentence. */
export function colourWords(report: ColourReport): ColourWords {
  return {
    palette: report.palette.map((entry) => t.paletteItem(t.family[entry.family], t.strength[entry.strength], t.share(Math.round(entry.share * 100)))),
    notes: report.findings.map((finding) => ({ severity: finding.severity, label: LABEL[finding.severity](), text: describeColourFinding(finding) })),
  };
}

/** Sentences for the check's warnings, for the Colour confidence summary that everyone sees. */
export function colourWarningSentences(report: ColourReport | undefined): string[] {
  return report ? report.findings.filter((finding) => finding.severity === 'warning').map(describeColourFinding) : [];
}

/** Red and green look-alike areas for the photo, numbered so the outline is told apart by its number and name, never by colour. */
export function colourAreas(report: ColourReport): Array<{ label: string; area: ColourArea }> {
  const finding = report.findings.find((entry) => entry.id === 'redGreenAlike');
  if (!finding || finding.id !== 'redGreenAlike' || !finding.areas) return [];
  return finding.areas.map((area, index) => ({ label: `${index + 1} · ${t.family[finding.families[index]]}`, area }));
}
