import type { z } from 'zod';
import { callAPI, type CallOptions, type ClientContext, type OperationTable, type QueryParams } from './context';
import { InvalidInputError } from './errors';
import {
   type HTTPMethod,
   type RequestBody,
   type RetryEvent,
   type RetryOptions,
   type SendResult,
   Transport,
} from './Transport';

export type TokenProvider = () => string | Promise<string>;

export type AzureDevOpsAuth =
   /** A personal access token, sent with HTTP Basic authentication. */
   | { readonly type: 'pat'; readonly token: string }
   /**
    * A Microsoft Entra ID OAuth access token. Pass a function to fetch a fresh token. The
    * client calls it before every attempt, so the function should cache the token.
    */
   | { readonly type: 'bearer'; readonly token: string | TokenProvider };

export interface AzureDevOpsClientOptions {
   /**
    * The organization name, such as `acme`, or the full organization or collection URL,
    * such as `https://dev.azure.com/acme` or `https://tfs.example.com/DefaultCollection`.
    */
   readonly organization: string;
   readonly auth: AzureDevOpsAuth;
   /**
    * The base URL for work item search. Default: `https://almsearch.dev.azure.com/{organization}`
    * for `dev.azure.com` organizations, otherwise the organization URL.
    */
   readonly searchURL?: string;
   /** The time limit for each attempt, including reading the response body. Default: `30000`. */
   readonly timeoutMs?: number;
   readonly retry?: RetryOptions;
   /** Called before each retry. Use it for logging. */
   readonly onRetry?: (event: RetryEvent) => void;
   /** Default: `globalThis.fetch`. */
   readonly fetch?: typeof fetch;
}

export interface RequestOptions<T> extends CallOptions {
   /** Default: `GET`. */
   readonly method?: HTTPMethod;
   /**
    * The path relative to the organization URL, as a string (`MyProject/_apis/git/repositories`)
    * or as segments. The client percent-encodes each segment.
    */
   readonly path: string | readonly (string | number)[];
   readonly query?: QueryParams;
   /** Default: the API version of the entry point, such as `7.1`. */
   readonly apiVersion?: string;
   readonly body?: RequestBody;
   readonly schema: z.ZodType<T>;
   readonly idempotent?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000,
   DEFAULT_RETRY: Required<RetryOptions> = { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 30_000 },
   CLOUD_HOST = 'dev.azure.com',
   CLOUD_SEARCH_HOST = 'almsearch.dev.azure.com',
   ORGANIZATION_PLACEHOLDER = '{organization}';

/** Validates the options and builds the state that the generated operations and the helpers share. */
export function createContext(options: AzureDevOpsClientOptions, table: OperationTable): ClientContext {
   const organizationURL = getOrganizationURL(options.organization),
      searchURL = options.searchURL ? parseURL(options.searchURL, 'searchURL') : getDefaultSearchURL(organizationURL),
      serverURLs = table.servers.map((server) => {
         return getServerURL(server, organizationURL, searchURL);
      }),
      getAuthorization = getAuthorizationProvider(options.auth),
      fetchFunction = options.fetch ?? globalThis.fetch,
      retry = { ...DEFAULT_RETRY, ...options.retry },
      timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

   if (typeof fetchFunction !== 'function') {
      throw new InvalidInputError('No fetch implementation is available. Pass one in the fetch option.');
   }

   assertNonNegative({ timeoutMs, ...retry });

   return {
      organizationURL,
      searchURL,
      table,
      serverURLs,
      transport: new Transport({
         // Calling an unbound `window.fetch` throws "Illegal invocation" in browsers.
         fetch: fetchFunction.bind(globalThis),
         getAuthorization,
         allowedOrigins: new Set(
            [organizationURL, searchURL, ...serverURLs].map((url) => {
               return url.origin;
            }),
         ),
         timeoutMs,
         retry,
         onRetry: options.onRetry,
      }),
   };
}

/** Calls any endpoint under the organization URL. The response must match `options.schema`. */
export function request<T>(context: ClientContext, options: RequestOptions<T>): Promise<SendResult<T>> {
   const segments = typeof options.path === 'string' ? options.path.split('/').filter(Boolean) : options.path;

   return callAPI(
      context,
      {
         method: options.method ?? 'GET',
         path: segments,
         query: options.query ?? {},
         apiVersion: options.apiVersion,
         body: options.body,
         schema: options.schema,
         idempotent: options.idempotent,
      },
      options,
   );
}

/**
 * The base URL of a spec server for this organization. Azure DevOps Services serves some
 * areas from other hosts, such as `feeds.dev.azure.com`. A server serves every area from the
 * collection URL.
 */
function getServerURL(server: string, organizationURL: URL, searchURL: URL): URL {
   const organization = organizationURL.pathname.split('/')[1] ?? '';

   if (server.includes(CLOUD_SEARCH_HOST)) {
      return searchURL;
   }

   if (organizationURL.host !== CLOUD_HOST || !server.startsWith('https://')) {
      return organizationURL;
   }

   return parseURL(server.replace(ORGANIZATION_PLACEHOLDER, organization), 'server');
}

function parseURL(value: string, optionName: string): URL {
   let url: URL;

   try {
      url = new URL(value);
   } catch (error) {
      throw new InvalidInputError(`${optionName} is not a valid URL: ${value}`, { cause: error });
   }

   if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new InvalidInputError(`${optionName} must use https or http: ${value}`);
   }

   url.search = '';
   url.hash = '';
   url.pathname = url.pathname.replace(/\/+$/, '');

   return url;
}

function getOrganizationURL(organization: string): URL {
   const trimmed = organization.trim();

   if (trimmed === '') {
      throw new InvalidInputError('organization must not be empty');
   }

   if (trimmed.includes('://')) {
      return parseURL(trimmed, 'organization');
   }

   if (trimmed.includes('/')) {
      throw new InvalidInputError(`organization must be a name or a full URL: ${organization}`);
   }

   return new URL(`https://${CLOUD_HOST}/${encodeURIComponent(trimmed)}`);
}

function getDefaultSearchURL(organizationURL: URL): URL {
   if (organizationURL.host !== CLOUD_HOST) {
      return organizationURL;
   }

   const url = new URL(organizationURL);

   url.host = CLOUD_SEARCH_HOST;

   return url;
}

function getAuthorizationProvider(auth: AzureDevOpsAuth): () => Promise<string> {
   if (auth.type === 'pat') {
      const token = auth.token.trim();

      if (token === '') {
         throw new InvalidInputError('auth.token must not be empty');
      }

      const header = `Basic ${btoa(`:${token}`)}`;

      return () => {
         return Promise.resolve(header);
      };
   }

   const { token } = auth;

   return async () => {
      const value = typeof token === 'function' ? await token() : token;

      if (value.trim() === '') {
         throw new InvalidInputError('The bearer token is empty');
      }

      return `Bearer ${value.trim()}`;
   };
}

function assertNonNegative(values: Readonly<Record<string, number>>): void {
   for (const [name, value] of Object.entries(values)) {
      if (!Number.isFinite(value) || value < 0) {
         throw new InvalidInputError(`${name} must be a finite number of 0 or more, got ${value}`);
      }
   }
}
