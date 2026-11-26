import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_CAPTION_TEMPLATE, captionMetadataFor, expandCaption, parseCaptionTemplate, parseCodeReplacements,
  readCaptionTemplate, writeCaptionTemplate,
} from './captionTemplate.ts';
import { tiffXmpPacket } from './tiffExportMetadata.ts';
import type { PhotoFrame } from './types.ts';

const frame = {
  filename: 'DSC_1234.NEF',
  subjectNames: ['Eurofighter Typhoon'],
  exif: { camera: 'NIKON Z 8', lens: 'NIKKOR Z 180-600mm', captureStamp: { original: '2026:07:19 14:03:22' } },
} as Pick<PhotoFrame, 'filename' | 'exif' | 'subjectNames'>;

test('code replacements read the usual separators, ignore case, and the first repeat wins', () => {
  const codes = parseCodeReplacements('z8 = Nikon Z 8\nRAF\tRoyal Air Force\nml: Mach Loop, Wales\nz8 = other\nbroken line\n');
  assert.equal(codes.get('z8'), 'Nikon Z 8');
  assert.equal(codes.get('raf'), 'Royal Air Force');
  assert.equal(codes.get('ml'), 'Mach Loop, Wales');
  assert.equal(codes.size, 3);
});

test('a caption expands codes and photo fields; an unknown code stays visible', () => {
  const codes = parseCodeReplacements('raf = Royal Air Force\nloc = \\ml\\ on {date}\nml = Mach Loop');
  const text = expandCaption('\\RAF\\ {subject} at \\loc\\, shot on {camera}. \\nope\\', codes, {
    subject: 'Typhoon', date: '19 July 2026', camera: 'NIKON Z 8',
  });
  assert.equal(text, 'Royal Air Force Typhoon at Mach Loop on 19 July 2026, shot on NIKON Z 8. \\nope\\');
});

test('captions are off unless switched on, and fill every IPTC field from the template', () => {
  assert.equal(captionMetadataFor(frame, EMPTY_CAPTION_TEMPLATE), null);
  const metadata = captionMetadataFor(frame, {
    ...EMPTY_CAPTION_TEMPLATE, enabled: true,
    title: '{subject}', caption: '{subject} over \\ml\\, {date}. {filename}', creator: 'Dave', copyright: '© 2026 Dave',
    credit: 'InFlight', city: '\\ml\\', country: 'United Kingdom', keywords: 'aviation, \\ml\\, aviation', codes: 'ml = Mach Loop',
  })!;
  assert.equal(metadata.title, 'Eurofighter Typhoon');
  assert.equal(metadata.caption, 'Eurofighter Typhoon over Mach Loop, 19 July 2026. DSC_1234');
  assert.equal(metadata.city, 'Mach Loop');
  assert.deepEqual(metadata.keywords, ['aviation', 'Mach Loop']);
  const xmp = new TextDecoder().decode(tiffXmpPacket(metadata)!);
  assert.match(xmp, /xmlns:photoshop="http:\/\/ns.adobe.com\/photoshop\/1.0\/"/);
  assert.match(xmp, /<photoshop:Credit>InFlight<\/photoshop:Credit>/);
  assert.match(xmp, /<photoshop:City>Mach Loop<\/photoshop:City>/);
  assert.match(xmp, /<photoshop:Country>United Kingdom<\/photoshop:Country>/);
  assert.match(xmp, /<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">© 2026 Dave<\/rdf:li>/);
});

test('unknown photo fields stay blank, never guessed', () => {
  const bare = { filename: 'a.jpg', exif: {} } as Pick<PhotoFrame, 'filename' | 'exif' | 'subjectNames'>;
  const metadata = captionMetadataFor(bare, { ...EMPTY_CAPTION_TEMPLATE, enabled: true, caption: '{subject} {date} {camera}' })!;
  assert.equal(metadata.caption, '');
});

test('the template is bounded, and stored and read back on this device', () => {
  const parsed = parseCaptionTemplate({ enabled: 'yes', title: 'x'.repeat(500), caption: 7 });
  assert.equal(parsed.enabled, false);
  assert.equal(parsed.title.length, 200);
  assert.equal(parsed.caption, '');
  const memory = new Map<string, string>();
  const store = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) };
  assert.equal(writeCaptionTemplate(store, { ...EMPTY_CAPTION_TEMPLATE, enabled: true, creator: 'Dave' }), true);
  assert.equal(readCaptionTemplate(store).creator, 'Dave');
  assert.deepEqual(readCaptionTemplate(null), EMPTY_CAPTION_TEMPLATE);
});
