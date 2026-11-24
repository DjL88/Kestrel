export const friendlyAuthError = (error: unknown): string => {
  const code = (error as { code?: string })?.code ?? '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in was cancelled. Nothing changed.';
  if (code === 'auth/popup-blocked') return 'Your browser blocked the sign-in window. Allow pop-ups for this page and try again.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'That email and password do not match. Check them or reset your password.';
  if (code === 'auth/email-already-in-use') return 'There is already an account with that email. Sign in instead, or reset your password.';
  if (code === 'auth/weak-password') return 'Choose a longer password (at least 6 characters).';
  if (code === 'auth/invalid-email') return 'That does not look like an email address.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes and try again.';
  if (code === 'auth/unauthorized-domain') return 'This address is not authorised for Firebase sign-in. Ask the administrator to add the app domain in Firebase Authentication.';
  if (code === 'auth/operation-not-allowed') return 'This sign-in method is not enabled on the server. Choose another method or ask the administrator to enable it.';
  if (code === 'auth/invalid-api-key' || code === 'auth/app-not-authorized' || code === 'auth/configuration-not-found') return 'The sign-in configuration for this build is invalid or incomplete. Ask the administrator for an updated build.';
  if (code === 'auth/user-disabled') return 'This account has been disabled. Contact support if you think this is a mistake.';
  if (code === 'auth/network-request-failed') return 'Could not reach the sign-in service. Check your connection; InFlight still works offline.';
  return 'Sign-in did not complete. Nothing changed and InFlight still works without an account.';
};
