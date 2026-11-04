import { defineConfig } from 'vite-plus';

export default defineConfig({
   pack: {
      entry: ['src/manifest.ts'],
      dts: true,
      format: ['esm', 'cjs'],
      platform: 'neutral',
      // convert.ts and diff.ts write dist/openapi, dist/codegen, dist/docs, and dist/manifest.json first.
      clean: false,
      publint: { level: 'error', strict: true },
      // The package has only subpath exports, which node10 resolution cannot read.
      attw: { level: 'error', profile: 'node16' },
   },
   test: {
      projects: [{ test: { name: 'node', include: ['test/**/*.test.ts'], environment: 'node' } }],
   },
});
