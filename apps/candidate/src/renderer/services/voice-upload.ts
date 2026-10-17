export interface EncodedVoiceRecording {
  audioBase64: string
  mimeType: 'audio/webm' | 'audio/webm;codecs=opus' | 'audio/wav'
}

export async function recordVoiceSample(
  stream: MediaStream,
  durationMs: number,
  onProgress?: (secondsLeft: number) => void,
): Promise<EncodedVoiceRecording> {
  if (typeof MediaRecorder === 'undefined') throw new Error('Audio recording is not supported on this device.')
  const audioTrack = stream.getAudioTracks()[0]
  if (!audioTrack || audioTrack.readyState !== 'live') throw new Error('The microphone is no longer available.')

  const options = ['audio/webm;codecs=opus', 'audio/webm']
    .find((type) => MediaRecorder.isTypeSupported(type))
  const recorder = new MediaRecorder(new MediaStream([audioTrack]), options ? { mimeType: options } : undefined)
  const parts: BlobPart[] = []
  const completed = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) parts.push(event.data)
    })
    recorder.addEventListener('stop', () => resolve(new Blob(parts, { type: recorder.mimeType || 'audio/webm' })))
  })

  let timer = 0
  try {
    recorder.start()
    const startedAt = Date.now()
    await new Promise<void>((resolve, reject) => {
      timer = window.setInterval(() => {
        const secondsLeft = Math.max(0, Math.ceil((durationMs - (Date.now() - startedAt)) / 1000))
        onProgress?.(secondsLeft)
        if (secondsLeft <= 0) {
          window.clearInterval(timer)
          resolve()
        }
      }, 250)
      recorder.addEventListener('error', () => {
        window.clearInterval(timer)
        reject(new Error('Could not record the microphone sample.'))
      }, { once: true })
    })
    if (recorder.state !== 'inactive') recorder.stop()
  } catch (error) {
    window.clearInterval(timer)
    if (recorder.state !== 'inactive') recorder.stop()
    throw error
  }

  const blob = await completed
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const stride = 0x8000
  for (let i = 0; i < bytes.length; i += stride) {
    binary += String.fromCharCode(...bytes.subarray(i, i + stride))
  }

  const mimeType = blob.type.startsWith('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : blob.type.startsWith('audio/wav') ? 'audio/wav' : 'audio/webm'
  return { audioBase64: btoa(binary), mimeType }
}

export async function uploadVoiceRecording(
  sessionId: string,
  sessionToken: string,
  endpoint: 'enroll' | 'verify',
  recording: EncodedVoiceRecording,
): Promise<Record<string, unknown>> {
  const backendUrl = (await window.electronAPI?.getBackendUrl()) ?? 'http://localhost:4000'
  const response = await fetch(`${backendUrl}/sessions/${encodeURIComponent(sessionId)}/voice/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(recording),
  })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(typeof body.message === 'string' ? body.message : 'Voice verification is unavailable.')
  }
  return body
}
