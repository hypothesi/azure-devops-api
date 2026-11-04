import type { ChangeKind } from '../../src/manifest.ts';
import { getObject, getString, isJsonObject } from './json.ts';
import type { JsonObject, JsonValue } from './json.ts';
import { listOperations } from './transforms.ts';

export interface AreaComparison {
   readonly change: ChangeKind;
   readonly addedOperations: string[];
   readonly removedOperations: string[];
   /** One line per additive or breaking change, sorted. */
   readonly changes: string[];
}

interface Changes {
   readonly additive: Set<string>;
   readonly breaking: Set<string>;
}

/**
 * Keys outside the contract, which manifest.ts defines as operations, parameters, request
 * bodies, and schemas. Every `x-` extension is ignored too.
 */
const IGNORED_KEYS: ReadonlySet<string> = new Set([
      'description',
      'summary',
      'example',
      'examples',
      'externalDocs',
      'security',
      'securitySchemes',
      'tags',
   ]),
   /** Keys whose value is a map from a name to an object, such as `properties`. */
   MAP_KEYS: ReadonlySet<string> = new Set([
      'properties',
      'patternProperties',
      'responses',
      'content',
      'headers',
      'encoding',
      'links',
      'callbacks',
      'variables',
      'scopes',
      'mapping',
      'flows',
      '$defs',
      'dependentSchemas',
   ]),
   /** Keys whose array value is unordered. */
   SET_KEYS: ReadonlySet<string> = new Set(['enum', 'required']),
   /** `responses` to `response`, so a change reads `response 200 removed`. */
   MAP_ENTRY_LABELS: Readonly<Record<string, string>> = {
      properties: 'property',
      responses: 'response',
      headers: 'header',
      scopes: 'scope',
      variables: 'variable',
      schemas: 'schema',
      parameters: 'parameter',
      requestBodies: 'request body',
      securitySchemes: 'security scheme',
   };

function describe(segments: readonly string[], what: string): string {
   const [head, ...rest] = segments;

   return head === undefined ? what : `${head}: ${[...rest, what].join(' ')}`;
}

function getMapEntryLabel(mapKey: string, entryKey: string): string {
   if (mapKey === 'content') {
      return entryKey;
   }

   return `${MAP_ENTRY_LABELS[mapKey] ?? mapKey} ${entryKey}`;
}

/** Compares `enum` or `required`, whose order does not matter. */
function compareSet(segments: readonly string[], key: string, a: JsonValue[], b: JsonValue[], changes: Changes): void {
   const isEnum = key === 'enum',
      format = (value: JsonValue): string => {
         return isEnum || typeof value !== 'string' ? JSON.stringify(value) : value;
      },
      before = a.map(format),
      after = b.map(format);

   for (const value of after.filter((item) => {
      return !before.includes(item);
   })) {
      const target = isEnum ? changes.additive : changes.breaking;

      target.add(describe(segments, isEnum ? `enum value ${value} added` : `property ${value} became required`));
   }

   for (const value of before.filter((item) => {
      return !after.includes(item);
   })) {
      changes.breaking.add(
         describe(segments, isEnum ? `enum value ${value} removed` : `property ${value} is no longer required`),
      );
   }
}

/** Compares a map such as `properties`. A new entry is additive and a removed entry is breaking. */
function compareMap(segments: readonly string[], key: string, a: JsonObject, b: JsonObject, changes: Changes): void {
   for (const entryKey of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const label = getMapEntryLabel(key, entryKey),
         before = a[entryKey],
         after = b[entryKey];

      if (before === undefined) {
         changes.additive.add(describe(segments, `${label} added`));
      } else if (after === undefined) {
         changes.breaking.add(describe(segments, `${label} removed`));
      } else {
         compareNode([...segments, label], before, after, changes);
      }
   }
}

function isOptionalArray(value: JsonValue | undefined): value is JsonValue[] | undefined {
   return value === undefined || Array.isArray(value);
}

function isIgnored(key: string): boolean {
   return IGNORED_KEYS.has(key) || key.startsWith('x-');
}

/** Compares two values of an object that is not a map. Any difference is breaking, unless a map or set rule says otherwise. */
function compareNode(segments: readonly string[], a: JsonValue, b: JsonValue, changes: Changes): void {
   if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      a.forEach((item, index) => {
         compareNode([...segments, `[${index}]`], item, b[index] ?? null, changes);
      });

      return;
   }

   if (!isJsonObject(a) || !isJsonObject(b)) {
      if (JSON.stringify(a) !== JSON.stringify(b)) {
         changes.breaking.add(describe(segments, `changed from ${JSON.stringify(a)} to ${JSON.stringify(b)}`));
      }

      return;
   }

   for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const before = a[key],
         after = b[key];

      if (isIgnored(key)) {
         continue;
      }

      if (key === 'required' && isOptionalArray(before) && isOptionalArray(after)) {
         compareSet(segments, key, before ?? [], after ?? [], changes);
      } else if (before === undefined) {
         changes.breaking.add(describe(segments, `${key} added`));
      } else if (after === undefined) {
         changes.breaking.add(describe(segments, `${key} removed`));
      } else if (SET_KEYS.has(key) && Array.isArray(before) && Array.isArray(after)) {
         compareSet(segments, key, before, after, changes);
      } else if (MAP_KEYS.has(key) && isJsonObject(before) && isJsonObject(after)) {
         compareMap(segments, key, before, after, changes);
      } else {
         compareNode([...segments, key], before, after, changes);
      }
   }
}

function getParameterMap(parameters: JsonValue[]): Map<string, JsonObject> {
   const map = new Map<string, JsonObject>();

   for (const parameter of parameters) {
      if (isJsonObject(parameter)) {
         map.set(
            typeof parameter.$ref === 'string'
               ? parameter.$ref
               : `${getString(parameter, 'in') ?? ''} ${getString(parameter, 'name') ?? ''}`,
            parameter,
         );
      }
   }

   return map;
}

/** Every operation keyed by `METHOD path`, with the path item's parameters added to its own. */
function getOperationMap(document: JsonObject): Map<string, JsonObject> {
   const map = new Map<string, JsonObject>(),
      paths = getObject(document, 'paths');

   for (const { pathKey, method, operation } of listOperations(document)) {
      const pathParameters = getObject(paths, pathKey).parameters,
         parameters = [
            ...(Array.isArray(pathParameters) ? pathParameters : []),
            ...(Array.isArray(operation.parameters) ? operation.parameters : []),
         ];

      map.set(`${method.toUpperCase()} ${pathKey}`, { ...operation, parameters });
   }

   return map;
}

function compareParameters(segments: readonly string[], a: JsonValue, b: JsonValue, changes: Changes): void {
   const before = getParameterMap(Array.isArray(a) ? a : []),
      after = getParameterMap(Array.isArray(b) ? b : []);

   for (const [key, parameter] of after) {
      const previous = before.get(key);

      if (previous === undefined) {
         const target = parameter.required === true ? changes.breaking : changes.additive;

         target.add(
            describe(segments, `${parameter.required === true ? 'required' : 'optional'} parameter ${key} added`),
         );
      } else {
         compareNode([...segments, `parameter ${key}`], previous, parameter, changes);
      }
   }

   for (const key of before.keys()) {
      if (!after.has(key)) {
         changes.breaking.add(describe(segments, `parameter ${key} removed`));
      }
   }
}

function getChangeKind(
   changes: Changes,
   addedOperations: readonly string[],
   removedOperations: readonly string[],
): ChangeKind {
   if (changes.breaking.size > 0 || removedOperations.length > 0) {
      return 'breaking';
   }

   return changes.additive.size > 0 || addedOperations.length > 0 ? 'additive' : 'identical';
}

/**
 * Compares two versions of an area, as written to `dist/codegen`. Descriptions, examples,
 * and `x-` extensions are ignored, which includes `x-ado-api-version` and
 * `x-ms-docs-override-version`.
 */
export function compareAreas(previous: JsonObject, current: JsonObject): AreaComparison {
   const changes: Changes = { additive: new Set(), breaking: new Set() },
      before = getOperationMap(previous),
      after = getOperationMap(current),
      addedOperations = [...after.keys()].filter((key) => {
         return !before.has(key);
      }),
      removedOperations = [...before.keys()].filter((key) => {
         return !after.has(key);
      }),
      previousComponents = getObject(previous, 'components'),
      currentComponents = getObject(current, 'components');

   for (const [key, operation] of after) {
      const previousOperation = before.get(key),
         segments = [`operation ${key}`];

      if (previousOperation === undefined) {
         continue;
      }

      const { parameters: previousParameters = [], ...previousRest } = previousOperation,
         { parameters = [], ...rest } = operation;

      compareParameters(segments, previousParameters, parameters, changes);
      compareNode(segments, previousRest, rest, changes);
   }

   for (const section of new Set([...Object.keys(previousComponents), ...Object.keys(currentComponents)])) {
      if (isIgnored(section)) {
         continue;
      }

      compareMap([], section, getObject(previousComponents, section), getObject(currentComponents, section), changes);
   }

   compareNode(['servers'], previous.servers ?? null, current.servers ?? null, changes);

   return {
      change: getChangeKind(changes, addedOperations, removedOperations),
      addedOperations: addedOperations.toSorted(),
      removedOperations: removedOperations.toSorted(),
      changes: [...changes.breaking, ...changes.additive].toSorted(),
   };
}
