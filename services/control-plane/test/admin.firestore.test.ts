// The same scenarios as admin.test.ts, run against the Firestore store (emulator when FIRESTORE_EMULATOR_HOST is set,
// otherwise the in-memory fake in memoryFirestore.ts). node --test runs each file in its own process.
process.env.KCP_TEST_STORE = 'firestore';
await import('./admin.test.ts');
export {};
