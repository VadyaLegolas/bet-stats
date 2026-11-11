# Deferred Items — Phase 09 (logged by 09-02)

- [scope-out] tests/unit/fixtures-sync.test.ts — 7 cases fail in the executor shell with "Authentication failed against the database server, the provided database credentials for `user` are not valid" when the full unit project runs without valid DATABASE_URL credentials. Not caused by 09-02 (fixtures-sync is not in this plan's files; 505/512 unit tests pass including all 47 new alert tests). Pre-existing environmental issue for a repair plan / CI investigation.
  status: open
