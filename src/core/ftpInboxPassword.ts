/**
 * The user name and password a camera types for the live-shoot FTP inbox. Typed on a camera's on-screen keyboard, so
 * short, lower-case, and without characters that look alike (no 0/o, 1/l/i). 10 characters from 31 is about 49 bits,
 * plenty for a server that only listens during a shoot and slows every wrong guess.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export const FTP_INBOX_USER = 'inflight';
export const FTP_INBOX_PORT = 2121;

export function ftpInboxPassword(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes), length = 10): string {
  let out = '';
  while (out.length < length) {
    for (const byte of random(new Uint8Array(length * 2))) {
      // Reject bytes past the last whole multiple of the alphabet, so every character is equally likely.
      if (byte < 256 - (256 % ALPHABET.length) && out.length < length) out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return out;
}
