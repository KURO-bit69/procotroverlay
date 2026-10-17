// ============================================================
// ProctorOverlay — Session Types
// ============================================================

export type SessionStatus =
  | 'CREATED'       // Proctor created, no candidate yet
  | 'PREFLIGHT'     // Candidate running pre-checks
  | 'ACTIVE'        // Interview in progress
  | 'PAUSED'        // Manually paused by proctor
  | 'INTERRUPTED'   // Network/sensor loss — temporary
  | 'COMPLETING'    // Generating report
  | 'COMPLETED'     // Finished normally
  | 'FORCE_ENDED';  // Proctor terminated early

export type UserRole = 'CANDIDATE' | 'PROCTOR';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface Session {
  id: string;
  /** 6-character uppercase alphanumeric code shared with candidate */
  joinCode: string;
  status: SessionStatus;
  candidateId: string;
  proctorId: string;
  /** Running weighted risk score — for triage only, never auto-rejects */
  riskScore: number;
  /** Per-session override of DEFAULT_RISK_WEIGHTS */
  riskWeights: Record<string, number>;
  /** ISO 8601 — when candidate gave consent */
  consentAt?: string;
  /** ISO 8601 — when session went ACTIVE */
  startedAt?: string;
  /** ISO 8601 — when session reached terminal state */
  endedAt?: string;
  createdAt: string;
}

export interface SessionConfig {
  /** Whether microphone must stay unmuted */
  requireMicUnmuted: boolean;
  /** Whether camera must stay connected */
  requireCamera: boolean;
  /** Process names that trigger BLOCKLISTED_APP_DETECTED */
  blocklist: string[];
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  requireMicUnmuted: true,
  requireCamera: true,
  blocklist: [
    // AI chat
    'ChatGPT', 'claude', 'Gemini',
    // Remote access
    'AnyDesk', 'TeamViewer', 'AnyViewer', 'Chrome Remote Desktop',
    // Streaming / virtual cam
    'obs64', 'obs32', 'Streamlabs OBS', 'XSplit',
    // Note apps
    'Notion', 'Obsidian',
    // Screen sharing tools (outside the interview)
    'Loom',
  ],
};

/** Pre-check status tracked on the candidate side */
export interface PreCheckStatus {
  camera: 'IDLE' | 'GRANTED' | 'DENIED' | 'ERROR';
  microphone: 'IDLE' | 'GRANTED' | 'DENIED' | 'ERROR';
  voiceBaseline: 'IDLE' | 'RECORDING' | 'ENROLLED' | 'ERROR';
  codeValidated: boolean;
  consentGiven: boolean;
}

export const isPreCheckPassed = (status: PreCheckStatus): boolean =>
  status.camera === 'GRANTED' &&
  status.microphone === 'GRANTED' &&
  status.voiceBaseline === 'ENROLLED' &&
  status.codeValidated &&
  status.consentGiven;
