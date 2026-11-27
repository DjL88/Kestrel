// Plain words for the admin console: the Today summary and the audit log. Pure, so it is unit-tested on its own
// (scripts/site/admin-words.test.mjs). Unknown stays unknown: a figure that could not be read is said to be "not known".

const plural = (n, one, many = one + 's') => n.toLocaleString('en-GB') + ' ' + (n === 1 ? one : many);
const pounds = (pence) => '£' + (pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The few sentences at the top of the console. `d` holds what the console loaded: `overview` and `payments` are the
 * server's answers, `undefined` if not loaded yet and `null` if they could not be read; `needs` is the Needs you count.
 * @returns {Array<{ id: string, label: string, text: string, view: string, warn?: boolean, meter?: number }>}
 */
export function todaySummary(d, nowMs = Date.now()) {
  const o = d.overview;
  const lines = [];
  const add = (id, label, text, view, extra = {}) => lines.push({ id, label, text, view, ...extra });

  if (!o) add('people', 'People', 'Not known: the account counts could not be read.', 'people');
  else add('people', 'People', plural(o.accounts, 'person has', 'people have') + ' an InFlight account. ' +
    (o.activations ? plural(o.activations, 'device uses', 'devices use') + ' a Pro licence.' : 'No device uses a Pro licence yet.'), 'people');

  const subs = o?.proSubscribers;
  if (!subs) add('pro', 'Pro', 'Not known: Pro subscriptions could not be read.', 'people');
  else {
    const total = subs.monthly + subs.annual;
    add('pro', 'Pro', total === 0 ? 'Nobody subscribes to Pro yet.'
      : plural(total, 'person subscribes', 'people subscribe') + ' to Pro: ' + subs.monthly + ' monthly and ' + subs.annual + ' yearly.', 'people');
  }

  const p = d.payments;
  if (!p) add('payments', 'Payments', 'Not known: payments could not be read.', 'money');
  else if (!p.connected) add('payments', 'Payments', 'Payments are not connected yet, so nobody can pay.', 'money');
  else {
    const month = new Date(nowMs).toISOString().slice(0, 7);
    const these = p.transactions.filter(t => String(t.paidAt).startsWith(month) && t.status !== 'refunded');
    const pence = these.reduce((sum, t) => sum + (t.totalPence ?? 0), 0);
    add('payments', 'Payments', these.length === 0 ? 'No payments yet this month.'
      : plural(these.length, 'payment') + ' so far this month, ' + pounds(pence) + ' in all.', 'money');
  }

  const s = o?.spend;
  if (!s) add('spend', 'Cloud spending', 'Not known: this month’s cloud spending could not be read.', 'money');
  else {
    const percent = s.ceilingPence > 0 ? Math.min(100, Math.round(s.spentPence / s.ceilingPence * 100)) : 100;
    const warn = percent >= 80;
    add('spend', 'Cloud spending', pounds(s.spentPence) + ' of the ' + pounds(s.ceilingPence) + ' monthly cap used (' + percent + '%).' +
      (percent >= 100 ? ' Paid cloud features pause until next month.' : warn ? ' Close to the cap: paid cloud features pause when it is reached.' : ''),
      'money', { meter: percent, warn });
  }

  if (d.needs === undefined) add('needs', 'Needs you', 'Checking…', 'today');
  else add('needs', 'Needs you', d.needs === 0 ? (d.unknown ? 'Some things could not be checked: see below.' : 'Nothing needs you.')
    : plural(d.needs, 'thing needs', 'things need') + ' you: see below.', 'today', { warn: d.needs > 0 });
  return lines;
}

/** What an audit action means, in plain words. Anything unknown shows its technical name. */
export const AUDIT_WORDS = {
  'user.signin': 'Signed in to the app',
  'admin.signin': 'Signed in to this page',
  'switch.set': 'Changed a switch',
  'ai.killswitch': 'Changed the online photo helper',
  'flags.set': 'Changed a flag',
  'flags.delete': 'Removed a flag',
  'licence.grant': 'Gave free Pro',
  'licence.issue': 'Made a Pro key',
  'licence.revoke': 'Cancelled a licence',
  'licence.extend': 'Extended a licence',
  'licence.releases.reset': 'Gave back device moves',
  'device.deactivate': 'Freed a device',
  'message.status': 'Marked a message',
  'news.send': 'Sent news',
  'safety.notice': 'Decided a gallery report',
  'tax.settings': 'Changed tax settings',
  'tax.oss': 'Downloaded the EU tax summary',
  'balance.refund.done': 'Marked a refund paid',
  'account.deletion.run': 'Ran account deletions',
  'cloud.storage.settle': 'Charged cloud storage',
  'cloud.balance': 'Added cloud credit',
  'ai.quota': 'Changed an online helper allowance',
  'compliance.upload': 'Uploaded a document',
  'compliance.download': 'Downloaded a document',
  'learning.run': 'Started model training',
  'release.publish': 'Published an app update notice',
  'account.create': 'Created an account',
  'pricing.save': 'Saved prices',
  'pricing.paddle.push': 'Set Paddle prices',
};

/** A page looking something up (every check of this page reads about twenty of these). Hidden by default. */
export const isPageView = (action) => action === 'overview' || /\.(read|list)$/.test(action) || action.startsWith('pricing.review') || action === 'pricing.rates' || action === 'pricing.preview';

export const auditText = (action) => AUDIT_WORDS[action] ?? (isPageView(action) ? 'Looked at ' + action.replace(/\.(read|list)$/, '').replace(/[._-]/g, ' ') : action);

/**
 * Folds runs of identical entries (same who, what, outcome and detail, one after another) into one row with a count
 * and the time span. Only the view is folded: every record stays in the log.
 * @param {Array<{ at_ms: number, actor: string, action: string, outcome: string, detail: string }>} entries newest first
 */
export function collapseAudit(entries) {
  const rows = [];
  for (const e of entries) {
    const last = rows.at(-1);
    if (last && last.actor === e.actor && last.action === e.action && last.outcome === e.outcome && (last.detail ?? '') === (e.detail ?? '')) {
      last.count += 1;
      last.oldestMs = e.at_ms;
    } else rows.push({ ...e, count: 1, newestMs: e.at_ms, oldestMs: e.at_ms });
  }
  return rows;
}
