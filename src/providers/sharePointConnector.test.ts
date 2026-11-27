import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeUrl, CLOUD_DRIVES, parseSharePointLink } from '../core/cloudDrive.ts';
import { resolveSharePointLibrary, sharePointConnector } from './cloudDriveConnectors.ts';

const reply = (status: number, body?: unknown) => new Response(body === undefined ? null : typeof body === 'string' || body instanceof Uint8Array ? (body as BodyInit) : JSON.stringify(body), { status });

test('SharePoint links are read into host, site and library; anything else is refused', () => {
  assert.deepEqual(parseSharePointLink('https://contoso.sharepoint.com/sites/Photos/Shared%20Documents/Forms/AllItems.aspx'),
    { host: 'contoso.sharepoint.com', sitePath: '/sites/Photos', library: 'Shared Documents' });
  assert.deepEqual(parseSharePointLink('https://contoso.sharepoint.com/teams/Studio'), { host: 'contoso.sharepoint.com', sitePath: '/teams/Studio', library: null });
  assert.deepEqual(parseSharePointLink('https://contoso.sharepoint.com/sites/Photos/SitePages/Home.aspx')?.library, null);
  assert.deepEqual(parseSharePointLink('https://contoso.sharepoint.com/Shared%20Documents'), { host: 'contoso.sharepoint.com', sitePath: '', library: 'Shared Documents' });
  for (const bad of ['http://contoso.sharepoint.com/sites/A', 'https://contoso.sharepoint.com.evil.com/sites/A', 'https://evil.com/sites/A', 'not a link', 'https://contoso.sharepoint.com/:f:/s/A/xyz']) {
    assert.equal(parseSharePointLink(bad), null, bad);
  }
});

test('SharePoint sign-in asks only for the sites an admin grants, on the work-account endpoint', () => {
  const url = new URL(authorizeUrl(CLOUD_DRIVES.sharepoint, { clientId: 'c', redirectUri: 'http://localhost:53682/oauth-callback', state: 's', challenge: 'x' }));
  assert.equal(url.searchParams.get('scope'), 'Sites.Selected offline_access');
  assert.match(url.pathname, /^\/organizations\//);
  assert.equal(CLOUD_DRIVES.sharepoint.clientIdEnv, CLOUD_DRIVES.onedrive.clientIdEnv, 'one Microsoft app for both');
});

test('a library is found from the link, by name or by its address', async () => {
  const seen: string[] = [];
  const fetchImpl = async (url: string) => {
    seen.push(url);
    if (url.includes('/sites/contoso.sharepoint.com:/sites/Photos:')) return reply(200, { id: 'contoso.sharepoint.com,abc,def', displayName: 'Photos', webUrl: 'https://contoso.sharepoint.com/sites/Photos' });
    if (url.includes('/drives?')) return reply(200, { value: [
      { id: 'b!other', name: 'Clients', webUrl: 'https://contoso.sharepoint.com/sites/Photos/Clients' },
      { id: 'b!main', name: 'Documents', webUrl: 'https://contoso.sharepoint.com/sites/Photos/Shared%20Documents' },
    ] });
    return reply(404);
  };
  const deps = { getToken: async () => 't', fetchImpl };
  const byAddress = await resolveSharePointLibrary(parseSharePointLink('https://contoso.sharepoint.com/sites/Photos/Shared%20Documents/Forms/AllItems.aspx')!, deps);
  assert.deepEqual(byAddress, { driveId: 'b!main', siteName: 'Photos', libraryName: 'Documents', webUrl: 'https://contoso.sharepoint.com/sites/Photos/Shared%20Documents' });
  assert.equal((await resolveSharePointLibrary(parseSharePointLink('https://contoso.sharepoint.com/sites/Photos/Clients')!, deps)).driveId, 'b!other');
  assert.equal((await resolveSharePointLibrary(parseSharePointLink('https://contoso.sharepoint.com/sites/Photos')!, deps)).driveId, 'b!main', 'the main library when none is named');
  await assert.rejects(resolveSharePointLibrary(parseSharePointLink('https://contoso.sharepoint.com/sites/Photos/Nope')!, deps), /no library with that name/);
  await assert.rejects(resolveSharePointLibrary(parseSharePointLink('https://contoso.sharepoint.com/sites/Other')!, deps), /could not find that site/);
});

test('a site the admin has not granted says what to ask for', async () => {
  const deps = { getToken: async () => 't', fetchImpl: async () => reply(403) };
  await assert.rejects(resolveSharePointLibrary(parseSharePointLink('https://contoso.sharepoint.com/sites/Photos')!, deps), /admin to grant InFlight access/);
});

test('files live in an InFlight folder in that library, addressed by path', async () => {
  const urls: string[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    urls.push(`${init.method ?? 'GET'} ${url}`);
    if (url.endsWith(':/children?$select=name,folder&$top=200')) return reply(200, { value: [{ name: 'a.json' }] });
    return reply(200, url.endsWith('/content') && !init.method ? 'x' : {});
  };
  const connector = sharePointConnector({ getToken: async () => 't', fetchImpl }, { driveId: 'b!main' });
  assert.deepEqual(await connector.test(), { ok: true });
  await connector.put('InFlight/v1/recipes/p/a.json', new TextEncoder().encode('{}'), '');
  assert.deepEqual(await connector.list('InFlight/v1/recipes/p'), ['InFlight/v1/recipes/p/a.json']);
  await connector.remove('InFlight/v1/recipes/p/a.json');
  assert.deepEqual(urls, [
    'GET https://graph.microsoft.com/v1.0/drives/b!main/root',
    'PUT https://graph.microsoft.com/v1.0/drives/b!main/root:/InFlight/InFlight/v1/recipes/p/a.json:/content?@microsoft.graph.conflictBehavior=replace',
    'GET https://graph.microsoft.com/v1.0/drives/b!main/root:/InFlight/InFlight/v1/recipes/p:/children?$select=name,folder&$top=200',
    'DELETE https://graph.microsoft.com/v1.0/drives/b!main/root:/InFlight/InFlight/v1/recipes/p/a.json',
  ]);
  await assert.rejects(connector.put('../x', new Uint8Array(), ''), /outside the InFlight folder in SharePoint/);
  assert.throws(() => sharePointConnector({ getToken: async () => 't', fetchImpl }, { driveId: '../me/drive' }));
});
