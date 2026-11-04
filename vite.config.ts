import { defineConfig } from 'vite-plus';

export default defineConfig({
   lint: {
      ignorePatterns: ['**/dist/**', 'apps/docs/public/**', 'packages/client/src/generated/**'],
      plugins: ['typescript', 'unicorn', 'oxc'],
      categories: {
         correctness: 'error',
         suspicious: 'error',
         perf: 'error',
      },
      rules: {
         'typescript/no-explicit-any': 'error',
         'no-nested-ternary': 'error',
         eqeqeq: 'error',
         'typescript/explicit-function-return-type': 'error',
      },
      options: {
         typeAware: true,
         typeCheck: true,
      },
   },
   fmt: {
      // packages/openapi/source must stay byte-identical to the Software Heritage snapshot.
      ignorePatterns: [
         '**/dist/**',
         'apps/docs/public/**',
         'package-lock.json',
         '**/*.md',
         'packages/openapi/source/**',
         'packages/client/src/generated/**',
      ],
      printWidth: 120,
      tabWidth: 3,
      singleQuote: true,
      sortPackageJson: true,
   },
});
