import { z } from 'zod';
import { getGitBlobHash } from './git-blob.ts';

type ResponseStatus = Pick<Response, 'ok' | 'status'>;

const DirectoryEntrySchema = z.object({
      name: z.string(),
      type: z.enum(['dir', 'file', 'rev']),
      target: z.string(),
   }),
   MirrorEntrySchema = z.object({ path: z.string(), type: z.string(), sha: z.string() }),
   MirrorTreeSchema = z.object({ tree: z.array(MirrorEntrySchema), truncated: z.unknown() });

export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;

export type MirrorEntry = z.infer<typeof MirrorEntrySchema>;

/** Parses the body of the Software Heritage `directory` endpoint. */
export function parseDirectoryListing(directoryID: string, body: unknown): DirectoryEntry[] {
   const result = z.array(DirectoryEntrySchema).safeParse(body);

   if (!result.success) {
      throw new Error(`Directory ${directoryID}: unexpected response`);
   }

   return result.data;
}

/**
 * Parses a recursive GitHub tree listing into its entries keyed by path, such as `wit/7.1`.
 * A truncated listing is missing entries, so it is an error.
 */
export function parseMirrorTree(response: ResponseStatus, body: unknown): Map<string, MirrorEntry> {
   const result = MirrorTreeSchema.safeParse(body);

   if (!response.ok || !result.success || result.data.truncated === true) {
      throw new Error(`Listing the GitHub copy failed with HTTP ${response.status}`);
   }

   return new Map(
      result.data.tree.map((entry) => {
         return [entry.path, entry];
      }),
   );
}

/** Throws unless the download succeeded and `content` has the git blob hash `sha1Git`. */
export function assertDownloadedBlob(target: string, sha1Git: string, response: ResponseStatus, content: Buffer): void {
   const hash = getGitBlobHash(content);

   if (!response.ok || hash !== sha1Git) {
      throw new Error(`${target}: expected git blob ${sha1Git}, got HTTP ${response.status} and ${hash}`);
   }
}
