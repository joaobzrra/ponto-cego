# Ponto Cego operations

## Safe public calibration

- Keep `PREVIEW_ACCESS_CODE` empty to allow anyone with the link to enter.
- Keep `PUBLIC_INDEXING_ENABLED=false` until the public search launch.
- Verify a public response includes `X-Robots-Tag: noindex, follow, noarchive`.
- Verify `/robots.txt` allows public pages and does not advertise a sitemap.
- Verify `/sitemap.xml` is empty.
- Social previews remain enabled independently of indexing.

## Trusted proxy boundary

`TRUST_PROXY_HEADERS=1` is safe only when the application cannot be reached
directly and the reverse proxy overwrites `CF-Connecting-IP`,
`X-Forwarded-For`, and `X-Real-IP`. Leave it at `0` otherwise.

## Database migrations

1. Pause the worker before schema changes.
2. Take a PostgreSQL dump and verify the dump can be listed.
3. Run `npm run db:migrate`.
4. Start the application and run public/admin smoke checks.
5. Restart the worker and confirm queue depth decreases.

Migration `0015_classification_observations` only creates a new table and
indexes. It does not rewrite `articles`. Its SQL sets bounded lock and
statement timeouts.

## Backup and restore rehearsal

1. Create a custom-format dump with `pg_dump --format=custom`.
2. Create a clean rehearsal database.
3. Restore with `pg_restore --clean --if-exists --no-owner`.
4. Compare counts for outlets, feeds, articles, classifications, clusters,
   admin users, and audit records.
5. Run `npm run typecheck`, `npm test`, `npm run build`, then start the app
   against the restored database and perform smoke checks.
6. Record dump size, dump/restore duration, peak memory, database size, HNSW
   size, and remaining disk. Choose the cheapest VPS envelope that retains
   40% free disk and does not swap under ingestion plus public traffic.

Never make a live volume move the only migration path. Keep the old deployment
unchanged until post-cutover counts and smoke checks pass.

## Credential rotation

Rotate credentials one provider at a time. Add the new credential, restart and
verify the dependent feature, then revoke the old credential. Do not paste
credentials into commits, issue trackers, plans, or agent prompts.

## August model evaluation

- Build 80 unique human-labeled cases and blindly repeat 20 of them.
- Freeze rubric, prompt version, exact model IDs, temperature, schema, and
  prices before running candidates.
- Use the provider adapters in `src/lib/classifier-provider.ts` for direct
  comparison; do not change active article projections during evaluation.
- A candidate must meet the recorded quality gates and projected
  US$100/month ceiling. Among passing candidates, choose the cheapest.
- Re-run the local NC gate against the human set before retaining it.
- Roll out the winner in shadow mode, then limited traffic, preserving the
  prior observation history for rollback.
