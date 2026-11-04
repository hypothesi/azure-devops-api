import { defineConfig } from 'vite-plus';
import { playwright } from 'vite-plus/test/browser-playwright';

const include = ['test/**/*.test.ts'];

export default defineConfig({
   pack: {
      entry: ['src/index.ts'],
      dts: true,
      format: ['esm', 'cjs'],
      platform: 'neutral',
      sourcemap: true,
      publint: { level: 'error', strict: true },
      attw: { level: 'error', profile: 'strict' },
   },
   test: {
      // The library must run unchanged in Node.js and in browsers, so every test runs in both.
      projects: [
         { test: { name: 'node', include, environment: 'node' } },
         {
            test: {
               name: 'browser',
               include,
               browser: {
                  enabled: true,
                  headless: true,
                  provider: playwright(),
                  instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
               },
            },
         },
      ],
   },
});
