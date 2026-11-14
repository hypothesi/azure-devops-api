# Azure DevOps API for TypeScript

A typed client for every Azure DevOps REST API operation. It runs in browsers, Node.js, and
any runtime with `fetch`, and it validates every response with Zod.

```sh
npm install @hypothesi/azure-devops-api zod
```

```ts
import { build, createClient, git } from '@hypothesi/azure-devops-api/services';

const ado = createClient({
   organization: 'contoso',
   auth: { type: 'pat', token: process.env.AZURE_DEVOPS_PAT ?? '' },
});

// Run a WIQL query and get the matching work items.
const myBugs = await ado.workItems.queryWorkItems(
   "SELECT [System.Id] FROM workitems WHERE [System.WorkItemType] = 'Bug' AND [System.AssignedTo] = @Me",
   { project: 'Web' },
);

// File a bug with Markdown repro steps.
const bug = await ado.workItems.create({
   project: 'Web',
   type: 'Bug',
   fields: {
      'System.Title': 'Login button does nothing on iOS',
      'Microsoft.VSTS.TCM.ReproSteps': '1. Open the app\n2. Tap **Log in**',
   },
   markdownFields: ['Microsoft.VSTS.TCM.ReproSteps'],
});

// List the open pull requests that target main.
const { data: pullRequests } = await git.pullRequestsGetPullRequests({
   client: ado,
   path: { project: 'Web', repositoryId: 'web-app' },
   query: { 'searchCriteria.status': 'active', 'searchCriteria.targetRefName': 'refs/heads/main' },
});

// Find the builds that failed on main.
const { data: failedBuilds } = await build.buildsList({
   client: ado,
   path: { project: 'Web' },
   query: { branchName: 'refs/heads/main', resultFilter: 'failed' },
});
```

Each REST API area, such as `wit`, `git`, `build`, `work`, and `pipelines`, is a namespace
with one function per operation. The parameters, request bodies, and responses are typed
from Microsoft's specs.

* A response that does not match its schema throws `ResponseValidationError`, so bad data
  does not reach your code.
* Each failure has its own error class, such as `NotFoundError`, `RateLimitError`, and
  `TimeoutError`.
* Requests have a timeout, accept an `AbortSignal`, and retry with exponential backoff. The
  client does not retry a request that is not safe to repeat, such as creating a work item.

The [client README](packages/client/README.md) has more examples, and the details of
authentication, helpers, errors, and retries. The API reference, with a switcher between API
versions, is at <https://hypothesi.github.io/azure-devops-api/>.

## Packages

| Package | Contents |
| --- | --- |
| [`@hypothesi/azure-devops-api`](packages/client) | The client: one entry point per API version, every operation generated from the specs, Zod-validated responses, timeouts, and retries |
| [`@hypothesi/azure-devops-openapi`](packages/openapi) | The Azure DevOps REST specs as OpenAPI 3.2, with a manifest of API versions, products, and the changes between versions |

## Pick an entry point

Import the entry point for the product your code calls. Every Azure DevOps product accepts
all API versions up to its highest one, so a lower entry point works with more products.

| Import | API version | Works with |
| --- | --- | --- |
| `@hypothesi/azure-devops-api/services` | 7.1 | Azure DevOps Services, Azure DevOps Server |
| `@hypothesi/azure-devops-api/server` | 7.1 | Azure DevOps Services, Azure DevOps Server |
| `@hypothesi/azure-devops-api/server-2022` | 7.0 | Azure DevOps Services, Azure DevOps Server, Azure DevOps Server 2022 |
| `@hypothesi/azure-devops-api/7.1` | 7.1 | same as `/services` |
| `@hypothesi/azure-devops-api/7.0` | 7.0 | same as `/server-2022` |

An entry point exports only the operations that exist in its API version. Calling a 7.1-only
operation from `/7.0` is a type error.

## Versions

The client's version is separate from the Azure DevOps API versions:

| Change | Release type |
| --- | --- |
| New API version entry point, such as 7.2 | Minor |
| Spec update with only identical or additive changes | Minor |
| Spec update with a breaking change in a supported version | Major |
| API version removed because its last product left mainstream support | Major |
| Transport or helper fix | Patch |

The `/compatibility` export and the `azureDevOps` field in the client's `package.json` list the
supported API versions and products. The product rows come from Microsoft's documentation.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup, checks, and tests.

## License

MIT. The OpenAPI files are converted from Microsoft's
[REST API specs](packages/openapi/NOTICE), which are under the MIT license.
