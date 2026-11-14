---
'@hypothesi/azure-devops-api': patch
---

Make `path.team` optional in `wit.wiqlQueryByWiql`, `wit.wiqlQueryById`, and `wit.wiqlGet`. Without `team`, the client leaves the `{team}` segment out of the URL.
