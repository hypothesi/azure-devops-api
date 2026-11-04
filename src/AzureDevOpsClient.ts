import type { z } from 'zod';
import { callAPI, type CallOptions, type ClientContext, type QueryParams } from './context';
import { InvalidInputError } from './errors';
import { Projects } from './Projects';
import {
   type HTTPMethod,
   type RequestBody,
   type RetryEvent,
   type RetryOptions,
   type SendResult,
   Transport,
} from './Transport';
import { Work } from './Work';
import { WorkItems } from './WorkItems';

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
    * The organization name, such as `contoso`, or the full organization or collection URL,
    * such as `https://dev.azure.com/contoso` or `https://tfs.example.com/DefaultCollection`.
    */
   readonly organization: string;
   readonly auth: AzureDevOpsAuth;
   /**
    * The base URL for work item search. Default: `https://almsearch.dev.azure.com/{organization}`
    * for `dev.azure.com` organizations, otherwise the organization URL.
    */
   readonly searchURL?: string;
   /** Default: `7.1`. */
   readonly apiVersion?: string;
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
   /** Default: the client's `apiVersion`. */
   readonly apiVersion?: string;
   readonly body?: RequestBody;
   readonly schema: z.ZodType<T>;
   readonly idempotent?: boolean;
}

const DEFAULT_API_VERSION = '7.1',
   DEFAULT_TIMEOUT_MS = 30_000,
   DEFAULT_RETRY: Required<RetryOptions> = { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 30_000 },
   CLOUD_HOST = 'dev.azure.com',
   CLOUD_SEARCH_HOST = 'almsearch.dev.azure.com';

/**
 * A typed Azure DevOps REST API client.
 *
 * @example
 * ```ts
 * const client = new AzureDevOpsClient({
 *    organization: 'contoso',
 *    auth: { type: 'pat', token: process.env.AZURE_DEVOPS_PAT ?? '' },
 * });
 *
 * const workItem = await client.workItems.get(42);
 * ```
 */
export class AzureDevOpsClient {
   public readonly workItems: WorkItems;
   public readonly projects: Projects;
   public readonly work: Work;
   private readonly context: ClientContext;

   public constructor(options: AzureDevOpsClientOptions) {
      const organizationURL = getOrganizationURL(options.organization),
         searchURL = options.searchURL
            ? parseURL(options.searchURL, 'searchURL')
            : getDefaultSearchURL(organizationURL),
         getAuthorization = getAuthorizationProvider(options.auth),
         fetchFunction = options.fetch ?? globalThis.fetch,
         retry = { ...DEFAULT_RETRY, ...options.retry },
         timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      if (typeof fetchFunction !== 'function') {
         throw new InvalidInputError('No fetch implementation is available. Pass one in the fetch option.');
      }

      assertNonNegative({ timeoutMs, ...retry });

      this.context = {
         organizationURL,
         searchURL,
         apiVersion: options.apiVersion ?? DEFAULT_API_VERSION,
         transport: new Transport({
            // Calling an unbound `window.fetch` throws "Illegal invocation" in browsers.
            fetch: fetchFunction.bind(globalThis),
            getAuthorization,
            allowedOrigins: new Set([organizationURL.origin, searchURL.origin]),
            timeoutMs,
            retry,
            onRetry: options.onRetry,
         }),
      };

      this.workItems = new WorkItems(this.context);
      this.projects = new Projects(this.context);
      this.work = new Work(this.context);
   }

   /**
    * Calls any endpoint under the organization URL. Use it for APIs that this library does
    * not wrap. The response must match `schema`.
    *
    * @example
    * ```ts
    * const { data } = await client.request({
    *    path: ['MyProject', '_apis', 'git', 'repositories'],
    *    schema: z.object({ value: z.array(z.object({ id: z.string(), name: z.string() })) }),
    * });
    * ```
    */
   public request<T>(options: RequestOptions<T>): Promise<SendResult<T>> {
      const segments = typeof options.path === 'string' ? options.path.split('/').filter(Boolean) : options.path;

      return callAPI(
         this.context,
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
