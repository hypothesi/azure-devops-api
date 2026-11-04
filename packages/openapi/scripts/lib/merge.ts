import { isDeepStrictEqual } from 'node:util';
import { getObject, getOrCreateObject, isJsonObject, walkObjects } from './json.ts';
import type { JsonObject, JsonValue } from './json.ts';

export interface DocumentPart {
   /** Suffix for a component key when another part defines the key with a different value, such as `Npm`. */
   readonly suffix: string;
   readonly document: JsonObject;
}

const PATH_SECTIONS: readonly string[] = ['paths', 'x-ms-paths'],
   SECURITY_SCHEMES = 'securitySchemes';

/** `wit` to `Wit`, `nuGet` to `NuGet`. */
export function toPascalCase(value: string): string {
   return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

/**
 * Maps `#/components/{section}/{key}` to its new reference, per part. Only components that
 * two parts define with different values get a new reference.
 */
function planRenames(parts: readonly DocumentPart[]): Map<string, string>[] {
   const renames = parts.map(() => {
         return new Map<string, string>();
      }),
      byReference = new Map<string, { index: number; value: JsonValue }[]>();

   parts.forEach((part, index) => {
      for (const [section, components] of Object.entries(getObject(part.document, 'components'))) {
         if (section === SECURITY_SCHEMES || !isJsonObject(components)) {
            continue;
         }

         for (const [key, value] of Object.entries(components)) {
            const reference = `#/components/${section}/${key}`,
               entries = byReference.get(reference) ?? [];

            entries.push({ index, value });
            byReference.set(reference, entries);
         }
      }
   });

   for (const [reference, entries] of byReference) {
      const first = entries[0],
         isShared = entries.every((entry) => {
            return first !== undefined && isDeepStrictEqual(entry.value, first.value);
         });

      if (isShared) {
         continue;
      }

      for (const { index } of entries) {
         const renamed = `${reference}${parts[index]?.suffix ?? ''}`;

         if (byReference.has(renamed)) {
            throw new Error(`Cannot rename ${reference} to ${renamed}: a component already uses ${renamed}`);
         }

         renames[index]?.set(reference, renamed);
      }
   }

   return renames;
}

function renameComponents(document: JsonObject, renames: Map<string, string>): JsonObject {
   const result = structuredClone(document),
      components = getObject(result, 'components');

   if (renames.size === 0) {
      return result;
   }

   walkObjects(result, (node) => {
      const renamed = typeof node.$ref === 'string' ? renames.get(node.$ref) : undefined;

      if (renamed !== undefined) {
         node.$ref = renamed;
      }
   });

   for (const [reference, renamed] of renames) {
      const [, , section = '', key = ''] = reference.split('/'),
         target = getObject(components, section);

      target[renamed.slice(renamed.lastIndexOf('/') + 1)] = target[key] ?? null;
      delete target[key];
   }

   return result;
}

/** Merges two security schemes with the same key. OAuth scopes are combined. */
function mergeSecurityScheme(key: string, a: JsonValue, b: JsonValue): JsonValue {
   if (isDeepStrictEqual(a, b)) {
      return a;
   }

   if (!isJsonObject(a) || !isJsonObject(b) || a.type !== 'oauth2' || b.type !== 'oauth2') {
      throw new Error(`Security scheme ${key} differs between documents`);
   }

   const result = structuredClone(a),
      flows = getOrCreateObject(result, 'flows');

   for (const [flowName, flow] of Object.entries(getObject(b, 'flows'))) {
      const existing = flows[flowName];

      if (!isJsonObject(existing) || !isJsonObject(flow)) {
         flows[flowName] = flow;
         continue;
      }

      const { scopes: existingScopes, ...existingRest } = existing,
         { scopes, ...rest } = flow;

      if (!isDeepStrictEqual(existingRest, rest)) {
         throw new Error(`Security scheme ${key} has different ${flowName} URLs`);
      }

      existing.scopes = {
         ...(isJsonObject(scopes) ? scopes : {}),
         ...(isJsonObject(existingScopes) ? existingScopes : {}),
      };
   }

   return result;
}

function mergePathItem(pathKey: string, existing: JsonValue | undefined, pathItem: JsonObject): JsonObject {
   if (!isJsonObject(existing)) {
      return pathItem;
   }

   for (const [key, value] of Object.entries(pathItem)) {
      if (key in existing && !isDeepStrictEqual(existing[key], value)) {
         throw new Error(`${pathKey}: two documents define ${key}`);
      }

      existing[key] = value;
   }

   return existing;
}

/**
 * Merges OpenAPI documents into one. Paths, tags, and components are combined. When two
 * parts define a component with one key and different values, each copy gets its part's
 * suffix, for example `PackageNpm` and `PackageMaven`. A part whose servers differ from
 * the first part's gets `servers` on each of its path items.
 */
export function mergeDocuments(parts: readonly DocumentPart[], title: string): JsonObject {
   const [first] = parts;

   if (first === undefined) {
      throw new Error('Nothing to merge');
   }

   const renames = planRenames(parts),
      {
         paths: _paths,
         'x-ms-paths': _msPaths,
         components: _components,
         tags: _tags,
         ...base
      } = structuredClone(first.document),
      result: JsonObject = { ...base, info: { ...getObject(first.document, 'info'), title } },
      components: JsonObject = {},
      tags = new Map<string, JsonValue>();

   parts.forEach((part, index) => {
      const document = renameComponents(part.document, renames[index] ?? new Map()),
         hasOwnServers = !isDeepStrictEqual(document.servers, first.document.servers);

      if (!isDeepStrictEqual(document.security, first.document.security)) {
         throw new Error(`${part.suffix}: top-level security differs from the first document`);
      }

      for (const section of PATH_SECTIONS) {
         const target = getOrCreateObject(result, section);

         for (const [pathKey, pathItem] of Object.entries(getObject(document, section))) {
            if (!isJsonObject(pathItem)) {
               continue;
            }

            const item: JsonObject = hasOwnServers ? { ...pathItem, servers: document.servers ?? [] } : pathItem;

            target[pathKey] = mergePathItem(pathKey, target[pathKey], item);
         }
      }

      for (const [section, values] of Object.entries(getObject(document, 'components'))) {
         const target = getOrCreateObject(components, section);

         for (const [key, value] of Object.entries(isJsonObject(values) ? values : {})) {
            const existing = target[key];

            target[key] =
               section === SECURITY_SCHEMES && existing !== undefined
                  ? mergeSecurityScheme(key, existing, value)
                  : value;
         }
      }

      for (const tag of Array.isArray(document.tags) ? document.tags : []) {
         if (isJsonObject(tag) && typeof tag.name === 'string' && !tags.has(tag.name)) {
            tags.set(tag.name, tag);
         }
      }
   });

   if (Object.keys(getObject(result, 'x-ms-paths')).length === 0) {
      delete result['x-ms-paths'];
   }

   result.components = components;
   result.tags = [...tags.values()];

   return result;
}
