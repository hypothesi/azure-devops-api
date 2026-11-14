import { describe, expect, it } from 'vite-plus/test';
import type { JsonObject } from '../scripts/lib/json.ts';
import {
   addApiVersions,
   addArea,
   allowNullInOptionalProperties,
   fixFormatTypes,
   matchPathParameterCase,
   makeWiqlTeamOptional,
   markStreamsAsBinary,
   unwrapArrayAllOf,
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
} from '../scripts/lib/transforms.ts';

const BOM = String.fromCodePoint(0xfe_ff),
   ORGANIZATION_PARAMETER = { in: 'path', name: 'organization', required: true, type: 'string' },
   API_VERSION_PARAMETERS = {
      'api-Version': {
         name: 'api-version',
         in: 'query',
         description: "Version of the API to use.  This should be set to '7.1' to use this version of the api.",
         required: true,
         type: 'string',
      },
      'api-Version-preview.4': {
         name: 'api-version',
         in: 'query',
         description:
            "Version of the API to use.  This should be set to '7.1-preview.4' to use this version of the api.",
         required: true,
         type: 'string',
      },
   };

function createSwagger(): JsonObject {
   return {
      swagger: '2.0',
      info: { title: 'WorkItemTracking', version: '7.1' },
      host: 'dev.azure.com',
      basePath: '/',
      schemes: ['https'],
      paths: {
         '/{organization}/{project}/_apis/wit/classificationnodes': {
            get: {
               operationId: 'Classification Nodes_Get Root Nodes',
               produces: ['application/json'],
               parameters: [ORGANIZATION_PARAMETER, { $ref: '#/parameters/api-Version' }],
               responses: { 200: { description: 'ok', schema: { $ref: '#/definitions/WorkItem' } } },
               'x-ms-docs-override-version': '7.1',
               'x-ms-examples': { '': { $ref: './httpExamples/example.json' } },
            },
         },
      },
      'x-ms-paths': {
         '/{organization}/{project}/_apis/wit/classificationnodes?ids={ids}': {
            get: {
               operationId: 'Classification Nodes_Get Classification Nodes',
               produces: ['application/json'],
               parameters: [
                  ORGANIZATION_PARAMETER,
                  { in: 'query', name: 'ids', required: true, type: 'string' },
                  { $ref: '#/parameters/api-Version-preview.4' },
               ],
               responses: { 200: { description: 'ok', schema: { $ref: '#/definitions/WorkItem' } } },
            },
         },
      },
      definitions: {
         WorkItem: {
            type: 'object',
            properties: {
               fields: { type: 'object', additionalProperties: { type: 'object' } },
               id: { type: 'integer', format: 'int32' },
            },
         },
      },
      parameters: API_VERSION_PARAMETERS,
   };
}

function convert(swagger: JsonObject = createSwagger()): JsonObject {
   return addApiVersions(
      removeTrailingSlashes(removeOrganization(replaceBareObjects(removeExamples(upgradeToOpenApi32(swagger))))),
      '7.1',
   );
}

describe('removeBom', () => {
   it('removes a leading byte order mark', () => {
      expect(removeBom(`${BOM}{}`)).toBe('{}');
   });

   it('keeps text without a byte order mark', () => {
      expect(removeBom('{}')).toBe('{}');
   });
});

describe('upgradeToOpenApi32', () => {
   it('upgrades paths and x-ms-paths to OpenAPI 3.2', () => {
      const result = upgradeToOpenApi32(createSwagger()),
         msPaths = result['x-ms-paths'];

      expect(result.openapi).toBe('3.2.0');
      expect(Object.keys(result.paths ?? {})).toEqual(['/{organization}/{project}/_apis/wit/classificationnodes']);
      expect(msPaths).toMatchObject({
         '/{organization}/{project}/_apis/wit/classificationnodes?ids={ids}': {
            get: {
               parameters: [
                  { in: 'path', name: 'organization', schema: { type: 'string' } },
                  { in: 'query', name: 'ids', schema: { type: 'string' } },
                  { $ref: '#/components/parameters/api-Version-preview.4' },
               ],
               responses: {
                  200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkItem' } } } },
               },
            },
         },
      });
   });

   it('throws on an incompatibility instead of falling back to 3.1', () => {
      const swagger = createSwagger();

      swagger.paths = {
         '/{organization}/badge': {
            get: { produces: ['image/svg+xml'], responses: { 200: { description: 'ok', schema: { type: 'string' } } } },
         },
      };

      expect(() => {
         return upgradeToOpenApi32(swagger);
      }).toThrow(/xml\.name/);
   });
});

describe('nameSvgResponses', () => {
   it('names the root element of an inline SVG response schema', () => {
      const swagger = createSwagger();

      swagger.paths = {
         '/{organization}/badge': {
            get: {
               produces: ['image/svg+xml'],
               responses: { 200: { description: 'ok', schema: { type: 'string', format: 'Stream' } } },
            },
         },
      };

      const result = nameSvgResponses(swagger);

      expect(result.paths).toEqual({
         '/{organization}/badge': {
            get: {
               produces: ['image/svg+xml'],
               responses: {
                  200: { description: 'ok', schema: { type: 'string', format: 'Stream', xml: { name: 'svg' } } },
               },
            },
         },
      });
   });
});

describe('removeExamples', () => {
   it('removes x-ms-examples', () => {
      const result = removeExamples({ paths: { '/a': { get: { 'x-ms-examples': {}, operationId: 'A' } } } });

      expect(result).toEqual({ paths: { '/a': { get: { operationId: 'A' } } } });
   });
});

describe('replaceBareObjects', () => {
   it('replaces a bare object schema with an empty schema', () => {
      const result = replaceBareObjects({ type: 'object', additionalProperties: { type: 'object' } });

      expect(result).toEqual({ type: 'object', additionalProperties: {} });
   });

   it('keeps object schemas that have properties', () => {
      const schema = { type: 'object', properties: { id: { type: 'integer' } } };

      expect(replaceBareObjects(schema)).toEqual(schema);
   });

   it('keeps the description of a bare object schema', () => {
      expect(replaceBareObjects({ type: 'object', description: 'Any value' })).toEqual({ description: 'Any value' });
   });
});

describe('removeOrganization', () => {
   it('moves the organization into the server URL', () => {
      const result = removeOrganization(upgradeToOpenApi32(createSwagger()));

      expect(result.servers).toEqual([
         { url: 'https://dev.azure.com/{organization}', variables: { organization: { default: 'fabrikam' } } },
      ]);
      expect(Object.keys(result.paths ?? {})).toEqual(['/{project}/_apis/wit/classificationnodes']);
      expect(Object.keys(result['x-ms-paths'] ?? {})).toEqual(['/{project}/_apis/wit/classificationnodes?ids={ids}']);
   });

   it('removes the organization parameter from every operation', () => {
      const result = removeOrganization(upgradeToOpenApi32(createSwagger())),
         text = JSON.stringify(result.paths) + JSON.stringify(result['x-ms-paths']);

      expect(text).not.toContain('"name":"organization"');
   });

   it('keeps the server of an organization-independent API', () => {
      const swagger = createSwagger();

      swagger.host = 'app.vssps.visualstudio.com';
      swagger.paths = { '/_apis/accounts': { get: { responses: { 200: { description: 'ok' } } } } };
      delete swagger['x-ms-paths'];

      const result = removeOrganization(upgradeToOpenApi32(swagger));

      expect(result.servers).toEqual([{ url: 'https://app.vssps.visualstudio.com' }]);
      expect(Object.keys(result.paths ?? {})).toEqual(['/_apis/accounts']);
   });

   it('defines host variables that the source leaves undefined', () => {
      const swagger = createSwagger();

      swagger.host = '{service}dev.azure.com';

      const result = removeOrganization(upgradeToOpenApi32(swagger));

      expect(result.servers).toEqual([
         {
            url: 'https://{service}dev.azure.com/{organization}',
            variables: { organization: { default: 'fabrikam' }, service: { default: '' } },
         },
      ]);
   });

   it('throws when only some paths start with /{organization}', () => {
      const swagger = createSwagger();

      swagger.paths = {
         '/_apis/accounts': { get: { responses: { 200: { description: 'ok' } } } },
         '/{organization}/_apis/projects': { get: { responses: { 200: { description: 'ok' } } } },
      };

      expect(() => {
         return removeOrganization(upgradeToOpenApi32(swagger));
      }).toThrow(/do not start with/);
   });
});

describe('removeTrailingSlashes', () => {
   it('removes a trailing slash from a path key', () => {
      const result = removeTrailingSlashes({ paths: { '/': {}, '/_apis/projects/{projectId}/categorizedteams/': {} } });

      expect(Object.keys(result.paths ?? {})).toEqual(['/', '/_apis/projects/{projectId}/categorizedteams']);
   });

   it('throws when two keys become one', () => {
      expect(() => {
         return removeTrailingSlashes({ paths: { '/a': {}, '/a/': {} } });
      }).toThrow(/two paths/);
   });
});

describe('addApiVersions', () => {
   it('writes the version of the referenced api-version parameter', () => {
      const result = convert();

      expect(result.paths).toMatchObject({
         '/{project}/_apis/wit/classificationnodes': { get: { 'x-ado-api-version': '7.1' } },
      });
      expect(result['x-ms-paths']).toMatchObject({
         '/{project}/_apis/wit/classificationnodes?ids={ids}': { get: { 'x-ado-api-version': '7.1-preview.4' } },
      });
   });

   it('throws when x-ms-docs-override-version disagrees', () => {
      const swagger = createSwagger();

      swagger.paths = {
         '/{organization}/a': {
            get: {
               parameters: [ORGANIZATION_PARAMETER, { $ref: '#/parameters/api-Version-preview.4' }],
               responses: { 200: { description: 'ok' } },
               'x-ms-docs-override-version': '7.1',
            },
         },
      };

      expect(() => {
         return convert(swagger);
      }).toThrow(/x-ms-docs-override-version is "7.1"/);
   });

   it('throws when an operation has no api-version parameter', () => {
      const swagger = createSwagger();

      swagger.paths = {
         '/{organization}/a': {
            get: { parameters: [ORGANIZATION_PARAMETER], responses: { 200: { description: 'ok' } } },
         },
      };

      expect(() => {
         return convert(swagger);
      }).toThrow(/no api-version parameter/);
   });
});

describe('moveMsPathsIntoPaths', () => {
   it('moves x-ms-paths into paths and keeps the query string in the key', () => {
      const result = moveMsPathsIntoPaths(convert());

      expect(result['x-ms-paths']).toBeUndefined();
      expect(Object.keys(result.paths ?? {})).toEqual([
         '/{project}/_apis/wit/classificationnodes',
         '/{project}/_apis/wit/classificationnodes?ids={ids}',
      ]);
   });
});

describe('removeApiVersionParameter', () => {
   it('removes the api-version parameter and its components', () => {
      const result = removeApiVersionParameter(moveMsPathsIntoPaths(convert()));

      expect(result.components).toEqual({ schemas: expect.any(Object) });
      expect(result.paths).toMatchObject({
         '/{project}/_apis/wit/classificationnodes': { get: { parameters: [] } },
         '/{project}/_apis/wit/classificationnodes?ids={ids}': { get: { parameters: [{ name: 'ids' }] } },
      });
   });
});

describe('openObjectSchemas', () => {
   it('adds additionalProperties to object schemas that have properties', () => {
      const result = openObjectSchemas({ type: 'object', properties: { id: { type: 'integer' } } });

      expect(result).toEqual({ type: 'object', properties: { id: { type: 'integer' } }, additionalProperties: {} });
   });

   it('keeps an existing additionalProperties', () => {
      const schema = { type: 'object', properties: {}, additionalProperties: false };

      expect(openObjectSchemas(schema)).toEqual(schema);
   });
});

describe('allowNullInOptionalProperties', () => {
   const REF = { $ref: ';/components/schemas/IdentityRef' };

   it('adds null to the type and the enum of an optional property, and keeps required ones', () => {
      const result = allowNullInOptionalProperties({
         type: 'object',
         required: ['id'],
         properties: {
            id: { type: 'integer' },
            name: { type: 'string', description: 'The name' },
            state: { type: 'string', enum: ['active', 'closed'] },
         },
      });

      expect(result.properties).toEqual({
         id: { type: 'integer' },
         name: { type: ['string', 'null'], description: 'The name' },
         state: { type: ['string', 'null'], enum: ['active', 'closed', null] },
      });
   });

   it('wraps a $ref in anyOf and keeps the description on the outer schema', () => {
      const result = allowNullInOptionalProperties({
         type: 'object',
         properties: { owner: { ...REF, description: 'The owner' }, any: {} },
      });

      expect(result.properties).toEqual({
         owner: { description: 'The owner', anyOf: [REF, { type: 'null' }] },
         any: {},
      });
   });

   it('changes nested object schemas and leaves maps that are not object schemas', () => {
      const result = allowNullInOptionalProperties({
         components: {
            schemas: {
               Item: {
                  type: 'object',
                  properties: { child: { type: 'object', properties: { tag: { type: 'string' } } } },
               },
            },
         },
      });

      expect(result).toEqual({
         components: {
            schemas: {
               Item: {
                  type: 'object',
                  properties: {
                     child: { type: ['object', 'null'], properties: { tag: { type: ['string', 'null'] } } },
                  },
               },
            },
         },
      });
   });
});

describe('unwrapArrayAllOf', () => {
   it('replaces an object schema whose only allOf member is an array with that member', () => {
      const schema = {
         description: 'The JSON model for JSON Patch Operations',
         type: 'object',
         allOf: [{ type: 'array', items: { $ref: '#/components/schemas/JsonPatchOperation' } }],
         properties: {},
      };

      expect(unwrapArrayAllOf(schema)).toEqual({
         description: 'The JSON model for JSON Patch Operations',
         type: 'array',
         items: { $ref: '#/components/schemas/JsonPatchOperation' },
      });
   });

   it('keeps an allOf whose member is an object', () => {
      const schema = { type: 'object', allOf: [{ $ref: '#/components/schemas/Base' }], properties: { id: {} } };

      expect(unwrapArrayAllOf(schema)).toEqual(schema);
   });
});

describe('markStreamsAsBinary', () => {
   it('changes format Stream to binary', () => {
      expect(markStreamsAsBinary({ type: 'string', format: 'Stream' })).toEqual({ type: 'string', format: 'binary' });
   });
});

describe('makeWiqlTeamOptional', () => {
   it('makes team optional in the WIQL paths only', () => {
      const team = { name: 'team', in: 'path', required: true },
         result = makeWiqlTeamOptional({
            paths: {
               '/{project}/{team}/_apis/wit/wiql/{id}': { get: { parameters: [{ ...team }] } },
               '/{project}/{team}/_apis/wit/templates': { get: { parameters: [{ ...team }] } },
            },
         });

      expect(result.paths).toEqual({
         '/{project}/{team}/_apis/wit/wiql/{id}': { get: { parameters: [{ ...team, required: false }] } },
         '/{project}/{team}/_apis/wit/templates': { get: { parameters: [team] } },
      });
   });
});

describe('addArea', () => {
   it('writes the area to every operation', () => {
      const result = addArea(convert(), 'wit');

      expect(result.paths).toMatchObject({
         '/{project}/_apis/wit/classificationnodes': { get: { 'x-ado-area': 'wit' } },
      });
      expect(result['x-ms-paths']).toMatchObject({
         '/{project}/_apis/wit/classificationnodes?ids={ids}': { get: { 'x-ado-area': 'wit' } },
      });
   });
});

describe('fixFormatTypes', () => {
   it('moves a format written as a type into format', () => {
      expect(fixFormatTypes({ type: 'object', additionalProperties: { type: 'int32' } })).toEqual({
         type: 'object',
         additionalProperties: { type: 'integer', format: 'int32' },
      });
   });
});

describe('matchPathParameterCase', () => {
   it('spells a path template like its parameter', () => {
      const result = matchPathParameterCase({
         paths: {
            '/{project}/_apis/build/definitions/{DefinitionId}/tags': {
               get: {
                  parameters: [
                     { in: 'path', name: 'project' },
                     { in: 'path', name: 'definitionId' },
                  ],
               },
            },
         },
      });

      expect(Object.keys(result.paths ?? {})).toEqual(['/{project}/_apis/build/definitions/{definitionId}/tags']);
   });
});
