# Architecture

The repo has three workspaces. Imports go in one direction only:

```text
packages/openapi  -->  packages/client  -->  apps/docs
```

`packages/client` and `apps/docs` read the build output of `packages/openapi`.
`apps/docs` also reads the client's entry point names. Nothing imports from `apps/docs`, and
`packages/openapi` imports from no other workspace.

## `packages/openapi` (`@hypothesi/azure-devops-openapi`)

```text
source/swagger/{apiVersion}/{area}/*.json   Swagger 2.0 files from the Software Heritage snapshot
source/swagger/files.json                   every source file with its git blob hash
overlays/{apiVersion}/{area}.yaml           OpenAPI Overlay 1.0 fixes, applied after conversion
scripts/snapshot.ts                         the pinned snapshot IDs and the supported API versions
scripts/fetch.ts                            downloads and verifies source/
scripts/convert.ts                          builds dist/
scripts/diff.ts                             compares versions and writes the manifest
src/manifest.ts                             Zod schema and types of manifest.json
dist/openapi/{apiVersion}/{area}.json       published: strict OpenAPI 3.2, one file per area
dist/manifest.json                          published: see src/manifest.ts
dist/codegen/{apiVersion}/{area}.json       not published: input for the client generator
dist/docs/{apiVersion}.json                 not published: one document per version for the docs site
```

`convert.ts` makes these changes to every Swagger file. Each one is in a named function
with a test:

1. Removes the UTF-8 byte order mark.
2. Adds `xml: { name: 'svg' }` to inline `image/svg+xml` response schemas, which strict mode
   requires, then upgrades to OpenAPI 3.2 with `@scalar/openapi-upgrader` in strict mode. A
   diagnostic stops the build.
3. Removes `x-ms-examples`. The example files are not part of the snapshot.
4. Replaces a bare `{ "type": "object" }` (no `properties`, no `additionalProperties`) with
   `{}`. The specs use it for "any value", for example the values of `WorkItem.fields`.
   Replaces `JsonPatchDocument` (an object schema whose only `allOf` member is an array) with
   that array schema, and `type: int32` with `type: integer, format: int32`.
5. Removes the `/{organization}` path prefix and the `organization` parameter, and sets
   `servers` to `https://{host}/{organization}` with an `organization` variable. `{host}` is
   the source file's host, for example `dev.azure.com` or `feeds.dev.azure.com`. Areas
   without the prefix, such as `account`, keep `https://{host}`. Trailing slashes are
   removed from path keys. A path template takes the spelling of its parameter, so
   `{DefinitionId}` in build becomes `{definitionId}`. A host variable without a definition,
   such as `{service}` in notification, gets an empty default.
6. Writes each operation's exact API version to `x-ado-api-version`, from the operation's
   `api-version` parameter reference (`api-Version-preview.4` means `7.1-preview.4` in
   7.1).
7. Applies `overlays/`. No overlay exists yet, so `convert.ts` stops if the folder has any
   file other than its README.

An area with several source files becomes one document. When two files define one
component name with different contents, each copy gets the PascalCase file name as a suffix,
for example `PackageNpm`. A file whose host differs from the first file's gets `servers` on
its path items. `dist/docs/{apiVersion}.json` merges the areas the same way, with the area
name as the suffix, and adds `x-tagGroups` with one group per area.

The published files keep the `api-version` parameter and keep Microsoft's `x-ms-paths`
extension. `x-ms-paths` holds a second operation on a path that differs only by a query
string, such as `GET /{project}/_apis/wit/classificationnodes?ids={ids}`. OpenAPI allows
one GET per path, so these operations cannot go in `paths`.

`dist/codegen` and `dist/docs` differ from the published files in these ways:

* `x-ms-paths` operations move into `paths`, with the query string kept in the key.
* `dist/codegen` drops the `api-version` parameter. The client sends it from
  `x-ado-api-version`.
* `dist/codegen` sets `additionalProperties: {}` on object schemas that have `properties`
  and no `additionalProperties`, and changes `format: Stream` to `format: binary`.
* `dist/codegen` lets every property that is not in `required` be `null`. Azure DevOps
  sends `null` for unset properties, for example `description` in `GET _apis/wit/fields`,
  but the specs never mark a property as nullable.
* Every operation in `dist/docs` has `x-ado-area`, the area folder name, for example `wit`.

## `packages/client` (`@hypothesi/azure-devops-api`)

```text
src/core/          Transport, errors, AzureDevOpsClient options, paginate. Imports only zod.
src/generated/     Kubb output. Imports only src/core.
src/helpers/       WorkItems and other hand-written helpers. Imports src/core and src/generated.
src/entries/       One file per subpath export. Imports everything above.
```

Subpath exports:

| Export | Contents |
| --- | --- |
| `.` | `src/core` only: errors, transport types, options |
| `./7.0`, `./7.1` | the client for that API version |
| `./services`, `./server` | the same module as `./7.1` |
| `./server-2022` | the same module as `./7.0` |
| `./compatibility` | the manifest's API versions and products, as typed data |

Every generated function is version-independent. Each entry point has a table from
`${method} ${urlTemplate}` to `[apiVersion, serverIndex]` for its API version.
`src/core/request.ts` adds `api-version` from that table and sends the request to the
operation's host, such as `feeds.dev.azure.com`. Two API versions share one generated area
module when the manifest marks the area `identical`.

`scripts/generate.ts` writes `src/generated`, which git ignores. Its logic is in
`scripts/lib/codegen.ts`, with tests in `test/codegen.test.ts`.

## `apps/docs`

A Vite+ site that renders `dist/docs/{apiVersion}.json` with `@scalar/api-reference`, one
source per API version. It also has a compatibility page built from `dist/manifest.json`.

## Build order

Each workspace defines its tasks in `run.tasks` in its `vite.config.ts`. The `dependsOn`
entries name the upstream task, for example `@hypothesi/azure-devops-openapi#build`, so
`vp run -r build` runs the spec package first, then the client, then the docs site. Vite+
caches each task and restores its outputs when its inputs have not changed.

## Code quality

`npm run quality` runs `fallow`:

* `fallow dead-code` reports unused files, exports, and dependencies.
* `fallow architecture` checks the import rules in `.fallowrc.json`. The zones match the
  folders above, and each zone may import only the zones listed in its rule.
* `fallow dupes` reports duplicated code.
* `fallow health` runs once per workspace with that workspace's coverage report, because
  `--coverage` takes one path.

`fallow` skips git-ignored files, so it does not analyze `src/generated`.
`test/codegen.test.ts` checks that generated files import only from `src/core`.
