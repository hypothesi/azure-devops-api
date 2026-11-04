import { describe, expect, it } from 'vite-plus/test';
import { compareAreas } from '../scripts/lib/compare.ts';
import { getObject, parseJsonObject } from '../scripts/lib/json.ts';
import type { JsonObject } from '../scripts/lib/json.ts';

function createArea(): JsonObject {
   return {
      openapi: '3.2.0',
      servers: [{ url: 'https://dev.azure.com/{organization}' }],
      paths: {
         '/{project}/_apis/git/repositories': {
            get: {
               operationId: 'Repositories_List',
               description: 'Retrieve git repositories.',
               parameters: [{ in: 'path', name: 'project', required: true, schema: { type: 'string' } }],
               responses: {
                  200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/GitRepository' } } } },
               },
               security: [{ oauth2: ['vso.code'] }],
               'x-ado-api-version': '7.0',
            },
         },
      },
      components: {
         schemas: {
            GitRepository: {
               type: 'object',
               description: 'A repository.',
               properties: { id: { type: 'string' }, status: { type: 'string', enum: ['active', 'disabled'] } },
            },
         },
      },
   };
}

function modify(change: (area: JsonObject) => void): JsonObject {
   const area = createArea();

   change(area);

   return area;
}

function getRepositorySchema(area: JsonObject): JsonObject {
   return getObject(getObject(getObject(area, 'components'), 'schemas'), 'GitRepository');
}

/** Replaces text in the serialized `paths` of an area. */
function replaceInPaths(area: JsonObject, search: string, replacement: string): void {
   area.paths = parseJsonObject(JSON.stringify(area.paths).replace(search, replacement));
}

function withParameter(required: boolean): JsonObject {
   return modify((area) => {
      replaceInPaths(
         area,
         '"parameters":[',
         `"parameters":[{"in":"query","name":"includeHidden","required":${String(required)},"schema":{"type":"boolean"}},`,
      );
   });
}

describe('compareAreas', () => {
   it('ignores descriptions, versions, security, and x- extensions', () => {
      const current = modify((area) => {
         replaceInPaths(area, 'Retrieve git repositories.', 'Other');
         replaceInPaths(area, '"7.0"', '"7.1-preview.1"');
         replaceInPaths(area, 'vso.code', 'vso.code_write');
         getRepositorySchema(area).description = 'Other';
      });

      expect(compareAreas(createArea(), current)).toEqual({
         change: 'identical',
         addedOperations: [],
         removedOperations: [],
         changes: [],
      });
   });

   it('treats a new optional property and a new enum value as additive', () => {
      const current = modify((area) => {
         const schema = getRepositorySchema(area);

         schema.properties = {
            id: { type: 'string' },
            name: { type: 'string' },
            status: { type: 'string', enum: ['active', 'disabled', 'deleted'] },
         };
      });

      expect(compareAreas(createArea(), current)).toEqual({
         change: 'additive',
         addedOperations: [],
         removedOperations: [],
         changes: [
            'schema GitRepository: property name added',
            'schema GitRepository: property status enum value "deleted" added',
         ],
      });
   });

   it('treats a new required property as breaking', () => {
      const current = modify((area) => {
         getRepositorySchema(area).required = ['id'];
      });

      expect(compareAreas(createArea(), current)).toMatchObject({
         change: 'breaking',
         changes: ['schema GitRepository: property id became required'],
      });
   });

   it('treats a property that becomes required as breaking', () => {
      const previous = modify((area) => {
            getRepositorySchema(area).required = ['id'];
         }),
         current = modify((area) => {
            getRepositorySchema(area).required = ['id', 'status'];
         });

      expect(compareAreas(previous, current)).toMatchObject({
         change: 'breaking',
         changes: ['schema GitRepository: property status became required'],
      });
   });

   it('treats a changed type as breaking', () => {
      const current = modify((area) => {
         getRepositorySchema(area).properties = {
            id: { type: 'integer' },
            status: { type: 'string', enum: ['active', 'disabled'] },
         };
      });

      expect(compareAreas(createArea(), current)).toMatchObject({
         change: 'breaking',
         changes: ['schema GitRepository: property id type changed from "string" to "integer"'],
      });
   });

   it('treats a removed property as breaking', () => {
      const current = modify((area) => {
         getRepositorySchema(area).properties = { id: { type: 'string' } };
      });

      expect(compareAreas(createArea(), current)).toMatchObject({
         change: 'breaking',
         changes: ['schema GitRepository: property status removed'],
      });
   });

   it('lists added and removed operations', () => {
      const current = modify((area) => {
         area.paths = { '/{project}/_apis/git/pullrequests': { get: { operationId: 'Pull Requests_Get' } } };
      });

      expect(compareAreas(createArea(), current)).toMatchObject({
         change: 'breaking',
         addedOperations: ['GET /{project}/_apis/git/pullrequests'],
         removedOperations: ['GET /{project}/_apis/git/repositories'],
      });
   });

   it('treats a new optional parameter as additive and a new required parameter as breaking', () => {
      expect(compareAreas(createArea(), withParameter(false))).toMatchObject({
         change: 'additive',
         changes: ['operation GET /{project}/_apis/git/repositories: optional parameter query includeHidden added'],
      });
      expect(compareAreas(createArea(), withParameter(true))).toMatchObject({
         change: 'breaking',
         changes: ['operation GET /{project}/_apis/git/repositories: required parameter query includeHidden added'],
      });
   });
});
