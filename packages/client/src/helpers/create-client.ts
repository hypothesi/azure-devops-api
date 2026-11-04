import type { OperationTable } from '../core/context';
import { type AzureDevOpsClientOptions, createContext, request, type RequestOptions } from '../core/options';
import { createOperationClient, type OperationClient } from '../core/request';
import type { SendResult } from '../core/Transport';
import { Projects } from './Projects';
import { Work } from './Work';
import { WorkItems } from './WorkItems';

/**
 * A client for one Azure DevOps REST API version. Pass it as the `client` option of a
 * generated operation, or use its helpers.
 */
export type AzureDevOpsClient = OperationClient & {
   readonly apiVersion: string;
   readonly workItems: WorkItems;
   readonly projects: Projects;
   readonly work: Work;
   /**
    * Calls any endpoint under the organization URL. Use it for APIs that this library does
    * not cover. The response must match `schema`.
    *
    * @example
    * ```ts
    * const { data } = await ado.request({
    *    path: ['MyProject', '_apis', 'git', 'repositories'],
    *    schema: z.object({ value: z.array(z.object({ id: z.string(), name: z.string() })) }),
    * });
    * ```
    */
   request<T>(options: RequestOptions<T>): Promise<SendResult<T>>;
};

/** Returns the `createClient` function of an entry point, bound to that API version's operations. */
export function createClientFactory(table: OperationTable): (options: AzureDevOpsClientOptions) => AzureDevOpsClient {
   return (options) => {
      const context = createContext(options, table);

      return Object.assign(createOperationClient(context), {
         apiVersion: table.apiVersion,
         workItems: new WorkItems(context),
         projects: new Projects(context),
         work: new Work(context),
         request: <T>(requestOptions: RequestOptions<T>): Promise<SendResult<T>> => {
            return request(context, requestOptions);
         },
      });
   };
}
