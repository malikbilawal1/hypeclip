// Browser-only clip exporter. No server, no ffmpeg, no installs, no cost.
//
// How it works: it plays the chosen segment of a <video>, paints every frame
// onto a 9:16 <canvas>, and records canvas + audio with MediaRecorder.
//
// Known limits (also shown to the user in the UI):
//  - It runs in REAL TIME: a 20 second clip takes about 20 seconds to export.
//  - The screen must stay on and the tab must stay visible while exporting.
//  - Output is MP4 when the browser can record MP4 (Safari on iPhone does).
//    Otherwise it falls back to WebM, which some apps will not accept.

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

export function getExportSupport() {
  const none = { supported: false, mimeType: null, ext: null, isMp4: false }
  if (typeof window === 'undefined') return none
  if (typeof MediaRecorder === 'undefined') return none
  if (!HTMLCanvasElement.prototype.captureStream) return none
  let mimeType = null
  for (const t of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(t)) {
        mimeType = t
        break
      }
    } catch {
      // ignore and try the next one
    }
  }
  if (!mimeType) return none
  const isMp4 = mimeType.startsWith('video/mp4')
  return { supported: true, mimeType, ext: isMp4 ? 'mp4' : 'webm', isMp4 }
}

// ---- audio routing -------------------------------------------------------
// A <video> element can only be wired into Web Audio once, so we cache the graph.
const audioGraphs = new WeakMap()

function getAudioGraph(video) {
  const existing = audioGraphs.get(video)
  if (existing) return existing
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  try {
    const ctx = new AC()
    const source = ctx.createMediaElementSource(video)
    source.connect(ctx.destination) // keeps normal playback audible
    const graph = { ctx, source }
    audioGraphs.set(video, graph)
    return graph
  } catch {
    return null
  }
}

// Call when the <video> element is removed, to free the AudioContext.
export function releaseAudio(video) {
  if (!video) return
  const g = audioGraphs.get(video)
  if (!g) return
  audioGraphs.delete(video)
  try {
    g.ctx.close()
  } catch {
    // ignore
  }
}

function seekTo(video, t) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 0.01) return resolve()
    const done = () => {
      video.removeEventListener('seeked', done)
      resolve()
    }
    video.addEventListener('seeked', done)
    video.currentTime = t
  })
}

// ---- main export ---------------------------------------------------------
// options:
//   video       HTMLVideoElement with a loaded file
//   start, end  seconds
//   mode        'crop' (fill 9:16, cuts the sides) or 'fit' (whole frame, black bars)
//   cropPos     0..1, where the 9:16 window sits (left..right, or top..bottom)
//   height      1280 (720x1280) or 1920 (1080x1920)
//   watermark   draw a small HypeClip label (Free plan)
//   onProgress  (0..1) => void
//   shouldCancel () => boolean
// returns { blob, mimeType, ext, cancelled }
export async function exportClip({
  video,
  start,
  end,
  mode = 'crop',
  cropPos = 0.5,
  height = 1280,
  watermark = false,
  onProgress,
  shouldCancel,
}) {
  const support = getExportSupport()
  if (!support.supported) {
    throw new Error('This browser cannot record video. Try Safari on iPhone (iOS 14.3 or newer).')
  }
  const duration = end - start
  if (!(duration >= 0.5)) throw new Error('The clip must be at least 0.5 seconds long.')
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) throw new Error('The video is not loaded yet.')

  const width = Math.round((height * 9) / 16)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  function drawFrame() {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
    if (mode === 'fit') {
      const scale = Math.min(width / vw, height / vh)
      const dw = vw * scale
      const dh = vh * scale
      ctx.drawImage(video, (width - dw) / 2, (height - dh) / 2, dw, dh)
    } else {
      const target = width / height
      const srcRatio = vw / vh
      let sx = 0
      let sy = 0
      let sw = vw
      let sh = vh
      if (srcRatio > target) {
        sw = vh * target
        sx = (vw - sw) * cropPos
      } else if (srcRatio < target) {
        sh = vw / target
        sy = (vh - sh) * cropPos
      }
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height)
    }
    if (watermark) {
      ctx.save()
      ctx.font = 'bold ' + Math.round(width * 0.05) + 'px system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      ctx.shadowColor = 'rgba(168,85,247,0.9)'
      ctx.shadowBlur = 12
      ctx.fillText('HypeClip', width - width * 0.05, height * 0.88)
      ctx.restore()
    }
  }

  const prevTime = video.currentTime
  video.pause()

  // audio
  let graph = null
  let audioDest = null
  try {
    graph = getAudioGraph(video)
    if (graph) {
      if (graph.ctx.state === 'suspended') await graph.ctx.resume()
      audioDest = graph.ctx.createMediaStreamDestination()
      graph.source.disconnect()
      graph.source.connect(audioDest) // silent on speakers while recording
    }
  } catch {
    graph = null
    audioDest = null
  }

  const stream = canvas.captureStream(30)
  if (audioDest) {
    audioDest.stream.getAudioTracks().forEach((track) => stream.addTrack(track))
  }

  const chunks = []
  let recorder
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: support.mimeType,
      videoBitsPerSecond: height >= 1920 ? 8000000 : 5000000,
    })
  } catch {
    recorder = new MediaRecorder(stream)
  }
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data)
  }
  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = resolve
    recorder.onerror = (e) => reject((e && e.error) || new Error('Recording failed.'))
  })

  let cancelled = false
  try {
    await seekTo(video, start)
    drawFrame()
    recorder.start(500)
    await video.play()

    await new Promise((resolve) => {
      const tick = () => {
        if (shouldCancel && shouldCancel()) {
          cancelled = true
          return resolve()
        }
        drawFrame()
        const t = video.currentTime
        if (onProgress) onProgress(Math.min(1, Math.max(0, (t - start) / duration)))
        if (t >= end || video.ended) return resolve()
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })

    video.pause()
    drawFrame()
    await new Promise((r) => setTimeout(r, 200)) // let the last frame reach the recorder
    if (recorder.state !== 'inactive') recorder.stop()
    await stopped
  } finally {
    try {
      if (recorder.state !== 'inactive') recorder.stop()
    } catch {
      // ignore
    }
    stream.getTracks().forEach((t) => t.stop())
    if (graph) {
      try {
        graph.source.disconnect()
        graph.source.connect(graph.ctx.destination)
      } catch {
        // ignore
      }
    }
    try {
      video.pause()
      video.currentTime = prevTime
    } catch {
      // ignore
    }
  }

  if (cancelled) return { blob: null, mimeType: null, ext: null, cancelled: true }

  const baseType = support.mimeType.split(';')[0]
  const blob = new Blob(chunks, { type: baseType })
  if (!blob.size) throw new Error('The export came out empty. Please try again.')
  if (onProgress) onProgress(1)
  return { blob, mimeType: baseType, ext: support.ext, cancelled: false }
}
