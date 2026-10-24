-- Phase 8 review WR-01: "BackupRun"."byteSize" was INTEGER (int4), which
-- overflows for dumps >= 2 GiB — and only after pg_dump output was already
-- renamed into place, so the receipt insert threw with the dump unrecorded.
-- BIGINT carries the receipt through any realistic dump size. Handwritten
-- migration per project convention (never prisma db push).
ALTER TABLE "BackupRun" ALTER COLUMN "byteSize" TYPE BIGINT;
