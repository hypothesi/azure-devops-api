import { callAPI, type CallOptions, type ClientContext } from './context';
import { type Iteration, IterationSchema, listOf } from './schemas';

const IterationListSchema = listOf(IterationSchema);

/** Boards and sprint settings for a team. */
export class Work {
   public constructor(private readonly context: ClientContext) {}

   /** Lists the iterations that the team subscribes to. */
   public async listIterations(
      project: string,
      team: string,
      options: CallOptions & { readonly timeframe?: 'past' | 'current' | 'future' } = {},
   ): Promise<Iteration[]> {
      const { data } = await callAPI(
         this.context,
         {
            path: [project, team, '_apis', 'work', 'teamsettings', 'iterations'],
            query: { $timeframe: options.timeframe },
            schema: IterationListSchema,
         },
         options,
      );

      return data.value;
   }

   /** Returns `undefined` when no iteration covers today. */
   public async getCurrentIteration(
      project: string,
      team: string,
      options: CallOptions = {},
   ): Promise<Iteration | undefined> {
      const iterations = await this.listIterations(project, team, { ...options, timeframe: 'current' });

      return iterations[0];
   }
}
