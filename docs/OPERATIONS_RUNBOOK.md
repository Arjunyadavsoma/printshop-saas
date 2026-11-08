# Operations Runbook

> Day-to-day operations for the PrintShop SaaS platform. What to
> monitor, what to do when things break.

---

## 1. Daily monitoring

### 1.1 Health check (morning)

```bash
# Quick check
curl -sS https://printshop-saas-three.vercel.app/api/v1/health
curl -sS https://printshop-saas-three.vercel.app/api/v1/shops?limit=1
```

### 1.2 DB health

```bash
curl -sS https://printshop-saas-three.vercel.app/api/v1/db-health | python3 -m json.tool
```

Check:
- `connection: OK`
- `tablesCount: 14`
- `shopCount` > 0
- `userCount` > 0

### 1.3 Cleanup cron

Check GitHub Actions → "Cleanup Cron" workflow runs:
- Should run every 5 minutes
- Should return `success: true`
- `processed` > 0 only if files are due for cleanup

If failing:
1. Check `CRON_SECRET` is set in both GitHub secrets + Vercel env vars
2. Check the workflow logs for the HTTP response
3. Manually call: `curl -H "Authorization: Bearer $CRON_SECRET" https://printshop-saas-three.vercel.app/api/v1/cron/cleanup`

---

## 2. Common incidents

### 2.1 Production returns 500

**Symptom:** All routes return 500 (including `/api/v1/health`)

**Likely cause:** Next.js build error or module-level crash

**Steps:**
1. Check the latest commit — did it introduce a syntax error?
2. Run `bash scripts/check-route-conflicts.sh` locally
3. Run `npx tsc --noEmit` locally
4. If a route conflict or syntax error is found, fix + push immediately
5. Vercel keeps the previous deployment until the new one builds successfully

### 2.2 Shops not loading (500 on `/api/v1/shops`)

**Symptom:** Health returns 200 but shops API returns 500

**Likely cause:** DB connection issue or schema drift

**Steps:**
1. Check `/api/v1/db-health` — is `connection: OK`?
2. Check if `tablesCount` matches the expected count (14)
3. If a table is missing, run the migration SQL via Supabase SQL Editor
4. If the DB is unreachable, check Supabase dashboard for outages

### 2.3 Agent can't connect (401 on agent endpoints)

**Symptom:** PrintEXE gets 401 on all agent endpoints

**Likely cause:** Invalid or revoked device token

**Steps:**
1. Verify the device token was copied correctly (no trailing spaces)
2. Check if the agent was revoked: login as shop owner → Printer Setup → check device list
3. If revoked, register a new agent and re-pair PrintEXE
4. If not revoked, check the `tokenHash` column exists: `SELECT id, tokenHash FROM "PrintAgent" WHERE id = '<agent-id>'`

### 2.4 Payment webhook not received

**Symptom:** Customer paid but order stays `awaiting_payment`

**Steps:**
1. Check if the webhook URL is correct in the PSP dashboard:
   - PhonePe: `https://printshop-saas-three.vercel.app/api/v1/payments/phonepe/webhook`
   - Paytm: `https://printshop-saas-three.vercel.app/api/v1/payments/paytm/callback`
2. Check Vercel function logs for webhook calls
3. Verify `PHONEPE_WEBHOOK_USERNAME` / `PHONEPE_WEBHOOK_PASSWORD` env vars are set
4. As fallback, shopkeeper can manually verify: `POST /api/v1/shops/me/orders/{id}/verify-payment`

### 2.5 Files not being cleaned up

**Symptom:** Storage usage growing, old PDFs not deleted

**Steps:**
1. Check if `CRON_SECRET` is configured (see Deployment Runbook §6)
2. Check GitHub Actions "Cleanup Cron" workflow is running
3. Manually call the cleanup endpoint:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     https://printshop-saas-three.vercel.app/api/v1/cron/cleanup
   ```
4. Check the response for `failedTasks` > 0 — if so, check `lastError` field

---

## 3. Backup procedures

### 3.1 Database backup (weekly)

```bash
pg_dump "$DATABASE_URL" > backup-$(date +%Y%m%d).sql
# Store in a secure location (not in the git repo)
```

### 3.2 Storage backup

Supabase Storage doesn't have a built-in backup. For critical files:
- Use `aws s3 sync` (if using R2/S3) to copy to a backup bucket
- Or use Supabase Dashboard → Storage → export

### 3.3 Restore

```bash
# Database
psql "$DATABASE_URL" < backup-YYYYMMDD.sql

# Storage: re-upload from backup bucket
```

---

## 4. Scaling considerations

### 4.1 Current limits (Vercel Hobby)

| Resource | Limit | Impact |
|---|---|---|
| Function duration | 10s | Long queries may timeout |
| Cron jobs | 2 daily | Using GitHub Actions instead |
| Bandwidth | 100GB/mo | Monitor storage usage |
| Build time | 45 min | Sufficient |

### 4.2 When to upgrade

- **Vercel Pro** ($20/mo): when function duration >10s, or need Vercel Cron
- **Supabase Pro** ($25/mo): when DB >500MB or storage >1GB
- **Render** ($7/mo): for the realtime mini-service (not deployable on Vercel)

---

## 5. Log locations

| Log | Location | Retention |
|---|---|---|
| Vercel function logs | Vercel Dashboard → Functions | 1 hour (Hobby) |
| Structured API logs | JSON stdout (captured by Vercel) | 1 hour (Hobby) |
| Audit log | `AuditLog` table in DB | 30 days (auto-pruned) |
| PrintEXE logs | `%AppData%\PrintShop\Companion\logs\` | 14 days (rolling) |
| GitHub Actions logs | GitHub → Actions tab | 90 days |

---

## 6. On-call checklist

When alerted:

1. Check `/api/v1/health` — is the app up?
2. Check `/api/v1/db-health` — is the DB connected?
3. Check `/api/v1/shops` — is data loading?
4. Check GitHub Actions "Cleanup Cron" — is cleanup running?
5. If any check fails, follow the incident steps in §2
6. If the issue is a code bug, fix locally → `tsc --noEmit` + `bun run lint` + `bunx vitest run` → push
7. If the issue is a DB issue, backup first → fix via Supabase SQL Editor
8. Document the incident in the worklog
