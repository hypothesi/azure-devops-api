/** The Software Heritage snapshot of `MicrosoftDocs/vsts-rest-api-specs` that every build uses. */
export const SNAPSHOT = {
   /** `swh:1:snp`, archived on 2026-09-12. */
   snapshot: '6083d3dcf93abb2678b2535c32f86ae6888b140b',
   /** The `master` commit in the snapshot, from 2026-09-03: "Update REST API specs from releases/M279 (#736)". */
   revision: 'c7e66d986b369dce462d04c02288a6c26c155002',
   /** `swh:1:dir` of the `specification` folder in that commit. */
   specificationDirectory: 'eb5a1ee87e2a2fe00bd29c737b8f12aa68693ac3',
} as const;

/**
 * The API versions this repo supports. 7.0 is the highest version of Azure DevOps Server
 * 2022, the oldest server release in mainstream support. 7.2 is left out because every
 * 7.2 operation is a preview.
 */
export const API_VERSIONS: readonly string[] = ['7.0', '7.1'];
