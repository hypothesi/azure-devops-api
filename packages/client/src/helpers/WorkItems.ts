import { z } from 'zod';
import { buildURL, callAPI, type CallOptions, type ClientContext, paginate, type QueryParams } from '../core/context';
import { InvalidInputError } from '../core/errors';
import { workItemSearchResponseSchema } from '../generated/search/7.0/zod';
import {
   attachmentReferenceSchema,
   commentListSchema,
   commentSchema,
   workItemQueryResultSchema,
   workItemSchema,
} from '../generated/wit/7.0/zod';

// The helpers return what the Zod schemas parse. Under `exactOptionalPropertyTypes`, those
// types differ from the generated TypeScript types in `| undefined` on optional properties.
type WorkItem = z.infer<typeof workItemSchema>;
type WorkItemQueryResult = z.infer<typeof workItemQueryResultSchema>;
type Comment = z.infer<typeof commentSchema>;
type AttachmentReference = z.infer<typeof attachmentReferenceSchema>;
type WorkItemSearchResult = NonNullable<z.infer<typeof workItemSearchResponseSchema>['results']>[number];

export type WorkItemExpand = 'none' | 'relations' | 'fields' | 'links' | 'all';

export interface GetWorkItemOptions extends CallOptions {
   /** Field reference names to return. Azure DevOps rejects `fields` together with `expand`. */
   readonly fields?: readonly string[];
   readonly expand?: WorkItemExpand;
   /** Return the work item as it was at this time. */
   readonly asOf?: Date;
}

export interface ListWorkItemsOptions extends GetWorkItemOptions {
   /**
    * `fail` (the default) makes the request fail when any ID does not exist. `omit` leaves
    * missing work items out of the result.
    */
   readonly errorPolicy?: 'fail' | 'omit';
}

export interface JsonPatchOperation {
   readonly op: 'add' | 'remove' | 'replace' | 'test' | 'copy' | 'move';
   readonly path: string;
   readonly value?: unknown;
   readonly from?: string;
}

export type RelationInput =
   | { readonly rel: string; readonly workItemID: number; readonly comment?: string }
   | { readonly rel: string; readonly url: string; readonly comment?: string };

export interface WorkItemChanges {
   /** Values by field reference name, for example `{ 'System.Title': 'Fix login' }`. */
   readonly fields?: Readonly<Record<string, unknown>>;
   /**
    * Multiline text fields to store as Markdown instead of HTML, for example
    * `['System.Description']`. Azure DevOps strips text that looks like an HTML tag, such as
    * `<name>`, even inside code spans. Write placeholders as `{name}`.
    */
   readonly markdownFields?: readonly string[];
   /** Links to add. Use `System.LinkTypes.Hierarchy-Reverse` with a `workItemID` to set the parent. */
   readonly relations?: readonly RelationInput[];
   /** Extra JSON Patch operations, sent after the ones built from the other options. */
   readonly operations?: readonly JsonPatchOperation[];
}

export interface WriteWorkItemOptions extends CallOptions {
   /** Check the changes without saving them. */
   readonly validateOnly?: boolean;
   /** Skip work item type rules. Requires the "Bypass rules on work item updates" permission. */
   readonly bypassRules?: boolean;
   readonly suppressNotifications?: boolean;
   readonly expand?: WorkItemExpand;
}

export interface CreateWorkItemInput extends WorkItemChanges, WriteWorkItemOptions {
   readonly project: string;
   /** The work item type name, for example `Bug` or `User Story`. */
   readonly type: string;
}

export interface UpdateWorkItemInput extends WorkItemChanges, WriteWorkItemOptions {
   readonly removeFields?: readonly string[];
   /**
    * The revision that the caller last read. Azure DevOps rejects the update when the work
    * item has a different revision, so the caller does not overwrite another change.
    */
   readonly expectedRevision?: number;
}

export interface QueryOptions extends CallOptions {
   /** Required when the query uses `@project` or project-scoped macros. */
   readonly project?: string;
   readonly team?: string;
   /** The maximum number of results. Azure DevOps returns at most 20,000. */
   readonly top?: number;
}

export interface SearchOptions extends CallOptions {
   readonly project?: string;
   /** Extra search filters, for example `{ 'System.WorkItemType': ['Bug'] }`. */
   readonly filters?: Readonly<Record<string, readonly string[]>>;
   /** Results per request. Default: `100`. */
   readonly pageSize?: number;
}

export interface CommentOptions extends CallOptions {
   /**
    * Default: `markdown` where the API version has the `format` parameter (7.1), otherwise
    * none. API version 7.0 has no `format` parameter, so passing one throws `InvalidInputError`.
    */
   readonly format?: 'markdown' | 'html';
}

export interface UploadAttachmentInput extends CallOptions {
   readonly fileName: string;
   readonly content: Blob | ArrayBuffer | Uint8Array<ArrayBuffer>;
   readonly project?: string;
}

/** The workitemsbatch endpoint accepts at most 200 IDs per request. */
const BATCH_SIZE = 200,
   DEFAULT_SEARCH_PAGE_SIZE = 100,
   COMMENTS_PAGE_SIZE = 200,
   JSON_PATCH = 'application/json-patch+json',
   // The spec does not allow `null` items, but Azure DevOps sends them for missing IDs with errorPolicy "omit".
   WorkItemBatchSchema = z.looseObject({ value: z.array(workItemSchema.nullable()) });

/**
 * The operations that the helpers call, as keys of the client's operation table. The spec
 * puts `{project}` in every path, but Azure DevOps also accepts the paths without a project.
 */
export const WORK_ITEM_OPERATIONS = {
   get: 'GET /{project}/_apis/wit/workitems/{id}',
   list: 'POST /{project}/_apis/wit/workitemsbatch',
   create: 'POST /{project}/_apis/wit/workitems/${type}',
   update: 'PATCH /{project}/_apis/wit/workitems/{id}',
   delete: 'DELETE /{project}/_apis/wit/workitems/{id}',
   query: 'POST /{project}/{team}/_apis/wit/wiql',
   search: 'POST /{project}/_apis/search/workitemsearchresults',
   // The spec's `?` key is the paged list, with `$top`, `continuationToken`, and `order`.
   listComments: 'GET /{project}/_apis/wit/workItems/{workItemId}/comments?',
   addComment: 'POST /{project}/_apis/wit/workItems/{workItemId}/comments',
   updateComment: 'PATCH /{project}/_apis/wit/workItems/{workItemId}/comments/{commentId}',
   deleteComment: 'DELETE /{project}/_apis/wit/workItems/{workItemId}/comments/{commentId}',
   uploadAttachment: 'POST /{project}/_apis/wit/attachments',
} as const;

/** The comment operations with a `format` query parameter. Only some API versions have them. */
export const COMMENT_FORMAT_OPERATIONS = {
   addComment: 'POST /{project}/_apis/wit/workItems/{workItemId}/comments?format={format}',
   updateComment: 'PATCH /{project}/_apis/wit/workItems/{workItemId}/comments/{commentId}?format={format}',
} as const;

/** Work item tracking: work items, WIQL queries, search, comments, and attachments. */
export class WorkItems {
   public constructor(private readonly context: ClientContext) {}

   /** @throws {NotFoundError} when the work item does not exist or the caller cannot see it. */
   public async get(id: number, options: GetWorkItemOptions = {}): Promise<WorkItem> {
      assertID(id);
      assertFieldsOrExpand(options);

      const { data } = await callAPI(
         this.context,
         {
            operation: WORK_ITEM_OPERATIONS.get,
            path: ['_apis', 'wit', 'workitems', id],
            query: {
               fields: options.fields?.join(','),
               $expand: options.expand,
               asOf: options.asOf?.toISOString(),
            },
            schema: workItemSchema,
         },
         options,
      );

      return data;
   }

   /** Gets many work items. Splits the IDs into requests of 200 and keeps their order. */
   public async list(ids: readonly number[], options: ListWorkItemsOptions = {}): Promise<WorkItem[]> {
      ids.forEach(assertID);
      assertFieldsOrExpand(options);

      if (ids.length === 0) {
         return [];
      }

      // Batches run one at a time, so a long ID list does not send a burst that hits the rate limit.
      const batches = paginate(async (start: number = 0) => {
         const end = start + BATCH_SIZE,
            { data } = await callAPI(
               this.context,
               {
                  method: 'POST',
                  operation: WORK_ITEM_OPERATIONS.list,
                  path: ['_apis', 'wit', 'workitemsbatch'],
                  body: {
                     json: {
                        ids: ids.slice(start, end),
                        fields: options.fields,
                        $expand: options.expand,
                        asOf: options.asOf?.toISOString(),
                        errorPolicy: options.errorPolicy,
                     },
                  },
                  schema: WorkItemBatchSchema,
                  idempotent: true,
               },
               options,
            );

         return { items: data.value, next: end < ids.length ? end : undefined };
      });

      return (await Array.fromAsync(batches)).filter((workItem) => {
         return workItem !== null;
      });
   }

   public async create(input: CreateWorkItemInput): Promise<WorkItem> {
      const operations = this.toPatch(input);

      if (operations.length === 0) {
         throw new InvalidInputError('create needs at least one field, relation, or operation');
      }

      const { data } = await callAPI(
         this.context,
         {
            method: 'POST',
            operation: WORK_ITEM_OPERATIONS.create,
            path: [input.project, '_apis', 'wit', 'workitems', `$${input.type}`],
            query: getWriteQuery(input),
            body: { json: operations, contentType: JSON_PATCH },
            schema: workItemSchema,
         },
         input,
      );

      return data;
   }

   /** @throws {InvalidInputError} when the input contains no changes. */
   public async update(id: number, input: UpdateWorkItemInput): Promise<WorkItem> {
      const revisionCheck: JsonPatchOperation[] =
            input.expectedRevision === undefined ? [] : [{ op: 'test', path: '/rev', value: input.expectedRevision }],
         removals = (input.removeFields ?? []).map((field): JsonPatchOperation => {
            return { op: 'remove', path: fieldPath(field) };
         }),
         changes = [...removals, ...this.toPatch(input)];

      assertID(id);

      if (changes.length === 0) {
         throw new InvalidInputError('update needs at least one change');
      }

      const { data } = await callAPI(
         this.context,
         {
            method: 'PATCH',
            operation: WORK_ITEM_OPERATIONS.update,
            path: ['_apis', 'wit', 'workitems', id],
            query: getWriteQuery(input),
            body: { json: [...revisionCheck, ...changes], contentType: JSON_PATCH },
            schema: workItemSchema,
         },
         input,
      );

      return data;
   }

   /**
    * Moves the work item to the recycle bin, or deletes it for good with `destroy: true`.
    * A retry after a lost response can fail with `NotFoundError` because the first attempt
    * already deleted the work item.
    */
   public async delete(id: number, options: CallOptions & { readonly destroy?: boolean } = {}): Promise<void> {
      assertID(id);

      await callAPI(
         this.context,
         {
            method: 'DELETE',
            operation: WORK_ITEM_OPERATIONS.delete,
            path: ['_apis', 'wit', 'workitems', id],
            query: { destroy: options.destroy },
            schema: z.unknown(),
         },
         options,
      );
   }

   /** Runs a WIQL query. The result has work item IDs only. Use `queryWorkItems` to get the work items. */
   public async query(wiql: string, options: QueryOptions = {}): Promise<WorkItemQueryResult> {
      const scope = [options.project, options.team].filter((segment) => {
         return segment !== undefined;
      });

      if (options.team !== undefined && options.project === undefined) {
         throw new InvalidInputError('query needs a project when it has a team');
      }

      const { data } = await callAPI(
         this.context,
         {
            method: 'POST',
            operation: WORK_ITEM_OPERATIONS.query,
            path: [...scope, '_apis', 'wit', 'wiql'],
            query: { $top: options.top },
            body: { json: { query: wiql } },
            schema: workItemQueryResultSchema,
            idempotent: true,
         },
         options,
      );

      return data;
   }

   /** Runs a WIQL query and gets the matching work items, in the query's order. */
   public async queryWorkItems(wiql: string, options: QueryOptions & ListWorkItemsOptions = {}): Promise<WorkItem[]> {
      const result = await this.query(wiql, options),
         ids = (result.workItems ?? []).flatMap((reference) => {
            return reference.id === undefined || reference.id === null ? [] : [reference.id];
         });

      return this.list(ids, options);
   }

   /**
    * Full-text work item search. Yields every result, one page at a time.
    *
    * @example
    * ```ts
    * for await (const result of client.workItems.search('login bug', { project: 'Web' })) {
    *    console.log(result.fields['system.title']);
    * }
    * ```
    */
   public search(text: string, options: SearchOptions = {}): AsyncGenerator<WorkItemSearchResult> {
      const top = options.pageSize ?? DEFAULT_SEARCH_PAGE_SIZE,
         filters = options.project ? { ...options.filters, 'System.TeamProject': [options.project] } : options.filters;

      return paginate(async (skip: number = 0) => {
         const { data } = await callAPI(
               this.context,
               {
                  method: 'POST',
                  operation: WORK_ITEM_OPERATIONS.search,
                  path: ['_apis', 'search', 'workitemsearchresults'],
                  body: { json: { searchText: text, $skip: skip, $top: top, filters, includeFacets: false } },
                  schema: workItemSearchResponseSchema,
                  idempotent: true,
               },
               options,
            ),
            results = data.results ?? [],
            isLastPage = results.length < top || skip + top >= (data.count ?? 0);

         return { items: results, next: isLastPage ? undefined : skip + top };
      });
   }

   /** Yields every comment on a work item, oldest first. */
   public listComments(project: string, workItemID: number, options: CallOptions = {}): AsyncGenerator<Comment> {
      return paginate(async (continuationToken: string | undefined) => {
         assertID(workItemID);

         const { data } = await callAPI(
            this.context,
            {
               operation: WORK_ITEM_OPERATIONS.listComments,
               path: [project, '_apis', 'wit', 'workItems', workItemID, 'comments'],
               query: { $top: COMMENTS_PAGE_SIZE, order: 'asc', continuationToken },
               schema: commentListSchema,
            },
            options,
         );

         return { items: data.comments ?? [], next: data.continuationToken ?? undefined };
      });
   }

   public async addComment(
      project: string,
      workItemID: number,
      text: string,
      options: CommentOptions = {},
   ): Promise<Comment> {
      assertID(workItemID);

      const { data } = await callAPI(
         this.context,
         {
            method: 'POST',
            ...this.getFormatCall(
               WORK_ITEM_OPERATIONS.addComment,
               COMMENT_FORMAT_OPERATIONS.addComment,
               options.format,
            ),
            path: [project, '_apis', 'wit', 'workItems', workItemID, 'comments'],
            body: { json: { text } },
            schema: commentSchema,
         },
         options,
      );

      return data;
   }

   public async updateComment(
      project: string,
      workItemID: number,
      commentID: number,
      text: string,
      options: CommentOptions = {},
   ): Promise<Comment> {
      assertID(workItemID);
      assertID(commentID);

      const { data } = await callAPI(
         this.context,
         {
            method: 'PATCH',
            ...this.getFormatCall(
               WORK_ITEM_OPERATIONS.updateComment,
               COMMENT_FORMAT_OPERATIONS.updateComment,
               options.format,
            ),
            path: [project, '_apis', 'wit', 'workItems', workItemID, 'comments', commentID],
            body: { json: { text } },
            schema: commentSchema,
            // Setting the same text twice gives the same result.
            idempotent: true,
         },
         options,
      );

      return data;
   }

   public async deleteComment(
      project: string,
      workItemID: number,
      commentID: number,
      options: CallOptions = {},
   ): Promise<void> {
      assertID(workItemID);
      assertID(commentID);

      await callAPI(
         this.context,
         {
            method: 'DELETE',
            operation: WORK_ITEM_OPERATIONS.deleteComment,
            path: [project, '_apis', 'wit', 'workItems', workItemID, 'comments', commentID],
            schema: z.unknown(),
         },
         options,
      );
   }

   /**
    * Uploads a file. To attach it to a work item, pass the returned `url` as a relation:
    * `update(id, { relations: [{ rel: 'AttachedFile', url }] })`.
    */
   public async uploadAttachment(input: UploadAttachmentInput): Promise<AttachmentReference> {
      // ponytail: single-request upload only. Add chunked upload when files above 130 MB matter.
      const scope = input.project === undefined ? [] : [input.project];

      if (input.fileName.trim() === '') {
         throw new InvalidInputError('fileName must not be empty');
      }

      const { data } = await callAPI(
         this.context,
         {
            method: 'POST',
            operation: WORK_ITEM_OPERATIONS.uploadAttachment,
            path: [...scope, '_apis', 'wit', 'attachments'],
            query: { fileName: input.fileName, uploadType: 'Simple' },
            body: { binary: input.content },
            schema: attachmentReferenceSchema,
         },
         input,
      );

      return data;
   }

   /** The API URL of a work item, as relations use it. */
   public getURL(id: number): string {
      assertID(id);

      return buildURL(this.context.organizationURL, ['_apis', 'wit', 'workItems', id]).toString();
   }

   /**
    * Picks the operation with a `format` parameter when the client's API version has it.
    *
    * @throws {InvalidInputError} when the caller passes `format` and the API version has no such parameter.
    */
   private getFormatCall(
      operation: string,
      formatOperation: string,
      format: CommentOptions['format'],
   ): { operation: string; query: QueryParams } {
      if (this.context.table.operations[formatOperation] !== undefined) {
         return { operation: formatOperation, query: { format: format ?? 'markdown' } };
      }

      if (format !== undefined) {
         throw new InvalidInputError(
            `Azure DevOps REST API ${this.context.table.apiVersion} has no format parameter for comments`,
         );
      }

      return { operation, query: {} };
   }

   private toPatch(changes: WorkItemChanges): JsonPatchOperation[] {
      const fields = Object.entries(changes.fields ?? {}).map(([field, value]): JsonPatchOperation => {
            return { op: 'add', path: fieldPath(field), value };
         }),
         markdown = (changes.markdownFields ?? []).map((field): JsonPatchOperation => {
            return { op: 'add', path: `/multilineFieldsFormat/${escapePointer(field)}`, value: 'Markdown' };
         }),
         relations = (changes.relations ?? []).map((relation): JsonPatchOperation => {
            const url = 'url' in relation ? relation.url : this.getURL(relation.workItemID),
               attributes = relation.comment === undefined ? undefined : { comment: relation.comment };

            return { op: 'add', path: '/relations/-', value: { rel: relation.rel, url, attributes } };
         });

      return [...fields, ...markdown, ...relations, ...(changes.operations ?? [])];
   }
}

function getWriteQuery(options: WriteWorkItemOptions): Record<string, string | boolean | undefined> {
   return {
      validateOnly: options.validateOnly,
      bypassRules: options.bypassRules,
      suppressNotifications: options.suppressNotifications,
      $expand: options.expand,
   };
}

/** Escapes a JSON Pointer segment as RFC 6901 requires. */
function escapePointer(segment: string): string {
   return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function fieldPath(field: string): string {
   return `/fields/${escapePointer(field)}`;
}

function assertID(id: number): void {
   if (!Number.isSafeInteger(id) || id <= 0) {
      throw new InvalidInputError(`ID must be a positive integer, got ${id}`);
   }
}

function assertFieldsOrExpand(options: GetWorkItemOptions): void {
   if (options.fields !== undefined && options.expand !== undefined && options.expand !== 'none') {
      throw new InvalidInputError('Azure DevOps does not accept fields and expand together. Pass one of them.');
   }
}
