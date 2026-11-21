import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROPOSAL_BOUNDS } from './recipeProposal';
import {
  STYLE_DENOISE_LIMIT, STYLE_EXPOSURE_LIMIT, STYLE_GUIDES, STYLE_LIMIT, STYLE_SUBJECTS, STYLE_LIBRARY_VERSION,
  guideFor, styleRecipeToEdit, styleSubjectFor, suggestStyleEdits,
} from './styleLibrary';

describe('style library data', () => {
  it('is versioned and covers every subject exactly once', () => {
    assert.ok(STYLE_LIBRARY_VERSION >= 1);
    assert.deepEqual(STYLE_GUIDES.map((guide) => guide.subject).sort(), [...STYLE_SUBJECTS].sort());
  });
  it('gives each subject a Natural style, several styles, and honest practice notes', () => {
    for (const guide of STYLE_GUIDES) {
      assert.ok(guide.styles.length >= 3);
      assert.equal(guide.styles[0].name, 'Natural');
      assert.ok(guide.notes.length >= 3);
      assert.equal(new Set(guide.styles.map((style) => style.id)).size, guide.styles.length);
      for (const note of guide.notes) { assert.ok(note.text); assert.ok(note.why); }
    }
  });
  it('keeps every recipe inside the style limits and the editor ranges', () => {
    for (const guide of STYLE_GUIDES) for (const style of guide.styles) {
      for (const [key, value] of Object.entries(style.recipe)) {
        assert.ok(key in PROPOSAL_BOUNDS, key);
        if (key === 'exposure') assert.ok(Math.abs(value) <= STYLE_EXPOSURE_LIMIT);
        else if (key === 'denoise') assert.ok(value >= 0 && value <= STYLE_DENOISE_LIMIT);
        else if (key === 'colour' && value <= -1.9) assert.equal(value, -2);
        else assert.ok(Math.abs(value) <= STYLE_LIMIT);
      }
      const edit = styleRecipeToEdit(style.recipe);
      for (const [key, value] of Object.entries(style.recipe)) assert.ok(Math.abs(((edit as unknown as Record<string, number>)[key] ?? 0) - value) < 1e-9);
      assert.equal(edit.masks, undefined);
    }
  });
  it('clamps anything out of bounds and ignores unknown or non-finite values', () => {
    const edit = styleRecipeToEdit({ contrast: 9, exposure: 3, denoise: -4, sharpen: Number.NaN, bogus: 1 } as never);
    assert.equal(edit.contrast, STYLE_LIMIT);
    assert.equal(edit.exposure, STYLE_EXPOSURE_LIMIT);
    assert.equal(edit.denoise ?? 0, 0);
    assert.equal(edit.sharpen ?? 0, 0);
    assert.ok(!('bogus' in edit));
  });
});

describe('choosing a subject', () => {
  it('abstains when the subject is unknown', () => {
    assert.equal(styleSubjectFor({}), null);
    assert.equal(styleSubjectFor({ subjectKind: 'other' }), null);
    assert.equal(styleSubjectFor({ subjectKind: 'wildlife' }), null);
    assert.equal(styleSubjectFor({ tags: ['Holiday', 'Day 3'] }), null);
    assert.equal(suggestStyleEdits({ tags: ['Abstract'] }), null);
    assert.equal(guideFor(null), null);
  });
  it('follows tags the person chose', () => {
    assert.equal(styleSubjectFor({ subjectKind: 'wildlife', tags: ['Bird', 'In flight'] }), 'birds-in-flight');
    assert.equal(styleSubjectFor({ subjectKind: 'wildlife', tags: ['Bird of prey', 'Perched'] }), 'perched-birds');
    assert.equal(styleSubjectFor({ subjectKind: 'wildlife', tags: ['Insect'] }), 'macro');
    assert.equal(styleSubjectFor({ subjectKind: 'landscape', tags: ['Sunset'] }), 'golden-hour');
    assert.equal(styleSubjectFor({ subjectKind: 'other', tags: ['Architecture'] }), 'architecture');
  });
  it('falls back to the kind only when it is unambiguous', () => {
    assert.equal(styleSubjectFor({ subjectKind: 'landscape' }), 'landscape');
    assert.equal(styleSubjectFor({ subjectKind: 'people' }), 'portrait');
  });
  it('offers edits that never carry masks', () => {
    const suggestion = suggestStyleEdits({ subjectKind: 'people', tags: ['Portrait'] });
    assert.ok((suggestion?.options.length ?? 0) >= 3);
    for (const option of suggestion!.options) assert.equal(option.edit.masks, undefined);
  });
});
