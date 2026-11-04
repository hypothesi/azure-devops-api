# Overlays

This folder is for [OpenAPI Overlay 1.0](https://spec.openapis.org/overlay/v1.0.0.html)
files that fix the converted specs, one file per API version and area:

```text
overlays/{apiVersion}/{area}.yaml
```

No spec needs an overlay yet. The fixes that apply to every file are functions in
`scripts/lib/transforms.ts`, each with a test:

* `nameSvgResponses` adds `xml: { name: 'svg' }` to the inline schema of an `image/svg+xml`
  response. Without it, the strict upgrade to OpenAPI 3.2 stops at the artifacts badge
  operation.
* `fixFormatTypes` changes `type: int32` in notification to `type: integer, format: int32`.
* `matchPathParameterCase` changes `{DefinitionId}` in build paths to `{definitionId}`.
* `unwrapArrayAllOf` changes `JsonPatchDocument` to an array schema.
* `removeTrailingSlashes` changes `/_apis/projects/{projectId}/categorizedteams/` in core
  7.1 to a path without the trailing slash.

`scripts/convert.ts` has no overlay engine, so it stops when this folder contains any file
other than this README. To add the first overlay, add an overlay library to
`devDependencies`, apply each file at the end of `convertArea`, and add a test.
