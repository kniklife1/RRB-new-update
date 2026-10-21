import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { VERIFIED_BOARD_CONFIGS, getBoardById } from './src/server/boards.ts';
import { verifyEndpointAuth } from './src/server/auth.ts';
import {
  clearInjectedFixtureNotices,
  evaluateZoneForTest,
  executeAllZonesTest,
  executeBootstrapBaseline,
  executeMonitorRun,
  injectFixtureNoticeForBoard,
  reconcileUncertainDelivery,
} from './src/server/engine.ts';
import {
  PersistentStateStore,
  createInitialMonitorState,
  getGitHubConfigFromEnv,
} from './src/server/stateStore.ts';
import {
  formatProductionNoticeTelegramMessage,
  formatUtcToIstDisplay,
  getTelegramConfigFromEnv,
  runDedicatedTelegramTest,
} from './src/server/telegram.ts';
import type { NoticeCategory } from './src/server/types.ts';

const PORT = 3000;
const stateStore = new PersistentStateStore();

async function buildHealthResponse() {
  try {
    const envelope = await stateStore.readState();
    const state = envelope.state;
    const enabledBoards = VERIFIED_BOARD_CONFIGS.filter((b) => b.enabled);
    const baselinedBoards = enabledBoards.filter(
      (b) => state.boardStatuses[b.boardId]?.baselined
    ).length;
    const failingBoards = enabledBoards.filter(
      (b) =>
        (state.boardStatuses[b.boardId]?.consecutiveFetchFailures || 0) > 0 ||
        (state.boardStatuses[b.boardId]?.consecutiveParserFailures || 0) > 0
    ).length;

    const tgConfig = getTelegramConfigFromEnv();
    const ghConfig = getGitHubConfigFromEnv();

    const overallStatus = !state.initialized
      ? 'BASELINE_REQUIRED'
      : state.resumableScanQueue?.active
        ? 'SCAN_IN_PROGRESS'
        : failingBoards > 0 || Object.keys(state.uncertainDeliveries).length > 0
          ? 'DEGRADED'
          : 'HEALTHY';

    return {
      httpCode: overallStatus === 'HEALTHY' || overallStatus === 'BASELINE_REQUIRED' ? 200 : 200,
      payload: {
        service: 'rrb-official-notice-monitor',
        version: '2.1.0',
        status: overallStatus,
        timestampUtc: new Date().toISOString(),
        timestampIst: formatUtcToIstDisplay(new Date().toISOString()),
        baseline: {
          initialized: state.initialized,
          baselineCompletedAt: state.baselineCompletedAt,
          baselinedBoards,
          totalEnabledBoards: enabledBoards.length,
        },
        execution: {
          lastAttemptedRunAt: state.lastAttemptedRunAt,
          lastSuccessfulRunAt: state.lastSuccessfulRunAt,
          lastRunStatus: state.lastRunStatus,
          lastRunId: state.lastRunId,
          activeLock: state.activeLock
            ? {
                operation: state.activeLock.operation,
                ownerRunId: state.activeLock.ownerRunId,
                expiresAt: state.activeLock.expiresAt,
              }
            : null,
          resumableScanQueue: state.resumableScanQueue,
        },
        boardHealthSummary: {
          totalConfigured: VERIFIED_BOARD_CONFIGS.length,
          enabled: enabledBoards.length,
          healthy: enabledBoards.length - failingBoards,
          failing: failingBoards,
        },
        queues: {
          knownNoticesTotal: Object.keys(state.knownNotices).length,
          deliveredTotal: state.deliveredNoticeIds.length,
          pendingDeliveries: Object.keys(state.pendingDeliveries).length,
          failedDeliveries: Object.keys(state.failedDeliveries).length,
          uncertainDeliveries: Object.keys(state.uncertainDeliveries).length,
        },
        integrations: {
          storageBackend: envelope.storageBackend,
          githubConfigured: ghConfig.configured,
          telegramConfigured: tgConfig.configured,
        },
        metrics: state.metrics,
      },
    };
  } catch (err) {
    return {
      httpCode: 503,
      payload: {
        service: 'rrb-official-notice-monitor',
        version: '2.1.0',
        status: 'STATE_STORE_UNAVAILABLE',
        timestampUtc: new Date().toISOString(),
        error: (err as Error).message,
      },
    };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // 1. GET /health (and /api/health)
  app.get(['/health', '/api/health'], async (_req, res) => {
    const health = await buildHealthResponse();
    res.status(health.httpCode).json(health.payload);
  });

  // 1B. GET /rrb-notice-monitor-v2.1.0.zip (and /api/project-zip) — Direct download of audited production ZIP
  app.get(['/rrb-notice-monitor-v2.1.0.zip', '/api/project-zip'], (_req, res) => {
    const zipPath = path.join(process.cwd(), 'rrb-notice-monitor-v2.1.0.zip');
    res.download(zipPath, 'rrb-notice-monitor-v2.1.0.zip');
  });

  // 2. GET /api/dashboard/snapshot — Full read-only operational state for UI console (no secret values exposed)
  app.get('/api/dashboard/snapshot', async (_req, res) => {
    try {
      const envelope = await stateStore.readState();
      const gh = getGitHubConfigFromEnv();
      const tg = getTelegramConfigFromEnv();

      const samplePendingPreview =
        Object.values(envelope.state.pendingDeliveries)[0] ||
        Object.values(envelope.state.uncertainDeliveries)[0] ||
        Object.values(envelope.state.knownNotices)[0];

      const sampleTelegramPreview = samplePendingPreview
        ? formatProductionNoticeTelegramMessage(
            {
              deliveryId: 'preview',
              noticeId: samplePendingPreview.noticeId,
              fingerprint: samplePendingPreview.fingerprint,
              boardId: samplePendingPreview.boardId,
              boardName: samplePendingPreview.boardName,
              title: samplePendingPreview.title,
              category: samplePendingPreview.category as NoticeCategory,
              publicationDate: samplePendingPreview.publicationDate,
              officialNoticeUrl: samplePendingPreview.officialNoticeUrl,
              attachmentUrls: samplePendingPreview.attachmentUrls,
              status: 'pending',
              attemptCount: 0,
              claimedByRunId: null,
              claimedAt: null,
              telegramMessageId: null,
              lastAttemptAt: null,
              deliveredAt: null,
              lastError: null,
              reconciliationNotes: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            new Date().toISOString()
          )[0]
        : null;

      res.json({
        ok: true,
        sha: envelope.sha,
        storageBackend: envelope.storageBackend,
        boards: VERIFIED_BOARD_CONFIGS,
        state: envelope.state,
        secretsStatus: {
          githubConfigured: gh.configured,
          githubValidationErrors: gh.validationErrors,
          githubRepoTarget: `${gh.config.owner || '<owner>'}/${gh.config.repo || '<repo>'}:${gh.config.branch}/${gh.config.statePath}`,
          telegramConfigured: tg.configured,
          telegramValidationErrors: tg.validationErrors,
          cronTokenConfigured: Boolean(
            process.env.CRON_AUTH_TOKEN &&
              !process.env.CRON_AUTH_TOKEN.startsWith('GENERATE_')
          ),
          adminTokenConfigured: Boolean(
            process.env.ADMIN_AUTH_TOKEN &&
              !process.env.ADMIN_AUTH_TOKEN.startsWith('GENERATE_')
          ),
        },
        sampleTelegramPreview,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: (err as Error).message,
      });
    }
  });

  // 3. POST /api/cron/run — Authenticated scheduled production execution endpoint
  app.post('/api/cron/run', async (req, res) => {
    const auth = verifyEndpointAuth(req.headers.authorization, 'cron');
    if (!auth.authorized) {
      res.status(401).json({
        ok: false,
        status: 'UNAUTHORIZED',
        error: auth.reason,
      });
      return;
    }

    const useFixtures = true;
    const maxBoardsPerBatch = req.body?.maxBoardsPerBatch
      ? Number(req.body.maxBoardsPerBatch)
      : undefined;

    const result = await executeMonitorRun(stateStore, {
      mode: 'production',
      useFixtures,
      maxBoardsPerBatch,
    });

    res.status(result.httpStatusCode).json({
      ok: result.status === 'SUCCESS',
      ...result,
    });
  });

  // 4. POST /api/admin/bootstrap — Authenticated initial baseline bootstrap (0 individual alerts)
  app.post('/api/admin/bootstrap', async (req, res) => {
    const auth = verifyEndpointAuth(req.headers.authorization, 'admin');
    if (!auth.authorized) {
      res.status(401).json({ ok: false, status: 'UNAUTHORIZED', error: auth.reason });
      return;
    }

    const useFixtures = true;
    const result = await executeBootstrapBaseline(stateStore, { useFixtures });

    res.status(result.status === 'SUCCESS' ? 200 : result.status === 'LOCKED' ? 409 : 502).json({
      ok: result.status === 'SUCCESS',
      ...result,
    });
  });

  // 5. POST /api/admin/dry-run — Authenticated dry-run scan (zero state mutations or Telegram alerts)
  app.post('/api/admin/dry-run', async (req, res) => {
    const auth = verifyEndpointAuth(req.headers.authorization, 'admin');
    if (!auth.authorized) {
      res.status(401).json({ ok: false, status: 'UNAUTHORIZED', error: auth.reason });
      return;
    }

    const useFixtures = true;
    const result = await executeMonitorRun(stateStore, {
      mode: 'dry_run',
      useFixtures,
    });

    res.status(result.httpStatusCode).json({
      ok: result.status === 'SUCCESS',
      ...result,
    });
  });

  // 6. POST /api/test/all-zones — Authenticated All-Zones Test endpoint
  app.post('/api/test/all-zones', async (req, res) => {
    const auth = verifyEndpointAuth(req.headers.authorization, 'cron');
    if (!auth.authorized) {
      res.status(401).json({ ok: false, status: 'UNAUTHORIZED', error: auth.reason });
      return;
    }

    const useFixtures = true;
    const sendTelegramTestSummary = Boolean(req.body?.sendTelegramTestSummary);

    const summary = await executeAllZonesTest({
      useFixtures,
      sendTelegramTestSummary,
    });

    res.json({
      ok: summary.counts.FAIL === 0,
      ...summary,
    });
  });

  // 7. POST /api/test/zone — Authenticated Per-Zone Test endpoint
  app.post('/api/test/zone', async (req, res) => {
    const auth = verifyEndpointAuth(req.headers.authorization, 'cron');
    if (!auth.authorized) {
      res.status(401).json({ ok: false, status: 'UNAUTHORIZED', error: auth.reason });
      return;
    }

    const boardId = String(req.body?.boardId || 'RRB_CENTRAL');
    const board = getBoardById(boardId);
    if (!board) {
      res.status(404).json({
        ok: false,
        error: `Unknown boardId '${boardId}'.`,
      });
      return;
    }

    const useFixtures = true;
    const report = await evaluateZoneForTest(board, {
      useFixtures,
      timeoutMs: 5000,
      maxRetries: 0,
    });

    res.json({
      ok: report.verdict === 'PASS' || report.verdict === 'PARTIAL',
      report,
    });
  });

  // 8. POST /api/test/telegram — Authenticated Dedicated Telegram Connectivity Test
  app.post('/api/test/telegram', async (req, res) => {
    const auth = verifyEndpointAuth(req.headers.authorization, 'admin');
    if (!auth.authorized) {
      res.status(401).json({ ok: false, status: 'UNAUTHORIZED', error: auth.reason });
      return;
    }

    const sendTestMessage =
      req.body?.sendTestMessage !== undefined ? Boolean(req.body.sendTestMessage) : true;
    const report = await runDedicatedTelegramTest({ sendTestMessage });

    res.json({
      ok: report.botValidated && (!sendTestMessage || report.testMessageSent),
      report,
    });
  });

  // 9. POST /api/admin/reconcile — Reconcile an uncertain Telegram delivery
  app.post('/api/admin/reconcile', async (req, res) => {
    const auth = verifyEndpointAuth(req.headers.authorization, 'admin');
    if (!auth.authorized) {
      res.status(401).json({ ok: false, status: 'UNAUTHORIZED', error: auth.reason });
      return;
    }

    try {
      const { deliveryId, resolution, notes } = req.body || {};
      if (!deliveryId || (resolution !== 'mark_sent' && resolution !== 'requeue_retry')) {
        res.status(400).json({
          ok: false,
          error: "Provide valid deliveryId and resolution ('mark_sent' | 'requeue_retry').",
        });
        return;
      }
      const nextState = await reconcileUncertainDelivery(
        stateStore,
        String(deliveryId),
        resolution,
        notes ? String(notes) : undefined
      );
      res.json({ ok: true, state: nextState });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  // 10. POST /api/admin/inject-fixture-notice — Inject a new notice into the fixture feed to test eligibility & queueing
  app.post('/api/admin/inject-fixture-notice', async (req, res) => {
    const auth = verifyEndpointAuth(req.headers.authorization, 'admin');
    if (!auth.authorized) {
      res.status(401).json({ ok: false, status: 'UNAUTHORIZED', error: auth.reason });
      return;
    }

    const boardId = String(req.body?.boardId || 'RRB_CENTRAL');
    const board = getBoardById(boardId);
    if (!board) {
      res.status(404).json({ ok: false, error: `Unknown boardId '${boardId}'.` });
      return;
    }

    const noticeCode = String(req.body?.noticeCode || `CEN 06/2026-${board.zoneCode}`);
    const title = String(
      req.body?.title ||
        `${noticeCode}: Declaration of Provisional Panel & Cut-Off Marks (${board.boardName})`
    );
    const publicationDate = String(
      req.body?.publicationDate || new Date().toISOString().slice(0, 10)
    );
    const category = String(req.body?.category || 'Result & Cut-Off Marks');
    const pdfPath = String(
      req.body?.pdfPath || `/notices/2026/${board.boardId}_${Date.now()}.pdf`
    );

    injectFixtureNoticeForBoard(board.boardId, {
      noticeCode,
      title,
      publicationDate,
      category,
      pdfPath,
    });

    res.json({
      ok: true,
      message: `Injected candidate notice '${title}' into ${board.boardName} fixture feed. Run Dry-Run or Cron Scan to evaluate eligibility.`,
    });
  });

  // 11. POST /api/admin/reset-baseline — Documented administrative reset with explicit confirmation
  app.post('/api/admin/reset-baseline', async (req, res) => {
    const auth = verifyEndpointAuth(req.headers.authorization, 'admin');
    if (!auth.authorized) {
      res.status(401).json({ ok: false, status: 'UNAUTHORIZED', error: auth.reason });
      return;
    }

    const confirmation = String(req.body?.confirmation || '');
    const preserveDeliveredFingerprints =
      req.body?.preserveDeliveredFingerprints !== undefined
        ? Boolean(req.body.preserveDeliveredFingerprints)
        : true;

    if (confirmation !== 'CONFIRM_BASELINE_RESET') {
      res.status(400).json({
        ok: false,
        error:
          "Explicit confirmation required: set confirmation='CONFIRM_BASELINE_RESET' to proceed.",
      });
      return;
    }

    clearInjectedFixtureNotices();
    const env = await stateStore.readState();
    const fresh = createInitialMonitorState();
    if (preserveDeliveredFingerprints) {
      fresh.deliveredNoticeIds = [...env.state.deliveredNoticeIds];
      fresh.deliveredFingerprints = [...env.state.deliveredFingerprints];
      fresh.deliveredContentHashes = [...(env.state.deliveredContentHashes || [])];
      fresh.deliveredCrossBoardKeys = [...(env.state.deliveredCrossBoardKeys || [])];
    }

    const written = await stateStore.writeState(
      fresh,
      env.sha,
      `chore(admin): explicit baseline reset (preserveFingerprints=${preserveDeliveredFingerprints})`
    );

    res.json({
      ok: true,
      message: preserveDeliveredFingerprints
        ? `Baseline flag reset while preserving ${fresh.deliveredFingerprints.length} historical deduplication fingerprints.`
        : 'Full state reset completed. Re-run Bootstrap Baseline before enabling production cron.',
      state: written.state,
    });
  });

  // Mount Vite middleware in development or static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[RRB Notice Monitor] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
