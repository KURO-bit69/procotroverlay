// ============================================================
// ProctorOverlay — Privacy, Consent & Fairness Types
// GDPR + India DPDP Act compliance. Accessibility accommodations.
// ============================================================

// ── Consent ─────────────────────────────────────────────────

export type ConsentPurpose =
  | 'MONITORING'        // Core session monitoring
  | 'AUDIO_ANALYSIS'    // Mic + speaker detection
  | 'EVIDENCE_CAPTURE'  // Flagged-moment clips/snapshots
  | 'SCREEN_RECORDING'; // Screen share capture (if enabled)

export type ConsentStatus = 'GRANTED' | 'WITHDRAWN';

export interface ConsentRecord {
  id: string;
  sessionId: string;
  userId: string;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  /** ISO 8601 — when consent was granted */
  grantedAt: string;
  /** ISO 8601 — when consent was withdrawn (if applicable) */
  withdrawnAt?: string;
  /** Version of the privacy policy the user consented to */
  policyVersion: string;
  /** IP address at time of consent (hashed for privacy) */
  ipHash?: string;
}

// ── Data Retention ──────────────────────────────────────────

export interface RetentionPolicy {
  /** Days to retain event metadata (default: 30) */
  eventRetentionDays: number;
  /** Days to retain evidence clips/snapshots (default: 60) */
  evidenceRetentionDays: number;
  /** Days to retain session records (default: 90) */
  sessionRetentionDays: number;
  /** Whether to auto-delete or just flag for deletion */
  autoDelete: boolean;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  eventRetentionDays: 30,
  evidenceRetentionDays: 60,
  sessionRetentionDays: 90,
  autoDelete: false, // Default to flag — proctor confirms
};

// ── Accessibility Accommodations ────────────────────────────

export type AccommodationType =
  | 'DISABLE_GAZE_TRACKING'         // Eye condition, nystagmus, etc.
  | 'RELAXED_GAZE_THRESHOLDS'       // Higher thresholds for gaze events
  | 'DISABLE_FACE_DETECTION'        // Facial condition or prosthesis
  | 'EXTENDED_FOCUS_THRESHOLD'      // ADHD, neurological conditions
  | 'DISABLE_MULTIPLE_FACE_CHECK'   // Caregiver present (documented)
  | 'ALLOW_SCREEN_READER'           // Vision impairment
  | 'EXTENDED_MIC_MUTE_THRESHOLD'   // Speech impediment, stutter
  | 'CUSTOM';                       // Free-text accommodation

export interface Accommodation {
  type: AccommodationType;
  /** Why this accommodation was granted */
  reason: string;
  /** Who approved it (proctor email) */
  approvedBy: string;
  /** ISO 8601 */
  approvedAt: string;
  /** Optional: custom config overrides for this accommodation */
  configOverrides?: Record<string, unknown>;
}

/** Per-session accommodations config */
export interface SessionAccommodations {
  sessionId: string;
  accommodations: Accommodation[];
  /** Free-text note from proctor about candidate's needs */
  proctorNote?: string;
}

// ── Appeal ──────────────────────────────────────────────────

export type AppealStatus =
  | 'SUBMITTED'   // Candidate submitted appeal
  | 'UNDER_REVIEW' // Proctor reviewing
  | 'ACCEPTED'     // Appeal upheld — flag removed
  | 'REJECTED'     // Appeal denied — flag stands
  | 'WITHDRAWN';   // Candidate withdrew appeal

export interface Appeal {
  id: string;
  sessionId: string;
  eventId: string;
  /** Candidate's written statement */
  candidateStatement: string;
  /** Status of the appeal */
  status: AppealStatus;
  /** Proctor's response */
  proctorResponse?: string;
  /** ISO 8601 */
  submittedAt: string;
  /** ISO 8601 */
  resolvedAt?: string;
}

// ── Data Subject Rights (GDPR Art. 15-17, DPDP Sec. 11-14) ─

export interface DataExportRequest {
  userId: string;
  /** What data is included in the export */
  scope: ('events' | 'sessions' | 'consents' | 'appeals' | 'accommodations')[];
  /** ISO 8601 — when requested */
  requestedAt: string;
  /** ISO 8601 — when fulfilled */
  fulfilledAt?: string;
  /** Download URL (presigned, time-limited) */
  downloadUrl?: string;
}

export interface DataErasureRequest {
  userId: string;
  /** ISO 8601 — when requested */
  requestedAt: string;
  /** ISO 8601 — when processing started */
  processingAt?: string;
  /** ISO 8601 — when completed */
  completedAt?: string;
  /** What was deleted */
  deletedScopes?: string[];
  /** Reason for any retained data (legal hold, etc.) */
  retentionReason?: string;
}

// ── AI Disclosure ───────────────────────────────────────────

/**
 * Every algorithmic flag must carry this disclosure.
 * Presented in the report and in the dashboard.
 */
export interface AIDisclosure {
  /** Human-readable description of what the algorithm detected */
  description: string;
  /** What technique was used (e.g., "MediaPipe Face Mesh", "RMS VAD") */
  technique: string;
  /** Known limitations of this detection */
  limitations: string[];
  /** Confidence 0.0-1.0 if available */
  confidence?: number;
  /**
   * Whether a human reviewed this flag before any decision.
   * Always true in ProctorOverlay — system never auto-rejects.
   */
  humanReviewed: boolean;
}

/** Standard AI disclosure text shown on every report */
export const AI_DISCLOSURE_TEXT = `
⚠️ AI-ASSISTED MONITORING DISCLOSURE

This session was monitored using algorithmic detection tools. These tools flag
potential integrity concerns for human review. Important limitations:

• Gaze tracking accuracy varies by lighting, glasses, skin tone, and camera angle.
• Speaker detection uses audio analysis that may produce false positives in noisy
  environments or with background audio from the meeting itself.
• Process monitoring detects application names only — it cannot read application
  content or determine intent.
• No candidate is automatically rejected based on algorithmic flags alone.
  Every flag requires a human proctor's review and decision.
• These tools have inherent error rates. A flag does NOT prove misconduct.

Under GDPR Article 22 and India's DPDP Act Section 12, candidates have the right
to not be subject to decisions based solely on automated processing. This system
enforces that right by design — all decisions are made by human proctors.
`.trim();

/**
 * Per-event-type disclosure of what the algorithm does and its known limits.
 * Shown in detailed report view.
 */
export const EVENT_AI_DISCLOSURES: Partial<Record<string, AIDisclosure>> = {
  SPEAKER_SECOND_VOICE_DETECTED: {
    description: 'Audio analysis detected what may be a second distinct speaker.',
    technique: 'Speaker diarization / voice embedding comparison (MOCK in dev)',
    limitations: [
      'Meeting audio (interviewer speaking) can trigger false positives.',
      'Background noise (TV, radio, family) may be misidentified as a second speaker.',
      'This is currently a MOCK implementation — not real AI analysis.',
      'Even with real analysis, speaker separation has significant error rates.',
    ],
    humanReviewed: true,
  },
  SPEAKER_VOICE_MISMATCH: {
    description: 'Voice characteristics differ from the enrolled voice sample.',
    technique: 'Detectif.ai enrolled-speaker verification (MOCK in dev)',
    limitations: [
      'Voice characteristics change with illness, stress, or fatigue.',
      'Microphone changes affect voice embeddings.',
      'A no-match result does not establish that another person was speaking.',
      'Detectif verification is a signal for human review, not proof.',
    ],
    humanReviewed: true,
  },
  BLOCKLISTED_APP_DETECTED: {
    description: 'A process matching the blocklist was found running.',
    technique: 'Process name matching (tasklist / ps)',
    limitations: [
      'Only matches process names — cannot read application content.',
      'Legitimate tools may share names with blocklisted apps.',
      'Cannot detect applications running in sandboxes or VMs.',
      'Cannot detect web-based tools (e.g. browser-based ChatGPT) unless the browser window title matches.',
    ],
    humanReviewed: true,
  },
  VIRTUAL_MACHINE_DETECTED: {
    description: 'System environment characteristics suggest a virtual machine.',
    technique: 'WMI queries (Win32_ComputerSystem, BIOS, disk) — heuristic',
    limitations: [
      'This is a heuristic check — can produce false positives on certain hardware.',
      'Some corporate laptops have VM-like characteristics.',
      'Sophisticated VMs may not be detectable.',
    ],
    humanReviewed: true,
  },
};
