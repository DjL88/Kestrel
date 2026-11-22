export type LogoTone = 'light' | 'dark';

/** The brand pack's rule: a `-light` file on light surfaces, a `-dark` file on dark ones. Every current display theme is dark; a light theme sets `data-theme="light"` and the logos follow it. */
export function logoToneFor(theme: string | undefined): LogoTone {
  return theme === 'light' ? 'light' : 'dark';
}
