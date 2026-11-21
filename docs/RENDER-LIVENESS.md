# Render liveness probes

`GET /api/liveness` returns HTTP 200 with only `{ "status": "ok" }` when the Next.js process can serve the request. It reads no environment configuration, performs no Supabase Auth, database, commerce Edge, or payment requests, and sets no cookies. The route is explicitly dynamic and returns `Cache-Control: no-store, max-age=0` so a cached success cannot stand in for a responding process. It is outside the session-refresh proxy matcher.

Render's frequent probes previously targeted `/api/health`. In configured shared-commerce mode, each successful deep check makes a database health RPC and a commerce Edge catalog request. Pointing routine probes at `/api/liveness` removes that background dependency traffic. It does not reduce real customer traffic, recover previously consumed quota, or guarantee that Free-plan limits will be sufficient.

## Operational tradeoff

Liveness confirms that the web process responds. It does not verify credentials, database connectivity, commerce availability, checkout, or payments. Render can consider an instance healthy while one of those dependencies is unavailable, and a deployment with broken dependency configuration can pass this probe.

`/api/health` remains unchanged as an uncached deep diagnostic with its existing 200/503 behavior and redacted response. Use it deliberately when investigating dependency readiness and as a release check before treating shared commerce as usable. Frequent automated calls to that endpoint continue to consume dependency usage. No diagnostic monitor or schedule is created by this change.

## Apply to running services after deployment

The repository's `render.yaml` now specifies `/api/liveness` for `hotpizzaace-development`. A local Blueprint edit does not update the running service, and this development-only Blueprint does not configure other services.

1. Deploy a revision containing `/api/liveness` while the service's existing health path remains valid. Coordinate Blueprint sync so it does not switch an old revision to a route it does not contain.
2. Wait for the deploy to become live. Request `/api/liveness` on that service and verify HTTP 200, the exact small JSON body, and `Cache-Control: no-store, max-age=0`. Also run `/api/health` once to assess dependency readiness separately.
3. Change each intended existing Render web service's **Settings → Health Checks → Health Check Path** to `/api/liveness`, or sync its correctly scoped Blueprint after step 2. Verify the saved live service configuration; do not assume a repository edit changed it. Apply this separately to production if intended.
4. Confirm subsequent health probes use the new path and observe dependency usage over time. Preserve the endpoint in any rollback revision, or restore the old health path before rolling back to code that lacks it.

This change does not itself deploy code or update any live Render health path.

Render accepts a successful HTTP health response within five seconds and uses health checks during deployment and while instances run. See the current [health-check documentation](https://render.com/docs/health-checks), [Blueprint field reference](https://render.com/docs/blueprint-spec#healthcheckpath), and [deployment lifecycle](https://render.com/docs/deploys).
