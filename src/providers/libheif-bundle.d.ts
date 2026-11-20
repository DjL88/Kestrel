/** libheif-js ships no types for its single-file WebAssembly bundle; Kestrel only needs the factory (see heifWasmCore.ts). */
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  const factory: import('./heifWasmCore').HeifModuleFactory;
  export default factory;
}
