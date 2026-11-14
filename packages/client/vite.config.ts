import { defineConfig } from 'vite-plus';
import { playwright } from 'vite-plus/test/browser-playwright';

const include = ['test/**/*.test.ts'];

export default defineConfig({
   run: {
      tasks: {
         // scripts/generate.ts reads packages/openapi/dist, a devDependency.
         generate: {
            command: 'node scripts/generate.ts',
            dependsOn: ['@hypothesi/azure-devops-openapi#build'],
            // The task writes src/generated, so that folder is an output, not an input.
            cache: { input: [{ auto: true }, '!src/generated/**'] },
         },
         build: { command: 'vp pack', dependsOn: ['generate'] },
         test: { command: 'vp test run', dependsOn: ['generate'] },
         'test:node': { command: 'vp test run --project node', dependsOn: ['generate'] },
         coverage: {
            command: 'vp test run --project node --coverage',
            dependsOn: ['generate'],
            // The task writes coverage/, so that folder is an output, not an input.
            cache: { input: [{ auto: true }, '!coverage/**'] },
         },
      },
   },
   pack: {
      // One file per subpath export in package.json.
      entry: {
         index: 'src/entries/index.ts',
         '7.0': 'src/entries/7.0.ts',
         '7.1': 'src/entries/7.1.ts',
         services: 'src/entries/services.ts',
         server: 'src/entries/server.ts',
         'server-2022': 'src/entries/server-2022.ts',
         compatibility: 'src/entries/compatibility.ts',
      },
      dts: true,
      format: ['esm', 'cjs'],
      platform: 'neutral',
      publint: { level: 'error', strict: true },
      attw: { level: 'error', profile: 'strict' },
   },
   test: {
      coverage: { provider: 'v8', reporter: ['text', 'json'], reportsDirectory: 'coverage' },
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
