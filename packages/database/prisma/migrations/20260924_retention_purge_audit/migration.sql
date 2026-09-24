CREATE TABLE "RetentionPurgeAudit" (
  "id" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3) NOT NULL,
  "cutoff" TIMESTAMPTZ(3) NOT NULL,
  "oddsDeleted" INTEGER NOT NULL,
  "viewsDeleted" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionPurgeAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetentionPurgeAudit_counts_nonnegative" CHECK ("oddsDeleted" >= 0 AND "viewsDeleted" >= 0)
);

CREATE INDEX "RetentionPurgeAudit_completedAt_idx" ON "RetentionPurgeAudit"("completedAt");
