# Releasing

Releases use [Changesets](https://github.com/changesets/changesets) and the
[release workflow](.github/workflows/release.yml). Nobody runs `npm publish` by hand.

## Before the first release

Configure an npm trusted publisher on npmjs.com for `@hypothesi/azure-devops-api` and
`@hypothesi/azure-devops-openapi`. Use this repository, the workflow file `release.yml`, and
the environment `npm`. The workflow publishes with OIDC and has no npm token.

## Steps

1. Add a changeset to each change that a package user can see. Commit it with the change:

   ```sh
   npx changeset
   ```

   Pick the packages and the release type from the table in the
   [README](README.md#versions). Changes to docs, tests, and CI need no changeset.

2. Merge the change to `main`. The release workflow runs `npm run version-packages` and
   opens or updates the pull request `chore: version packages`. That pull request:

   * bumps the version in each changed `package.json` and in `package-lock.json`
   * adds the changesets to each package's `CHANGELOG.md`
   * deletes the changeset files

3. Review the versions and the changelog entries in that pull request. Check that CI passes.

4. Merge the pull request. The workflow runs again, finds no changesets, and runs
   `npm run release`. That script runs `npm run standards` and the Node.js tests, then
   publishes every package whose version is not on npm yet.

5. Check the new version on npm:

   ```sh
   npm view @hypothesi/azure-devops-api version
   ```

## When the workflow fails

Read the log of the failed run:

```sh
gh run list --workflow release.yml --limit 3
gh run view <run-id> --log-failed
```

To test the version step without pushing, run `npm run version-packages`, check the diff,
and then discard it:

```sh
npm run version-packages
git diff
git restore .
git clean -f -- 'packages/*/CHANGELOG.md'
```
