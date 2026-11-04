# Plan: OpenAPI monorepo with per-version clients

## Goal

* One package publishes the Azure DevOps OpenAPI documents, converted from Microsoft's last
  archived Swagger 2.0 files to OpenAPI 3.2.
* The client package gives each consumer only the types and methods of the API version that
  their server accepts.
* A manifest maps each client entry point to the API versions and Azure DevOps products it
  works with. The package, the README, and the docs site all read the same manifest.
* The docs site has a version switcher.

## Facts this plan uses

Measured on 2026-11-04:

* **Spec source.** `MicrosoftDocs/vsts-rest-api-specs` returns 404 on GitHub. Software
  Heritage has a full snapshot from 2026-09-12. Its newest commit is `c7e66d98`
  (2026-09-03, "Update REST API specs from releases/M279"). The `specification` folder is
  `swh:1:dir:eb5a1ee87e2a2fe00bd29c737b8f12aa68693ac3`: 47 areas and 465 area/version
  folders.
* **Specs change after release.** A copy from 2023-07 matches the snapshot in 37 of 40
  areas for 7.0, but in only 8 of 41 areas for 7.1. So every build must use one pinned
  snapshot.
* **Products and API versions** (Microsoft Lifecycle and the REST versioning page):

  | Product | Highest API version | Mainstream support ends |
  | --- | --- | --- |
  | Azure DevOps Services | 7.1 released, 7.2 preview | n/a |
  | Azure DevOps Server (modern lifecycle, 2025-12-09) | not documented, at least some 7.2-preview calls | In support |
  | Azure DevOps Server 2022 | 7.0 | 2028-01-12 |
  | Azure DevOps Server 2020 | 6.0 | ended 2025-10-15 |
  | Azure DevOps Server 2019 | 5.0 | ended 2024-04-10 |

  Every product accepts all API versions up to its highest one.
* **Version differences** (operations and schemas, ignoring descriptions and examples):

  | Area | 7.0 to 7.1 | 7.1 to 7.2 |
  | --- | --- | --- |
  | wit | 81 to 85 operations, 0 removed, 0 breaking | 85 to 89, 0 removed, 0 breaking |
  | core | 18 to 19, 0 removed, 0 breaking | 19 to 19, 0 breaking |
  | work | 57 to 57, 0 breaking | 57 to 59, 0 breaking |
  | git | 111 to 111, 1 enum change | 111 to 112, 3 breaking (one property removed) |

* **Per-operation versions.** Each operation has its own version in
  `x-ms-docs-override-version`. In wit 7.1, 71 operations use `7.1` and 14 use
  `7.1-preview.1` through `7.1-preview.4`. Every 7.2 operation is a preview.
* **Converter.** `@scalar/openapi-upgrader` 0.4.6 (MIT) upgrades Swagger 2.0 to 3.0, 3.1,
  or 3.2. When it targets 3.2, it stops on incompatibilities, or with `onIncompatible: 'collect'`
  it returns a 3.1 document plus diagnostics.
* **Generator.** Kubb `@kubb/adapter-oas` 5.15.3 documents input up to OpenAPI 3.1. Its
  changelog does not mention 3.2.
* **Docs renderer.** `@scalar/api-reference` 1.76.4 (MIT) supports OpenAPI 3.2 and takes a
  list of documents with a switcher (`sources`, with `title`, `slug`, and `default`).
* **Linter.** `@redocly/cli` 2.75.0 (MIT) reads Swagger 2.0 and OpenAPI 3.0, 3.1, and 3.2.

## Supported versions

Support API versions that a product in mainstream support uses:

* **7.0**: Azure DevOps Server 2022.
* **7.1**: Azure DevOps Services and, if the server check (step 7) confirms it, the newest
  Azure DevOps Server.

Drop 6.x and older. Azure DevOps Server 2020 left mainstream support on 2025-10-15.

Do not ship 7.2 until Microsoft releases it. Every 7.2 operation is a preview, and previews
can change without notice. When 7.2 releases, add it as a new entry point in a minor
release.

## Repository layout

npm workspaces, with one root `vite.config.ts` for lint, format, and task settings:

```text
packages/
  openapi/       @hypothesi/azure-devops-openapi    spec files and manifest, no runtime code
  client/        @hypothesi/azure-devops-api        transport, generated code, helpers
apps/
  docs/          private, the docs site
```

The current library moves to `packages/client` in its own commit, with no content changes.

## Package 1: `@hypothesi/azure-devops-openapi`

```text
packages/openapi/
  source/
    SOURCE.md                    SWHIDs, commit, and how to verify them
    swagger/7.0/wit/workItemTracking.json
    swagger/7.1/...
  overlays/                      OpenAPI Overlay 1.0 files for spec fixes
  dist/
    openapi/7.0/wit.json         OpenAPI 3.2, one file per area
    openapi/7.0/azure-devops.json  every area in one document, for the docs site
    openapi/7.1/...
    manifest.json
  scripts/
    fetch.ts  convert.ts  diff.ts  validate.ts
```

Build steps:

1. `fetch.ts` downloads `swh:1:dir:eb5a1ee8...` from the Software Heritage vault. It checks
   the git tree hash of each area/version folder and copies only `7.0` and `7.1`. The
   result goes into `source/` in git, so a build never needs the network.
2. `convert.ts`:
   * removes the UTF-8 byte order mark that some files start with,
   * upgrades to OpenAPI 3.2 with `upgrade(document, '3.2')` in strict mode,
   * applies the files in `overlays/`,
   * replaces `host: dev.azure.com` with a `servers` entry that has an `organization`
     variable and works for a server URL too,
   * writes each operation's exact version to `x-ado-api-version`, for example
     `7.1-preview.4`.

   A failed strict upgrade stops the build and prints the diagnostics. It does not fall
   back to 3.1.
3. `diff.ts` compares every area between neighboring versions and writes the results to
   `manifest.json` (see the manifest section).
4. `validate.ts` runs `redocly lint` on every output file.

The published package contains `dist/` and the manifest only. Consumers import
`@hypothesi/azure-devops-openapi/7.1/wit.json` or read the manifest.

## Package 2: `@hypothesi/azure-devops-api`

### Entry points

Each supported API version is a subpath export. A product alias points at the highest API
version that the product accepts:

```ts
import { AzureDevOpsClient } from '@hypothesi/azure-devops-api/7.0'
import { AzureDevOpsClient } from '@hypothesi/azure-devops-api/server-2022'  // same module as /7.0
import { AzureDevOpsClient } from '@hypothesi/azure-devops-api/services'     // same module as /7.1
```

The `7.0` entry point has no 7.1-only operations. A call that does not exist in 7.0 is a
type error, not a runtime 404. Because every product accepts older API versions, the `7.0`
entry point also works with Azure DevOps Services. A consumer that targets several products
picks the lowest entry point that has the operations they need.

The package root (`@hypothesi/azure-devops-api`) exports only the version-independent
parts: errors, `Transport` types, and the manifest.

### Generated code

Kubb runs once per API version with `@kubb/plugin-ts`, `@kubb/plugin-zod`, and
`@kubb/plugin-client`. `@kubb/plugin-client` generates functions that call a client module
we write. That module is a small adapter over the existing `Transport`, so timeouts,
retries, `Retry-After`, the origin check, and the error classes stay as they are. Each
generated function sends its operation's `x-ado-api-version`, not one version for the whole
client.

Kubb documents input only up to OpenAPI 3.1. Step 2 tests whether it reads our 3.2 files.
If it does not, `convert.ts` also writes a 3.1 build with `upgrade(document, '3.1')`, used
only for generation. The published spec package stays at 3.2.

### Sharing code between versions

`diff.ts` decides per area whether two versions can share one generated module:

* **Identical**: the contract is the same apart from version strings. Both entry points
  import one module. For example, if core 7.0 and core 7.1 are identical, the package has
  one `core` module.
* **Additive**: added operations or added optional response properties only. Each version
  gets its own module, so the 7.0 entry point does not show the 7.1 additions.
* **Breaking**: removed operations or properties, changed types, or new required inputs.
  Each version gets its own module, and the docs list the differences.

This keeps the package small without showing a consumer an operation that their server
does not have.

### Hand-written helpers

The work item helpers (`WorkItems.create`, `update` with `expectedRevision`, batching of
200 IDs, and `paginate`) stay. They use the generated types. Each helper is exported only
from entry points whose generated types support it.

### Response schemas

Generated Zod schemas use `z.looseObject`, so a property that Microsoft adds later does not
break parsing. Enums from the spec accept unknown strings. The git 7.0 to 7.1 change shows
that Microsoft adds enum values inside a version.

## The compatibility manifest

`manifest.json` is the source for the package exports, the README table, and the docs
site:

```json
{
   "specSnapshot": "swh:1:dir:eb5a1ee87e2a2fe00bd29c737b8f12aa68693ac3",
   "apiVersions": {
      "7.0": { "status": "released", "products": ["services", "server", "server-2022"] },
      "7.1": { "status": "released", "products": ["services"] }
   },
   "products": {
      "services": { "name": "Azure DevOps Services", "highestApiVersion": "7.1" },
      "server-2022": { "name": "Azure DevOps Server 2022", "highestApiVersion": "7.0" }
   },
   "areas": {
      "core": { "7.0": { "operations": 18 }, "7.1": { "operations": 19, "comparedTo7.0": "additive" } }
   }
}
```

The client package exports it as `@hypothesi/azure-devops-api/compatibility`, typed with a
Zod schema. Its `package.json` also has the supported API versions, so tools can read them
without running code:

```json
"azureDevOps": { "apiVersions": ["7.0", "7.1"], "specSnapshot": "swh:1:dir:eb5a1ee8..." }
```

### Library versions and API versions

The client package uses semver. Its version is separate from the API versions:

| Change | Release type |
| --- | --- |
| New API version entry point, such as 7.2 | Minor |
| Spec update with only identical or additive changes | Minor |
| Spec update with a breaking change in a supported version | Major |
| API version removed because its last product left mainstream support | Major |
| Transport or helper fix | Patch |

The docs site and the README have a table with one row per release line:

| Client versions | API versions | Products |
| --- | --- | --- |
| 1.x | 7.0, 7.1 | Services, Server, Server 2022 |

Changesets (`@changesets/cli` 3.0.3, MIT) records the release type of each change and
writes the changelogs for both packages.

## Docs site (`apps/docs`)

* Built with Vite+ and deployed to GitHub Pages with `actions/upload-pages-artifact@v5`
  (v5.0.0), `actions/configure-pages@v6` (v6.0.0), and `actions/deploy-pages@v5` (v5.0.1),
  pinned to commit SHAs.
* `@scalar/api-reference` renders `openapi/{version}/azure-devops.json`, with one source per
  API version:

  ```ts
  Scalar.createApiReference('#app', {
     sources: [
        { title: '7.1 (Azure DevOps Services)', slug: '7.1', url: './openapi/7.1/azure-devops.json', default: true },
        { title: '7.0 (Azure DevOps Server 2022)', slug: '7.0', url: './openapi/7.0/azure-devops.json' },
     ],
  })
  ```

  The selected version is in the URL, so a link opens the same version.
* Each operation gets an `x-codeSamples` entry with the client call and the import path for
  that version. This is added by the docs build only, not to the published spec.
* A compatibility page, generated from the manifest, shows:
  * the client versions, API versions, and products table,
  * which entry point to import for each product,
  * per area and version, whether the next version is identical, additive, or breaking,
    with the list of changes.

## Steps

1. **Move to a monorepo.** Move the current code to `packages/client` (one commit with
   moves only). Add npm workspaces, the root `vite.config.ts`, and `vp run` tasks. CI
   passes with no other changes.
2. **Test Kubb.** Generate wit 7.1 through `@kubb/plugin-client` and `@kubb/plugin-zod`
   against the transport adapter. Check that Kubb reads 3.2, that the output passes
   `vp check`, and that the existing `WorkItems` tests pass with the generated types. If
   Kubb fails, decide between the 3.1 build and `@hey-api/openapi-ts` before continuing.
3. **Spec package.** `fetch.ts`, `convert.ts`, `diff.ts`, `validate.ts`, `overlays/`, and
   the manifest, for 7.0 and 7.1, all 47 areas that exist in those versions.
4. **Generated clients.** Per-version entry points, product aliases, shared modules for
   identical areas, and the compatibility export. A type test checks that a 7.1-only
   operation is a type error from `/7.0`.
5. **Helpers on generated types.** Port `WorkItems`, `Projects`, and `Work` to the
   generated types. Delete the hand-written schemas that the generated ones replace.
6. **Docs site** with the version switcher, code samples, and compatibility page. Add the
   Pages deploy workflow.
7. **Check against real servers.** Read-only smoke tests against Azure DevOps Services, and
   against Server 2022 and the newest Azure DevOps Server if test instances are available.
   Read each server's highest API version from `OPTIONS {collection}/_apis/` and record it
   in the manifest. This check settles which products the 7.1 entry point supports.
8. **Release.** Changesets, publish workflows for both packages, and the README table.

## Decisions for you

1. **Spec license.** The repo's `LICENSE` file is MIT ("Copyright (c) 2018 Microsoft
   Docs"). Each spec file's `info.license` is "MICROSOFT SOFTWARE LICENSE TERMS"
   (`https://go.microsoft.com/fwlink/?LinkId=329770`). Publishing the converted files on
   npm, and code generated from them, needs a decision on which license applies.
2. **7.2 preview.** The plan leaves 7.2 out until Microsoft releases it. The other choice is
   a `/7.2-preview` entry point that is marked unstable and excluded from semver.
3. **Areas.** The plan generates every area that exists in 7.0 and 7.1. Some areas, such as
   `advancedSecurity`, are not in the docs table of contents.
4. **Test servers.** Step 7 needs a Server 2022 instance and an instance of the newest Azure
   DevOps Server to confirm the product table. Without them, the manifest lists those
   products as not checked.
