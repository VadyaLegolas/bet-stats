---
quick_id: 261123-quu
description: Fix phase 11 review criticals CR-01 and CR-02
---

# Quick Task 261123-quu — Phase 11 review criticals

Source: `.planning/phases/11-dixon-coles-model-version/11-REVIEW.md`.

1. CR-01: `expectedGoalsOf` in `packages/database/src/dixon-coles-repository.ts` reads the stored shape `receipt.receipt.expectedGoals`; the rho integration seed uses that real shape and must fail without the fix.
2. CR-02: `GET /evaluation/model-comparison` gets route-level `OperatorGuard` (404 without credential); other evaluation routes unchanged; guard metadata + denial covered in `tests/integration/model-comparison-api.test.ts`.

Out of scope: the six warnings (WR-01..WR-06) and info items stay open in 11-REVIEW.md.
