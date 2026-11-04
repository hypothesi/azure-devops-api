import type { core } from 'zod';

export interface RequestDetails {
   readonly method: string;
   readonly url: string;
}

/**
 * Base class for every error that this library throws. A caller that aborts a request
 * receives the `AbortSignal`'s `reason` instead, so `catch` blocks can tell a deliberate
 * cancellation apart from a failure.
 */
export class AzureDevOpsError extends Error {
   public constructor(message: string, options?: ErrorOptions) {
      super(message, options);
      this.name = new.target.name;
   }
}

/**
 * The client options or the method arguments are invalid, for example an empty token, an
 * unparseable URL, or a work item ID that is not a positive integer. The client throws it
 * before it sends a request.
 */
export class InvalidInputError extends AzureDevOpsError {}

export interface HttpErrorDetails {
   readonly status: number;
   readonly request: RequestDetails;
   readonly body: string;
   /** The `ActivityId` response header. Microsoft support uses it to find a request in their logs. */
   readonly activityID?: string | undefined;
   /** The `message` from the Azure DevOps error body, when the body is JSON. */
   readonly serverMessage?: string | undefined;
   /** The `typeKey` from the Azure DevOps error body, for example `WorkItemNotFoundException`. */
   readonly typeKey?: string | undefined;
   /** The delay from the `Retry-After` response header, in milliseconds. */
   readonly retryAfterMs?: number | undefined;
}

/** Azure DevOps answered with a status that is not a success. */
export class HttpError extends AzureDevOpsError {
   public readonly status: number;
   public readonly request: RequestDetails;
   public readonly body: string;
   public readonly activityID: string | undefined;
   public readonly serverMessage: string | undefined;
   public readonly typeKey: string | undefined;
   public readonly retryAfterMs: number | undefined;

   public constructor(details: HttpErrorDetails, message?: string) {
      super(
         message ??
            `${details.request.method} ${details.request.url} failed with HTTP ${details.status}` +
               (details.serverMessage ? `: ${details.serverMessage}` : ''),
      );
      this.status = details.status;
      this.request = details.request;
      this.body = details.body;
      this.activityID = details.activityID;
      this.serverMessage = details.serverMessage;
      this.typeKey = details.typeKey;
      this.retryAfterMs = details.retryAfterMs;
   }
}

/**
 * The credentials are missing, expired, or invalid. Azure DevOps reports this with HTTP
 * 401, with a redirect to its sign-in page, or with HTTP 203 and an HTML sign-in page.
 */
export class AuthenticationError extends HttpError {}

/** The credentials are valid but lack the scope or permission for this request (HTTP 403). */
export class PermissionError extends HttpError {}

/** HTTP 404. */
export class NotFoundError extends HttpError {}

/** HTTP 409 or 412. */
export class ConflictError extends HttpError {}

/** HTTP 429. The client already retried the request `maxRetries` times or the wait was too long. */
export class RateLimitError extends HttpError {}

/** One attempt took longer than `timeoutMs`. */
export class TimeoutError extends AzureDevOpsError {
   public readonly request: RequestDetails;
   public readonly timeoutMs: number;

   public constructor(request: RequestDetails, timeoutMs: number) {
      super(`${request.method} ${request.url} timed out after ${timeoutMs} ms`);
      this.request = request;
      this.timeoutMs = timeoutMs;
   }
}

/** `fetch` rejected before a response arrived, for example because of DNS, TLS, or CORS failures. */
export class NetworkError extends AzureDevOpsError {
   public readonly request: RequestDetails;

   public constructor(request: RequestDetails, cause: unknown) {
      super(`${request.method} ${request.url} failed before a response arrived`, { cause });
      this.request = request;
   }
}

/** The response body is not JSON, or it does not match the expected schema. */
export class ResponseValidationError extends AzureDevOpsError {
   public readonly request: RequestDetails;
   public readonly status: number;
   public readonly body: string;
   public readonly issues: readonly core.$ZodIssue[];

   public constructor(
      details: { request: RequestDetails; status: number; body: string; issues?: readonly core.$ZodIssue[] },
      message: string,
      options?: ErrorOptions,
   ) {
      super(`${details.request.method} ${details.request.url}: ${message}`, options);
      this.request = details.request;
      this.status = details.status;
      this.body = details.body;
      this.issues = details.issues ?? [];
   }
}
