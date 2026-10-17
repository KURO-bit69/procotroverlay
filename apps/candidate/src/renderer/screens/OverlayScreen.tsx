import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './OverlayScreen.module.css';
import VoiceVerificationMonitor from '../services/VoiceVerificationMonitor';

interface MonitorEvent {
  eventId: string;
  type: string;
  severity: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

function severityClass(severity: string): string {
  switch (severity) {
    case 'CRITICAL': return styles.critical;
    case 'WARNING': return styles.high;
    default: return styles.low;
  }
}

function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    BLOCKLISTED_APP_DETECTED: '🚫 Blocked App',
    APP_FOCUS_LOST: '⚠️ Focus Lost',
    APP_FOCUS_REGAINED: '✅ Focus Back',
    MULTIPLE_MONITORS_DETECTED: '🖥️ Multi-Monitor',
    VIRTUAL_MACHINE_DETECTED: '⚠️ VM Detected',
    VIRTUAL_CAMERA_DETECTED: '📷 Virtual Camera',
    VIRTUAL_AUDIO_DETECTED: '🔊 Virtual Audio',
    SCREEN_SHARE_STOPPED: '📸 Screenshot Blocked',
    SESSION_STARTED: '▶️ Session Started',
    SESSION_ENDED: '⏹️ Session Ended',
    CAMERA_COVERED: '🔲 Camera Covered',
    // Mic / audio events
    MIC_MUTED: '🔇 Mic Muted',
    MIC_UNMUTED: '🔊 Mic Unmuted',
    MIC_DISCONNECTED: '🔌 Mic Disconnected',
    MIC_DEVICE_CHANGED: '🎤 Mic Changed',
    SPEAKER_SECOND_VOICE_DETECTED: '🗣️ Extra Voice',
    SPEAKER_VOICE_MISMATCH: '🗣️ Voice Mismatch',
    SPEAKER_VOICE_MATCH: '✅ Voice Match',
    SPEAKER_ANALYSIS_UNAVAILABLE: '⚠️ Analysis Down',
    // Meeting events
    MEETING_APP_DETECTED: '📹 Meeting App',
    MEETING_CALL_ACTIVE: '📞 Call Active',
    MEETING_CALL_ENDED: '📞 Call Ended',
    MEETING_APP_CLOSED: '📹 Meeting Closed',
  };
  return labels[type] || type;
}

function timeAgo(isoTimestamp: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

interface SessionState {
  sessionToken: string | null;
  sessionId: string | null;
  candidateEmail: string | null;
}

interface Props {
  session: SessionState;
  mediaStream: MediaStream | null;
}

export default function OverlayScreen({ session, mediaStream }: Props) {
  const [ending, setEnding] = useState(false);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [focusStatus, setFocusStatus] = useState<'focused' | 'away'>('focused');
  const [envWarnings, setEnvWarnings] = useState<string[]>([]);
  const [alertCount, setAlertCount] = useState({ high: 0, low: 0 });
  const [meetingState, setMeetingState] = useState<{
    appDetected: boolean;
    platform: string | null;
    callActive: boolean;
  }>({ appDetected: false, platform: null, callActive: false });
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onMonitorEvent((event) => {
      setEvents((prev) => {
        const next = [...prev, event];
        return next.length > 100 ? next.slice(-100) : next;
      });

      if (event.type === 'APP_FOCUS_LOST') {
        setFocusStatus('away');
      } else if (event.type === 'APP_FOCUS_REGAINED') {
        setFocusStatus('focused');
      }

      if (event.severity === 'WARNING' || event.severity === 'CRITICAL') {
        setAlertCount((prev) => ({ ...prev, high: prev.high + 1 }));
      } else {
        setAlertCount((prev) => ({ ...prev, low: prev.low + 1 }));
      }

      // Update meeting state from events
      if (event.type === 'MEETING_APP_DETECTED' || event.type === 'MEETING_CALL_ACTIVE') {
        setMeetingState({
          appDetected: true,
          platform: (event.metadata.platform as string) || null,
          callActive: event.type === 'MEETING_CALL_ACTIVE',
        });
      } else if (event.type === 'MEETING_APP_CLOSED') {
        setMeetingState({ appDetected: false, platform: null, callActive: false });
      } else if (event.type === 'MEETING_CALL_ENDED') {
        setMeetingState((prev) => ({ ...prev, callActive: false }));
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchEnv = async () => {
      try {
        const snapshot = await window.electronAPI.getEnvironmentSnapshot();
        if (cancelled || !snapshot) return;

        const warnings: string[] = [];
        if (snapshot.displayCount > 1) {
          warnings.push(`${snapshot.displayCount} monitors detected`);
        }
        if (snapshot.isVM) {
          warnings.push(`VM detected: ${snapshot.vmIndicators.join(', ')}`);
        }
        if (snapshot.isRemoteDesktop) {
          warnings.push('Remote desktop session');
        }
        if (snapshot.virtualCameras.length > 0) {
          warnings.push(`Virtual camera: ${snapshot.virtualCameras.join(', ')}`);
        }
        if (snapshot.virtualAudioDevices.length > 0) {
          warnings.push(`Virtual audio: ${snapshot.virtualAudioDevices.join(', ')}`);
        }
        setEnvWarnings(warnings);
      } catch {
        // ignore
      }
    };

    fetchEnv();
    const interval = setInterval(fetchEnv, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events]);

  const handleEnd = useCallback(async () => {
    setEnding(true);
    try {
      await window.electronAPI.endSession();
      // App.tsx listens for meeting:closed to navigate to completed screen
    } catch {
      setEnding(false);
    }
  }, []);

  return (
    <div className={styles.container}>
      <VoiceVerificationMonitor
        sessionId={session.sessionId ?? ''}
        sessionToken={session.sessionToken ?? ''}
        stream={mediaStream}
      />
      <div className={styles.statusBar}>
        <div className={styles.statusDot} />
        <span className={styles.statusText}>Monitoring active</span>
        <div className={styles.focusBadge} data-status={focusStatus}>
          {focusStatus === 'focused' ? '👁️ Focused' : '⚠️ Away'}
        </div>
      </div>

      {envWarnings.length > 0 && (
        <div className={styles.envWarnings}>
          <strong>⚠️ Environment</strong>
          {envWarnings.map((w, i) => (
            <div key={i} className={styles.envWarningItem}>{w}</div>
          ))}
        </div>
      )}

      <div className={styles.alertSummary}>
        <div className={styles.alertBadge} data-level="high">
          {alertCount.high} warnings
        </div>
        <div className={styles.alertBadge} data-level="low">
          {alertCount.low} info
        </div>
      </div>

      <div className={styles.checks}>
        <div className={styles.checkItem}>
          <span className={styles.checkIcon}>🎥</span>
          <span>Camera</span>
          <span className={styles.ok}>OK</span>
        </div>
        <div className={styles.checkItem}>
          <span className={styles.checkIcon}>🎤</span>
          <span>Microphone</span>
          <span className={styles.ok}>OK</span>
        </div>
        <div className={styles.checkItem}>
          <span className={styles.checkIcon}>📹</span>
          <span>Meeting</span>
          {meetingState.appDetected ? (
            <span className={meetingState.callActive ? styles.ok : styles.meetingIdle}>
              {meetingState.platform}{meetingState.callActive ? ' — In Call' : ' — Idle'}
            </span>
          ) : (
            <span className={styles.meetingNone}>Not detected</span>
          )}
        </div>
      </div>

      <div className={styles.feedSection}>
        <div className={styles.feedHeader}>
          Event Feed
          <span className={styles.feedCount}>{events.length}</span>
        </div>
        <div className={styles.feed} ref={feedRef}>
          {events.length === 0 ? (
            <div className={styles.feedEmpty}>No events yet — monitoring is running</div>
          ) : (
            events.map((evt) => (
              <div
                key={evt.eventId}
                className={`${styles.feedItem} ${severityClass(evt.severity)}`}
              >
                <span className={styles.feedLabel}>{eventLabel(evt.type)}</span>
                <span className={styles.feedMsg}>
                  {(evt.metadata.message as string) ||
                   (evt.metadata.processName as string) ||
                   (evt.metadata.action as string) ||
                   evt.type}
                </span>
                <span className={styles.feedTime}>{timeAgo(evt.timestamp)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <button
        className={styles.endButton}
        onClick={handleEnd}
        disabled={ending}
      >
        {ending ? 'Ending…' : 'End Session'}
      </button>
    </div>
  );
}
