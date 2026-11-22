// Pure helpers for the admin Flags page: turning form fields into a flag and a flag into plain words.
// No page access here, so the logic is unit-tested on its own (scripts/site/admin-flags.test.mjs).

/** Features no flag can ever switch off (src/core/features.ts NEVER_GATED). The page says so and the app enforces it. */
export const NEVER_GATED = ['import', 'basicEditing', 'cropAndStraighten', 'export', 'localBackup'];
/** The feature keys the app knows today, offered as suggestions. A new key is fine. */
export const KNOWN_FLAGS = ['watermark', 'macroPad', 'masks', 'subjectDetection', 'autoTab', 'speciesId', 'onlineAi', 'smartCulling', ...NEVER_GATED];

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
