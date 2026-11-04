import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';
import { getGitBlobHash } from '../scripts/lib/git-blob.ts';

interface SourceFile {
   readonly path: string;
   readonly sha1Git: string;
}

const SWAGGER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../source/swagger');

function isSourceFile(value: unknown): value is SourceFile {
   return (
      typeof value === 'object' &&
      value !== null &&
      'path' in value &&
      typeof value.path === 'string' &&
      'sha1Git' in value &&
      typeof value.sha1Git === 'string'
   );
}

function listSourceFiles(): SourceFile[] {
   const value: unknown = JSON.parse(readFileSync(path.join(SWAGGER_DIR, 'files.json'), 'utf8'));

   if (!Array.isArray(value) || !value.every(isSourceFile)) {
      throw new TypeError('files.json is not a list of { path, sha1Git }');
   }

   return value;
}

describe('getGitBlobHash', () => {
   it('matches `git hash-object`', () => {
      expect(getGitBlobHash(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
   });
});

describe('source/swagger', () => {
   it('matches the git blob hash of every file in files.json', () => {
      const mismatches = listSourceFiles()
         .filter((file) => {
            return getGitBlobHash(readFileSync(path.join(SWAGGER_DIR, file.path))) !== file.sha1Git;
         })
         .map((file) => {
            return file.path;
         });

      expect(mismatches).toEqual([]);
   });

   it('has no files that files.json does not list', () => {
      const listed = new Set(
            listSourceFiles().map((file) => {
               return file.path;
            }),
         ),
         local = readdirSync(SWAGGER_DIR, { recursive: true, encoding: 'utf8' }).filter((file) => {
            return file.endsWith('.json') && file !== 'files.json';
         });

      expect(
         local.filter((file) => {
            return !listed.has(file.split(path.sep).join('/'));
         }),
      ).toEqual([]);
   });
});
