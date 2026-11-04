import { describe, expect, it } from 'vite-plus/test';
import {
   type AreaModule,
   BANNER,
   buildOperationTable,
   getOperationsSource,
   getServerURL,
   getVersionIndexSource,
   groupVersions,
   isStringEnum,
   type OpenAPIDocument,
} from '../scripts/lib/codegen';

type AreaVersion = Parameters<typeof groupVersions>[1]['areas'][string]['versions'][string];

const VERSIONS = ['7.0', '7.1', '7.2'],
   SHA256 = '0'.repeat(64),
   WIT: AreaModule = { area: 'wit', folder: '7.1', apiVersions: ['7.1'] },
   GIT: AreaModule = { area: 'git', folder: '7.1', apiVersions: ['7.1'] };

function createAreaVersion(previous?: { apiVersion: string; change: 'identical' | 'additive' }): AreaVersion {
   const comparedToPrevious =
      previous === undefined
         ? {}
         : { comparedToPrevious: { ...previous, addedOperations: [], removedOperations: [], changes: [] } };

   return { file: 'dist/openapi/wit.json', operations: 1, previewOperations: 0, sha256: SHA256, ...comparedToPrevious };
}

function createSpec(paths: OpenAPIDocument['paths'], url = 'https://dev.azure.com/{organization}'): OpenAPIDocument {
   return { servers: [{ url }], paths };
}

describe('groupVersions', () => {
   it('groups consecutive identical versions into one module', () => {
      const data = {
         areas: {
            wit: {
               title: 'Work Item Tracking',
               versions: {
                  '7.0': createAreaVersion(),
                  '7.1': createAreaVersion({ apiVersion: '7.0', change: 'identical' }),
                  '7.2': createAreaVersion({ apiVersion: '7.1', change: 'additive' }),
               },
            },
         },
      };

      expect(groupVersions('wit', data, VERSIONS)).toEqual([
         { area: 'wit', folder: '7.0', apiVersions: ['7.0', '7.1'] },
         { area: 'wit', folder: '7.2', apiVersions: ['7.2'] },
      ]);
   });

   it('starts a new module after a version that the area does not have', () => {
      const data = {
         areas: {
            wit: {
               title: 'Work Item Tracking',
               versions: {
                  '7.0': createAreaVersion(),
                  '7.2': createAreaVersion({ apiVersion: '7.1', change: 'identical' }),
               },
            },
         },
      };

      expect(groupVersions('wit', data, VERSIONS)).toEqual([
         { area: 'wit', folder: '7.0', apiVersions: ['7.0'] },
         { area: 'wit', folder: '7.2', apiVersions: ['7.2'] },
      ]);
   });

   it('returns no modules for an unknown area', () => {
      expect(groupVersions('wit', { areas: {} }, VERSIONS)).toEqual([]);
   });

   it('throws for an area that is not a JavaScript identifier', () => {
      const data = { areas: { 'wit-2': { title: 'Work Item Tracking', versions: { '7.0': createAreaVersion() } } } };

      expect(() => {
         return groupVersions('wit-2', data, VERSIONS);
      }).toThrow('Area wit-2 is not a valid JavaScript identifier');
   });
});

describe('isStringEnum', () => {
   it('reads named enum values first', () => {
      expect(isStringEnum({ namedEnumValues: [{ value: 'a' }], enumValues: [1] })).toBe(true);
      expect(isStringEnum({ namedEnumValues: [{ value: 1 }], enumValues: ['a'] })).toBe(false);
   });

   it('reads plain enum values when there are no named values', () => {
      expect(isStringEnum({ enumValues: ['a', 'b'] })).toBe(true);
      expect(isStringEnum({ enumValues: ['a', null] })).toBe(false);
   });

   it('is true for an enum without values', () => {
      expect(isStringEnum({})).toBe(true);
   });
});

describe('getServerURL', () => {
   it('replaces every variable except organization with its default', () => {
      const servers = [
         {
            url: 'https://{host}/{organization}/{collection}',
            variables: {
               host: { default: 'vssps.dev.azure.com' },
               organization: { default: 'x' },
               collection: { default: 'c' },
            },
         },
      ];

      expect(getServerURL(servers)).toBe('https://vssps.dev.azure.com/{organization}/c');
   });

   it('falls back to {organization} without servers', () => {
      expect(getServerURL(undefined)).toBe('{organization}');
      expect(getServerURL([])).toBe('{organization}');
   });
});

describe('buildOperationTable', () => {
   it('lists the API version and server index of every operation', () => {
      const wit = createSpec({
            '/wit/workitems': {
               get: { 'x-ado-api-version': '7.1' },
               parameters: [],
            },
            '/wit/fields': {
               post: { 'x-ado-api-version': '7.1-preview.2' },
               servers: [{ url: 'https://vssps.dev.azure.com/{organization}' }],
            },
         }),
         table = buildOperationTable('7.1', [{ module: WIT, spec: wit }]);

      expect(table.servers).toEqual([
         'https://dev.azure.com/{organization}',
         'https://vssps.dev.azure.com/{organization}',
      ]);
      expect([...table.operations]).toEqual([
         ['GET /wit/workitems', ['7.1', 0]],
         ['POST /wit/fields', ['7.1-preview.2', 1]],
      ]);
   });

   it('accepts one operation in two areas with the same version and server', () => {
      const paths = { '/shared': { get: { 'x-ado-api-version': '7.1' } } },
         table = buildOperationTable('7.1', [
            { module: WIT, spec: createSpec(paths) },
            { module: GIT, spec: createSpec(paths) },
         ]);

      expect([...table.operations]).toEqual([['GET /shared', ['7.1', 0]]]);
   });

   it('throws for an operation without x-ado-api-version', () => {
      const spec = createSpec({ '/wit/workitems': { get: {} } });

      expect(() => {
         return buildOperationTable('7.1', [{ module: WIT, spec }]);
      }).toThrow('wit 7.1: GET /wit/workitems has no x-ado-api-version');
   });

   it('throws for one operation in two areas with different servers', () => {
      const paths = { '/shared': { get: { 'x-ado-api-version': '7.1' } } };

      expect(() => {
         return buildOperationTable('7.1', [
            { module: WIT, spec: createSpec(paths) },
            { module: GIT, spec: createSpec(paths, 'https://vssps.dev.azure.com/{organization}') },
         ]);
      }).toThrow('7.1: GET /shared is in two areas with different API versions or servers');
   });
});

describe('getVersionIndexSource', () => {
   it('exports one namespace per area', () => {
      expect(getVersionIndexSource([WIT, { area: 'git', folder: '7.0', apiVersions: ['7.0', '7.1'] }])).toBe(
         `${BANNER}export * as wit from '../wit/7.1/index';\nexport * as git from '../git/7.0/index';\n`,
      );
   });
});

describe('getOperationsSource', () => {
   it('writes the operations sorted by key', () => {
      const table = {
         servers: ['https://dev.azure.com/{organization}'],
         operations: new Map<string, readonly [string, number]>([
            ['POST /b', ['7.1', 0]],
            ['GET /a', ['7.1-preview.1', 0]],
         ]),
      };

      expect(getOperationsSource('7.1', table)).toBe(
         `${BANNER}import type { OperationTable } from '../../core/context';\n\n` +
            `export const operations: OperationTable = {\n` +
            `   apiVersion: "7.1",\n` +
            `   servers: ["https://dev.azure.com/{organization}"],\n` +
            `   operations: {\n` +
            `      "GET /a": ["7.1-preview.1",0],\n` +
            `      "POST /b": ["7.1",0],\n` +
            `   },\n};\n`,
      );
   });
});
