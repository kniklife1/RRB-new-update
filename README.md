# RRB Official Notice Monitor — Production Build (v2.1.0)

Production-oriented Railway Recruitment Board (RRB) unified portal and 21 regional boards notice monitoring, deterministic SHA-256 fingerprinting, GitHub Contents API state persistence, and Telegram Bot alert automation system.

---

## 1. Verified Official Source Architecture (Phase A Discovery)

The Railway Recruitment Control Board (RRCB) consolidated recruitment notifications across India into the **Unified RRB Portal**:
- **Primary Unified Portal**: `https://rrb.indianrailways.gov.in/`
- **Configured Regional Boards (21 Official RRBs + 1 Unified Central Portal = 22 Monitored Sources)**:
  1. `RRB_CENTRAL` — RRCB / Unified Central Portal (`https://rrb.indianrailways.gov.in/`)
  2. `RRB_AHMEDABAD` — RRB Ahmedabad (`WR-ADI`)
  3. `RRB_AJMER` — RRB Ajmer (`NWR-AII`)
  4. `RRB_ALLAHABAD` — RRB Prayagraj / Allahabad (`NCR-ALD`)
  5. `RRB_BANGALORE` — RRB Bengaluru (`SWR-SBC`)
  6. `RRB_BHOPAL` — RRB Bhopal (`WCR-BPL`)
  7. `RRB_BHUBANESWAR` — RRB Bhubaneswar (`ECoR-BBS`)
  8. `RRB_BILASPUR` — RRB Bilaspur (`SECR-BSP`)
  9. `RRB_CHANDIGARH` — RRB Chandigarh (`NR-CDG`)
  10. `RRB_CHENNAI` — RRB Chennai (`SR-MAS`)
  11. `RRB_GORAKHPUR` — RRB Gorakhpur (`NER-GKP`)
  12. `RRB_GUWAHATI` — RRB Guwahati (`NFR-GHY`)
  13. `RRB_JAMMU` — RRB Jammu-Srinagar (`NR-JAT`)
  14. `RRB_KOLKATA` — RRB Kolkata (`ER-KOAA`)
  15. `RRB_MALDA` — RRB Malda (`ER-MLDT`)
  16. `RRB_MUMBAI` — RRB Mumbai (`CR-CSTM`)
  17. `RRB_MUZAFFARPUR` — RRB Muzaffarpur (`ECR-MFP`)
  18. `RRB_PATNA` — RRB Patna (`ECR-PNBE`)
  19. `RRB_RANCHI` — RRB Ranchi (`SER-RNC`)
  20. `RRB_SECUNDERABAD` — RRB Secunderabad (`SCR-SC`)
  21. `RRB_SILIGURI` — RRB Siliguri (`NFR-SGUJ`)
  22. `RRB_THIRUVANANTHAPURAM` — RRB Thiruvananthapuram (`SR-TVC`)

> **Important Network Note on NIC Geo-Fencing**: National Informatics Centre (`*.gov.in` / `*.nic.in`) servers frequently block or time out non-Indian cloud egress IPs. When deploying to Google Cloud Run, deploy in an Indian region (`asia-south1` Mumbai or `asia-south2` Delhi). The monitor includes both **Live Network Probe** mode and **Deterministic Fixture Verification** mode for hermetic CI/CD and sandbox environments.

---

## 2. Required Secrets & Environment Variables

Configure the following server-side secrets in your host environment (never commit `.env` to Git):

| Variable | Required | Description |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from `@BotFather` (server-side only; never logged) |
| `TELEGRAM_CHAT_ID` | Yes | Target channel username (e.g. `@rrb_official_alerts`) or chat ID (`-100...`) |
| `GITHUB_TOKEN` | Yes | Fine-grained GitHub PAT with `Contents: Read and write` on state repo |
| `GITHUB_OWNER` | Yes | GitHub username or organization owning the state repository |
| `GITHUB_REPO` | Yes | Dedicated repository name for state persistence |
| `GITHUB_BRANCH` | Yes | Branch name (default: `main`) |
| `GITHUB_STATE_PATH` | Yes | Relative path to state file (default: `state/notices.json`) |
| `CRON_AUTH_TOKEN` | Yes | 64-character hex bearer secret used by `cron-job.org` |
| `ADMIN_AUTH_TOKEN` | Yes | 64-character hex bearer secret used for bootstrap, dry-run, and reset |
| `CRON_EXECUTION_BUDGET_MS` | Optional | Safe execution time budget per cron call (default: `24000` ms) |
| `OLDER_PUBLICATION_DATE_POLICY` | Optional | Policy for older dates: `quarantine` (default), `suppress`, or `allow_if_recent` |

---

## 3. GitHub Fine-Grained Token & State Setup

1. Create a private repository on GitHub (e.g., `rrb-notice-monitor-state`) initialized with a `main` branch.
2. Navigate to **GitHub Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens**.
3. Scope the token strictly to `rrb-notice-monitor-state` with **Repository permissions -> Contents: Read and write** (and `Metadata: Read-only`).
4. Set `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH=main`, and `GITHUB_STATE_PATH=state/notices.json`.
5. Every state update uses the current file `sha` via the GitHub Contents API (`PUT /repos/{owner}/{repo}/contents/{path}`). If a `409 Conflict` occurs, `PersistentStateStore` automatically re-reads the remote file, merges `knownNotices` and `deliveredFingerprints` without losing any delivery state, and retries safely.

---

## 4. Initial Production Baseline & Dry-Run Procedure

**Critical Rule**: Never enable production cron delivery before completing the initial baseline.

1. **Step 1 — Establish Initial Baseline (`POST /api/admin/bootstrap`)**:
   ```bash
   curl -X POST https://YOUR-DEPLOYED-HOST/api/admin/bootstrap \
     -H "Authorization: Bearer YOUR_ADMIN_AUTH_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"useFixtures": true}'
   ```
   - Discovers and parses all 22 boards.
   - Records every existing notice with `baselineStatus: "BASELINED_INITIAL"` and `deliveryStatus: "suppressed_baseline"`.
   - Sends **zero** individual historical alerts to Telegram.
   - Marks `initialized: true` and `baselineCompletedAt` **only** after all enabled boards succeed and the GitHub state write succeeds.

2. **Step 2 — Verify Persisted Baseline (`GET /health` & `POST /api/admin/dry-run`)**:
   ```bash
   curl -X POST https://YOUR-DEPLOYED-HOST/api/admin/dry-run \
     -H "Authorization: Bearer YOUR_ADMIN_AUTH_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"useFixtures": true}'
   ```
   - Confirm `newNoticesEligible: 0` on existing notices.

---

## 5. Scheduled Execution: GitHub Actions (`.github/workflows/monitor.yml`) & `cron-job.org`

### Option A — GitHub Actions Workflow (`.github/workflows/monitor.yml`)
The repository includes `.github/workflows/monitor.yml`, which supports both automatic 10-minute `schedule` triggers (`*/10 * * * *`) and manual `workflow_dispatch` runs (`production`, `dry_run`, `bootstrap`, `all_zones`, `telegram_test`):
- **Permissions**: Grants `contents: write` so `PersistentStateStore` can read and update `state/notices.json` with SHA conflict protection using either the built-in `GITHUB_TOKEN` or an optional `GH_STATE_TOKEN` secret.
- **Concurrency Protection**: Uses `group: rrb-notice-monitor-${{ github.ref }}` with `cancel-in-progress: false` so an active run is never terminated mid-Telegram delivery.
- **Execution Targets**:
  1. `direct_cli` (default): Runs `npx tsx scripts/run-monitor.ts` directly inside the workflow runner. Required GitHub Actions Repository Secrets: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (optional: `GH_STATE_TOKEN`).
  2. `remote_endpoint`: Sends an authenticated `POST` request to your deployed server (`MONITOR_API_URL`) at `/api/cron/run`, `/api/admin/bootstrap`, `/api/admin/dry-run`, `/api/test/all-zones`, or `/api/test/telegram`. Required GitHub Actions Repository Secrets: `MONITOR_API_URL`, `CRON_AUTH_TOKEN`, and `ADMIN_AUTH_TOKEN`.

### Option B — External Scheduler (`cron-job.org`)
Configure your external scheduler at [cron-job.org](https://cron-job.org):

- **Title**: `RRB Official Notice Monitor — Production Scan`
- **URL**: `https://YOUR-DEPLOYED-HOST/api/cron/run`
- **Schedule**: Every **10 minutes** (`*/10 * * * *`)
- **Time Zone**: `Asia/Kolkata` (IST, UTC+05:30)
- **Request Method**: `POST`
- **Headers**:
  - `Authorization: Bearer YOUR_CRON_AUTH_TOKEN`
  - `Content-Type: application/json`
- **Request Body**:
  ```json
  {"mode": "production"}
  ```
- **Request Timeout**: `30 seconds` (the server enforces `CRON_EXECUTION_BUDGET_MS=24000` so runs safely checkpoint and exit before 24s; if any boards remain, the server returns `HTTP 206 Partial Content` and resumes from `resumableScanQueue` on the next run).

---

## 6. Google Cloud Run Deployment

Deploy in `asia-south1` (Mumbai) or `asia-south2` (Delhi) for optimal connectivity to `rrb.indianrailways.gov.in`:

```bash
gcloud run deploy rrb-notice-monitor \
  --source . \
  --region asia-south1 \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --timeout 60s \
  --set-env-vars="GITHUB_OWNER=YOUR_ORG,GITHUB_REPO=rrb-notice-monitor-state,GITHUB_BRANCH=main,GITHUB_STATE_PATH=state/notices.json" \
  --set-secrets="TELEGRAM_BOT_TOKEN=telegram-bot-token:latest,TELEGRAM_CHAT_ID=telegram-chat-id:latest,GITHUB_TOKEN=github-state-pat:latest,CRON_AUTH_TOKEN=cron-auth-token:latest,ADMIN_AUTH_TOKEN=admin-auth-token:latest"
```
*(Note: `--allow-unauthenticated` at the Cloud Run ingress allows `cron-job.org` to reach the container, while the application itself strictly enforces `Authorization: Bearer` tokens on all `/api/*` action endpoints).*

---

## 7. Recovery & Administrative Reset Procedures

- **Uncertain Telegram Deliveries**: Because Telegram's `sendMessage` API does not support an idempotency key, any network timeout occurring *after* the HTTP request was transmitted places the item into `uncertainDeliveries`. It is **never** blindly retried by cron. Inspect the target Telegram channel and call `POST /api/admin/reconcile` with `{"deliveryId": "...", "resolution": "mark_sent"}` or `"requeue_retry"`.
- **Administrative Baseline Reset**: Requires `ADMIN_AUTH_TOKEN` and `{"confirmation": "CONFIRM_BASELINE_RESET", "preserveDeliveredFingerprints": true}`. By default, resetting the baseline flag preserves all historical `deliveredFingerprints` so previously alerted notices can never be resent.

---

## 8. Security Checklist

- [x] **Server-Side Secrets Only**: `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, `CRON_AUTH_TOKEN`, and `ADMIN_AUTH_TOKEN` are accessed strictly in Node.js server memory and never bundled into client code.
- [x] **Constant-Time Token Verification**: `crypto.timingSafeEqual` protects all action endpoints (`POST /api/cron/run`, `/api/test/*`, `/api/admin/*`).
- [x] **SSRF Prevention**: `isApprovedOfficialUrl` restricts outbound scraper fetches and redirect destinations strictly to the 23 approved official Indian Railways / RRB domains and blocks loopback/private CIDR ranges.
- [x] **Token Redaction**: Telegram error handlers strip `botToken` before logging or storing `recentErrors`.
- [x] **Fail-Closed State Persistence**: Pre-delivery claims are written to GitHub state *before* calling Telegram; if a state read or write fails, zero alerts are dispatched.

---

## 9. Automated Test Suite & Audit Verification (37 Tests)

Run the complete 37-test automated verification suite using Node's built-in test runner:

```bash
npm test
# or directly:
node --test src/server/__tests__/monitor.test.ts src/server/__tests__/workflow-and-cli.test.ts
```

### Verified Safeguards Covered by the 37 Automated Tests
- **Tests 1–2, 8–9, 21, 23, 26, 31 (Zero Historical / Old Message Leaks)**:
  - Initial baseline bootstrap across all 22 boards produces `0` individual Telegram alerts (`BASELINED_INITIAL`).
  - Incomplete baseline (`<22` boards or state write error) leaves `initialized: false` and blocks `POST /api/cron/run` with `HTTP 412 BASELINE_REQUIRED`.
  - Newly enabled / unbaselined boards (`baselined: false`) baseline 100% of existing notices on their first scan without sending alerts.
  - Outage recovery (from fetch or parser failures) suppresses historical and pre-watermark notices (`BASELINED_RECOVERY`).
  - Missing, `LOW`-confidence, old (`< baselineCompletedAt`, `< boardWatermark`, or `> 14` days), or impossible future (`> +2` days) publication dates are quarantined (`QUARANTINED_UNVERIFIED_DATE` / `QUARANTINED_OLD_DATE`) and never poison the board watermark.
- **Tests 3–7, 14–19, 27–30, 32 (Zero Duplicate Alerts & Fail-Closed Delivery)**:
  - Deterministic SHA-256 `noticeId`, `fingerprint`, `contentHash`, and `crossBoardDocumentKey` (stripping regional CEN suffixes like `-CENTRAL`, `-MMCT`, `-WR-ADI`, and board names).
  - Pre-delivery atomic claim (`status: "sending"`, `claimedByRunId`) is persisted to GitHub before calling Telegram; if the state write fails, execution halts with `0` Telegram calls.
  - Post-transmission network timeouts or mid-flight crashed workers transition items to `uncertainDeliveries` and are never blindly retried without explicit admin reconciliation (`POST /api/admin/reconcile`).
  - GitHub `HTTP 409 Conflict` responses re-read and deterministically merge state while preserving active lock ownership and `sending` claims.
- **Tests 33–37 (GitHub Actions Workflow, CLI Runner & Configuration Parity)**:
  - Validates `.github/workflows/monitor.yml` triggers, `contents: write` permissions, `cancel-in-progress: false` concurrency, and verified endpoint routes.
  - Validates `GITHUB_REPOSITORY`, `GITHUB_REF_NAME`, and `GH_STATE_TOKEN` resolution in `getGitHubConfigFromEnv`.
  - Validates `state/notices.json` Schema v2 structure, `config/boards.json` 22-board parity, and `scripts/run-monitor.ts` standalone CLI execution across `bootstrap`, `dry_run`, `production`, and `all_zones` modes.


