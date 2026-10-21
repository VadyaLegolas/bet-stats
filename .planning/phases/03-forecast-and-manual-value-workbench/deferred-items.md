# Deferred items

- Existing `p3-fixture` forecast rows in the retained Phase 3 disposable database contain a legacy extra receipt key and fail the strict `parseForecastResponse` read contract with `UNKNOWN_FORECAST_RESPONSE_KEY`. This predates Plan 03-06; regenerate those disposable fixtures before using them for full issued-forecast browser coverage.
