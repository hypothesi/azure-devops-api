/**
 * Downloads Microsoft's archived Azure DevOps Swagger 2.0 files from the Software Heritage
 * snapshot into `source/swagger/{apiVersion}/{area}/`.
 *
 * Every file is checked against its git blob hash from the archive, so the copy in git is
 * byte-identical to the snapshot. Files that are already present with the right hash are
 * skipped, so an interrupted run can be restarted.
 *
 * The archive allows few requests per hour, so files come from a GitHub copy of the same
 * repository when possible. Software Heritage directory IDs are git tree hashes, so a
 * version folder whose tree hash in the copy equals its archive ID has byte-identical
 * files. Only those folders come from the copy, and each file is still checked against its
 * blob hash. The archive stays the source of truth: it gives every folder ID and every
 * file that the copy does not have.
 *
 * Usage: node scripts/fetch.ts
 */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGitBlobHash } from './lib/git-blob.ts';
import { API_VERSIONS, SNAPSHOT } from './snapshot.ts';

interface DirectoryEntry {
   readonly name: string;
   readonly type: 'dir' | 'file' | 'rev';
   readonly target: string;
}

interface SourceFile {
   readonly path: string;
   readonly sha1Git: string;
}

interface MirrorEntry {
   readonly path: string;
   readonly type: string;
   readonly sha: string;
}

const ARCHIVE_API = 'https://archive.softwareheritage.org/api/1',
   /** MIT-licensed copy of MicrosoftDocs/vsts-rest-api-specs, last pushed 2023-07-13. */
   MIRROR_REPOSITORY = 'Mechanic4252/version_compatibility',
   /** The git tree of `specification` in the copy. */
   MIRROR_SPECIFICATION_TREE = '1a68ccd4120504091c092a40c794e630636db2ed',
   MS_PER_SECOND = 1000,
   HTTP_TOO_MANY_REQUESTS = 429,
   PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
   SWAGGER_DIR = path.join(PACKAGE_DIR, 'source', 'swagger');

function sleep(ms: number): Promise<void> {
   return new Promise((resolve) => {
      setTimeout(resolve, ms);
   });
}

/** Waits for the archive's rate limit to reset when the current window is used up. */
async function waitForRateLimit(response: Response): Promise<void> {
   const remaining = Number(response.headers.get('X-RateLimit-Remaining') ?? '1'),
      reset = Number(response.headers.get('X-RateLimit-Reset') ?? '0');

   if (remaining > 0) {
      return;
   }

   const waitMs = Math.max(0, reset * MS_PER_SECOND - Date.now()) + MS_PER_SECOND;

   console.log(`Rate limit reached. Waiting ${Math.round(waitMs / MS_PER_SECOND)} s.`);
   await sleep(waitMs);
}

async function request(url: string): Promise<Response> {
   const response = await fetch(url);

   if (response.status === HTTP_TOO_MANY_REQUESTS) {
      const retryAfterSeconds = Number(response.headers.get('Retry-After') ?? '60');

      console.log(`HTTP 429. Waiting ${retryAfterSeconds} s.`);
      await sleep(retryAfterSeconds * MS_PER_SECOND);

      return request(url);
   }

   if (!response.ok) {
      throw new Error(`GET ${url} failed with HTTP ${response.status}`);
   }

   await waitForRateLimit(response);

   return response;
}

function isDirectoryEntry(value: unknown): value is DirectoryEntry {
   return (
      typeof value === 'object' &&
      value !== null &&
      'name' in value &&
      typeof value.name === 'string' &&
      'type' in value &&
      (value.type === 'dir' || value.type === 'file' || value.type === 'rev') &&
      'target' in value &&
      typeof value.target === 'string'
   );
}

async function listDirectory(directoryID: string): Promise<DirectoryEntry[]> {
   const response = await request(`${ARCHIVE_API}/directory/${directoryID}/`),
      entries: unknown = await response.json();

   if (!Array.isArray(entries) || !entries.every(isDirectoryEntry)) {
      throw new Error(`Directory ${directoryID}: unexpected response`);
   }

   return entries;
}

function isMirrorEntry(value: unknown): value is MirrorEntry {
   return (
      typeof value === 'object' &&
      value !== null &&
      'path' in value &&
      typeof value.path === 'string' &&
      'type' in value &&
      typeof value.type === 'string' &&
      'sha' in value &&
      typeof value.sha === 'string'
   );
}

/** Every tree and blob under `specification` in the copy, keyed by path such as `wit/7.1`. */
async function listMirror(): Promise<Map<string, MirrorEntry>> {
   const response = await fetch(
         `https://api.github.com/repos/${MIRROR_REPOSITORY}/git/trees/${MIRROR_SPECIFICATION_TREE}?recursive=1`,
      ),
      body: unknown = await response.json();

   if (
      !response.ok ||
      typeof body !== 'object' ||
      body === null ||
      !('tree' in body) ||
      !Array.isArray(body.tree) ||
      !body.tree.every(isMirrorEntry) ||
      ('truncated' in body && body.truncated === true)
   ) {
      throw new Error(`Listing the GitHub copy failed with HTTP ${response.status}`);
   }

   return new Map(
      body.tree.map((entry) => {
         return [entry.path, entry];
      }),
   );
}

async function download(url: string, sha1Git: string, target: string): Promise<void> {
   if (existsSync(target) && getGitBlobHash(readFileSync(target)) === sha1Git) {
      return;
   }

   const response = url.startsWith(ARCHIVE_API) ? await request(url) : await fetch(url),
      content = Buffer.from(await response.arrayBuffer()),
      hash = getGitBlobHash(content);

   if (!response.ok || hash !== sha1Git) {
      throw new Error(`${target}: expected git blob ${sha1Git}, got HTTP ${response.status} and ${hash}`);
   }

   mkdirSync(path.dirname(target), { recursive: true });
   writeFileSync(target, content);
   console.log(`Saved ${path.relative(PACKAGE_DIR, target)}`);
}

/** The `.json` files of a version folder, from the copy when its tree hash matches the archive. */
async function listVersionFolder(
   area: string,
   version: DirectoryEntry,
   mirror: ReadonlyMap<string, MirrorEntry>,
): Promise<{ files: { name: string; sha1Git: string; url: string }[]; isMirrored: boolean }> {
   const folder = `${area}/${version.name}`;

   if (mirror.get(folder)?.sha === version.target) {
      const files = [...mirror.values()]
         .filter((entry) => {
            return entry.type === 'blob' && path.posix.dirname(entry.path) === folder && entry.path.endsWith('.json');
         })
         .map((entry) => {
            return {
               name: path.posix.basename(entry.path),
               sha1Git: entry.sha,
               url: `https://raw.githubusercontent.com/${MIRROR_REPOSITORY}/main/specification/${entry.path}`,
            };
         });

      return { files, isMirrored: true };
   }

   const files = (await listDirectory(version.target))
      .filter((entry) => {
         return entry.type === 'file' && entry.name.endsWith('.json');
      })
      .map((entry) => {
         return {
            name: entry.name,
            sha1Git: entry.target,
            url: `${ARCHIVE_API}/content/sha1_git:${entry.target}/raw/`,
         };
      });

   return { files, isMirrored: false };
}

async function fetchVersionFolder(
   area: string,
   version: DirectoryEntry,
   mirror: ReadonlyMap<string, MirrorEntry>,
): Promise<SourceFile[]> {
   const { files, isMirrored } = await listVersionFolder(area, version, mirror);

   console.log(`${area}/${version.name}: ${files.length} files from ${isMirrored ? 'the GitHub copy' : 'the archive'}`);

   await mapInSequence(files, (file) => {
      return download(file.url, file.sha1Git, path.join(SWAGGER_DIR, version.name, area, file.name));
   });

   return files.map((file) => {
      return { path: `${version.name}/${area}/${file.name}`, sha1Git: file.sha1Git };
   });
}

/**
 * Runs `task` on each item in order, and starts each task only after the previous one ends.
 * The archive rate-limits requests, so every request in this file runs one at a time.
 */
function mapInSequence<T, R>(items: readonly T[], task: (item: T) => Promise<R>): Promise<R[]> {
   return items.reduce<Promise<R[]>>(async (memo, item) => {
      const results = await memo;

      return [...results, await task(item)];
   }, Promise.resolve([]));
}

async function fetchArea(area: DirectoryEntry, mirror: ReadonlyMap<string, MirrorEntry>): Promise<SourceFile[]> {
   const versions = (await listDirectory(area.target)).filter((entry) => {
         return entry.type === 'dir' && API_VERSIONS.includes(entry.name);
      }),
      perVersion = await mapInSequence(versions, (version) => {
         return fetchVersionFolder(area.name, version, mirror);
      });

   return perVersion.flat();
}

async function main(): Promise<void> {
   const areas = (await listDirectory(SNAPSHOT.specificationDirectory)).filter((entry) => {
         return entry.type === 'dir';
      }),
      mirror = await listMirror(),
      perArea = await mapInSequence(areas, (area) => {
         return fetchArea(area, mirror);
      }),
      sourceFiles = perArea.flat();

   const sorted = sourceFiles.toSorted((a, b) => {
      return a.path.localeCompare(b.path);
   });

   writeFileSync(path.join(SWAGGER_DIR, 'files.json'), `${JSON.stringify(sorted, null, 3)}\n`);
   console.log(`Done: ${sourceFiles.length} files from ${areas.length} areas.`);
}

await main();
