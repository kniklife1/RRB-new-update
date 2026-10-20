import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Lock,
  Play,
  ShieldCheck,
  Database,
  Clock,
  RefreshCw,
} from 'lucide-react';
import type { DashboardSnapshot } from '../types/client.ts';

interface OverviewTabProps {
  snapshot: DashboardSnapshot;
  useFixtures: boolean;
  setUseFixtures: (v: boolean) => void;
  busyAction: string | null;
  onRunBootstrap: () => void;
  onRunDryRun: () => void;
  onRunCron: () => void;
  onNavigateTab: (tab: 'overview' | 'all-zones' | 'notices' | 'delivery' | 'setup') => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  snapshot,
  useFixtures,
  setUseFixtures,
  busyAction,
  onRunBootstrap,
  onRunDryRun,
  onRunCron,
  onNavigateTab,
}) => {
  const { state, boards, secretsStatus, storageBackend, sha } = snapshot;
  const enabledBoards = boards.filter((b) => b.enabled);
  const baselinedCount = enabledBoards.filter(
    (b) => state.boardStatuses[b.boardId]?.baselined
  ).length;
  const failingBoardsCount = enabledBoards.filter(
    (b) =>
      (state.boardStatuses[b.boardId]?.consecutiveFetchFailures || 0) > 0 ||
      (state.boardStatuses[b.boardId]?.consecutiveParserFailures || 0) > 0
  ).length;

  const knownCount = Object.keys(state.knownNotices).length;
  const pendingCount = Object.keys(state.pendingDeliveries).length;
  const uncertainCount = Object.keys(state.uncertainDeliveries).length;
  const failedCount = Object.keys(state.failedDeliveries).length;

  return (
    <div className="space-y-8">
      {/* Operational Readiness & Control Bar */}
      <section className="border border-slate-800 bg-slate-900/60 rounded-xl p-6">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 font-mono">
              <span className="whitespace-nowrap">Unified Portal: rrb.indianrailways.gov.in</span>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">{enabledBoards.length} Monitored Boards</span>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">Schedule: Every 10m IST</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-50 tracking-tight">
              Railway Recruitment Board Official Notice Monitor
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Deterministic SHA-256 notice fingerprinting, initial baseline suppression (zero historical alerts), GitHub Contents API state persistence with HTTP 409 SHA conflict recovery, and fail-closed Telegram Bot delivery.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div
              role="group"
              aria-label="Data source execution mode"
              className="flex items-center p-1 bg-slate-950 border border-slate-800 rounded-lg"
            >
              <button
                type="button"
                onClick={() => setUseFixtures(true)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  useFixtures
                    ? 'bg-slate-800 text-slate-50 border border-slate-700 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                Fixture Verification
              </button>
              <button
                type="button"
                onClick={() => setUseFixtures(false)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  !useFixtures
                    ? 'bg-slate-800 text-slate-50 border border-slate-700 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                Live Network Probe
              </button>
            </div>

            <button
              type="button"
              onClick={onRunBootstrap}
              disabled={busyAction !== null}
              className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-2 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              {busyAction === 'bootstrap'
                ? 'Establishing Baseline...'
                : state.initialized
                  ? 'Re-Verify Baseline'
                  : '1. Establish Initial Baseline'}
            </button>

            <button
              type="button"
              onClick={onRunDryRun}
              disabled={busyAction !== null}
              className="px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {busyAction === 'dry-run' ? 'Running Dry Run...' : '2. Execute Dry Run'}
            </button>

            <button
              type="button"
              onClick={onRunCron}
              disabled={busyAction !== null}
              className="px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              {busyAction === 'cron' ? 'Running Cron...' : '3. Trigger Cron Scan'}
            </button>
          </div>
        </div>
      </section>

      {/* 4-Column Primary Telemetry Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border border-slate-800 bg-slate-900/40 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Initial Baseline Readiness</span>
            {state.initialized ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            )}
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-50">
            {baselinedCount} / {enabledBoards.length} Boards
          </div>
          <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className={`whitespace-nowrap ${state.initialized ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}`}>
              {state.initialized ? 'Baseline Complete' : 'Baseline Required'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums whitespace-nowrap">0 Historical Alerts</span>
          </div>
        </div>

        <div className="border border-slate-800 bg-slate-900/40 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Fingerprinted Notice Ledger</span>
            <Database className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-50">
            {knownCount} Notices
          </div>
          <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="whitespace-nowrap">SHA-256 Deduplicated</span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => onNavigateTab('notices')}
              className="text-amber-400 hover:underline cursor-pointer whitespace-nowrap"
            >
              Inspect Ledger
            </button>
          </div>
        </div>

        <div className="border border-slate-800 bg-slate-900/40 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Telegram Delivery Queue</span>
            {uncertainCount > 0 || failedCount > 0 ? (
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-50">
            {state.metrics.totalTelegramDelivered} Delivered
          </div>
          <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono tabular-nums">
            <span className="whitespace-nowrap">Pending: {pendingCount}</span>
            <span aria-hidden="true">·</span>
            <span className={`whitespace-nowrap ${uncertainCount > 0 ? 'text-amber-400' : ''}`}>
              Uncertain: {uncertainCount}
            </span>
            <span aria-hidden="true">·</span>
            <span className={`whitespace-nowrap ${failedCount > 0 ? 'text-red-400' : ''}`}>
              Failed: {failedCount}
            </span>
          </div>
        </div>

        <div className="border border-slate-800 bg-slate-900/40 rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>GitHub State & Concurrency</span>
            <Lock className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-50 truncate">
            {storageBackend === 'github' ? 'GitHub API' : 'Local Mirror'}
          </div>
          <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono tabular-nums">
            <span className="whitespace-nowrap">SHA: {sha ? sha.slice(0, 8) : 'none'}</span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">409 Merges: {state.metrics.githubShaConflictsResolved}</span>
          </div>
        </div>
      </section>

      {/* System Architecture & Secrets Readiness + Recent Run Audit */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left 5 columns: Persistent State & Secrets Status */}
        <section className="lg:col-span-5 border border-slate-800 bg-slate-900/40 rounded-xl p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-100">
                01. State Persistence & Secrets Readiness
              </h2>
              <span className="text-xs font-mono text-slate-400">
                Schema v{state.schemaVersion}
              </span>
            </div>

            <div className="divide-y divide-slate-800/80 text-sm">
              <div className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-slate-200">GitHub Contents API Store</div>
                  <div className="text-xs text-slate-400 font-mono truncate max-w-xs">
                    {secretsStatus.githubRepoTarget}
                  </div>
                </div>
                <span
                  className={`text-xs font-mono ${
                    secretsStatus.githubConfigured ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {secretsStatus.githubConfigured ? 'Configured (Live)' : 'Local Mirror Fallback'}
                </span>
              </div>

              <div className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-slate-200">Telegram Bot Credentials</div>
                  <div className="text-xs text-slate-400">
                    TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID
                  </div>
                </div>
                <span
                  className={`text-xs font-mono ${
                    secretsStatus.telegramConfigured ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {secretsStatus.telegramConfigured ? 'Configured' : 'Awaiting Secrets'}
                </span>
              </div>

              <div className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-slate-200">Endpoint Bearer Authentication</div>
                  <div className="text-xs text-slate-400">
                    CRON_AUTH_TOKEN & ADMIN_AUTH_TOKEN
                  </div>
                </div>
                <span className="text-xs font-mono text-emerald-400">
                  {secretsStatus.cronTokenConfigured && secretsStatus.adminTokenConfigured
                    ? 'Custom Secrets Active'
                    : 'Protected (Dev Guard)'}
                </span>
              </div>

              <div className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-slate-200">30s Cron Budget & Batching</div>
                  <div className="text-xs text-slate-400">
                    Resumable queue if runtime approaches 24,000ms
                  </div>
                </div>
                <span className="text-xs font-mono text-slate-300 tabular-nums">
                  {state.resumableScanQueue?.active
                    ? `${state.resumableScanQueue.pendingBoardIds.length} Pending`
                    : 'Idle / Ready'}
                </span>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span> Healthy Boards: {enabledBoards.length - failingBoardsCount}/{enabledBoards.length}</span>
            <button
              type="button"
              onClick={() => onNavigateTab('setup')}
              className="text-amber-400 hover:underline font-medium cursor-pointer"
            >
              View Cron & Secret Setup Guide →
            </button>
          </div>
        </section>

        {/* Right 7 columns: Recent Execution History */}
        <section className="lg:col-span-7 border border-slate-800 bg-slate-900/40 rounded-xl p-6 flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-100">
              02. Durable Execution Audit History
            </h2>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              Total Runs: {state.metrics.totalRuns}
            </span>
          </div>

          {state.recentRunHistory.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-10 border border-dashed border-slate-800 rounded-lg p-6">
              <Clock className="w-6 h-6 text-slate-500 mb-2" />
              <p className="text-sm font-medium text-slate-300">
                No execution runs recorded yet
              </p>
              <p className="text-xs text-slate-400 max-w-md mt-1 mb-4">
                Start by clicking "1. Establish Initial Baseline" to fingerprint all 22 official RRB boards with zero historical Telegram alerts.
              </p>
              <button
                type="button"
                onClick={onRunBootstrap}
                disabled={busyAction !== null}
                className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
              >
                Establish Initial Baseline Now
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 pr-3 font-medium">Run ID & Mode</th>
                    <th className="py-2.5 px-3 font-medium">Status</th>
                    <th className="py-2.5 px-3 font-medium text-right">Boards</th>
                    <th className="py-2.5 px-3 font-medium text-right">Notices</th>
                    <th className="py-2.5 px-3 font-medium text-right">New / Sent</th>
                    <th className="py-2.5 pl-3 font-medium text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                  {state.recentRunHistory.slice(0, 6).map((run) => (
                    <tr key={run.runId} className="hover:bg-slate-800/30">
                      <td className="py-2.5 pr-3">
                        <div className="text-slate-200 font-medium">{run.mode.toUpperCase()}</div>
                        <div className="text-[11px] text-slate-400 truncate max-w-[160px]">
                          {run.runId}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={
                            run.status === 'SUCCESS'
                              ? 'text-emerald-400'
                              : run.status === 'PARTIAL_BATCH'
                                ? 'text-amber-400'
                                : 'text-red-400'
                          }
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        {run.boardsSucceeded}/{run.boardsScanned}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        {run.noticesFound}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="text-amber-300">{run.newNoticesEligible}</span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-emerald-400">{run.messagesDelivered}</span>
                      </td>
                      <td className="py-2.5 pl-3 text-right text-slate-400">
                        {run.durationMs}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {state.recentErrors.length > 0 && (
            <div className="pt-3 border-t border-slate-800">
              <div className="text-xs font-medium text-amber-400 mb-1.5 flex items-center gap-1.5">
                <XCircle className="w-3.5 h-3.5" />
                <span>Latest Isolated Diagnostic Event ({state.recentErrors.length} total)</span>
              </div>
              <div className="text-xs font-mono text-slate-300 bg-slate-950/80 border border-slate-800 rounded p-2.5">
                [{state.recentErrors[0].stage}] {state.recentErrors[0].boardId || 'SYSTEM'} —{' '}
                {state.recentErrors[0].category}: {state.recentErrors[0].message}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
