// InFlight admin console. Talks only to the control plane's audited /v1/admin routes on this site's own address
// (Firebase Hosting forwards /v1/admin/** to Cloud Run). The session lives in memory only: closing the tab signs out.
// Everything from the server is written with textContent, never as HTML.

import { FLAG_INFO, KNOWN_FLAGS, NEVER_GATED, fieldsFromRule, flagFromForm, flagName, ruleSummary } from './admin-flags.js';

import { todaySummary, collapseAudit, auditText, isPageView } from './admin-words.mjs';

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

/**
 * A look-up for a feature this server may not be set up for. The server answers 200 with `configured: false` (never a
 * server error, so the owner's error alert stays for real faults); here that becomes the section's "not set up" path,
 * the same one an older server's 503 takes.
 */
async function lookUp(path) {
  const answer = await api(path);
  if (answer?.configured === false) throw Object.assign(new Error(answer.reason || 'Not set up yet.'), { status: 503, notSetUp: true });
  return answer;
}

function say(message) { status.textContent = message; }

/** Runs an action from a form or button, keeps the control disabled meanwhile, and reports errors in words. */
function act(element, event, work) {
  element.addEventListener(event, async e => {
    e.preventDefault();
    const button = e.submitter ?? (element.tagName === 'BUTTON' ? element : element.querySelector('button'));
    if (button) button.disabled = true;
    try { await work(e); } catch (error) { if (!(error instanceof SignedOut)) say(error.message); } finally {
      if (button) {
        button.disabled = false;
        // After a question in the page, focus goes back to the button that asked it (if it is still there).
        // Straight after a <dialog> closes the browser still reports focus on its own button, so that counts too.
        const at = document.activeElement;
        if (button.isConnected && (!at || at === document.body || $('ask').contains(at))) button.focus({ preventScroll: true });
      }
    }
  });
}

// ---- Questions in the page ------------------------------------------------------------------------------------
// Never confirm() or prompt(): embedded browsers (the Claude app's browser pane, some webviews) cancel them silently,
// so "Turn on" did nothing there. A modal <dialog> keeps keyboard focus inside it; Escape and "Go back" cancel.

const askDialog = $('ask');
let closeAsk = null;
// Tab and Shift+Tab go round the question's own controls only, never out to the page or the browser.
askDialog.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const stops = [...askDialog.querySelectorAll('input, button')].filter((node) => !node.disabled && node.offsetParent !== null);
  if (!stops.length) return;
  const at = stops.indexOf(document.activeElement);
  e.preventDefault();
  stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
});

/**
 * Asks before an action. Resolves `true` (or the typed text, when `field` is given) once the person chooses `yes`,
 * and `null` when they go back, press Escape or sign out.
 * @param {string} question
 * @param {{ yes?: string, danger?: boolean, field?: { label: string, min?: number, tooShort: string } }} [options]
 */
function ask(question, { yes = 'Yes', danger = false, field = null } = {}) {
  if (closeAsk) closeAsk(null);
  return new Promise(resolve => {
    const ok = $('ask-ok'), back = $('ask-cancel'), input = $('ask-field');
    $('ask-text').textContent = question;
    ok.textContent = yes;
    ok.className = danger ? 'danger' : '';
    $('ask-error').textContent = '';
    $('ask-field-label').hidden = !field;
    input.value = '';
    if (field) $('ask-field-name').textContent = field.label;
    const finish = (value) => {
      closeAsk = null;
      ok.onclick = back.onclick = input.onkeydown = askDialog.oncancel = null;
      if (askDialog.open) askDialog.close();
      resolve(value);
    };
    closeAsk = finish;
    ok.onclick = () => {
      if (!field) { finish(true); return; }
      const text = input.value.trim();
      if (text.length < (field.min ?? 1)) { $('ask-error').textContent = field.tooShort; input.focus(); return; }
      finish(text);
    };
    back.onclick = () => finish(null);
    askDialog.oncancel = (e) => { e.preventDefault(); finish(null); };
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } };
    askDialog.showModal();
    // Typing goes straight into the field; for something that cannot be taken back, the safe choice has focus.
    (field ? input : danger ? back : ok).focus();
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
  $('menu').hidden = false;
  $('sign-out').hidden = false;
  $('who').textContent = who ? 'Signed in as ' + who : 'Signed in';
  say('');
  showView();
  openOverviewIfShown();
  await refreshAll();
  $('main').focus();
  clearInterval(autoCheck);
  autoCheck = setInterval(() => { if (token && document.visibilityState === 'visible') void refreshAll(); }, 5 * 60_000);
}

function signOut(message = '') {
  token = undefined;
  if (closeAsk) closeAsk(null);
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
  $('menu').hidden = true;
  $('sign-out').hidden = true;
  $('who').textContent = '';
  $('sign-in').hidden = false;
  for (const id of ['licence-table', 'usage-table', 'payments-table', 'audit-table', 'safety-notices']) $(id).tBodies[0].replaceChildren();
  for (const id of ['today-list', 'switch-list', 'flag-list']) $(id).replaceChildren();
  flagsState = {};
  auditEntries = [];
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
  // On Today a failed source is already named under "Could not check"; elsewhere say it in the status line.
  if (failed && viewForHash(location.hash) !== 'today') say(failed.reason.message);
}
act($('refresh-all'), 'click', async () => { await refreshAll(); say(''); });

// ---- Pages, Today and Needs you ---------------------------------------------------------------------------------

const PAGE_INTRO = {
  today: '',
  switches: 'Turn InFlight’s online services on or off.',
  people: 'Give people Pro, see who has a licence, and free or cancel devices.',
  money: 'What people paid, refunds owed, each month’s figures, and the prices.',
  messages: 'Messages from the website, reports about shared galleries, and news to everyone.',
  technical: 'How InFlight works, its code, hosting, security and compliance, with ready answers for customers, partners, investors and security reviewers. Written from the code; anything it cannot show is marked Unknown. Opening it is recorded.',
  advanced: 'Technical settings and records. You rarely need these: open one when you do.',
};
const dayLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

$('menu-list').replaceChildren(...Object.entries(VIEWS).map(([name, view]) => {
  const item = el('li'); const link = el('a', undefined); link.href = '#' + name; link.dataset.view = name;
  link.append(el('span', view.label), el('span', '', 'count'));
  item.append(link); return item;
}));

/** One page at a time. A link to a section opens its page, unfolds the section if it is folded, and scrolls to it. */
function showView() {
  const view = viewForHash(location.hash);
  for (const [name, v] of Object.entries(VIEWS)) for (const id of v.sections) $(id).hidden = name !== view;
  for (const link of document.querySelectorAll('#menu-list a')) {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  $('page-title').textContent = view === 'today' ? 'Today' : VIEWS[view].label;
  $('page-intro').textContent = view === 'today' ? dayLong.format(new Date()) : PAGE_INTRO[view];
  const id = location.hash.replace(/^#/, '');
  const target = id && !VIEWS[id] ? $(id) : null;
  if (target && !target.hidden) {
    if (target.tagName === 'DETAILS') target.open = true;
    target.scrollIntoView({ block: 'start' });
  } else scrollTo(0, 0);
}
addEventListener('hashchange', () => { showView(); say(''); if (token) $('main').focus({ preventScroll: true }); openOverviewIfShown(); });
showView();

/** The button word for each place a chore is done. */
const VIEW_WORD = { refunds: 'Open refunds', safety: 'Open reports', messages: 'Open messages', payments: 'Open payments', learning: 'Open model training', tax: 'Open tax' };
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
  renderToday(items.length, unknown.length > 0);
  // Words beside the menu, never colour alone: "2 new" messages, "1" thing needing you.
  const fresh = (snapshot.messages ?? []).filter(m => m.status === 'new').length;
  const counts = { today: items.length ? String(items.length) : '', messages: fresh ? fresh + ' new' : '' };
  for (const link of document.querySelectorAll('#menu-list a')) {
    const text = counts[link.dataset.view] ?? '';
    const badge = link.querySelector('.count');
    badge.textContent = text;
    badge.hidden = !text;
  }
}

function renderToday(needs, unknown) {
  const lines = todaySummary({ overview: snapshot.overview, payments: snapshot.payments, needs, unknown });
  $('today-list').replaceChildren(...lines.map(line => {
    const li = el('li', undefined, line.warn ? 'warn' : '');
    li.dataset.line = line.id;
    const head = el('div', undefined, 'today-head');
    head.append(el('span', line.label, 'today-label'));
    if (line.view !== 'today') { const link = el('a', 'Open', 'quiet-link'); link.href = '#' + line.view; link.setAttribute('aria-label', 'Open ' + VIEWS[line.view].label); head.append(link); }
    li.append(head, el('p', line.text, 'today-text'));
    if (typeof line.meter === 'number') {
      const meter = el('div', undefined, 'meter'); meter.setAttribute('aria-hidden', 'true');
      const fill = el('span'); fill.style.width = line.meter + '%'; meter.append(fill); li.append(meter);
    }
    return li;
  }));
}

async function loadRefunds() {
  let refunds;
  try { ({ refunds } = await lookUp('admin/balance-refunds')); } catch (error) {
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
      const reference = await ask('Mark ' + gbp.format(r.pence / 100) + ' to account ' + r.accountId + ' as refunded? Pay it back in Paddle first.', {
        yes: 'Mark refunded',
        field: { label: 'Paddle reference for this refund (from the Paddle dashboard)', min: 3, tooShort: 'Enter the Paddle reference so the refund can be traced.' },
      });
      if (reference === null) return;
      await api('admin/balance-refunds/' + encodeURIComponent(r.accountId) + '/refunded', { paddleReference: reference });
      await Promise.all([loadRefunds(), loadAudit()]);
      renderNeeds();
      say('Marked refunded.');
    }));
    return li;
  }));
}

async function loadOverview() {
  let o;
  try { o = await api('admin/overview'); } catch (error) { snapshot.overview = null; throw error; }
  snapshot.overview = o;
  const facts = [
    ['Accounts', o.accounts], ['Licences', o.licences], ['Devices with a licence', o.activations],
    ['Making Pro keys', o.licenceIssuing ? 'Available' : 'Not set up'],
    ['Payments', o.paymentsConnected ? 'Connected' : 'Not connected'],
    ['Online photo helper', o.aiDisabled ? 'Off' : o.aiProvider ? 'On (' + o.aiProvider + ')' : 'Not set up'],
    ['Records kept in', o.store === 'firestore' ? 'Firestore' : 'SQLite'],
  ];
  $('overview-list').replaceChildren(...facts.map(([k, v]) => { const d = el('div'); d.append(el('dt', k), el('dd', String(v))); return d; }));
  $('issue-form').querySelector('button').disabled = !o.licenceIssuing;
  $('issue-unavailable').hidden = !!o.licenceIssuing;
  $('issue-form').querySelector('button').title = o.licenceIssuing ? '' : 'This server cannot make keys.';
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
    cell(row, badge(l.status === 'revoked' ? 'Cancelled' : lapsed ? 'Ended' : l.status === 'active' ? 'Active' : l.status, l.status === 'active' && !lapsed ? 'good' : 'bad'));
    cell(row, l.accountId ? code(l.accountId) : 'Not linked');
    cell(row, l.note || '—');
    cell(row, l.validUntilMs ? dateOnly.format(new Date(l.validUntilMs)) : 'Does not end');
    const list = el('ul');
    for (const d of l.devices) {
      const item = el('li');
      item.append(el('span', d.platform + ' · ' + d.appVersion + ' · last seen ' + when(d.lastSeenMs) + ' '),
        button('Free up', 'Free up the ' + d.platform + ' device on licence ' + l.licenceId, 'quiet', async () => {
          if (!(await ask('Free up this ' + d.platform + ' device? It keeps working offline for up to 30 days, and the licence can then be used on another device.', { yes: 'Free up' }))) return;
          await api('admin/devices/' + encodeURIComponent(d.activationId) + '/deactivate', {});
          await loadLicensees();
          say('Device freed up on licence ' + l.licenceId + '.');
        }));
      list.append(item);
    }
    cell(row, l.devices.length ? list : 'None').prepend(el('span', l.devices.length + ' of ' + l.maxDevices + ' ', 'sr-only'));
    cell(row, l.aiQuota ? l.aiQuota.requestsUsed + ' of ' + l.aiQuota.requestsLimit : l.managedAi ? 'Included, not used yet' : 'Not included');
    const actions = el('div', undefined, 'row');
    if (l.status !== 'revoked') {
      actions.append(button('Cancel licence', 'Cancel licence ' + l.licenceId, 'danger', async () => {
        if (!(await ask('Cancel licence ' + l.licenceId + '? No new devices or renewals. Nobody loses photos or edits.', { yes: 'Cancel licence', danger: true }))) return;
        await api('admin/licences/' + encodeURIComponent(l.licenceId) + '/revoke', {});
        await loadLicensees();
        say('Licence ' + l.licenceId + ' cancelled.');
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
  if (!(await ask('Cancel this key? Devices using it lose Pro when they next check online. Nobody loses photos or edits.', { yes: 'Cancel this key', danger: true }))) return;
  // Clear the key from the page whatever happens, so it is not left on screen.
  form.reset();
  const result = await api('admin/licences/revoke-by-key', { licenceKey });
  await Promise.all([loadLicensees(), loadAudit()]);
  say('Licence ' + result.licenceId + ' cancelled' + (result.wasKnown ? '.' : ', before any device used it.'));
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
  const message = !result.created ? (body.contributor ? 'That address is already a contributor.' : 'That address already has free Pro.') :
    result.attachedNow ? what + ' given. It is on their account now.' : what + ' given. It turns on when they sign in with that address.';
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
  $('monitoring-result').textContent = 'Not tried yet.';
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
    ? 'That example is not available.'
    : 'Made-up example: ' + sample.requests + ' visits in 15 minutes (usually ' + sample.baseline + '),' +
      ' ' + sample.errors + ' errors, ' + sample.budgetPercent + '% of the budget spent. ' +
      (result.alerts.length ? result.alerts.length + ' alert(s) would go off.' : 'Nothing would go off.') +
      ' Nothing real was looked at or sent.';
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
  try { k = await lookUp('admin/paddle/key'); } catch (error) {
    if (error instanceof SignedOut) throw error;
    snapshot.paddleKey = undefined;
    $('paddle-key-state').textContent = '';
    return;
  }
  snapshot.paddleKey = k;
  const date = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const parts = [];
  if (k.expiresAt) parts.push(`Paddle's access key renews itself every week. Last renewed ${date(k.rotatedAt)}; it would run out on ${date(k.expiresAt)}.`);
  else parts.push('Paddle\'s access key has not been renewed by InFlight yet. The weekly check renews it the first time it runs.');
  if (k.lastRunOk === false) parts.push(`The last weekly renewal failed (${date(k.lastRunAt)}): ${k.lastRunReason}`);
  $('paddle-key-state').textContent = parts.join(' ');
}

async function loadPayments() {
  let p;
  try { p = await api('admin/payments'); } catch (error) { snapshot.payments = null; throw error; }
  snapshot.payments = p;
  $('payments-state').textContent = p.connected
    ? 'Payments Paddle has confirmed, newest first. Paddle collects and pays the buyer\'s tax.'
    : 'Paddle is not connected yet, so there are no payments to show.';
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
const PRICE_ITEMS = ['pro.monthly', 'pro.annual', 'plus.monthly'];
const ITEM_LABEL = { 'pro.monthly': 'monthly', 'pro.annual': 'yearly', 'plus.monthly': 'Pro Plus monthly' };
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
    if (row.error) list.append(el('li', `${row.item.startsWith('plus') ? '' : 'Pro, '}${ITEM_LABEL[row.item]}: ${row.error}`));
    for (const d of row.differences) {
      const matrix = d.matrix === null ? 'not offered' : moneyText(d.matrix, d.currency);
      const paddle = d.paddle === null ? 'not set, or not for every country' : moneyText(d.paddle, d.currency);
      list.append(el('li', `${row.item.startsWith('plus') ? '' : 'Pro, '}${ITEM_LABEL[row.item]}, ${d.currency}: matrix ${matrix}, Paddle ${paddle}`));
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
  if (PRICE_ITEMS.some(item => !Number.isFinite(base[item]))) throw new Error('Type all three UK prices as amounts, for example 2.99.');
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
  try { ({ review } = await lookUp('admin/pricing/review')); } catch (error) {
    if (error instanceof SignedOut) throw error;
    $('price-review-status').textContent = error.message;
    return;
  }
  if (!review) {
    $('price-review-status').textContent = 'No monthly review has run yet.';
    return;
  }
  // Pro is a subscription since 26 Nov 2026. A review made before then was worked out from the old one-off price, so
  // its figures are shown as out of date rather than as a suggestion.
  if (!review.plans) {
    $('price-review-status').textContent = `The ${review.month} review was worked out from the old one-off price of ${gbp.format(review.approvedBasePence / 100)}, so its figures no longer apply. Pro is now a subscription; the next monthly review suggests monthly and yearly prices.`;
    return;
  }
  $('price-review-status').textContent = `${review.month}, using the European Central Bank's rates for ${review.rateDate}. A suggestion only: live prices are unchanged until you change them under Payments and money, then Prices.`
    + (review.inflation ? ` Includes UK inflation from ${review.inflation.baseline.date} to ${review.inflation.latest.date}.` : '');
  const annual = new Map(review.plans.annual.prices.map(p => [p.currency, p]));
  for (const monthly of review.plans.monthly.prices) {
    const row = el('tr');
    cell(row, monthly.currency);
    for (const price of [monthly, annual.get(monthly.currency)]) {
      if (price?.status === 'for-review') {
        const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: price.currency });
        cell(row, money.format(price.proposedMajor) + (price.currency === 'GBP' ? '' : ' (from ' + money.format(price.unroundedMajor) + ')'));
      } else cell(row, 'No exchange rate');
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
  try { summary = await lookUp('admin/tax'); } catch (error) {
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
  $('turnover-value').textContent = gbp.format(turnover.rollingPence / 100) + ' of the ' + gbp.format(thresholdPence / 100) + ' at which you must register for VAT.';
  const notices = [];
  if (turnover.state === 'warning') notices.push('Sales have passed ' + gbp.format(warningPence / 100) + ': getting close.');
  if (turnover.backward) notices.push('You passed the limit at the end of a month. Tell HMRC by ' + turnover.backward.notificationDue + '; VAT starts on ' + turnover.backward.effectiveDate + '.');
  if (turnover.forward) notices.push('You expect to pass the limit in the next 30 days. Tell HMRC by ' + turnover.forward.notificationDue + '; VAT starts on ' + turnover.forward.effectiveDate + '.');
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
$('never-gated').textContent = NEVER_GATED.map(flagName).join(', ');
// Known flags by their plain name, then "Another flag…" for a technical name the page does not know.
const flagPick = $('flag-pick');
flagPick.replaceChildren(new Option('Choose a feature…', ''), ...KNOWN_FLAGS.filter(k => !NEVER_GATED.includes(k))
  .sort((a, b) => flagName(a).localeCompare(flagName(b))).map(k => new Option(flagName(k) + ' (' + k + ')', k)), new Option('Another flag…', '__other'));
function showFlagPick() {
  const other = flagPick.value === '__other';
  $('flag-key-label').hidden = !other;
  $('flag-key').required = other;
  if (!other) $('flag-key').value = flagPick.value;
  $('flag-effect').textContent = FLAG_INFO[flagPick.value]?.effect ?? (other ? 'Type the technical name exactly as the app uses it.' : '');
}
flagPick.addEventListener('change', showFlagPick);

// ---- Reports about shared galleries ------------------------------------------------------------------------------
// Details only. There is deliberately no way to open a reported picture from here. InFlight does not scan photos
// (#1814): reports come from people with a gallery link, and the only actions are no action, remove or revoke.

function askReason(question, yes) {
  return ask(question, { yes, danger: yes !== 'No action', field: { label: 'Reason', min: 3, tooShort: 'Give a short reason: it is shown to the people involved.' } });
}

const REPORT_WORDS = { 'no-action': 'No action', 'photo-removed': 'Photo removed', 'gallery-revoked': 'Gallery closed' };
async function loadSafety() {
  let s;
  try { s = await api('admin/safety'); } catch (error) {
    if (error instanceof SignedOut) throw error;
    snapshot.safety = null;
    $('safety-checks').textContent = 'Reports could not be read: ' + error.message;
    $('safety-notices').tBodies[0].replaceChildren(); $('safety-empty').hidden = true;
    return;
  }
  // An older server may answer without a notices list: show no reports rather than failing the page.
  const notices = Array.isArray(s?.notices) ? s.notices : [];
  snapshot.safety = { notices };
  $('safety-checks').textContent = '';
  $('safety-empty').hidden = notices.length > 0;
  $('safety-notices').closest('.scroll').hidden = notices.length === 0;
  $('safety-notices').tBodies[0].replaceChildren(...notices.map(n => {
    const row = document.createElement('tr');
    cell(row, when(n.atMs));
    cell(row, n.urgent ? badge('Urgent: ' + n.category, 'bad') : n.category);
    cell(row, 'Gallery ' + String(n.galleryId ?? '').slice(0, 8) + (n.photoId ? ', photo ' + n.photoId.slice(0, 12) : ', whole gallery'));
    cell(row, n.explanation);
    cell(row, [n.notifierName, n.notifierEmail].filter(Boolean).join(' · ') || 'Anonymous');
    cell(row, n.decision ? (REPORT_WORDS[n.decision.outcome] ?? n.decision.outcome) + ': ' + n.decision.reason : 'Open');
    const actions = el('div', undefined, 'row');
    if (n.status === 'open') {
      const decide = (outcome, label, question) => button(label, label + ' for report ' + n.noticeId, outcome === 'no-action' ? 'quiet' : 'danger', async () => {
        const reason = await askReason(question, label); if (!reason) return;
        await api('admin/safety/notices/' + n.noticeId + '/decide', { outcome, reason });
        await Promise.all([loadSafety(), loadAudit()]); renderNeeds(); say('Done. The person who reported it and the gallery owner can see your reason.');
      });
      actions.append(decide('no-action', 'No action', 'Why no action? The person who reported it sees this.'));
      if (n.photoId) actions.append(decide('photo-removed', 'Remove photo', 'Why remove it? Both sides see this.'));
      actions.append(decide('gallery-revoked', 'Close gallery', 'Why close it? Both sides see this.'));
    }
    cell(row, actions);
    return row;
  }));
}

// ---- Switches ---------------------------------------------------------------------------------------------------

async function loadSwitches() {
  const { switches } = await api('admin/switches');
  $('switches-empty').hidden = switches.length > 0;
  $('switch-list').replaceChildren(...switches.map(item => {
    const li = el('li', undefined, item.on ? 'on' : '');
    const text = el('div', undefined, 'switch-text');
    text.append(el('h3', item.label), el('p', item.note, 'muted'), el('code', item.key, 'tech'));
    if (item.testOnly) text.append(el('p', item.testOnly, 'test-only'));
    const state = el('div', undefined, 'switch-state');
    const word = !item.configured && !item.on ? 'Not set up yet' : item.on ? 'On' : 'Off';
    state.append(badge(word, item.on ? 'good' : !item.configured ? 'quiet' : undefined));
    const turn = !item.on;
    const action = button(turn ? 'Turn on' : 'Turn off', (turn ? 'Turn on ' : 'Turn off ') + item.label, turn ? '' : 'danger', async () => {
      const sure = turn
        ? await ask('Turn on ' + item.label + '? Anything that costs money stays within the monthly spending cap.', { yes: 'Turn on' })
        : await ask('Turn off ' + item.label + '? It stops straight away for everyone.', { yes: 'Turn off', danger: true });
      if (!sure) return;
      await api('admin/switches/set', { key: item.key, on: turn });
      await Promise.all([loadSwitches(), loadAudit()]);
      say(item.label + (turn ? ' is on.' : ' is off.'));
    });
    if (turn && !item.configured) { action.disabled = true; action.title = 'This needs setting up on the server first.'; }
    state.append(action);
    li.append(text, state);
    return li;
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
  if (!dryRun && !(await ask('Send this news to everyone now? As an alert first; by email only to people who asked for it.', { yes: 'Send now' }))) return;
  const r = await api('admin/news/send', body);
  f.broadcastId.value = r.broadcastId;
  $('news-result').textContent = (dryRun ? 'Nothing sent. It would reach: ' : 'Sent. ') + r.audience + ' people in all; ' +
    r.pushed + (dryRun ? ' by alert, ' : ' got an alert, ') + r.emailed + (dryRun ? ' by email. ' : ' got an email. ') +
    r.off + ' turned news off, ' + r.unreachable + ' cannot be reached, ' + r.alreadyReached + ' already had it. ' +
    (r.emailWaiting ? r.emailWaiting + ' email(s) waiting' + (r.emailLimitReached ? ' because today’s email limit was reached' : '') + ': send again with the same reference tomorrow. ' : '') +
    (r.notTried ? r.notTried + ' not tried yet: send again with the same reference. ' : '') + 'Reference ' + r.broadcastId + '.';
});

// ---- Compliance documents ------------------------------------------------------------------------------------

const sizeText = bytes => bytes >= 1_000_000 ? (bytes / 1_000_000).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1000)) + ' KB';
let complianceMaxBytes = 8_000_000;

async function loadCompliance() {
  let c;
  try { c = await lookUp('admin/compliance/documents'); } catch (error) {
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
  try { m = await lookUp('admin/mail'); } catch (error) {
    if (error instanceof SignedOut) throw error;
    snapshot.mail = undefined;
    $('mail-unavailable').hidden = false; $('mail-warning').hidden = true; $('mail-facts').replaceChildren(); return;
  }
  snapshot.mail = m;
  $('mail-unavailable').hidden = true;
  const facts = [
    ['Switch', m.on ? 'On' : 'Off (see Switches)'],
    ['Sent today (' + m.day + ')', m.sent + ' of ' + m.cap],
    ['Sent from', (m.account === 'gmail' ? 'Personal Gmail' : 'Google Workspace') + (m.from ? ' (' + m.from + ')' : '')],
    ["Google's limit", 'About ' + m.providerLimit + ' a day'],
  ];
  $('mail-facts').replaceChildren(...facts.map(([k, v]) => { const d = el('div'); d.append(el('dt', k), el('dd', String(v))); return d; }));
  $('mail-warning').hidden = !m.warn;
}

const pounds = (pence) => '£' + (pence / 100).toFixed(2);
const WHY = { count: 'Enough new photos', weekly: 'Weekly', manual: 'Train now' };
const RESULT = { reserved: 'Starting', submitted: 'Running', succeeded: 'Finished', failed: 'Failed (the money set aside still counts)', 'not-started': 'Not started (nothing charged)' };
async function loadLearning() {
  let s;
  try { s = await lookUp('admin/learning'); } catch (error) {
    if (error instanceof SignedOut) throw error;
    snapshot.learning = undefined;
    $('learning-unavailable').hidden = false; $('learning-run').disabled = true; $('learning-facts').replaceChildren(); return;
  }
  snapshot.learning = s;
  $('learning-unavailable').hidden = true;
  const facts = [
    ['Switch', s.on ? 'On' : 'Off (see Switches)'],
    ['New photos since the last batch', s.newPhotos + ' of ' + s.photoThreshold + ' needed'],
    ['This month (' + s.month + ')', pounds(s.reservedPence) + ' of ' + pounds(s.ceilingPence) + ' used'],
    ['Each batch sets aside', pounds(s.runReservePence) + ' (the most it could cost)'],
    ['Now', s.running ? 'A batch is running' : s.manualRequested ? 'Train now is waiting for the next hourly check' : 'Waiting'],
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
  if (!(await ask('Start a training batch now? It is refused if it would pass this month’s limit.', { yes: 'Train now' }))) return;
  const r = await api('admin/learning/run', {});
  await Promise.all([loadLearning(), loadAudit()]);
  say(r.startedNow ? 'Training check started. A batch begins if there is something new and it fits within this month’s limit.' : 'Train now will start at the next hourly check.');
});

async function loadFlags() {
  flagsState = (await api('admin/flags')).flags;
  renderFlags();
}

function renderFlags() {
  const keys = Object.keys(flagsState).sort((a, b) => flagName(a).localeCompare(flagName(b)));
  $('flags-empty').hidden = keys.length > 0;
  $('flag-list').replaceChildren(...keys.map(key => {
    const flag = flagsState[key];
    const li = el('li');
    li.dataset.flag = key;
    const text = el('div', undefined, 'flag-text');
    const title = el('h3', flagName(key));
    title.append(' ', el('code', key, 'tech'));
    text.append(title);
    if (FLAG_INFO[key]) text.append(el('p', FLAG_INFO[key].effect, 'muted'));
    const state = el('p', undefined, 'flag-state');
    state.append(badge(flag.kill ? 'Off for everyone now' : flag.default ? 'On' : 'Off', flag.kill ? 'bad' : flag.default ? 'good' : undefined),
      ' ', flag.rules.length ? 'unless a rule says otherwise:' : 'for everyone.');
    if (NEVER_GATED.includes(key)) state.append(' ', badge('Always on in the app', 'good'));
    text.append(state);
    if (flag.rules.length) { const list = el('ul', undefined, 'rules'); for (const rule of flag.rules) list.append(el('li', ruleSummary(rule))); text.append(list); }
    if (flag.minAppVersion) text.append(el('p', 'Only app ' + flag.minAppVersion + ' or newer.', 'muted'));
    const actions = el('div', undefined, 'row');
    actions.append(
      button('Change', 'Change ' + flagName(key), 'quiet', async () => editFlag(key)),
      button('Remove', 'Remove the flag ' + flagName(key), 'danger', async () => {
        if (!(await ask('Remove the flag for ' + flagName(key) + '? The app goes back to its own setting for it.', { yes: 'Remove', danger: true }))) return;
        await api('admin/flags/delete', { key });
        await Promise.all([loadFlags(), loadAudit()]);
        say('Removed the flag for ' + flagName(key) + '.');
      }),
    );
    li.append(text, actions);
    return li;
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
  showFlagPick();
  $('flag-form-title').textContent = 'Add or change a flag';
}
function editFlag(key) {
  const flag = flagsState[key];
  if (!flag) return;
  resetFlagForm();
  flagPick.value = KNOWN_FLAGS.includes(key) && !NEVER_GATED.includes(key) ? key : '__other';
  showFlagPick();
  $('flag-key').value = key;
  flagForm.elements.defaultOn.value = flag.default ? 'on' : 'off';
  flagForm.elements.minAppVersion.value = flag.minAppVersion ?? '';
  flagForm.elements.kill.checked = flag.kill === true;
  for (const rule of flag.rules) addRuleRow(fieldsFromRule(rule));
  $('flag-form-title').textContent = 'Change ' + flagName(key);
  flagForm.scrollIntoView();
  flagPick.focus();
}

$('add-rule').addEventListener('click', () => addRuleRow());
$('flag-reset').addEventListener('click', resetFlagForm);
act(flagForm, 'submit', async () => {
  const data = new FormData(flagForm);
  if (!flagPick.value || (flagPick.value === '__other' && !String(data.get('key') ?? '').trim())) throw new Error('Choose a feature first.');
  const result = flagFromForm({
    key: data.get('key'), defaultOn: data.get('defaultOn') === 'on', kill: data.get('kill') === 'on', minAppVersion: data.get('minAppVersion'),
    rules: [...ruleRows.children].map(row => row.readFields()),
  });
  if (result.error) throw new Error(result.error);
  await api('admin/flags/set', { key: result.key, flag: result.flag });
  await Promise.all([loadFlags(), loadAudit()]);
  resetFlagForm();
  say('Saved ' + flagName(result.key) + '.');
});
showFlagPick();

// ---- Record of changes (the audit log). Only the view is folded or filtered: every record stays as it is. -----
let auditEntries = [];
async function loadAudit() {
  auditEntries = (await api('admin/audit')).entries;
  renderAudit();
}
function renderAudit() {
  const showViews = $('audit-show-views').checked;
  const rows = collapseAudit(auditEntries.filter(e => showViews || !isPageView(e.action)));
  const timeOnly = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short' });
  $('audit-empty').hidden = rows.length > 0;
  $('audit-table').tBodies[0].replaceChildren(...rows.map(e => {
    const row = document.createElement('tr');
    const span = e.count > 1
      ? when(e.oldestMs) + ' to ' + (new Date(e.oldestMs).toDateString() === new Date(e.newestMs).toDateString() ? timeOnly.format(new Date(e.newestMs)) : when(e.newestMs))
      : when(e.at_ms);
    cell(row, span);
    cell(row, code(e.actor));
    const what = el('div');
    what.append(el('span', auditText(e.action)));
    if (e.count > 1) what.append(' ', badge(e.count + ' times'));
    what.append(el('div', e.action, 'muted tech'));
    cell(row, what);
    cell(row, badge(e.outcome === 'allowed' ? 'Allowed' : 'Refused', e.outcome === 'allowed' ? '' : 'bad'));
    cell(row, e.detail || '—');
    return row;
  }));
}
$('audit-show-views').addEventListener('change', renderAudit);

void setUpSignIn();

// ---- Technical overview (docs/TECHNICAL-OVERVIEW.md, served by GET /v1/admin/technical-overview) ------------------
// Loaded only when its page is opened, not on every refresh. Built with textContent only: no HTML from the file.

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
    if (b.type === 'heading') return runsInto(el('h' + Math.min(b.level + 1, 5)), b.runs);
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

function openOverviewIfShown() {
  if (!token || viewForHash(location.hash) !== 'technical') return;
  loadTechnicalOverview().catch(error => { if (!(error instanceof SignedOut)) $('overview-status').textContent = error.message; });
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
