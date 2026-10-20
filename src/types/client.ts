import type {
  AllZonesTestSummary,
  BoardConfig,
  MonitorState,
  ZoneTestReport,
} from '../server/types.ts';
import type { DedicatedTelegramTestReport } from '../server/telegram.ts';

export interface DashboardSnapshot {
  ok: boolean;
  sha: string | null;
  storageBackend: 'github' | 'local-mirror';
  boards: BoardConfig[];
  state: MonitorState;
  secretsStatus: {
    githubConfigured: boolean;
    githubValidationErrors: string[];
    githubRepoTarget: string;
    telegramConfigured: boolean;
    telegramValidationErrors: string[];
    cronTokenConfigured: boolean;
    adminTokenConfigured: boolean;
  };
  sampleTelegramPreview: string | null;
}

export type ActiveTab =
  | 'overview'
  | 'all-zones'
  | 'notices'
  | 'delivery'
  | 'setup';

export type {
  AllZonesTestSummary,
  BoardConfig,
  DedicatedTelegramTestReport,
  MonitorState,
  ZoneTestReport,
};
