// InFlight admin console. Talks only to the control plane's audited /v1/admin routes on this site's own address
// (Firebase Hosting forwards /v1/admin/** to Cloud Run). The session lives in memory only: closing the tab signs out.
// Everything from the server is written with textContent, never as HTML.

import { KNOWN_FLAGS, NEVER_GATED, fieldsFromRule, flagFromForm, ruleSummary } from './admin-flags.js';

import { RULES, SCENARIOS, evaluateSample, rehearseDelivery } from './admin-monitoring.mjs';

import { DIMENSIONS, SAMPLE_DEVICES, previewAudience, messagePreview } from './admin-notifications.mjs';

import { readGcpBilling, summariseIncome, accountsSummary, monthName, VAT_HELP } from './admin-accounts.mjs';

import { needsYou, VIEWS, viewForHash } from './admin-needs.mjs';
import { parseMarkdown } from './admin-markdown.mjs';

const $ = id => document.getElementById(id);
const status = $('status');
let token;
let localTaxes = {};
/** What the last check read, for the Needs you list. `null` = could not be read. */
let snapshot = {};
let autoCheck;

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const when = ms => (ms ? dateTime.format(new Date(ms)) : '—');

class SignedOut extends Error {}

async function api(path, body) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch('/v1/' + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The admin service is not reachable from this address.');
  const result = await response.json();
  if (response.status === 401 && token) { signOut('Your session has ended. Sign in again.'); throw new SignedOut(); }
  if (!response.ok) throw Object.assign(new Error(result.error?.message ?? 'That could not be done.'), { status: response.status });
  return result;
}

function say(message) { status.textContent = message; }

/** Runs an action from a form or button, keeps the control disabled meanwhile, and reports errors in words. */
function act(element, event, work) {
  element.addEventListener(event, async e => {
    e.preventDefault();
    const button = e.submitter ?? (element.tagName === 'BUTTON' ? element : element.querySelector('button'));
    if (button) button.disabled = true;
    try { await work(e); } catch (error) { if (!(error instanceof SignedOut)) say(error.message); } finally { if (button) button.disabled = false; }
  });
}

function cell(row, content) {
  const td = document.createElement('td');
  if (content instanceof Node) td.append(content); else td.textContent = content ?? '—';
  row.append(td);
  return td;
}
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function badge(text, tone) { return el('span', text, 'badge' + (tone ? ' ' + tone : '')); }
function code(text) { return el('code', text); }
function button(text, label, className, onClick) {
  const b = el('button', text, 'small ' + (className ?? ''));
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  act(b, 'click', onClick);
  return b;
}

// ---- Sign-in ---------------------------------------------------------------------------------------------------

async function startConsole(accessToken, who) {
  token = accessToken;
  $('sign-in').hidden = true;
  $('console').hidden = false;
  $('sign-out').hidden = false;
  $('who').textContent = who ? 'Signed in as ' + who : 'Signed in';
  say('');
  showView();
  if (viewForHash(location.hash) === 'technical') loadTechnicalOverview().catch(error => { if (!(error instanceof SignedOut)) $('overview-status').textContent = error.message; });
  await refreshAll();
  $('main').focus();
  clearInterval(autoCheck);
  autoCheck = setInterval(() => { if (token && document.visibilityState === 'visible') void refreshAll(); }, 5 * 60_000);
}

function signOut(message = '') {
  token = undefined;
  overviewMarkdown = null;
  $('overview-doc').replaceChildren();
  clearInterval(autoCheck);
  snapshot = {};
  $('needs-list').replaceChildren();
  $('refund-list').replaceChildren();
  localTaxes = {};
  clearMonitoringRehearsal();
  resetNotificationRehearsal();
  $('console').hidden = true;
  $('sign-out').hidden = true;
  $('who').textContent = '';
  $('sign-in').hidden = false;
  for (const id of ['licence-table', 'usage-table', 'payments-table', 'audit-table', 'flags-table']) $(id).tBodies[0].replaceChildren();
  flagsState = {};
  $('message-list').replaceChildren();
  $('issued').hidden = true;
  $('issued-key').value = '';
  $('grant-form').reset();
  $('grant-result').textContent = '';
  globalThis.google?.accounts?.id?.disableAutoSelect?.();
  say(message);
}

function emailFromGoogle(credential) {
  try { return JSON.parse(atob(credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email; } catch { return ''; }
}

async function setUpSignIn() {
  let config;
  try { config = await api('admin/config'); } catch (error) { say(error.message); return; }
  if (config.passwordSignIn) $('password-form').hidden = false;
  if (!config.googleClientId) { $('google-missing').hidden = false; return; }
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.onerror = () => say('Google sign-in could not be loaded. Check the connection and reload the page.');
  script.onload = () => {
    google.accounts.id.initialize({
      client_id: config.googleClientId,
      auto_select: false,
      callback: async ({ credential }) => {
        try {
          const session = await api('admin/session/google', { credential });
          await startConsole(session.accessToken, emailFromGoogle(credential));
        } catch (error) { if (!(error instanceof SignedOut)) say(error.message); }
      },
    });
    google.accounts.id.renderButton($('google-button'), { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular' });
  };
  document.head.append(script);
}

act($('password-form'), 'submit', async () => {
  const form = $('password-form');
  const { email, password } = Object.fromEntries(new FormData(form));
  form.elements.password.value = '';
  const session = await api('auth/session', { email, password });
  await startConsole(session.accessToken, email);
});
act($('sign-out'), 'click', () => signOut('Signed out.'));

// ---- Sections --------------------------------------------------------------------------------------------------

async function refreshAll() {
  const results = await Promise.allSettled([loadOverview(), loadLicensees(), loadUsage(), loadPayments(), loadPaddleKey(), loadAccounts(), loadMessages(), loadTax(), loadPricing(), loadPriceReview(), loadSafety(), loadCompliance(), loadSwitches(), loadMail(), loadLearning(), loadFlags(), loadAudit(), loadRefunds()]);
  if (!token) return;
  renderNeeds();
  const failed = results.find(r => r.status === 'rejected' && !(r.reason instanceof SignedOut));
  // On the home list a failed source is already named under "Could not check"; elsewhere say it in the status line.
  if (failed && viewForHash(location.hash)) say(failed.reason.message);
}
act($('refresh-all'), 'click', async () => { await refreshAll(); say(''); });

// ---- Needs you (home) and More ---------------------------------------------------------------------------------

$('more-links').replaceChildren(...Object.entries(VIEWS).filter(([name]) => name !== 'refunds').map(([name, view]) => {
  const item = el('li'); const link = el('a', view.label); link.href = '#' + name; item.append(link); return item;
}));

/** Home shows only Needs you and More. A view shows its own sections and a way back. */
function showView() {
  const view = viewForHash(location.hash);
  for (const node of document.querySelectorAll('#console .home')) node.hidden = !!view;
  $('back').hidden = !view;
  for (const [name, v] of Object.entries(VIEWS)) for (const id of v.sections) $(id).hidden = name !== view;
  if (view) $('more').open = false;
}
addEventListener('hashchange', () => { showView(); say(''); if (token) $('main').focus(); if (token && viewForHash(location.hash) === 'technical') loadTechnicalOverview().catch(error => { if (!(error instanceof SignedOut)) $('overview-status').textContent = error.message; }); });
showView();

const VIEW_WORD = { refunds: 'Open refunds', safety: 'Open Safety', messages: 'Open messages', money: 'Open money', service: 'Open jobs' };
function renderNeeds() {
  const { items, unknown } = needsYou(snapshot);
  $('needs-list').replaceChildren(...items.map(item => {
    const li = el('li', undefined, item.urgent ? 'urgent' : '');
    const text = el('div');
    text.append(el('strong', (item.urgent ? 'Urgent: ' : '') + item.title), el('p', item.detail, 'muted'));
    const link = el('a', VIEW_WORD[item.view] ?? 'Open', 'button-link'); link.href = '#' + item.view;
    link.setAttribute('aria-label', (VIEW_WORD[item.view] ?? 'Open') + ': ' + item.title);
    li.append(text, link);
    return li;
  }));
  $('all-good').hidden = items.length > 0 || unknown.length > 0;
  $('needs-unknown').hidden = unknown.length === 0;
  $('needs-unknown').textContent = 'Could not check: ' + unknown.join(', ') + '. This is not the same as all good; check again shortly.';
  $('needs-checked').textContent = 'Checked at ' + new Intl.DateTimeFormat('en-GB', { timeStyle: 'short' }).format(new Date()) + '.';
}

async function loadRefunds() {
  let refunds;
  try { ({ refunds } = await api('admin/balance-refunds')); } catch (error) {
    if (error instanceof SignedOut) throw error;
    // 503: account deletion is not set up on this server, so nothing can be owed.
    snapshot.refunds = error.status === 503 ? undefined : null;
    $('refunds-empty').hidden = false; $('refunds-empty').textContent = error.status === 503 ? error.message : 'Refunds could not be read: ' + error.message;
    $('refund-list').replaceChildren();
    return;
  }
  snapshot.refunds = refunds;
  $('refunds-empty').hidden = refunds.length > 0; $('refunds-empty').textContent = 'Nothing is owed.';
  $('refund-list').replaceChildren(...refunds.map(r => {
    const li = el('li');
    const text = el('div');
    text.append(el('strong', gbp.format(r.pence / 100) + ' to account '), code(r.accountId), el('p', 'Owed since ' + when(r.owedAtMs) + '.', 'muted'));
    li.append(text, button('Mark refunded', 'Mark the refund to ' + r.accountId + ' as paid', '', async () => {
      const reference = prompt('Paddle reference for this refund (from the Paddle dashboard)');
      if (reference === null) return;
      if (reference.trim().length < 3) { say('Enter the Paddle reference so the refund can be traced.'); return; }
      await api('admin/balance-refunds/' + encodeURIComponent(r.accountId) + '/refunded', { paddleReference: reference.trim() });
      await Promise.all([loadRefunds(), loadAudit()]);
      renderNeeds();
      say('Marked refunded.');
    }));
    return li;
  }));
}

async function loadOverview() {
  const o = await api('admin/overview');
  const facts = [
    ['Accounts', o.accounts], ['Licences', o.licences], ['Active devices', o.activations],
    ['Issuing keys', o.licenceIssuing ? 'Available' : 'Switched off'],
    ['Payments', o.paymentsConnected ? 'Connected' : 'Not connected'],
    ['Online helper', o.aiDisabled ? 'Switched off' : o.aiProvider ? 'On (' + o.aiProvider + ')' : 'Not set up'],
    ['Records stored in', o.store === 'firestore' ? 'Firestore' : 'SQLite'],
  ];
  $('overview-list').replaceChildren(...facts.map(([k, v]) => { const d = el('div'); d.append(el('dt', k), el('dd', String(v))); return d; }));
  $('issue-form').querySelector('button').disabled = !o.licenceIssuing;
  $('issue-unavailable').hidden = !!o.licenceIssuing;
  $('issue-form').querySelector('button').title = o.licenceIssuing ? '' : 'This server does not have the licence-issuing key.';
}

let licences = [];
async function loadLicensees() {
  licences = (await api('admin/licensees')).licences;
  renderLicensees();
}
function renderLicensees() {
  const filter = $('licence-filter').value.trim().toLowerCase();
  const rows = licences.filter(l => !filter || [l.licenceId, l.accountId, l.note].some(v => v && v.toLowerCase().includes(filter)));
  const body = $('licence-table').tBodies[0];
  body.replaceChildren(...rows.map(l => {
    const row = document.createElement('tr');
    cell(row, code(l.licenceId));
    const lapsed = l.validUntilMs !== null && l.validUntilMs <= Date.now();
    cell(row, badge(l.status === 'revoked' ? 'Revoked' : lapsed ? 'Expired' : l.status === 'active' ? 'Active' : l.status, l.status === 'active' && !lapsed ? 'good' : 'bad'));
    cell(row, l.accountId ? code(l.accountId) : 'Not linked');
    cell(row, l.note || '—');
    cell(row, l.validUntilMs ? dateOnly.format(new Date(l.validUntilMs)) : 'No expiry');
    const list = el('ul');
    for (const d of l.devices) {
      const item = el('li');
      item.append(el('span', d.platform + ' · ' + d.appVersion + ' · last seen ' + when(d.lastSeenMs) + ' '),
        button('Free', 'Free the ' + d.platform + ' device on licence ' + l.licenceId, 'quiet', async () => {
          if (!confirm('Free this ' + d.platform + ' device? It keeps working offline until its grant lapses, and the key can then be used on another device.')) return;
          await api('admin/devices/' + encodeURIComponent(d.activationId) + '/deactivate', {});
          await loadLicensees();
          say('Device freed on licence ' + l.licenceId + '.');
        }));
      list.append(item);
    }
    cell(row, l.devices.length ? list : 'None').prepend(el('span', l.devices.length + ' of ' + l.maxDevices + ' ', 'sr-only'));
    cell(row, l.aiQuota ? l.aiQuota.requestsUsed + ' of ' + l.aiQuota.requestsLimit : l.managedAi ? 'Included, unused' : 'Not included');
    const actions = el('div', undefined, 'row');
    if (l.status !== 'revoked') {
      actions.append(button('Revoke', 'Revoke licence ' + l.licenceId, 'danger', async () => {
        if (!confirm('Revoke licence ' + l.licenceId + '? New activations and renewals stop. Nobody loses photos or edits.')) return;
        await api('admin/licences/' + encodeURIComponent(l.licenceId) + '/revoke', {});
        await loadLicensees();
        say('Licence ' + l.licenceId + ' revoked.');
      }));
    }
    cell(row, actions);
    return row;
  }));
  $('licence-empty').hidden = licences.length > 0;
  $('licence-table').closest('.scroll').hidden = licences.length === 0;
}
$('licence-filter').addEventListener('input', renderLicensees);

act($('revoke-key-form'), 'submit', async () => {
  const form = $('revoke-key-form');
  const licenceKey = form.elements.licenceKey.value.trim();
  if (!confirm('Revoke this key? Devices using it turn Pro off at their next online check. Nobody loses photos or edits.')) return;
  // Clear the key from the page whatever happens, so it is not left on screen.
  form.reset();
  const result = await api('admin/licences/revoke-by-key', { licenceKey });
  await Promise.all([loadLicensees(), loadAudit()]);
  say('Licence ' + result.licenceId + ' revoked' + (result.wasKnown ? '.' : ', before any device used it.'));
});

act($('grant-form'), 'submit', async () => {
  const form = $('grant-form');
  const f = form.elements;
  $('grant-result').textContent = '';
  const body = { email: f.email.value.trim(), plan: 'paid', majorVersion: Number(f.majorVersion.value), managedAi: f.managedAi.checked };
  // Sent only when ticked, so an ordinary grant's request is unchanged.
  if (f.contributor.checked) body.contributor = true;
  if (f.note.value.trim()) body.note = f.note.value.trim();
  if (f.validDays.value) body.validDays = Number(f.validDays.value);
  const session = token;
  const result = await api('admin/licences/grant', body);
  if (!session || token !== session) return;
  form.reset();
  const what = body.contributor ? 'Contributor access (free Pro)' : 'Free Pro';
  const message = !result.created ? (body.contributor ? 'That address is already a contributor for this version.' : 'A Pro grant already exists for that address and version.') :
    result.attachedNow ? what + ' granted to the existing account.' : what + ' granted. It will attach when the recipient signs in with the verified address.';
  $('grant-result').textContent = message;
  await Promise.allSettled([loadOverview(), loadLicensees(), loadAudit()]);
});

act($('issue-form'), 'submit', async () => {
  const f = $('issue-form').elements;
  const body = { plan: 'paid', maxDevices: Number(f.maxDevices.value), managedAi: f.managedAi.checked };
  if (f.note.value.trim()) body.note = f.note.value.trim();
  if (f.validDays.value) body.validDays = Number(f.validDays.value);
  if (f.accountId.value.trim()) body.accountId = f.accountId.value.trim();
  const issued = await api('admin/licences/issue', body);
  $('issued-key').value = issued.licenceKey;
  $('issued').hidden = false;
  $('issue-form').reset();
  $('issued-key').focus();
  $('issued-key').select();
  say('Key issued for licence ' + issued.licenceId + (issued.validUntilMs ? ', valid until ' + dateOnly.format(new Date(issued.validUntilMs)) : '') + '. Copy it now.');
  await loadLicensees();
});
act($('copy-key'), 'click', async () => {
  await navigator.clipboard.writeText($('issued-key').value);
  say('Key copied.');
});

// ---- Monitoring rehearsal (no live connection or sending) -------------------------------------------------------
function clearMonitoringRehearsal() {
  $('monitoring-rehearsal').reset();
  $('monitoring-result').textContent = 'No rehearsal run.';
  $('monitoring-alerts').replaceChildren();
}
$('monitoring-rules').replaceChildren(...RULES.map(rule => {
  const row = el('tr');
  cell(row, rule.label); cell(row, rule.threshold);
  return row;
}));
act($('monitoring-rehearsal'), 'submit', async () => {
  if (!token) return;
  const scenario = $('monitoring-rehearsal').elements.scenario.value;
  const sample = Object.hasOwn(SCENARIOS, scenario) ? SCENARIOS[scenario] : null;
  const result = evaluateSample(sample);
  $('monitoring-alerts').replaceChildren(...rehearseDelivery(result.alerts).map(alert =>
    el('li', alert.severity + ': ' + alert.message + ' ' + alert.delivery)));
  $('monitoring-result').textContent = result.state !== 'evaluated'
    ? 'Synthetic sample unavailable or incomplete.'
    : 'Synthetic sample: ' + sample.requests + ' requests in 15 minutes, expected ' + sample.baseline +
      ', ' + sample.errors + ' server errors, ' + sample.budgetPercent + '% of budget. ' +
      (result.alerts.length ? result.alerts.length + ' proposed alert(s).' : 'No rule triggered.') +
      ' No live data or push delivery.';
});
act($('monitoring-clear'), 'click', async () => { clearMonitoringRehearsal(); });

// ---- Notification rehearsal: no network, no actual recipients, no persistence ---------------------------------
const notificationForm = $('notification-form');
function clearNotificationPreview() {
  $('notification-result').textContent = 'No preview yet.';
  $('notification-preview').hidden = true;
  $('notification-title').textContent = '';
  $('notification-body').textContent = '';
}
function addNotificationRule() {
  const container = $('notification-rules');
  if (container.children.length >= 20) { say('At most 20 rehearsal rules.'); return; }
  const row = el('div', undefined, 'row');
  const selectField = (label, values) => {
    const wrapper = el('label', label);
    const select = el('select');
    for (const [value, text] of values) { const option = el('option', text); option.value = value; select.append(option); }
    wrapper.append(select); row.append(wrapper);
    return select;
  };
  const mode = selectField('Rule', [['include','Include'],['exclude','Exclude']]); mode.dataset.field = 'mode';
  const dimension = selectField('Field', Object.entries(DIMENSIONS)); dimension.dataset.field = 'dimension';
  const label = el('label', 'Value'); const input = el('input');
  input.dataset.field = 'value'; input.maxLength = 160; input.required = true; label.append(input); row.append(label);
  row.append(button('Remove', 'Remove audience rule', 'quiet', async () => { row.remove(); clearNotificationPreview(); }));
  container.append(row);
  clearNotificationPreview();
}
function resetNotificationRehearsal() {
  notificationForm.reset();
  $('notification-rules').replaceChildren();
  clearNotificationPreview();
}
act($('notification-add'), 'click', async () => { addNotificationRule(); });
notificationForm.addEventListener('input', clearNotificationPreview);
notificationForm.elements.locale.addEventListener('change', () => {
  // A draft for one language must never be silently reused for a different language.
  notificationForm.elements.variantTitle.value = '';
  notificationForm.elements.variantBody.value = '';
  clearNotificationPreview();
});
act(notificationForm, 'submit', async () => {
  if (!token) return;
  clearNotificationPreview();
  const f = notificationForm.elements;
  const rules = [...$('notification-rules').children].map(row => Object.fromEntries(
    [...row.querySelectorAll('[data-field]')].map(field => [field.dataset.field, field.value])));
  const count = previewAudience(SAMPLE_DEVICES, rules, f.match.value, f.allowAll.checked);
  const preview = messagePreview({ title: f.sourceTitle.value, body: f.sourceBody.value },
    { title: f.variantTitle.value, body: f.variantBody.value }, f.locale.value);
  $('notification-result').textContent = count.accounts + ' sample account(s), ' + count.devices + ' sample device(s). ' +
    (preview.fallback ? 'English fallback; no translated draft.' : 'Preview language: ' + preview.locale + '. Manual draft, not reviewed.') +
    ' No real recipients or sends.';
  $('notification-title').textContent = preview.title;
  $('notification-body').textContent = preview.body;
  $('notification-preview').hidden = false;
});

async function loadUsage() {
  const u = await api('admin/usage');
  $('usage-state').textContent = u.aiDisabled ? 'The online helper is switched off.' : u.aiProvider ? 'The online helper is on.' : 'The online helper is not set up on this server.';
  $('usage-table').tBodies[0].replaceChildren(...u.accounts.map(a => {
    const row = document.createElement('tr');
    cell(row, code(a.accountId)); cell(row, String(a.requestsUsed)); cell(row, String(a.requestsLimit)); cell(row, when(a.periodEndsMs));
    return row;
  }));
  $('usage-empty').hidden = u.accounts.length > 0;
  $('usage-table').closest('.scroll').hidden = u.accounts.length === 0;
}

async function loadPaddleKey() {
  let k;
  try { k = await api('admin/paddle/key'); } catch (error) {
    if (error instanceof SignedOut) throw error;
    snapshot.paddleKey = undefined;
    $('paddle-key-state').textContent = '';
    return;
  }
  snapshot.paddleKey = k;
  const date = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const parts = [];
  if (k.expiresAt) parts.push(`Paddle API key renews itself. Last renewed ${date(k.rotatedAt)}; it expires ${date(k.expiresAt)} unless renewed again.`);
  else parts.push('Paddle API key: not renewed by InFlight yet. The weekly check renews it on its first run.');
  if (k.lastRunOk === false) parts.push(`Warning: the last weekly check failed (${date(k.lastRunAt)}): ${k.lastRunReason}`);
  $('paddle-key-state').textContent = parts.join(' ');
}

async function loadPayments() {
  const p = await api('admin/payments');
  $('payments-state').textContent = p.connected
    ? 'Paid checkouts recorded after Paddle confirmed them. Amounts are what Paddle pays out; Paddle handles the buyer\'s tax.'
    : 'Paddle is not connected yet, so there are no payments to show. Refunds will appear here too once checkout is live.';
  $('payments-table').tBodies[0].replaceChildren(...p.transactions.map(t => {
    const row = document.createElement('tr');
    cell(row, when(Date.parse(t.paidAt))); cell(row, t.invoiceNumber); cell(row, t.status === 'paid' ? 'Paid' : t.status === 'refunded' ? 'Refunded' : 'Partly refunded');
    cell(row, t.country); cell(row, gbp.format(t.netPence / 100)); cell(row, gbp.format(t.taxPence / 100)); cell(row, gbp.format(t.totalPence / 100));
    cell(row, t.accountId ? code(t.accountId) : '—');
    return row;
  }));
  $('payments-empty').hidden = !p.connected || p.transactions.length > 0;
  $('payments-table').closest('.scroll').hidden = p.transactions.length === 0;
}

// ---- Accounts (read-only) ---------------------------------------------------------------------------------------

const accountsForm = $('accounts-month');
accountsForm.elements.month.value = new Date().toISOString().slice(0, 7);
$('accounts-vat-help').replaceChildren(...VAT_HELP.map(line => el('li', line)));
const money = pence => gbp.format(pence / 100);
const minor = (amounts) => Object.entries(amounts).map(([currency, value]) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(value / 100)).join(', ') || '—';
const facts = (target, list) => $(target).replaceChildren(...list.map(([k, v]) => { const d = el('div'); d.append(el('dt', k), el('dd', v)); return d; }));
let accountsData = null;
let billing = null;

function renderAccounts() {
  if (!accountsData) return;
  const { month } = accountsData;
  const income = summariseIncome(accountsData.transactions);
  const costModelPence = accountsData.costModel ? accountsData.costModel.reservedPence : null;
  const s = accountsSummary({ income, costModelPence, billing, month });
  facts('accounts-summary', [
    ['Income', money(s.incomePence)],
    ['Costs', s.costBasis === 'none' ? 'Not known' : money(s.costPence)],
    [s.profitPence < 0 ? 'Loss' : 'Profit', money(Math.abs(s.profitPence))],
  ]);
  $('accounts-basis').textContent = monthName(month) + '. Income is what Paddle paid out to InFlight. Costs are '
    + (s.costBasis === 'billing' ? 'from the Google Cloud bill you chose.' : s.costBasis === 'cost-model' ? 'an estimate from InFlight\'s cost model, not Google\'s bill. Choose the bill below to use Google\'s own figures.' : 'not known: there is no cost model on this server and no bill chosen.')
    + ' Other costs (domain, Apple and Google developer fees, your own time) are not included.';
  facts('accounts-income', [
    ['Sales', String(income.sales)],
    ['Buyers paid', minor(income.buyerPaid)],
    ['Tax Paddle handled', minor(income.buyerTax)],
    ['Paddle\'s fee', money(income.paddleFeePence)],
    ['Paid out to InFlight', money(income.earningsPence)],
  ]);
  const notes = [];
  if (!accountsData.paymentsConnected) notes.push('Paddle is not connected on this server, so there is no income to show.');
  if (income.refunded) notes.push(income.refunded + (income.refunded === 1 ? ' sale was' : ' sales were') + ' refunded and count as nothing.');
  if (income.partlyRefunded) notes.push(income.partlyRefunded + ' partly refunded: the refunded amount is not recorded here, so check Paddle\'s dashboard.');
  if (income.otherCurrency) notes.push(income.otherCurrency + ' paid out in another currency and not added up. Paddle\'s payout report has the pound value.');
  $('accounts-income-notes').textContent = notes.join(' ');
  $('accounts-cost-model').textContent = accountsData.costModel
    ? 'Cost model: ' + money(accountsData.costModel.reservedPence) + ' of metered spend (online helper and cloud processing) estimated for this month, against a ' + money(accountsData.costModel.ceilingPence) + ' monthly limit. It is a brake on spending, not Google\'s invoice.'
    : 'Cost model: not set up on this server.';
  $('accounts-billing-state').textContent = !billing ? 'No bill chosen.'
    : !billing.ok ? billing.problem
    : s.billingNote ?? ('Google Cloud bill: ' + money(billing.totalPence) + ' from ' + billing.rowsRead + ' rows' + (billing.rowsSkipped ? ', ' + billing.rowsSkipped + ' total or unreadable rows skipped' : '') + (billing.months.length ? '' : '. The file has no month column, so make sure it covers ' + monthName(month) + ' only') + '.');
  const rows = billing?.ok ? billing.services : [];
  $('accounts-billing-table').tBodies[0].replaceChildren(...rows.map(service => {
    const row = document.createElement('tr');
    cell(row, service.name); cell(row, money(service.pence));
    return row;
  }));
  $('accounts-billing-table').closest('.scroll').hidden = rows.length === 0;
}

async function loadAccounts() {
  try { accountsData = await api('admin/accounts?month=' + encodeURIComponent(accountsForm.elements.month.value)); } catch (error) {
    if (error instanceof SignedOut) throw error;
    $('accounts-unavailable').hidden = false;
    $('accounts-unavailable').textContent = error.message;
    return;
  }
  $('accounts-unavailable').hidden = true;
  renderAccounts();
}
act(accountsForm, 'submit', loadAccounts);
$('accounts-billing').addEventListener('change', async () => {
  const file = $('accounts-billing').files?.[0];
  billing = file ? readGcpBilling(await file.text()) : null;
  renderAccounts();
});

const STATUS_WORDS = { new: 'New', read: 'Read', answered: 'Answered' };
async function loadMessages() {
  let messages;
  try { ({ messages } = await api('admin/messages')); } catch (error) { snapshot.messages = null; throw error; }
  snapshot.messages = messages;
  $('message-list').replaceChildren(...messages.map(m => {
    const item = el('li');
    const meta = el('p', undefined, 'meta');
    const from = el('strong', m.name);
    // Contributor feedback from the app carries no address (only the account id, in the message).
    let mail;
    if (m.email) { mail = el('a', m.email); mail.href = 'mailto:' + encodeURIComponent(m.email).replace(/%40/g, '@'); }
    else mail = badge('Contributor', '');
    meta.append(badge(STATUS_WORDS[m.status], m.status === 'new' ? 'bad' : m.status === 'answered' ? 'good' : ''), from, mail, el('span', when(m.receivedAtMs), 'muted'));
    const actions = el('div', undefined, 'row');
    for (const next of ['read', 'answered', 'new']) {
      if (next === m.status) continue;
      actions.append(button('Mark ' + STATUS_WORDS[next].toLowerCase(), 'Mark the message from ' + m.name + ' as ' + STATUS_WORDS[next].toLowerCase(), 'quiet', async () => {
        await api('admin/messages/' + encodeURIComponent(m.messageId) + '/status', { status: next });
        await loadMessages();
        say('Message from ' + m.name + ' marked ' + STATUS_WORDS[next].toLowerCase() + '.');
      }));
    }
    item.append(meta, el('p', m.message, 'body'), actions);
    return item;
  }));
  $('messages-empty').hidden = messages.length > 0;
}

// ---- Prices (the pricing matrix, src/core/pricingMatrix.ts) ----------------------------------------------------
const PRICE_ITEMS = ['pro.monthly', 'pro.annual'];
const ITEM_LABEL = { 'pro.monthly': 'monthly', 'pro.annual': 'yearly' };
const PADDLE_CURRENCIES = ['USD', 'EUR', 'JPY', 'AUD', 'CAD', 'CHF', 'HKD', 'SGD', 'SEK', 'ARS', 'BRL', 'CNY', 'COP', 'CZK', 'DKK', 'HUF', 'ILS', 'INR', 'KRW', 'MXN', 'NOK', 'NZD', 'PLN', 'RUB', 'THB', 'TRY', 'TWD', 'UAH', 'VND', 'ZAR'];
const pricingForm = $('pricing-form');
let pricing = null;
let pricingRows = [];

const digitsOf = currency => { try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits; } catch { return 2; } };
const moneyText = (minor, currency) => {
  const digits = digitsOf(currency);
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits); } catch { return currency + ' ' + minor; }
};
/** "3.49" → 349 (in the currency's minor unit); "" → undefined; anything else → NaN. */
function toMinor(text, currency) {
  const value = String(text ?? '').trim();
  if (!value) return undefined;
  const digits = digitsOf(currency);
  if (!new RegExp('^\\d+(\\.\\d{1,' + Math.max(digits, 0) + '})?$').test(value) || (digits === 0 && value.includes('.'))) return NaN;
  return Math.round(Number(value) * 10 ** digits);
}
const fromMinor = (minor, currency) => (minor === undefined || minor === null ? '' : String(minor / 10 ** digitsOf(currency)));

function renderPricing(result) {
  pricing = result.matrix;
  for (const item of PRICE_ITEMS) pricingForm.elements['base-' + item].value = fromMinor(pricing.base[item], 'GBP');
  $('pricing-rates').textContent = pricing.rates.date ? `ECB reference rates for ${pricing.rates.date}.` : 'No exchange rates yet. Fetch them to convert the other currencies.';
  $('pricing-status').textContent = pricing.updatedAt ? `Last saved ${when(Date.parse(pricing.updatedAt))}.` : 'Not saved yet: showing the starting prices.';
  const computed = Object.fromEntries((result.prices ?? []).map(row => [row.currency, row]));
  pricingRows = Object.keys(pricing.currencies).sort();
  const body = $('pricing-rows');
  body.replaceChildren();
  for (const currency of pricingRows) {
    const rule = pricing.currencies[currency];
    const row = el('tr');
    row.dataset.currency = currency;
    cell(row, currency);
    cell(row, pricing.rates.perGbp[currency] ? String(pricing.rates.perGbp[currency]) : 'No rate');
    const rounding = el('select');
    rounding.name = 'rounding-' + currency;
    rounding.setAttribute('aria-label', currency + ' rounding');
    for (const [value, label] of [['charm', 'Charm (3.99, 35, 299)'], ['whole', 'Whole units'], ['exact', 'Exact conversion']]) rounding.add(new Option(label, value));
    rounding.value = rule.rounding;
    cell(row, rounding);
    for (const item of PRICE_ITEMS) {
      const input = el('input');
      input.name = 'override-' + currency + '-' + item;
      input.inputMode = 'decimal';
      input.size = 8;
      input.setAttribute('aria-label', `${currency} ${ITEM_LABEL[item]} override`);
      input.value = fromMinor(rule.overrides[item], currency);
      cell(row, input);
    }
    for (const item of PRICE_ITEMS) {
      const price = computed[currency]?.prices[item];
      cell(row, price ? moneyText(price.minor, currency) + (price.source === 'override' ? ' (override)' : '') : 'Not offered');
    }
    cell(row, button('Remove', 'Remove ' + currency, '', async () => { delete pricing.currencies[currency]; renderPricing({ matrix: readPricingForm(), prices: result.prices, paddle: result.paddle }); }));
    body.append(row);
  }
  const add = $('pricing-add');
  add.replaceChildren(...PADDLE_CURRENCIES.filter(c => !pricing.currencies[c]).map(c => new Option(c, c)));
  if (result.paddle !== undefined) renderPaddle(result.paddle);
}

function renderPaddle(check) {
  const list = $('pricing-paddle-list');
  list.replaceChildren();
  if (!check) { $('pricing-paddle').textContent = 'Paddle is not set up on this server, so checkout prices cannot be checked.'; $('pricing-push').hidden = true; return; }
  $('pricing-push').hidden = false;
  $('pricing-paddle').textContent = check.inStep ? 'In step: Paddle charges exactly these prices.' : 'Not in step: Paddle would charge something different. Save, then set the Paddle prices.';
  for (const row of check.items) {
    if (row.error) list.append(el('li', `Pro, ${ITEM_LABEL[row.item]}: ${row.error}`));
    for (const d of row.differences) {
      const matrix = d.matrix === null ? 'not offered' : moneyText(d.matrix, d.currency);
      const paddle = d.paddle === null ? 'not set, or not for every country' : moneyText(d.paddle, d.currency);
      list.append(el('li', `Pro, ${ITEM_LABEL[row.item]}, ${d.currency}: matrix ${matrix}, Paddle ${paddle}`));
    }
  }
}

function readPricingForm() {
  const base = {};
  for (const item of PRICE_ITEMS) base[item] = toMinor(pricingForm.elements['base-' + item].value, 'GBP');
  const currencies = {};
  for (const currency of Object.keys(pricing.currencies)) {
    const rounding = pricingForm.elements['rounding-' + currency]?.value ?? pricing.currencies[currency].rounding;
    const overrides = {};
    for (const item of PRICE_ITEMS) {
      const input = pricingForm.elements['override-' + currency + '-' + item];
      const minor = input ? toMinor(input.value, currency) : pricing.currencies[currency].overrides[item];
      if (Number.isNaN(minor)) throw new Error(`The ${currency} ${ITEM_LABEL[item]} override is not an amount.`);
      if (minor !== undefined) overrides[item] = minor;
    }
    currencies[currency] = { rounding, overrides };
  }
  if (PRICE_ITEMS.some(item => !Number.isFinite(base[item]))) throw new Error('Type both UK prices as amounts, for example 2.99.');
  return { version: 1, base, rates: pricing.rates, currencies };
}

async function loadPricing() {
  try { renderPricing(await api('admin/pricing')); } catch (error) {
    if (error instanceof SignedOut) throw error;
    $('pricing-status').textContent = error.message;
  }
}

act($('pricing-fetch-rates'), 'click', async () => {
  const matrix = readPricingForm();
  const { rates } = await api('admin/pricing/rates', {});
  matrix.rates = rates;
  renderPricing(await api('admin/pricing/preview', matrix));
  say(`Fetched ECB rates for ${rates.date}. Check the prices, then save.`);
});
act($('pricing-add-button'), 'click', async () => {
  const matrix = readPricingForm();
  const currency = $('pricing-add').value;
  if (!currency) return;
  matrix.currencies[currency] = { rounding: 'charm', overrides: {} };
  renderPricing(await api('admin/pricing/preview', matrix));
});
act($('pricing-preview'), 'click', async () => { renderPricing(await api('admin/pricing/preview', readPricingForm())); say('Preview only: nothing is saved yet.'); });
act(pricingForm, 'submit', async () => { renderPricing(await api('admin/pricing', readPricingForm())); say('Prices saved. The website and app show them within a few minutes.'); });
act($('pricing-push'), 'click', async () => {
  renderPricing(await api('admin/pricing/paddle', {}));
  say('Paddle prices set from the saved matrix. New checkouts charge these prices; existing subscriptions keep theirs.');
});

// ---- Tax (from the tax admin, #547) ----------------------------------------------------------------------------
async function loadPriceReview() {
  $('price-review-table').hidden = true;
  $('price-review-rows').replaceChildren();
  let review;
  try { ({ review } = await api('admin/pricing/review')); } catch (error) {
    if (error instanceof SignedOut) throw error;
    $('price-review-status').textContent = error.message;
    return;
  }
  if (!review) {
    $('price-review-status').textContent = 'No scheduled review has run yet.';
    return;
  }
  $('price-review-status').textContent = `${review.month} · ECB reference rates for ${review.rateDate} · For review. Live prices are unchanged.`
    + (review.inflation ? ` April UK CPI: ${review.inflation.baseline.date} to ${review.inflation.latest.date}.` : '');
  for (const price of review.prices) {
    const row = el('tr');
    cell(row, price.currency);
    if (price.status === 'for-review') {
      const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: price.currency });
      cell(row, money.format(price.unroundedMajor));
      cell(row, money.format(price.proposedMajor));
    } else {
      cell(row, 'Rate unavailable');
      cell(row, '—');
    }
    $('price-review-rows').append(row);
  }
  $('price-review-table').hidden = false;
}

const taxForm = $('tax-settings');
const ossForm = $('oss');
ossForm.elements.year.value = new Date().getFullYear();
ossForm.elements.quarter.value = Math.floor(new Date().getMonth() / 3) + 1;

async function loadTax() {
  let summary;
  try { summary = await api('admin/tax'); } catch (error) {
    if (error instanceof SignedOut) throw error;
    $('tax-body').hidden = true;
    $('tax-unavailable').hidden = false;
    $('tax-unavailable').textContent = error.message;
    snapshot.tax = undefined;
    return;
  }
  snapshot.tax = summary;
  $('tax-body').hidden = false;
  $('tax-unavailable').hidden = true;
  const { settings, turnover, thresholdPence, warningPence } = summary;
  $('turnover').max = thresholdPence / 100;
  $('turnover').value = Math.max(0, turnover.rollingPence / 100);
  $('turnover-value').textContent = gbp.format(turnover.rollingPence / 100) + ' of ' + gbp.format(thresholdPence / 100);
  const notices = [];
  if (turnover.state === 'warning') notices.push('Turnover has reached the ' + gbp.format(warningPence / 100) + ' warning level.');
  if (turnover.backward) notices.push('Month-end breach. Notify HMRC by ' + turnover.backward.notificationDue + '. Effective date ' + turnover.backward.effectiveDate + '.');
  if (turnover.forward) notices.push('30-day forecast breach. Notify HMRC by ' + turnover.forward.notificationDue + '. Effective date ' + turnover.forward.effectiveDate + '.');
  $('turnover-state').textContent = notices.join(' ');
  taxForm.elements.ukVatRegistered.checked = settings.ukVatRegistered;
  taxForm.elements.ukVatNumber.value = settings.ukVatNumber ?? '';
  taxForm.elements.b2cPricing.value = settings.b2cPricing;
  localTaxes = settings.localTaxes;
}

act(taxForm, 'submit', async () => {
  const { ukVatRegistered, ukVatNumber, b2cPricing } = taxForm.elements;
  await api('admin/tax/settings', { ukVatRegistered: ukVatRegistered.checked, ukVatNumber: ukVatNumber.value, b2cPricing: b2cPricing.value, localTaxes });
  say('Tax settings saved.');
});

act(ossForm, 'submit', async () => {
  const parameters = new URLSearchParams(new FormData(ossForm));
  const { year, quarter, rows } = await api('admin/tax/oss?' + parameters);
  const lines = ['country,rate_basis_points,net_gbp_pence,tax_gbp_pence'];
  for (const row of rows) lines.push([row.country, row.rateBasisPoints, row.netPence, row.taxPence].join(','));
  const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kestrel-oss-' + year + '-Q' + quarter + '.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say('Quarterly summary downloaded.');
});

// ---- Feature flags ---------------------------------------------------------------------------------------------

let flagsState = {};
const flagForm = $('flag-form');
const ruleRows = $('flag-rule-rows');
$('never-gated').textContent = NEVER_GATED.join(', ');
$('flag-names').replaceChildren(...KNOWN_FLAGS.map(name => { const option = document.createElement('option'); option.value = name; return option; }));

// ---- Safety -----------------------------------------------------------------------------------------------------
// Details only. There is deliberately no way to open a held or blocked picture from here.

function askReason(question) {
  const reason = prompt(question);
  if (reason === null) return null;
  if (reason.trim().length < 3) { say('Give a short reason: it is shown to the people involved.'); return null; }
  return reason.trim();
}

async function loadSafety() {
  let s;
  try { s = await api('admin/safety'); } catch (error) {
    if (error instanceof SignedOut) throw error;
    snapshot.safety = null;
    $('safety-checks').textContent = 'Safety checks are not set up on this server yet.'; return;
  }
  snapshot.safety = s;
  const c = s.checks;
  $('safety-checks').textContent = !c ? 'Safety is not set up on this server.'
    : 'Hash checks: ' + (c.hashMatchers.length ? c.hashMatchers.join(', ') : 'none') + '. AI check: ' + (c.classifier ?? 'none') + '. CyberTipline connection: ' + (c.reporter ? 'set up' : 'not yet (report by hand)') + '.'
      + (s.publishingRefused ? ' Publishing to galleries and the cloud is refused until a hash check is set up.' : '');
  $('safety-cases').tBodies[0].replaceChildren(...s.cases.map(k => {
    const row = document.createElement('tr');
    cell(row, when(k.atMs));
    cell(row, badge(k.kind === 'hash-match' ? 'Hash match' : 'AI flag', k.kind === 'hash-match' ? 'bad' : undefined));
    cell(row, (k.scope === 'gallery' ? 'Gallery ' + (k.galleryId ?? '').slice(0, 8) : 'Cloud project ' + k.projectId.slice(0, 8)) + ' · ' + k.variant + (k.country ? ' · ' + k.country : ''));
    cell(row, k.detection.checker + (k.detection.labels ? ' (' + Object.entries(k.detection.labels).map(([a, b]) => a + ' ' + b.toLowerCase()).join(', ') + ')' : k.detection.source ? ' (' + k.detection.source + ')' : ''));
    cell(row, k.status + (k.appeal ? ' · appealed: ' + k.appeal.text : '') + (k.decision ? ' · ' + k.decision.reason : ''));
    cell(row, k.kind === 'hash-match' ? 'NCMEC ' + (k.ncmec?.reportId ?? (k.ncmec?.error ? 'failed: ' + k.ncmec.error : 'pending')) + ' · NCA ' + k.nca : 'Never reported');
    const actions = el('div', undefined, 'row');
    const done = async message => { await Promise.all([loadSafety(), loadAudit()]); say(message); };
    if (k.kind === 'ai-flag' && k.status === 'review') {
      actions.append(
        button('Release', 'Release case ' + k.caseId, '', async () => { const reason = askReason('Why is it fine to share?'); if (reason) { await api('admin/safety/cases/' + k.caseId + '/decide', { outcome: 'released', reason }); await done('Released.'); } }),
        button('Keep held', 'Uphold case ' + k.caseId, 'danger', async () => { const reason = askReason('Why does it stay held? The uploader sees this.'); if (reason) { await api('admin/safety/cases/' + k.caseId + '/decide', { outcome: 'upheld', reason }); await done('Kept held.'); } }));
    }
    if (k.kind === 'hash-match' && k.status !== 'reported') {
      actions.append(
        button('Send report', 'Send CyberTipline report for ' + k.caseId, '', async () => { await api('admin/safety/cases/' + k.caseId + '/report', {}); await done('Reported to NCMEC.'); }),
        button('Record manual report', 'Record a manual report for ' + k.caseId, '', async () => { const id = prompt('NCMEC CyberTipline report number (leave empty if none yet)'); if (id === null) return; const nca = k.nca === 'manual' && confirm('Has the NCA report been made too?'); await api('admin/safety/cases/' + k.caseId + '/manual-report', { ...(id.trim() ? { ncmecReportId: id.trim() } : {}), ncaDone: nca }); await done('Recorded.'); }));
    }
    if (k.kind === 'hash-match' && k.status === 'reported' && k.nca === 'manual') {
      actions.append(button('NCA report made', 'Record NCA report for ' + k.caseId, '', async () => { await api('admin/safety/cases/' + k.caseId + '/manual-report', { ncaDone: true }); await done('Recorded.'); }));
    }
    cell(row, actions);
    return row;
  }));
  $('safety-notices').tBodies[0].replaceChildren(...s.notices.map(n => {
    const row = document.createElement('tr');
    cell(row, when(n.atMs));
    cell(row, n.urgent ? badge('Urgent: ' + n.category, 'bad') : n.category);
    cell(row, 'Gallery ' + n.galleryId.slice(0, 8) + (n.photoId ? ' · photo ' + n.photoId.slice(0, 12) : ' · whole gallery'));
    cell(row, n.explanation);
    cell(row, [n.notifierName, n.notifierEmail].filter(Boolean).join(' · ') || 'Anonymous');
    cell(row, n.decision ? n.decision.outcome + ': ' + n.decision.reason : 'Open');
    const actions = el('div', undefined, 'row');
    if (n.status === 'open') {
      const decide = (outcome, label, question) => button(label, label + ' for report ' + n.noticeId, outcome === 'no-action' ? '' : 'danger', async () => {
        const reason = askReason(question); if (!reason) return;
        await api('admin/safety/notices/' + n.noticeId + '/decide', { outcome, reason });
        await Promise.all([loadSafety(), loadAudit()]); say('Decided. The reporter and the gallery owner can see the reason.');
      });
      actions.append(decide('no-action', 'No action', 'Why no action? The reporter sees this.'));
      if (n.photoId) actions.append(decide('photo-removed', 'Remove photo', 'Why remove it? Both sides see this.'));
      actions.append(decide('gallery-revoked', 'Revoke gallery', 'Why revoke it? Both sides see this.'));
    }
    cell(row, actions);
    return row;
  }));
}

// ---- Switches ---------------------------------------------------------------------------------------------------

async function loadSwitches() {
  const { switches } = await api('admin/switches');
  $('switches-table').tBodies[0].replaceChildren(...switches.map(item => {
    const row = document.createElement('tr');
    const name = el('div');
    name.append(el('strong', item.label), el('div', item.note, 'muted'));
    cell(row, name);
    cell(row, badge(item.configured ? 'Yes' : 'Not yet', item.configured ? 'good' : undefined));
    cell(row, badge(item.on ? 'On' : 'Off', item.on ? 'good' : undefined));
    const turn = !item.on;
    const label = (turn ? 'Switch on ' : 'Switch off ') + item.label;
    const action = button(turn ? 'Switch on' : 'Switch off', label, turn ? '' : 'danger', async () => {
      if (turn && !confirm('Switch on ' + item.label + '? Metered features can start costing money, within the monthly spending limit.')) return;
      await api('admin/switches/set', { key: item.key, on: turn });
      await Promise.all([loadSwitches(), loadAudit()]);
      say(item.label + (turn ? ' is on.' : ' is off.'));
    });
    if (turn && !item.configured) { action.disabled = true; action.title = 'Not set up on the server yet'; }
    cell(row, action);
    return row;
  }));
}

// ---- Product news: live, behind the Product news switch. A dry run counts and sends nothing.
const newsForm = $('news-form');
act(newsForm, 'submit', async (e) => {
  if (!token) return;
  const dryRun = e.submitter?.name !== 'send';
  const f = newsForm.elements;
  const body = { title: f.title.value.trim(), body: f.body.value.trim(), dryRun };
  if (f.broadcastId.value.trim()) body.broadcastId = f.broadcastId.value.trim();
  if (!dryRun && !confirm('Send this news to everyone now? Push first; email only to people who asked for it.')) return;
  const r = await api('admin/news/send', body);
  f.broadcastId.value = r.broadcastId;
  $('news-result').textContent = (dryRun ? 'Dry run, nothing sent: ' : 'Sent: ') + r.audience + ' people in the audience, ' +
    r.pushed + (dryRun ? ' would be pushed, ' : ' pushed, ') + r.emailed + (dryRun ? ' would be emailed, ' : ' emailed, ') +
    r.off + ' switched news off, ' + r.unreachable + ' not reachable, ' + r.alreadyReached + ' already reached. ' +
    (r.emailWaiting ? r.emailWaiting + ' email(s) waiting' + (r.emailLimitReached ? ' because today’s email limit was reached' : '') + ': send again with the same id tomorrow. ' : '') +
    (r.notTried ? r.notTried + ' not tried in this run: send again with the same id. ' : '') + 'Id ' + r.broadcastId + '.';
});

// ---- Compliance documents ------------------------------------------------------------------------------------

const sizeText = bytes => bytes >= 1_000_000 ? (bytes / 1_000_000).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1000)) + ' KB';
let complianceMaxBytes = 8_000_000;

async function loadCompliance() {
  let c;
  try { c = await api('admin/compliance/documents'); } catch (error) {
    if (error instanceof SignedOut) throw error;
    $('compliance-unavailable').hidden = false; $('compliance-form').hidden = true; $('compliance-empty').hidden = true;
    $('compliance-table').tBodies[0].replaceChildren(); return;
  }
  complianceMaxBytes = c.maxBytes ?? complianceMaxBytes;
  $('compliance-unavailable').hidden = true; $('compliance-form').hidden = false;
  $('compliance-empty').hidden = c.documents.length > 0;
  $('compliance-table').tBodies[0].replaceChildren(...c.documents.map(d => {
    const row = el('tr');
    const name = el('div'); name.append(el('strong', d.title), el('div', d.fileName, 'muted'));
    cell(row, name); cell(row, when(d.uploadedAtMs)); cell(row, sizeText(d.bytes));
    cell(row, button('Download', 'Download ' + d.title, '', async () => {
      const link = await api('admin/compliance/documents/' + encodeURIComponent(d.id) + '/download');
      location.assign(link.url);
      say('Downloading ' + d.fileName + '.');
    }));
    return row;
  }));
}

act($('compliance-form'), 'submit', async () => {
  const form = $('compliance-form');
  const file = form.elements.file.files[0];
  if (!file) { say('Choose a file first.'); return; }
  const lower = file.name.toLowerCase();
  const contentType = lower.endsWith('.pdf') ? 'application/pdf' : lower.endsWith('.md') ? 'text/markdown' : null;
  if (!contentType) { say('Upload a PDF (.pdf) or a Markdown file (.md).'); return; }
  if (file.size > complianceMaxBytes) { say('That file is too large: documents must be ' + sizeText(complianceMaxBytes) + ' or less.'); return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await api('admin/compliance/documents', { title: form.elements.title.value.trim(), fileName: file.name, contentType, base64: btoa(binary) });
  form.reset();
  await Promise.all([loadCompliance(), loadAudit()]);
  say('Uploaded. It is listed below.');
});

async function loadMail() {
  let m;
  try { m = await api('admin/mail'); } catch (error) {
    if (error instanceof SignedOut) throw error;
    snapshot.mail = undefined;
    $('mail-unavailable').hidden = false; $('mail-warning').hidden = true; $('mail-facts').replaceChildren(); return;
  }
  snapshot.mail = m;
  $('mail-unavailable').hidden = true;
  const facts = [
    ['Switch', m.on ? 'On' : 'Off (see Switches)'],
    ['Sent today (' + m.day + ', UTC)', m.sent + ' of ' + m.cap],
    ['Sending account', (m.account === 'gmail' ? 'Personal Gmail' : 'Google Workspace') + (m.from ? ' (from ' + m.from + ')' : '')],
    [m.account === 'gmail' ? 'Gmail limit' : 'Google Workspace limit', 'About ' + m.providerLimit + ' a day'],
  ];
  $('mail-facts').replaceChildren(...facts.map(([k, v]) => { const d = el('div'); d.append(el('dt', k), el('dd', String(v))); return d; }));
  $('mail-warning').hidden = !m.warn;
}

const pounds = (pence) => '£' + (pence / 100).toFixed(2);
const WHY = { count: 'Photo count reached', weekly: 'Weekly', manual: 'Learn now' };
const RESULT = { reserved: 'Starting', submitted: 'Running', succeeded: 'Finished', failed: 'Failed (cost still counted)', 'not-started': 'Not started (nothing charged)' };
async function loadLearning() {
  let s;
  try { s = await api('admin/learning'); } catch (error) {
    if (error instanceof SignedOut) throw error;
    snapshot.learning = undefined;
    $('learning-unavailable').hidden = false; $('learning-run').disabled = true; $('learning-facts').replaceChildren(); return;
  }
  snapshot.learning = s;
  $('learning-unavailable').hidden = true;
  const facts = [
    ['Switch', s.on ? 'On' : 'Off (see Switches)'],
    ['New photos since the last batch', s.newPhotos + ' of ' + s.photoThreshold],
    ['This month (' + s.month + ')', pounds(s.reservedPence) + ' reserved of ' + pounds(s.ceilingPence)],
    ['Each batch reserves', pounds(s.runReservePence) + ' (its worst case)'],
    ['Now', s.running ? 'A batch is running' : s.manualRequested ? 'Learn now is waiting for the next check' : 'Waiting'],
  ];
  $('learning-facts').replaceChildren(...facts.map(([k, v]) => { const d = el('div'); d.append(el('dt', k), el('dd', String(v))); return d; }));
  $('learning-run').disabled = !s.on || s.running;
  $('learning-runs').tBodies[0].replaceChildren(...s.runs.map(r => {
    const row = document.createElement('tr');
    cell(row, new Date(r.startedAtMs).toLocaleString('en-GB'));
    cell(row, WHY[r.trigger] ?? r.trigger);
    cell(row, String(r.newPhotos));
    cell(row, pounds(r.reservedPence));
    cell(row, RESULT[r.status] ?? r.status);
    return row;
  }));
}
act($('learning-run'), 'click', async () => {
  if (!confirm('Start a learning batch now? It is refused if this month would pass the ceiling.')) return;
  const r = await api('admin/learning/run', {});
  await Promise.all([loadLearning(), loadAudit()]);
  say(r.startedNow ? 'Learning check started. A batch begins if there is something new and it fits within this month’s ceiling.' : 'Learn now is queued for the next hourly check.');
});

async function loadFlags() {
  flagsState = (await api('admin/flags')).flags;
  renderFlags();
}

function renderFlags() {
  const keys = Object.keys(flagsState).sort();
  $('flags-empty').hidden = keys.length > 0;
  $('flags-table').tBodies[0].replaceChildren(...keys.map(key => {
    const flag = flagsState[key];
    const row = document.createElement('tr');
    const name = el('div');
    name.append(code(key));
    if (NEVER_GATED.includes(key)) name.append(' ', badge('Never switched off', 'good'));
    if (flag.kill) name.append(' ', badge('Switched off now', 'bad'));
    if (flag.minAppVersion) name.append(el('div', 'App ' + flag.minAppVersion + ' or newer', 'muted'));
    cell(row, name);
    cell(row, badge(flag.default ? 'On' : 'Off'));
    const list = el('ul');
    if (!flag.rules.length) list.append(el('li', 'No rules'));
    for (const rule of flag.rules) list.append(el('li', ruleSummary(rule)));
    cell(row, list);
    const actions = el('div', undefined, 'row');
    actions.append(
      button('Edit', 'Edit ' + key, 'quiet', async () => editFlag(key)),
      button('Delete', 'Delete ' + key, 'danger', async () => {
        if (!confirm('Delete the flag ' + key + '? The app goes back to its built-in setting for it.')) return;
        await api('admin/flags/delete', { key });
        await Promise.all([loadFlags(), loadAudit()]);
        say('Deleted ' + key + '.');
      }),
    );
    cell(row, actions);
    return row;
  }));
}

function labelled(text, control, className) {
  const label = document.createElement('label');
  if (className) label.className = className;
  if (className === 'check') label.append(control, ' ' + text); else label.append(text + ' ', control);
  return label;
}
function choose(options, value) {
  const select = document.createElement('select');
  for (const [v, text] of options) { const o = document.createElement('option'); o.value = v; o.textContent = text; select.append(o); }
  select.value = value;
  return select;
}
function field(type, value, attributes = {}) {
  const input = document.createElement('input');
  input.type = type;
  if (type === 'checkbox') input.checked = value === true; else input.value = value ?? '';
  for (const [name, v] of Object.entries(attributes)) input.setAttribute(name, v);
  return input;
}

function addRuleRow(fields = { kind: 'plan', plan: 'basic', text: '', enabled: true, trial: false, firstDay: '', lastDay: '', percent: '' }) {
  const row = el('div', undefined, 'rule-row');
  const kind = choose([['any', 'Everyone'], ['plan', 'A plan'], ['corporate', 'An organisation'], ['user', 'One person']], fields.kind);
  const plan = choose([['unknown', 'People without an account'], ['basic', 'Basic'], ['pro', 'Pro']], fields.plan);
  const text = field('text', fields.text, { maxlength: '254', autocomplete: 'off', spellcheck: 'false' });
  const then = choose([['on', 'Switch on'], ['off', 'Switch off']], fields.enabled ? 'on' : 'off');
  const trial = field('checkbox', fields.trial);
  const first = field('date', fields.firstDay);
  const last = field('date', fields.lastDay);
  const percent = field('number', fields.percent, { min: '0', max: '100', step: '1', inputmode: 'numeric' });
  const whoLabel = labelled('Who', kind), planLabel = labelled('Plan', plan), textLabel = labelled('Name or email', text);
  const remove = el('button', 'Remove');
  remove.type = 'button';
  remove.className = 'small danger';
  remove.setAttribute('aria-label', 'Remove this rule');
  remove.addEventListener('click', () => row.remove());
  const showWho = () => { planLabel.hidden = kind.value !== 'plan'; textLabel.hidden = kind.value !== 'corporate' && kind.value !== 'user'; };
  kind.addEventListener('change', showWho);
  showWho();
  row.append(whoLabel, planLabel, textLabel, labelled('Then', then), labelled('Trial', trial, 'check'), labelled('First day', first),
    labelled('Last day (empty = until stopped)', last), labelled('Only this % of devices', percent), remove);
  row.readFields = () => ({ kind: kind.value, plan: plan.value, text: text.value, enabled: then.value === 'on', trial: trial.checked, firstDay: first.value, lastDay: last.value, percent: percent.value });
  ruleRows.append(row);
}

function resetFlagForm() {
  flagForm.reset();
  ruleRows.replaceChildren();
  $('flag-form-title').textContent = 'Add or change a flag';
}
function editFlag(key) {
  const flag = flagsState[key];
  if (!flag) return;
  resetFlagForm();
  flagForm.elements.key.value = key;
  flagForm.elements.defaultOn.value = flag.default ? 'on' : 'off';
  flagForm.elements.minAppVersion.value = flag.minAppVersion ?? '';
  flagForm.elements.kill.checked = flag.kill === true;
  for (const rule of flag.rules) addRuleRow(fieldsFromRule(rule));
  $('flag-form-title').textContent = 'Change ' + key;
  flagForm.scrollIntoView();
  flagForm.elements.key.focus();
}

$('add-rule').addEventListener('click', () => addRuleRow());
$('flag-reset').addEventListener('click', resetFlagForm);
act(flagForm, 'submit', async () => {
  const data = new FormData(flagForm);
  const result = flagFromForm({
    key: data.get('key'), defaultOn: data.get('defaultOn') === 'on', kill: data.get('kill') === 'on', minAppVersion: data.get('minAppVersion'),
    rules: [...ruleRows.children].map(row => row.readFields()),
  });
  if (result.error) throw new Error(result.error);
  await api('admin/flags/set', { key: result.key, flag: result.flag });
  await Promise.all([loadFlags(), loadAudit()]);
  resetFlagForm();
  say('Saved ' + result.key + '.');
});

async function loadAudit() {
  const { entries } = await api('admin/audit');
  $('audit-table').tBodies[0].replaceChildren(...entries.map(e => {
    const row = document.createElement('tr');
    cell(row, when(e.at_ms)); cell(row, code(e.actor)); cell(row, e.action);
    cell(row, badge(e.outcome === 'allowed' ? 'Allowed' : 'Refused', e.outcome === 'allowed' ? '' : 'bad'));
    cell(row, e.detail || '—');
    return row;
  }));
}

void setUpSignIn();

// ---- Technical overview (docs/TECHNICAL-OVERVIEW.md, served by GET /v1/admin/technical-overview) ------------------
// Loaded only when the view is opened, not on every refresh. Built with textContent only: no HTML from the file.

let overviewMarkdown = null;

function runsInto(node, runs) {
  for (const r of runs) {
    if ('code' in r) node.append(code(r.code));
    else if ('strong' in r) node.append(el('strong', r.strong));
    else if ('link' in r) { const a = el('a', r.link); a.href = r.href; if (!r.href.startsWith('#')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } node.append(a); }
    else node.append(document.createTextNode(r.text));
  }
  return node;
}

function renderOverview(markdown) {
  const nodes = parseMarkdown(markdown).map((b) => {
    if (b.type === 'heading') return runsInto(el('h' + Math.min(b.level, 4)), b.runs);
    if (b.type === 'rule') return el('hr');
    if (b.type === 'paragraph') return runsInto(el('p'), b.runs);
    if (b.type === 'list') { const list = el(b.ordered ? 'ol' : 'ul'); for (const item of b.items) list.append(runsInto(el('li'), item)); return list; }
    const table = el('table'); const head = el('tr');
    for (const c of b.head) { const th = runsInto(el('th'), c); th.scope = 'col'; head.append(th); }
    const thead = el('thead'); thead.append(head); const tbody = el('tbody');
    for (const row of b.rows) { const tr = el('tr'); for (const c of row) tr.append(runsInto(el('td'), c)); tbody.append(tr); }
    table.append(thead, tbody);
    const wrap = el('div', undefined, 'scroll'); wrap.append(table); return wrap;
  });
  $('overview-doc').replaceChildren(...nodes);
}

async function loadTechnicalOverview() {
  if (overviewMarkdown !== null) return;
  $('overview-status').textContent = 'Loading…';
  const result = await api('admin/technical-overview');
  overviewMarkdown = result.markdown;
  renderOverview(overviewMarkdown);
  $('overview-status').textContent = '';
}

act($('overview-pdf'), 'click', async () => {
  await loadTechnicalOverview();
  say('In the print window, choose Save as PDF.');
  print();
});

act($('overview-md'), 'click', async () => {
  await loadTechnicalOverview();
  const link = el('a');
  link.href = URL.createObjectURL(new Blob([overviewMarkdown], { type: 'text/markdown' }));
  link.download = 'inflight-technical-overview.md';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  say('Downloading inflight-technical-overview.md.');
});

