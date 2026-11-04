import { createHash } from 'node:crypto';

/** The git blob hash of a file, which Software Heritage uses as the file ID. */
export function getGitBlobHash(content: Buffer): string {
   return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}
