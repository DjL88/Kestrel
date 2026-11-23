# Provider and destination icon audit — 23 November 2026

This is a source-level inventory of `main` when audited, plus the small Apple/OpenAI UI changes proposed in this branch. It is **not** visual UAT or an assertion that sign-in works end to end.

## Rules

- Brand identity means the service's actual permitted logo/symbol, with its adjacent accessible text label; generic cloud, sparkles, hard-drive or server icons must never masquerade as a named brand.
- Where brand policy permits monochrome, render `currentColor` (white on the dark theme, black/dark ink on light). Do not create custom approximations of trademarks.
- Follow the brand owner's requirements over monochrome preferences. In particular, Google's Sign in with Google guidance explicitly **forbids a monochrome Google G** for the button. Prefer Google Identity Services' rendered button or its supplied compliant coloured artwork; do not use the monochrome Google icon for sign-in.
- Apple's Sign in with Apple supports black, white or outlined button styles. The recognisable Apple silhouette added here is from Simple Icons (CC0 vector distribution; Apple retains its trademark). Before production, check the complete Apple button styling and official artwork requirements, not only the glyph.
- Microsoft's OneDrive existing logo was supplied as a full-colour asset. Do not recolour it without permission or an approved monochrome variant.
- An unknown or unavailable logo should render the **name without a counterfeit/generic logo**, not invent one.
- Store assets locally/offline, no remote image fetch at render time. Always show text names, keyboard focus and sufficient contrast.

## Actual status

| Provider/platform | Current mechanism | Source assessment / action |
| --- | --- | --- |
| Instagram | `src/core/socialIcons.ts` through `SocialIcon` | Genuine monochrome mark shipped |
| Facebook | Same | Genuine monochrome mark shipped |
| TikTok | Same | Genuine monochrome mark shipped |
| Threads | Same | Genuine monochrome mark shipped |
| X | Same | Genuine monochrome mark shipped |
| Bluesky | Same | Genuine monochrome mark shipped |
| Pinterest | Same | Genuine monochrome mark shipped |
| Google Drive | `BrandIconId: googledrive` | Genuine monochrome mark shipped |
| Dropbox | `BrandIconId: dropbox` | Genuine monochrome mark shipped |
| OneDrive | `src/components/ProviderIcon.tsx` PNG | Actual full-colour OneDrive mark shipped; keep official variant; monochrome NOT APPROVED |
| Amazon S3 | `StorageConnections.WORKS_WITH` text-only + generic S3 category | Named service lacks actual S3 logo; secure approved official asset before changing |
| Backblaze B2, Cloudflare R2, Wasabi, MinIO | `BrandIconId` marks | Genuine monochrome marks shipped |
| Synology, QNAP, Nextcloud, ownCloud | `BrandIconId` marks | Genuine monochrome marks shipped in WorksWith |
| Google Gemini | `AI_MARK.gemini` | Genuine monochrome symbol shipped |
| Anthropic / Claude | `AI_MARK.claude` | Genuine monochrome symbol shipped |
| Ollama, LM Studio | `BrandIconId` marks | Genuine monochrome marks shipped |
| Google Cloud | `BrandIconId.googlecloud` | Genuine monochrome mark shipped, verify use anywhere cloud-specific |
| OpenAI / ChatGPT | Previously `AI_NEUTRAL.chatgpt = cloud-assist` | Wrong generic icon: removed in this branch. Named text remains; official approved mark to add separately |
| Google account sign-in | Text-only V2 fallback sign-in choice | Not a counterfeit mark; add official compliant multi-colour Google Identity Services button in actual auth integration, **not** monochrome G |
| Apple account sign-in | Text-only choice on main | Added Apple silhouette with inherited theme colour; full Apple sign-in-button UAT still needed |
| Generic filesystem, WebDAV and S3-compatible endpoint | Lucide folder/server/cloud | Properly generic **only when service is not a named brand** |
| Kestrel/InFlight app mark | Brand pack with light/dark/mono variants | Separate first-party brand identity, not external provider mark |

## Priority follow-up

1. Replace V2 account sign-in stubs with real verified Google/Apple account integration and brand-compliant official sign-in controls; add server-side identity/entitlement tests.
2. Add **approved** OpenAI and Amazon S3 brand assets; make sure all named AI and cloud provider choices display them. No hand-drawn approximation.
3. Check dark/light, high contrast, focus, 320/390px widths, keyboard navigation, reduced motion and screen readers on executable V2.
4. Check the local social provider marks still match current brand guidelines and include trademark notices.
5. Preserve complete auth choice text and truthful disabled/offline states; an icon is not proof of an operational connector.

## References

- Google: https://developers.google.com/identity/branding-guidelines
- Apple: https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple
- Apple design assets: https://developer.apple.com/design/resources/
- Microsoft: https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/branding
- OpenAI: https://openai.com/brand/
- Simple Icons: https://github.com/simple-icons/simple-icons (vector distribution; trademarks remain with their owners)
