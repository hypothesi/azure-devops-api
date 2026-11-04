export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

export interface JsonObject {
   [key: string]: JsonValue;
}

export function isJsonObject(value: unknown): value is JsonObject {
   return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses JSON text whose top-level value must be an object. */
export function parseJsonObject(text: string): JsonObject {
   const value: unknown = JSON.parse(text);

   if (!isJsonObject(value)) {
      throw new TypeError('Expected a JSON object');
   }

   return value;
}

/** Deep-copies a value that came from JSON, or any value that has a JSON form. */
export function toJsonObject(value: unknown): JsonObject {
   return parseJsonObject(JSON.stringify(value));
}

/** Returns `value[key]` when it is an object, or an empty object that is attached to `value`. */
export function getOrCreateObject(value: JsonObject, key: string): JsonObject {
   const child = value[key];

   if (isJsonObject(child)) {
      return child;
   }

   const created: JsonObject = {};

   value[key] = created;

   return created;
}

export function getObject(value: JsonObject, key: string): JsonObject {
   const child = value[key];

   return isJsonObject(child) ? child : {};
}

/** Calls `visit` for every object in `value`, parents before children. */
export function walkObjects(value: JsonValue, visit: (node: JsonObject) => void): void {
   if (Array.isArray(value)) {
      for (const item of value) {
         walkObjects(item, visit);
      }

      return;
   }

   if (!isJsonObject(value)) {
      return;
   }

   visit(value);

   for (const child of Object.values(value)) {
      walkObjects(child, visit);
   }
}

export function getString(value: JsonObject, key: string): string | undefined {
   const child = value[key];

   return typeof child === 'string' ? child : undefined;
}
