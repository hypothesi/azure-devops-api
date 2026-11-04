import type { Manifest } from '../../../packages/openapi/src/manifest.ts';

import { CLIENT_PACKAGE } from './code-samples.ts';

const NON_CLIENT_EXPORTS = new Set(['.', './package.json', './compatibility']);

export interface EntryPoint {
   importPath: string;
   apiVersion: string;
   products: string[];
}

/** Compares two API versions such as `7.0` and `7.10` by their numeric parts. */
export function compareApiVersions(a: string, b: string): number {
   const left = a.split('.').map(Number),
      right = b.split('.').map(Number);

   for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const difference = (left[index] ?? 0) - (right[index] ?? 0);

      if (difference !== 0) {
         return difference;
      }
   }

   return 0;
}

/** Lists the manifest's API versions, highest first. */
export function listApiVersions(manifest: Manifest): string[] {
   return Object.keys(manifest.apiVersions).toSorted((a, b) => {
      return compareApiVersions(b, a);
   });
}

/** Builds the Scalar source title, for example `7.1 (Azure DevOps Services, Azure DevOps Server)`. */
export function getSourceTitle(manifest: Manifest, apiVersion: string): string {
   const names = (manifest.apiVersions[apiVersion]?.products ?? []).map((key) => {
      return manifest.products[key]?.name ?? key;
   });

   return names.length > 0 ? `${apiVersion} (${names.join(', ')})` : apiVersion;
}

/**
 * Lists the client entry points from the keys of the client's `package.json` `exports`. A
 * version export such as `./7.1` uses that API version. A product export such as `./services`
 * uses the product's highest API version. An entry point works with every product whose
 * highest API version is at least the entry point's version, because every product accepts
 * all lower versions.
 */
export function listEntryPoints(manifest: Manifest, exportKeys: string[]): EntryPoint[] {
   return exportKeys
      .filter((key) => {
         return !NON_CLIENT_EXPORTS.has(key);
      })
      .flatMap((key) => {
         const name = key.replace(/^\.\//, ''),
            apiVersion = manifest.apiVersions[name] ? name : manifest.products[name]?.highestApiVersion;

         if (apiVersion === undefined) {
            return [];
         }

         const products = Object.entries(manifest.products)
            .filter(([, product]) => {
               return compareApiVersions(product.highestApiVersion, apiVersion) >= 0;
            })
            .map(([, product]) => {
               return product.name;
            });

         return [{ importPath: `${CLIENT_PACKAGE}/${name}`, apiVersion, products }];
      });
}

function escapeHTML(text: string): string {
   return text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
}

function table(headers: string[], rows: string[][]): string {
   const head = headers
         .map((header) => {
            return `<th scope="col">${escapeHTML(header)}</th>`;
         })
         .join(''),
      body = rows
         .map((cells) => {
            return `<tr>${cells
               .map((cell) => {
                  return `<td>${cell}</td>`;
               })
               .join('')}</tr>`;
         })
         .join('\n');

   return `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}

function list(items: string[]): string {
   if (items.length === 0) {
      return 'None';
   }

   return `<ul>${items
      .map((item) => {
         return `<li><code>${escapeHTML(item)}</code></li>`;
      })
      .join('')}</ul>`;
}

/** Builds one row per product: name, highest API version, its source, and the verified date. */
export function listProductRows(manifest: Manifest): string[][] {
   return Object.values(manifest.products).map((product) => {
      return [
         escapeHTML(product.name),
         escapeHTML(product.highestApiVersion),
         escapeHTML(product.source),
         product.verifiedOn === null ? 'Not verified' : `Verified on ${escapeHTML(product.verifiedOn)}`,
      ];
   });
}

/** Builds one row per area version that the manifest compares to a previous version. */
export function listAreaRows(manifest: Manifest, area: string): string[][] {
   return Object.entries(manifest.areas[area]?.versions ?? {}).flatMap(([apiVersion, version]) => {
      const compared = version.comparedToPrevious;

      if (compared === undefined) {
         return [];
      }

      return [
         [
            `${escapeHTML(apiVersion)} vs ${escapeHTML(compared.apiVersion)}`,
            escapeHTML(compared.change),
            list(compared.changes),
         ],
      ];
   });
}

/** Renders the compatibility page as a complete HTML document. */
export function renderCompatibilityPage(manifest: Manifest, exportKeys: string[]): string {
   const entryRows = listEntryPoints(manifest, exportKeys).map((entry) => {
         return [
            `<code>${escapeHTML(entry.importPath)}</code>`,
            escapeHTML(entry.apiVersion),
            escapeHTML(entry.products.join(', ')),
         ];
      }),
      areaSections = Object.entries(manifest.areas)
         .toSorted(([a], [b]) => {
            return a.localeCompare(b);
         })
         .map(([key, area]) => {
            const rows = listAreaRows(manifest, key);

            return [
               `<h3 id="area-${escapeHTML(key)}">${escapeHTML(area.title)} (<code>${escapeHTML(key)}</code>)</h3>`,
               rows.length > 0
                  ? table(['Versions', 'Change', 'Changes'], rows)
                  : '<p>No earlier version to compare.</p>',
            ].join('\n');
         });

   return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<link rel="stylesheet" href="./src/site.scss">
<title>Compatibility | ${CLIENT_PACKAGE}</title>
</head>
<body>
<nav><a href="./">Home</a> | <a href="./reference.html">API reference</a></nav>
<main>
<h1>Compatibility</h1>
<h2>Products</h2>
${table(['Product', 'Highest API version', 'Source', 'Verified'], listProductRows(manifest))}
<h2>Entry points</h2>
<p>An entry point works with every product whose highest API version is at least the entry point's API version. Every product accepts all lower API versions.</p>
${table(['Import', 'API version', 'Products'], entryRows)}
<h2>Client versions and API versions</h2>
<p>The version of <code>${CLIENT_PACKAGE}</code> is independent of the Azure DevOps API versions. The client uses semver with these rules.</p>
${table(
   ['Change', 'Release type'],
   [
      ['New API version entry point, such as 7.2', 'Minor'],
      ['Spec update with only identical or additive changes', 'Minor'],
      ['Spec update with a breaking change in a supported version', 'Major'],
      ['API version removed because its last product left mainstream support', 'Major'],
      ['Transport or helper fix', 'Patch'],
   ],
)}
<h2>Changes between API versions</h2>
<p>Identical means the same operations, parameters, request bodies, and schemas. Additive means only new operations, new optional properties, new optional parameters, or new enum values. Breaking means removed operations or properties, changed types, or new required inputs.</p>
${areaSections.join('\n')}
</main>
</body>
</html>
`;
}
