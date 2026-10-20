import React, { useState } from 'react';
import { Search, PlusCircle, FileText } from 'lucide-react';
import type { BoardConfig, MonitorState } from '../types/client.ts';

interface NoticeLedgerTabProps {
  boards: BoardConfig[];
  state: MonitorState;
  busyAction: string | null;
  onInjectCandidateNotice: (payload: {
    boardId: string;
    noticeCode: string;
    title: string;
    publicationDate: string;
    category: string;
  }) => Promise<void>;
}

export const NoticeLedgerTab: React.FC<NoticeLedgerTabProps> = ({
  boards,
  state,
  busyAction,
  onInjectCandidateNotice,
}) => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Simulator form state for testing end-to-end eligibility
  const [simBoardId, setSimBoardId] = useState('RRB_CENTRAL');
  const [simCode, setSimCode] = useState('CEN 06/2026');
  const [simTitle, setSimTitle] = useState(
    'CEN 06/2026 (NTPC): Declaration of CBT-1 Final Result & Cut-Off Marks'
  );
  const [simDate, setSimDate] = useState(new Date().toISOString().slice(0, 10));
  const [simCategory, setSimCategory] = useState('Result & Cut-Off Marks');

  const notices = Object.values(state.knownNotices).sort((a, b) =>
    (b.publicationDate || '').localeCompare(a.publicationDate || '')
  );

  const categories = Array.from(new Set(notices.map((n) => n.category)));

  const filtered = notices.filter((n) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      n.title.toLowerCase().includes(q) ||
      n.boardName.toLowerCase().includes(q) ||
      n.noticeId.toLowerCase().includes(q) ||
      n.fingerprint.toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (categoryFilter !== 'ALL' && n.category !== categoryFilter) return false;
    if (statusFilter !== 'ALL' && n.deliveryStatus !== statusFilter) return false;
    return true;
  });

  const handleSubmitInject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simTitle.trim()) return;
    await onInjectCandidateNotice({
      boardId: simBoardId,
      noticeCode: simCode.trim() || 'CEN-NEW',
      title: simTitle.trim(),
      publicationDate: simDate,
      category: simCategory,
    });
  };

  return (
    <div className="space-y-6">
      {/* New Notice Eligibility Simulator (Fixture Test Bench) */}
      <section className="border border-slate-800 bg-slate-900/60 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-50">
              Candidate Notice Eligibility Simulator (Fixture Test Bench)
            </h2>
            <p className="text-xs text-slate-400">
              Stage a new or older-dated notice on any board's fixture feed, then run a Dry Run or Cron Scan to verify the 9 eligibility rules, quarantine policy, and deduplication.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400 tabular-nums">
            Total Known Fingerprints: {notices.length}
          </span>
        </div>

        <form
          onSubmit={handleSubmitInject}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end pt-2"
        >
          <div className="lg:col-span-3">
            <label
              htmlFor="sim-board"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              Target RRB Board
            </label>
            <select
              id="sim-board"
              value={simBoardId}
              onChange={(e) => setSimBoardId(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
            >
              {boards.map((b) => (
                <option key={b.boardId} value={b.boardId}>
                  {b.boardName} ({b.zoneCode})
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="sim-date"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              Publication Date
            </label>
            <input
              id="sim-date"
              type="date"
              value={simDate}
              onChange={(e) => setSimDate(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="sim-code"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              Notice / CEN Code
            </label>
            <input
              id="sim-code"
              type="text"
              value={simCode}
              onChange={(e) => setSimCode(e.target.value)}
              required
              className="w-full px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="lg:col-span-3">
            <label
              htmlFor="sim-title"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              Official Notice Title
            </label>
            <input
              id="sim-title"
              type="text"
              value={simTitle}
              onChange={(e) => setSimTitle(e.target.value)}
              required
              className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="lg:col-span-2">
            <button
              type="submit"
              disabled={busyAction !== null}
              className="w-full px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Stage in Feed</span>
            </button>
          </div>
        </form>
      </section>

      {/* Search & Filters */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            aria-label="Search fingerprinted notices"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by notice title, board, noticeId, or SHA-256 fingerprint..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter notices by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200"
          >
            <option value="ALL">All Categories ({notices.length})</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter notices by delivery status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 font-mono"
          >
            <option value="ALL">All Delivery Statuses</option>
            <option value="suppressed_baseline">suppressed_baseline</option>
            <option value="sent">sent</option>
            <option value="pending">pending</option>
            <option value="uncertain">uncertain</option>
            <option value="failed">failed</option>
            <option value="quarantined">quarantined</option>
            <option value="suppressed_duplicate">suppressed_duplicate</option>
          </select>
        </div>
      </section>

      {/* Notice Ledger Table */}
      <section className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 px-6 text-center space-y-2">
            <p className="text-sm font-medium text-slate-300">
              No normalized notices match the current filter
            </p>
            <p className="text-xs text-slate-500">
              Establish the initial baseline on the Overview tab to populate all 22 RRB boards.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                  <th className="py-3 pl-5 pr-3 font-medium">Board & Notice ID</th>
                  <th className="py-3 px-3 font-medium">Title & Category</th>
                  <th className="py-3 px-3 font-medium">Pub Date</th>
                  <th className="py-3 px-3 font-medium">Baseline & Delivery Status</th>
                  <th className="py-3 px-3 font-medium">SHA-256 Fingerprint</th>
                  <th className="py-3 pl-3 pr-5 font-medium text-right">Document</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filtered.map((n) => (
                  <tr key={n.noticeId} className="hover:bg-slate-800/35">
                    <td className="py-3 pl-5 pr-3 whitespace-nowrap">
                      <div className="font-semibold text-slate-100">{n.boardName}</div>
                      <div className="text-[11px] font-mono text-slate-400">{n.noticeId}</div>
                    </td>

                    <td className="py-3 px-3 max-w-md">
                      <div className="text-slate-100 font-medium line-clamp-2">{n.title}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                        <span>{n.category}</span>
                        {n.revisionNumber && n.revisionNumber > 1 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-400 font-mono">
                              Revision #{n.revisionNumber}
                            </span>
                          </>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-3 font-mono tabular-nums whitespace-nowrap">
                      <div className="text-slate-200">{n.publicationDate || 'MISSING'}</div>
                      <div className="text-[11px] text-slate-500">
                        Conf: {n.publicationDateConfidence}
                      </div>
                    </td>

                    <td className="py-3 px-3 font-mono whitespace-nowrap">
                      <div
                        className={
                          n.deliveryStatus === 'sent'
                            ? 'text-emerald-400 font-medium'
                            : n.deliveryStatus === 'suppressed_baseline'
                              ? 'text-slate-300'
                              : n.deliveryStatus === 'quarantined' ||
                                  n.deliveryStatus === 'uncertain'
                                ? 'text-amber-400 font-medium'
                                : 'text-red-400'
                        }
                      >
                        {n.deliveryStatus}
                      </div>
                      <div className="text-[11px] text-slate-500">{n.baselineStatus}</div>
                    </td>

                    <td className="py-3 px-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                      <div>fp: {n.fingerprint.slice(0, 14)}…</div>
                      <div className="text-slate-500">ch: {n.contentHash.slice(0, 14)}…</div>
                    </td>

                    <td className="py-3 pl-3 pr-5 text-right whitespace-nowrap">
                      <a
                        href={n.officialNoticeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-amber-400 hover:underline font-mono text-[11px]"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Official PDF</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
