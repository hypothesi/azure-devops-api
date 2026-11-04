import type { z } from 'zod';
import type { HTTPMethod, RequestBody, SendResult, Transport } from './Transport';

export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

/** The common options for every API method. */
export interface CallOptions {
   readonly signal?: AbortSignal;
   readonly timeoutMs?: number;
}

/** Internal state that the API classes share. */
export interface ClientContext {
   readonly transport: Transport;
   readonly organizationURL: URL;
   readonly searchURL: URL;
   readonly apiVersion: string;
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
   readonly path: readonly (string | number)[];
   readonly query?: QueryParams;
   /** Default: the client's `apiVersion`. */
   readonly apiVersion?: string | undefined;
   readonly body?: RequestBody | undefined;
   readonly schema: z.ZodType<T>;
   readonly idempotent?: boolean | undefined;
   /** Send the request to the search URL instead of the organization URL. */
   readonly search?: boolean;
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

export function callAPI<T>(
   context: ClientContext,
   call: APICall<T>,
   options: CallOptions = {},
): Promise<SendResult<T>> {
   const base = call.search ? context.searchURL : context.organizationURL;

   return context.transport.send({
      method: call.method ?? 'GET',
      url: buildURL(base, call.path, { ...call.query, 'api-version': call.apiVersion ?? context.apiVersion }),
      schema: call.schema,
      body: call.body,
      idempotent: call.idempotent,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
   });
}
