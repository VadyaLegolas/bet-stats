-- Drop the unmodeled quarantine table to enforce the D-14 deletion boundary
-- and prevent linkable personal history from persisting without expiry or withdrawal.
DROP TABLE IF EXISTS "RetentionMigrationQuarantine";
