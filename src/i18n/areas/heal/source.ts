import { plural } from '../../../core/locale';

/**
 * Spot healing in the V2 editor (src/core/heal.ts). British English, the source for every translation.
 */
export const source = {
  title: "Remove spots",
  intro: "Covers dust, a twig or perch clutter with pixels copied from nearby in the same photo. Nothing is made up, and the original file is never changed.",
  start: "Place spots",
  stop: "Done",
  placing: "Click or tap each spot to cover. Press Escape when you are done.",
  size: "Size",
  feather: "Softness",
  method: "Method",
  heal: "Heal: blend with the surroundings",
  clone: "Clone: exact copy",
  nextSource: "Copy from somewhere else",
  remove: "Remove spot",
  removeAll: "Remove all spots",
  show: "Show spot",
  hide: "Hide spot",
  spot: (n: number) => `Spot ${n}`,
  hidden: "hidden",
  count: (n: number) => plural(n, { one: `${n} spot`, other: `${n} spots` }),
  empty: "No spots yet.",
  added: "Spot covered. Drag the dashed circle, or choose Copy from somewhere else, to change where it copies from.",
  full: (n: number) => `This photo already has ${n} spots, the most allowed.`,
  noSource: "Nothing nearby looked similar enough to copy from. Try a smaller size.",
  unreadable: "The photo could not be read just now, so no spot was added.",
  noOther: "There is no other nearby place to copy from.",
  working: "Finding a place to copy from…",
  historyStep: "Spot healing",
  layer: "Spot healing spots",
  select: (n: number) => `Spot ${n}: select`,
  source: (n: number) => `Where spot ${n} copies from: drag, or use the arrow keys`,
};
