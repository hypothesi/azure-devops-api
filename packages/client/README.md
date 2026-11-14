# @hypothesi/azure-devops-api

A typed client for the Azure DevOps REST API. It runs in browsers, Node.js, Deno, Bun, and
any other runtime with `fetch`.

* It has a function for every operation of every Azure DevOps REST API area, generated from
  the OpenAPI files of `@hypothesi/azure-devops-openapi`.
* Each API version has its own entry point. An operation that your server does not have is a
  type error.
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

`zod` is a peer dependency. The client validates every response with Zod schemas that are
generated from the specs.

## Choose an entry point

Each entry point has the operations of one Azure DevOps REST API version. Import the entry
point of the oldest product that you must support. Every product also accepts all lower API
versions, so the `7.0` entry point works with Azure DevOps Services too.

| Product                              | Entry point                               | Same module as |
| ------------------------------------ | ----------------------------------------- | -------------- |
| Azure DevOps Services                | `@hypothesi/azure-devops-api/services`    | `./7.1`        |
| Azure DevOps Server (newest release) | `@hypothesi/azure-devops-api/server`      | `./7.1`        |
| Azure DevOps Server 2022             | `@hypothesi/azure-devops-api/server-2022` | `./7.0`        |

An entry point does not export the operations that its API version does not have:

```ts
import { wit } from '@hypothesi/azure-devops-api/server-2022';

// Type error: tempQueriesCreate is new in API version 7.1.
await wit.tempQueriesCreate({ client: ado, path: { project: 'Web' }, body: { wiql } });
```

The package root, `@hypothesi/azure-devops-api`, exports only the error classes and the types
that every entry point shares. Every entry point exports them too.

## Quick start

```ts
import { createClient, wit } from '@hypothesi/azure-devops-api/services';

const ado = createClient({
   organization: 'contoso',
   auth: { type: 'pat', token: process.env.AZURE_DEVOPS_PAT ?? '' },
});

const { data: workItem } = await wit.workItemsGetWorkItem({
   client: ado,
   path: { project: 'Web', id: 42 },
   query: { fields: 'System.Title,System.State' },
});

console.log(workItem.fields?.['System.Title']);
```

`organization` accepts an organization name (`contoso`) or a full URL. Use a full URL for
Azure DevOps Server, for example `https://tfs.example.com/DefaultCollection`.

## Generated operations

Each entry point exports one namespace per REST API area, such as `wit`, `core`, `git`,
`work`, and `artifacts`. A namespace has a function for each operation and the TypeScript
types of the area.

Each function takes the client in `client`, the path parameters in `path`, the query
parameters in `query`, and the request body in `body`. It resolves to `{ data, status,
headers }`. On failure it throws one of the [errors](#errors).

```ts
import { core, createClient, git, wit } from '@hypothesi/azure-devops-api/7.1';

const ado = createClient({ organization: 'contoso', auth: { type: 'pat', token: myPAT } });

// The client sends the api-version of each operation. For this operation it is 7.1-preview.4.
const { data: comment } = await wit.commentsGetComment({
   client: ado,
   path: { project: 'Web', workItemId: 42, commentId: 7 },
});

// A list operation resolves to the array. Some operations send a continuation token in a header.
const { data: repositories } = await git.repositoriesList({ client: ado, path: { project: 'Web' } });
const { data: projects, headers } = await core.projectsList({ client: ado, query: { $top: 100 } });
const nextPage = headers.get('x-ms-continuationtoken');
```

The types of an area are in the same namespace, for example `wit.Comment` and
`git.GitRepository`.

Some areas have their own host on Azure DevOps Services, for example `artifacts` on
`feeds.dev.azure.com`. The client sends their operations to that host. On Azure DevOps
Server, every operation goes to the collection URL.

## Authentication

A personal access token:

```ts
const ado = createClient({
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

const ado = createClient({
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

## Helpers

The client also has helpers for common tasks. They build JSON Patch bodies, split long ID
lists, and follow continuation tokens.

### Work items

```ts
// Get many work items. The client splits the IDs into requests of 200.
const workItems = await ado.workItems.list([1, 2, 3], { fields: ['System.Title', 'System.State'] });

// Run a WIQL query and get the matching work items.
const mine = await ado.workItems.queryWorkItems(
   "SELECT [System.Id] FROM workitems WHERE [System.AssignedTo] = @Me AND [System.State] <> 'Closed'",
   { project: 'Web' },
);

// Create a bug with Markdown repro steps and a parent.
const bug = await ado.workItems.create({
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
await ado.workItems.update(42, {
   expectedRevision: 1,
   fields: { 'System.State': 'Active' },
});
```

Azure DevOps strips text that looks like an HTML tag from Markdown fields, even inside code
spans. `<name>` is stored as an empty string. Write placeholders as `{name}`.

`addComment` and `updateComment` send `format=markdown` by default on API version 7.1. API
version 7.0 has no `format` parameter for comments, so a 7.0 client sends none and throws
`InvalidInputError` when you pass `format`.

#### Attachments

```ts
const file = new Blob([pngBytes], { type: 'image/png' }),
   attachment = await ado.workItems.uploadAttachment({ project: 'Web', fileName: 'screen.png', content: file });

await ado.workItems.update(42, { relations: [{ rel: 'AttachedFile', url: attachment.url ?? '' }] });
```

### Iterations

```ts
const sprint = await ado.work.getCurrentIteration('Web', 'Web Team');
```

### Paginated results

Helpers that return many pages are async generators. They request the next page only when
the loop needs it:

```ts
for await (const comment of ado.workItems.listComments('Web', 42)) {
   console.log(comment.text);
}

const projects = await Array.fromAsync(ado.projects.list());
const results = await Array.fromAsync(ado.workItems.search('login timeout', { project: 'Web' }));
```

## Other endpoints

`ado.request()` calls any endpoint under the organization URL with the same auth, timeout,
retry, and error handling. It sends the API version of the entry point unless you pass
`apiVersion`. Pass a Zod schema for the response:

```ts
import { z } from 'zod';

const { data } = await ado.request({
   path: ['Web', '_apis', 'git', 'repositories'],
   schema: z.object({ value: z.array(z.object({ id: z.string(), name: z.string() })) }),
});
```

The client percent-encodes each path segment. It sends credentials only to the organization
URL, the search URL, and the hosts of the generated operations.

## Examples

Each example uses the `ado` client from the [quick start](#quick-start).

### List open pull requests and their approvals

A reviewer vote of `10` is "approved" and `5` is "approved with suggestions":

```ts
import { git } from '@hypothesi/azure-devops-api/services';

const { data: pullRequests } = await git.pullRequestsGetPullRequests({
   client: ado,
   path: { project: 'Web', repositoryId: 'web-app' },
   query: { 'searchCriteria.status': 'active', 'searchCriteria.targetRefName': 'refs/heads/main' },
});

for (const pr of pullRequests) {
   const approvals = (pr.reviewers ?? []).filter((reviewer) => {
      return (reviewer.vote ?? 0) >= 5;
   });

   console.log(`!${pr.pullRequestId} ${pr.title} by ${pr.createdBy?.displayName}: ${approvals.length} approvals`);
}
```

### Post a comment on a pull request from CI

A thread with `status: 'closed'` shows the comment without asking the author to resolve it:

```ts
await git.pullRequestThreadsCreate({
   client: ado,
   path: { project: 'Web', repositoryId: 'web-app', pullRequestId: 123 },
   body: {
      comments: [{ content: 'Bundle size: **412 kB** (+3 kB)', commentType: 'text' }],
      status: 'closed',
   },
});
```

### Queue the builds that failed on main in the last day

```ts
import { build } from '@hypothesi/azure-devops-api/services';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const { data: failedBuilds } = await build.buildsList({
   client: ado,
   path: { project: 'Web' },
   query: {
      branchName: 'refs/heads/main',
      resultFilter: 'failed',
      minTime: new Date(Date.now() - ONE_DAY_MS).toISOString(),
   },
});

const retries = await Promise.all(
   failedBuilds.map((failed) => {
      return build.buildsQueue({
         client: ado,
         path: { project: 'Web' },
         body: { definition: failed.definition ?? null, sourceBranch: failed.sourceBranch ?? null },
      });
   }),
);
```

### Count the work items of the current sprint by state

```ts
import { work } from '@hypothesi/azure-devops-api/services';

const sprint = await ado.work.getCurrentIteration('Web', 'Web Team');

const { data: iteration } = await work.iterationsGetIterationWorkItems({
   client: ado,
   path: { project: 'Web', team: 'Web Team', iterationId: sprint?.id ?? '' },
});

const ids = (iteration.workItemRelations ?? []).flatMap((relation) => {
   const id = relation.target?.id;

   return typeof id === 'number' ? [id] : [];
});

const workItems = await ado.workItems.list(ids, { fields: ['System.State'] }),
   byState = Map.groupBy(workItems, (item) => {
      return String(item.fields?.['System.State']);
   });

for (const [state, items] of byState) {
   console.log(`${state}: ${items.length}`);
}
```

### Handle a work item that does not exist

```ts
import { NotFoundError } from '@hypothesi/azure-devops-api/services';

try {
   await ado.workItems.get(999_999);
} catch (error) {
   if (error instanceof NotFoundError) {
      console.log('Work item 999999 does not exist');
   } else {
      throw error;
   }
}
```

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
import { NotFoundError } from '@hypothesi/azure-devops-api';
import { wit } from '@hypothesi/azure-devops-api/services';

async function findWorkItem(id: number): Promise<wit.WorkItem | undefined> {
   try {
      return (await wit.workItemsGetWorkItem({ client: ado, path: { project: 'Web', id } })).data;
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
const ado = createClient({
   organization: 'contoso',
   auth: { type: 'pat', token: myPAT },
   timeoutMs: 30_000, // per attempt, including the response body
   retry: { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 30_000 },
   onRetry: ({ attempt, delayMs, error }) => {
      console.warn(`Attempt ${attempt} failed, retrying in ${delayMs} ms`, error);
   },
});

// Per call, for helpers and generated operations:
await ado.workItems.get(42, { timeoutMs: 5_000, signal: AbortSignal.timeout(20_000) });
await wit.workItemsGetWorkItem({ client: ado, path: { project: 'Web', id: 42 }, timeoutMs: 5_000 });
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
Generated POST operations are not retried after a timeout or a 5xx response.

When Azure DevOps sends `Retry-After`, the client waits that long before its next request,
even when the header arrives on a successful response.

## Supported versions

`getCompatibility()` describes what this client version supports. It is exported from the
package root and from `@hypothesi/azure-devops-api/compatibility`. Every API version,
product, and entry point has an `id` for code and a `label` for UI text.

```ts
import { getCompatibility, getEntryPoint, isSupportedApiVersion } from '@hypothesi/azure-devops-api';

const compatibility = getCompatibility();

compatibility.clientVersion; // '0.1.0'
compatibility.apiVersions.map((version) => version.id); // ['7.0', '7.1']
compatibility.apiVersions.map((version) => version.label); // ['Azure DevOps REST API 7.0', 'Azure DevOps REST API 7.1']
compatibility.products.map((product) => product.label); // ['Azure DevOps Services', 'Azure DevOps Server', 'Azure DevOps Server 2022']

getEntryPoint('server-2022');
// { id: 'server-2022', label: 'Azure DevOps Server 2022 (REST API 7.0)',
//   importPath: '@hypothesi/azure-devops-api/server-2022', apiVersion: '7.0',
//   products: ['services', 'server', 'server-2022'] }

isSupportedApiVersion('7.2'); // false
```

| Export | Contents |
| --- | --- |
| `getCompatibility()` | `clientVersion`, `specSnapshot`, and the lists `apiVersions`, `products`, and `entryPoints` |
| `getEntryPoint(id)` | the entry point for an API version or a product |
| `SUPPORTED_API_VERSIONS` | `['7.0', '7.1']`, typed as `ApiVersion[]` |
| `isSupportedApiVersion(value)` | a type guard for `ApiVersion`, for example for a version read from settings |
| `isProductID(value)` | a type guard for `ProductID` |

Each product lists `highestApiVersion`, the `source` of that value, and `verifiedOn`, which
is `null` until someone tests the product against a real instance.

`@hypothesi/azure-devops-api/compatibility` also exports the raw generated objects
`apiVersions`, `products`, `clientVersion`, and `specSnapshot`. The `azureDevOps` field of
`package.json` has the API versions and the snapshot, so tools can read them without running
code.

## Development

```sh
npm install
npx playwright install chromium firefox webkit
npm run generate  # build @hypothesi/azure-devops-openapi and write src/generated
npm run standards # generate, format, lint, type check, build, and package export checks
npm test          # generate, then run every test in Node.js, Chromium, Firefox, and WebKit
```

`src/generated` is not in git. `scripts/generate.ts` writes it from the codegen files and the
manifest of `@hypothesi/azure-devops-openapi`:

* `{area}/{apiVersion}/`: the Kubb output for one area. When the manifest marks an area
  `identical` in the next API version, both versions use the folder of the first one.
* `{apiVersion}/index.ts`: one namespace per area.
* `{apiVersion}/operations.ts`: the `api-version` and the host of every operation.
* `compatibility.ts`: the API versions and products of the manifest.

## License

MIT
