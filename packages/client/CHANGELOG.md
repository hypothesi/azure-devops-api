# @hypothesi/azure-devops-api

## 0.1.1

### Patch Changes

- 23e38e6: Make `path.team` optional in `wit.wiqlQueryByWiql`, `wit.wiqlQueryById`, and `wit.wiqlGet`. Without `team`, the client leaves the `{team}` segment out of the URL.
- dc592bd: Require zod 4.6.0 or later. With zod 4.5.0 and earlier, every entry point throws a `ReferenceError` on import.
