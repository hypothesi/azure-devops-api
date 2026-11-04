/**
 * Converts `source/swagger/{apiVersion}/{area}/*.json` to `dist/openapi`, `dist/codegen`, and
 * `dist/docs`. See docs/architecture.md for the steps.
 *
 * Usage: node scripts/convert.ts
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getObject, getString, isJsonObject, parseJsonObject } from './lib/json.ts';
import type { JsonObject } from './lib/json.ts';
import { mergeDocuments, toPascalCase } from './lib/merge.ts';
import {
   addApiVersions,
   addArea,
   fixFormatTypes,
   matchPathParameterCase,
   markStreamsAsBinary,
   unwrapArrayAllOf,
   listOperations,
   moveMsPathsIntoPaths,
   nameSvgResponses,
   openObjectSchemas,
   removeApiVersionParameter,
   removeBom,
   removeExamples,
   removeOrganization,
   removeTrailingSlashes,
   replaceBareObjects,
   upgradeToOpenApi32,
} from './lib/transforms.ts';
import { API_VERSIONS } from './snapshot.ts';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
   SWAGGER_DIR = path.join(PACKAGE_DIR, 'source', 'swagger'),
   DIST_DIR = path.join(PACKAGE_DIR, 'dist'),
   OVERLAYS_DIR = path.join(PACKAGE_DIR, 'overlays'),
   DEFAULT_SERVER_URL = 'https://dev.azure.com/{organization}';

function writeJson(file: string, value: JsonObject): void {
   mkdirSync(path.dirname(file), { recursive: true });
   writeFileSync(file, `${JSON.stringify(value, null, 3)}\n`);
}

function convertFile(file: string, apiVersion: string): JsonObject {
   const swagger = parseJsonObject(removeBom(readFileSync(file, 'utf8')));

   try {
      return addApiVersions(
         removeTrailingSlashes(
            matchPathParameterCase(
               removeOrganization(
                  fixFormatTypes(
                     unwrapArrayAllOf(
                        replaceBareObjects(removeExamples(upgradeToOpenApi32(nameSvgResponses(swagger)))),
                     ),
                  ),
               ),
            ),
         ),
         apiVersion,
      );
   } catch (error) {
      const details = error instanceof AggregateError ? error.errors.map(String).join('\n') : '';

      throw new Error(`${path.relative(PACKAGE_DIR, file)}: ${String(error)}\n${details}`, { cause: error });
   }
}

/** Areas with several files get one document. The title joins the files' titles in file name order. */
function convertArea(apiVersion: string, area: string): JsonObject {
   const directory = path.join(SWAGGER_DIR, apiVersion, area),
      parts = readdirSync(directory)
         .filter((file) => {
            return file.endsWith('.json');
         })
         .toSorted()
         .map((file) => {
            return {
               suffix: toPascalCase(path.basename(file, '.json')),
               document: convertFile(path.join(directory, file), apiVersion),
            };
         }),
      title = parts
         .map(({ document }) => {
            return getString(getObject(document, 'info'), 'title') ?? '';
         })
         .join(', ');

   return parts.length === 1 && parts[0] !== undefined ? parts[0].document : mergeDocuments(parts, title);
}

function usesDefaultServer(document: JsonObject): boolean {
   const servers = document.servers;

   return Array.isArray(servers) && isJsonObject(servers[0]) && servers[0].url === DEFAULT_SERVER_URL;
}

/** Adds an `x-tagGroups` entry per area, so the docs site groups the tags by area. */
function addTagGroups(document: JsonObject, areas: ReadonlyMap<string, JsonObject>): JsonObject {
   const tagGroups = [...areas].map(([area, areaDocument]) => {
      const tags = new Set(
         listOperations(areaDocument).flatMap(({ operation }) => {
            return Array.isArray(operation.tags) ? operation.tags.map(String) : [];
         }),
      );

      return { name: getString(getObject(areaDocument, 'info'), 'title') ?? area, tags: [...tags].toSorted() };
   });

   return { ...document, 'x-tagGroups': tagGroups };
}

function main(): void {
   const overlays = readdirSync(OVERLAYS_DIR, { recursive: true, encoding: 'utf8' }).filter((file) => {
      return file !== 'README.md';
   });

   // Step 7. No source file needs an overlay yet, so there is no overlay engine. See overlays/README.md.
   if (overlays.length > 0) {
      throw new Error(`overlays/ contains ${overlays.join(', ')}, but convert.ts cannot apply overlays yet`);
   }

   for (const output of ['openapi', 'codegen', 'docs']) {
      rmSync(path.join(DIST_DIR, output), { recursive: true, force: true });
   }

   for (const apiVersion of API_VERSIONS) {
      const areas = new Map<string, JsonObject>();

      for (const entry of readdirSync(path.join(SWAGGER_DIR, apiVersion), { withFileTypes: true })) {
         if (entry.isDirectory()) {
            areas.set(entry.name, convertArea(apiVersion, entry.name));
         }
      }

      const sorted = new Map(
         [...areas].toSorted(([a], [b]) => {
            return a.localeCompare(b);
         }),
      );

      for (const [area, document] of sorted) {
         writeJson(path.join(DIST_DIR, 'openapi', apiVersion, `${area}.json`), document);
         writeJson(
            path.join(DIST_DIR, 'codegen', apiVersion, `${area}.json`),
            markStreamsAsBinary(openObjectSchemas(removeApiVersionParameter(moveMsPathsIntoPaths(document)))),
         );
      }

      // mergeDocuments uses the first part's servers for the document, so areas on dev.azure.com go first.
      const docsParts = [...sorted]
            .toSorted(([, a], [, b]) => {
               return Number(!usesDefaultServer(a)) - Number(!usesDefaultServer(b));
            })
            .map(([area, document]) => {
               // Areas reuse model names, so a plain suffix such as `DeploymentBuild` can be taken already.
               return { suffix: `.${area}`, document: addArea(moveMsPathsIntoPaths(document), area) };
            }),
         docs = mergeDocuments(docsParts, `Azure DevOps REST API ${apiVersion}`);

      writeJson(path.join(DIST_DIR, 'docs', `${apiVersion}.json`), addTagGroups(docs, sorted));
      console.log(`${apiVersion}: ${sorted.size} areas, ${listOperations(docs).length} operations`);
   }
}

main();
