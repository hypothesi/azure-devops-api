import { z } from 'zod';
import { InvalidInputError } from './errors';
import type { HTTPMethod, RequestBody, ResponseType, SendResult, Transport } from './Transport';

export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

/** The common options for every API method. */
export interface CallOptions {
   readonly signal?: AbortSignal;
   readonly timeoutMs?: number;
}

/** The API version and server of every operation in one API version. `scripts/generate.ts` writes it. */
export interface OperationTable {
   readonly apiVersion: string;
   /** Server URLs, such as `https://feeds.dev.azure.com/{organization}`. */
   readonly servers: readonly string[];
   /** Keyed by `${method} ${urlTemplate}`. Each value is the `api-version` and an index into `servers`. */
   readonly operations: Readonly<Record<string, readonly [apiVersion: string, server: number]>>;
}

/** Internal state that the API classes share. */
export interface ClientContext {
   readonly transport: Transport;
   readonly organizationURL: URL;
   readonly searchURL: URL;
   readonly table: OperationTable;
   /** The base URL of each entry in `table.servers`, for this client's organization. */
   readonly serverURLs: readonly URL[];
}

/** Appends percent-encoded path segments and query parameters to `base`. */
export function buildURL(base: URL, segments: readonly (string | number)[], query: QueryParams = {}): URL {
   const url = new URL(base),
      path = segments.map((segment) => {
         // `$` is valid in a path segment, and Azure DevOps expects it raw, as in `workitems/$Bug`.
         return encodeURIComponent(String(segment)).replaceAll('%24', '$');
      });

   url.pathname = [url.pathname.replace(/\/+$/, ''), ...path].join('/');

   for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
         url.searchParams.set(key, String(value));
      }
   }

   return url;
}

export interface APICall<T> {
   readonly method?: HTTPMethod;
   /**
    * The `${method} ${urlTemplate}` key of the operation in the client's table. It sets the
    * `api-version` and the server. Without it, the request goes to the organization URL with
    * the client's API version.
    */
   readonly operation?: string;
   readonly path: readonly (string | number)[];
   readonly query?: QueryParams;
   /** Default: the operation's API version, or the client's API version. */
   readonly apiVersion?: string | undefined;
   readonly body?: RequestBody | undefined;
   readonly headers?: Readonly<Record<string, string>> | undefined;
   readonly schema: z.ZodType<T>;
   readonly responseType?: ResponseType | undefined;
   readonly idempotent?: boolean | undefined;
}

export interface Page<T, C> {
   readonly items: readonly T[];
   /** The cursor for the next page, or `undefined` on the last page. */
   readonly next: C | undefined;
}

/**
 * Yields the items of every page, in order. It requests a page only after the caller
 * consumes the previous one, so pages never run in parallel and an early `break` stops the
 * requests.
 */
export async function* paginate<T, C>(getPage: (cursor: C | undefined) => Promise<Page<T, C>>): AsyncGenerator<T> {
   for await (const page of listPages(getPage)) {
      yield* page.items;
   }
}

function listPages<T, C>(getPage: (cursor: C | undefined) => Promise<Page<T, C>>): AsyncIterable<Page<T, C>> {
   return {
      [Symbol.asyncIterator]: (): AsyncIterator<Page<T, C>> => {
         let cursor: C | undefined,
            isDone = false;

         return {
            next: async (): Promise<IteratorResult<Page<T, C>>> => {
               if (isDone) {
                  return { done: true, value: undefined };
               }

               const page = await getPage(cursor);

               cursor = page.next;
               isDone = page.next === undefined;

               return { done: false, value: page };
            },
         };
      },
   };
}

/**
 * The specs declare list responses as arrays, but Azure DevOps wraps them in
 * `{ count, value }`. The returned schema accepts both and returns the array.
 */
function acceptCollection<T>(schema: z.ZodType<T>): z.ZodType<T> {
   if (!isArraySchema(schema)) {
      return schema;
   }

   return z.union([
      schema,
      z.looseObject({ value: schema }).transform(({ value }) => {
         return value;
      }),
   ]);
}

// Returns a boolean, not a type predicate, so `schema` keeps its output type `T`.
function isArraySchema(schema: z.ZodType): boolean {
   return schema instanceof z.ZodArray;
}

/** @throws {InvalidInputError} when the operation is not part of the client's API version. */
function getOperation(context: ClientContext, key: string): { apiVersion: string; base: URL } {
   const entry = context.table.operations[key],
      base = entry === undefined ? undefined : context.serverURLs[entry[1]];

   if (entry === undefined || base === undefined) {
      throw new InvalidInputError(`${key} is not part of Azure DevOps REST API ${context.table.apiVersion}`);
   }

   return { apiVersion: entry[0], base };
}

export async function callAPI<T>(
   context: ClientContext,
   call: APICall<T>,
   options: CallOptions = {},
): Promise<SendResult<T>> {
   const { apiVersion, base } =
      call.operation === undefined
         ? { apiVersion: context.table.apiVersion, base: context.organizationURL }
         : getOperation(context, call.operation);

   return context.transport.send({
      method: call.method ?? 'GET',
      url: buildURL(base, call.path, { ...call.query, 'api-version': call.apiVersion ?? apiVersion }),
      schema: acceptCollection(call.schema),
      responseType: call.responseType,
      body: call.body,
      headers: call.headers,
      idempotent: call.idempotent,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
   });
}
