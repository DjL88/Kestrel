// The same account deletion scenarios against the Firestore store (emulator when FIRESTORE_EMULATOR_HOST is set,
// otherwise the in-memory fake), so Store.eraseAccount is proved on both implementations.
process.env.KCP_TEST_STORE = 'firestore';
await import('./account-erasure.test.ts');
export {};
