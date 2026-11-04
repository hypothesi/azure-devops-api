import { callAPI, type CallOptions, type ClientContext, paginate } from '../core/context';
import type { z } from 'zod';
import { projectsGetResponseSchema, projectsListResponseSchema } from '../generated/core/7.0/zod';

export interface ListProjectsOptions extends CallOptions {
   /** Default: `wellFormed`. */
   readonly stateFilter?: 'all' | 'wellFormed' | 'createPending' | 'deleting' | 'new' | 'unchanged' | 'deleted';
}

type TeamProject = z.infer<typeof projectsGetResponseSchema>;
type TeamProjectReference = z.infer<typeof projectsListResponseSchema>[number];

const PAGE_SIZE = 100;

/** The operations that the helpers call, as keys of the client's operation table. */
export const PROJECT_OPERATIONS = {
   get: 'GET /_apis/projects/{projectId}',
   list: 'GET /_apis/projects',
} as const;

export class Projects {
   public constructor(private readonly context: ClientContext) {}

   /** @throws {NotFoundError} when the project does not exist or the caller cannot see it. */
   public async get(project: string, options: CallOptions = {}): Promise<TeamProject> {
      const { data } = await callAPI(
         this.context,
         { operation: PROJECT_OPERATIONS.get, path: ['_apis', 'projects', project], schema: projectsGetResponseSchema },
         options,
      );

      return data;
   }

   /** Yields every project in the organization. */
   public list(options: ListProjectsOptions = {}): AsyncGenerator<TeamProjectReference> {
      return paginate(async (continuationToken: string | undefined) => {
         const { data, headers } = await callAPI(
            this.context,
            {
               operation: PROJECT_OPERATIONS.list,
               path: ['_apis', 'projects'],
               query: { $top: PAGE_SIZE, stateFilter: options.stateFilter, continuationToken },
               schema: projectsListResponseSchema,
            },
            options,
         );

         // This endpoint sends the token in a header, not in the body.
         return { items: data, next: headers.get('x-ms-continuationtoken') ?? undefined };
      });
   }
}
