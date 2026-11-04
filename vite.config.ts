import { defineConfig } from 'vite-plus';

export default defineConfig({
   lint: {
      ignorePatterns: ['**/dist/**'],
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
      ignorePatterns: ['**/dist/**', 'package-lock.json', '**/*.md'],
      printWidth: 120,
      tabWidth: 3,
      singleQuote: true,
      sortPackageJson: true,
   },
});
