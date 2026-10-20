import React, { useState } from 'react';
import {
  Send,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import type {
  DashboardSnapshot,
  DedicatedTelegramTestReport,
} from '../types/client.ts';

interface DeliveryTelegramTabProps {
  snapshot: DashboardSnapshot;
  telegramTestReport: DedicatedTelegramTestReport | null;
  busyAction: string | null;
  onRunTelegramTest: (sendTestMessage: boolean) => void;
  onReconcileDelivery: (
    deliveryId: string,
    resolution: 'mark_sent' | 'requeue_retry'
  ) => void;
}

export const DeliveryTelegramTab: React.FC<DeliveryTelegramTabProps> = ({
  snapshot,
  telegramTestReport,
  busyAction,
  onRunTelegramTest,
  onReconcileDelivery,
}) => {
  const [sendRealTestMsg, setSendRealTestMsg] = useState(true);
  const { state, sampleTelegramPreview, secretsStatus } = snapshot;

  const pendingItems = Object.values(state.pendingDeliveries);
  const uncertainItems = Object.values(state.uncertainDeliveries);
  const failedItems = Object.values(state.failedDeliveries);
  const allQueueItems = [...uncertainItems, ...pendingItems, ...failedItems];

  return (
    <div className="space-y-6">
      {/* Dedicated Telegram Connectivity Tester (Section 12) */}
      <section className="border border-slate-800 bg-slate-900/60 rounded-xl p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h2 className="text-lg font-bold text-slate-50">
              Dedicated Telegram Connectivity Test & Delivery Queue
            </h2>
            <p className="text-xs text-slate-400">
              Verifies TELEGRAM_BOT_TOKEN via getMe and optionally dispatches an unmistakable [TEST] message without altering any production notice fingerprint.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={sendRealTestMsg}
                onChange={(e) => setSendRealTestMsg(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-amber-500"
              />
              <span>Send [TEST] Message to Chat</span>
            </label>

            <button
              type="button"
              onClick={() => onRunTelegramTest(sendRealTestMsg)}
              disabled={busyAction !== null}
              className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              {busyAction === 'telegram-test'
                ? 'Testing Telegram API...'
                : 'Run Dedicated Telegram Test'}
            </button>
          </div>
        </div>

        {telegramTestReport && (
          <div className="pt-4 border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
              <div className="text-slate-400">Credentials & Bot Validation</div>
              <div
                className={
                  telegramTestReport.botValidated ? 'text-emerald-400 font-semibold' : 'text-amber-400'
                }
              >
                {telegramTestReport.botValidated
                  ? `Verified (@${telegramTestReport.botUsername})`
                  : 'Credentials Not Configured'}
              </div>
              <div className="text-slate-500">
                Production State Modified: {String(telegramTestReport.productionStateModified)}
              </div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
              <div className="text-slate-400">Message Dispatch Status</div>
              <div
                className={
                  telegramTestReport.testMessageSent
                    ? 'text-emerald-400 font-semibold'
                    : 'text-slate-300'
                }
              >
                {telegramTestReport.testMessageSent
                  ? `Sent (message_id: ${telegramTestReport.telegramMessageId})`
                  : telegramTestReport.errorCategory || 'Not Dispatched'}
              </div>
              <div className="text-slate-500">{telegramTestReport.testedAtIST}</div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
              <div className="text-slate-400">Diagnostic Output</div>
              <div className="text-slate-200 break-words">
                {telegramTestReport.diagnosticMessage}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Two-Column Split: Global Delivery Queue & Formatted Telegram Message Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Global Delivery Queue & Uncertain Delivery Reconciliation */}
        <section className="lg:col-span-7 border border-slate-800 bg-slate-900/40 rounded-xl p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">
                Global Delivery Queue & Uncertain Reconciliation
              </h3>
              <span className="text-xs font-mono text-slate-400 tabular-nums">
                Delivered Total: {state.metrics.totalTelegramDelivered}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Items timed out after HTTP dispatch are placed in UNCERTAIN state and never blindly retried until reconciled.
            </p>
          </div>

          {allQueueItems.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-10 border border-dashed border-slate-800 rounded-lg p-6">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 mb-2" />
              <p className="text-sm font-medium text-slate-200">
                Delivery queue is clean (0 pending, 0 uncertain, 0 failed)
              </p>
              <p className="text-xs text-slate-400 max-w-md mt-1">
                When a new eligible RRB notice is discovered during a post-baseline scan, its atomic claim and delivery status appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800 text-xs">
              {allQueueItems.map((item) => (
                <div key={item.deliveryId} className="py-3.5 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-100">
                        [{item.boardName}] {item.title}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 flex items-center gap-2 mt-0.5">
                        <span>ID: {item.deliveryId}</span>
                        <span aria-hidden="true">·</span>
                        <span>Attempts: {item.attemptCount}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            item.status === 'uncertain'
                              ? 'text-amber-400 font-semibold'
                              : item.status === 'failed'
                                ? 'text-red-400 font-semibold'
                                : 'text-sky-400'
                          }
                        >
                          Status: {item.status.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    {item.status === 'uncertain' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onReconcileDelivery(item.deliveryId, 'mark_sent')}
                          className="px-2.5 py-1 text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded cursor-pointer"
                        >
                          Confirm Sent
                        </button>
                        <button
                          type="button"
                          onClick={() => onReconcileDelivery(item.deliveryId, 'requeue_retry')}
                          className="px-2.5 py-1 text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded cursor-pointer flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Requeue
                        </button>
                      </div>
                    )}
                  </div>

                  {item.lastError && (
                    <div className="text-[11px] font-mono text-amber-300 bg-slate-950 p-2 rounded border border-slate-800">
                      {item.lastError}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Bot Token Configured: {secretsStatus.telegramConfigured ? 'YES' : 'NO'}</span>
            <span>Parse Mode: HTML (Escaped)</span>
          </div>
        </section>

        {/* Formatted Production Telegram Message Preview */}
        <section className="lg:col-span-5 border border-slate-800 bg-slate-900/40 rounded-xl p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-100">
              Production Alert Payload Preview (Section 9 Format)
            </h3>
            <p className="text-xs text-slate-400">
              Exact HTML-escaped payload generated from validated notice metadata.
            </p>
          </div>

          <pre className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-4 text-xs font-mono text-slate-200 whitespace-pre-wrap overflow-x-auto leading-relaxed">
            {sampleTelegramPreview ||
              `🚆 <b>NEW RRB OFFICIAL NOTICE</b>\n\n<b>Board:</b> RRCB / Unified Central Portal (All-India CEN)\n<b>Category:</b> Exam Schedule & City Intimation\n<b>Title:</b> CEN 04/2026 (NTPC Graduate & Undergraduate): Notice on Tentative 1st Stage CBT Schedule & City Intimation Link\n<b>Publication Date:</b> 2026-10-19\n\n<b>Official Notice:</b>\nhttps://rrb.indianrailways.gov.in/cen-2026/CEN_04_2026_CBT1_Schedule_Notice.pdf\n\n<b>PDF / Attachment:</b>\nhttps://rrb.indianrailways.gov.in/cen-2026/CEN_04_2026_CBT1_Schedule_Notice.pdf\n\n<b>Detected At:</b> 20 Oct 2026, 02:30:00 pm IST`}
          </pre>

          <div className="text-[11px] text-slate-400 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              Messages exceeding 4,096 characters are split safely on newline boundaries.
            </span>
          </div>
        </section>
      </div>
    </div>
  );
};
