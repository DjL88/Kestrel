import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { publicSiteUrl } from '../core/publicSite';
import { isDesktopApp, isMobileShell } from '../providers/desktopShell';

/** The website's policy pages. They are not bundled into the app, so a relative link would lead nowhere on desktop. */
export const POLICY_PATHS = {
  privacy: '/privacy.html',
  terms: '/terms.html',
  acceptableUse: '/acceptable-use.html',
} as const;

interface SiteLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel' | 'onClick'> {
  /** A path on the public website, for example `POLICY_PATHS.terms`. */
  path: string;
  children: ReactNode;
}

/** A link to a page on the public website. It opens a new tab on the web and the system browser in the desktop app. */
export function SiteLink({ path, children, ...rest }: SiteLinkProps) {
  const url = publicSiteUrl(path);
  return (
    <a {...rest} href={url} target="_blank" rel="noopener noreferrer"
      onClick={(event) => {
        if (!isDesktopApp() || isMobileShell()) return;
        event.preventDefault();
        void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(() => undefined);
      }}>{children}</a>
  );
}
