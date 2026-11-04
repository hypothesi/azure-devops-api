import { describe, expect, it } from 'vite-plus/test';
import { z } from 'zod';
import { AzureDevOpsClient, type AzureDevOpsClientOptions, InvalidInputError } from '../src/index';
import { createFakeClient, getRequest, respondJSON } from './fake-fetch';

const searchPage = respondJSON({ count: 0, results: [] });

async function getSearchURL(options: Partial<AzureDevOpsClientOptions>): Promise<string> {
   const { client, requests } = createFakeClient([searchPage], options);

   await Array.fromAsync(client.workItems.search('x'));

   const url = new URL(getRequest(requests, 0).url);

   return url.origin + url.pathname;
}

describe('AzureDevOpsClient', () => {
   describe('organization', () => {
      it('turns an organization name into a dev.azure.com URL', async () => {
         const { client, requests } = createFakeClient([respondJSON({ id: '1', name: 'Web' })]);

         await client.projects.get('Web');

         expect(getRequest(requests, 0).url).toBe('https://dev.azure.com/contoso/_apis/projects/Web?api-version=7.1');
      });

      it('accepts a full collection URL with a trailing slash', async () => {
         const { client, requests } = createFakeClient([respondJSON({ id: '1', name: 'Web' })], {
            organization: 'https://tfs.example.com/DefaultCollection/',
            apiVersion: '7.0',
         });

         await client.projects.get('My Project');

         expect(getRequest(requests, 0).url).toBe(
            'https://tfs.example.com/DefaultCollection/_apis/projects/My%20Project?api-version=7.0',
         );
      });

      it.each([
         ['an empty name', { organization: ' ' }],
         ['a path without a scheme', { organization: 'dev.azure.com/contoso' }],
         ['an invalid URL', { organization: 'https://' }],
         ['a non-HTTP URL', { organization: 'ftp://example.com/x' }],
         ['an empty PAT', { auth: { type: 'pat', token: '' } }],
         ['a negative timeout', { timeoutMs: -1 }],
         ['a non-finite retry count', { retry: { maxRetries: Number.NaN } }],
      ] as const)('throws InvalidInputError for %s', (_name, options) => {
         expect(() => {
            return new AzureDevOpsClient({
               organization: 'contoso',
               auth: { type: 'pat', token: 'secret' },
               ...options,
            });
         }).toThrow(InvalidInputError);
      });
   });

   describe('search URL', () => {
      it('uses almsearch.dev.azure.com for dev.azure.com organizations', async () => {
         const url = await getSearchURL({});

         expect(url).toBe('https://almsearch.dev.azure.com/contoso/_apis/search/workitemsearchresults');
      });

      it('uses the organization URL for servers', async () => {
         const url = await getSearchURL({ organization: 'https://tfs.example.com/DefaultCollection' });

         expect(url).toBe('https://tfs.example.com/DefaultCollection/_apis/search/workitemsearchresults');
      });

      it('uses the searchURL option when it is set', async () => {
         const url = await getSearchURL({ searchURL: 'https://search.example.com/contoso' });

         expect(url).toBe('https://search.example.com/contoso/_apis/search/workitemsearchresults');
      });
   });

   it('rejects an empty bearer token from the provider before it sends a request', async () => {
      const { client, requests } = createFakeClient([], {
         auth: {
            type: 'bearer',
            token: () => {
               return Promise.resolve('');
            },
         },
      });

      const promise = client.projects.get('Web');

      await expect(promise).rejects.toBeInstanceOf(InvalidInputError);
      expect(requests).toHaveLength(0);
   });

   it('encodes each path segment of a generic request', async () => {
      const { client, requests } = createFakeClient([respondJSON({})]);

      await client.request({ path: ['My Project', '_apis', 'git', 'repositories', 'a/b'], schema: z.unknown() });

      expect(getRequest(requests, 0).url).toBe(
         'https://dev.azure.com/contoso/My%20Project/_apis/git/repositories/a%2Fb?api-version=7.1',
      );
   });
});
