/**
 * The lensfun lens database (CC BY-SA 3.0, https://github.com/lensfun/lensfun), fetched only when the person asks for lens
 * profiles. Nothing third-party ships with Kestrel. Each file is pinned to one lensfun commit and checked against its
 * SHA-256 before it is used; the parsed database is then kept in this device's own storage (IndexedDB) and works offline.
 * Only these public files are requested. No photo, EXIF or account detail is sent.
 */
import { emptyLensDb, parseLensfunXml, type LensDb } from '../core/lensProfiles';

export const LENSFUN_COMMIT = '1c330008c9677827677139cfee48559e2f6c29de';
export const LENSFUN_CREDIT = 'Lens profiles: lensfun project, CC BY-SA 3.0';
const BASE = `https://raw.githubusercontent.com/lensfun/lensfun/${LENSFUN_COMMIT}/data/db/`;

/** [file, SHA-256, bytes] for every database file at LENSFUN_COMMIT. */
export const LENSFUN_FILES: ReadonlyArray<readonly [string, string, number]> = [
  ['6x6', 'ca13c2756b32d728675372695c072517a0e38af5eff2ecd3e17599dee7fc58b3', 29550],
  ['actioncams', '79a5da0322574b95690464444c9d9ba1da0e1f827da44fd6bff120a0ec10e4b4', 17188],
  ['compact-canon', 'bae47e4b3a0f8852641038ae2dcca5b28ed7965e65ca795fd676f9de857c4670', 247046],
  ['compact-casio', 'ab35433879c4574ef8f97cd4e3d114d7ff8db4e7279da9d502fc9e911b51ee27', 6889],
  ['compact-fujifilm', '58af9ebef2410c428ae2c5d01003d2247330d47d918823e63522b4d897a997d1', 67954],
  ['compact-kodak', '377018ccd74f58e966b37a11e5a8689be4268153bebece9f1f2a0dbfa8234845', 2091],
  ['compact-konica-minolta', '832a7473951ab625e10c48af6cf60f89b57280016d45729e2584cf9e41ad3cc7', 13349],
  ['compact-leica', '8e4676679377576dc19e7900ce86fc69b0248ea1d4538aa22ee1ee09431a3be3', 9113],
  ['compact-nikon', '5393bdb8223e13d21b85818e96571e97c035470b49b0452dfcedc2e1ff512d3b', 40003],
  ['compact-olympus', '7637d469ad54a02ebce9492a9aa9424a2ff1ec07b0398158076f762fdc08389b', 34454],
  ['compact-panasonic', 'f191fc2a5d49fb50c06f4c399ee8c1a83a05f93a0efaecd352ec5c1479b8e60b', 70621],
  ['compact-pentax', '596fae3edaadcf2d90ae930fc1bec42597ca0b2bd11842e686e1b915f3736390', 6689],
  ['compact-ricoh', '46df96ebc367d5170cb6b7dfc3742093f0ad946264518fc5488573ba052f29d7', 18424],
  ['compact-samsung', '36e3a778046d56385c387d48474cd32a89a5da94d99e640b5ce716ce747f898d', 13875],
  ['compact-sigma', '0ddc265e3e580da05dcd4664d1b9c2464838d74dd02519c826520950c8f1759e', 2395],
  ['compact-sony', '6b1e5ec3710915f04eceffb87eafdfded4b56d5b4bc58d5086ae59f7d3c066f0', 126390],
  ['contax', '5eba12e6fd4913470afb6fe25fee47a263084b6cec830297273909872f47669a', 1696],
  ['generic', 'cd572d4110981546b2c4cd296c2ff16755b30063fa136d8b06ad2ca13ab4c59f', 5416],
  ['mil-canon', '2de8e9467a6af6f83cc9da834d3d3b94d1aaf54519f60c68ac6bc02780a77516', 247994],
  ['mil-fujifilm', 'cc8fd1d595bf6b57ea2e4f0bbdc30f5ac8af4867fad29efe445a79c90c2d2177', 213330],
  ['mil-hasselblad', '13e1fa55d36c2ed7d22964c21ce6c21d887bfe4506e840e425da1ce4157c3756', 1048],
  ['mil-leica', 'c691037e2e0743388473c2a0545e340462c412b7e3b57e451f4f9c89dde2388a', 11663],
  ['mil-nikon', 'acf49d92dfe1e91130329a76adfaa5ebc3c3517e68b4a7905a427b1de5247db5', 179243],
  ['mil-olympus', '989a3d88ef07a286efc2755df214792fdf71d60366932a1b369a77ad39cf2abb', 147123],
  ['mil-panasonic', 'eb5f01f33e65721f3900786d5970c7e220dd042aaa56968be33c009a358ff3c5', 299264],
  ['mil-pentax', '675a94f52794868ad9f1d79e17b7128783c34b3db23e9eac346c5963812a16e5', 1385],
  ['mil-samsung', '10130e9e125e0882a16fd3033cfed0175e9c14cb7d35e630cdb94736f27e5dc3', 13007],
  ['mil-samyang', 'ae3bf262f12facdc6f81b837cf6d36fdde2a930d2bfb0918d5abaa47fcfea3ab', 25990],
  ['mil-sigma', '34082bae4f6b476f8b75ea03d2f88a0485b1c5f7ce6bde87c7d729742f7b81ba', 126270],
  ['mil-sony', 'f9f7e5d7461ac58f76eb55dcc5b211f2e9a451402ddb4a9ecb12d1e4dc04f2b8', 274541],
  ['mil-tamron', '64077167f06e25b1a9393eaefd8ceb9b288c7ad20b046c2d97c83fbca536b6b6', 108177],
  ['mil-tokina', 'addb27bd82b0d729644b9da1342f92401f63cc5945309ed17f38f4b7af1649e3', 1014],
  ['mil-zeiss', 'ef8a238904fc9ea6fdb6171863dfd70cd94814af19ecd8c31ee000ca1864589d', 19171],
  ['misc', '2000a347d9dc37d908ea5b56c760de5b2b4ab475857959ae2e901c31339b01bb', 176039],
  ['om-system', 'df749b0d5df0833ac15ebc7e22bd3ad0daaaab537bcc551da80d7d89112d50db', 44718],
  ['rf-leica', 'f93636e1980ad308d1873cc3ac078cdc77c0d529d777cd45c5c8d0e4781981e3', 6712],
  ['slr-canon', '5244e6df8f2522f829c57e2073313ce31a624e9ed9605310fe43613b9d588c99', 780353],
  ['slr-hasselblad', '97602c467699904bf101179ea2fa24f05f3e1879250498a6ba306cd95a3b7a6b', 642],
  ['slr-konica-minolta', '5639ca94f121f609247c2c120b65830b3ef7784db6ecfa7e8eb3d29ff5046c1b', 47170],
  ['slr-leica', 'c5e74cb511712e99ed60a066e85c842fea58f693c5039c3819485619f5293d0e', 432],
  ['slr-nikon', '5e591e8b1032203cce4c822f1da3d49524a78e7d71c594ea5a4533f2e57aacdf', 550157],
  ['slr-olympus', 'f7693b6779edd8ed10d7dc23113669255bfa4987cea7db0e843f7f5f2bbbe615', 116602],
  ['slr-panasonic', 'cd79acb49d9ce5f2a4cecc572b3e117f03da380bed2dcbfd52327192d8ce2381', 419],
  ['slr-pentax', '93be1fe9263e06d7d69a8a6ae10cb52f23cad08ddc44f57f749e1ca288bc0c6e', 210117],
  ['slr-ricoh', 'c835798136a53535fdf4f81312ac9aad0ea3de3ef732c183d8cc4d2f432011d9', 2869],
  ['slr-samsung', 'dc0a29e424ff96e4316ddeb76126fa6f6c73a8836905a3e1f56f0c493826148f', 1110],
  ['slr-samyang', 'fb1585bea91f5f59e1fae8811dd76c92252ee5d52e3647df2aff4695048443b5', 16811],
  ['slr-schneider', 'de607cfe4ba6e7debc61e282ce39b72825c07601572e14af2bc9108ba67faf81', 5890],
  ['slr-sigma', 'f55f41c144fbb72e3c51d2dfef40e918930d37db1b4150bd02bd746406c036d2', 444640],
  ['slr-soligor', '1aba0aab19bce87ea86175b6551cb5306a512eb54be1698b89991b86008f6a04', 573],
  ['slr-sony', 'e5ca7f532afe23ff380bf2f9e5458f687bed603355d73a254d85c4e692942fdc', 88865],
  ['slr-tamron', 'c62090789cebe6bbb663111c6e97beeb1111852bb735088e29cf8782df4bab45', 201992],
  ['slr-tokina', 'b1213eda81a613bc3976340398c6b8ce8b7dc29423476fc565d5f8e5cf612ecf', 91977],
  ['slr-ussr', '1fd6acc8a8f40373379bea2899ffd96fc34b22d9b044d0474dabd4c89af44efb', 19024],
  ['slr-vivitar', 'c5c67e3fe38e8fa19044acadc7730047690435f66aac563f55ffe04997a88111', 2157],
  ['slr-zeiss', '49aa211a41fd5fe391d26af5fa65bdf9428d60863ffff15d3916fa1c520dc101', 14957],
];

export const LENSFUN_DOWNLOAD_BYTES = LENSFUN_FILES.reduce((sum, [, , bytes]) => sum + bytes, 0);

const DATABASE = 'kestrel-lens-profiles-v1';
const STORE = 'data';
const KEY = `lensfun-${LENSFUN_COMMIT}`;

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Local storage is not available on this device.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open lens profile storage.'));
  });
}

async function stored(): Promise<LensDb | null> {
  const db = await open();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const v = value as Partial<LensDb> | undefined;
    return v && Array.isArray(v.cameras) && Array.isArray(v.lenses) && typeof v.mounts === 'object' ? (v as LensDb) : null;
  } finally { db.close(); }
}

async function store(value: LensDb): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.objectStore(STORE).put(value, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Fetch one file and refuse it unless it is exactly the pinned bytes. */
export async function fetchPinned(name: string, sha256: string, bytes: number, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(`${BASE}${name}.xml`, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (!response.ok) throw new Error(`Lens profiles could not be downloaded (${name}: ${response.status}).`);
  const body = await response.arrayBuffer();
  if (body.byteLength !== bytes || hex(await crypto.subtle.digest('SHA-256', body)) !== sha256) {
    throw new Error('A downloaded lens profile file did not match the expected one, so none were kept.');
  }
  return new TextDecoder().decode(body);
}

let cached: Promise<LensDb | null> | null = null;

/** The database if this device already has it, else null. With `download`, fetch, check and keep it first. */
export function lensDatabase(download = false): Promise<LensDb | null> {
  const attempt = (cached ?? stored().catch(() => null)).then(async (have) => {
    if (have || !download) return have;
    const texts: string[] = [];
    // A few at a time, in a fixed order, so the parsed database is the same on every device.
    for (let i = 0; i < LENSFUN_FILES.length; i += 6) {
      texts.push(...await Promise.all(LENSFUN_FILES.slice(i, i + 6).map(([name, sha, bytes]) => fetchPinned(name, sha, bytes))));
    }
    const db = emptyLensDb();
    for (const text of texts) parseLensfunXml(text, db);
    await store(db).catch(() => undefined); // still usable this session if storage is full
    return db;
  });
  // A failed or declined attempt is not remembered, so the next request tries again.
  cached = attempt.then((db) => db, () => null);
  void cached.then((db) => { if (!db) cached = null; });
  return attempt;
}
