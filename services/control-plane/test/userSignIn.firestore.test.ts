// userSignIn.test.ts on the Firestore store (see api.firestore.test.ts).
process.env.KCP_TEST_STORE = 'firestore';
await import('./userSignIn.test.ts');
export {};
