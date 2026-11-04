import { readFileSync } from 'node:fs';

import { ManifestSchema, type Manifest } from '../../../packages/openapi/src/manifest.ts';
import { describe, expect, it } from 'vite-plus/test';

import {
   compareApiVersions,
   getSourceTitle,
   listApiVersions,
   listAreaRows,
   listEntryPoints,
   listProductRows,
   renderCompatibilityPage,
} from '../scripts/compatibility.ts';

const EXPORT_KEYS = [
   '.',
   './7.0',
   './7.1',
   './services',
   './server',
   './server-2022',
   './compatibility',
   './package.json',
];

function loadManifest(): Manifest {
   return ManifestSchema.parse(JSON.parse(readFileSync(new URL('fixtures/manifest.json', import.meta.url), 'utf8')));
}

describe('compareApiVersions', () => {
   it('compares numeric parts', () => {
      expect(compareApiVersions('7.10', '7.9')).toBeGreaterThan(0);
      expect(compareApiVersions('7.0', '7.1')).toBeLessThan(0);
      expect(compareApiVersions('7.1', '7.1')).toBe(0);
   });
});

describe('sources', () => {
   it('lists versions highest first with product names in the title', () => {
      const manifest = loadManifest();

      expect(listApiVersions(manifest)).toEqual(['7.1', '7.0']);
      expect(getSourceTitle(manifest, '7.1')).toBe('7.1 (Azure DevOps Services, Azure DevOps Server)');
   });
});

describe('listProductRows', () => {
   it('shows the highest version, its source, and the verified date', () => {
      const rows = listProductRows(loadManifest());

      expect(rows).toEqual([
         [
            'Azure DevOps Services',
            '7.1',
            'OPTIONS https://dev.azure.com/{organization}/_apis/',
            'Verified on 2026-11-01',
         ],
         ['Azure DevOps Server', '7.1', 'Microsoft Learn REST API versions table', 'Not verified'],
         ['Azure DevOps Server 2022', '7.0', 'Microsoft Learn REST API versions table', 'Not verified'],
      ]);
   });
});

describe('listEntryPoints', () => {
   it('maps each entry point to every product whose highest version is at least its version', () => {
      const entries = listEntryPoints(loadManifest(), EXPORT_KEYS);

      expect(entries).toEqual([
         {
            importPath: '@hypothesi/azure-devops-api/7.0',
            apiVersion: '7.0',
            products: ['Azure DevOps Services', 'Azure DevOps Server', 'Azure DevOps Server 2022'],
         },
         {
            importPath: '@hypothesi/azure-devops-api/7.1',
            apiVersion: '7.1',
            products: ['Azure DevOps Services', 'Azure DevOps Server'],
         },
         {
            importPath: '@hypothesi/azure-devops-api/services',
            apiVersion: '7.1',
            products: ['Azure DevOps Services', 'Azure DevOps Server'],
         },
         {
            importPath: '@hypothesi/azure-devops-api/server',
            apiVersion: '7.1',
            products: ['Azure DevOps Services', 'Azure DevOps Server'],
         },
         {
            importPath: '@hypothesi/azure-devops-api/server-2022',
            apiVersion: '7.0',
            products: ['Azure DevOps Services', 'Azure DevOps Server', 'Azure DevOps Server 2022'],
         },
      ]);
   });
});

describe('listAreaRows', () => {
   it('shows the change kind and escapes the change lines', () => {
      const manifest = loadManifest();

      expect(listAreaRows(manifest, 'wit')).toEqual([
         ['7.1 vs 7.0', 'breaking', '<ul><li><code>schema WorkItem: property &lt;rev&gt; changed</code></li></ul>'],
      ]);
      expect(listAreaRows(manifest, 'core')).toEqual([['7.1 vs 7.0', 'identical', 'None']]);
   });
});

describe('renderCompatibilityPage', () => {
   it('renders a section per area and the release rules', () => {
      const html = renderCompatibilityPage(loadManifest(), EXPORT_KEYS);

      expect(html).toContain('<h3 id="area-core">Core (<code>core</code>)</h3>');
      expect(html).toContain('<h3 id="area-wit">Work Item Tracking (<code>wit</code>)</h3>');
      expect(html).toContain('<td>Spec update with a breaking change in a supported version</td><td>Major</td>');
   });
});
