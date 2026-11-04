import { describe, expect, it } from 'vite-plus/test';
import { createClient as createClient70 } from '../src/entries/7.0';
import { InvalidInputError } from '../src/entries/7.1';
import { createFakeClient, getRequest, respondJSON, respondStatus } from './fake-fetch';

const WORK_ITEM = {
      id: 7,
      rev: 3,
      fields: { 'System.Title': 'Fix login' },
      url: 'https://dev.azure.com/contoso/_apis/wit/workItems/7',
   },
   respondWorkItem = respondJSON(WORK_ITEM);

function listIDs(count: number): number[] {
   return Array.from({ length: count }, (_value, index) => {
      return index + 1;
   });
}

function respondBatch(ids: readonly (number | null)[]): ReturnType<typeof respondJSON> {
   return respondJSON({
      count: ids.length,
      value: ids.map((id) => {
         return id === null ? null : { ...WORK_ITEM, id };
      }),
   });
}

async function readJSON(request: Request): Promise<unknown> {
   return request.json();
}

describe('WorkItems', () => {
   describe('get', () => {
      it('sends fields and asOf as query parameters', async () => {
         const { client, requests } = createFakeClient([respondWorkItem]);

         const workItem = await client.workItems.get(7, {
            fields: ['System.Title', 'System.State'],
            asOf: new Date('2026-01-02T03:04:05.000Z'),
         });

         const url = new URL(getRequest(requests, 0).url);

         expect(workItem.fields?.['System.Title']).toBe('Fix login');
         expect(url.pathname).toBe('/contoso/_apis/wit/workitems/7');
         expect(url.searchParams.get('fields')).toBe('System.Title,System.State');
         expect(url.searchParams.get('asOf')).toBe('2026-01-02T03:04:05.000Z');
      });

      it.each([0, -1, 1.5, Number.NaN])('throws InvalidInputError for ID %s', async (id) => {
         const { client, requests } = createFakeClient([]);

         await expect(client.workItems.get(id)).rejects.toBeInstanceOf(InvalidInputError);
         expect(requests).toHaveLength(0);
      });

      it('throws InvalidInputError for fields together with expand', async () => {
         const { client } = createFakeClient([]);

         const promise = client.workItems.get(7, { fields: ['System.Title'], expand: 'relations' });

         await expect(promise).rejects.toBeInstanceOf(InvalidInputError);
      });
   });

   describe('list', () => {
      it('splits 250 IDs into requests of 200 and 50', async () => {
         const ids = listIDs(250),
            { client, requests } = createFakeClient([respondBatch(ids.slice(0, 200)), respondBatch(ids.slice(200))]);

         const workItems = await client.workItems.list(ids);

         expect(workItems).toHaveLength(250);
         expect(await readJSON(getRequest(requests, 0))).toMatchObject({ ids: ids.slice(0, 200) });
         expect(await readJSON(getRequest(requests, 1))).toMatchObject({ ids: ids.slice(200) });
      });

      it('leaves out the missing work items with errorPolicy omit', async () => {
         const { client } = createFakeClient([respondBatch([1, null, 3])]);

         const workItems = await client.workItems.list([1, 2, 3], { errorPolicy: 'omit' });

         expect(
            workItems.map((workItem) => {
               return workItem.id;
            }),
         ).toEqual([1, 3]);
      });

      it('sends no request for an empty list', async () => {
         const { client, requests } = createFakeClient([]);

         const workItems = await client.workItems.list([]);

         expect(workItems).toEqual([]);
         expect(requests).toHaveLength(0);
      });
   });

   describe('create and update', () => {
      it('builds a JSON Patch body from fields, Markdown fields, and relations', async () => {
         const { client, requests } = createFakeClient([respondWorkItem]);

         await client.workItems.create({
            project: 'Web',
            type: 'User Story',
            fields: { 'System.Title': 'Fix login', 'System.Description': '**Steps**' },
            markdownFields: ['System.Description'],
            relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', workItemID: 5, comment: 'parent' }],
            validateOnly: true,
         });

         const request = getRequest(requests, 0),
            url = new URL(request.url);

         expect(request.method).toBe('POST');
         expect(url.pathname).toBe('/contoso/Web/_apis/wit/workitems/$User%20Story');
         expect(url.searchParams.get('validateOnly')).toBe('true');
         expect(request.headers.get('Content-Type')).toBe('application/json-patch+json');
         expect(await readJSON(request)).toEqual([
            { op: 'add', path: '/fields/System.Title', value: 'Fix login' },
            { op: 'add', path: '/fields/System.Description', value: '**Steps**' },
            { op: 'add', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' },
            {
               op: 'add',
               path: '/relations/-',
               value: {
                  rel: 'System.LinkTypes.Hierarchy-Reverse',
                  url: 'https://dev.azure.com/contoso/_apis/wit/workItems/5',
                  attributes: { comment: 'parent' },
               },
            },
         ]);
      });

      it('sends a revision test first and does not retry a PATCH', async () => {
         const { client, requests } = createFakeClient([respondStatus(503), respondWorkItem]);

         const promise = client.workItems.update(7, {
            expectedRevision: 3,
            removeFields: ['System.Tags'],
            fields: { 'System.State': 'Active' },
         });

         await expect(promise).rejects.toMatchObject({ status: 503 });
         expect(requests).toHaveLength(1);
         expect(await readJSON(getRequest(requests, 0))).toEqual([
            { op: 'test', path: '/rev', value: 3 },
            { op: 'remove', path: '/fields/System.Tags' },
            { op: 'add', path: '/fields/System.State', value: 'Active' },
         ]);
      });

      it('throws InvalidInputError for an update without changes', async () => {
         const { client } = createFakeClient([]);

         await expect(client.workItems.update(7, { expectedRevision: 3 })).rejects.toBeInstanceOf(InvalidInputError);
      });

      it('throws InvalidInputError for a create without changes', async () => {
         const { client } = createFakeClient([]);

         await expect(client.workItems.create({ project: 'Web', type: 'Bug' })).rejects.toBeInstanceOf(
            InvalidInputError,
         );
      });
   });

   describe('queries', () => {
      it('runs a WIQL query and gets the work items in query order', async () => {
         const { client, requests } = createFakeClient([
            respondJSON({ queryType: 'flat', workItems: [{ id: 9 }, { id: 4 }] }),
            respondBatch([9, 4]),
         ]);

         const workItems = await client.workItems.queryWorkItems('SELECT [System.Id] FROM workitems', {
            project: 'Web',
            fields: ['System.Title'],
         });

         expect(
            workItems.map((workItem) => {
               return workItem.id;
            }),
         ).toEqual([9, 4]);
         expect(new URL(getRequest(requests, 0).url).pathname).toBe('/contoso/Web/_apis/wit/wiql');
         expect(await readJSON(getRequest(requests, 1))).toMatchObject({ ids: [9, 4], fields: ['System.Title'] });
      });

      it('throws InvalidInputError for a team without a project', async () => {
         const { client } = createFakeClient([]);

         await expect(
            client.workItems.query('SELECT [System.Id] FROM workitems', { team: 'A' }),
         ).rejects.toBeInstanceOf(InvalidInputError);
      });

      it('pages through search results', async () => {
         const result = { fields: { 'system.id': '1' } },
            { client, requests } = createFakeClient([
               respondJSON({ count: 3, results: [result, result] }),
               respondJSON({ count: 3, results: [result] }),
            ]);

         const results = await Array.fromAsync(client.workItems.search('login', { project: 'Web', pageSize: 2 }));

         expect(results).toHaveLength(3);
         expect(await readJSON(getRequest(requests, 0))).toMatchObject({
            searchText: 'login',
            $skip: 0,
            $top: 2,
            filters: { 'System.TeamProject': ['Web'] },
         });
         expect(await readJSON(getRequest(requests, 1))).toMatchObject({ $skip: 2 });
      });
   });

   describe('comments', () => {
      const comment = { id: 1, workItemId: 7, text: 'hi' };

      it('follows the continuation token', async () => {
         const { client, requests } = createFakeClient([
            respondJSON({ comments: [comment], continuationToken: 'next' }),
            respondJSON({ comments: [{ ...comment, id: 2 }] }),
         ]);

         const comments = await Array.fromAsync(client.workItems.listComments('Web', 7));

         const secondURL = new URL(getRequest(requests, 1).url);

         expect(comments).toHaveLength(2);
         expect(secondURL.searchParams.get('continuationToken')).toBe('next');
         expect(secondURL.searchParams.get('api-version')).toBe('7.1-preview.4');
      });

      it.each([
         ['7.0', createClient70, '7.0-preview.3', null],
         ['7.1', undefined, '7.1-preview.4', 'markdown'],
      ] as const)(
         'sends the comment versions of a %s client and format only where the spec has it',
         async (_apiVersion, create, expectedVersion, expectedFormat) => {
            const { client, requests } = createFakeClient(
               [respondJSON({ comments: [] }), respondJSON(comment), respondJSON(comment), respondStatus(204)],
               {},
               create,
            );

            await Array.fromAsync(client.workItems.listComments('Web', 7));
            await client.workItems.addComment('Web', 7, 'hi');
            await client.workItems.updateComment('Web', 7, 1, 'hi');
            await client.workItems.deleteComment('Web', 7, 1);

            const urls = requests.map((request) => {
               return new URL(request.url);
            });

            expect(
               urls.map((url) => {
                  return url.searchParams.get('api-version');
               }),
            ).toEqual([expectedVersion, expectedVersion, expectedVersion, expectedVersion]);
            expect(
               urls.slice(1, 3).map((url) => {
                  return url.searchParams.get('format');
               }),
            ).toEqual([expectedFormat, expectedFormat]);
         },
      );

      it('throws InvalidInputError for a format that the 7.0 comment operations do not have', async () => {
         const { client, requests } = createFakeClient([], {}, createClient70);

         await expect(client.workItems.addComment('Web', 7, 'hi', { format: 'html' })).rejects.toBeInstanceOf(
            InvalidInputError,
         );
         expect(requests).toHaveLength(0);
      });

      it('adds a comment as Markdown', async () => {
         const { client, requests } = createFakeClient([respondJSON(comment)]);

         await client.workItems.addComment('Web', 7, '**hi**');

         const request = getRequest(requests, 0);

         expect(new URL(request.url).searchParams.get('format')).toBe('markdown');
         expect(await readJSON(request)).toEqual({ text: '**hi**' });
      });

      it('accepts an empty HTTP 204 response when it deletes a comment', async () => {
         const { client } = createFakeClient([respondStatus(204)]);

         await expect(client.workItems.deleteComment('Web', 7, 1)).resolves.toBeUndefined();
      });
   });

   it('uploads an attachment as binary content', async () => {
      const { client, requests } = createFakeClient([
         respondJSON({ id: '6f1c2f5e-0b7a-4c1e-9a52-3f0b1d4e2a10', url: 'https://example.com/a1' }),
      ]);

      const attachment = await client.workItems.uploadAttachment({
         project: 'Web',
         fileName: 'screen shot.png',
         content: new Uint8Array([1, 2, 3]),
      });

      const request = getRequest(requests, 0);

      expect(attachment.url).toBe('https://example.com/a1');
      expect(request.headers.get('Content-Type')).toBe('application/octet-stream');
      expect(new URL(request.url).searchParams.get('fileName')).toBe('screen shot.png');
      expect(new Uint8Array(await request.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
   });
});
