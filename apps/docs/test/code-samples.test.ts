import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vite-plus/test';

import { addCodeSamples, toFunctionName, type OpenApiDocument } from '../scripts/code-samples.ts';

function loadDocument(): OpenApiDocument {
   return JSON.parse(readFileSync(new URL('fixtures/document.json', import.meta.url), 'utf8'));
}

describe('toFunctionName', () => {
   it('converts an operationId the way Kubb does', () => {
      expect(toFunctionName('Work Items_Get Work Item')).toBe('workItemsGetWorkItem');
      expect(toFunctionName('Artifact Link Types_List')).toBe('artifactLinkTypesList');
   });
});

describe('addCodeSamples', () => {
   it('adds a sample with the entry point import and the required path parameters', () => {
      const document = loadDocument();

      const count = addCodeSamples(document, '7.1');

      expect(count).toBe(2);

      expect(document.paths?.['/{project}/_apis/wit/workitems/{id}']?.get).toMatchObject({
         'x-codeSamples': [
            {
               lang: 'typescript',
               label: '@hypothesi/azure-devops-api',
               source: [
                  "import { createClient, wit } from '@hypothesi/azure-devops-api/7.1';",
                  '',
                  "const ado = createClient({ organization: 'contoso', auth: { type: 'pat', token: process.env.AZURE_DEVOPS_PAT ?? '' } });",
                  '',
                  "const result = await wit.workItemsGetWorkItem({ client: ado, path: { project: 'project', id: 1 } });",
               ].join('\n'),
            },
         ],
      });
   });

   it('adds required query and header parameters and leaves out api-version', () => {
      const document = loadDocument();

      addCodeSamples(document, '7.0');

      expect(document.paths?.['/{project}/_apis/wit/classificationnodes?ids={ids}']?.get).toMatchObject({
         'x-codeSamples': [
            {
               source: expect.stringContaining(
                  "wit.classificationNodesGetClassificationNodes({ client: ado, path: { project: 'project' }, query: { ids: 'ids' }, headers: { 'X-Request-Id': 'X-Request-Id' } })",
               ),
            },
         ],
      });
   });

   it('skips an operation without an operationId', () => {
      const document = loadDocument();

      addCodeSamples(document, '7.1');

      expect(document.paths?.['/{project}/_apis/wit/classificationnodes?ids={ids}']?.post).not.toHaveProperty(
         'x-codeSamples',
      );
   });
});
