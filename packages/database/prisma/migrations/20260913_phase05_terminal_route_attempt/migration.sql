CREATE OR REPLACE FUNCTION guard_provider_route_attempt_transition() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PROVIDER_ROUTE_APPEND_ONLY'; END IF;
  IF OLD."state" = 'ADMITTED'
     AND NEW."state" IN ('FAILED', 'SUCCEEDED', 'NO_FALLBACK')
     AND NEW."id" = OLD."id"
     AND NEW."routeReceiptId" = OLD."routeReceiptId"
     AND NEW."attemptKey" = OLD."attemptKey"
     AND NEW."provider" IS NOT DISTINCT FROM OLD."provider"
     AND NEW."admitted" = OLD."admitted"
     AND NEW."createdAt" = OLD."createdAt"
     AND ((NEW."state" = 'SUCCEEDED' AND NEW."observationId" IS NOT NULL AND NEW."reason" IS NULL)
       OR (NEW."state" <> 'SUCCEEDED' AND NEW."observationId" IS NULL AND NEW."reason" IS NOT NULL))
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'PROVIDER_ROUTE_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "ProviderRouteAttempt_guarded_immutable" ON "ProviderRouteAttempt";
CREATE TRIGGER "ProviderRouteAttempt_guarded_immutable"
BEFORE UPDATE OR DELETE ON "ProviderRouteAttempt"
FOR EACH ROW EXECUTE FUNCTION guard_provider_route_attempt_transition();
