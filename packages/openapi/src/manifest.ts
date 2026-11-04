import { z } from 'zod';

/**
 * How an area's contract changed from the previous supported API version. Version strings,
 * descriptions, and examples are ignored.
 *
 * * `identical`: same operations, parameters, request bodies, and schemas.
 * * `additive`: only new operations, new optional properties, new optional parameters, or
 *   new enum values.
 * * `breaking`: removed operations or properties, changed types, or new required inputs.
 */
export const ChangeKindSchema = z.enum(['identical', 'additive', 'breaking']);

export type ChangeKind = z.infer<typeof ChangeKindSchema>;

export const AreaVersionSchema = z.object({
   /** Path of the OpenAPI 3.2 file, relative to the package root. */
   file: z.string(),
   operations: z.number().int().nonnegative(),
   previewOperations: z.number().int().nonnegative(),
   /** SHA-256 of the published file. */
   sha256: z.string().regex(/^[0-9a-f]{64}$/),
   comparedToPrevious: z
      .object({
         apiVersion: z.string(),
         change: ChangeKindSchema,
         addedOperations: z.array(z.string()),
         removedOperations: z.array(z.string()),
         /** One line per breaking or additive change, for example `schema GitStatus: property state changed`. */
         changes: z.array(z.string()),
      })
      .optional(),
});

export type AreaVersion = z.infer<typeof AreaVersionSchema>;

export const ProductSchema = z.object({
   name: z.string(),
   /** The highest API version the product accepts. Every product also accepts all lower versions. */
   highestApiVersion: z.string(),
   /** Where `highestApiVersion` comes from. */
   source: z.string(),
   /** ISO date of a test against a real instance, or `null` when nobody has tested it. */
   verifiedOn: z.string().nullable(),
});

export type Product = z.infer<typeof ProductSchema>;

export const ManifestSchema = z.object({
   source: z.object({
      repository: z.string(),
      license: z.string(),
      snapshot: z.string(),
      revision: z.string(),
      specificationDirectory: z.string(),
   }),
   openapiVersion: z.string(),
   apiVersions: z.record(
      z.string(),
      z.object({
         status: z.enum(['released']),
         /** Keys of `products` whose `highestApiVersion` is at least this version. */
         products: z.array(z.string()),
      }),
   ),
   products: z.record(z.string(), ProductSchema),
   /** Keyed by area folder name, for example `wit` or `git`. */
   areas: z.record(z.string(), z.object({ title: z.string(), versions: z.record(z.string(), AreaVersionSchema) })),
});

export type Manifest = z.infer<typeof ManifestSchema>;
