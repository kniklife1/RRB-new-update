import React, { useEffect, useState, useCallback } from 'react';
import type {
  ActiveTab,
  AllZonesTestSummary,
  DashboardSnapshot,
  DedicatedTelegramTestReport,
  ZoneTestReport,
} from './types/client.ts';
import { OverviewTab } from './components/OverviewTab.tsx';
import { AllZonesTab } from './components/AllZonesTab.tsx';
import { NoticeLedgerTab } from './components/NoticeLedgerTab.tsx';
import { DeliveryTelegramTab } from './components/DeliveryTelegramTab.tsx';
import { SetupRecoveryTab } from './components/SetupRecoveryTab.tsx';

const DEFAULT_DEV_ADMIN_TOKEN = 'rrb-monitor-dev-admin-secret-2026';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [useFixtures, setUseFixtures] = useState<boolean>(true);
  const [bearerToken, setBearerToken] = useState<string>(DEFAULT_DEV_ADMIN_TOKEN);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const [allZonesSummary, setAllZonesSummary] = useState<AllZonesTestSummary | null>(null);
  const [selectedZoneReport, setSelectedZoneReport] = useState<ZoneTestReport | null>(null);
  const [telegramTestReport, setTelegramTestReport] =
    useState<DedicatedTelegramTestReport | null>(null);

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/snapshot');
      const data = (await res.json()) as DashboardSnapshot;
      if (data.ok) {
        setSnapshot(data);
      }
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: `Failed to load monitor snapshot: ${(err as Error).message}`,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${bearerToken}`,
  };

  const handleRunBootstrap = async () => {
    setBusyAction('bootstrap');
    setBannerMessage(null);
    try {
      const res = await fetch('/api/admin/bootstrap', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ useFixtures }),
      });
      const data = await res.json();
      if (!res.ok && res.status === 401) {
        setBannerMessage({ type: 'error', text: data.error || 'Unauthorized request.' });
      } else {
        setBannerMessage({
          type: data.initialized ? 'success' : 'warning',
          text: data.message || 'Baseline bootstrap finished.',
        });
      }
      await fetchSnapshot();
    } catch (err) {
      setBannerMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunDryRun = async () => {
    setBusyAction('dry-run');
    setBannerMessage(null);
    try {
      const res = await fetch('/api/admin/dry-run', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ useFixtures }),
      });
      const data = await res.json();
      setBannerMessage({
        type: res.ok ? 'success' : 'warning',
        text: data.summary || data.error || 'Dry run completed.',
      });
      await fetchSnapshot();
    } catch (err) {
      setBannerMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunCron = async () => {
    setBusyAction('cron');
    setBannerMessage(null);
    try {
      const res = await fetch('/api/cron/run', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ useFixtures }),
      });
      const data = await res.json();
      setBannerMessage({
        type: data.status === 'SUCCESS' ? 'success' : 'warning',
        text: data.summary || data.error || 'Cron execution completed.',
      });
      await fetchSnapshot();
    } catch (err) {
      setBannerMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunAllZones = async (sendTelegramSummary: boolean) => {
    setBusyAction('all-zones');
    setBannerMessage(null);
    try {
      const res = await fetch('/api/test/all-zones', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          useFixtures,
          sendTelegramTestSummary: sendTelegramSummary,
        }),
      });
      const data = await res.json();
      if (res.status === 401) {
        setBannerMessage({ type: 'error', text: data.error || 'Unauthorized.' });
        return;
      }
      setAllZonesSummary(data);
      setBannerMessage({
        type: data.counts?.FAIL === 0 ? 'success' : 'warning',
        text: `All-Zones Test completed (${data.dataSourceMode}): ${data.counts?.PASS || 0} PASS, ${data.counts?.PARTIAL || 0} PARTIAL, ${data.counts?.FAIL || 0} FAIL (${data.durationMs}ms).`,
      });
    } catch (err) {
      setBannerMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunSingleZone = async (boardId: string) => {
    setBusyAction(`zone-${boardId}`);
    try {
      const res = await fetch('/api/test/zone', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ boardId, useFixtures }),
      });
      const data = await res.json();
      if (data.report) {
        setSelectedZoneReport(data.report);
      }
    } catch (err) {
      setBannerMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunTelegramTest = async (sendTestMessage: boolean) => {
    setBusyAction('telegram-test');
    setBannerMessage(null);
    try {
      const res = await fetch('/api/test/telegram', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ sendTestMessage }),
      });
      const data = await res.json();
      if (data.report) {
        setTelegramTestReport(data.report);
        setBannerMessage({
          type: data.ok ? 'success' : 'warning',
          text: data.report.diagnosticMessage,
        });
      }
    } catch (err) {
      setBannerMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleInjectCandidateNotice = async (payload: {
    boardId: string;
    noticeCode: string;
    title: string;
    publicationDate: string;
    category: string;
  }) => {
    setBusyAction('inject-notice');
    try {
      const res = await fetch('/api/admin/inject-fixture-notice', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setBannerMessage({
        type: res.ok ? 'success' : 'error',
        text: data.message || data.error,
      });
    } catch (err) {
      setBannerMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleReconcileDelivery = async (
    deliveryId: string,
    resolution: 'mark_sent' | 'requeue_retry'
  ) => {
    setBusyAction(`reconcile-${deliveryId}`);
    try {
      const res = await fetch('/api/admin/reconcile', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ deliveryId, resolution }),
      });
      const data = await res.json();
      setBannerMessage({
        type: res.ok ? 'success' : 'error',
        text: res.ok
          ? `Reconciled uncertain delivery ${deliveryId} as ${resolution}.`
          : data.error,
      });
      await fetchSnapshot();
    } catch (err) {
      setBannerMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleResetBaseline = async (
    preserveDeliveredFingerprints: boolean,
    confirmation: string
  ) => {
    setBusyAction('reset');
    try {
      const res = await fetch('/api/admin/reset-baseline', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ preserveDeliveredFingerprints, confirmation }),
      });
      const data = await res.json();
      setBannerMessage({
        type: res.ok ? 'warning' : 'error',
        text: data.message || data.error,
      });
      await fetchSnapshot();
    } catch (err) {
      setBannerMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setBusyAction(null);
    }
  };

  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'all-zones', label: 'All-Zones Test' },
    { id: 'notices', label: 'Notice Ledger' },
    { id: 'delivery', label: 'Delivery & Telegram' },
    { id: 'setup', label: 'Setup & Recovery' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800 bg-slate-950/90 sticky top-0 z-30 backdrop-blur">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('overview');
          }}
          className="text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0"
        >
          RRB Notice Monitor
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav
          aria-label="Primary sections"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400"
        >
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                activeTab === item.id
                  ? 'text-slate-50 border-amber-500 font-semibold'
                  : 'border-transparent hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={
              snapshot?.state.initialized ? handleRunDryRun : handleRunBootstrap
            }
            disabled={busyAction !== null}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {snapshot?.state.initialized
              ? 'Execute Dry Run'
              : 'Initialize Baseline'}
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Responsive Mobile Navigation Bar */}
        <nav
          aria-label="Mobile sections"
          className="flex md:hidden items-center gap-2 overflow-x-auto pb-2 border-b border-slate-800"
        >
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === item.id
                  ? 'bg-slate-800 text-amber-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        {/* Bearer Token Bar & Feedback Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-800/80 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <label htmlFor="bearer-secret-input" className="font-medium text-slate-300">
              API Bearer Token:
            </label>
            <input
              id="bearer-secret-input"
              type="password"
              value={bearerToken}
              onChange={(e) => setBearerToken(e.target.value)}
              className="px-2.5 py-1 font-mono text-xs bg-slate-900 border border-slate-800 rounded text-slate-200 w-56 focus:outline-none focus:border-amber-500"
            />
          </div>

          {bannerMessage && (
            <div
              role="status"
              className={`font-mono text-xs ${
                bannerMessage.type === 'success'
                  ? 'text-emerald-400'
                  : bannerMessage.type === 'warning'
                    ? 'text-amber-400'
                    : 'text-red-400'
              }`}
            >
              {bannerMessage.text}
            </div>
          )}
        </div>

        {loading || !snapshot ? (
          <div className="space-y-4 py-12">
            <div className="h-28 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="h-24 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse" />
              <div className="h-24 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse" />
              <div className="h-24 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse" />
              <div className="h-24 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse" />
            </div>
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <OverviewTab
                snapshot={snapshot}
                useFixtures={useFixtures}
                setUseFixtures={setUseFixtures}
                busyAction={busyAction}
                onRunBootstrap={handleRunBootstrap}
                onRunDryRun={handleRunDryRun}
                onRunCron={handleRunCron}
                onNavigateTab={setActiveTab}
              />
            )}

            {activeTab === 'all-zones' && (
              <AllZonesTab
                boards={snapshot.boards}
                useFixtures={useFixtures}
                setUseFixtures={setUseFixtures}
                allZonesSummary={allZonesSummary}
                selectedZoneReport={selectedZoneReport}
                busyAction={busyAction}
                onRunAllZones={handleRunAllZones}
                onRunSingleZone={handleRunSingleZone}
              />
            )}

            {activeTab === 'notices' && (
              <NoticeLedgerTab
                boards={snapshot.boards}
                state={snapshot.state}
                busyAction={busyAction}
                onInjectCandidateNotice={handleInjectCandidateNotice}
              />
            )}

            {activeTab === 'delivery' && (
              <DeliveryTelegramTab
                snapshot={snapshot}
                telegramTestReport={telegramTestReport}
                busyAction={busyAction}
                onRunTelegramTest={handleRunTelegramTest}
                onReconcileDelivery={handleReconcileDelivery}
              />
            )}

            {activeTab === 'setup' && (
              <SetupRecoveryTab
                busyAction={busyAction}
                onResetBaseline={handleResetBaseline}
              />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-slate-900 px-6 py-4 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2 max-w-7xl w-full mx-auto">
        <span>
          RRB Official Notice Monitor v2.1.0 · Unified Portal (rrb.indianrailways.gov.in) & 21 Regional Boards
        </span>
        <div className="flex items-center gap-4">
          <a
            href="/rrb-notice-monitor-v2.1.0.zip"
            download="rrb-notice-monitor-v2.1.0.zip"
            className="text-emerald-400 hover:text-emerald-300 font-mono font-medium"
          >
            Download rrb-notice-monitor-v2.1.0.zip
          </a>
          <a
            href="/health"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-300 font-mono"
          >
            GET /health JSON
          </a>
        </div>
      </footer>
    </div>
  );
}

export default App;
