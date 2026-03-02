/**
 * Video capture — streams WebM chunks directly to disk via IPC.
 *
 * Flow:
 *   1. Renderer gets media source ID from main (via webContents.getMediaSourceId)
 *   2. Renderer opens getUserMedia stream and starts MediaRecorder
 *   3. Each MediaRecorder chunk is sent to main as ArrayBuffer via IPC
 *   4. Main process appends chunks to a file on disk
 *   5. On stop, main closes the file and returns the path
 *
 * No base64 encoding. No large data through WebSocket.
 */

let videoRecorder = null
let videoRecordingId = null
let videoStartTime = 0
let videoMaxDurationTimer = null
let videoStream = null

export function initVideoCapture() {
  if (!window.haltija) return

  window.haltija.onVideoStart?.(async (data) => {
    if (videoRecorder) {
      window.haltija.videoStartResult({ success: false, error: 'Video recording already in progress' })
      return
    }

    const { getActiveWebview } = window._tabs
    const webview = getActiveWebview()
    if (!webview || !webview.getWebContentsId) {
      window.haltija.videoStartResult({ success: false, error: 'No active webview for video capture' })
      return
    }

    const maxDuration = (data.maxDuration || 60) * 1000

    try {
      const wcId = webview.getWebContentsId()
      const sourceId = await window.haltija.getMediaSourceId(wcId)
      if (!sourceId) {
        window.haltija.videoStartResult({ success: false, error: 'Failed to get media source ID for webview' })
        return
      }

      // Ask main process to create the output file
      const fileResult = await window.haltija.videoFileCreate()
      if (!fileResult?.success) {
        window.haltija.videoStartResult({ success: false, error: fileResult?.error || 'Failed to create video file' })
        return
      }

      videoRecordingId = fileResult.recordingId

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: sourceId,
          },
        },
      })

      videoStream = stream
      videoStartTime = Date.now()

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm'

      videoRecorder = new MediaRecorder(stream, { mimeType })

      videoRecorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          // Convert Blob to ArrayBuffer and send to main for disk write
          const buffer = await e.data.arrayBuffer()
          window.haltija.videoFileChunk(videoRecordingId, buffer)
        }
      }

      videoRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        videoStream = null
      }

      // Emit chunks every 500ms for smooth streaming to disk
      videoRecorder.start(500)

      videoMaxDurationTimer = setTimeout(() => {
        if (videoRecorder?.state === 'recording') {
          console.log('[Video] Auto-stopping after max duration')
          stopRecording()
        }
      }, maxDuration)

      window.haltija.videoStartResult({ success: true, recordingId: videoRecordingId })
    } catch (err) {
      videoRecordingId = null
      window.haltija.videoStartResult({ success: false, error: `Failed to start video: ${err.message}` })
    }
  })

  window.haltija.onVideoStop?.(async () => {
    if (!videoRecorder || videoRecorder.state === 'inactive') {
      window.haltija.videoStopResult({ success: false, error: 'No video recording in progress' })
      return
    }
    await stopRecording()
  })

  window.haltija.onVideoStatus?.(() => {
    const recording = videoRecorder?.state === 'recording'
    window.haltija.videoStatusResult({
      recording,
      recordingId: recording ? videoRecordingId : undefined,
      duration: recording ? (Date.now() - videoStartTime) / 1000 : undefined,
    })
  })
}

async function stopRecording() {
  if (videoMaxDurationTimer) {
    clearTimeout(videoMaxDurationTimer)
    videoMaxDurationTimer = null
  }

  const duration = (Date.now() - videoStartTime) / 1000
  const id = videoRecordingId

  // Stop the recorder — this triggers final ondataavailable + onstop
  await new Promise((resolve) => {
    videoRecorder.onstop = () => {
      if (videoStream) {
        videoStream.getTracks().forEach(t => t.stop())
        videoStream = null
      }
      resolve()
    }
    videoRecorder.stop()
  })

  // Small delay to ensure final chunk IPC completes
  await new Promise(r => setTimeout(r, 100))

  // Tell main to close the file and get the path
  const result = await window.haltija.videoFileClose(id, duration)

  videoRecorder = null
  videoRecordingId = null
  videoStartTime = 0

  window.haltija.videoStopResult(result)
}
