import { defineConfig } from 'vite-plus';

export default defineConfig({
   run: {
      tasks: {
         build: {
            command:
               'node scripts/convert.ts && node scripts/diff.ts && redocly lint --config redocly.yaml dist/openapi/*/*.json && vp pack',
            // The task writes dist/, so that folder is an output, not an input.
            cache: { input: [{ auto: true }, '!dist/**'] },
         },
      },
   },
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
      // `vp run coverage` writes coverage/coverage-final.json for `fallow health --coverage`.
      coverage: { provider: 'v8', reporter: ['text', 'json'], reportsDirectory: 'coverage' },
      projects: [{ test: { name: 'node', include: ['test/**/*.test.ts'], environment: 'node' } }],
   },
});
