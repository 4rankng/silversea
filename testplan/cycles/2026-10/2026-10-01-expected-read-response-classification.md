# QA-HARNESS-01 — classify each expected empty read independently

Local audit diagnostic regression; no application behavior or database writes.

1. Observe a delivered optional pricing override404 with its exact no-adjustment message, snapshot200/override=null and empty override UI. It remains recorded as an expected read.
2. Observe a second response on the same endpoint with500, or404 with another body. It must remain an unexpected fatal read; the first empty result must not whitelist the endpoint.
3. Keep browser console resource diagnostics in raw output. Exclude only the exact endpoint plus explicit expected status; any unrelated JavaScript error or500 remains fatal.
4. For retained invalid historical photo400, also require the actual disabled unavailable slot. Another status/body on that endpoint remains fatal.

Expected: no endpoint-wide error suppression, all raw errors preserved, accepted walks fail on any unvalidated response. Save syntax gate and exact driver review/hash before execution.
