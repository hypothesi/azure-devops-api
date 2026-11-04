# @hypothesi/azure-devops-api

A typed client for the Azure DevOps REST API. It runs in browsers, Node.js, Deno, Bun, and
any other runtime with `fetch`.

* Every response is validated with [Zod 4](https://zod.dev). A response that does not match
  throws `ResponseValidationError` instead of returning bad data.
* Every failure has its own error class: `AuthenticationError`, `NotFoundError`,
  `RateLimitError`, `TimeoutError`, `NetworkError`, and others.
* Each attempt has a timeout. Callers can cancel any call with an `AbortSignal`.
* Retries use exponential backoff with jitter and honor `Retry-After`. Requests that are not
  safe to repeat, such as creating a work item, are not retried after a timeout or a 5xx
  response.

## Install

```sh
npm install @hypothesi/azure-devops-api zod
```

`zod` is a peer dependency, so the schemas that this package exports work with your own Zod
code.

## Quick start

```ts
import { AzureDevOpsClient } from '@hypothesi/azure-devops-api';

const client = new AzureDevOpsClient({
   organization: 'contoso',
   auth: { type: 'pat', token: process.env.AZURE_DEVOPS_PAT ?? '' },
});

const workItem = await client.workItems.get(42);

console.log(workItem.fields?.['System.Title']);
```

`organization` accepts an organization name (`contoso`) or a full URL. Use a full URL for
Azure DevOps Server, for example `https://tfs.example.com/DefaultCollection`.

## Authentication

A personal access token:

```ts
const client = new AzureDevOpsClient({
   organization: 'contoso',
   auth: { type: 'pat', token: myPAT },
});
```

A Microsoft Entra ID access token. The client calls the function before every attempt, so the
function must cache the token and refresh it when it expires:

```ts
import { DefaultAzureCredential } from '@azure/identity';

// The resource ID of Azure DevOps.
const credential = new DefaultAzureCredential(),
   scope = '499b84ac-1321-427f-aa17-267ca6975798/.default';

const client = new AzureDevOpsClient({
   organization: 'contoso',
   auth: {
      type: 'bearer',
      token: async () => {
         return (await credential.getToken(scope)).token;
      },
   },
});
```

A PAT in browser code is readable by anyone who can open the page. In a browser, use a bearer
token for the signed-in user.

## Work items

```ts
// Get many work items. The client splits the IDs into requests of 200.
const workItems = await client.workItems.list([1, 2, 3], { fields: ['System.Title', 'System.State'] });

// Run a WIQL query and get the matching work items.
const mine = await client.workItems.queryWorkItems(
   "SELECT [System.Id] FROM workitems WHERE [System.AssignedTo] = @Me AND [System.State] <> 'Closed'",
   { project: 'Web' },
);

// Create a bug with Markdown repro steps and a parent.
const bug = await client.workItems.create({
   project: 'Web',
   type: 'Bug',
   fields: {
      'System.Title': 'Login button does nothing on iOS',
      'Microsoft.VSTS.TCM.ReproSteps': '1. Open the app\n2. Tap **Log in**',
   },
   markdownFields: ['Microsoft.VSTS.TCM.ReproSteps'],
   relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', workItemID: 100 }],
});

// Update it only if nobody changed it since revision 1.
await client.workItems.update(bug.id, {
   expectedRevision: 1,
   fields: { 'System.State': 'Active' },
});
```

Azure DevOps strips text that looks like an HTML tag from Markdown fields, even inside code
spans. `<name>` is stored as an empty string. Write placeholders as `{name}`.

### Attachments

```ts
const file = new Blob([pngBytes], { type: 'image/png' }),
   attachment = await client.workItems.uploadAttachment({ project: 'Web', fileName: 'screen.png', content: file });

await client.workItems.update(bug.id, { relations: [{ rel: 'AttachedFile', url: attachment.url }] });
```

## Paginated results

Methods that return many pages are async generators. They request the next page only when
the loop needs it:

```ts
for await (const comment of client.workItems.listComments('Web', 42)) {
   console.log(comment.text);
}

const projects = await Array.fromAsync(client.projects.list());
const results = await Array.fromAsync(client.workItems.search('login timeout', { project: 'Web' }));
```

## Other endpoints

`client.request()` calls any endpoint under the organization URL with the same auth, timeout,
retry, and error handling. Pass a Zod schema for the response:

```ts
import { z } from 'zod';

const { data } = await client.request({
   path: ['Web', '_apis', 'git', 'repositories'],
   schema: z.object({ value: z.array(z.object({ id: z.string(), name: z.string() })) }),
});
```

The client percent-encodes each path segment. It sends credentials only to the organization
URL and the search URL.

## Errors

Every error extends `AzureDevOpsError`, except an abort: an aborted call rejects with the
signal's `reason`.

| Error                     | When                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `InvalidInputError`       | Invalid client options or arguments. The client throws it before it sends a request. |
| `AuthenticationError`     | HTTP 401, or a redirect or HTTP 203 to the sign-in page. Check the token.            |
| `PermissionError`         | HTTP 403. The token lacks a scope or permission.                                     |
| `NotFoundError`           | HTTP 404.                                                                            |
| `ConflictError`           | HTTP 409 or 412.                                                                     |
| `RateLimitError`          | HTTP 429 after all retries, or a `Retry-After` longer than `maxDelayMs`.             |
| `HttpError`               | Any other status that is not a success. All the errors above extend it.              |
| `TimeoutError`            | An attempt took longer than `timeoutMs`.                                             |
| `NetworkError`            | `fetch` rejected, for example because of DNS, TLS, or CORS failures.                 |
| `ResponseValidationError` | The body is not JSON or does not match the schema. `issues` has the Zod issues.      |

`HttpError` has `status`, `serverMessage`, `typeKey`, `body`, and `activityID`. Give the
`activityID` to Microsoft support to find the request in their logs.

```ts
import { NotFoundError, type WorkItem } from '@hypothesi/azure-devops-api';

async function findWorkItem(id: number): Promise<WorkItem | undefined> {
   try {
      return await client.workItems.get(id);
   } catch (error) {
      if (error instanceof NotFoundError) {
         return undefined;
      }

      throw error;
   }
}
```

## Timeouts and retries

```ts
const client = new AzureDevOpsClient({
   organization: 'contoso',
   auth: { type: 'pat', token: myPAT },
   timeoutMs: 30_000, // per attempt, including the response body
   retry: { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 30_000 },
   onRetry: ({ attempt, delayMs, error }) => {
      console.warn(`Attempt ${attempt} failed, retrying in ${delayMs} ms`, error);
   },
});

// Per call:
await client.workItems.get(42, { timeoutMs: 5_000, signal: AbortSignal.timeout(20_000) });
```

| Failure                      | Safe to repeat: GET, PUT, DELETE, read-only POST, comment edits | Other POST and PATCH |
| ---------------------------- | --------------------------------------------------------------- | -------------------- |
| HTTP 429                     | Retried                                                         | Retried              |
| HTTP 408, 500, 502, 503, 504 | Retried                                                         | Not retried          |
| Timeout or network failure   | Retried                                                         | Not retried          |
| Any other failure            | Not retried                                                     | Not retried          |

A POST or PATCH can succeed on the server even when the response never arrives. A retry could
then create a second work item or add a link twice, so the client does not retry them.
`request()` takes `idempotent: true` to allow retries for a request that is safe to repeat.

When Azure DevOps sends `Retry-After`, the client waits that long before its next request,
even when the header arrives on a successful response.

## Development

```sh
npm install
npx playwright install chromium firefox webkit
npm run standards # format, lint, type check, build, and package export checks
npm test          # every test in Node.js, Chromium, Firefox, and WebKit
```

## License

MIT
