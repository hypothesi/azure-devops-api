import { callAPI, type CallOptions, type ClientContext, paginate } from './context';
import { listOf, type Project, ProjectSchema } from './schemas';

export interface ListProjectsOptions extends CallOptions {
   /** Default: `wellFormed`. */
   readonly stateFilter?: 'all' | 'wellFormed' | 'createPending' | 'deleting' | 'new' | 'unchanged' | 'deleted';
}

const PAGE_SIZE = 100,
   ProjectListSchema = listOf(ProjectSchema);

export class Projects {
   public constructor(private readonly context: ClientContext) {}

   /** @throws {NotFoundError} when the project does not exist or the caller cannot see it. */
   public async get(project: string, options: CallOptions = {}): Promise<Project> {
      const { data } = await callAPI(
         this.context,
         { path: ['_apis', 'projects', project], schema: ProjectSchema },
         options,
      );

      return data;
   }

   /** Yields every project in the organization. */
   public list(options: ListProjectsOptions = {}): AsyncGenerator<Project> {
      return paginate(async (continuationToken: string | undefined) => {
         const { data, headers } = await callAPI(
            this.context,
            {
               path: ['_apis', 'projects'],
               query: { $top: PAGE_SIZE, stateFilter: options.stateFilter, continuationToken },
               schema: ProjectListSchema,
            },
            options,
         );

         // This endpoint sends the token in a header, not in the body.
         return { items: data.value, next: headers.get('x-ms-continuationtoken') ?? undefined };
      });
   }
}
