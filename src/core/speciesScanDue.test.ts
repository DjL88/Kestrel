import assert from 'node:assert/strict';
import test from 'node:test';
import { SPECIES_SCAN_VERSION, scanCandidates, speciesScanDue } from './autoTags';

const photo = (id: string, extra: Record<string, unknown> = {}) => ({ id, subjectKind: 'wildlife', ...extra });

test('photos an older scan checked without finding anything are looked at once more, by themselves', () => {
  const frames = [
    photo('never'),
    photo('old-empty', { speciesChecked: true }), // checked before the scan version existed, no name: due again
    photo('old-kind-word', { speciesChecked: true, tags: ['Bird'] }), // a quick-add kind word is not a name
    photo('current-empty', { speciesChecked: true, speciesScanVersion: SPECIES_SCAN_VERSION }), // the current scan found nothing: not again
    photo('app-named', { speciesChecked: true, autoTags: ['Atlantic puffin'], tags: ['Atlantic puffin'] }),
    photo('person-named', { speciesChecked: true, subjectNames: ['Atlantic puffin'], tags: ['Atlantic puffin'] }),
    photo('person-tagged', { speciesChecked: true, tags: ['Puffin colony'] }),
    photo('turned-down', { speciesChecked: true, declinedTags: ['Razorbill'] }),
    photo('aircraft', { speciesChecked: true, vehicle: { label: 'Airliner' } }),
    photo('people', { subjectKind: 'people', speciesChecked: true }),
    photo('removed', { speciesChecked: true, removedAt: 1 }),
  ];
  assert.deepEqual(scanCandidates(frames).map((f) => f.id), ['never', 'old-empty', 'old-kind-word']);
});

test('a scan result stamps the version, so the next open does not look again', () => {
  assert.equal(speciesScanDue({ speciesChecked: true }), true);
  assert.equal(speciesScanDue({ speciesChecked: true, speciesScanVersion: SPECIES_SCAN_VERSION }), false);
  assert.equal(speciesScanDue({}), true);
});
