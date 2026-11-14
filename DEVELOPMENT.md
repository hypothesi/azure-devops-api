# Development

```sh
npm install
npx playwright install chromium firefox webkit
npm run standards   # generate, format, lint, type check, build, and check package exports
npm test            # every workspace, with the client in Node.js, Chromium, Firefox, and WebKit
npx fallow          # dead code, duplication, complexity, and import boundaries
npx changeset       # describe a change for the next release
```

[docs/architecture.md](docs/architecture.md) describes the workspaces and the import rules
between them. The [client README](packages/client/README.md#development) describes how
`src/generated` is built.
