import assert from 'node:assert/strict';
import test from 'node:test';
import { findCamera, findLens, parseLensfunXml, resolveLensProfile } from './lensProfiles';

// Synthetic entries in lensfun's format (made up for this test, not lensfun data).
const XML = `<!DOCTYPE lensdatabase SYSTEM "lensfun-database.dtd">
<lensdatabase version="2">
  <mount><name>Test Z</name><compat>Test F</compat></mount>
  <camera><maker>Testcam Corporation</maker><maker lang="en">Testcam</maker><model>Testcam Z 7</model><mount>Test Z</mount><cropfactor>1</cropfactor></camera>
  <camera><maker>Testcam Corporation</maker><model>Testcam Z 50</model><mount>Test Z</mount><cropfactor>1.5</cropfactor></camera>
  <camera><maker>Pocket</maker><model>Pocket One</model><mount>pocketOne</mount><cropfactor>2.7</cropfactor></camera>
  <lens>
    <maker>Testcam</maker><model>Testor Z 24-70mm f/4 S</model><model lang="en">Testor Z 24-70 f/4</model><mount>Test Z</mount><cropfactor>1</cropfactor>
    <calibration>
      <!-- comment with <distortion model="ptlens" focal="99" a="9"/> inside is ignored -->
      <distortion model="ptlens" focal="24" a="0.02" b="-0.08" c="0.04"/>
      <distortion model="ptlens" focal="70" a="0" b="0.01" c="0"/>
      <vignetting model="pa" focal="24" aperture="4" distance="1000" k1="-0.6" k2="0.1" k3="0"/>
      <vignetting model="pa" focal="24" aperture="8" distance="1000" k1="-0.2" k2="0" k3="0"/>
      <vignetting model="pa" focal="24" aperture="4" distance="0.5" k1="-0.9" k2="0" k3="0"/>
      <vignetting model="pa" focal="70" aperture="4" distance="1000" k1="-0.4" k2="0" k3="0"/>
    </calibration>
  </lens>
  <lens>
    <maker>Testcam</maker><model>Testor F 24-70mm f/4 S</model><mount>Test F</mount><cropfactor>1</cropfactor>
    <calibration><distortion model="poly3" focal="24" k1="-0.03"/></calibration>
  </lens>
  <lens>
    <maker>Pocket</maker><model>fixed lens</model><mount>pocketOne</mount><cropfactor>2.7</cropfactor><aspect-ratio>4:3</aspect-ratio>
    <calibration><distortion model="poly5" focal="9" k1="-0.05" k2="0.01"/></calibration>
  </lens>
</lensdatabase>`;

const db = parseLensfunXml(XML);

test('the database file is read: cameras, lenses, mounts, and comments ignored', () => {
  assert.equal(db.cameras.length, 3);
  assert.equal(db.lenses.length, 3);
  assert.deepEqual(db.mounts['Test Z'], ['Test F']);
  const zoom = db.lenses[0];
  assert.equal(zoom.distortion.length, 2, 'the commented-out entry is not read');
  assert.equal(zoom.vignetting.length, 4);
  assert.equal(db.lenses[2].aspect, 4 / 3);
});

test('a camera is found from its EXIF label, whatever the maker is called', () => {
  assert.equal(findCamera(db, 'TESTCAM Z 7')?.model, 'Testcam Z 7');
  assert.equal(findCamera(db, 'Testcam Corporation Testcam Z 50')?.crop, 1.5);
  assert.equal(findCamera(db, 'Testcam Z 70'), null);
});

test('a lens is matched however the camera writes its name, never a different focal range', () => {
  const camera = findCamera(db, 'TESTCAM Z 7');
  assert.equal(findLens(db, 'TESTOR Z 24-70mm f/4 S', camera)?.model, 'Testor Z 24-70mm f/4 S');
  assert.equal(findLens(db, 'Testor Z24-70mm F4 S', camera)?.model, 'Testor Z 24-70mm f/4 S');
  assert.equal(findLens(db, 'Testor Z 24-120mm f/4 S', camera), null);
  // A compact's built-in lens comes from the camera alone.
  assert.equal(findLens(db, undefined, findCamera(db, 'Pocket One'))?.model, 'fixed lens');
});

test('a profile is resolved for the focal length and aperture used, in the photo\'s own units', () => {
  const found = resolveLensProfile(db, { camera: 'Testcam Z 7', lens: 'Testor Z 24-70mm f/4 S', focalLengthMm: 24, apertureF: 5.6 });
  assert.equal(found.kind, 'found');
  if (found.kind !== 'found') return;
  const { distortion, vignetting, notes } = found.profile;
  assert.deepEqual(distortion?.k, [0.02, -0.08, 0.04]);
  assert.equal(distortion?.scale, Number(Math.sqrt(1.5 ** 2 + 1).toFixed(6)));
  // f/5.6 is half-way between f/4 and f/8 in stops; the far-focus entries are used.
  assert.ok(Math.abs(vignetting!.k[0] - (-0.4)) < 0.01, `k1 ${vignetting!.k[0]}`);
  assert.equal(vignetting?.scale, 1);
  assert.equal(notes, undefined);

  // On a smaller sensor the same lens covers less of its circle.
  const crop = resolveLensProfile(db, { camera: 'Testcam Z 50', lens: 'Testor Z 24-70mm f/4 S', focalLengthMm: 47, apertureF: 4 });
  assert.equal(crop.kind, 'found');
  if (crop.kind === 'found') {
    assert.ok(Math.abs(crop.profile.vignetting!.scale - 1 / 1.5) < 1e-6);
    assert.ok(Math.abs(crop.profile.distortion!.k[1] - (-0.08 + 0.09 * 0.5)) < 1e-6, 'interpolated half-way between 24 and 70 mm');
  }
});

test('unknowns stay unknown: no lens, no focal length, no aperture, unknown camera', () => {
  assert.deepEqual(resolveLensProfile(db, { camera: 'Other Cam' }), { kind: 'no-lens' });
  assert.deepEqual(resolveLensProfile(db, { lens: 'Mystery 50mm f/1.8', focalLengthMm: 50 }), { kind: 'not-found', lens: 'Mystery 50mm f/1.8' });
  assert.deepEqual(resolveLensProfile(db, { camera: 'Testcam Z 7', lens: 'Testor Z 24-70mm f/4 S' }), { kind: 'no-focal' });
  const noAperture = resolveLensProfile(db, { camera: 'Testcam Z 7', lens: 'Testor Z 24-70mm f/4 S', focalLengthMm: 24 });
  assert.ok(noAperture.kind === 'found' && !noAperture.profile.vignetting && noAperture.profile.notes?.includes('no-aperture'));
  const unknownBody = resolveLensProfile(db, { camera: 'Brand New Body', lens: 'Testor Z 24-70mm f/4 S', focalLengthMm: 24, apertureF: 4 });
  assert.ok(unknownBody.kind === 'found' && unknownBody.profile.notes?.includes('assumed-sensor'));
  const fromExif = resolveLensProfile(db, { camera: 'Brand New Body', lens: 'Testor Z 24-70mm f/4 S', focalLengthMm: 24, focalLength35mm: 36, apertureF: 4 });
  assert.ok(fromExif.kind === 'found' && !fromExif.profile.notes?.includes('assumed-sensor') && Math.abs(fromExif.profile.vignetting!.scale - 1 / 1.5) < 1e-6);
  // A compact with a single measured focal length needs no focal length in EXIF.
  const pocket = resolveLensProfile(db, { camera: 'Pocket One' });
  assert.ok(pocket.kind === 'found' && pocket.profile.distortion?.model === 'poly5');
});
