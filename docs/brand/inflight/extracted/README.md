# InFlight brand pack (v2.2)

Rebrand of Kestrel to InFlight. Everything here is rebuilt as clean vectors from the original concept art.

## Folders
- `svg/logo` — stacked (kite above wordmark) and horizontal (chevron + wordmark) lockups. Variants: light, dark, mono-ink, mono-white.
- `svg/mark` — the red kite on its own.
- `svg/chevron` — the forked-tail chevron brandmark.
- `svg/wordmark` — "InFlight" outlined (Plus Jakarta Sans 700, -2% tracking, matching the app). Don't retype it.
- `svg/modes` — Auto-pilot / Co-pilot / Solo icons on a 24px grid. They use `currentColor`.
- `png` — exports of every logo SVG at 512 px and 2048 px wide (transparent).
- `app-icons` — iOS/Android/PWA sizes, maskable icon, adaptive `favicon.svg` (switches for dark mode) + 16/32/48 PNGs.
- `lottie` — `inflight-splash-light.json`, `inflight-splash-dark.json` (1080×1080, 30 fps, 3 s, transparent). Open `preview.html` with a local server to watch them.
- `tokens` — `tokens.json` / `tokens.css` (colour, mode colours, type, logo rules).
- `fonts` — Plus Jakarta Sans static weights (SIL Open Font License).

## Which asset to use
| Context | Use |
|---|---|
| Splash, marketing, About screen | Stacked logo |
| App header, docs, email signature | Horizontal logo |
| App icon, favicon, avatar, under 64 px | Chevron |
| Mode switcher | `mode-*.svg` |

## Rules
- Pick the theme file that matches the background: `-light` on light backgrounds, `-dark` on dark ones. Don't put the light rust on dark surfaces, because the wingtip drops to 3:1 contrast and turns muddy.
- Clear space: one kite head-width all round (that's the same as the chevron's apex diameter).
- Minimum sizes: kite 64 px, stacked logo 120 px wide, horizontal logo 20 px tall, chevron 12 px.
- Use the mono variants for single-colour print, embossing and photo backgrounds.

## Splash handoff
Frame 0 shows the chevron centred at 26% of the canvas width. Set the native splash (iOS LaunchScreen / Android 12 SplashScreen icon) to the same chevron at the same size and background, then start the Lottie animation. The handoff is seamless. Marker `handoff-from-native-splash` sits at frame 8.

## Changelog
- **v2.2**: Added Pro. There are two directions: (A) the standard logo with a silver PRO pill, and (B) a Silver edition (steel kite and chevron with a metallic sheen, plus the PRO pill). The pack also includes Pro app icons and Pro splash animations. The splash wing joints are reworked: the wings now pivot on a rounded shoulder, so no gap opens between wing and body while they move.
- **v2.1**: The wings now fade from Wingtip at the tips into rust along each wing (a linear gradient), replacing the hard two-tone seam. The mono variants stay flat. The splash no longer morphs: it holds on the chevron, then the whole bird fades in as one shape while the wings open from a gentle fold at the shoulders, followed by one wingbeat and the wordmark.
- **v2.0**: Back to your original kite: it's traced from the concept art, mirrored so it's exactly symmetric, and its tail is replaced with the InFlight chevron (crisp notch, smooth blend at the waist). The wordmark spans 62% of the wingspan. The splash is rebuilt from the new bird: the chevron holds, the head and body rise out of it, then the wings sweep open from the shoulders with the Wingtip feathers fanning in last.
- **v1.2**: The bird is now a blend of the concept art and the v1.0 vector. It brings back the concept's narrow waist with rounded armpits, upswept wingtips and taller head and neck, but keeps v1.0's cleaner feathers and symmetry. The chevron is unchanged from v1.1.
- **v1.1**: Lighter wings and a smaller head. The chevron apex radius now matches the head. The wordmark now uses Plus Jakarta Sans to match the app, at 66% of the wingspan. The splash is rebuilt around the wings unfolding.
- **v1.0**: Vector rebuild of the concept art.

## Pro
- `svg/pro/inflight-pro-*`: Direction A. The standard colour logo with a silver PRO pill. Recommended for app headers, the paywall and receipts.
- `svg/pro/inflight-pro-silver-*`: Direction B, the Silver edition. A steel kite and chevron with a metallic sheen, plus the PRO pill. Use it for Pro-only moments (welcome screen, Pro splash, alternate app icon).
- `svg/pro/inflight-pro-badge-*`: the pill on its own, for UI chips and plan tables.
- `app-icons/app-icon-pro-*`: silver chevron on night or paper, offered to Pro users as an alternate icon.
- `lottie/inflight-splash-pro-*.json`: the silver splash, ending on the PRO lockup.
- Pill rules: height 0.8× cap height, centred on the cap height, gap 0.3× cap. Don't use it without the wordmark in marketing.
