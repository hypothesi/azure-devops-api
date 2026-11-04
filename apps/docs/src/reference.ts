import { createApiReference } from '@scalar/api-reference';
import '@scalar/api-reference/style.css';
import { type ReferenceSource, selectSource } from './sources';

// scripts/prepare.ts writes the source list from the manifest at build time.
const response = await fetch(`${import.meta.env.BASE_URL}openapi/sources.json`),
   sources: ReferenceSource[] = await response.json();

createApiReference('#app', {
   sources: selectSource(sources, new URL(location.href)),
   // The agent sends questions to Scalar's hosted service, which this site does not use.
   agent: { disabled: true },
   // Scalar shows its toolbar (Configure, Share, Generate SDK, Deploy API) on localhost by default.
   showDeveloperTools: 'never',
});
