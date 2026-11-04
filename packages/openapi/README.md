# @hypothesi/azure-devops-openapi

The Azure DevOps REST API as strict OpenAPI 3.2 files, one file per area and API version,
with a manifest that lists which Azure DevOps products accept each API version.

The files are converted from Microsoft's Swagger 2.0 specifications in the archived
[MicrosoftDocs/vsts-rest-api-specs](https://github.com/MicrosoftDocs/vsts-rest-api-specs)
repository. `source/SOURCE.md` lists the Software Heritage snapshot that the build uses.

## Contents

| Path | Contents |
| --- | --- |
| `dist/openapi/{apiVersion}/{area}.json` | OpenAPI 3.2, for API versions `7.0` and `7.1` |
| `dist/manifest.json` | API versions, products, and a per-area comparison of each version with the one before it |
| `dist/manifest.js` | The Zod schema and TypeScript types of `manifest.json` |

`{area}` is Microsoft's folder name, for example `wit`, `git`, `core`, or `work`.

## Install

```sh
npm install @hypothesi/azure-devops-openapi
```

Install `zod` 4 too if you import `./manifest`.

## Usage

Import a spec:

```ts
import wit from '@hypothesi/azure-devops-openapi/openapi/7.1/wit.json' with { type: 'json' };

console.log(wit.servers[0].url); // https://dev.azure.com/{organization}
```

Read the manifest:

```ts
import manifest from '@hypothesi/azure-devops-openapi/manifest.json' with { type: 'json' };

console.log(manifest.apiVersions['7.0'].products); // ['services', 'server', 'server-2022']
console.log(manifest.areas.git.versions['7.1'].comparedToPrevious?.change); // 'additive'
```

Validate or type the manifest with its Zod schema:

```ts
import { ManifestSchema, type Manifest } from '@hypothesi/azure-devops-openapi/manifest';

const manifest: Manifest = ManifestSchema.parse(await (await fetch(url)).json());
```

Each area version in the manifest has `comparedToPrevious.change`:

* `identical`: same operations, parameters, request bodies, and schemas as the version before
* `additive`: only new operations, new optional properties, new optional parameters, or new
  enum values
* `breaking`: removed operations or properties, changed types, or new required inputs

`changes` lists each difference on one line, for example
`schema Comment: property format added`.

## Changes from the Microsoft source

`scripts/convert.ts` makes these changes to every Swagger file. Each change is a function in
`scripts/lib/transforms.ts` with a test in `test/transforms.test.ts`.

1. Removes the UTF-8 byte order mark that some files start with.
2. Adds `xml: { name: 'svg' }` to `image/svg+xml` response schemas, then upgrades to OpenAPI
   3.2 with `@scalar/openapi-upgrader` in strict mode. Any upgrade diagnostic stops the build.
3. Removes `x-ms-examples`. The example files are not part of the snapshot.
4. Replaces a bare `{ "type": "object" }` with `{}`. Microsoft uses it for "any value", for
   example the values of `WorkItem.fields`.
   `JsonPatchDocument`, an object schema whose only `allOf` member is an array, becomes that
   array schema. `type: int32` in notification becomes `type: integer, format: int32`.
5. Removes the `/{organization}` path prefix and the `organization` parameter, and sets
   `servers` to `https://{host}/{organization}`. For example, `wit` uses
   `https://dev.azure.com/{organization}`. Areas whose paths have no organization, such as
   `account`, keep the host as the server URL.
6. Removes trailing slashes from path keys, and changes `{DefinitionId}` in build paths to
   `{definitionId}`, the name of the parameter. Notification's host `{service}dev.azure.com`
   gets a `service` server variable with an empty default.
7. Writes the exact API version of each operation to `x-ado-api-version`, for example
   `7.1-preview.4`.

Areas with several source files, such as `artifactsPackageTypes`, become one file. When two
files define one component name with different contents, each copy gets the file name as a
suffix, for example `PackageNpm` and `PackageMaven`. The area title joins the titles of the
files.

The published files keep the `api-version` parameter, the `info.license` field, and
Microsoft's `x-ms-paths` extension. `x-ms-paths` holds a second operation on a path that
differs only by a query string, such as `GET /{project}/_apis/wit/classificationnodes?ids={ids}`.

Every published file passes `redocly lint` with the rules in `redocly.yaml`. The rules that
are turned off are ones the Microsoft source cannot satisfy, such as `operation-summary`.

## Build

From the repository root:

```sh
npm run build
npm run test:node
```

The package build runs `scripts/convert.ts`, `scripts/diff.ts`, `redocly lint`, and
`vp pack`. It also writes `dist/codegen` and `dist/docs`, which the client generator and the
docs site read. They are not published.

## License

MIT. See `NOTICE` for the license of Microsoft's source specifications.
