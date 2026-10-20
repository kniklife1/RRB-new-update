import React, { useState } from 'react';
import {
  Play,
  Search,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
} from 'lucide-react';
import type {
  AllZonesTestSummary,
  BoardConfig,
  ZoneTestReport,
} from '../types/client.ts';

interface AllZonesTabProps {
  boards: BoardConfig[];
  useFixtures: boolean;
  setUseFixtures: (v: boolean) => void;
  allZonesSummary: AllZonesTestSummary | null;
  selectedZoneReport: ZoneTestReport | null;
  busyAction: string | null;
  onRunAllZones: (sendTelegramSummary: boolean) => void;
  onRunSingleZone: (boardId: string) => void;
}

export const AllZonesTab: React.FC<AllZonesTabProps> = ({
  boards,
  useFixtures,
  setUseFixtures,
  allZonesSummary,
  selectedZoneReport,
  busyAction,
  onRunAllZones,
  onRunSingleZone,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [verdictFilter, setVerdictFilter] = useState<string>('ALL');
  const [sendTelegramSummary, setSendTelegramSummary] = useState(false);

  const reportByBoardId: Record<string, ZoneTestReport> = {};
  if (allZonesSummary) {
    for (const r of allZonesSummary.reports) {
      reportByBoardId[r.boardId] = r;
    }
  }
  if (selectedZoneReport) {
    reportByBoardId[selectedZoneReport.boardId] = selectedZoneReport;
  }

  const filteredBoards = boards.filter((board) => {
    const q = searchQuery.trim().toLowerCase();
    const report = reportByBoardId[board.boardId];
    const matchesSearch =
      !q ||
      board.boardName.toLowerCase().includes(q) ||
      board.boardId.toLowerCase().includes(q) ||
      board.zoneCode.toLowerCase().includes(q) ||
      board.headquarters.toLowerCase().includes(q) ||
      (report?.latestParsedNoticeTitle || '').toLowerCase().includes(q);

    if (!matchesSearch) return false;
    if (verdictFilter === 'ALL') return true;
    return report?.verdict === verdictFilter;
  });

  return (
    <div className="space-y-6">
      {/* All-Zones Control Header */}
      <section className="border border-slate-800 bg-slate-900/60 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-slate-50">
              All-Zones Official Portal & Regional RRB Verification Suite
            </h2>
            <p className="text-xs text-slate-400">
              Tests all 22 configured RRB sources (Unified Portal + 21 Regional Boards), verifies DOM/JSON parsers, extracts latest notice metadata, and never marks existing notices as delivered.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div
              role="group"
              aria-label="Test data source mode"
              className="flex items-center p-1 bg-slate-950 border border-slate-800 rounded-lg"
            >
              <button
                type="button"
                onClick={() => setUseFixtures(true)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  useFixtures
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                Deterministic Fixtures
              </button>
              <button
                type="button"
                onClick={() => setUseFixtures(false)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  !useFixtures
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                Live Network Fetch
              </button>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none px-2">
              <input
                type="checkbox"
                checked={sendTelegramSummary}
                onChange={(e) => setSendTelegramSummary(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-amber-500"
              />
              <span>Send [TEST] Summary to Telegram</span>
            </label>

            <button
              type="button"
              onClick={() => onRunAllZones(sendTelegramSummary)}
              disabled={busyAction !== null}
              className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              {busyAction === 'all-zones'
                ? 'Testing All 22 Boards...'
                : 'Run All-Zones Verification'}
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              aria-label="Search RRB boards or latest notice titles"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by board name, zone code (e.g. MAS, SC), or notice title..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg overflow-x-auto">
            {(['ALL', 'PASS', 'PARTIAL', 'FAIL', 'BLOCKED'] as const).map((status) => {
              const count =
                status === 'ALL'
                  ? boards.length
                  : allZonesSummary
                    ? allZonesSummary.counts[status]
                    : 0;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => setVerdictFilter(status)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer font-mono tabular-nums ${
                    verdictFilter === status
                      ? 'bg-slate-800 text-amber-400 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {status} ({count})
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Selected Single-Zone Deep Inspector Drawer */}
      {selectedZoneReport && (
        <section
          aria-label="Selected zone detailed diagnostic report"
          className="border border-amber-500/40 bg-slate-900/90 rounded-xl p-6 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <div className="text-xs font-mono text-amber-400">
                Single-Zone Deep Diagnostic Report · {selectedZoneReport.boardId}
              </div>
              <h3 className="text-lg font-bold text-slate-50">
                {selectedZoneReport.boardName}
              </h3>
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-300 flex items-center gap-2">
              <span>Verdict: {selectedZoneReport.verdict}</span>
              <span aria-hidden="true">·</span>
              <span>HTTP: {selectedZoneReport.httpStatus ?? 'N/A'}</span>
              <span aria-hidden="true">·</span>
              <span>Duration: {selectedZoneReport.fetchDurationMs}ms</span>
              <span aria-hidden="true">·</span>
              <span>Size: {selectedZoneReport.responseSizeBytes} B</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="space-y-1">
              <div className="text-slate-400">Source & Content Type</div>
              <div className="font-mono text-slate-200 break-all">
                {selectedZoneReport.noticesUrl}
              </div>
              <div className="text-slate-400 font-mono">
                Type: {selectedZoneReport.responseContentType || 'N/A'} · Mode:{' '}
                {selectedZoneReport.dataSourceMode}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-slate-400">Parser Telemetry & Pagination</div>
              <div className="font-mono tabular-nums text-slate-200">
                Raw Rows: {selectedZoneReport.rawRowsDetected} · Valid Notices:{' '}
                {selectedZoneReport.validNormalizedNotices} · Inline Dups:{' '}
                {selectedZoneReport.duplicatesFound}
              </div>
              <div className="text-slate-400 font-mono">
                Pagination Checked: {selectedZoneReport.paginationChecked ? 'Yes' : 'No'} ·
                Unexpected DOM: {selectedZoneReport.unexpectedPageStructure ? 'Yes' : 'No'}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-slate-400">Latest Discovered Notice & Confidence</div>
              <div className="text-slate-100 font-medium line-clamp-2">
                {selectedZoneReport.latestParsedNoticeTitle || 'No valid notice parsed'}
              </div>
              <div className="font-mono tabular-nums text-slate-400">
                Date: {selectedZoneReport.newestValidPublicationDate || 'None'} · Confidence:{' '}
                {selectedZoneReport.dateParsingConfidence}
              </div>
            </div>
          </div>

          {selectedZoneReport.sampleNotices.length > 0 && (
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <div className="text-xs font-medium text-slate-300">
                Normalized Notices Extracted from {selectedZoneReport.boardName}:
              </div>
              <div className="divide-y divide-slate-800/70 text-xs">
                {selectedZoneReport.sampleNotices.map((n) => (
                  <div
                    key={n.fingerprint}
                    className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="space-y-0.5">
                      <div className="text-slate-200 font-medium">{n.title}</div>
                      <div className="text-slate-400 font-mono text-[11px] flex items-center gap-2">
                        <span>{n.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>Published: {n.publicationDate || 'N/A'}</span>
                        <span aria-hidden="true">·</span>
                        <span>SHA-256: {n.fingerprint.slice(0, 16)}…</span>
                      </div>
                    </div>
                    <a
                      href={n.officialNoticeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-400 hover:underline font-mono text-[11px] flex items-center gap-1 shrink-0"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Official PDF</span>
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 22-Board High-Density Diagnostic Table */}
      <section className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                <th className="py-3 pl-5 pr-3 font-medium">Board & Zone</th>
                <th className="py-3 px-3 font-medium">Verdict</th>
                <th className="py-3 px-3 font-medium text-right">HTTP / Time</th>
                <th className="py-3 px-3 font-medium text-right">Valid / Raw</th>
                <th className="py-3 px-3 font-medium">Newest Date</th>
                <th className="py-3 px-3 font-medium">Actual Latest Discovered Notice</th>
                <th className="py-3 pl-3 pr-5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredBoards.map((board) => {
                const r = reportByBoardId[board.boardId];
                return (
                  <tr
                    key={board.boardId}
                    className="hover:bg-slate-800/35 transition-colors"
                  >
                    <td className="py-3 pl-5 pr-3">
                      <div className="font-semibold text-slate-100">{board.boardName}</div>
                      <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
                        <span>{board.boardId}</span>
                        <span aria-hidden="true">·</span>
                        <span>{board.zoneCode}</span>
                      </div>
                    </td>

                    <td className="py-3 px-3 font-mono">
                      {!r ? (
                        <span className="text-slate-500">UNTESTED</span>
                      ) : r.verdict === 'PASS' ? (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          PASS
                        </span>
                      ) : r.verdict === 'PARTIAL' ? (
                        <span className="text-amber-400 font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          PARTIAL
                        </span>
                      ) : (
                        <span className="text-red-400 font-semibold flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5" />
                          {r.verdict}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-300">
                      {r ? (
                        <div>
                          <div>{r.httpStatus ?? r.fetchResult}</div>
                          <div className="text-[11px] text-slate-500">{r.fetchDurationMs}ms</div>
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>

                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-300">
                      {r ? (
                        <span>
                          {r.validNormalizedNotices} / {r.rawRowsDetected}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>

                    <td className="py-3 px-3 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                      {r?.newestValidPublicationDate ? (
                        <div>
                          <div>{r.newestValidPublicationDate}</div>
                          <div className="text-[11px] text-slate-500">
                            Conf: {r.dateParsingConfidence}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>

                    <td className="py-3 px-3 max-w-md">
                      {r?.latestParsedNoticeTitle ? (
                        <div className="space-y-0.5">
                          <div className="text-slate-200 line-clamp-1 font-medium">
                            {r.latestParsedNoticeTitle}
                          </div>
                          {r.officialDetailUrl && (
                            <a
                              href={r.officialDetailUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-mono text-amber-400 hover:underline inline-flex items-center gap-1"
                            >
                              <span className="truncate max-w-[260px]">
                                {r.officialDetailUrl}
                              </span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          )}
                        </div>
                      ) : r ? (
                        <span className="text-red-400 font-mono text-[11px]">
                          {r.diagnosticMessage}
                        </span>
                      ) : (
                        <span className="text-slate-500">
                          Click "Test Zone" or "Run All-Zones Verification"
                        </span>
                      )}
                    </td>

                    <td className="py-3 pl-3 pr-5 text-right">
                      <button
                        type="button"
                        onClick={() => onRunSingleZone(board.boardId)}
                        disabled={busyAction !== null}
                        aria-label={`Test zone ${board.boardName}`}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {busyAction === `zone-${board.boardId}` ? 'Testing...' : 'Test Zone'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
