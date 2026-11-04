/// <reference types="vite-plus/client" />
import { describe, expect, it } from 'vite-plus/test';

// fallow skips git-ignored files, so this test enforces the import rule for src/generated:
// generated code may import other generated files, src/core, and zod, and nothing else.
const SOURCES: Record<string, string> = import.meta.glob('../src/generated/**/*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
   }),
   IMPORT_PATTERN = /from '([^']+)'/g,
   BASE = 'file:///package/test/';

function getAllowedFolder(specifier: string, file: string): string | undefined {
   if (specifier === 'zod') {
      return 'zod';
   }

   const resolved = new URL(specifier, new URL(file, BASE)).pathname;

   return ['/package/src/generated/', '/package/src/core/'].find((folder) => {
      return resolved.startsWith(folder);
   });
}

function listForbiddenImports(): string[] {
   return Object.entries(SOURCES).flatMap(([file, source]) => {
      return [...source.matchAll(IMPORT_PATTERN)]
         .map((match) => {
            return match[1] ?? '';
         })
         .filter((specifier) => {
            return getAllowedFolder(specifier, file) === undefined;
         })
         .map((specifier) => {
            return `${file}: ${specifier}`;
         });
   });
}

describe('src/generated', () => {
   it('has generated files to check', () => {
      const count = Object.keys(SOURCES).length;

      expect(count).toBeGreaterThan(0);
   });

   it('imports only other generated files, src/core, and zod', () => {
      const forbidden = listForbiddenImports();

      expect(forbidden).toEqual([]);
   });
});
