import type { ColourFamily, ColourFinding, ColourReport } from '../../core/colourCheck';
import { colourText as t } from '../../i18n/areas/colour';

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
