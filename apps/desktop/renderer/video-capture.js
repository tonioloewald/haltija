/**
 * Video capture — uses webview.getWebContentsId() + main process getMediaSourceId() + MediaRecorder.
 * Runs in the renderer where we have direct webview access.
 */

let videoRecorder = null
let videoChunks = []
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
    videoRecordingId = `vid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    videoChunks = []
    videoStartTime = Date.now()

    try {
      const wcId = webview.getWebContentsId()
      const sourceId = await window.haltija.getMediaSourceId(wcId)
      if (!sourceId) {
        videoRecordingId = null
        window.haltija.videoStartResult({ success: false, error: 'Failed to get media source ID for webview' })
        return
      }

      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: sourceId,
          },
        },
      }).then((stream) => {
        videoStream = stream

        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm'

        videoRecorder = new MediaRecorder(stream, { mimeType })

        videoRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) videoChunks.push(e.data)
        }

        videoRecorder.onstop = () => {
          stream.getTracks().forEach(t => t.stop())
          videoStream = null
        }

        videoRecorder.start(1000)

        videoMaxDurationTimer = setTimeout(() => {
          if (videoRecorder?.state === 'recording') {
            console.log('[Video] Auto-stopping after max duration')
            videoRecorder.stop()
          }
        }, maxDuration)

        window.haltija.videoStartResult({ success: true, recordingId: videoRecordingId })
      }).catch((err) => {
        videoRecordingId = null
        window.haltija.videoStartResult({ success: false, error: `Failed to capture tab: ${err.message}` })
      })
    } catch (err) {
      videoRecordingId = null
      window.haltija.videoStartResult({ success: false, error: `Failed to get media source: ${err.message}` })
    }
  })

  window.haltija.onVideoStop?.((data) => {
    if (!videoRecorder || videoRecorder.state === 'inactive') {
      window.haltija.videoStopResult({ success: false, error: 'No video recording in progress' })
      return
    }

    if (videoMaxDurationTimer) {
      clearTimeout(videoMaxDurationTimer)
      videoMaxDurationTimer = null
    }

    const duration = (Date.now() - videoStartTime) / 1000

    videoRecorder.onstop = () => {
      if (videoStream) {
        videoStream.getTracks().forEach(t => t.stop())
        videoStream = null
      }

      const blob = new Blob(videoChunks, { type: 'video/webm' })
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result
        const base64 = dataUrl.split(',')[1] || ''
        window.haltija.videoStopResult({ success: true, data: base64, duration })
        videoRecorder = null
        videoChunks = []
        videoRecordingId = null
      }
      reader.onerror = () => {
        window.haltija.videoStopResult({ success: false, error: 'Failed to encode video data' })
        videoRecorder = null
        videoChunks = []
        videoRecordingId = null
      }
      reader.readAsDataURL(blob)
    }

    videoRecorder.stop()
  })

  window.haltija.onVideoStatus?.((data) => {
    const recording = videoRecorder?.state === 'recording'
    window.haltija.videoStatusResult({
      recording,
      recordingId: recording ? videoRecordingId : undefined,
      duration: recording ? (Date.now() - videoStartTime) / 1000 : undefined,
    })
  })
}
