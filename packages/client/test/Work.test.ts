import { describe, expect, it } from 'vite-plus/test';
import { createFakeClient, getRequest, respondJSON } from './fake-fetch';

describe('Work', () => {
   it('returns undefined when no iteration is current', async () => {
      const { client, requests } = createFakeClient([respondJSON({ count: 0, value: [] })]);

      const iteration = await client.work.getCurrentIteration('Web', 'Team A');

      const url = new URL(getRequest(requests, 0).url);

      expect(iteration).toBeUndefined();
      expect(url.pathname).toBe('/acme/Web/Team%20A/_apis/work/teamsettings/iterations');
      expect(url.searchParams.get('$timeframe')).toBe('current');
   });
});
