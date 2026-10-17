// ============================================================
// ProctorOverlay — SpeakerDetectionProvider Interface
//
// All speaker-detection logic (Altheia or otherwise) sits
// behind this interface. The backend wires in the real
// provider via environment variables. The mock is always
// available for development and testing.
// ============================================================

export interface SpeakerAnalysisResult {
  sessionId: string;
  chunkId: string;
  /** ISO 8601 */
  timestamp: string;
  /** Number of distinct speakers detected in this chunk */
  speakerCount: number;
  /**
   * Whether the detected voice matches the enrolled baseline.
   * null = no baseline enrolled yet.
   */
  voiceMatchesBaseline: boolean | null;
  /** 0.0–1.0 confidence from the provider */
  confidence: number;
  /** Raw provider response, kept for debugging — never forwarded to frontend */
  rawProviderResponse?: unknown;
}

export interface SpeakerDetectionProvider {
  /** Human-readable name shown in health dashboards */
  readonly name: string;

  /**
   * Enroll a voice baseline for the given session.
   * Called during pre-check after candidate gives consent.
   */
  enroll(sessionId: string, audioBuffer: ArrayBuffer): Promise<void>;

  /**
   * Analyze a single audio chunk.
   * Only called when local VAD confirms voice activity.
   */
  analyzeChunk(
    sessionId: string,
    chunkId: string,
    audioBuffer: ArrayBuffer,
  ): Promise<SpeakerAnalysisResult>;

  /**
   * Returns true if the provider is reachable and configured.
   * Called periodically during a session.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Clean up any session-specific resources on the provider side.
   * Called when the session ends or is interrupted.
   */
  dispose(sessionId: string): Promise<void>;
}

// ──────────────────────────────────────────────────────────
// Mock Implementation
// Returns deterministic, clearly-labelled demo data.
// NEVER present mock output as real AI analysis.
// ──────────────────────────────────────────────────────────

export class MockSpeakerDetectionProvider implements SpeakerDetectionProvider {
  readonly name = 'MockSpeakerDetectionProvider [DEMO — not real analysis]';

  private enrolledSessions = new Set<string>();

  async enroll(sessionId: string): Promise<void> {
    this.enrolledSessions.add(sessionId);
    console.log(`[Mock] Enrolled voice baseline for session ${sessionId}`);
  }

  async analyzeChunk(
    sessionId: string,
    chunkId: string,
  ): Promise<SpeakerAnalysisResult> {
    // Simulate a second speaker 10% of the time for testing
    const simulateAlert = Math.random() < 0.1;

    return {
      sessionId,
      chunkId,
      timestamp: new Date().toISOString(),
      speakerCount: simulateAlert ? 2 : 1,
      voiceMatchesBaseline: this.enrolledSessions.has(sessionId)
        ? !simulateAlert
        : null,
      confidence: simulateAlert ? 0.72 : 0.95,
      rawProviderResponse: { _mock: true, chunkId },
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async dispose(sessionId: string): Promise<void> {
    this.enrolledSessions.delete(sessionId);
    console.log(`[Mock] Disposed session ${sessionId}`);
  }
}
