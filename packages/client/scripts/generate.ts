/**
 * Generates `src/generated` from the codegen files and the manifest of
 * `@hypothesi/azure-devops-openapi`:
 *
 * * `{area}/{apiVersion}/`: Kubb output for one area. Consecutive API versions whose manifest
 *   change is `identical` share the folder of the first version.
 * * `{apiVersion}/index.ts`: one namespace per area, from the right folder.
 * * `{apiVersion}/operations.ts`: the API version and server of every operation.
 * * `compatibility.ts`: the client version and the manifest's API versions and products.
 *
 * Run it with `npm run generate`. The output depends only on its input files.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterOas } from '@kubb/adapter-oas';
import { pluginClient } from '@kubb/plugin-client';
import { pluginTs } from '@kubb/plugin-ts';
import { pluginZod } from '@kubb/plugin-zod';
import { createKubb } from 'kubb';
import { type Manifest, ManifestSchema } from '@hypothesi/azure-devops-openapi/manifest';
import {
   type AreaModule,
   BANNER,
   buildOperationTable,
   getOperationsSource,
   getVersionIndexSource,
   groupVersions,
   isStringEnum,
   type OpenAPIDocument,
   parseClientVersion,
} from './lib/codegen.ts';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
   OPENAPI_DIST = path.dirname(fileURLToPath(import.meta.resolve('@hypothesi/azure-devops-openapi/manifest.json'))),
   OUTPUT_DIR = path.join(PACKAGE_DIR, 'src/generated');

const manifest = ManifestSchema.parse(JSON.parse(await readFile(path.join(OPENAPI_DIST, 'manifest.json'), 'utf8'))),
   apiVersions = Object.keys(manifest.apiVersions).toSorted(compareVersions),
   modules = Object.keys(manifest.areas)
      .toSorted()
      .flatMap((area) => {
         return groupVersions(area, manifest, apiVersions);
      });

await rm(OUTPUT_DIR, { recursive: true, force: true });
await Promise.all(modules.map(generateArea));
await Promise.all(apiVersions.map(writeVersion));
await writeFile(path.join(OUTPUT_DIR, 'compatibility.ts'), getCompatibilitySource(manifest, await readClientVersion()));

console.log(`Generated ${modules.length} area modules for API versions ${apiVersions.join(', ')} in ${OUTPUT_DIR}`);

function compareVersions(a: string, b: string): number {
   return a.localeCompare(b, 'en', { numeric: true });
}

async function readSpec(apiVersion: string, area: string): Promise<OpenAPIDocument> {
   return JSON.parse(await readFile(path.join(OPENAPI_DIST, 'codegen', apiVersion, `${area}.json`), 'utf8'));
}

async function generateArea(module: AreaModule): Promise<void> {
   const root = path.join(OUTPUT_DIR, module.area, module.folder),
      kubb = createKubb({
         root,
         input: await readSpec(module.folder, module.area),
         output: { path: '.', clean: false },
         // Azure DevOps sends dates as ISO strings and 64-bit numbers as JSON numbers.
         adapter: adapterOas({ validate: false, dateType: false, integerType: 'number' }),
         plugins: [
            pluginTs({ output: { path: 'types.ts' } }),
            pluginZod({
               output: { path: 'zod.ts' },
               // Azure DevOps IDs are GUIDs that are not always RFC 4122 UUIDs.
               guidType: 'guid',
               // Microsoft adds enum values within an API version, so a response with a new value must still parse.
               printer: {
                  nodes: {
                     enum(node) {
                        const base = this.base(node);

                        return base !== null && isStringEnum(node) ? `${base}.or(z.string())` : base;
                     },
                  },
               },
            }),
            pluginClient({ output: { path: 'clients.ts' }, importPath: '../../../core/request', validator: 'zod' }),
         ],
      }),
      result = await kubb.safeBuild(),
      errors = result.diagnostics.filter((diagnostic) => {
         return diagnostic.severity === 'error';
      });

   if (errors.length > 0) {
      throw new Error(
         `Kubb failed for ${module.area} ${module.folder}:\n${errors
            .map((diagnostic) => {
               return diagnostic.message;
            })
            .join('\n')}`,
      );
   }

   await requireClientOption(path.join(root, 'clients.ts'));
   await writeFile(path.join(root, 'index.ts'), `${BANNER}export * from './clients';\nexport * from './types';\n`);
}

/**
 * Kubb gives `options` a default of `{}` when every option is optional. The `client` option
 * is required, so the default does not type check. Removing it makes `options` required.
 */
async function requireClientOption(file: string): Promise<void> {
   const source = await readFile(file, 'utf8');

   await writeFile(file, source.replaceAll(/(options: Options<[^>]+>) = \{\}/g, '$1'));
}

async function writeVersion(apiVersion: string): Promise<void> {
   const versionModules = modules.filter((module) => {
         return module.apiVersions.includes(apiVersion);
      }),
      specs = await Promise.all(
         versionModules.map(async (module) => {
            return { module, spec: await readSpec(apiVersion, module.area) };
         }),
      ),
      table = buildOperationTable(apiVersion, specs),
      directory = path.join(OUTPUT_DIR, apiVersion);

   await Promise.all(versionModules.map(assertURLsInTable(table.operations)));
   await mkdir(directory, { recursive: true });
   await writeFile(path.join(directory, 'index.ts'), getVersionIndexSource(versionModules));
   await writeFile(path.join(directory, 'operations.ts'), getOperationsSource(apiVersion, table));
}

/**
 * Checks that every URL that Kubb wrote is a key of the table. A mismatch would make the
 * operation throw at runtime, so it fails the build instead.
 */
function assertURLsInTable(operations: ReadonlyMap<string, unknown>): (module: AreaModule) => Promise<void> {
   return async (module) => {
      const source = await readFile(path.join(OUTPUT_DIR, module.area, module.folder, 'clients.ts'), 'utf8'),
         missing = [...source.matchAll(/request\(\{ method: '(\w+)', url: '([^']*)'/g)]
            .map(([, method, url]) => {
               return `${method} ${url}`;
            })
            .filter((key) => {
               return !operations.has(key);
            });

      if (missing.length > 0) {
         throw new Error(
            `${module.area} ${module.folder}: generated URLs missing from the table:\n${missing.join('\n')}`,
         );
      }
   };
}

/** Changesets updates package.json, so the generated version always matches the release. */
async function readClientVersion(): Promise<string> {
   return parseClientVersion(JSON.parse(await readFile(path.join(PACKAGE_DIR, 'package.json'), 'utf8')));
}

function getCompatibilitySource(data: Manifest, clientVersion: string): string {
   const snapshot = data.source.specificationDirectory.startsWith('swh:')
      ? data.source.specificationDirectory
      : `swh:1:dir:${data.source.specificationDirectory}`;

   return (
      BANNER +
      `/** The version of @hypothesi/azure-devops-api that this code was generated for. */\n` +
      `export const clientVersion = ${JSON.stringify(clientVersion)};\n\n` +
      `/** The Software Heritage ID of the spec folder that the generated code comes from. */\n` +
      `export const specSnapshot = ${JSON.stringify(snapshot)};\n\n` +
      `/** Each supported API version and the products that accept it. */\n` +
      `export const apiVersions = ${JSON.stringify(data.apiVersions, undefined, 3)} as const;\n\n` +
      `/** Each Azure DevOps product and the highest API version it accepts. */\n` +
      `export const products = ${JSON.stringify(data.products, undefined, 3)} as const;\n`
   );
}
