/**
 * Copies the docs OpenAPI documents into `public/openapi`, adds `x-codeSamples` to each
 * operation, and writes the Scalar source list. Writes `compatibility.html` to the app root,
 * where Vite builds it as a page. Set `OPENAPI_DIST` to read the documents and manifest from
 * another folder.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ManifestSchema } from '@hypothesi/azure-devops-openapi/manifest';

import { addCodeSamples, type OpenApiDocument } from './code-samples.ts';
import { getSourceTitle, listApiVersions, listEntryPoints, renderCompatibilityPage } from './compatibility.ts';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
   repoRoot = path.resolve(appRoot, '../..'),
   inputRoot = path.resolve(process.env.OPENAPI_DIST ?? path.join(repoRoot, 'packages/openapi/dist')),
   publicRoot = path.join(appRoot, 'public'),
   openapiRoot = path.join(publicRoot, 'openapi');

function readJSON(file: string): unknown {
   return JSON.parse(readFileSync(file, 'utf8'));
}

function isOpenApiDocument(value: unknown): value is OpenApiDocument {
   return typeof value === 'object' && value !== null && 'openapi' in value;
}

function isExportsMap(value: unknown): value is { exports: Record<string, unknown> } {
   return typeof value === 'object' && value !== null && 'exports' in value && typeof value.exports === 'object';
}

const manifest = ManifestSchema.parse(readJSON(path.join(inputRoot, 'manifest.json'))),
   clientPackage = readJSON(fileURLToPath(import.meta.resolve('@hypothesi/azure-devops-api/package.json'))),
   exportKeys = isExportsMap(clientPackage) ? Object.keys(clientPackage.exports) : [],
   apiVersions = listApiVersions(manifest);

if (listEntryPoints(manifest, exportKeys).length === 0) {
   throw new Error('packages/client/package.json exports no entry point for any API version or product');
}

rmSync(publicRoot, { recursive: true, force: true });
mkdirSync(openapiRoot, { recursive: true });

for (const apiVersion of apiVersions) {
   const file = path.join(inputRoot, 'docs', `${apiVersion}.json`),
      document = readJSON(file);

   if (!isOpenApiDocument(document)) {
      throw new Error(`${file} is not an OpenAPI document`);
   }

   const count = addCodeSamples(document, apiVersion);

   writeFileSync(path.join(openapiRoot, `${apiVersion}.json`), JSON.stringify(document));
   console.log(`openapi/${apiVersion}.json: ${count} code samples`);
}

const sources = apiVersions.map((apiVersion, index) => {
   return {
      title: getSourceTitle(manifest, apiVersion),
      slug: apiVersion,
      url: `openapi/${apiVersion}.json`,
      default: index === 0,
   };
});

writeFileSync(path.join(openapiRoot, 'sources.json'), JSON.stringify(sources, null, 3));
writeFileSync(path.join(appRoot, 'compatibility.html'), renderCompatibilityPage(manifest, exportKeys));
