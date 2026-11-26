import assert from 'node:assert/strict';
import test from 'node:test';
import { c2paActionsIn, classifyApp, readEditStatus } from './editStatus';
import { parseImageExif } from './exifParser';
import { syntheticJpeg } from './editStatusFixture';

// Synthetic headers only: no real photo is read or committed.
const asBlob = (bytes: Uint8Array) => Buffer.from(bytes) as unknown as Blob;

test('camera firmware, phone software and editing apps are told apart', () => {
  for (const firmware of ['Ver.1.00', 'Ver.01.00', 'Firmware Version 1.0.0', 'Digital Camera X-T4 Ver1.20', 'ILCE-7M4 v2.00', '17.1.2', 'PENTAX K-3 Ver 1.00', 'HDR+ 1.0.512345']) {
    assert.equal(classifyApp(firmware), 'camera', firmware);
  }
  assert.equal(classifyApp('NIKON Z 8 1.10', 'NIKON CORPORATION'), 'camera');
  for (const editor of ['Adobe Photoshop Lightroom Classic 13.0 (Windows)', 'Adobe Photoshop 25.0', 'GIMP 2.10.36', 'Capture One 23 Macintosh', 'darktable 4.6.1', 'DxO PhotoLab 7']) {
    assert.equal(classifyApp(editor), 'editor', editor);
  }
  // An unfamiliar app name with a version is not mistaken for camera firmware.
  assert.equal(classifyApp('Some App 2.1'), 'other');
  assert.equal(classifyApp('Some App v2.1'), 'other');
});

test('Lightroom settings, an edit history or an editing app mean edited elsewhere, even with maker notes', () => {
  const lightroom = readEditStatus({ isRaw: false, hasMakerNote: true, software: 'Adobe Photoshop Lightroom Classic 13.0 (Windows)', crs: { Exposure2012: 0.5, HasSettings: true } });
  assert.equal(lightroom.kind, 'edited-elsewhere');
  assert.deepEqual(lightroom.evidence[0], { kind: 'develop-settings', app: 'Adobe Photoshop Lightroom Classic 13.0 (Windows)' });

  const history = readEditStatus({ isRaw: false, hasMakerNote: false, xmpMM: { History: { action: 'saved', softwareAgent: 'GIMP 2.10' } } });
  assert.deepEqual(history, { kind: 'edited-elsewhere', evidence: [{ kind: 'edit-history', app: 'GIMP 2.10' }] });

  const app = readEditStatus({ isRaw: true, hasMakerNote: true, creatorTool: 'Capture One 23' });
  assert.deepEqual(app, { kind: 'edited-elsewhere', evidence: [{ kind: 'editing-app', app: 'Capture One 23' }] });

  // A crop or a local mask alone still counts, through the catalogue's develop parser.
  assert.equal(readEditStatus({ isRaw: false, hasMakerNote: false, crs: { HasCrop: true } }).kind, 'edited-elsewhere');
});

test('Camera Raw blocks with nothing changed and a created-only history do not count as edits', () => {
  assert.equal(readEditStatus({ isRaw: true, hasMakerNote: true, crs: { HasSettings: false, Exposure2012: 0, WhiteBalance: 'As Shot' } }).kind, 'camera');
  assert.equal(readEditStatus({ isRaw: false, hasMakerNote: true, xmpMM: { History: [{ action: 'created' }] } }).kind, 'camera');
});

test('a RAW or a camera JPEG with maker notes is straight from the camera; anything else stays unknown', () => {
  assert.deepEqual(readEditStatus({ isRaw: true, hasMakerNote: false }), { kind: 'camera', evidence: [{ kind: 'raw-file' }] });
  assert.deepEqual(readEditStatus({ isRaw: false, hasMakerNote: true, software: 'Ver.1.00' }), { kind: 'camera', evidence: [{ kind: 'maker-notes' }] });
  assert.deepEqual(readEditStatus({ isRaw: false, hasMakerNote: false }), { kind: 'unknown', evidence: [] });
  // An app we do not recognise never says "from the camera", even with maker notes.
  assert.deepEqual(readEditStatus({ isRaw: false, hasMakerNote: true, software: 'Some App 2.1' }), { kind: 'unknown', evidence: [{ kind: 'unrecognised-app', app: 'Some App 2.1' }] });
});

test('C2PA edit actions mean edited elsewhere; a camera-signed capture does not', () => {
  // CBOR text strings: a 0x60 + length header byte, then the label, then the next key ("jparameters").
  const edited = c2paActionsIn(new TextEncoder().encode('jumb\0c2pa\0lc2pa.actionsgactionsfactionlc2pa.createdfactionlc2pa.croppedjparameters'));
  assert.deepEqual(edited.sort(), ['c2pa.created', 'c2pa.cropped']);
  assert.deepEqual(readEditStatus({ isRaw: false, hasMakerNote: true, c2paActions: edited }), { kind: 'edited-elsewhere', evidence: [{ kind: 'content-credentials', actions: ['c2pa.cropped'] }] });
  assert.equal(readEditStatus({ isRaw: false, hasMakerNote: true, c2paActions: ['c2pa.created'] }).kind, 'camera');
  // Without an actions assertion, a stray label is not read.
  assert.deepEqual(c2paActionsIn(new TextEncoder().encode('lc2pa.cropped')), []);
  // Metadata-only edits are not picture edits.
  assert.equal(readEditStatus({ isRaw: false, hasMakerNote: true, c2paActions: c2paActionsIn(new TextEncoder().encode('lc2pa.actionstc2pa.edited.metadata')) }).kind, 'camera');
});

test('parseImageExif reads the edit status from a synthetic JPEG header', async () => {
  const camera = await parseImageExif(asBlob(syntheticJpeg({ make: 'NIKON CORPORATION', model: 'NIKON Z 8', software: 'Ver.01.00', makerNote: true })), 'DSC_0001.JPG');
  assert.equal(camera.editStatus?.kind, 'camera');
  assert.ok(camera.camera);

  const lightroom = await parseImageExif(asBlob(syntheticJpeg({
    make: 'NIKON CORPORATION', model: 'NIKON Z 8', software: 'Adobe Photoshop Lightroom Classic 13.0 (Windows)', makerNote: true,
    xmp: 'xmp:CreatorTool="Adobe Photoshop Lightroom Classic 13.0" crs:Exposure2012="+0.50" crs:HasSettings="True">',
  })), 'DSC_0001-edit.jpg');
  assert.equal(lightroom.editStatus?.kind, 'edited-elsewhere');
  assert.equal(lightroom.editStatus?.evidence[0].kind, 'develop-settings');

  const credentials = await parseImageExif(asBlob(syntheticJpeg({ app11: 'JP\0\0jumbc2pa\0lc2pa.actionsvc2pa.color_adjustments\0' })), 'signed.jpg');
  assert.equal(credentials.editStatus?.kind, 'edited-elsewhere');

  const bare = await parseImageExif(asBlob(syntheticJpeg({ xmp: 'xmp:Rating="3">' })), 'bare.jpg');
  assert.equal(bare.editStatus?.kind, 'unknown');
  assert.equal(bare.rating, 3);
});

test('a Lightroom or darktable sidecar with develop settings means edited elsewhere; a ratings-only one does not', async () => {
  const { addSidecarEditStatus } = await import('./exifParser');
  const { sidecarFilenames, withSidecar } = await import('./editStatus');
  assert.deepEqual(sidecarFilenames('DSC_0001.NEF'), ['DSC_0001.xmp', 'DSC_0001.NEF.xmp']);
  const xmp = (body: string) => new TextEncoder().encode('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"' +
    ` xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#" ${body}</rdf:Description></rdf:RDF></x:xmpmeta>`);
  const raw = readEditStatus({ isRaw: true, hasMakerNote: true });

  const edited = await addSidecarEditStatus(raw, xmp('xmp:CreatorTool="Adobe Photoshop Lightroom Classic 13.0" crs:Exposure2012="+0.70" crs:HasSettings="True">'));
  assert.deepEqual(edited, { kind: 'edited-elsewhere', evidence: [{ kind: 'sidecar', app: 'Adobe Photoshop Lightroom Classic 13.0' }] });

  // Lightroom writes a sidecar for a star rating too: zeroed sliders and a metadata-only save are not an edit.
  const ratedOnly = await addSidecarEditStatus(raw, xmp('xmp:Rating="4" crs:Exposure2012="0.00" crs:WhiteBalance="As Shot"><xmpMM:History><rdf:Seq>' +
    '<rdf:li stEvt:action="saved" stEvt:changed="/metadata" stEvt:softwareAgent="Adobe Photoshop Lightroom Classic 13.0"/></rdf:Seq></xmpMM:History>'));
  assert.deepEqual(ratedOnly, raw);

  // A damaged sidecar changes nothing.
  assert.deepEqual(await addSidecarEditStatus(raw, new TextEncoder().encode('not xml at all')), raw);
  // The file's own edit evidence is kept after the sidecar's.
  const own = readEditStatus({ isRaw: false, hasMakerNote: false, software: 'GIMP 2.10' });
  assert.deepEqual(withSidecar(own, { crs: { HasCrop: true } }).evidence.map((item) => item.kind), ['sidecar', 'editing-app']);
});
