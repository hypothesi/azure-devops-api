import { upgrade } from '@scalar/openapi-upgrader';
import { getObject, getOrCreateObject, isJsonObject, toJsonObject, walkObjects } from './json.ts';
import type { JsonObject, JsonValue } from './json.ts';

const BOM = String.fromCodePoint(0xfe_ff),
   HTTP_METHODS: readonly string[] = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'],
   MS_PATHS = 'x-ms-paths',
   ORGANIZATION_PREFIX = '/{organization}',
   PARAMETER_REF_PREFIX = '#/components/parameters/',
   API_VERSION_COMPONENT_PREFIX = 'api-Version',
   API_VERSION_DESCRIPTION = /set to '([^']+)'/;

export interface Operation {
   readonly pathKey: string;
   readonly method: string;
   readonly operation: JsonObject;
}

/** Every operation in `paths` and `x-ms-paths`, with its path key and lowercase method. */
export function listOperations(document: JsonObject): Operation[] {
   const operations: Operation[] = [];

   for (const section of ['paths', MS_PATHS]) {
      for (const [pathKey, pathItem] of Object.entries(getObject(document, section))) {
         if (!isJsonObject(pathItem)) {
            continue;
         }

         for (const method of HTTP_METHODS) {
            const operation = pathItem[method];

            if (isJsonObject(operation)) {
               operations.push({ pathKey, method, operation });
            }
         }
      }
   }

   return operations;
}

/** Step 1. Some source files start with a UTF-8 byte order mark, which `JSON.parse` rejects. */
export function removeBom(text: string): string {
   return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

function partitionPaths(paths: JsonObject): { paths: JsonObject; msPaths: JsonObject } {
   const result = { paths: {}, msPaths: {} } satisfies Record<string, JsonObject>;

   for (const [key, value] of Object.entries(paths)) {
      const target: JsonObject = key.includes('?') ? result.msPaths : result.paths;

      target[key] = value;
   }

   return result;
}

const SVG_MEDIA_TYPE = 'image/svg+xml';

/**
 * Runs before step 2. OpenAPI 3.2 needs an `xml.name` on an inline schema of an XML media
 * type, and the upgrader stops without one. The badge operations return `image/svg+xml`,
 * whose root element is always `<svg>`.
 */
export function nameSvgResponses(swagger: JsonObject): JsonObject {
   const result = structuredClone(swagger);

   for (const { operation } of listOperations(result)) {
      if (!Array.isArray(operation.produces) || !operation.produces.includes(SVG_MEDIA_TYPE)) {
         continue;
      }

      for (const response of Object.values(getObject(operation, 'responses'))) {
         const schema = isJsonObject(response) ? response.schema : undefined;

         if (isJsonObject(schema) && !('$ref' in schema) && !('xml' in schema)) {
            schema.xml = { name: 'svg' };
         }
      }
   }

   return result;
}

/**
 * Step 2. Upgrades a Swagger 2.0 document to OpenAPI 3.2 and throws
 * `UpgradeIncompatibilityError` on any diagnostic.
 *
 * The upgrader does not convert `x-ms-paths`, so those operations go through the upgrade
 * in `paths` and move back afterward. Their keys contain `?`, which no `paths` key does.
 */
export function upgradeToOpenApi32(swagger: JsonObject): JsonObject {
   const { [MS_PATHS]: msPaths, ...rest } = swagger,
      paths = getObject(swagger, 'paths');

   if (
      Object.keys(paths).some((key) => {
         return key.includes('?');
      })
   ) {
      throw new Error('A key in paths contains "?", so x-ms-paths cannot be told apart after the upgrade');
   }

   const input: JsonObject = { ...rest, paths: { ...paths, ...(isJsonObject(msPaths) ? msPaths : {}) } },
      upgraded = toJsonObject(upgrade(input, '3.2')),
      split = partitionPaths(getObject(upgraded, 'paths'));

   upgraded.paths = split.paths;

   if (Object.keys(split.msPaths).length > 0) {
      upgraded[MS_PATHS] = split.msPaths;
   }

   return upgraded;
}

/** Step 3. The `x-ms-examples` values point at example files that are not in the snapshot. */
export function removeExamples(document: JsonObject): JsonObject {
   const result = structuredClone(document);

   walkObjects(result, (node) => {
      delete node['x-ms-examples'];
   });

   return result;
}

const OBJECT_SHAPE_KEYS: readonly string[] = [
   'properties',
   'additionalProperties',
   'patternProperties',
   'allOf',
   'anyOf',
   'oneOf',
   '$ref',
];

/**
 * Step 4. The source uses a bare `{ "type": "object" }` for "any value", for example the
 * values of `WorkItem.fields`, which are strings, numbers, and objects. Removing `type`
 * gives `{}`, which accepts any value.
 */
export function replaceBareObjects(document: JsonObject): JsonObject {
   const result = structuredClone(document);

   walkObjects(result, (node) => {
      const isBareObject =
         node.type === 'object' &&
         !OBJECT_SHAPE_KEYS.some((key) => {
            return key in node;
         });

      if (isBareObject) {
         delete node.type;
      }
   });

   return result;
}

function isEmptyObject(value: JsonValue | undefined): boolean {
   return value === undefined || (isJsonObject(value) && Object.keys(value).length === 0);
}

/**
 * Runs after step 4. `JsonPatchDocument` is `{ type: 'object', allOf: [{ type: 'array', ... }] }`,
 * which no value can match: a value cannot be an object and an array. The array member is
 * what Azure DevOps accepts, so it replaces the schema.
 */
export function unwrapArrayAllOf(document: JsonObject): JsonObject {
   const result = structuredClone(document);

   walkObjects(result, (node) => {
      const { type, allOf, properties, ...rest } = node,
         member = Array.isArray(allOf) && allOf.length === 1 ? allOf[0] : undefined;

      if (type !== 'object' || !isJsonObject(member) || member.type !== 'array' || !isEmptyObject(properties)) {
         return;
      }

      for (const key of Object.keys(node)) {
         delete node[key];
      }

      Object.assign(node, rest, member);
   });

   return result;
}

/** Formats that the source writes as a `type`, with the type they belong to. */
const FORMAT_TYPES: Readonly<Record<string, string>> = {
   int32: 'integer',
   int64: 'integer',
   float: 'number',
   double: 'number',
};

/**
 * Runs after step 4. Notification's `stats` schemas use `type: int32`, which is not a JSON
 * Schema type. It becomes `type: integer, format: int32`.
 */
export function fixFormatTypes(document: JsonObject): JsonObject {
   const result = structuredClone(document);

   walkObjects(result, (node) => {
      const type = typeof node.type === 'string' ? FORMAT_TYPES[node.type] : undefined;

      if (type !== undefined && !('format' in node)) {
         node.format = node.type ?? null;
         node.type = type;
      }
   });

   return result;
}

/**
 * Runs after step 5. Build's tag paths use `{DefinitionId}` while the parameter is named
 * `definitionId`. Path templates are case-sensitive, so the path key takes the parameter's
 * spelling.
 */
export function matchPathParameterCase(document: JsonObject): JsonObject {
   const result = structuredClone(document),
      parameters = getObject(getObject(result, 'components'), 'parameters'),
      names = new Map<string, Set<string>>();

   for (const { pathKey, operation } of listOperations(result)) {
      const known = names.get(pathKey) ?? new Set<string>();

      for (const parameter of Array.isArray(operation.parameters) ? operation.parameters : []) {
         const resolved =
            isJsonObject(parameter) && typeof parameter.$ref === 'string'
               ? parameters[parameter.$ref.slice(PARAMETER_REF_PREFIX.length)]
               : parameter;

         if (isJsonObject(resolved) && resolved.in === 'path' && typeof resolved.name === 'string') {
            known.add(resolved.name);
         }
      }

      names.set(pathKey, known);
   }

   renamePathKeys(result, (pathKey) => {
      const known = [...(names.get(pathKey) ?? [])];

      return pathKey.replaceAll(/\{([^}]+)\}/g, (template: string, name: string) => {
         const match = known.find((candidate) => {
            return candidate !== name && candidate.toLowerCase() === name.toLowerCase();
         });

         return match === undefined || known.includes(name) ? template : `{${match}}`;
      });
   });

   return result;
}

function isOrganizationParameter(parameter: JsonValue, components: JsonObject): boolean {
   if (!isJsonObject(parameter)) {
      return false;
   }

   const resolved =
      typeof parameter.$ref === 'string' ? components[parameter.$ref.slice(PARAMETER_REF_PREFIX.length)] : parameter;

   return isJsonObject(resolved) && resolved.in === 'path' && resolved.name === 'organization';
}

/**
 * Notification's host is `{service}dev.azure.com`, with no definition of `service`. An
 * empty default gives `dev.azure.com`, which serves the notification API.
 */
function withHostVariables(server: { url: string; variables?: JsonObject }): JsonObject {
   const variables: JsonObject = { ...server.variables };

   for (const [, name = ''] of server.url.matchAll(/\{([^}]+)\}/g)) {
      variables[name] ??= { default: '' };
   }

   return Object.keys(variables).length > 0 ? { url: server.url, variables } : { url: server.url };
}

function hasOrganizationPrefix(pathKey: string): boolean {
   return pathKey.startsWith(ORGANIZATION_PREFIX) && /^(?:[/?]|$)/.test(pathKey.slice(ORGANIZATION_PREFIX.length));
}

function stripOrganizationPrefix(pathKey: string): string {
   const rest = pathKey.slice(ORGANIZATION_PREFIX.length);

   return rest.startsWith('/') ? rest : `/${rest}`;
}

/** Renames the keys of `paths` and `x-ms-paths` in place, keeping their order. */
function renamePathKeys(document: JsonObject, rename: (pathKey: string) => string): void {
   for (const section of ['paths', MS_PATHS]) {
      const paths = document[section];

      if (!isJsonObject(paths)) {
         continue;
      }

      const renamed: JsonObject = {};

      for (const [pathKey, pathItem] of Object.entries(paths)) {
         const key = rename(pathKey);

         if (key in renamed) {
            throw new Error(`${pathKey}: two paths become ${key}`);
         }

         renamed[key] = pathItem;
      }

      document[section] = renamed;
   }
}

function removeParameters(holder: JsonObject, isRemoved: (parameter: JsonValue) => boolean): void {
   const parameters = holder.parameters;

   if (!Array.isArray(parameters)) {
      return;
   }

   holder.parameters = parameters.filter((parameter) => {
      return !isRemoved(parameter);
   });
}

/**
 * Step 5. Moves the `/{organization}` path prefix into the server URL, so a consumer sets
 * the organization (or a server's collection URL) once instead of on every call.
 */
export function removeOrganization(document: JsonObject): JsonObject {
   const result = structuredClone(document),
      servers = result.servers,
      firstServer = Array.isArray(servers) ? servers[0] : undefined,
      parameters = getObject(getObject(result, 'components'), 'parameters'),
      isRemoved = (parameter: JsonValue): boolean => {
         return isOrganizationParameter(parameter, parameters);
      };

   if (!isJsonObject(firstServer) || typeof firstServer.url !== 'string') {
      throw new Error('The upgraded document has no server URL');
   }

   const pathKeys = listOperations(result).map(({ pathKey }) => {
         return pathKey;
      }),
      prefixed = pathKeys.filter(hasOrganizationPrefix);

   // Organization-independent APIs, such as accounts on app.vssps.visualstudio.com.
   if (prefixed.length === 0) {
      result.servers = [withHostVariables({ url: firstServer.url.replace(/\/$/, '') })];

      return result;
   }

   if (prefixed.length !== pathKeys.length) {
      throw new Error(`Some paths do not start with ${ORGANIZATION_PREFIX}`);
   }

   renamePathKeys(result, stripOrganizationPrefix);

   for (const pathItem of [
      ...Object.values(getObject(result, 'paths')),
      ...Object.values(getObject(result, MS_PATHS)),
   ]) {
      if (isJsonObject(pathItem)) {
         removeParameters(pathItem, isRemoved);
      }
   }

   for (const { operation } of listOperations(result)) {
      removeParameters(operation, isRemoved);
   }

   for (const [name, parameter] of Object.entries(parameters)) {
      if (isRemoved(parameter)) {
         delete parameters[name];
      }
   }

   result.servers = [
      withHostVariables({
         url: `${firstServer.url.replace(/\/$/, '')}${ORGANIZATION_PREFIX}`,
         variables: { organization: { default: 'fabrikam' } },
      }),
   ];

   return result;
}

/**
 * Runs after step 5. Removes a trailing slash from path keys, such as
 * `/_apis/projects/{projectId}/categorizedteams/` in core 7.1, so every path key has one form.
 */
export function removeTrailingSlashes(document: JsonObject): JsonObject {
   const result = structuredClone(document);

   renamePathKeys(result, (pathKey) => {
      return pathKey.length > 1 ? pathKey.replace(/\/$/, '') : pathKey;
   });

   return result;
}

function getApiVersionReference(operation: JsonObject, parameters: JsonObject): string | undefined {
   const references = (Array.isArray(operation.parameters) ? operation.parameters : []).flatMap((parameter) => {
      if (!isJsonObject(parameter) || typeof parameter.$ref !== 'string') {
         return [];
      }

      const name = parameter.$ref.slice(PARAMETER_REF_PREFIX.length),
         component = parameters[name];

      return isJsonObject(component) && component.name === 'api-version' ? [name] : [];
   });

   return references[0];
}

/**
 * Step 6. Writes the exact API version of each operation, for example `7.1-preview.4`, to
 * `x-ado-api-version`. The value comes from the name of the referenced `api-version`
 * parameter, and the build stops when the parameter's description or
 * `x-ms-docs-override-version` says something else.
 */
export function addApiVersions(document: JsonObject, apiVersion: string): JsonObject {
   const result = structuredClone(document),
      parameters = getObject(getObject(result, 'components'), 'parameters');

   for (const { pathKey, method, operation } of listOperations(result)) {
      const label = `${method.toUpperCase()} ${pathKey}`,
         reference = getApiVersionReference(operation, parameters);

      if (reference === undefined || !reference.startsWith(API_VERSION_COMPONENT_PREFIX)) {
         throw new Error(`${label}: no api-version parameter reference`);
      }

      const version = `${apiVersion}${reference.slice(API_VERSION_COMPONENT_PREFIX.length)}`,
         component = getObject(parameters, reference),
         described =
            typeof component.description === 'string'
               ? API_VERSION_DESCRIPTION.exec(component.description)?.[1]
               : undefined,
         override = operation['x-ms-docs-override-version'];

      if (described !== undefined && described !== version) {
         throw new Error(`${label}: parameter ${reference} is ${version} but its description says ${described}`);
      }

      if (override !== undefined && override !== version) {
         throw new Error(
            `${label}: api-version is ${version} but x-ms-docs-override-version is ${JSON.stringify(override)}`,
         );
      }

      operation['x-ado-api-version'] = version;
   }

   return result;
}

/**
 * Moves `x-ms-paths` into `paths` and keeps the query string in the key. Only for the
 * codegen and docs builds: OpenAPI allows one operation per method and path, but Kubb and
 * Scalar accept the keys.
 */
export function moveMsPathsIntoPaths(document: JsonObject): JsonObject {
   const { [MS_PATHS]: msPaths, ...result } = structuredClone(document);

   result.paths = { ...getObject(result, 'paths'), ...(isJsonObject(msPaths) ? msPaths : {}) };

   return result;
}

/** For codegen. The generated client sends `api-version` from `x-ado-api-version`. */
export function removeApiVersionParameter(document: JsonObject): JsonObject {
   const result = structuredClone(document),
      components = getOrCreateObject(result, 'components'),
      parameters = getOrCreateObject(components, 'parameters'),
      isApiVersion = (parameter: JsonValue): boolean => {
         const resolved =
            isJsonObject(parameter) && typeof parameter.$ref === 'string'
               ? parameters[parameter.$ref.slice(PARAMETER_REF_PREFIX.length)]
               : parameter;

         return isJsonObject(resolved) && resolved.in === 'query' && resolved.name === 'api-version';
      };

   for (const { operation } of listOperations(result)) {
      removeParameters(operation, isApiVersion);
   }

   for (const [name, parameter] of Object.entries(parameters)) {
      if (isApiVersion(parameter)) {
         delete parameters[name];
      }
   }

   if (Object.keys(parameters).length === 0) {
      delete components.parameters;
   }

   return result;
}

/**
 * For codegen. OpenAPI already allows extra properties when `additionalProperties` is
 * absent, but Kubb then generates closed types and strict Zod objects. An explicit
 * `additionalProperties: {}` makes it generate open ones, so a property that Microsoft
 * adds later does not fail validation.
 */
export function openObjectSchemas(document: JsonObject): JsonObject {
   const result = structuredClone(document);

   walkObjects(result, (node) => {
      if (node.type === 'object' && isJsonObject(node.properties) && !('additionalProperties' in node)) {
         node.additionalProperties = {};
      }
   });

   return result;
}

/** For codegen. Microsoft marks binary responses `format: Stream`, and Kubb types `format: binary` as `Blob`. */
export function markStreamsAsBinary(document: JsonObject): JsonObject {
   const result = structuredClone(document);

   walkObjects(result, (node) => {
      if (node.type === 'string' && node.format === 'Stream') {
         node.format = 'binary';
      }
   });

   return result;
}

/** For the docs build. Writes the area folder name to `x-ado-area` on every operation. */
export function addArea(document: JsonObject, area: string): JsonObject {
   const result = structuredClone(document);

   for (const { operation } of listOperations(result)) {
      operation['x-ado-area'] = area;
   }

   return result;
}
