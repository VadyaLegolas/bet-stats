CREATE TYPE "RetentionSubjectProviderMode" AS ENUM ('SIGNED');

CREATE TABLE "RetentionSubject" (
  "id" TEXT NOT NULL,
  "providerMode" "RetentionSubjectProviderMode" NOT NULL,
  "subjectKey" TEXT NOT NULL,
  "approvedAt" TIMESTAMPTZ(3) NOT NULL,
  "retentionBlockedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionSubject_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetentionSubject_subjectKey_nonempty" CHECK (length("subjectKey") BETWEEN 1 AND 256)
);

CREATE TABLE "RetentionConsent" (
  "id" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "policyEffectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "durationDays" INTEGER NOT NULL,
  "grantedAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionConsent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetentionConsent_policy_nonempty" CHECK (length("policyVersion") > 0),
  CONSTRAINT "RetentionConsent_duration_positive" CHECK ("durationDays" > 0),
  CONSTRAINT "RetentionConsent_window_valid" CHECK ("policyEffectiveAt" <= "grantedAt" AND "grantedAt" < "expiresAt"),
  CONSTRAINT "RetentionConsent_revocation_valid" CHECK ("revokedAt" IS NULL OR "revokedAt" >= "grantedAt"),
  CONSTRAINT "RetentionConsent_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "RetentionSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "RetainedOddsHistory" (
  "id" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "consentId" TEXT NOT NULL,
  "oddsSnapshotId" TEXT NOT NULL,
  "retainedAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetainedOddsHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetainedOddsHistory_window_valid" CHECK ("retainedAt" < "expiresAt"),
  CONSTRAINT "RetainedOddsHistory_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "RetentionSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RetainedOddsHistory_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "RetentionConsent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RetainedOddsHistory_oddsSnapshotId_fkey" FOREIGN KEY ("oddsSnapshotId") REFERENCES "ManualOddsSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "RetainedViewHistory" (
  "id" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "consentId" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "viewedAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetainedViewHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetainedViewHistory_resource_nonempty" CHECK (length("resourceType") > 0 AND length("resourceId") > 0),
  CONSTRAINT "RetainedViewHistory_window_valid" CHECK ("viewedAt" < "expiresAt"),
  CONSTRAINT "RetainedViewHistory_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "RetentionSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RetainedViewHistory_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "RetentionConsent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RetentionSubject_providerMode_subjectKey_key" ON "RetentionSubject"("providerMode", "subjectKey");
CREATE INDEX "RetentionSubject_retentionBlockedAt_idx" ON "RetentionSubject"("retentionBlockedAt");
CREATE UNIQUE INDEX "RetentionConsent_subjectId_policyVersion_grantedAt_key" ON "RetentionConsent"("subjectId", "policyVersion", "grantedAt");
CREATE INDEX "RetentionConsent_subjectId_revokedAt_expiresAt_idx" ON "RetentionConsent"("subjectId", "revokedAt", "expiresAt");
CREATE INDEX "RetentionConsent_expiresAt_idx" ON "RetentionConsent"("expiresAt");
CREATE UNIQUE INDEX "RetainedOddsHistory_subjectId_oddsSnapshotId_key" ON "RetainedOddsHistory"("subjectId", "oddsSnapshotId");
CREATE INDEX "RetainedOddsHistory_subjectId_expiresAt_idx" ON "RetainedOddsHistory"("subjectId", "expiresAt");
CREATE INDEX "RetainedOddsHistory_consentId_idx" ON "RetainedOddsHistory"("consentId");
CREATE INDEX "RetainedViewHistory_subjectId_expiresAt_idx" ON "RetainedViewHistory"("subjectId", "expiresAt");
CREATE INDEX "RetainedViewHistory_consentId_idx" ON "RetainedViewHistory"("consentId");

CREATE FUNCTION enforce_active_retention_consent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE consent_expiry TIMESTAMPTZ;
BEGIN
  SELECT consent."expiresAt" INTO consent_expiry
  FROM "RetentionConsent" consent
  JOIN "RetentionSubject" subject ON subject.id = consent."subjectId"
  WHERE consent.id = NEW."consentId"
    AND consent."subjectId" = NEW."subjectId"
    AND consent."revokedAt" IS NULL
    AND consent."policyEffectiveAt" <= clock_timestamp()
    AND consent."grantedAt" <= clock_timestamp()
    AND consent."expiresAt" > clock_timestamp()
    AND subject."providerMode" = 'SIGNED'
    AND subject."approvedAt" <= clock_timestamp()
    AND subject."retentionBlockedAt" IS NULL;

  IF consent_expiry IS NULL OR NEW."expiresAt" > consent_expiry OR NEW."expiresAt" <= clock_timestamp() THEN
    RAISE EXCEPTION 'active approved retention consent required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "RetainedOddsHistory_active_consent" BEFORE INSERT OR UPDATE ON "RetainedOddsHistory"
FOR EACH ROW EXECUTE FUNCTION enforce_active_retention_consent();
CREATE TRIGGER "RetainedViewHistory_active_consent" BEFORE INSERT OR UPDATE ON "RetainedViewHistory"
FOR EACH ROW EXECUTE FUNCTION enforce_active_retention_consent();
