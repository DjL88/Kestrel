// Pure helpers for the admin Flags page: turning form fields into a flag and a flag into plain words.
// No page access here, so the logic is unit-tested on its own (scripts/site/admin-flags.test.mjs).

/** Features no flag can ever switch off (src/core/features.ts NEVER_GATED). The page says so and the app enforces it. */
export const NEVER_GATED = ['import', 'basicEditing', 'cropAndStraighten', 'export', 'localBackup', 'overlayText', 'watermarkCustom'];

/**
 * What each flag the app knows means for people, in plain words. The technical key stays visible, small, beside it.
 * Keys from src/core/features.ts, plus the website's own (sitePlanChoices).
 */
export const FLAG_INFO = {
  accountData: { name: 'Delete my account and export my data', effect: 'People can download everything InFlight holds about them, or delete their account, from Settings.' },
  cloudRecipe: { name: 'Cloud editing', effect: 'A small preview goes to the cloud and editing settings come back. The original never leaves the device.' },
  cullRules: { name: 'Culling rules', effect: 'Live sliders in the Culling Assistant, and culling from stored checks.' },
  finishBest: { name: 'Finish best', effect: 'A Finish best button edits your best photos in one batch on the device, best first, then shows each one to keep or undo.' },
  onlineAi: { name: 'Online photo helper', effect: 'Pro can ask Google Gemini about a photo. Needs the Online photo helper switch.' },
  cloudAssist: { name: 'Cloud help for Pro', effect: 'Pro can send heavy jobs to the cloud.' },
  smartCulling: { name: 'Smart culling', effect: 'Suggests which photos to keep, for people to confirm.' },
  speciesId: { name: 'Species names', effect: 'Suggests the species in wildlife photos, on the device.' },
  subjectDetection: { name: 'Find the subject', effect: 'Finds the main subject in each photo, on the device.' },
  masks: { name: 'Masks', effect: 'Edit one part of a photo, such as the subject or the sky.' },
  autoTab: { name: 'Auto tab', effect: 'The one-click Auto adjustments in the editor.' },
  watermark: { name: 'Watermark on exports', effect: 'Adds a watermark to exported photos.' },
  macroPad: { name: 'Macro pad', effect: 'Use a small keypad or controller for shortcuts.' },
  zoomVideo: { name: 'Zoom video', effect: 'Makes a short zoom video from a photo.' },
  splitFrames: { name: 'Split frames', effect: 'Splits a burst or video into separate photos.' },
  focusStack: { name: 'Focus stacking', effect: 'Merges photos focused at different depths into one new photo.' },
  panorama: { name: 'Panorama', effect: 'Stitches photos into one new panorama.' },
  hdrMerge: { name: 'HDR merge', effect: 'Merges bracketed exposures into one new photo.' },
  onImageAdvice: { name: 'Advice on the photo', effect: 'Shows clipped areas, the focus point and a colour check on the photo, read-only. A preview.' },
  savedViews: { name: 'Saved views', effect: 'Save a filter and sort to come back to.' },
  nextToReview: { name: 'Next to review', effect: 'A key that jumps to the next photo still to decide.' },
  cullWarmup: { name: 'Faster culling', effect: 'Prepares the next previews ahead while culling.' },
  editStyle: { name: 'Learns your style', effect: 'Auto leans towards how you edit, learned on this device only.' },
  brandKits: { name: 'Brand kits', effect: 'A saved logo, colours and text style for exports.' },
  sitePlanChoices: { name: 'Plan choices on the website', effect: 'Shows the monthly and yearly choice on the website.' },
  import: { name: 'Import', effect: 'Bring photos in. Always on.' },
  basicEditing: { name: 'Basic editing', effect: 'Light, colour and detail. Always on.' },
  cropAndStraighten: { name: 'Crop and straighten', effect: 'Always on.' },
  export: { name: 'Export', effect: 'Save finished photos. Always on.' },
  localBackup: { name: 'Local backup', effect: 'Back up to your own drive. Always on.' },
  overlayText: { name: 'Text on photos', effect: 'Always on.' },
  watermarkCustom: { name: 'Custom watermarks', effect: 'Always on.' },
};
/** The feature keys the app knows today, for the flag dropdown. "Another flag" still allows a new key. */
export const KNOWN_FLAGS = Object.keys(FLAG_INFO);
/** "Delete my account and export my data", or the key itself for a flag the page does not know. */
export const flagName = (key) => FLAG_INFO[key]?.name ?? key;

const DAY = 86_400_000;
const KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

export const PLAN_LABEL = { unknown: 'People without an account', basic: 'Basic', pro: 'Pro' };

/** A yyyy-mm-dd field as the start of that day, UTC. Empty or invalid is null. */
export function startFromDay(text) {
  if (!text) return null;
  const ms = Date.parse(text + 'T00:00:00Z');
  return Number.isNaN(ms) ? null : ms;
}
/** The "last day" field is inclusive, so the rule ends at the start of the day after it. Empty means until stopped. */
export function endFromLastDay(text) {
  const ms = startFromDay(text);
  return ms === null ? null : ms + DAY;
}
export const dayText = (ms) => new Date(ms).toISOString().slice(0, 10);
export const lastDayText = (endsAtMs) => dayText(endsAtMs - DAY);

export function audienceText(audience) {
  switch (audience?.kind) {
    case 'any': return 'Everyone';
    case 'plan': return PLAN_LABEL[audience.plan] ?? 'A plan';
    case 'corporate': return 'Organisation ' + audience.name;
    case 'user': return 'One named user';
    default: return 'Unknown audience';
  }
}

/** One rule in plain words, for the table. */
export function ruleSummary(rule) {
  const parts = [audienceText(rule.audience) + ': ' + (rule.enabled ? 'on' : 'off')];
  if (rule.enabled && rule.trial) parts[0] += ' (trial)';
  if (typeof rule.percent === 'number') parts.push(rule.percent + '% of devices');
  const from = typeof rule.startsAtMs === 'number' ? 'from ' + day.format(new Date(rule.startsAtMs)) : null;
  const until = typeof rule.endsAtMs === 'number' ? 'last day ' + day.format(new Date(rule.endsAtMs - DAY)) : 'until stopped';
  parts.push(from ? from + ', ' + until : until);
  return parts.join(', ');
}

/** The form fields for one rule row, as the server expects it. Returns { rule } or { error }. */
export function ruleFromFields(f) {
  let audience;
  if (f.kind === 'any') audience = { kind: 'any' };
  else if (f.kind === 'plan') audience = { kind: 'plan', plan: f.plan };
  else if (f.kind === 'corporate') {
    const name = (f.text ?? '').trim();
    if (!name) return { error: 'Give the organisation name.' };
    audience = { kind: 'corporate', name };
  } else if (f.kind === 'user') {
    const email = (f.text ?? '').trim();
    if (!email) return { error: 'Give the user\'s email (it is stored only as a hash).' };
    audience = { kind: 'user', email };
  } else return { error: 'Choose who the rule is for.' };

  const rule = { audience, enabled: f.enabled === true };
  if (rule.enabled && f.trial) rule.trial = true;
  const start = startFromDay(f.firstDay);
  if (f.firstDay && start === null) return { error: 'The first day is not a valid date.' };
  const end = endFromLastDay(f.lastDay);
  if (f.lastDay && end === null) return { error: 'The last day is not a valid date.' };
  if (start !== null && end !== null && end <= start) return { error: 'The last day must not be before the first day.' };
  if (start !== null) rule.startsAtMs = start;
  if (end !== null) rule.endsAtMs = end;
  if (f.percent !== '' && f.percent !== undefined && f.percent !== null) {
    const percent = Number(f.percent);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) return { error: 'The percentage must be a whole number from 0 to 100.' };
    rule.percent = percent;
  }
  return { rule };
}

/** Fields back from a stored rule, for editing. A named user shows its stored hash, which the server keeps as it is. */
export function fieldsFromRule(rule) {
  const a = rule.audience ?? { kind: 'any' };
  return {
    kind: a.kind, plan: a.kind === 'plan' ? a.plan : 'basic', text: a.kind === 'corporate' ? a.name : a.kind === 'user' ? a.email : '',
    enabled: rule.enabled === true, trial: rule.trial === true,
    firstDay: typeof rule.startsAtMs === 'number' ? dayText(rule.startsAtMs) : '',
    lastDay: typeof rule.endsAtMs === 'number' ? lastDayText(rule.endsAtMs) : '',
    percent: typeof rule.percent === 'number' ? String(rule.percent) : '',
  };
}

/** The whole form as the body the server expects. Returns { key, flag } or { error }. */
export function flagFromForm({ key, defaultOn, kill, minAppVersion, rules }) {
  const name = (key ?? '').trim();
  if (!KEY.test(name)) return { error: 'The flag name must start with a letter and use only letters, numbers, dots, dashes and underscores.' };
  const built = [];
  for (const [index, fields] of rules.entries()) {
    const result = ruleFromFields(fields);
    if (result.error) return { error: `Rule ${index + 1}: ${result.error}` };
    built.push(result.rule);
  }
  const version = (minAppVersion ?? '').trim();
  if (version && !/^\d+(\.\d+){0,3}$/.test(version)) return { error: 'The minimum app version looks like 26.11.2.' };
  const flag = { default: defaultOn === true, rules: built };
  if (kill) flag.kill = true;
  if (version) flag.minAppVersion = version;
  return { key: name, flag };
}
