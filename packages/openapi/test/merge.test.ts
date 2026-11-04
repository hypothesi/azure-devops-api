import { describe, expect, it } from 'vite-plus/test';
import type { JsonObject } from '../scripts/lib/json.ts';
import { mergeDocuments, toPascalCase } from '../scripts/lib/merge.ts';

function createDocument(
   pathKey: string,
   schemas: JsonObject,
   servers = [{ url: 'https://pkgs.dev.azure.com/{organization}' }],
): JsonObject {
   return {
      openapi: '3.2.0',
      info: { title: pathKey, version: '7.1' },
      servers,
      paths: {
         [pathKey]: {
            get: {
               responses: {
                  200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Package' } } } },
               },
            },
         },
      },
      components: {
         schemas,
         securitySchemes: {
            oauth2: {
               type: 'oauth2',
               flows: {
                  authorizationCode: {
                     authorizationUrl: 'https://a',
                     tokenUrl: 'https://t',
                     scopes: { [`vso.${pathKey}`]: '' },
                  },
               },
            },
         },
      },
      tags: [{ name: pathKey }],
   };
}

describe('toPascalCase', () => {
   it('capitalizes the first letter', () => {
      expect(toPascalCase('nuGet')).toBe('NuGet');
   });
});

describe('mergeDocuments', () => {
   it('combines paths, tags, and components and sets the title', () => {
      const shared = { Package: { type: 'object' } },
         result = mergeDocuments(
            [
               { suffix: 'Maven', document: createDocument('maven', shared) },
               { suffix: 'Npm', document: createDocument('npm', shared) },
            ],
            'Maven, Npm',
         );

      expect(result.info).toEqual({ title: 'Maven, Npm', version: '7.1' });
      expect(Object.keys(result.paths ?? {})).toEqual(['maven', 'npm']);
      expect(result.tags).toEqual([{ name: 'maven' }, { name: 'npm' }]);
      expect(result.components).toMatchObject({ schemas: shared });
   });

   it('adds the part suffix to components that two parts define differently', () => {
      const result = mergeDocuments(
         [
            {
               suffix: 'Maven',
               document: createDocument('maven', { Package: { type: 'object', properties: { a: {} } } }),
            },
            { suffix: 'Npm', document: createDocument('npm', { Package: { type: 'object', properties: { b: {} } } }) },
         ],
         'Maven, Npm',
      );

      expect(result.components).toMatchObject({
         schemas: {
            PackageMaven: { properties: { a: {} } },
            PackageNpm: { properties: { b: {} } },
         },
      });
      expect(result.paths).toMatchObject({
         npm: {
            get: {
               responses: {
                  200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/PackageNpm' } } } },
               },
            },
         },
      });
   });

   it('combines the OAuth scopes of security schemes with the same key', () => {
      const result = mergeDocuments(
         [
            { suffix: 'Maven', document: createDocument('maven', {}) },
            { suffix: 'Npm', document: createDocument('npm', {}) },
         ],
         'Maven, Npm',
      );

      expect(result.components).toMatchObject({
         securitySchemes: { oauth2: { flows: { authorizationCode: { scopes: { 'vso.maven': '', 'vso.npm': '' } } } } },
      });
   });

   it('puts servers on the path items of a part whose servers differ', () => {
      const feedServers = [{ url: 'https://feeds.dev.azure.com/{organization}' }],
         result = mergeDocuments(
            [
               { suffix: 'Feed', document: createDocument('feed', {}, feedServers) },
               { suffix: 'Provenance', document: createDocument('provenance', {}) },
            ],
            'Feed, Provenance',
         );

      expect(result.servers).toEqual(feedServers);
      expect(result.paths).toMatchObject({
         provenance: { servers: [{ url: 'https://pkgs.dev.azure.com/{organization}' }] },
      });
      expect(result.paths).not.toHaveProperty(['feed', 'servers']);
   });

   it('throws when two parts define the same operation', () => {
      const document = createDocument('npm', {});

      expect(() => {
         return mergeDocuments(
            [
               { suffix: 'A', document },
               { suffix: 'B', document: { ...document, paths: { npm: { get: { operationId: 'other' } } } } },
            ],
            'A, B',
         );
      }).toThrow(/two documents define get/);
   });

   it('throws when security schemes with the same key differ and are not OAuth', () => {
      const document = createDocument('npm', {}),
         apiKey = { components: { securitySchemes: { oauth2: { type: 'apiKey', name: 'key', in: 'header' } } } };

      expect(() => {
         return mergeDocuments(
            [
               { suffix: 'A', document },
               { suffix: 'B', document: { ...document, paths: {}, ...apiKey } },
            ],
            'A, B',
         );
      }).toThrow('Security scheme oauth2 differs between documents');
   });

   it('throws when OAuth flows with the same name have different URLs', () => {
      const document = createDocument('npm', {}),
         other = createDocument('maven', {});

      other.components = {
         securitySchemes: {
            oauth2: {
               type: 'oauth2',
               flows: { authorizationCode: { authorizationUrl: 'https://b', tokenUrl: 'https://t', scopes: {} } },
            },
         },
      };

      expect(() => {
         return mergeDocuments(
            [
               { suffix: 'Npm', document },
               { suffix: 'Maven', document: other },
            ],
            'Npm, Maven',
         );
      }).toThrow('Security scheme oauth2 has different authorizationCode URLs');
   });

   it('adds an OAuth flow that only the second scheme has', () => {
      const other = createDocument('maven', {}),
         implicit = { authorizationUrl: 'https://a', scopes: { 'vso.maven': '' } };

      other.components = { securitySchemes: { oauth2: { type: 'oauth2', flows: { implicit } } } };

      const result = mergeDocuments(
         [
            { suffix: 'Npm', document: createDocument('npm', {}) },
            { suffix: 'Maven', document: other },
         ],
         'Npm, Maven',
      );

      expect(result.components).toMatchObject({
         securitySchemes: { oauth2: { flows: { authorizationCode: { scopes: { 'vso.npm': '' } }, implicit } } },
      });
   });

   it('keeps the first tag with each name', () => {
      const first = createDocument('npm', {}),
         second = createDocument('maven', {});

      first.tags = [{ name: 'Packages', description: 'first' }];
      second.tags = [{ name: 'Packages', description: 'second' }, 'not a tag'];

      const result = mergeDocuments(
         [
            { suffix: 'Npm', document: first },
            { suffix: 'Maven', document: second },
         ],
         'Npm, Maven',
      );

      expect(result.tags).toEqual([{ name: 'Packages', description: 'first' }]);
   });

   it('throws when the top-level security differs', () => {
      const document = createDocument('npm', {});

      expect(() => {
         return mergeDocuments(
            [
               { suffix: 'A', document },
               { suffix: 'B', document: { ...document, security: [{ oauth2: [] }] } },
            ],
            'A, B',
         );
      }).toThrow('B: top-level security differs from the first document');
   });

   it('throws when there are no parts', () => {
      expect(() => {
         return mergeDocuments([], 'Nothing');
      }).toThrow('Nothing to merge');
   });
});
