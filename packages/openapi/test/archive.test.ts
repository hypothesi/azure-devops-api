import { describe, expect, it } from 'vite-plus/test';
import { assertDownloadedBlob, parseDirectoryListing, parseMirrorTree } from '../scripts/lib/archive.ts';
import { getGitBlobHash } from '../scripts/lib/git-blob.ts';

const OK = { ok: true, status: 200 },
   NOT_FOUND = { ok: false, status: 404 },
   ENTRY = { path: 'wit/7.1', type: 'tree', sha: 'abc' };

describe('parseDirectoryListing', () => {
   it('returns the entries of a directory listing', () => {
      const body = [
         { name: 'wit', type: 'dir', target: '1a2b', perms: 16384 },
         { name: 'README.md', type: 'file', target: '3c4d' },
      ];

      expect(parseDirectoryListing('root', body)).toEqual([
         { name: 'wit', type: 'dir', target: '1a2b' },
         { name: 'README.md', type: 'file', target: '3c4d' },
      ]);
   });

   it.each([
      ['an object', { name: 'wit' }],
      ['an unknown entry type', [{ name: 'wit', type: 'link', target: '1a2b' }]],
      ['a missing target', [{ name: 'wit', type: 'dir' }]],
   ])('throws for %s', (_, body) => {
      expect(() => {
         return parseDirectoryListing('root', body);
      }).toThrow('Directory root: unexpected response');
   });
});

describe('parseMirrorTree', () => {
   it('keys the tree entries by path', () => {
      const tree = parseMirrorTree(OK, { tree: [ENTRY], truncated: false });

      expect([...tree]).toEqual([['wit/7.1', ENTRY]]);
   });

   it.each([
      ['a failed response', NOT_FOUND, { tree: [ENTRY] }, 'HTTP 404'],
      ['a truncated tree', OK, { tree: [ENTRY], truncated: true }, 'HTTP 200'],
      ['a body without a tree', OK, { message: 'Not Found' }, 'HTTP 200'],
      ['an entry without a sha', OK, { tree: [{ path: 'wit', type: 'tree' }] }, 'HTTP 200'],
   ])('throws for %s', (_, response, body, status) => {
      expect(() => {
         return parseMirrorTree(response, body);
      }).toThrow(`Listing the GitHub copy failed with ${status}`);
   });
});

describe('assertDownloadedBlob', () => {
   const content = Buffer.from('{}\n'),
      sha1Git = getGitBlobHash(content);

   it('accepts content with the expected hash', () => {
      expect(() => {
         assertDownloadedBlob('wit.json', sha1Git, OK, content);
      }).not.toThrow();
   });

   it('throws for a different hash', () => {
      expect(() => {
         assertDownloadedBlob('wit.json', 'abc', OK, content);
      }).toThrow(`wit.json: expected git blob abc, got HTTP 200 and ${sha1Git}`);
   });

   it('throws for a failed response', () => {
      expect(() => {
         assertDownloadedBlob('wit.json', sha1Git, NOT_FOUND, content);
      }).toThrow(`wit.json: expected git blob ${sha1Git}, got HTTP 404 and ${sha1Git}`);
   });
});
