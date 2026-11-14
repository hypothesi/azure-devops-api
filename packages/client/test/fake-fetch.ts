import { type AzureDevOpsClient, type AzureDevOpsClientOptions, createClient } from '../src/entries/7.1';

export type Responder = (request: Request) => Response | Promise<Response>;

export interface FakeClient {
   readonly client: AzureDevOpsClient;
   /** Every request that the client sent, in order. */
   readonly requests: Request[];
}

/** Answers each request with the next responder. Throws when no responder is left. */
export function createFakeFetch(responders: readonly Responder[]): { fetch: typeof fetch; requests: Request[] } {
   const queue = [...responders],
      requests: Request[] = [];

   async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request = new Request(input, init),
         responder = queue.shift();

      // Real fetch rejects at once when the signal is already aborted.
      request.signal.throwIfAborted();
      requests.push(request.clone());

      if (!responder) {
         throw new Error(`Unexpected request: ${request.method} ${request.url}`);
      }

      return responder(request);
   }

   return { fetch: fakeFetch, requests };
}

export function createFakeClient(
   responders: readonly Responder[],
   options: Partial<AzureDevOpsClientOptions> = {},
   create: (clientOptions: AzureDevOpsClientOptions) => AzureDevOpsClient = createClient,
): FakeClient {
   const { fetch, requests } = createFakeFetch(responders),
      client = create({
         organization: 'acme',
         auth: { type: 'pat', token: 'secret' },
         retry: { baseDelayMs: 1, maxDelayMs: 50 },
         fetch,
         ...options,
      });

   return { client, requests };
}

export function respondJSON(body: unknown, init: ResponseInit = {}): Responder {
   return () => {
      return Response.json(body, init);
   };
}

export function respondStatus(status: number, body: string | null = null, headers: HeadersInit = {}): Responder {
   return () => {
      return new Response(body, { status, headers });
   };
}

/** Never answers. Rejects when the request's signal aborts, as `fetch` does. */
export function respondNever(): Responder {
   return (request) => {
      return new Promise((_resolve, reject) => {
         // The responder can abort the signal itself, so check it before waiting for the event.
         if (request.signal.aborted) {
            reject(request.signal.reason);
            return;
         }

         request.signal.addEventListener('abort', () => {
            reject(request.signal.reason);
         });
      });
   };
}

export function getRequest(requests: readonly Request[], index: number): Request {
   const request = requests[index];

   if (!request) {
      throw new Error(`No request at index ${index}`);
   }

   return request;
}

/** Azure DevOps project IDs are GUIDs, and the generated schemas check that. */
export const PROJECT_ID = '0f1c2f5e-0b7a-4c1e-9a52-3f0b1d4e2a10',
   OTHER_PROJECT_ID = '1f1c2f5e-0b7a-4c1e-9a52-3f0b1d4e2a10';
