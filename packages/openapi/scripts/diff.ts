/**
 * Compares each area between neighboring API versions and writes `dist/manifest.json`.
 * Run after `convert.ts`.
 *
 * Usage: node scripts/diff.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManifestSchema } from '../src/manifest.ts';
import type { AreaVersion, ChangeKind, Manifest, Product } from '../src/manifest.ts';
import { compareAreas } from './lib/compare.ts';
import { getObject, getString, parseJsonObject } from './lib/json.ts';
import type { JsonObject } from './lib/json.ts';
import { listOperations } from './lib/transforms.ts';
import { API_VERSIONS, SNAPSHOT } from './snapshot.ts';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
   DIST_DIR = path.join(PACKAGE_DIR, 'dist'),
   PRODUCTS: Record<string, Product> = {
      services: {
         name: 'Azure DevOps Services',
         highestApiVersion: '7.1',
         source: '7.1 is the newest released version in the REST API reference',
         verifiedOn: null,
      },
      server: {
         name: 'Azure DevOps Server',
         highestApiVersion: '7.1',
         source: 'its release notes describe 7.2-preview features, so it accepts 7.1',
         verifiedOn: null,
      },
      'server-2022': {
         name: 'Azure DevOps Server 2022',
         highestApiVersion: '7.0',
         source: 'REST API versioning page',
         verifiedOn: null,
      },
   };

function compareVersions(a: string, b: string): number {
   return a.localeCompare(b, 'en', { numeric: true });
}

function readJson(file: string): JsonObject {
   return parseJsonObject(readFileSync(file, 'utf8'));
}

function describeAreaVersion(apiVersion: string, area: string, previousApiVersion: string | undefined): AreaVersion {
   const file = `dist/openapi/${apiVersion}/${area}.json`,
      content = readFileSync(path.join(PACKAGE_DIR, file)),
      operations = listOperations(parseJsonObject(content.toString('utf8'))),
      previousCodegen = path.join(DIST_DIR, 'codegen', previousApiVersion ?? '', `${area}.json`),
      areaVersion: AreaVersion = {
         file,
         operations: operations.length,
         previewOperations: operations.filter(({ operation }) => {
            return getString(operation, 'x-ado-api-version')?.includes('-preview') === true;
         }).length,
         sha256: createHash('sha256').update(content).digest('hex'),
      };

   if (previousApiVersion === undefined || !existsSync(previousCodegen)) {
      return areaVersion;
   }

   return {
      ...areaVersion,
      comparedToPrevious: {
         apiVersion: previousApiVersion,
         ...compareAreas(
            readJson(previousCodegen),
            readJson(path.join(DIST_DIR, 'codegen', apiVersion, `${area}.json`)),
         ),
      },
   };
}

/** Describes every area in every API version. `apiVersions` must be sorted. */
function describeAreas(apiVersions: readonly string[]): Manifest['areas'] {
   const areas: Manifest['areas'] = {};

   apiVersions.forEach((apiVersion, index) => {
      const files = readdirSync(path.join(DIST_DIR, 'openapi', apiVersion)).toSorted();

      for (const file of files) {
         const area = path.basename(file, '.json'),
            entry = areas[area] ?? { title: '', versions: {} };

         entry.versions[apiVersion] = describeAreaVersion(apiVersion, area, apiVersions[index - 1]);
         // The newest version's title wins. Areas with several files join their titles in convert.ts.
         entry.title =
            getString(getObject(readJson(path.join(DIST_DIR, 'openapi', apiVersion, file)), 'info'), 'title') ?? area;
         areas[area] = entry;
      }
   });

   return areas;
}

function getProducts(apiVersion: string): string[] {
   return Object.entries(PRODUCTS)
      .filter(([, product]) => {
         return compareVersions(product.highestApiVersion, apiVersion) >= 0;
      })
      .map(([key]) => {
         return key;
      });
}

/** Counts the areas of an API version by their change from the previous API version. */
function countChanges(manifest: Manifest, apiVersion: string): Record<ChangeKind | 'new', number> {
   const counts = { identical: 0, additive: 0, breaking: 0, new: 0 },
      changes = Object.values(manifest.areas).flatMap(({ versions }): (ChangeKind | 'new')[] => {
         const version = versions[apiVersion];

         return version === undefined ? [] : [version.comparedToPrevious?.change ?? 'new'];
      });

   for (const change of changes) {
      counts[change] += 1;
   }

   return counts;
}

function main(): void {
   const apiVersions = API_VERSIONS.toSorted(compareVersions),
      areas = describeAreas(apiVersions),
      manifest = ManifestSchema.parse({
         source: {
            repository: 'https://github.com/MicrosoftDocs/vsts-rest-api-specs',
            license: 'MIT',
            snapshot: `swh:1:snp:${SNAPSHOT.snapshot}`,
            revision: `swh:1:rev:${SNAPSHOT.revision}`,
            specificationDirectory: `swh:1:dir:${SNAPSHOT.specificationDirectory}`,
         },
         openapiVersion: '3.2.0',
         apiVersions: Object.fromEntries(
            apiVersions.map((apiVersion) => {
               return [apiVersion, { status: 'released', products: getProducts(apiVersion) }];
            }),
         ),
         products: PRODUCTS,
         areas: Object.fromEntries(
            Object.entries(areas).toSorted(([a], [b]) => {
               return a.localeCompare(b);
            }),
         ),
      });

   writeFileSync(path.join(DIST_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 3)}\n`);

   for (const apiVersion of apiVersions.slice(1)) {
      console.log(`${apiVersion}: ${JSON.stringify(countChanges(manifest, apiVersion))}`);
   }
}

main();
