import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vite-plus/test';
import { getGitBlobHash, hasGitBlob } from '../scripts/lib/git-blob.ts';

/** `git hash-object` of an empty file. */
const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';

describe('getGitBlobHash', () => {
   it('matches git hash-object', () => {
      expect(getGitBlobHash(Buffer.from(''))).toBe(EMPTY_BLOB);
   });
});

describe('hasGitBlob', () => {
   const directory = mkdtempSync(path.join(tmpdir(), 'git-blob-')),
      file = path.join(directory, 'empty.json');

   writeFileSync(file, '');

   afterAll(() => {
      rmSync(directory, { recursive: true, force: true });
   });

   it('is true for a file with the hash', () => {
      expect(hasGitBlob(file, EMPTY_BLOB)).toBe(true);
   });

   it('is false for a file with another hash', () => {
      expect(hasGitBlob(file, 'abc')).toBe(false);
   });

   it('is false for a missing file', () => {
      expect(hasGitBlob(path.join(directory, 'missing.json'), EMPTY_BLOB)).toBe(false);
   });
});
