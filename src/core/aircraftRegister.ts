import type { Marking } from './aircraftRegistration';

/**
 * Vehicle and aircraft recognition, step 2: the exact type (and, for companies and governments, the operator) for a
 * registration read from the photo, from offline copies of public registers. Nothing is looked up online.
 *
 * - United States (N-numbers): the FAA register, public domain (`src/assets/registers/faa.json`, made by
 *   `tools/registers/make_faa_register.py`). No individual's name or address is copied.
 * - UK military serials: there is no public bulk register, so this is a short curated list of serial blocks of types in
 *   service, from public sources. A block only names a type when the photo's own kind agrees (a Typhoon block on a picture
 *   read as a military jet), and the result is worded "probably".
 * - UK (G-) and Irish (EI-) civil registrations: the CAA's G-INFO data is sold under copyright and single-PC terms, and no
 *   licensed Irish bulk copy was found, so these are recognised and searchable but never looked up. Unknown stays unknown.
 */
export type RegisterSource = 'faa' | 'uk-military-blocks';

export interface RegisterMatch {
  type: string;
  operator?: string;
  register: RegisterSource;
  /** True for an exact register record; false for a serial block, which is "probably". */
  exact: boolean;
  /** The vehicle kind the record implies, when known, so it can be checked against the picture. */
  kind?: string;
}

export interface FaaRegisterFile { types: string[]; operators: string[]; entries: string; extracted: string }

export interface FaaRegister { find(nNumber: string): { type: string; operator?: string } | null; extracted: string }

/** Index the FAA copy once: a sorted list searched by halves, so 320,000 entries cost no more than their own text. */
export function faaRegister(file: FaaRegisterFile): FaaRegister {
  const lines = file.entries.split('\n');
  const keyOf = (line: string) => line.slice(0, line.indexOf(','));
  return {
    extracted: file.extracted,
    find(nNumber) {
      const key = nNumber.toUpperCase().replace(/^N/, '');
      let low = 0, high = lines.length - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const at = keyOf(lines[middle]);
        if (at === key) {
          const [, type, operator] = lines[middle].split(',');
          const typeName = file.types[parseInt(type, 16)];
          if (!typeName) return null;
          const operatorName = operator === undefined ? undefined : file.operators[parseInt(operator, 16)];
          return operatorName ? { type: typeName, operator: operatorName } : { type: typeName };
        }
        if (at < key) low = middle + 1; else high = middle - 1;
      }
      return null;
    },
  };
}

/**
 * UK military serial blocks of types often seen at the Mach Loop, at UK airshows and over Wales. Curated from public
 * sources (25 Nov 2026); deliberately short, and only blocks without known overlaps. `type` ids match labels.json.
 */
export const UK_MILITARY_BLOCKS: readonly { from: string; to: string; type: string; kind: string }[] = [
  { from: 'ZJ800', to: 'ZJ950', type: 'typhoon', kind: 'military-jet' },
  { from: 'ZK300', to: 'ZK437', type: 'typhoon', kind: 'military-jet' },
  { from: 'ZM135', to: 'ZM175', type: 'f-35', kind: 'military-jet' },
  { from: 'ZK010', to: 'ZK037', type: 'hawk', kind: 'military-jet' },
  { from: 'ZM400', to: 'ZM421', type: 'a400m', kind: 'military-transport' },
  { from: 'ZZ171', to: 'ZZ178', type: 'c-17', kind: 'military-transport' },
  { from: 'ZZ330', to: 'ZZ343', type: 'voyager', kind: 'military-transport' },
  { from: 'ZP801', to: 'ZP809', type: 'p-8', kind: 'military-transport' },
  { from: 'ZM300', to: 'ZM319', type: 'texan', kind: 'light-aircraft' },
];

/** The type name for a labels.json type id, supplied by the caller (so this stays free of the label file). */
export type TypeName = (typeId: string) => string | undefined;

/**
 * Look one marking up. `pictureKind` is the vehicle kind the picture itself was read as (or undefined when only "Aircraft"
 * was clear): a serial block names its type only when that kind agrees. Returns null when nothing is known.
 */
export function lookUpMarking(marking: Marking, registers: { faa?: FaaRegister | null }, pictureKind: string | undefined, typeName: TypeName): RegisterMatch | null {
  if (marking.format === 'us-civil') {
    const found = registers.faa?.find(marking.value);
    return found ? { ...found, register: 'faa', exact: true } : null;
  }
  if (marking.format === 'uk-military') {
    const prefix = marking.value.slice(0, 2);
    const number = Number(marking.value.slice(2));
    const block = UK_MILITARY_BLOCKS.find((entry) => entry.from.slice(0, 2) === prefix && number >= Number(entry.from.slice(2)) && number <= Number(entry.to.slice(2)));
    const name = block ? typeName(block.type) : undefined;
    if (!block || !name || pictureKind !== block.kind) return null;
    return { type: name, register: 'uk-military-blocks', exact: false, kind: block.kind };
  }
  return null; // G- and EI-: recognised, never looked up (no licensed offline register).
}
