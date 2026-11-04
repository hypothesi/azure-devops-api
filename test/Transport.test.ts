import { describe, expect, it } from 'vite-plus/test';
import { z } from 'zod';
import {
   AuthenticationError,
   HttpError,
   InvalidInputError,
   NetworkError,
   NotFoundError,
   PermissionError,
   RateLimitError,
   ResponseValidationError,
   type RetryEvent,
   TimeoutError,
} from '../src/index';
import { Transport } from '../src/Transport';
import {
   createFakeClient,
   createFakeFetch,
   getRequest,
   type Responder,
   respondJSON,
   respondNever,
   respondStatus,
} from './fake-fetch';

const NameSchema = z.object({ name: z.string() }),
   ok = respondJSON({ name: 'ok' }),
   unavailable = respondStatus(503);

describe('Transport', () => {
   describe('successful requests', () => {
      it('sends the auth and API headers and returns the parsed body', async () => {
         const { client, requests } = createFakeClient([ok]);

         const result = await client.request({ path: 'Web/_apis/thing', schema: NameSchema });

         const request = getRequest(requests, 0);

         expect(result.data).toEqual({ name: 'ok' });
         expect(request.url).toBe('https://dev.azure.com/contoso/Web/_apis/thing?api-version=7.1');
         expect(request.headers.get('Authorization')).toBe(`Basic ${btoa(':secret')}`);
         expect(request.headers.get('Accept')).toBe('application/json');
         expect(request.headers.get('X-TFS-FedAuthRedirect')).toBe('Suppress');
         expect(request.redirect).toBe('manual');
      });

      it('calls the bearer token provider before every attempt', async () => {
         let calls = 0;
         const { client, requests } = createFakeClient([unavailable, ok], {
            auth: {
               type: 'bearer',
               token: () => {
                  calls += 1;
                  return `token-${calls}`;
               },
            },
         });

         await client.request({ path: '_apis/thing', schema: NameSchema });

         expect(getRequest(requests, 0).headers.get('Authorization')).toBe('Bearer token-1');
         expect(getRequest(requests, 1).headers.get('Authorization')).toBe('Bearer token-2');
      });

      it('waits for a Retry-After header that arrives on a successful response', async () => {
         const { client } = createFakeClient([respondJSON({ name: 'ok' }, { headers: { 'Retry-After': '0.05' } }), ok]),
            started = Date.now();

         await client.request({ path: '_apis/thing', schema: NameSchema });
         await client.request({ path: '_apis/thing', schema: NameSchema });

         expect(Date.now() - started).toBeGreaterThanOrEqual(45);
      });
   });

   describe('HTTP errors', () => {
      it.each([
         [401, AuthenticationError],
         [403, PermissionError],
         [404, NotFoundError],
         [400, HttpError],
      ])('maps HTTP %i to %o', async (status, ErrorClass) => {
         const { client } = createFakeClient([respondStatus(status)]);

         const promise = client.request({ path: '_apis/thing', schema: NameSchema });

         await expect(promise).rejects.toBeInstanceOf(ErrorClass);
      });

      it('reads the server message, type key, and activity ID', async () => {
         const body = { message: 'TF401232: Work item 7 does not exist.', typeKey: 'WorkItemDoesNotExistException' },
            { client } = createFakeClient([respondJSON(body, { status: 404, headers: { ActivityId: 'abc-123' } })]);

         const error = await client.request({ path: '_apis/thing', schema: NameSchema }).catch((caught: unknown) => {
            return caught;
         });

         expect(error).toBeInstanceOf(NotFoundError);
         expect(error).toMatchObject({
            status: 404,
            serverMessage: body.message,
            typeKey: body.typeKey,
            activityID: 'abc-123',
         });
      });

      it.each([
         ['HTTP 203 with a sign-in page', respondStatus(203, '<html>Sign in</html>', { 'Content-Type': 'text/html' })],
         ['a redirect', respondStatus(302, null, { Location: 'https://login.example.com' })],
      ])('throws AuthenticationError for %s', async (_name, responder) => {
         const { client } = createFakeClient([responder]);

         const promise = client.request({ path: '_apis/thing', schema: NameSchema });

         await expect(promise).rejects.toBeInstanceOf(AuthenticationError);
      });
   });

   describe('retries', () => {
      it('retries a GET after HTTP 503 and reports each retry', async () => {
         const events: RetryEvent[] = [],
            { client, requests } = createFakeClient([unavailable, unavailable, ok], {
               onRetry: (event) => {
                  events.push(event);
               },
            });

         const result = await client.request({ path: '_apis/thing', schema: NameSchema });

         expect(result.data.name).toBe('ok');
         expect(requests).toHaveLength(3);
         expect(
            events.map((event) => {
               return event.attempt;
            }),
         ).toEqual([1, 2]);
      });

      it('throws the last error after maxRetries', async () => {
         const { client, requests } = createFakeClient([unavailable, unavailable, unavailable], {
            retry: { maxRetries: 2, baseDelayMs: 1 },
         });

         const promise = client.request({ path: '_apis/thing', schema: NameSchema });

         await expect(promise).rejects.toMatchObject({ status: 503 });
         expect(requests).toHaveLength(3);
      });

      it('does not retry a POST after HTTP 503', async () => {
         const { client, requests } = createFakeClient([unavailable, ok]);

         const promise = client.request({
            method: 'POST',
            path: '_apis/thing',
            body: { json: {} },
            schema: NameSchema,
         });

         await expect(promise).rejects.toBeInstanceOf(HttpError);
         expect(requests).toHaveLength(1);
      });

      it('retries a POST marked idempotent', async () => {
         const { client, requests } = createFakeClient([unavailable, ok]);

         await client.request({
            method: 'POST',
            path: '_apis/thing',
            body: { json: {} },
            schema: NameSchema,
            idempotent: true,
         });

         expect(requests).toHaveLength(2);
      });

      it('retries any method after HTTP 429 and waits for Retry-After', async () => {
         const { client, requests } = createFakeClient([respondStatus(429, null, { 'Retry-After': '0' }), ok]);

         await client.request({ method: 'POST', path: '_apis/thing', body: { json: {} }, schema: NameSchema });

         expect(requests).toHaveLength(2);
      });

      it('throws RateLimitError without waiting when Retry-After is longer than maxDelayMs', async () => {
         const { client, requests } = createFakeClient([respondStatus(429, null, { 'Retry-After': '3600' }), ok]);

         const error = await client.request({ path: '_apis/thing', schema: NameSchema }).catch((caught: unknown) => {
            return caught;
         });

         expect(error).toBeInstanceOf(RateLimitError);
         expect(error).toMatchObject({ retryAfterMs: 3_600_000 });
         expect(requests).toHaveLength(1);
      });

      it('does not retry with maxRetries 0', async () => {
         const { client, requests } = createFakeClient([unavailable, ok], { retry: { maxRetries: 0 } });

         const promise = client.request({ path: '_apis/thing', schema: NameSchema });

         await expect(promise).rejects.toBeInstanceOf(HttpError);
         expect(requests).toHaveLength(1);
      });
   });

   describe('timeouts, aborts, and network failures', () => {
      it('throws TimeoutError after timeoutMs and retries a GET', async () => {
         const { client, requests } = createFakeClient([respondNever(), respondNever()], {
            timeoutMs: 20,
            retry: { maxRetries: 1, baseDelayMs: 1 },
         });

         const error = await client.request({ path: '_apis/thing', schema: NameSchema }).catch((caught: unknown) => {
            return caught;
         });

         expect(error).toBeInstanceOf(TimeoutError);
         expect(error).toMatchObject({ timeoutMs: 20 });
         expect(requests).toHaveLength(2);
      });

      it('rejects with the abort reason and does not retry when the caller aborts', async () => {
         const controller = new AbortController(),
            reason = new Error('user navigated away'),
            abortInFlight: Responder = (request) => {
               const response = respondNever()(request);

               controller.abort(reason);

               return response;
            },
            { client, requests } = createFakeClient([abortInFlight, ok]);

         const promise = client.request({ path: '_apis/thing', schema: NameSchema, signal: controller.signal });

         await expect(promise).rejects.toBe(reason);
         expect(requests).toHaveLength(1);
      });

      it('rejects before sending when the signal is already aborted', async () => {
         const { client, requests } = createFakeClient([ok]);

         const promise = client.request({ path: '_apis/thing', schema: NameSchema, signal: AbortSignal.abort() });

         await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
         expect(requests).toHaveLength(0);
      });

      it('wraps a fetch rejection in NetworkError and keeps the cause', async () => {
         const cause = new TypeError('fetch failed'),
            { client } = createFakeClient(
               [
                  (): never => {
                     throw cause;
                  },
               ],
               { retry: { maxRetries: 0 } },
            );

         const error = await client.request({ path: '_apis/thing', schema: NameSchema }).catch((caught: unknown) => {
            return caught;
         });

         expect(error).toBeInstanceOf(NetworkError);
         expect(error).toMatchObject({ cause });
      });
   });

   describe('response validation', () => {
      it('throws ResponseValidationError for a body that is not JSON', async () => {
         const { client } = createFakeClient([respondStatus(200, 'not json')]);

         const promise = client.request({ path: '_apis/thing', schema: NameSchema });

         await expect(promise).rejects.toBeInstanceOf(ResponseValidationError);
      });

      it('throws ResponseValidationError with the Zod issues for a body that does not match', async () => {
         const { client } = createFakeClient([respondJSON({ name: 42 })]);

         const error = await client.request({ path: '_apis/thing', schema: NameSchema }).catch((caught: unknown) => {
            return caught;
         });

         expect(error).toBeInstanceOf(ResponseValidationError);
         expect(error).toMatchObject({ issues: [{ path: ['name'] }] });
      });
   });

   it('refuses to send credentials to an origin that is not allowed', async () => {
      const { fetch, requests } = createFakeFetch([ok]),
         transport = new Transport({
            fetch,
            getAuthorization: (): string => {
               return 'Basic x';
            },
            allowedOrigins: new Set(['https://dev.azure.com']),
            timeoutMs: 1000,
            retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
         });

      const promise = transport.send({ method: 'GET', url: new URL('https://example.com/steal'), schema: NameSchema });

      await expect(promise).rejects.toBeInstanceOf(InvalidInputError);
      expect(requests).toHaveLength(0);
   });
});
