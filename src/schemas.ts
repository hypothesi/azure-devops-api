import { z } from 'zod';

// All object schemas are loose: Azure DevOps adds properties over time, and a new property
// must not make a working client throw. Unknown properties pass through untyped.

export const IdentityRefSchema = z.looseObject({
   displayName: z.string(),
   id: z.string().optional(),
   uniqueName: z.string().optional(),
   url: z.string().optional(),
   imageUrl: z.string().optional(),
   descriptor: z.string().optional(),
});

export type IdentityRef = z.infer<typeof IdentityRefSchema>;

export const WorkItemRelationSchema = z.looseObject({
   rel: z.string(),
   url: z.string(),
   attributes: z.record(z.string(), z.unknown()).optional(),
});

export type WorkItemRelation = z.infer<typeof WorkItemRelationSchema>;

/**
 * Common system fields are typed. Other fields, such as custom fields or
 * `Microsoft.VSTS.TCM.ReproSteps`, are `unknown`. Narrow them with your own Zod schema.
 * Date fields are ISO 8601 strings, as the API returns them.
 */
export const WorkItemFieldsSchema = z.looseObject({
   'System.Id': z.number().optional(),
   'System.Rev': z.number().optional(),
   'System.TeamProject': z.string().optional(),
   'System.AreaPath': z.string().optional(),
   'System.IterationPath': z.string().optional(),
   'System.WorkItemType': z.string().optional(),
   'System.State': z.string().optional(),
   'System.Reason': z.string().optional(),
   'System.Title': z.string().optional(),
   'System.Description': z.string().optional(),
   'System.Tags': z.string().optional(),
   'System.AssignedTo': IdentityRefSchema.optional(),
   'System.CreatedBy': IdentityRefSchema.optional(),
   'System.ChangedBy': IdentityRefSchema.optional(),
   'System.CreatedDate': z.string().optional(),
   'System.ChangedDate': z.string().optional(),
   'System.Parent': z.number().optional(),
});

export const WorkItemSchema = z.looseObject({
   id: z.number(),
   rev: z.number().optional(),
   fields: WorkItemFieldsSchema.optional(),
   relations: z.array(WorkItemRelationSchema).optional(),
   url: z.string(),
});

export type WorkItem = z.infer<typeof WorkItemSchema>;

export const WorkItemBatchSchema = z.looseObject({
   count: z.number(),
   // Missing IDs are null when the request uses errorPolicy "omit".
   value: z.array(WorkItemSchema.nullable()),
});

export const WorkItemReferenceSchema = z.looseObject({
   id: z.number(),
   url: z.string().optional(),
});

export const WiqlResultSchema = z.looseObject({
   queryType: z.string().optional(),
   asOf: z.string().optional(),
   workItems: z.array(WorkItemReferenceSchema).optional(),
   workItemRelations: z
      .array(
         z.looseObject({
            rel: z.string().nullable().optional(),
            source: WorkItemReferenceSchema.nullable().optional(),
            target: WorkItemReferenceSchema,
         }),
      )
      .optional(),
});

export type WiqlResult = z.infer<typeof WiqlResultSchema>;

export const CommentSchema = z.looseObject({
   id: z.number(),
   workItemId: z.number(),
   version: z.number().optional(),
   text: z.string(),
   renderedText: z.string().optional(),
   format: z.string().optional(),
   createdBy: IdentityRefSchema.optional(),
   createdDate: z.string().optional(),
   modifiedBy: IdentityRefSchema.optional(),
   modifiedDate: z.string().optional(),
   isDeleted: z.boolean().optional(),
   url: z.string().optional(),
});

export type Comment = z.infer<typeof CommentSchema>;

export const CommentListSchema = z.looseObject({
   comments: z.array(CommentSchema),
   continuationToken: z.string().nullable().optional(),
   totalCount: z.number().optional(),
});

export const WorkItemSearchResultSchema = z.looseObject({
   project: z.looseObject({ id: z.string().optional(), name: z.string() }).optional(),
   // Search returns field names in lowercase, for example "system.id".
   fields: z.record(z.string(), z.unknown()),
   hits: z.array(z.unknown()).optional(),
   url: z.string().optional(),
});

export type WorkItemSearchResult = z.infer<typeof WorkItemSearchResultSchema>;

export const WorkItemSearchResponseSchema = z.looseObject({
   count: z.number(),
   results: z.array(WorkItemSearchResultSchema),
});

export const AttachmentReferenceSchema = z.looseObject({
   id: z.string(),
   url: z.string(),
});

export type AttachmentReference = z.infer<typeof AttachmentReferenceSchema>;

export const ProjectSchema = z.looseObject({
   id: z.string(),
   name: z.string(),
   description: z.string().optional(),
   url: z.string().optional(),
   state: z.string().optional(),
   revision: z.number().optional(),
   visibility: z.string().optional(),
   lastUpdateTime: z.string().optional(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const IterationSchema = z.looseObject({
   id: z.string(),
   name: z.string(),
   path: z.string(),
   attributes: z
      .looseObject({
         startDate: z.string().nullable().optional(),
         finishDate: z.string().nullable().optional(),
         timeFrame: z.string().optional(),
      })
      .optional(),
   url: z.string().optional(),
});

export type Iteration = z.infer<typeof IterationSchema>;

/** The `{ count, value }` envelope that most Azure DevOps list endpoints return. */
export function listOf<T extends z.ZodType>(
   item: T,
): z.ZodObject<{ count: z.ZodOptional<z.ZodNumber>; value: z.ZodArray<T> }> {
   return z.object({ count: z.number().optional(), value: z.array(item) });
}
