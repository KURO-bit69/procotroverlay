// ============================================================
// ProctorOverlay — Environment Monitor
// Detects multiple monitors, VMs, virtual cameras/audio,
// and remote desktop sessions. Runs in Electron main process.
// ============================================================

import { exec } from 'child_process'
import { promisify } from 'util'
import { screen } from 'electron'
import type { MonitoringEvent } from '@proctoroverlay/shared'

const execAsync = promisify(exec)
let _idC = 0
const nextId = (): string => `evt-env-${Date.now()}-${++_idC}`

export interface EnvironmentSnapshot {
  displayCount: number
  isVM: boolean
  vmIndicators: string[]
  isRemoteDesktop: boolean
  virtualCameras: string[]
  virtualAudioDevices: string[]
}

export class EnvironmentMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private onEvent: (event: MonitoringEvent) => void
  private sessionId: string
  private lastSnapshot: EnvironmentSnapshot | null = null
  private pollIntervalMs: number

  constructor(sessionId: string, onEvent: (event: MonitoringEvent) => void, pollIntervalMs = 10000) {
    this.sessionId = sessionId
    this.onEvent = onEvent
    this.pollIntervalMs = pollIntervalMs
  }

  start(): void {
    if (this.intervalId) return
    console.log('[EnvironmentMonitor] Started')
    this.poll()
    this.intervalId = setInterval(() => this.poll(), this.pollIntervalMs)
  }

  stop(): void {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null }
  }

  getLastSnapshot(): EnvironmentSnapshot | null { return this.lastSnapshot }

  private async poll(): Promise<void> {
    try {
      const snap = await this.takeSnapshot()
      this.lastSnapshot = snap

      // Multiple monitors
      if (snap.displayCount > 1) {
        this.onEvent({
          eventId: nextId(), sessionId: this.sessionId, type: 'MULTIPLE_MONITORS_DETECTED',
          severity: 'WARNING', timestamp: new Date().toISOString(), source: 'CANDIDATE_APP',
          metadata: { displayCount: snap.displayCount }, reviewStatus: 'UNREVIEWED',
        })
      }

      // Virtual machine
      if (snap.isVM) {
        this.onEvent({
          eventId: nextId(), sessionId: this.sessionId, type: 'VIRTUAL_MACHINE_DETECTED',
          severity: 'WARNING', timestamp: new Date().toISOString(), source: 'CANDIDATE_APP',
          metadata: { indicators: snap.vmIndicators,
            note: 'VM detection is heuristic-based and not guaranteed accurate. Some legitimate setups use VMs.' },
          reviewStatus: 'UNREVIEWED',
        })
      }

      // Virtual cameras
      if (snap.virtualCameras.length > 0) {
        this.onEvent({
          eventId: nextId(), sessionId: this.sessionId, type: 'VIRTUAL_CAMERA_DETECTED',
          severity: 'WARNING', timestamp: new Date().toISOString(), source: 'CANDIDATE_APP',
          metadata: { devices: snap.virtualCameras }, reviewStatus: 'UNREVIEWED',
        })
      }

      // Virtual audio
      if (snap.virtualAudioDevices.length > 0) {
        this.onEvent({
          eventId: nextId(), sessionId: this.sessionId, type: 'VIRTUAL_AUDIO_DETECTED',
          severity: 'WARNING', timestamp: new Date().toISOString(), source: 'CANDIDATE_APP',
          metadata: { devices: snap.virtualAudioDevices }, reviewStatus: 'UNREVIEWED',
        })
      }
    } catch (e) { console.error('[EnvironmentMonitor]', e) }
  }

  private async takeSnapshot(): Promise<EnvironmentSnapshot> {
    const [displayCount, vmResult, virtualDevices] = await Promise.all([
      this.getDisplayCount(),
      this.detectVM(),
      this.detectVirtualDevices(),
    ])

    return {
      displayCount,
      isVM: vmResult.isVM,
      vmIndicators: vmResult.indicators,
      isRemoteDesktop: await this.detectRemoteDesktop(),
      virtualCameras: virtualDevices.cameras,
      virtualAudioDevices: virtualDevices.audio,
    }
  }

  private getDisplayCount(): number {
    return screen.getAllDisplays().length
  }

  private async detectVM(): Promise<{ isVM: boolean; indicators: string[] }> {
    const indicators: string[] = []

    if (process.platform !== 'win32') {
      return { isVM: false, indicators: ['VM detection not implemented for this OS'] }
    }

    try {
      // Check BIOS manufacturer via WMI
      const { stdout: bios } = await execAsync(
        'wmic bios get manufacturer,serialnumber /format:csv',
        { timeout: 5000 },
      )
      const biosL = bios.toLowerCase()
      if (biosL.includes('vmware')) indicators.push('VMware BIOS')
      if (biosL.includes('virtualbox') || biosL.includes('vbox')) indicators.push('VirtualBox BIOS')
      if (biosL.includes('qemu')) indicators.push('QEMU BIOS')
      if (biosL.includes('hyper-v') || biosL.includes('microsoft corporation')) indicators.push('Hyper-V BIOS (may be legitimate)')
      if (biosL.includes('xen')) indicators.push('Xen BIOS')
    } catch { /* wmic may not be available */ }

    try {
      // Check system model
      const { stdout: model } = await execAsync(
        'wmic computersystem get model,manufacturer /format:csv',
        { timeout: 5000 },
      )
      const modelL = model.toLowerCase()
      if (modelL.includes('virtual')) indicators.push('Virtual system model')
      if (modelL.includes('vmware')) indicators.push('VMware system')
    } catch { /* ignore */ }

    try {
      // Check for VM-specific services
      const { stdout: services } = await execAsync(
        'sc query vmtoolsd 2>NUL & sc query VBoxService 2>NUL',
        { timeout: 5000 },
      )
      if (services.includes('RUNNING') && services.includes('vmtoolsd')) indicators.push('VMware Tools running')
      if (services.includes('RUNNING') && services.includes('VBoxService')) indicators.push('VirtualBox Guest running')
    } catch { /* ignore */ }

    return { isVM: indicators.length > 0, indicators }
  }

  private async detectRemoteDesktop(): Promise<boolean> {
    if (process.platform !== 'win32') return false
    try {
      const { stdout } = await execAsync(
        'query session 2>NUL | findstr /I "rdp-tcp" 2>NUL',
        { timeout: 3000 },
      )
      return stdout.trim().length > 0
    } catch { return false }
  }

  private async detectVirtualDevices(): Promise<{ cameras: string[]; audio: string[] }> {
    const cameras: string[] = []
    const audio: string[] = []

    const VIRTUAL_CAM_KEYWORDS = ['obs virtual', 'obs-camera', 'manycam', 'splitcam', 'snap camera',
      'xsplit vcam', 'e2esoft', 'droidcam', 'iriun', 'epoccam', 'newtek ndi']
    const VIRTUAL_AUDIO_KEYWORDS = ['vb-cable', 'vb-audio', 'virtual audio', 'voicemeeter',
      'blackhole', 'soundflower', 'virtual cable', 'cable input', 'cable output']

    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync(
          'wmic path Win32_PnPEntity where "caption like \'%camera%\' or caption like \'%webcam%\' or caption like \'%video%\'" get caption /format:csv',
          { timeout: 5000 },
        )
        for (const line of stdout.split('\n')) {
          const dev = line.trim()
          if (VIRTUAL_CAM_KEYWORDS.some((k) => dev.toLowerCase().includes(k))) {
            cameras.push(dev)
          }
        }
      } catch { /* ignore */ }

      try {
        const { stdout } = await execAsync(
          'wmic path Win32_SoundDevice get caption /format:csv',
          { timeout: 5000 },
        )
        for (const line of stdout.split('\n')) {
          const dev = line.trim()
          if (VIRTUAL_AUDIO_KEYWORDS.some((k) => dev.toLowerCase().includes(k))) {
            audio.push(dev)
          }
        }
      } catch { /* ignore */ }
    }

    return { cameras, audio }
  }
}
