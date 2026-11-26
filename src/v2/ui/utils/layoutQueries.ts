/**
 * Layout media queries shared by the shell and the canvas, so both agree on what a screen is.
 *
 * SHORT_LANDSCAPE: any short landscape screen up to a small tablet's width (it hides the size caption and the canvas
 * reserve so the photo gets the height). 1023 px wide includes the big phones (932 x 430, 915 x 412) that the old
 * 899 px cap missed.
 *
 * PHONE_LANDSCAPE: a touch phone held sideways. It gets its own layout (V2-WORKSPACE 26.4): navigation on the left,
 * tools on the right with Export on top, tools open as side panels. A short laptop window with a mouse keeps the rail.
 */
export const SHORT_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 520px) and (max-width: 1023px)';
export const PHONE_LANDSCAPE_QUERY = `${SHORT_LANDSCAPE_QUERY} and (pointer: coarse)`;
