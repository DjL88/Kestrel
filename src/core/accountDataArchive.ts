/**
 * "Download my data" (UK GDPR right of access and portability): turns the control plane's account export
 * (services/control-plane/src/accountErasure.ts, format inflight-account-data/1) into the files of an open-format zip.
 * Every section is plain JSON, and the lists people most often want in a spreadsheet are also CSV. Pure: no I/O.
 *
 * Local projects, edits and original photos never leave the device and are not part of the account, so they are not in
 * this download; the README says where they are.
 */

export const ACCOUNT_EXPORT_FORMAT = 'inflight-account-data/1';

type Row = Record<string, unknown>;

/** RFC 4180 CSV. A cell that a spreadsheet would run as a formula (= + - @ at the start) is prefixed with '. */
export function toCsv(rows: readonly Row[], columns: readonly string[]): string {
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(','), ...rows.map((row) => columns.map((c) => cell(row[c])).join(','))].join('\r\n') + '\r\n';
}

const list = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((v): v is Row => !!v && typeof v === 'object') : []);
const json = (value: unknown) => JSON.stringify(value ?? null, null, 2) + '\n';

/** The files of the zip, by name. Throws when the server sent something that is not an account export. */
export function accountDataFiles(exported: unknown, readme: string): Record<string, string> {
  if (!exported || typeof exported !== 'object' || (exported as Row).format !== ACCOUNT_EXPORT_FORMAT) throw new Error('Not an InFlight account export');
  const data = exported as Row;
  const photos = list(data.cloudPhotos);
  const comments = list(data.comments);
  const purchases = list(data.purchases);
  return {
    'README.txt': readme.replace(/\r?\n/g, '\r\n'),
    'account.json': json({ format: data.format, generatedAt: data.generatedAt, account: data.account, deletion: data.deletion, cloudBalanceMillicredits: data.cloudBalanceMillicredits }),
    'licences.json': json({ licences: list(data.licences), devices: list(data.devices) }),
    'shared-projects.json': json(list(data.sharedProjects)),
    'cloud-photos.json': json(photos),
    'cloud-photos.csv': toCsv(photos, ['projectId', 'project', 'photoKey', 'name', 'addedByYou', 'addedAt', 'previewBytes', 'thumbBytes', 'originalBytes']),
    'comments.json': json(comments),
    'comments.csv': toCsv(comments, ['id', 'projectId', 'photoId', 'createdAt', 'resolvedAt', 'replyTo', 'text']),
    'purchases.json': json(purchases),
    'purchases.csv': toCsv(purchases, ['transactionId', 'invoiceNumber', 'majorVersion', 'createdAt']),
    'preferences.json': json({ alertDevices: list(data.alertDevices), alerts: data.alertPreferences, email: data.emailPreferences }),
  };
}

/** inflight-account-data-2026-11-25.zip, in the person's own time zone. */
export function accountDataFileName(nowMs: number): string {
  const d = new Date(nowMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `inflight-account-data-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.zip`;
}
