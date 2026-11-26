/**
 * Small offline workflow extras in the V2 editor: saved views of the filmstrip's filters and the "next photo to
 * review" keys (src/core/savedViews.ts). British English, the source for every translation.
 */
export const source = {
  title: "Saved views",
  hint: "Kept on this device only. A view changes which photos are shown, never the photos themselves.",
  none: "No saved views yet. Choose filters, then save them here with a name.",
  show: (name: string) => `Show ${name}`,
  remove: (name: string) => `Delete the saved view ${name}`,
  nameLabel: "Name for these filters",
  save: "Save view",
  saved: (name: string) => `Saved the view ${name}.`,
  replaced: (name: string) => `Updated the view ${name}.`,
  emptyName: "Type a name for the view first.",
  full: (max: number) => `You can keep up to ${max} saved views. Delete one first.`,
  notStored: "This device would not keep the view, so it will be gone when InFlight closes.",
  showing: (name: string) => `Showing the saved view ${name}`,
  noneAhead: "No more photos to review after this one in the photos shown.",
  noneBehind: "No photos to review before this one in the photos shown.",
};
