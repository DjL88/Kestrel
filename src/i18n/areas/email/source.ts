/**
 * Words in the emails InFlight sends (share invitations) and the unsubscribe page, in British English.
 * The control plane sends each email in the recipient's language (services/control-plane/src/mailText.ts). It reads
 * these files directly, so they stay plain data. "InFlight" is the product name in every language.
 */
export const source = {
  invitation: {
    subject: (inviter: string, project: string) => `${inviter} invited you to “${project}” on InFlight`,
    invited: (inviter: string, project: string, as: string) => `${inviter} has invited you to the InFlight project “${project}” ${as}.`,
    as: { editor: "as an editor", commenter: "as a commenter", viewer: "as a viewer", client: "as a client" },
    join: "To join, open InFlight and sign in with this email address.",
    open: "Open InFlight",
    ignore: "Not expecting this? You can ignore it. Nothing happens unless you accept.",
    stop: "Stop invitation emails to this address",
    someone: "Someone",
  },
  unsubscribe: {
    title: "Stop invitation emails",
    confirm: "Press the button to stop invitation emails to this address.",
    button: "Stop invitation emails",
    done: "Done. InFlight will not send invitation emails to this address again.",
    invalid: "This link is not valid.",
    invalidHint: "Reply to the email and we will stop them.",
  },
};
