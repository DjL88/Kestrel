// Rehearsal only: these are invented devices, never real account data or FCM tokens.
export const DIMENSIONS = Object.freeze({
  country: 'Country', organisation: 'Organisation', plan: 'Licence', cloud: 'Cloud subscription',
  platform: 'App type', version: 'App version', locale: 'Language', account: 'Account',
});
export const SAMPLE_DEVICES = Object.freeze([
  { device: 'd1', account: 'demo-a', country: 'GB', organisation: 'Studio A', plan: 'Pro', cloud: 'Yes', platform: 'Windows', version: '26.11.2', locale: 'en-GB' },
  { device: 'd2', account: 'demo-a', country: 'GB', organisation: 'Studio A', plan: 'Pro', cloud: 'Yes', platform: 'iOS', version: '26.11.2', locale: 'en-GB' },
  { device: 'd3', account: 'demo-b', country: 'DE', organisation: 'Studio B', plan: 'Pro', cloud: 'No', platform: 'macOS', version: '26.11.2', locale: 'de' },
  { device: 'd4', account: 'demo-c', country: 'FR', organisation: 'Independent', plan: 'Basic', cloud: 'No', platform: 'Android', version: '26.11.1', locale: 'fr' },
  { device: 'd5', account: 'demo-d', country: 'Unknown', organisation: 'Independent', plan: 'Basic', cloud: 'Yes', platform: 'Web', version: '26.11.2', locale: 'en-GB' },
]);
export function previewAudience(devices, rules, mode, allowAll = false) {
  if (!['all', 'any'].includes(mode) || !Array.isArray(rules) ||
      rules.some(r => !r || !['include','exclude'].includes(r.mode) || !Object.hasOwn(DIMENSIONS, r.dimension) ||
        typeof r.value !== 'string' || !r.value.trim() || r.value.length > 160)) throw new Error('Complete each audience rule.');
  const include = rules.filter(r => r.mode === 'include'), exclude = rules.filter(r => r.mode === 'exclude');
  if (!include.length && !allowAll) return { accounts: 0, devices: 0 };
  const matches = (d, r) => typeof d[r.dimension] === 'string' &&
    d[r.dimension].trim().toLowerCase() === r.value.trim().toLowerCase();
  const selected = devices.filter(d =>
    (include.length === 0 || (mode === 'all' ? include.every(r => matches(d,r)) : include.some(r => matches(d,r)))) &&
    !exclude.some(r => matches(d,r)));
  return { accounts: new Set(selected.map(d => d.account)).size, devices: new Set(selected.map(d => d.device)).size };
}
export function messagePreview(source, variant, locale) {
  const valid = m => typeof m?.title === 'string' && typeof m?.body === 'string' &&
    m.title.trim() && m.body.trim() && m.title.length <= 120 && m.body.length <= 500;
  if (!valid(source)) throw new Error('Enter a title and message within the length limits.');
  if (locale === 'en-GB') return { ...source, locale: 'en-GB', fallback: false };
  if (!variant?.title?.trim() && !variant?.body?.trim()) return { ...source, locale: 'en-GB', fallback: true };
  if (!valid(variant)) throw new Error('Complete both translated fields within the length limits.');
  return { ...variant, locale, fallback: false };
}
