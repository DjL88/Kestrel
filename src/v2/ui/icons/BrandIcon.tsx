import React from 'react';
import type { AssistMode, SocialPlatform } from '../contract';

// Maps semantic icon names directly to the attached InFlight brand SVG pack.
// Rendered using CSS mask-image + currentColor so monochrome SVGs adapt crisply
// to both dark and light themes without network fetches or black-on-dark issues.
export const BRAND_ICON_PATHS = {
  account: '/v2-icons/account_e271fab0.svg',
  alert: '/v2-icons/alert_cc61461b.svg',
  'all-sizes': '/v2-icons/all-sizes_b753e14c.svg',
  archive: '/v2-icons/archive_2d530b0a.svg',
  'arrow-to-line': '/v2-icons/arrow-to-line_ae857600.svg',
  arrow: '/v2-icons/arrow_97e23b1b.svg',
  'arrows-horizontal': '/v2-icons/arrows-horizontal_68ed9e05.svg',
  assist: '/v2-icons/assist_9ba08c77.svg',
  bird: '/v2-icons/bird_31604e87.svg',
  brush: '/v2-icons/brush_1aa81b7d.svg',
  bulb: '/v2-icons/bulb_8bbb511b.svg',
  'camera-settings': '/v2-icons/camera-settings_8b784a45.svg',
  check: '/v2-icons/check_4be3ae3f.svg',
  'checkbox-checked': '/v2-icons/checkbox-checked_7c88a096.svg',
  'checkbox-empty': '/v2-icons/checkbox-empty_42cd7141.svg',
  chevron: '/v2-icons/chevron_7ab1173f.svg',
  clock: '/v2-icons/clock_6476fbc1.svg',
  close: '/v2-icons/close_ec67c123.svg',
  'cloud-assist': '/v2-icons/cloud-assist_f50723de.svg',
  'cloud-off': '/v2-icons/cloud-off_ad2452ad.svg',
  'cloud-temporary': '/v2-icons/cloud-temporary_2ce2bfc0.svg',
  cloud: '/v2-icons/cloud_c64c2d82.svg',
  collapse: '/v2-icons/collapse_fbe6588f.svg',
  compare: '/v2-icons/compare_bab6020f.svg',
  copy: '/v2-icons/copy_e48979ed.svg',
  crop: '/v2-icons/crop_32814d06.svg',
  eraser: '/v2-icons/eraser_486ad783.svg',
  expand: '/v2-icons/expand_cb760256.svg',
  export: '/v2-icons/export_8ba97d4d.svg',
  'eye-off': '/v2-icons/eye-off_495cb55f.svg',
  eye: '/v2-icons/eye_399ed1ab.svg',
  filter: '/v2-icons/filter_49437340.svg',
  'find-subject': '/v2-icons/find-subject_4689b12e.svg',
  fit: '/v2-icons/fit_50aacc0e.svg',
  'flag-camera': '/v2-icons/flag-camera_59f57fb0.svg',
  'flag-off': '/v2-icons/flag-off_501c7d54.svg',
  flag: '/v2-icons/flag_c467ec02.svg',
  float: '/v2-icons/float_639bac52.svg',
  'focal-point': '/v2-icons/focal-point_af05397b.svg',
  focus: '/v2-icons/focus_3685f244.svg',
  'folder-arrow': '/v2-icons/folder-arrow_d3cd81fb.svg',
  'folder-key': '/v2-icons/folder-key_a37129a6.svg',
  'folder-open': '/v2-icons/folder-open_59fb241c.svg',
  folder: '/v2-icons/folder_de9f251b.svg',
  'frame-add': '/v2-icons/frame-add_4fdab20c.svg',
  grid: '/v2-icons/grid_85e3f62a.svg',
  grip: '/v2-icons/grip_a6c771ea.svg',
  'hard-drive': '/v2-icons/hard-drive_c728c6ce.svg',
  help: '/v2-icons/help_34ff9de1.svg',
  history: '/v2-icons/history_7ab260dd.svg',
  'image-off': '/v2-icons/image-off_011b2e69.svg',
  'image-plus': '/v2-icons/image-plus_9df3481e.svg',
  image: '/v2-icons/image_647d52c8.svg',
  info: '/v2-icons/info_d42c3666.svg',
  keyboard: '/v2-icons/keyboard_e2f4b303.svg',
  language: '/v2-icons/language_9463750c.svg',
  link: '/v2-icons/link_b01aec41.svg',
  loader: '/v2-icons/loader_d30b480a.svg',
  lock: '/v2-icons/lock_ba4b2e76.svg',
  masks: '/v2-icons/masks_6b3c731f.svg',
  minus: '/v2-icons/minus_c577754f.svg',
  'mode-autopilot': '/v2-icons/mode-autopilot_f8e351d7.svg',
  'mode-copilot': '/v2-icons/mode-copilot_7ee1c542.svg',
  'mode-solo': '/v2-icons/mode-solo_bfa9b382.svg',
  more: '/v2-icons/more_7e2328a1.svg',
  mountain: '/v2-icons/mountain_e5d22106.svg',
  overlay: '/v2-icons/overlay_4918e1b0.svg',
  palette: '/v2-icons/palette_43ef8810.svg',
  'panel-collapse': '/v2-icons/panel-collapse_eec826cd.svg',
  panel: '/v2-icons/panel_016c515e.svg',
  paste: '/v2-icons/paste_5893e8e0.svg',
  pencil: '/v2-icons/pencil_75920033.svg',
  pin: '/v2-icons/pin_927df914.svg',
  plug: '/v2-icons/plug_c250c254.svg',
  plus: '/v2-icons/plus_847c6f3a.svg',
  'ratio-16x9': '/v2-icons/ratio-16x9_aeee0e5f.svg',
  'ratio-4x5': '/v2-icons/ratio-4x5_9baf692b.svg',
  ready: '/v2-icons/ready_75da7cc6.svg',
  refresh: '/v2-icons/refresh_f5dbde2f.svg',
  relink: '/v2-icons/relink_7eb65016.svg',
  restore: '/v2-icons/restore_4a2afc1b.svg',
  rotate: '/v2-icons/rotate_376ed8e0.svg',
  save: '/v2-icons/save_0f581aab.svg',
  search: '/v2-icons/search_28a660c9.svg',
  'select-area': '/v2-icons/select-area_2856ca4d.svg',
  'select-photos': '/v2-icons/select-photos_563ad03b.svg',
  server: '/v2-icons/server_70353e20.svg',
  settings: '/v2-icons/settings_c5548b37.svg',
  sliders: '/v2-icons/sliders_09f188a8.svg',
  sort: '/v2-icons/sort_8fa03360.svg',
  'split-panorama': '/v2-icons/split-panorama_87350606.svg',
  'star-empty': '/v2-icons/star-empty_09a33bb1.svg',
  'star-filled': '/v2-icons/star-filled_30c47d16.svg',
  'swatch-dark-on-light': '/v2-icons/swatch-dark-on-light_be391aaa.svg',
  'swatch-light-on-dark': '/v2-icons/swatch-light-on-dark_6f2f9b1b.svg',
  tag: '/v2-icons/tag_ed18d5f6.svg',
  text: '/v2-icons/text_8d28faa8.svg',
  'theme-dark': '/v2-icons/theme-dark_a88b3a49.svg',
  'theme-light': '/v2-icons/theme-light_7d04bd1f.svg',
  trash: '/v2-icons/trash_c2d35cc8.svg',
  undo: '/v2-icons/undo_7731fd53.svg',
  unlink: '/v2-icons/unlink_b02c77fe.svg',
  'video-zoom': '/v2-icons/video-zoom_2ab1274b.svg',
  'watermark-library': '/v2-icons/watermark-library_189bc8cb.svg',
  watermark: '/v2-icons/watermark_6df84e26.svg',
  'zoom-direction': '/v2-icons/zoom-direction_5899a24d.svg',
  'zoom-in': '/v2-icons/zoom-in_f58d5fb0.svg',
} as const;


// Direction B (round 03): the owner's navigation and chrome icons. They replace the matching prototype icons, and add
// the arrows and chevrons the prototype drew with one rotated arrow.
const DIRECTION_B = {
  'arrow-left': '/v2-icons/b/ArrowLeft.svg',
  arrow: '/v2-icons/b/ArrowRight.svg',
  // Drawn to match Direction B (same grid, stroke, square caps and ghost facet) for the dock buttons.
  'arrow-left-to-line': '/v2-icons/b/ArrowLeftToLine.svg',
  'arrow-right-to-line': '/v2-icons/b/ArrowRightToLine.svg',
  'chevron-down': '/v2-icons/b/ChevronDown.svg',
  'chevron-up': '/v2-icons/b/ChevronUp.svg',
  'chevron-left': '/v2-icons/b/ChevronLeft.svg',
  'chevron-right': '/v2-icons/b/ChevronRight.svg',
  sort: '/v2-icons/b/ArrowDownUp.svg',
  check: '/v2-icons/b/Check.svg',
  help: '/v2-icons/b/CircleHelp.svg',
  more: '/v2-icons/b/Ellipsis.svg',
  info: '/v2-icons/b/Info.svg',
  keyboard: '/v2-icons/b/Keyboard.svg',
  language: '/v2-icons/b/Languages.svg',
  filter: '/v2-icons/b/ListFilter.svg',
  lock: '/v2-icons/b/Lock.svg',
  minus: '/v2-icons/b/Minus.svg',
  plus: '/v2-icons/b/Plus.svg',
  search: '/v2-icons/b/Search.svg',
  settings: '/v2-icons/b/Settings2.svg',
  'checkbox-empty': '/v2-icons/b/Square.svg',
  'checkbox-checked': '/v2-icons/b/SquareCheck.svg',
  account: '/v2-icons/b/UserRound.svg',
  close: '/v2-icons/b/X.svg',
} as const;

const ALL_ICON_PATHS = { ...BRAND_ICON_PATHS, ...DIRECTION_B } as const;

export type BrandIconName = keyof typeof ALL_ICON_PATHS;

interface BrandIconProps {
  name: BrandIconName;
  size?: number;
  className?: string;
  label?: string;
}

export default function BrandIcon({
  name,
  size = 18,
  className = '',
  label,
}: BrandIconProps) {
  const src = ALL_ICON_PATHS[name];
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`inline-block shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: 'currentColor',
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
      }}
    />
  );
}

export function assistModeIconName(mode: AssistMode): BrandIconName {
  if (mode === 'solo') return 'mode-solo';
  if (mode === 'autopilot') return 'mode-autopilot';
  return 'mode-copilot';
}

/**
 * InFlight horizontal brand lockup — exact paths from inflight-logo-horizontal-dark.svg
 * with CSS variable fills so it adapts seamlessly between Dark and Light studio themes.
 */
export function BrandLogo({ height = 28, className = '' }: { height?: number; className?: string }) {
  const width = Math.round((height * 601.2) / 184.4);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-37.2 -125.2 601.2 184.4"
      width={width}
      height={height}
      role="img"
      aria-label="InFlight"
      className={`shrink-0 ${className}`}
    >
      <path
        fill="var(--brand-accent)"
        d="M71.8,-87.9 C75.8,-87.9 79.6,-86.0 82.1,-82.8 C102.6,-55.2 123.1,-27.6 143.6,0.0 C121.0,-13.8 91.5,-27.5 71.8,-37.4 C52.1,-27.5 22.6,-13.8 0.0,0.0 C20.5,-27.6 41.0,-55.2 61.5,-82.8 C63.9,-86.0 67.8,-87.9 71.8,-87.9 Z"
      />
      <path
        fill="var(--text-primary)"
        d="M189.8,0.0 C189.8,-24.8 189.8,-49.7 189.8,-74.5 C194.3,-74.5 198.8,-74.5 203.4,-74.5 C203.4,-49.7 203.4,-24.8 203.4,0.0 C198.8,0.0 194.3,0.0 189.8,0.0 Z M214.6,0.0 C214.6,-18.1 214.6,-36.3 214.6,-54.4 C218.7,-54.4 222.8,-54.4 226.9,-54.4 C226.9,-50.8 226.9,-47.3 226.9,-43.7 C226.5,-44.3 226.2,-45.0 225.9,-45.6 C227.1,-48.9 229.2,-51.4 232.1,-53.1 C235.0,-54.8 238.4,-55.6 242.3,-55.6 C246.3,-55.6 249.8,-54.7 252.9,-53.0 C256.0,-51.3 258.4,-48.9 260.2,-45.8 C261.9,-42.7 262.8,-39.1 262.8,-35.0 C262.8,-23.3 262.8,-11.7 262.8,0.0 C258.4,0.0 254.0,0.0 249.7,0.0 C249.7,-10.6 249.7,-21.3 249.7,-31.9 C249.7,-34.3 249.2,-36.4 248.3,-38.1 C247.3,-39.8 246.1,-41.2 244.4,-42.2 C242.8,-43.1 240.9,-43.6 238.7,-43.6 C236.5,-43.6 234.6,-43.1 233.0,-42.2 C231.3,-41.2 230.0,-39.8 229.1,-38.1 C228.1,-36.4 227.7,-34.3 227.7,-31.9 C227.7,-21.3 227.7,-10.6 227.7,0.0 C223.3,0.0 218.9,0.0 214.6,0.0 Z M273.0,0.0 C273.0,-24.8 273.0,-49.7 273.0,-74.5 C289.5,-74.5 306.1,-74.5 322.7,-74.5 C322.7,-70.5 322.7,-66.5 322.7,-62.5 C310.6,-62.5 298.6,-62.5 286.6,-62.5 C286.6,-55.6 286.6,-48.8 286.6,-41.9 C297.1,-41.9 307.6,-41.9 318.2,-41.9 C318.2,-37.9 318.2,-33.9 318.2,-29.9 C307.6,-29.9 297.1,-29.9 286.6,-29.9 C286.6,-19.9 286.6,-10.0 286.6,0.0 C282.0,0.0 277.5,0.0 273.0,0.0 Z M328.5,0.0 C328.5,-25.2 328.5,-50.5 328.5,-75.7 C332.8,-75.7 337.2,-75.7 341.6,-75.7 C341.6,-50.5 341.6,-25.2 341.6,0.0 C337.2,0.0 332.8,0.0 328.5,0.0 Z M351.7,0.0 C351.7,-18.1 351.7,-36.3 351.7,-54.4 C356.0,-54.4 360.4,-54.4 364.8,-54.4 C364.8,-36.3 364.8,-18.1 364.8,0.0 C360.4,0.0 356.0,0.0 351.7,0.0 Z M351.7,-60.5 C351.7,-65.2 351.7,-69.8 351.7,-74.5 C356.0,-74.5 360.4,-74.5 364.8,-74.5 C364.8,-69.8 364.8,-65.2 364.8,-60.5 C360.4,-60.5 356.0,-60.5 351.7,-60.5 Z M401.3,22.0 C397.2,22.0 393.4,21.3 390.0,20.0 C386.5,18.7 383.5,16.8 381.0,14.5 C378.5,12.1 376.7,9.3 375.6,6.1 C379.6,4.6 383.7,3.0 387.8,1.5 C388.6,4.0 390.2,6.1 392.5,7.7 C394.9,9.2 397.8,10.0 401.3,10.0 C403.9,10.0 406.3,9.5 408.3,8.5 C410.4,7.5 411.9,6.1 413.1,4.2 C414.2,2.2 414.8,-0.0 414.8,-2.7 C414.8,-6.8 414.8,-11.0 414.8,-15.1 C415.6,-14.1 416.4,-13.1 417.3,-12.1 C415.4,-8.8 412.9,-6.4 409.8,-4.7 C406.6,-3.0 403.1,-2.2 399.1,-2.2 C394.0,-2.2 389.5,-3.4 385.5,-5.7 C381.5,-8.0 378.3,-11.2 376.1,-15.3 C373.8,-19.4 372.7,-23.9 372.7,-29.0 C372.7,-34.1 373.8,-38.7 376.1,-42.7 C378.3,-46.7 381.4,-49.9 385.4,-52.2 C389.3,-54.5 393.8,-55.6 398.8,-55.6 C402.8,-55.6 406.4,-54.8 409.5,-53.1 C412.6,-51.4 415.2,-48.9 417.3,-45.7 C416.7,-44.6 416.1,-43.5 415.5,-42.4 C415.5,-46.4 415.5,-50.4 415.5,-54.4 C419.6,-54.4 423.7,-54.4 427.9,-54.4 C427.9,-37.2 427.9,-19.9 427.9,-2.7 C427.9,2.0 426.7,6.3 424.4,10.0 C422.1,13.7 419.0,16.7 415.0,18.8 C411.1,20.9 406.5,22.0 401.3,22.0 Z M400.7,-14.3 C403.5,-14.3 405.9,-14.9 408.0,-16.2 C410.1,-17.4 411.8,-19.1 413.0,-21.3 C414.2,-23.5 414.8,-26.0 414.8,-28.9 C414.8,-31.7 414.2,-34.2 412.9,-36.5 C411.7,-38.7 410.0,-40.4 407.9,-41.7 C405.8,-43.0 403.4,-43.6 400.7,-43.6 C397.9,-43.6 395.5,-43.0 393.3,-41.7 C391.1,-40.4 389.4,-38.7 388.1,-36.5 C386.9,-34.2 386.3,-31.7 386.3,-28.9 C386.3,-26.1 386.9,-23.6 388.1,-21.4 C389.4,-19.2 391.1,-17.5 393.2,-16.2 C395.4,-14.9 397.9,-14.3 400.7,-14.3 Z M438.1,0.0 C438.1,-25.2 438.1,-50.5 438.1,-75.7 C442.4,-75.7 446.8,-75.7 451.2,-75.7 C451.2,-65.0 451.2,-54.4 451.2,-43.7 C450.6,-44.3 450.0,-45.0 449.4,-45.6 C450.6,-48.9 452.7,-51.4 455.6,-53.1 C458.5,-54.8 461.9,-55.6 465.8,-55.6 C469.8,-55.6 473.3,-54.7 476.4,-53.0 C479.5,-51.3 481.9,-48.9 483.7,-45.8 C485.4,-42.7 486.3,-39.1 486.3,-35.0 C486.3,-23.3 486.3,-11.7 486.3,0.0 C481.9,0.0 477.5,0.0 473.2,0.0 C473.2,-10.6 473.2,-21.3 473.2,-31.9 C473.2,-34.3 472.7,-36.4 471.8,-38.1 C470.8,-39.8 469.6,-41.2 467.9,-42.2 C466.3,-43.1 464.4,-43.6 462.2,-43.6 C460.0,-43.6 458.1,-43.1 456.5,-42.2 C454.8,-41.2 453.5,-39.8 452.6,-38.1 C451.6,-36.4 451.2,-34.3 451.2,-31.9 C451.2,-21.3 451.2,-10.6 451.2,0.0 C446.8,0.0 442.4,0.0 438.1,0.0 Z M520.2,0.6 C514.0,0.6 509.3,-1.1 505.9,-4.5 C502.6,-7.8 500.9,-12.6 500.9,-18.7 C500.9,-26.7 500.9,-34.7 500.9,-42.7 C497.7,-42.7 494.6,-42.7 491.5,-42.7 C491.5,-46.6 491.5,-50.5 491.5,-54.4 C491.8,-54.4 492.1,-54.4 492.5,-54.4 C495.1,-54.4 497.2,-55.1 498.7,-56.5 C500.1,-57.9 500.9,-59.9 500.9,-62.6 C500.9,-64.0 500.9,-65.4 500.9,-66.8 C505.2,-66.8 509.6,-66.8 514.0,-66.8 C514.0,-62.7 514.0,-58.5 514.0,-54.4 C518.1,-54.4 522.3,-54.4 526.5,-54.4 C526.5,-50.5 526.5,-46.6 526.5,-42.7 C522.3,-42.7 518.1,-42.7 514.0,-42.7 C514.0,-34.9 514.0,-27.2 514.0,-19.4 C514.0,-17.6 514.3,-16.1 514.9,-14.8 C515.6,-13.5 516.6,-12.6 517.9,-11.9 C519.3,-11.2 521.0,-10.9 523.2,-10.9 C523.6,-10.9 524.2,-10.9 524.8,-11.0 C525.5,-11.1 526.1,-11.1 526.7,-11.2 C526.7,-7.5 526.7,-3.7 526.7,0.0 C525.7,0.1 524.7,0.3 523.5,0.4 C522.3,0.5 521.2,0.6 520.2,0.6 Z"
      />
    </svg>
  );
}

/**
 * Clean matching-stroke social platform icons for ExportDialog quick-selection.
 */
export function SocialLogo({
  platform,
  size = 16,
}: {
  platform: SocialPlatform;
  size?: number;
}) {
  switch (platform) {
    case 'instagram':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'youtube':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
          <polygon points="10,9.2 15.6,12 10,14.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'x':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 4l16 16M20 4L4 20" />
        </svg>
      );
    case 'linkedin':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="3.5" />
          <path d="M8 11v5M8 8v.5M12 16v-5m0 2a2.5 2.5 0 0 1 5 0v3" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 4v11a3.5 3.5 0 1 1-3-3.46M14 4c.8 2.4 2.7 4 5 4.2" />
        </svg>
      );
    case 'pinterest':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M10.5 19l1.8-7.2M9.5 13c-.8-1.8.4-4.5 3-4.5 2.3 0 3.5 1.6 3.2 3.8-.3 2.1-1.7 3.2-3.2 3.2-.8 0-1.4-.4-1.6-1" />
        </svg>
      );
  }
}
