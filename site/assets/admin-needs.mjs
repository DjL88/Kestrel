// "Needs you": the short list the admin console opens on. Pure: it takes what the console already loaded and returns
// only the things a person has to act on. Everything else (counts, metrics, switches, flags) lives behind "More".
// A source that could not be read is reported as unknown, never as "all good".

const DAY = 86_400_000;
const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many);

/**
 * @param {object} d whatever loaded; a key that is `undefined` was not read, `null` means "could not be read".
 * @param {number} nowMs
 * @returns {{ items: Array<{ id: string, urgent: boolean, title: string, detail: string, view: string }>, unknown: string[] }}
 */
export function needsYou(d, nowMs = Date.now()) {
  const items = [];
  const unknown = [];
  const add = (id, title, detail, view, urgent = false) => items.push({ id, urgent, title, detail, view });

  if (d.refunds === null) unknown.push('refunds owed');
  else if (d.refunds?.length) {
    const pence = d.refunds.reduce((sum, r) => sum + (r.pence ?? 0), 0);
    add('refunds', plural(d.refunds.length, 'refund') + ' owed after account deletion',
      '£' + (pence / 100).toFixed(2) + ' in unused cloud balance to pay back through Paddle, then mark each one refunded.', 'refunds');
  }

  if (d.safety === null) unknown.push('safety');
  else if (d.safety) {
    const cases = d.safety.cases ?? [];
    const toReport = cases.filter(k => k.kind === 'hash-match' && (k.status !== 'reported' || k.nca === 'manual'));
    const failed = toReport.filter(k => k.ncmec?.error);
    if (toReport.length) add('safety-report', plural(toReport.length, 'hash match') + ' to report',
      failed.length ? 'The automatic CyberTipline report failed for ' + failed.length + '. Send it again or record a report made by hand.'
        : 'Send the report, or record that it was made by hand.', 'safety', true);
    const held = cases.filter(k => k.kind === 'ai-flag' && k.status === 'review');
    if (held.length) add('safety-held', plural(held.length, 'held picture') + ' to decide', 'Release it or keep it held, from its details only.', 'safety');
    const open = (d.safety.notices ?? []).filter(n => n.status === 'open');
    const urgent = open.some(n => n.urgent);
    if (open.length) add('safety-notices', plural(open.length, 'gallery report') + ' to answer' + (urgent ? ' (urgent)' : ''),
      'Choose no action, remove the photo or revoke the gallery. The reporter sees your reason.', 'safety', urgent);
  }

  if (d.messages === null) unknown.push('messages');
  else if (d.messages) {
    const fresh = d.messages.filter(m => m.status === 'new');
    if (fresh.length) add('messages', plural(fresh.length, 'new message'), 'From the website contact form. Reply from your own email, then mark it answered.', 'messages');
  }

  if (d.paddleKey?.lastRunOk === false) add('paddle-key', 'The weekly Paddle key renewal failed',
    (d.paddleKey.lastRunReason ? d.paddleKey.lastRunReason + '. ' : '') + 'It tries again next week; renew the key in Paddle if it keeps failing.', 'money', true);
  else if (d.paddleKey?.expiresAt && Date.parse(d.paddleKey.expiresAt) - nowMs < 14 * DAY) add('paddle-key', 'The Paddle API key expires soon',
    'It expires on ' + d.paddleKey.expiresAt.slice(0, 10) + ' and has not renewed itself. Renew it in Paddle.', 'money', true);

  // Self-healing things stay off this list: one failed learning batch retries by itself, and email over the daily
  // limit waits for tomorrow by itself. Only a job that keeps failing needs a person.
  const runs = d.learning?.runs ?? [];
  if (runs.length >= 2 && runs[0].status === 'failed' && runs[1].status === 'failed') add('learning', 'Learning has failed twice in a row',
    'Each failed batch still counts against this month’s ceiling. Check the Vertex AI job log, or switch Learning off until it is fixed.', 'service');

  const t = d.tax?.turnover;
  if (t?.backward || t?.forward) add('vat', 'UK VAT registration is due',
    'Notify HMRC by ' + (t.backward ?? t.forward).notificationDue + '.', 'money', true);

  items.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  return { items, unknown };
}

/** Which "More" view each console section belongs to. A link to an old section id still opens its view. */
export const VIEWS = {
  refunds: { label: 'Refunds owed', sections: ['refunds'] },
  licences: { label: 'Licences and Pro access', sections: ['grant', 'issue', 'licensees'] },
  messages: { label: 'Messages', sections: ['messages'] },
  safety: { label: 'Safety', sections: ['safety'] },
  compliance: { label: 'Compliance documents', sections: ['compliance'] },
  money: { label: 'Money and tax', sections: ['payments', 'accounts', 'tax', 'price-review', 'usage'] },
  news: { label: 'Send news', sections: ['notifications'] },
  service: { label: 'Switches, flags and jobs', sections: ['switches', 'flags', 'mail', 'learning', 'monitoring'] },
  records: { label: 'Counts and audit log', sections: ['overview', 'audit'] },
};

/** The view a location hash opens: a view name, or any section inside one. Anything else is the home list. */
export function viewForHash(hash) {
  const id = String(hash ?? '').replace(/^#/, '');
  if (!id) return null;
  if (VIEWS[id]) return id;
  for (const [name, view] of Object.entries(VIEWS)) if (view.sections.includes(id)) return name;
  return null;
}
