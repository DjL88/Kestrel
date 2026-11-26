/**
 * First-run welcome on the V2 projects hub, and the browser-storage section in Settings → Storage (web only).
 * PRODUCT-SPEC §3.1 and §6. British English, the source for every translation.
 */
export const source = {
  welcome: {
    title: "Welcome to InFlight",
    intro: "Three things worth knowing before you start:",
    originals: "Your original photos stay where they are. InFlight never changes, moves or replaces them.",
    undo: "Every edit can be undone. InFlight keeps a recipe of your changes, not a new copy of the photo.",
    backup: "A project backup keeps your decisions, ratings and edits, but not the RAW files themselves. Keep your originals backed up as well.",
    webNote: "In a web browser, InFlight will ask the browser to keep its storage when you continue. You can see what that means in Settings, under Storage.",
    done: "Got it",
  },
  browserStorage: {
    title: "This browser’s storage",
    checking: "Checking what this browser keeps…",
    standard: "This browser may clear InFlight’s storage when space runs low or site data is cleared.",
    requesting: "Asking the browser to keep InFlight’s storage…",
    persistent: "This browser has agreed to keep InFlight’s storage. Clearing site data by hand still removes it.",
    declined: "The browser did not agree to keep InFlight’s storage. It decides this itself, often by how much you use the site. You can ask again later.",
    unavailable: "This browser cannot promise to keep InFlight’s storage.",
    ask: "Ask the browser to keep storage",
    kept: "Storage is kept",
    permissionsTitle: "File permissions",
    permissions: "The browser lets InFlight read only the photos and folders you choose. After you close the tab or restart, it may ask you again before InFlight can see a folder. Saying no does not harm your photos; InFlight just cannot show them until you allow it.",
    forgetTitle: "What the browser can forget",
    forget: "Your projects, decisions, edits and previews are kept in this browser. Clearing browsing data, using a private window or uninstalling the browser can remove them. Your original photos are never stored or changed by this, so they are safe.",
    backupHint: "To be safe, make a project backup from the project’s options and keep it, with your originals, somewhere outside this browser.",
  },
  diskPreviews: {
    title: "Previews on this computer",
    intro: "InFlight keeps three small pictures of each RAW photo in its own folder: a thumbnail, a review copy and a 2,560 px smart preview. You can keep editing a photo with its drive unplugged; exporting still needs the original. Your originals are never changed.",
    using: "Using {used} for {count} photos.",
    checking: "Checking the preview folder…",
    limitLabel: "Size limit",
    limitDefault: "{size} (suggested for this computer)",
    limitHint: "About {count} photos fit. When the folder is full, the previews you have not looked at for longest go first. They are made again when you open those photos with their drive connected.",
    clear: "Remove all previews",
    cleared: "Previews removed. They are made again as you look at photos.",
    failed: "The preview folder could not be read.",
  },
};
