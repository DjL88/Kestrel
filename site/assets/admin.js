// InFlight admin console. Talks only to the control plane's audited /v1/admin routes on this site's own address
// (Firebase Hosting forwards /v1/admin/** to Cloud Run). The session lives in memory only: closing the tab signs out.
// Everything from the server is written with textContent, never as HTML.

const $ = id => document.getElementById(id);
const status = $('status');
let token;
let localTaxes = {};

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
  if (!response.ok) throw new Error(result.error?.message ?? 'That could not be done.');
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

// The owner session is supplied only to the same-origin editor iframe, kept in memory.
function sendDemoEditorSession() {
  const frame = $('demo-editor-frame');
  if (frame?.contentWindow) frame.contentWindow.postMessage({ type: 'kestrel-demo-auth', token: token || null }, location.origin);
}
$('demo-editor-frame')?.addEventListener('load', sendDemoEditorSession);

// ---- Sign-in ---------------------------------------------------------------------------------------------------

async function startConsole(accessToken, who) {
  token = accessToken;
  $('sign-in').hidden = true;
  $('console').hidden = false;
  $('sign-out').hidden = false;
  $('who').textContent = who ? 'Signed in as ' + who : 'Signed in';
  say('');
  await refreshAll();
  sendDemoEditorSession();
  $('main').focus();
}

function signOut(message = '') {
  token = undefined;
  sendDemoEditorSession();
  localTaxes = {};
  $('console').hidden = true;
  $('sign-out').hidden = true;
  $('who').textContent = '';
  $('sign-in').hidden = false;
  for (const id of ['licence-table', 'usage-table', 'payments-table', 'audit-table']) $(id).tBodies[0].replaceChildren();
  $('message-list').replaceChildren();
  $('issued').hidden = true;
  $('issued-key').value = '';
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
  const results = await Promise.allSettled([loadOverview(), loadLicensees(), loadUsage(), loadPayments(), loadMessages(), loadTax(), loadPriceReview(), loadAudit()]);
  const failed = results.find(r => r.status === 'rejected' && !(r.reason instanceof SignedOut));
  if (failed) say(failed.reason.message);
}
act($('refresh-all'), 'click', async () => { await refreshAll(); say('Up to date.'); });

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
  if (!o.licenceIssuing) $('issue-form').querySelector('button').title = 'This server does not have the licence-issuing key.';
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

async function loadPayments() {
  const p = await api('admin/payments');
  $('payments-state').textContent = p.connected
    ? 'Paid checkouts recorded after SumUp confirmed them.'
    : 'SumUp is not connected yet, so there are no payments to show. Refunds will appear here too once checkout is live.';
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

const STATUS_WORDS = { new: 'New', read: 'Read', answered: 'Answered' };
async function loadMessages() {
  const { messages } = await api('admin/messages');
  $('message-list').replaceChildren(...messages.map(m => {
    const item = el('li');
    const meta = el('p', undefined, 'meta');
    const from = el('strong', m.name);
    const mail = el('a', m.email); mail.href = 'mailto:' + encodeURIComponent(m.email).replace(/%40/g, '@');
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
    return;
  }
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
