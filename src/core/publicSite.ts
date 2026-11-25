/**
 * The public website's address: the one place the app learns it (config/public-site.json). Change it with
 * `node scripts/site/set-domain.mjs https://example.com`, which also rewrites the static site files that cannot import it.
 * Terraform (control-plane CORS, models bucket CORS) and the V2Proto gateway read the same file.
 */
import site from '../../config/public-site.json';

function origin(value: unknown): string {
  const url = new URL(String(value));
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('config/public-site.json origin must be a bare https origin');
  }
  return url.origin;
}

export const PUBLIC_SITE_ORIGIN = origin(site.origin);

/** An address on the public website, for example `publicSiteUrl('/privacy.html')`. */
export function publicSiteUrl(path: string): string {
  return PUBLIC_SITE_ORIGIN + (path.startsWith('/') ? path : '/' + path);
}
