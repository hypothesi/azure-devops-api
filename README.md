# Azure DevOps API for TypeScript

Typed, validated access to the Azure DevOps REST API from browsers, Node.js, and any runtime
with `fetch`.

| Package | Contents |
| --- | --- |
| [`@hypothesi/azure-devops-api`](packages/client) | The client: one entry point per API version, every operation generated from the specs, Zod-validated responses, timeouts, and retries |
| [`@hypothesi/azure-devops-openapi`](packages/openapi) | The Azure DevOps REST specs as OpenAPI 3.2, with a manifest of API versions, products, and the changes between versions |

The API reference, with a switcher between API versions, is at
<https://hypothesi.github.io/azure-devops-api/>.

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

```ts
import { createClient, wit } from '@hypothesi/azure-devops-api/services'

const ado = createClient({ organization: 'contoso', auth: { type: 'pat', token: process.env.AZURE_DEVOPS_PAT ?? '' } })

const { data } = await wit.workItemsGetWorkItem({ client: ado, path: { project: 'Web', id: 42 } })
```

See the [client README](packages/client/README.md) for authentication, helpers, errors, and
retries.

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
None has been tested against a real instance yet.

## Development

```sh
npm install
npx playwright install chromium firefox webkit
npm run standards   # generate, format, lint, type check, build, and check package exports
npm test            # every workspace, with the client in Node.js, Chromium, Firefox, and WebKit
npx fallow          # dead code, duplication, complexity, and import boundaries
npx changeset       # describe a change for the next release
```

[docs/architecture.md](docs/architecture.md) describes the workspaces and the import rules
between them.

## License

MIT. The OpenAPI files are converted from Microsoft's
[REST API specs](packages/openapi/NOTICE), which are under the MIT license.
