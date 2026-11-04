import { describe, expect, it } from 'vite-plus/test';
import { createFakeClient, getRequest, respondJSON, PROJECT_ID, OTHER_PROJECT_ID } from './fake-fetch';

describe('Projects', () => {
   it('follows the continuation token header', async () => {
      const { client, requests } = createFakeClient([
         respondJSON(
            { count: 1, value: [{ id: PROJECT_ID, name: 'A' }] },
            { headers: { 'x-ms-continuationtoken': 'p2' } },
         ),
         respondJSON({ count: 1, value: [{ id: OTHER_PROJECT_ID, name: 'B' }] }),
      ]);

      const projects = await Array.fromAsync(client.projects.list());

      expect(
         projects.map((project) => {
            return project.name;
         }),
      ).toEqual(['A', 'B']);
      expect(new URL(getRequest(requests, 1).url).searchParams.get('continuationToken')).toBe('p2');
   });
});
