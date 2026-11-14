export const CLIENT_PACKAGE = '@hypothesi/azure-devops-api';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query']),
   IDENTIFIER = /^[A-Za-z_$][\w$]*$/,
   // Option key of the generated functions for each parameter location.
   OPTION_KEYS = { path: 'path', query: 'query', header: 'headers' } as const;

interface Parameter {
   name?: string;
   in?: string;
   required?: boolean;
   schema?: { type?: string };
   $ref?: string;
}

interface Operation {
   operationId?: string;
   parameters?: Parameter[];
   requestBody?: { required?: boolean; $ref?: string };
   'x-ado-area'?: string;
   'x-codeSamples'?: CodeSample[];
   [key: string]: unknown;
}

interface CodeSample {
   lang: string;
   label: string;
   source: string;
}

export interface OpenApiDocument {
   paths?: Record<string, Record<string, unknown>>;
   components?: { parameters?: Record<string, Parameter> };
   [key: string]: unknown;
}

function isOperation(value: unknown): value is Operation {
   return typeof value === 'object' && value !== null;
}

/**
 * Converts an operationId to the function name Kubb generates for it, for example
 * `Work Items_Get Work Item` to `workItemsGetWorkItem`.
 */
export function toFunctionName(operationId: string): string {
   return operationId
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((word, index) => {
         const first = index === 0 ? word.charAt(0).toLowerCase() : word.charAt(0).toUpperCase();

         return first + word.slice(1);
      })
      .join('');
}

function resolveParameter(parameter: Parameter, document: OpenApiDocument): Parameter {
   const name = parameter.$ref?.replace('#/components/parameters/', '');

   return name === undefined ? parameter : (document.components?.parameters?.[name] ?? parameter);
}

function exampleValue(parameter: Parameter): string {
   const type = parameter.schema?.type;

   if (type === 'integer' || type === 'number') {
      return '1';
   }

   if (type === 'boolean') {
      return 'true';
   }

   return `'${parameter.name ?? ''}'`;
}

function objectLiteral(parameters: Parameter[]): string {
   const entries = parameters.map((parameter) => {
      const name = parameter.name ?? '';

      return `${IDENTIFIER.test(name) ? name : `'${name}'`}: ${exampleValue(parameter)}`;
   });

   return `{ ${entries.join(', ')} }`;
}

/**
 * Builds the TypeScript sample for one operation. Returns `undefined` when the operation has no
 * operationId, because then the generated function name is unknown.
 */
function buildCodeSample(
   operation: Operation,
   { apiVersion, area, document }: { apiVersion: string; area: string; document: OpenApiDocument },
): CodeSample | undefined {
   if (operation.operationId === undefined) {
      return undefined;
   }

   // The client adds api-version itself, so the sample leaves it out.
   const required = (operation.parameters ?? [])
         .map((parameter) => {
            return resolveParameter(parameter, document);
         })
         .filter((parameter) => {
            return parameter.required === true && parameter.name !== 'api-version';
         }),
      groups = Object.entries(OPTION_KEYS).flatMap(([location, key]) => {
         const parameters = required.filter((parameter) => {
            return parameter.in === location;
         });

         return parameters.length > 0 ? [`${key}: ${objectLiteral(parameters)}`] : [];
      }),
      options = ['client: ado', ...groups, ...(operation.requestBody === undefined ? [] : ['body: {}'])];

   return {
      lang: 'typescript',
      label: CLIENT_PACKAGE,
      source: [
         `import { createClient, ${area} } from '${CLIENT_PACKAGE}/${apiVersion}';`,
         '',
         "const ado = createClient({ organization: 'acme', auth: { type: 'pat', token: process.env.AZURE_DEVOPS_PAT ?? '' } });",
         '',
         `const result = await ${area}.${toFunctionName(operation.operationId)}({ ${options.join(', ')} });`,
      ].join('\n'),
   };
}

/**
 * Adds an `x-codeSamples` entry to every operation of the document and returns the number of
 * operations changed. Changes the document in place.
 */
export function addCodeSamples(document: OpenApiDocument, apiVersion: string): number {
   let count = 0;

   for (const pathItem of Object.values(document.paths ?? {})) {
      for (const [method, operation] of Object.entries(pathItem)) {
         const area = isOperation(operation) ? operation['x-ado-area'] : undefined;

         if (!HTTP_METHODS.has(method) || !isOperation(operation) || area === undefined) {
            continue;
         }

         const sample = buildCodeSample(operation, { apiVersion, area, document });

         if (sample !== undefined) {
            operation['x-codeSamples'] = [...(operation['x-codeSamples'] ?? []), sample];
            count += 1;
         }
      }
   }

   return count;
}
