# D-02 Dual-Time Evidence Contract Approval

- Approved response: `approve D-02 dual-time semantics`
- Approved on: 2026-08-29
- Decision: Evidence is eligible for an as-of cutoff only when both its football event/effective time (`effectiveAt`) and system knowledge time (`observedAt`) are at or before that cutoff.
- Correction rule: A later correction may improve current truth, but it cannot enter an earlier evidence view.
- One-way consequence accepted: Changing this temporal contract after derived evidence exists requires rebuilding every affected historical feature and may invalidate downstream Phase 3 prediction snapshots and Phase 4 evaluations.

This approval authorizes Plan 02-04 to create the persistent bitemporal schema and indexes described by D-02.
