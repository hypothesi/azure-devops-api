import type { AzureDevOpsClientOptions } from '../core/options';
import { operations } from '../generated/7.0/operations';
import { type AzureDevOpsClient, createClientFactory } from '../helpers/create-client';

export * from './index';
export * from '../generated/7.0/index';
export type { AzureDevOpsClient } from '../helpers/create-client';
export type { ListProjectsOptions, Projects } from '../helpers/Projects';
export type { Work } from '../helpers/Work';
export type * from '../helpers/WorkItems';

/**
 * Creates a client for Azure DevOps REST API 7.0. Pass it as the `client` option of the
 * generated operations, or call its helpers.
 *
 * @example
 * ```ts
 * import { createClient, wit } from '@hypothesi/azure-devops-api/7.0';
 *
 * const ado = createClient({ organization: 'acme', auth: { type: 'pat', token: process.env.AZURE_DEVOPS_PAT ?? '' } });
 * const { data } = await wit.workItemsGetWorkItem({ client: ado, path: { project: 'Web', id: 42 } });
 * const sameItem = await ado.workItems.get(42);
 * ```
 */
export const createClient: (options: AzureDevOpsClientOptions) => AzureDevOpsClient = createClientFactory(operations);
