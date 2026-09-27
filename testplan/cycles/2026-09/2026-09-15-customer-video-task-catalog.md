# Customer video task-catalog normalization regression

Scope: preserve the existing 14 ordered operational defaults and configurable custom labels. Never edit applied migration 0066. Local read-only catalog evidence confirms required labels are active and obsolete defaults inactive, but three GẮP labels have legacy `gặp` normalized keys rather than the service's `gắp` key.

| Case | Exercise | Expected result |
| --- | --- | --- |
| VID-TAG-01 | Attempt to create a label already represented by an active row whose stored normalized key is incorrect; include uppercase/lowercase and composed/decomposed Vietnamese. | Existing visible label is recognized; 409; no duplicate row. |
| VID-TAG-02 | Re-create an inactive legacy-key label. | Reactivate its existing ID and correct its normalized key, rather than insert a second visible label. |
| VID-TAG-03 | Rename a custom row to an active or inactive legacy-key label. | 409; neither record is silently overwritten or resurrected. |
| VID-TAG-04 | Rename a legacy-key row to its own visible label. | Existing ID is retained and its key becomes canonical. |
| VID-TAG-05 | Run existing task-catalog service suite. | Fourteen ordered defaults, author attribution, custom labels, validation and ordinary duplicate/soft-delete behavior remain unchanged. |

Before source edits, run the new regressions against an isolated test database to establish failures. After edits, run the focused service suite and backend TypeScript check. Root owns rendered picker verification; service tests are not browser coverage.
