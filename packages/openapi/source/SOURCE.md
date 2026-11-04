# Source files

`swagger/{apiVersion}/{area}/*.json` are Microsoft's Swagger 2.0 files for the Azure DevOps
REST API, from the `specification` folder of
[MicrosoftDocs/vsts-rest-api-specs](https://github.com/MicrosoftDocs/vsts-rest-api-specs).
Microsoft archived that repository, so the files come from a
[Software Heritage](https://www.softwareheritage.org) snapshot of it instead of from GitHub.

| What | SWHID |
| --- | --- |
| Snapshot, archived on 2026-09-12 | `swh:1:snp:6083d3dcf93abb2678b2535c32f86ae6888b140b` |
| `master` commit, 2026-09-03 | `swh:1:rev:c7e66d986b369dce462d04c02288a6c26c155002` |
| `specification` folder in that commit | `swh:1:dir:eb5a1ee87e2a2fe00bd29c737b8f12aa68693ac3` |

The commit message is "Update REST API specs from releases/M279 (#736)". The IDs are in
`scripts/snapshot.ts`, which is the only place the build reads them from.

Only the API versions in `API_VERSIONS` in `scripts/snapshot.ts` are copied.
`swagger/files.json` lists every copied file with its git blob hash.

## Verify the files

From `packages/openapi`:

```sh
node scripts/fetch.ts
```

`fetch.ts` lists the `specification` folder in the archive and computes the git blob hash of
each local file. A file whose hash matches the archive is not downloaded again. A missing or
changed file is downloaded, and a download whose hash does not match stops the script. When
`git status` shows no changes after the script finishes, the local files are byte-identical
to the snapshot.

The archive limits the number of requests per hour. To use fewer archive requests,
`fetch.ts` downloads a version folder from
[Mechanic4252/version_compatibility](https://github.com/Mechanic4252/version_compatibility)
(MIT, a GitHub copy of the same repository) when the git tree hash of
`specification/{area}/{apiVersion}` there equals the folder's Software Heritage directory ID.
Software Heritage directory IDs are git tree hashes, so equal IDs mean byte-identical files.
Every downloaded file is still checked against its git blob hash. The archive gives every
folder ID and every folder that the copy does not have. When the script reaches the archive
limit, it waits.

`test/source.test.ts` checks every file against `files.json` without network access.

You can also open each SWHID at `https://archive.softwareheritage.org/{SWHID}` and compare
the files there.

## Formatting

Do not format these files. The root `vite.config.ts` excludes `packages/openapi/source` from
`vp fmt`, because a formatted file no longer matches its git blob hash. Some files start with
a UTF-8 byte order mark. `scripts/convert.ts` removes it when it reads them.
