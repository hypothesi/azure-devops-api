import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

/** The git blob hash of a file, which Software Heritage uses as the file ID. */
export function getGitBlobHash(content: Buffer): string {
   return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

/** Whether `file` exists and its git blob hash is `sha1Git`. */
export function hasGitBlob(file: string, sha1Git: string): boolean {
   return existsSync(file) && getGitBlobHash(readFileSync(file)) === sha1Git;
}
