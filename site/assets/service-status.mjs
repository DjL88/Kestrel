// Public status is a read-only snapshot. Never infer availability from missing or stale data.
export const SERVICES = Object.freeze({
  accounts: 'Account and authentication', licences: 'Licence activation', sync: 'Cloud storage and sync',
  processing: 'Cloud processing', ai: 'Online AI assistant', downloads: 'Model and installer downloads', payments: 'Payments',
});
export const HEALTH = Object.freeze({ operational:'Operational', degraded:'Degraded', outage:'Disrupted', maintenance:'Maintenance', unknown:'Not checked' });
export const INCIDENT = Object.freeze({ investigating:'Investigating', identified:'Identified', monitoring:'Monitoring', resolved:'Resolved', scheduled:'Scheduled maintenance' });
const TTL = 15 * 60 * 1000;
const empty = () => Object.fromEntries(Object.keys(SERVICES).map(key => [key, 'unknown']));
export function readStatus(raw, now = Date.now()) {
  const unavailable = { freshness:'unavailable', updatedAt:null, services:empty(), incidents:[] };
  if (!raw || raw.schemaVersion !== 1 || !Number.isSafeInteger(raw.updatedAt) || raw.updatedAt < 0 ||
      raw.updatedAt > now + 60_000 || !raw.services || typeof raw.services !== 'object' || Array.isArray(raw.services)) return unavailable;
  if (!Object.keys(SERVICES).every(key => Object.hasOwn(raw.services, key) && Object.hasOwn(HEALTH, raw.services[key]))) return unavailable;
  if (!Array.isArray(raw.incidents) || raw.incidents.length > 20) return unavailable;
  const seen = new Set();
  for (const i of raw.incidents) {
    if (!i || typeof i.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(i.id) || seen.has(i.id) ||
        !Object.hasOwn(INCIDENT,i.state) || typeof i.title !== 'string' || !i.title.trim() || i.title.length > 160 ||
        typeof i.message !== 'string' || !i.message.trim() || i.message.length > 2000 ||
        !Array.isArray(i.services) || !i.services.length || i.services.some(key => !Object.hasOwn(SERVICES,key)) ||
        !Number.isSafeInteger(i.updatedAt) || i.updatedAt < 0 || i.updatedAt > raw.updatedAt ||
        (i.state === 'scheduled' && (!Number.isSafeInteger(i.startsAt) || !Number.isSafeInteger(i.endsAt) || i.endsAt <= i.startsAt))) return unavailable;
    seen.add(i.id);
  }
  const fresh = now - raw.updatedAt < TTL;
  return {
    freshness:fresh ? 'fresh' : 'stale', updatedAt:raw.updatedAt,
    services:fresh ? Object.fromEntries(Object.keys(SERVICES).map(key => [key,raw.services[key]])) : empty(),
    incidents:raw.incidents.map(i => ({id:i.id,state:i.state,title:i.title,message:i.message,services:[...i.services],updatedAt:i.updatedAt,startsAt:i.startsAt,endsAt:i.endsAt})),
  };
}
