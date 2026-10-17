// ============================================================
// ProctorOverlay — Shared Event Types
// Every monitoring signal uses this schema end-to-end.
// ============================================================

export type EventSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type EventReviewStatus =
  | 'UNREVIEWED'
  | 'ACKNOWLEDGED'
  | 'DISMISSED'
  | 'FLAGGED'
  | 'APPEALED';

export type EventSource =
  | 'CANDIDATE_APP'
  | 'BACKEND'
  | 'PROCTOR'
  | 'ANALYSIS_SERVICE';

export type EventType =
  // ── Audio / Speaker ──────────────────────────────────────
  | 'SPEAKER_SECOND_VOICE_DETECTED'
  | 'SPEAKER_VOICE_MISMATCH'
  | 'SPEAKER_VOICE_MATCH'
  | 'SPEAKER_ANALYSIS_UNAVAILABLE'
  | 'MIC_MUTED'
  | 'MIC_UNMUTED'
  | 'MIC_DISCONNECTED'
  | 'MIC_DEVICE_CHANGED'
  // ── Camera / Gaze ────────────────────────────────────────
  | 'CAMERA_DISCONNECTED'
  | 'CAMERA_COVERED'
  | 'CAMERA_DEVICE_CHANGED'
  | 'CAMERA_RECONNECTED'
  | 'GAZE_OFF_SCREEN'
  | 'GAZE_REPEATED_DIRECTION'
  | 'GAZE_FACE_NOT_DETECTED'
  | 'GAZE_MULTIPLE_FACES'
  | 'GAZE_HEAD_TURNED'
  | 'GAZE_TRACKING_UNAVAILABLE'
  | 'GAZE_CALIBRATION_COMPLETE'
  // ── App / Environment ────────────────────────────────────
  | 'APP_FOCUS_LOST'
  | 'APP_FOCUS_REGAINED'
  | 'BLOCKLISTED_APP_DETECTED'
  | 'MULTIPLE_MONITORS_DETECTED'
  | 'VIRTUAL_CAMERA_DETECTED'
  | 'VIRTUAL_AUDIO_DETECTED'
  | 'VIRTUAL_MACHINE_DETECTED'
  | 'SCREEN_SHARE_STOPPED'
  | 'SCREEN_SHARE_STARTED'
  // ── Meeting integration ───────────────────────────────────
  | 'MEETING_APP_DETECTED'
  | 'MEETING_CALL_ACTIVE'
  | 'MEETING_CALL_ENDED'
  | 'MEETING_APP_CLOSED'
  // ── Session lifecycle ────────────────────────────────────
  | 'SESSION_CREATED'
  | 'SESSION_PREFLIGHT_STARTED'
  | 'SESSION_STARTED'
  | 'SESSION_PAUSED'
  | 'SESSION_RESUMED'
  | 'SESSION_ENDED'
  | 'SESSION_INTERRUPTED'
  | 'SESSION_FORCE_ENDED'
  | 'CANDIDATE_CONSENT_GIVEN'
  | 'CANDIDATE_NETWORK_DROPPED'
  | 'CANDIDATE_RECONNECTED'
  // ── Proctor actions ──────────────────────────────────────
  | 'PROCTOR_WARNING_SENT'
  | 'PROCTOR_SESSION_PAUSED'
  | 'PROCTOR_SESSION_ENDED'
  | 'PROCTOR_NOTE_ADDED';

export interface MonitoringEvent {
  /** UUID v4 — generated client-side, deduplicated server-side */
  eventId: string;
  /** UUID v4 — references Session.id */
  sessionId: string;
  type: EventType;
  severity: EventSeverity;
  /** ISO 8601 timestamp — client clock, server records arrival time separately */
  timestamp: string;
  source: EventSource;
  /**
   * Confidence value 0.0–1.0.
   * Only present when the source provides a meaningful confidence score.
   * Absence does NOT mean high confidence.
   */
  confidence?: number;
  /** Event-specific structured payload */
  metadata: Record<string, unknown>;
  /** MinIO object key pointing to an evidence clip or snapshot */
  evidenceRef?: string;
  reviewStatus: EventReviewStatus;
  /** Set by proctor during review */
  proctorNote?: string;
}

/** Default risk weights. Stored per-session in DB so proctors can override. */
export const DEFAULT_RISK_WEIGHTS: Partial<Record<EventType, number>> = {
  SPEAKER_SECOND_VOICE_DETECTED: 30,
  SPEAKER_VOICE_MISMATCH: 25,
  BLOCKLISTED_APP_DETECTED: 20,
  SCREEN_SHARE_STOPPED: 15,
  GAZE_OFF_SCREEN: 15,
  CAMERA_COVERED: 12,
  APP_FOCUS_LOST: 10,
  MULTIPLE_MONITORS_DETECTED: 10,
  GAZE_MULTIPLE_FACES: 10,
  VIRTUAL_CAMERA_DETECTED: 8,
  VIRTUAL_AUDIO_DETECTED: 8,
  VIRTUAL_MACHINE_DETECTED: 8,
  CAMERA_DISCONNECTED: 8,
  MIC_MUTED: 5,
  MIC_DISCONNECTED: 8,
  GAZE_REPEATED_DIRECTION: 5,
  GAZE_HEAD_TURNED: 5,
};
