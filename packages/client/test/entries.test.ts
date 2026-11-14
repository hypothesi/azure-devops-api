import { describe, expect, expectTypeOf, it } from 'vite-plus/test';
import packageJSON from '../package.json';
import * as v70 from '../src/entries/7.0';
import * as v71 from '../src/entries/7.1';
import { apiVersions, specSnapshot } from '../src/entries/compatibility';
import * as server from '../src/entries/server';
import * as server2022 from '../src/entries/server-2022';
import * as services from '../src/entries/services';
import { operations as operations70 } from '../src/generated/7.0/operations';
import { operations as operations71 } from '../src/generated/7.1/operations';
import { PROJECT_OPERATIONS } from '../src/helpers/Projects';
import { WORK_OPERATIONS } from '../src/helpers/Work';
import { WORK_ITEM_OPERATIONS } from '../src/helpers/WorkItems';
import { createFakeClient, getRequest, respondJSON, PROJECT_ID } from './fake-fetch';

const comment = { id: 1, workItemId: 7, text: 'hi' };

describe('entry points', () => {
   it('exports the same createClient from the product aliases and their API versions', () => {
      expect(server2022.createClient).toBe(v70.createClient);
      expect(services.createClient).toBe(v71.createClient);
      expect(server.createClient).toBe(v71.createClient);
   });

   it('leaves operations that only 7.1 has out of the 7.0 entry point', () => {
      // @ts-expect-error tempQueriesCreate is new in 7.1.
      expectTypeOf(v70.wit.tempQueriesCreate).toBeFunction();

      expectTypeOf(v71.wit.tempQueriesCreate).toBeFunction();
      expect('tempQueriesCreate' in v70.wit).toBe(false);
      expect('tempQueriesCreate' in v71.wit).toBe(true);
   });

   it('matches the azureDevOps field of package.json to the manifest', () => {
      expect(packageJSON.azureDevOps).toEqual({ apiVersions: Object.keys(apiVersions), specSnapshot });
   });

   it.each([
      ['7.0', operations70],
      ['7.1', operations71],
   ])('has every operation that the helpers call in %s', (_apiVersion, table) => {
      const keys = [
         ...Object.values(WORK_ITEM_OPERATIONS),
         ...Object.values(PROJECT_OPERATIONS),
         ...Object.values(WORK_OPERATIONS),
      ];

      expect(
         keys.filter((key) => {
            return table.operations[key] === undefined;
         }),
      ).toEqual([]);
   });
});

describe('generated operations', () => {
   it("sends the operation's preview API version", async () => {
      const { client, requests } = createFakeClient([respondJSON(comment)]);

      const { data } = await v71.wit.commentsGetComment({
         client,
         path: { project: 'Web', workItemId: 7, commentId: 1 },
      });

      const url = new URL(getRequest(requests, 0).url);

      expect(data.text).toBe('hi');
      expect(url.pathname).toBe('/acme/Web/_apis/wit/workItems/7/comments/1');
      expect(url.searchParams.get('api-version')).toBe('7.1-preview.4');
   });

   it('sends the 7.0 API version from a 7.0 client', async () => {
      const { client, requests } = createFakeClient([respondJSON(comment)], {}, v70.createClient);

      await v70.wit.commentsGetComment({ client, path: { project: 'Web', workItemId: 7, commentId: 1 } });

      expect(new URL(getRequest(requests, 0).url).searchParams.get('api-version')).toBe('7.0-preview.3');
   });

   it('fills the path of a URL with a query template and sends the query value', async () => {
      const { client, requests } = createFakeClient([respondJSON({ count: 0, value: [] })]);

      await v71.wit.classificationNodesGetClassificationNodes({
         client,
         path: { project: 'My Project' },
         query: { ids: '1,2', $depth: 2 },
      });

      const url = new URL(getRequest(requests, 0).url);

      expect(url.pathname).toBe('/acme/My%20Project/_apis/wit/classificationnodes');
      expect(url.searchParams.get('ids')).toBe('1,2');
      expect(url.searchParams.get('$depth')).toBe('2');
   });

   it('leaves out an optional path segment that has no value', async () => {
      const { client, requests } = createFakeClient([respondJSON({ workItems: [] }), respondJSON({ workItems: [] })]);

      await v71.wit.wiqlQueryByWiql({
         client,
         path: { project: 'Web' },
         body: { query: 'SELECT [System.Id] FROM workitems' },
      });
      await v71.wit.wiqlQueryByWiql({
         client,
         path: { project: 'Web', team: 'Web Team' },
         body: { query: 'SELECT 1' },
      });

      expect(new URL(getRequest(requests, 0).url).pathname).toBe('/acme/Web/_apis/wit/wiql');
      expect(new URL(getRequest(requests, 1).url).pathname).toBe('/acme/Web/Web%20Team/_apis/wit/wiql');
   });

   it('sends a JSON Patch body with the JSON Patch content type', async () => {
      const { client, requests } = createFakeClient([respondJSON({ id: 7 })]);

      await v71.wit.workItemsUpdate({
         client,
         path: { project: 'Web', id: 7 },
         body: [{ op: 'add', path: '/fields/System.Title', value: 'Fix login' }],
      });

      const request = getRequest(requests, 0);

      expect(request.method).toBe('PATCH');
      expect(request.headers.get('Content-Type')).toBe('application/json-patch+json');
      expect(await request.json()).toEqual([{ op: 'add', path: '/fields/System.Title', value: 'Fix login' }]);
   });

   it('returns the array of a list response that Azure DevOps wraps in count and value', async () => {
      const { client } = createFakeClient([respondJSON({ count: 1, value: [{ id: PROJECT_ID, name: 'Web' }] })]);

      const { data } = await v71.core.projectsList({ client });

      expect(data).toEqual([{ id: PROJECT_ID, name: 'Web' }]);
   });

   it.each([
      ['acme', 'https://feeds.dev.azure.com/acme/Web/_apis/packaging/feeds'],
      [
         'https://tfs.example.com/DefaultCollection',
         'https://tfs.example.com/DefaultCollection/Web/_apis/packaging/feeds',
      ],
   ])("sends an operation to its area's host for %s", async (organization, expected) => {
      const { client, requests } = createFakeClient([respondJSON({ count: 0, value: [] })], { organization });

      await v71.artifacts.feedManagementGetFeeds({ client, path: { project: 'Web' } });

      const url = new URL(getRequest(requests, 0).url);

      expect(url.origin + url.pathname).toBe(expected);
   });

   it('sends an operation to the host of its path when the area has more than one host', async () => {
      const { client, requests } = createFakeClient([respondJSON({})]);

      await v71.artifacts.provenanceCreateSession({
         client,
         path: { project: 'Web', protocol: 'npm' },
         body: { feed: 'f' },
      });

      expect(new URL(getRequest(requests, 0).url).origin).toBe('https://pkgs.dev.azure.com');
   });

   it('returns a binary response as a Blob', async () => {
      const { client, requests } = createFakeClient([
         (): Response => {
            return new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } });
         },
      ]);

      const { data } = await v71.artifacts.artifactDetailsGetBadge({
         client,
         path: { project: 'Web', feedId: 'f', packageId: 'p' },
      });

      expect(data).toBeInstanceOf(Blob);
      expect(getRequest(requests, 0).headers.get('Accept')).toBe('*/*');
   });

   it('rejects with InvalidInputError for an operation that is not in the API version', async () => {
      const { client, requests } = createFakeClient([], {}, v70.createClient);

      const promise = client({ method: 'GET', url: '/{project}/_apis/nothing', path: { project: 'Web' } });

      await expect(promise).rejects.toThrow(
         new v70.InvalidInputError('GET /{project}/_apis/nothing is not part of Azure DevOps REST API 7.0'),
      );
      expect(requests).toHaveLength(0);
   });

   it('rejects with InvalidInputError for a missing path parameter', async () => {
      const { client } = createFakeClient([]);

      const promise = client({ method: 'GET', url: '/{project}/_apis/wit/workitems/{id}', path: { project: 'Web' } });

      await expect(promise).rejects.toBeInstanceOf(v71.InvalidInputError);
   });
});
