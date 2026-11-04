/**
 * The client module that the Kubb-generated operations in `src/generated` import. It sends
 * each operation through the client's `Transport`, so timeouts, retries, `Retry-After`, the
 * origin check, and the error classes apply to generated operations too.
 */
import { z } from 'zod';
import { callAPI, type CallOptions, type ClientContext, type QueryParams } from './context';
import { InvalidInputError } from './errors';
import type { BinaryContent, HTTPMethod, RequestBody, ResponseType, SendResult } from './Transport';

/** What a generated operation passes to the client. */
export interface RequestConfig extends CallOptions {
   readonly method: HTTPMethod;
   /** The path template from the spec, such as `/{project}/_apis/wit/classificationnodes?ids={ids}`. */
   readonly url: string;
   readonly path?: Readonly<Record<string, unknown>>;
   readonly query?: Readonly<Record<string, unknown>>;
   readonly headers?: Readonly<Record<string, unknown>>;
   readonly body?: unknown;
   /** `error` validates error bodies in Kubb's non-throwing mode, which this client does not have. */
   readonly validator?: { readonly response?: z.ZodType; readonly error?: z.ZodType };
   readonly contentType?: string | { readonly request?: string | undefined };
   readonly responseType?: ResponseType;
   /**
    * Serialization of query parameters that are not `form` with `explode: true`. The client
    * sends every list parameter as one comma-separated value, so it does not read this.
    */
   readonly styles?: unknown;
   readonly security?: unknown;
   /** Generated operations always throw on failure. */
   readonly throwOnError?: boolean;
}

/** Sends one generated operation. `createClient` returns an object of this type. */
export type OperationClient = (config: RequestConfig) => Promise<SendResult<unknown>>;

/**
 * The options of a generated operation: its `path`, `query`, `body`, and `headers`, the
 * client from `createClient`, and the common call options.
 */
export type Options<TOptions, _ThrowOnError extends boolean = true> = TOptions &
   CallOptions & {
      readonly client: OperationClient;
      /** The request content type, for operations whose spec lists more than one. */
      readonly contentType?: string | { readonly request?: string };
      /** Failures always throw one of this library's errors. */
      readonly throwOnError?: true;
   };

type SuccessStatus = `2${string}`;

/** The result of a generated operation: the parsed success body, the status, and the headers. */
export type RequestResult<TResponses, _ThrowOnError extends boolean = true> = SendResult<
   [Extract<keyof TResponses, SuccessStatus>] extends [never]
      ? unknown
      : TResponses[Extract<keyof TResponses, SuccessStatus>]
>;

/**
 * The default client of generated operations. Operations require a `client` option, so this
 * runs only when a caller passes `undefined` without type checks.
 */
export const client: OperationClient = () => {
   return Promise.reject(new InvalidInputError('Pass the client from createClient() in the client option'));
};

/** Builds the client function that generated operations call, for one client context. */
export function createOperationClient(context: ClientContext): OperationClient {
   // Async, so that invalid input rejects the promise instead of throwing.
   return async (config) => {
      const [pathTemplate = '', queryTemplate = ''] = config.url.split('?'),
         contentType = typeof config.contentType === 'string' ? config.contentType : config.contentType?.request;

      return callAPI(
         context,
         {
            method: config.method,
            operation: `${config.method} ${config.url}`,
            path: fillPath(pathTemplate, config.path ?? {}),
            query: { ...getTemplateQuery(queryTemplate), ...toQueryParams(config.query ?? {}) },
            body: getBody(config.body, contentType),
            headers: toHeaders(config.headers ?? {}),
            // Kubb validates binary responses with `z.instanceof(File)`, but `Response.blob()` returns a Blob.
            schema: config.responseType === 'blob' ? z.instanceof(Blob) : (config.validator?.response ?? z.unknown()),
            responseType: config.responseType,
         },
         config,
      );
   };
}

/** Splits a path template into segments and replaces each `{name}` with its value. */
function fillPath(template: string, values: Readonly<Record<string, unknown>>): string[] {
   return template
      .split('/')
      .filter(Boolean)
      .map((segment) => {
         return segment.replaceAll(/\{([^}]+)\}/g, (_match, name: string) => {
            const value = toParameterValue(values[name]);

            if (value === undefined || value === '') {
               throw new InvalidInputError(`path.${name} is required`);
            }

            return String(value);
         });
      });
}

/**
 * Returns the fixed parameters of a query template. Parameters with a `{name}` value come
 * from the operation's `query` option instead.
 */
function getTemplateQuery(template: string): Record<string, string> {
   return Object.fromEntries(
      [...new URLSearchParams(template)].filter(([, value]) => {
         return !/^\{.*\}$/.test(value);
      }),
   );
}

function toQueryParams(query: Readonly<Record<string, unknown>>): QueryParams {
   return Object.fromEntries(
      Object.entries(query).map(([key, value]) => {
         return [key, toParameterValue(value)];
      }),
   );
}

function toParameterValue(value: unknown): string | number | boolean | undefined {
   if (value === undefined || value === null) {
      return undefined;
   }

   if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
   }

   // Azure DevOps reads list parameters, such as `ids` and `fields`, as comma-separated values.
   return Array.isArray(value) ? value.join(',') : JSON.stringify(value);
}

function toHeaders(headers: Readonly<Record<string, unknown>>): Record<string, string> {
   return Object.fromEntries(
      Object.entries(headers).flatMap(([key, value]) => {
         const text = toParameterValue(value);

         return text === undefined ? [] : [[key, String(text)]];
      }),
   );
}

function isBinary(value: unknown): value is BinaryContent {
   return (
      (typeof Blob !== 'undefined' && value instanceof Blob) ||
      value instanceof ArrayBuffer ||
      (value instanceof Uint8Array && value.buffer instanceof ArrayBuffer)
   );
}

function getBody(body: unknown, contentType: string | undefined): RequestBody | undefined {
   if (body === undefined) {
      return undefined;
   }

   return isBinary(body) ? { binary: body, contentType } : { json: body, contentType };
}
