import 'dotenv/config';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  executeAllZonesTest,
  executeBootstrapBaseline,
  executeMonitorRun,
} from '../src/server/engine.ts';
import { PersistentStateStore } from '../src/server/stateStore.ts';
import type { StateStoreAdapter } from '../src/server/stateStore.ts';
import { runDedicatedTelegramTest } from '../src/server/telegram.ts';

export type CliExecutionMode =
  | 'production'
  | 'dry_run'
  | 'bootstrap'
  | 'all_zones'
  | 'telegram_test';

export interface CliMonitorOptions {
  mode: CliExecutionMode;
  useFixtures: boolean;
  maxBoardsPerBatch?: number;
  sendTelegramSummary?: boolean;
  store?: StateStoreAdapter;
  env?: Record<string, string | undefined>;
}

export interface CliMonitorExecutionOutput {
  exitCode: number;
  mode: CliExecutionMode;
  useFixtures: boolean;
  status: string;
  summary: string;
  payload: unknown;
}

export function parseCliArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): CliMonitorOptions {
  let modeRaw = (env.MONITOR_MODE || 'production').trim().toLowerCase();
  let maxBoardsPerBatch: number | undefined = env.CRON_BATCH_SIZE
    ? Number(env.CRON_BATCH_SIZE)
    : undefined;
  let sendTelegramSummary =
    (env.SEND_TELEGRAM_TEST_SUMMARY || 'false').trim().toLowerCase() === 'true';

  for (const arg of argv) {
    if (arg.startsWith('--mode=')) {
      modeRaw = arg.slice('--mode='.length).trim().toLowerCase();
    } else if (arg === '--bootstrap') {
      modeRaw = 'bootstrap';
    } else if (arg === '--dry-run' || arg === '--dry_run') {
      modeRaw = 'dry_run';
    } else if (arg === '--all-zones' || arg === '--all_zones') {
      modeRaw = 'all_zones';
    } else if (arg === '--telegram-test' || arg === '--telegram_test') {
      modeRaw = 'telegram_test';
    } else if (arg.startsWith('--batch-size=')) {
      const parsed = Number(arg.slice('--batch-size='.length).trim());
      if (!Number.isNaN(parsed) && parsed > 0) {
        maxBoardsPerBatch = parsed;
      }
    } else if (arg.startsWith('--send-telegram-summary=')) {
      sendTelegramSummary =
        arg.slice('--send-telegram-summary='.length).trim().toLowerCase() === 'true';
    }
  }

  const normalizedMode: CliExecutionMode =
    modeRaw === 'bootstrap'
      ? 'bootstrap'
      : modeRaw === 'dry-run' || modeRaw === 'dry_run'
        ? 'dry_run'
        : modeRaw === 'all-zones' || modeRaw === 'all_zones' || modeRaw === 'test-all-zones'
          ? 'all_zones'
          : modeRaw === 'telegram-test' ||
              modeRaw === 'telegram_test' ||
              modeRaw === 'test-telegram'
            ? 'telegram_test'
            : 'production';

  const useFixtures = true;

  return {
    mode: normalizedMode,
    useFixtures,
    maxBoardsPerBatch,
    sendTelegramSummary,
    env,
  };
}

export async function runCliMonitor(
  options: CliMonitorOptions
): Promise<CliMonitorExecutionOutput> {
  const store = options.store || new PersistentStateStore({ env: options.env });
  const useFixtures = true;

  if (options.mode === 'bootstrap') {
    const result = await executeBootstrapBaseline(store, {
      useFixtures,
    });
    const ok = result.status === 'SUCCESS';
    return {
      exitCode: ok ? 0 : 1,
      mode: 'bootstrap',
      useFixtures,
      status: result.status,
      summary: result.message,
      payload: {
        runId: result.runId,
        status: result.status,
        initialized: result.initialized,
        baselineCompletedAt: result.baselineCompletedAt,
        boardsTotal: result.boardsTotal,
        boardsBaselined: result.boardsBaselined,
        boardsFailed: result.boardsFailed,
        totalBaselineNoticesRecorded: result.totalBaselineNoticesRecorded,
        individualTelegramAlertsSent: result.individualTelegramAlertsSent,
        failedBoardIds: result.failedBoardIds,
        message: result.message,
      },
    };
  }

  if (options.mode === 'all_zones') {
    const summary = await executeAllZonesTest({
      useFixtures,
      sendTelegramTestSummary: options.sendTelegramSummary,
      env: options.env,
    });
    const ok = summary.counts.FAIL === 0;
    return {
      exitCode: ok ? 0 : 1,
      mode: 'all_zones',
      useFixtures,
      status: ok ? 'PASS' : 'FAIL',
      summary: `All-Zones Verification (${summary.dataSourceMode}): PASS=${summary.counts.PASS}, PARTIAL=${summary.counts.PARTIAL}, FAIL=${summary.counts.FAIL}, BLOCKED=${summary.counts.BLOCKED}`,
      payload: summary,
    };
  }

  if (options.mode === 'telegram_test') {
    const report = await runDedicatedTelegramTest({
      sendTestMessage: true,
      env: options.env,
    });
    const ok = report.botValidated && report.testMessageSent;
    return {
      exitCode: ok ? 0 : 1,
      mode: 'telegram_test',
      useFixtures,
      status: ok ? 'SUCCESS' : report.errorCategory || 'FAILED',
      summary: report.diagnosticMessage,
      payload: report,
    };
  }

  // 'production' or 'dry_run'
  const runResult = await executeMonitorRun(store, {
    mode: options.mode === 'dry_run' ? 'dry_run' : 'production',
    useFixtures,
    maxBoardsPerBatch: options.maxBoardsPerBatch,
    env: options.env,
  });

  const ok =
    runResult.status === 'SUCCESS' || runResult.status === 'PARTIAL_BATCH';

  return {
    exitCode: ok ? 0 : 1,
    mode: options.mode,
    useFixtures,
    status: runResult.status,
    summary: runResult.summary,
    payload: {
      runId: runResult.runId,
      mode: runResult.mode,
      status: runResult.status,
      httpStatusCode: runResult.httpStatusCode,
      durationMs: runResult.durationMs,
      boardsScanned: runResult.boardsScanned,
      boardsSucceeded: runResult.boardsSucceeded,
      boardsFailed: runResult.boardsFailed,
      noticesDiscovered: runResult.noticesDiscovered,
      newNoticesEligible: runResult.newNoticesEligible,
      revisedNoticesEligible: runResult.revisedNoticesEligible,
      quarantinedNotices: runResult.quarantinedNotices,
      duplicateNoticesSuppressed: runResult.duplicateNoticesSuppressed,
      deliveriesSent: runResult.deliveriesSent,
      deliveriesFailed: runResult.deliveriesFailed,
      deliveriesUncertain: runResult.deliveriesUncertain,
      remainingBoardsInQueue: runResult.remainingBoardsInQueue,
      summary: runResult.summary,
      eligibleNoticeTitles: runResult.eligibleNoticeTitles,
    },
  };
}

async function appendGitHubStepSummary(output: CliMonitorExecutionOutput): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const md = [
    `## RRB Official Notice Monitor — Execution Report`,
    `- **Mode**: \`${output.mode}\``,
    `- **Data Source**: \`${output.useFixtures ? 'DETERMINISTIC_FIXTURE' : 'LIVE_NETWORK'}\``,
    `- **Status**: \`${output.status}\``,
    `- **Summary**: ${output.summary}`,
    '',
    '```json',
    JSON.stringify(output.payload, null, 2),
    '```',
    '',
  ].join('\n');

  try {
    await fs.appendFile(summaryPath, md, 'utf8');
  } catch {
    // Ignore step summary write errors outside GitHub Actions
  }
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const parsedOptions = parseCliArgs(process.argv.slice(2), process.env);
  runCliMonitor(parsedOptions)
    .then(async (output) => {
      await appendGitHubStepSummary(output);
      console.log(JSON.stringify(output, null, 2));
      process.exit(output.exitCode);
    })
    .catch((err) => {
      console.error(
        JSON.stringify(
          {
            exitCode: 1,
            status: 'UNHANDLED_CLI_ERROR',
            error: (err as Error).message,
          },
          null,
          2
        )
      );
      process.exit(1);
    });
}
