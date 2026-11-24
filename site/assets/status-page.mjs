import { SERVICES, HEALTH, INCIDENT, readStatus } from './service-status.mjs';
const $ = id => document.getElementById(id);
const node = (tag, text) => { const element = document.createElement(tag); element.textContent = text; return element; };
const when = ms => new Intl.DateTimeFormat('en-GB', { dateStyle:'medium', timeStyle:'short', timeZone:'UTC' }).format(ms) + ' UTC';
let lastSnapshot = null;
let running = false;
function render(snapshot, failed = false) {
  const model = readStatus(snapshot);
  $('status-summary').textContent = failed ? 'Could not refresh the status feed. Current service health is not confirmed.' :
    model.freshness === 'fresh' ? 'Published service status. Local editing does not depend on cloud services.' :
    model.freshness === 'stale' ? 'Status is out of date. Current service health is not confirmed.' : 'Live status is not configured or unavailable.';
  $('status-updated').textContent = model.updatedAt === null ? 'No verified publication time.' : 'Last published: ' + when(model.updatedAt);
  $('service-list').replaceChildren(...Object.entries(SERVICES).map(([key,label]) => {
    const row = node('li','');
    row.append(node('strong',label),node('span', HEALTH[failed ? 'unknown' : model.services[key]]));
    return row;
  }));
  $('incident-list').replaceChildren(...model.incidents.map(i => {
    const article = node('article','');
    article.append(node('h3',i.title), node('p',INCIDENT[i.state] + ' · ' + when(i.updatedAt)),
      node('p',i.message),node('p','Affected: ' + i.services.map(key => SERVICES[key]).join(', ')));
    if (i.state === 'scheduled') article.append(node('p',when(i.startsAt)+' – '+when(i.endsAt)));
    if (failed || model.freshness !== 'fresh') article.prepend(node('p','Previously published — may be out of date.'));
    return article;
  }));
  $('incidents-empty').textContent = model.incidents.length ? '' : model.freshness === 'fresh' && !failed ? 'No published incident notices.' : 'Current incident notices are unavailable.';
}
async function refresh() {
  if (running) return;
  running = true; $('status-refresh').disabled = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('/status.json', { credentials:'omit', cache:'no-store', signal:controller.signal, redirect:'error', referrerPolicy:'no-referrer' });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw Error('Invalid feed');
    lastSnapshot = await response.json();
    render(lastSnapshot);
  } catch { render(lastSnapshot,true); }
  finally { clearTimeout(timer); running = false; $('status-refresh').disabled = false; }
}
$('status-refresh').addEventListener('click', refresh);
window.addEventListener('online', refresh);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60_000);
render(null); void refresh();
