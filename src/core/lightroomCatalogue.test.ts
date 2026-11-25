import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSqliteBytes, parseCreateTable, SqliteReadError } from './sqliteRead';
import { CatalogueReadError, hasCarriedDevelop, parseDevelopSettings, readCatalogue } from './lightroomCatalogue';
import { planLightroomImport, sameCaptureTime } from './lightroomImport';
import { createDemoShootState } from './cullingEngine';
import type { PhotoFrame } from './types';

/** Build a synthetic SQLite file with Node's own SQLite, then read its bytes back. */
function database(build: (db: DatabaseSync) => void, pageSize = 1024): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'lrcat-'));
  const path = join(dir, 'test.lrcat');
  try {
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA page_size = ${pageSize}; PRAGMA journal_mode = DELETE;`);
    build(db);
    db.close();
    return new Uint8Array(readFileSync(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DEVELOP = (exposure: number, extra = '') => `s = { AutoLateralCA = 0,
Blacks2012 = -12,
Clarity2012 = 15,
Contrast2012 = 20,
Exposure2012 = ${exposure},
Highlights2012 = -40,
ProcessVersion = "11.0",
Shadows2012 = 35,
Vibrance = 10,
WhiteBalance = "As Shot",
Whites2012 = 5,
ToneCurvePV2012 = { 0, 0, 255, 255 },
${extra}}`;

/** A catalogue laid out like Lightroom Classic's (the tables and columns InFlight reads), with synthetic photos. */
function catalogue(photos = 400): Uint8Array {
  return database((db) => {
    db.exec(`
      CREATE TABLE AgLibraryRootFolder (id_local INTEGER PRIMARY KEY, id_global UNIQUE NOT NULL, absolutePath UNIQUE NOT NULL DEFAULT '', name NOT NULL DEFAULT '');
      CREATE TABLE AgLibraryFolder (id_local INTEGER PRIMARY KEY, id_global UNIQUE NOT NULL, pathFromRoot NOT NULL DEFAULT '', rootFolder INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE AgLibraryFile (id_local INTEGER PRIMARY KEY, id_global UNIQUE NOT NULL, baseName NOT NULL DEFAULT '', extension NOT NULL DEFAULT '', folder INTEGER NOT NULL DEFAULT 0, sidecarExtensions);
      CREATE TABLE Adobe_images (id_local INTEGER PRIMARY KEY, id_global UNIQUE NOT NULL, captureTime, masterImage INTEGER, pick NOT NULL DEFAULT 0, rating, rootFile INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE Adobe_imageDevelopSettings (id_local INTEGER PRIMARY KEY, image INTEGER, text);
      CREATE TABLE AgLibraryKeyword (id_local INTEGER PRIMARY KEY, id_global UNIQUE NOT NULL, name, parent INTEGER);
      CREATE TABLE AgLibraryKeywordImage (id_local INTEGER PRIMARY KEY, image INTEGER NOT NULL DEFAULT 0, tag INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE AgLibraryCollection (id_local INTEGER PRIMARY KEY, creationId NOT NULL DEFAULT '', name NOT NULL DEFAULT '', parent INTEGER);
      CREATE TABLE AgLibraryCollectionImage (id_local INTEGER PRIMARY KEY, collection INTEGER NOT NULL DEFAULT 0, image INTEGER NOT NULL DEFAULT 0);
    `);
    db.exec(`INSERT INTO AgLibraryRootFolder VALUES (1, 'r1', 'C:/Users/sam/Pictures/', 'Pictures');
      INSERT INTO AgLibraryFolder VALUES (1, 'f1', '2024/Skye/', 1), (2, 'f2', '2024/Other/', 1);
      INSERT INTO AgLibraryKeyword VALUES (1, 'k1', NULL, NULL), (2, 'k2', 'Birds', 1), (3, 'k3', 'Golden eagle', 2);
      INSERT INTO AgLibraryCollection VALUES (1, 'com.adobe.ag.library.collection', 'Portfolio', NULL),
        (2, 'com.adobe.ag.library.smart_collection', 'Five stars', NULL), (3, 'com.adobe.ag.library.group', 'Trips', NULL);`);
    const file = db.prepare('INSERT INTO AgLibraryFile VALUES (?, ?, ?, ?, ?, ?)');
    const image = db.prepare('INSERT INTO Adobe_images VALUES (?, ?, ?, ?, ?, ?, ?)');
    const develop = db.prepare('INSERT INTO Adobe_imageDevelopSettings VALUES (?, ?, ?)');
    const keyword = db.prepare('INSERT INTO AgLibraryKeywordImage VALUES (NULL, ?, ?)');
    const collection = db.prepare('INSERT INTO AgLibraryCollectionImage VALUES (NULL, ?, ?)');
    db.exec('BEGIN');
    for (let i = 1; i <= photos; i++) {
      file.run(i, `g${i}`, `DSC_${String(i).padStart(4, '0')}`, 'NEF', i === 400 ? 2 : 1, null);
      const second = String(i % 60).padStart(2, '0');
      image.run(i, `i${i}`, `2024-05-01T10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${second}.12`, null, i % 3 === 0 ? 1 : i % 7 === 0 ? -1 : 0, i % 5, i);
      // Photo 2 has a very long settings text, so its record spills onto overflow pages.
      develop.run(i, i, DEVELOP(i % 2 ? 0.5 : -0.25, i === 2 ? `Look = { Name = "${'x'.repeat(5000)}", },\n` : ''));
      if (i % 4 === 0) { keyword.run(i, 2); keyword.run(i, 3); }
      if (i % 10 === 0) { collection.run(1, i); collection.run(2, i); }
    }
    // A virtual copy of photo 1.
    image.run(10_001, 'vc', '2024-05-01T10:00:01.12', 1, 1, 5, 1);
    db.exec('COMMIT');
  });
}

test('the SQLite reader returns exactly what SQLite itself stored, across interior, leaf and overflow pages', async () => {
  const rows: Array<[number, unknown, unknown, unknown]> = [];
  const bytes = database((db) => {
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a, b TEXT, c REAL)');
    const insert = db.prepare('INSERT INTO t VALUES (?, ?, ?, ?)');
    for (let i = 1; i <= 3000; i++) {
      const a = i % 4 === 0 ? null : i % 4 === 1 ? i * 1_000_003 - 2 ** 40 : i % 4 === 2 ? -i : 0;
      const b = i % 50 === 0 ? 'ü'.repeat(1500 + i) : `row ${i}`;
      insert.run(i, a, b, i / 7);
      rows.push([i, a, b, i / 7]);
    }
    db.exec('ALTER TABLE t ADD COLUMN late');
  }, 512);
  const db = await openSqliteBytes(bytes);
  assert.equal(db.pageSize, 512);
  assert.deepEqual(await db.columns('t'), ['id', 'a', 'b', 'c', 'late']);
  let n = 0;
  for await (const row of db.rows('t')) {
    const [id, a, b, c] = rows[n++];
    assert.deepEqual(row, { id, a, b, c, late: null });
  }
  assert.equal(n, 3000);
});

test('the reader refuses what it cannot read rather than guessing', async () => {
  await assert.rejects(openSqliteBytes(new Uint8Array(4096)), (error: unknown) => error instanceof SqliteReadError && error.reason === 'not-sqlite');
  const db = await openSqliteBytes(catalogue(5));
  await assert.rejects(async () => { for await (const _ of db.rows('Nope')) void _; }, SqliteReadError);
  assert.deepEqual(parseCreateTable('CREATE TABLE "x y" ("a b" INTEGER, c, PRIMARY KEY ("a b"))'), { columns: ['a b', 'c'], rowidColumn: 0, withoutRowid: false });
  assert.equal(parseCreateTable('CREATE TABLE k (a TEXT PRIMARY KEY, b) WITHOUT ROWID').withoutRowid, true);
});

test('a Lightroom catalogue gives each photo its path, rating, flag, keywords, ordinary collections and develop settings', async () => {
  const photos = await readCatalogue(await openSqliteBytes(catalogue()));
  assert.equal(photos.length, 401);
  const first = photos.find((photo) => photo.id === 1)!;
  assert.equal(first.path, 'C:/Users/sam/Pictures/2024/Skye/DSC_0001.NEF');
  assert.equal(first.filename, 'DSC_0001.NEF');
  assert.equal(first.rating, 1);
  assert.equal(first.flag, null);
  assert.equal(first.virtualCopy, false);
  assert.deepEqual(first.develop, { exposure: 0.5, contrast: 20, highlights: -40, shadows: 35, whites: 5, blacks: -12, clarity: 15, vibrance: 10, notCarried: [] });
  const fortieth = photos.find((photo) => photo.id === 40)!;
  assert.deepEqual(fortieth.keywords, ['Birds', 'Golden eagle']);
  assert.deepEqual(fortieth.collections, ['Portfolio'], 'smart collections and sets are not photo lists');
  assert.equal(photos.find((photo) => photo.id === 3)!.flag, 'pick');
  assert.equal(photos.find((photo) => photo.id === 7)!.flag, 'reject');
  assert.equal(photos.find((photo) => photo.id === 5)!.rating, undefined, 'rating 0 is no rating');
  assert.equal(photos.find((photo) => photo.id === 2)!.develop!.exposure, -0.25, 'overflowed settings are read whole');
  assert.equal(photos.find((photo) => photo.id === 10_001)!.virtualCopy, true);
  assert.equal(photos.find((photo) => photo.id === 400)!.path, 'C:/Users/sam/Pictures/2024/Other/DSC_0400.NEF');
});

test('a database that is not a Lightroom catalogue is named as such', async () => {
  const other = database((db) => db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body)'));
  await assert.rejects(readCatalogue(await openSqliteBytes(other)), (error: unknown) => error instanceof CatalogueReadError && error.reason === 'not-catalogue');
  const partial = database((db) => db.exec('CREATE TABLE Adobe_images (id_local INTEGER PRIMARY KEY, rootFile)'));
  await assert.rejects(readCatalogue(await openSqliteBytes(partial)), (error: unknown) => error instanceof CatalogueReadError && error.reason === 'layout');
});

test('develop settings: only top-level values, old process versions and local work are reported, not carried', () => {
  const masked = parseDevelopSettings(DEVELOP(1, 'MaskGroupBasedCorrections = { { Exposure2012 = 3, }, },\nHasCrop = true,\nWhiteBalance = "Custom",\n'));
  assert.equal(masked.exposure, 1, 'a mask\'s exposure never leaks into the whole-photo exposure');
  assert.deepEqual(masked.notCarried.sort(), ['crop', 'local', 'white-balance']);
  const old = parseDevelopSettings('s = { ProcessVersion = "5.7", Exposure = 1.2, FillLight = 30, }');
  assert.deepEqual(old, { notCarried: ['old-process'] });
  assert.equal(hasCarriedDevelop(old), false);
  assert.equal(parseDevelopSettings('s = { ConvertToGrayscale = true, ProcessVersion = "15.4", }').monochrome, true);
  assert.equal(parseDevelopSettings('s = { Exposure2012 = 9, ProcessVersion = "11.0", }').exposure, 5, 'clamped to the slider range');
});

function frame(base: PhotoFrame, filename: string, extra: Partial<PhotoFrame> = {}): PhotoFrame {
  return { ...base, id: `f-${filename}-${extra.sourcePath ?? ''}`, isDemo: false, removedAt: undefined, filename, exif: {}, ...extra };
}

test('matching never guesses: same name twice, a different capture time, or a virtual copy are left alone', async () => {
  const photos = await readCatalogue(await openSqliteBytes(catalogue(12)));
  const [base] = createDemoShootState(1).frames;
  const frames = [
    frame(base, 'DSC_0001.NEF'),
    frame(base, 'dsc_0002.nef', { exif: { capturedAtMs: Date.UTC(2024, 4, 1, 10, 0, 2) } }),
    frame(base, 'DSC_0003.NEF', { exif: { capturedAtMs: Date.UTC(2024, 4, 1, 9, 0, 3) } }), // one hour off: a time zone
    frame(base, 'DSC_0004.NEF', { exif: { capturedAtMs: Date.UTC(2023, 0, 1) } }), // another photo with the same name
    frame(base, 'DSC_0005.NEF', { id: 'a' }), frame(base, 'DSC_0005.NEF', { id: 'b' }), // twice in the project
    frame(base, 'DSC_0006.NEF', { sourcePath: 'C:\\Users\\sam\\Pictures\\2024\\Skye\\DSC_0006.NEF' }),
    frame(base, 'DSC_0007.NEF', { sourcePath: 'D:/Elsewhere/DSC_0007.NEF' }), // moved, and no capture time to confirm it
  ];
  const plan = planLightroomImport(photos, frames);
  const matched = Object.fromEntries(plan.matches.map((match) => [match.frameId, match.photo.id]));
  assert.deepEqual(matched, {
    [frames[0].id]: 1, [frames[1].id]: 2, [frames[2].id]: 3,
    [frames[6].id]: 6,
  });
  assert.equal(plan.differentTime, 1);
  assert.equal(plan.ambiguous, 1);
  assert.equal(plan.virtualCopies, 1);
  assert.equal(plan.unmatched, 12 - 4);
});

test('capture times agree within two seconds or a whole time-zone offset', () => {
  const at = Date.UTC(2024, 4, 1, 10, 20, 30);
  assert.equal(sameCaptureTime('2024-05-01T10:20:31.50', at), true);
  assert.equal(sameCaptureTime('2024-05-01T15:50:30', at), true, 'five and a half hours: a time zone');
  assert.equal(sameCaptureTime('2024-05-01T10:25:30', at), false);
  assert.equal(sameCaptureTime('2024-05-03T10:20:30', at), false);
  assert.equal(sameCaptureTime(undefined, at), true);
});

test('a 1,000-photo catalogue reads in well under a few seconds', async () => {
  const bytes = catalogue(1000);
  const started = performance.now();
  const photos = await readCatalogue(await openSqliteBytes(bytes));
  assert.equal(photos.length, 1001);
  assert.ok(performance.now() - started < 5000);
});
