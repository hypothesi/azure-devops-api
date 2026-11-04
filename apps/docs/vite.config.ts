import { defineConfig } from 'vite-plus';

export default defineConfig({
   run: {
      tasks: {
         // scripts/prepare.ts reads packages/openapi/dist and the client entry points.
         build: {
            command: 'node scripts/prepare.ts && vp build',
            dependsOn: ['@hypothesi/azure-devops-openapi#build', '@hypothesi/azure-devops-api#build'],
            // prepare.ts writes public/ and compatibility.html, so they are outputs, not inputs.
            cache: { input: [{ auto: true }, '!public/**', '!compatibility.html', '!dist/**'] },
         },
      },
   },
   // GitHub Pages serves a project site from /{repository}/.
   base: '/azure-devops-api/',
   build: {
      target: 'es2023',
      // Scalar's own chunks are up to 950 kB minified.
      chunkSizeWarningLimit: 1000,
      rolldownOptions: {
         input: ['index.html', 'reference.html', 'compatibility.html'],
      },
   },
   test: {
      include: ['test/**/*.test.ts'],
      environment: 'node',
      coverage: { provider: 'v8', reporter: ['text', 'json'], reportsDirectory: 'coverage' },
   },
});
