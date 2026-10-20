import React, { useState } from 'react';
import { ShieldAlert, RotateCcw, CheckCircle2 } from 'lucide-react';

interface SetupRecoveryTabProps {
  busyAction: string | null;
  onResetBaseline: (preserveDeliveredFingerprints: boolean, confirmation: string) => Promise<void>;
}

export const SetupRecoveryTab: React.FC<SetupRecoveryTabProps> = ({
  busyAction,
  onResetBaseline,
}) => {
  const [confirmText, setConfirmText] = useState('');
  const [preserveFingerprints, setPreserveFingerprints] = useState(true);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    await onResetBaseline(preserveFingerprints, confirmText.trim());
    setConfirmText('');
  };

  return (
    <div className="space-y-6">
      {/* Production Release ZIP Package Download */}
      <section className="border border-emerald-500/30 bg-emerald-950/20 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-slate-50">
            Production Release Package — rrb-notice-monitor-v2.1.0.zip
          </h2>
          <p className="text-xs text-slate-300">
            Complete audited v2.1.0 project archive including <code className="font-mono text-emerald-300">.github/workflows/monitor.yml</code>, standalone CLI runner (<code className="font-mono text-emerald-300">scripts/run-monitor.ts</code>), 22-board configs, <code className="font-mono text-emerald-300">Dockerfile</code>, and all 37 automated tests (excludes secrets, .env, and node_modules).
          </p>
        </div>
        <a
          href="/rrb-notice-monitor-v2.1.0.zip"
          download="rrb-notice-monitor-v2.1.0.zip"
          className="px-4 py-2.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors whitespace-nowrap shrink-0 text-center"
        >
          Download ZIP Archive (v2.1.0)
        </a>
      </section>

      {/* Cron-Job.org 10-Minute IST Configuration */}
      <section className="border border-slate-800 bg-slate-900/60 rounded-xl p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-slate-50">
            01. Every-10-Minute Scheduler Configuration (cron-job.org)
          </h2>
          <p className="text-xs text-slate-400">
            Configure cron-job.org in the Asia/Kolkata time zone to invoke the authenticated production endpoint every 10 minutes.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2 font-mono">
            <div className="text-slate-400 font-sans font-medium">HTTP Request Specification</div>
            <div>
              <span className="text-slate-500">Endpoint:</span>{' '}
              <span className="text-amber-400">POST /api/cron/run</span>
            </div>
            <div>
              <span className="text-slate-500">Schedule:</span>{' '}
              <span className="text-slate-200">*/10 * * * * (Every 10 minutes)</span>
            </div>
            <div>
              <span className="text-slate-500">Time Zone:</span>{' '}
              <span className="text-slate-200">Asia/Kolkata (IST)</span>
            </div>
            <div>
              <span className="text-slate-500">Header 1:</span>{' '}
              <span className="text-slate-200">Authorization: Bearer YOUR_CRON_AUTH_TOKEN</span>
            </div>
            <div>
              <span className="text-slate-500">Header 2:</span>{' '}
              <span className="text-slate-200">Content-Type: application/json</span>
            </div>
            <div>
              <span className="text-slate-500">Body:</span>{' '}
              <span className="text-slate-200">{'{"mode":"production"}'}</span>
            </div>
          </div>

          <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
            <div className="text-slate-200 font-medium">
              30-Second Timeout & Resumable Batch Guarantees
            </div>
            <p className="text-slate-400 leading-relaxed">
              Because cron-job.org enforces an ~30-second execution timeout, <code className="font-mono text-slate-200">CRON_EXECUTION_BUDGET_MS</code> defaults to <code className="font-mono text-slate-200">24000ms</code>. If live NIC servers respond slowly, the engine checkpoints completed boards to GitHub, returns <code className="font-mono text-amber-400">HTTP 206 Partial Content</code> (<code className="font-mono">PARTIAL_BATCH</code>), and resumes from <code className="font-mono text-slate-200">resumableScanQueue</code> on the next trigger.
            </p>
            <p className="text-slate-400 leading-relaxed">
              Older Publication Date Policy (<code className="font-mono text-slate-200">OLDER_PUBLICATION_DATE_POLICY=quarantine</code>): Any newly observed notice whose official publication date predates the board's watermark or exceeds 14 days is recorded with <code className="font-mono text-amber-400">QUARANTINED_OLD_DATE</code> for review rather than triggering a false alert.
            </p>
          </div>
        </div>
      </section>

      {/* Security Checklist & Administrative Reset */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <section className="lg:col-span-6 border border-slate-800 bg-slate-900/40 rounded-xl p-6 space-y-4">
          <h3 className="text-base font-semibold text-slate-100">
            02. Production Security & Reliability Checklist
          </h3>
          <ul className="space-y-2.5 text-xs text-slate-300">
            {[
              'Server-side execution only: zero scraping or token usage in browser code.',
              'Constant-time bearer secret verification (crypto.timingSafeEqual) on all action endpoints.',
              'SSRF allowlist restricts outbound fetches and redirects strictly to 23 official RRB domains.',
              'Initial baseline records historical notices with zero individual Telegram alerts.',
              'GitHub Contents API updates use file SHA and resolve HTTP 409 conflicts via deterministic state merge.',
              'Fail-closed architecture: if state read or pre-delivery checkpoint write fails, zero alerts are sent.',
              'Post-transmission Telegram timeouts enter UNCERTAIN state and are never blindly retried.',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="lg:col-span-6 border border-slate-800 bg-slate-900/40 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-amber-400">
            <ShieldAlert className="w-4 h-4" />
            <h3 className="text-base font-semibold text-slate-100">
              03. Administrative Baseline Reset Procedure
            </h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Resetting the baseline marks <code className="font-mono text-slate-200">initialized: false</code> so you can re-run <code className="font-mono text-slate-200">POST /api/admin/bootstrap</code>. Keep "Preserve historical delivered fingerprints" checked so previously delivered notices can never be resent.
          </p>

          <form onSubmit={handleReset} className="space-y-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={preserveFingerprints}
                onChange={(e) => setPreserveFingerprints(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-amber-500"
              />
              <span>Preserve historical delivered notice fingerprints (Recommended)</span>
            </label>

            <div>
              <label
                htmlFor="reset-confirm-input"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Type <code className="font-mono text-amber-400">CONFIRM_BASELINE_RESET</code> to authorize:
              </label>
              <input
                id="reset-confirm-input"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="CONFIRM_BASELINE_RESET"
                className="w-full px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
              />
            </div>

            <button
              type="submit"
              disabled={busyAction !== null || confirmText.trim() !== 'CONFIRM_BASELINE_RESET'}
              className="px-4 py-2 text-xs font-semibold bg-red-500/20 hover:bg-red-500/30 disabled:opacity-40 text-red-300 border border-red-500/40 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Execute Authorized Baseline Reset</span>
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};
