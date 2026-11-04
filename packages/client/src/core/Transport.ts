import { z } from 'zod';
import {
   AuthenticationError,
   AzureDevOpsError,
   InvalidInputError,
   ConflictError,
   HttpError,
   type HttpErrorDetails,
   NetworkError,
   NotFoundError,
   PermissionError,
   RateLimitError,
   type RequestDetails,
   ResponseValidationError,
   TimeoutError,
} from './errors';

export type HTTPMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export interface RetryOptions {
   /** Retries after the first attempt. Default: `3`. Set `0` to turn retries off. */
   readonly maxRetries?: number;
   /** The first backoff delay. Each retry doubles it, with jitter. Default: `500`. */
   readonly baseDelayMs?: number;
   /**
    * The longest delay between attempts. When `Retry-After` asks for a longer wait, the
    * client throws instead of waiting. Default: `30000`.
    */
   readonly maxDelayMs?: number;
}

export interface RetryEvent {
   /** The attempt that failed. The first attempt is `1`. */
   readonly attempt: number;
   readonly delayMs: number;
   readonly error: AzureDevOpsError;
}

export type RequestBody =
   | { readonly json: unknown; readonly contentType?: string | undefined }
   | { readonly binary: BinaryContent; readonly contentType?: string | undefined };

export type BinaryContent = Blob | ArrayBuffer | Uint8Array<ArrayBuffer>;

/** How to read a successful response body. Default: `json`. */
export type ResponseType = 'json' | 'text' | 'blob';

export interface SendOptions<T> {
   readonly method: HTTPMethod;
   readonly url: URL;
   readonly schema: z.ZodType<T>;
   readonly body?: RequestBody | undefined;
   /** `schema` validates the parsed JSON, the text, or the `Blob`. */
   readonly responseType?: ResponseType | undefined;
   /** Extra request headers, for example `Content-Range` for a chunked upload. */
   readonly headers?: Readonly<Record<string, string>> | undefined;
   /**
    * Whether the client may retry after a timeout, a network failure, or HTTP 5xx. HTTP 429
    * is always retried because Azure DevOps rejected the request without running it.
    * Default: `true` for GET, HEAD, OPTIONS, PUT, and DELETE.
    */
   readonly idempotent?: boolean | undefined;
   readonly signal?: AbortSignal | undefined;
   readonly timeoutMs?: number | undefined;
}

export interface SendResult<T> {
   readonly data: T;
   readonly status: number;
   readonly headers: Headers;
}

export interface TransportOptions {
   readonly fetch: typeof fetch;
   readonly getAuthorization: () => string | Promise<string>;
   /** The client sends credentials only to these origins. */
   readonly allowedOrigins: ReadonlySet<string>;
   readonly timeoutMs: number;
   readonly retry: Required<RetryOptions>;
   readonly onRetry?: ((event: RetryEvent) => void) | undefined;
}

const IDEMPOTENT_METHODS: ReadonlySet<HTTPMethod> = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']),
   RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 500, 502, 503, 504]),
   MS_PER_SECOND = 1000,
   HTTP_NON_AUTHORITATIVE = 203,
   ServerErrorSchema = z.looseObject({
      message: z.string().optional(),
      typeKey: z.string().optional(),
   });

interface AttemptContext {
   readonly details: RequestDetails;
   readonly timeoutMs: number;
   readonly timeoutSignal: AbortSignal;
}

interface ReceivedResponse {
   readonly response: Response;
   readonly text: string;
   readonly blob: Blob | undefined;
}

/** Sends requests with timeouts, retries, rate limit handling, and response validation. */
export class Transport {
   /** `Date.now()` value before which no request starts, set from `Retry-After`. */
   private notBefore = 0;

   public constructor(private readonly options: TransportOptions) {}

   public send<T>(request: SendOptions<T>): Promise<SendResult<T>> {
      if (!this.options.allowedOrigins.has(request.url.origin)) {
         return Promise.reject(new InvalidInputError(`Refusing to send credentials to ${request.url.origin}`));
      }

      return this.sendAttempt(request, 1);
   }

   /** Sends one attempt. On a retryable failure, waits and calls itself with the next attempt number. */
   private async sendAttempt<T>(request: SendOptions<T>, attempt: number): Promise<SendResult<T>> {
      const idempotent = request.idempotent ?? IDEMPOTENT_METHODS.has(request.method);

      request.signal?.throwIfAborted();
      await this.waitForRateLimit(request.signal);

      try {
         return await this.attempt(request);
      } catch (error) {
         const delayMs = this.getRetryDelay(error, attempt, idempotent);

         if (delayMs === undefined || !(error instanceof AzureDevOpsError)) {
            throw error;
         }

         this.options.onRetry?.({ attempt, delayMs, error });
         await sleep(delayMs, request.signal);

         return this.sendAttempt(request, attempt + 1);
      }
   }

   private async attempt<T>(request: SendOptions<T>): Promise<SendResult<T>> {
      const details: RequestDetails = { method: request.method, url: request.url.toString() },
         timeoutMs = request.timeoutMs ?? this.options.timeoutMs,
         timeoutSignal = AbortSignal.timeout(timeoutMs),
         init: RequestInit = {
            method: request.method,
            headers: await this.getHeaders(request),
            body: getBodyInit(request.body),
            signal: request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal,
            redirect: 'manual',
         },
         { response, text, blob } = await this.receive(request, init, { details, timeoutMs, timeoutSignal });

      this.recordRetryAfter(response.headers);
      assertSuccess(response, text, details);

      return {
         data: parseBody(request.schema, blob ?? text, request.responseType ?? 'json', {
            request: details,
            status: response.status,
            body: text,
         }),
         status: response.status,
         headers: response.headers,
      };
   }

   /** Sends the request and reads the body. Turns a failed `fetch` into a client error. */
   private async receive(
      request: SendOptions<unknown>,
      init: RequestInit,
      { details, timeoutMs, timeoutSignal }: AttemptContext,
   ): Promise<ReceivedResponse> {
      try {
         const response = await this.options.fetch(request.url, init);

         if (request.responseType === 'blob' && response.ok) {
            return { response, text: '', blob: await response.blob() };
         }

         return { response, text: await response.text(), blob: undefined };
      } catch (error) {
         if (request.signal?.aborted) {
            throw request.signal.reason;
         }

         throw timeoutSignal.aborted ? new TimeoutError(details, timeoutMs) : new NetworkError(details, error);
      }
   }

   private async getHeaders({ body, headers: extraHeaders, responseType }: SendOptions<unknown>): Promise<Headers> {
      const headers = new Headers({
         ...extraHeaders,
         Accept: responseType === undefined || responseType === 'json' ? 'application/json' : '*/*',
         Authorization: await this.options.getAuthorization(),
         // Makes Azure DevOps answer 401 instead of redirecting to its sign-in page.
         'X-TFS-FedAuthRedirect': 'Suppress',
      });

      if (body) {
         headers.set(
            'Content-Type',
            body.contentType ?? ('json' in body ? 'application/json' : 'application/octet-stream'),
         );
      }

      return headers;
   }

   private getRetryDelay(error: unknown, attempt: number, idempotent: boolean): number | undefined {
      const { maxRetries, baseDelayMs, maxDelayMs } = this.options.retry;

      if (attempt > maxRetries || !isRetryable(error, idempotent)) {
         return undefined;
      }

      if (error instanceof HttpError && error.retryAfterMs !== undefined) {
         return error.retryAfterMs <= maxDelayMs ? error.retryAfterMs : undefined;
      }

      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));

      // Jitter between half and all of the ceiling, so clients that failed together do not retry together.
      return Math.round(ceiling / 2 + (Math.random() * ceiling) / 2);
   }

   /**
    * Azure DevOps can send `Retry-After` on successful responses before it starts to delay
    * requests. Every request from this client waits until that time passes.
    */
   private recordRetryAfter(headers: Headers): void {
      const retryAfterMs = getRetryAfterMs(headers);

      if (retryAfterMs !== undefined) {
         this.notBefore = Math.max(this.notBefore, Date.now() + Math.min(retryAfterMs, this.options.retry.maxDelayMs));
      }
   }

   private async waitForRateLimit(signal: AbortSignal | undefined): Promise<void> {
      const waitMs = this.notBefore - Date.now();

      if (waitMs > 0) {
         await sleep(waitMs, signal);
      }
   }
}

function isRetryable(error: unknown, idempotent: boolean): boolean {
   if (error instanceof RateLimitError) {
      return true;
   }

   if (!idempotent) {
      return false;
   }

   return (
      error instanceof TimeoutError ||
      error instanceof NetworkError ||
      (error instanceof HttpError && RETRYABLE_STATUSES.has(error.status))
   );
}

function isSignInResponse(response: Response): boolean {
   const isRedirect = response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);

   return isRedirect || response.status === HTTP_NON_AUTHORITATIVE;
}

/** Throws when Azure DevOps redirected to its sign-in page or answered with an error status. */
function assertSuccess(response: Response, text: string, details: RequestDetails): void {
   if (isSignInResponse(response)) {
      throw new AuthenticationError(
         getErrorDetails(response, text, details),
         `${details.method} ${details.url} was redirected to the sign-in page. Check that the credentials are valid.`,
      );
   }

   if (!response.ok) {
      throw createHttpError(getErrorDetails(response, text, details));
   }
}

function getBodyInit(body: RequestBody | undefined): BodyInit | null {
   if (!body) {
      return null;
   }

   return 'json' in body ? JSON.stringify(body.json) : body.binary;
}

function getRetryAfterMs(headers: Headers): number | undefined {
   const value = headers.get('Retry-After');

   if (value === null || value.trim() === '') {
      return undefined;
   }

   const seconds = Number(value);

   if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * MS_PER_SECOND);
   }

   const date = Date.parse(value);

   return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function getErrorDetails(response: Response, text: string, request: RequestDetails): HttpErrorDetails {
   const serverError = ServerErrorSchema.safeParse(parseJSON(text));

   return {
      status: response.status,
      request,
      body: text,
      activityID: response.headers.get('ActivityId') ?? undefined,
      serverMessage: serverError.data?.message,
      typeKey: serverError.data?.typeKey,
      retryAfterMs: getRetryAfterMs(response.headers),
   };
}

function createHttpError(details: HttpErrorDetails): HttpError {
   switch (details.status) {
      case 401: {
         return new AuthenticationError(details);
      }
      case 403: {
         return new PermissionError(details);
      }
      case 404: {
         return new NotFoundError(details);
      }
      case 409:
      case 412: {
         return new ConflictError(details);
      }
      case 429: {
         return new RateLimitError(details);
      }
      default: {
         return new HttpError(details);
      }
   }
}

function parseJSON(text: string): unknown {
   try {
      return JSON.parse(text);
   } catch {
      return undefined;
   }
}

function parseBody<T>(
   schema: z.ZodType<T>,
   body: string | Blob,
   responseType: ResponseType,
   details: { request: RequestDetails; status: number; body: string },
): T {
   let value: unknown = responseType === 'json' ? undefined : body;

   if (responseType === 'json' && typeof body === 'string' && body !== '') {
      try {
         value = JSON.parse(body);
      } catch (error) {
         throw new ResponseValidationError(details, 'the response body is not JSON', { cause: error });
      }
   }

   const result = schema.safeParse(value);

   if (!result.success) {
      throw new ResponseValidationError(
         { ...details, issues: result.error.issues },
         `the response does not match the expected schema\n${z.prettifyError(result.error)}`,
      );
   }

   return result.data;
}

/** Waits `ms` milliseconds. Rejects with the signal's reason when the caller aborts. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
   return new Promise((resolve, reject) => {
      if (signal?.aborted) {
         reject(signal.reason);
         return;
      }

      const timer = setTimeout(() => {
         signal?.removeEventListener('abort', onAbort);
         resolve();
      }, ms);

      function onAbort(): void {
         clearTimeout(timer);
         reject(signal?.reason);
      }

      signal?.addEventListener('abort', onAbort, { once: true });
   });
}
