import { callAPI, type CallOptions, type ClientContext } from '../core/context';
import type { z } from 'zod';
import { iterationsListResponseSchema } from '../generated/work/7.0/zod';

type TeamSettingsIteration = z.infer<typeof iterationsListResponseSchema>[number];

/** The operations that the helpers call, as keys of the client's operation table. */
export const WORK_OPERATIONS = {
   listIterations: 'GET /{project}/{team}/_apis/work/teamsettings/iterations',
} as const;

/** Boards and sprint settings for a team. */
export class Work {
   public constructor(private readonly context: ClientContext) {}

   /** Lists the iterations that the team subscribes to. */
   public async listIterations(
      project: string,
      team: string,
      options: CallOptions & { readonly timeframe?: 'past' | 'current' | 'future' } = {},
   ): Promise<TeamSettingsIteration[]> {
      const { data } = await callAPI(
         this.context,
         {
            operation: WORK_OPERATIONS.listIterations,
            path: [project, team, '_apis', 'work', 'teamsettings', 'iterations'],
            query: { $timeframe: options.timeframe },
            schema: iterationsListResponseSchema,
         },
         options,
      );

      return data;
   }

   /** Returns `undefined` when no iteration covers today. */
   public async getCurrentIteration(
      project: string,
      team: string,
      options: CallOptions = {},
   ): Promise<TeamSettingsIteration | undefined> {
      const iterations = await this.listIterations(project, team, { ...options, timeframe: 'current' });

      return iterations[0];
   }
}
