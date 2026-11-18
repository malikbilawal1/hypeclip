import { useEffect, useMemo, useRef, useState } from 'react'
import { exportClip, getExportSupport, releaseAudio } from '../lib/exporter.js'
import { addUsage } from '../lib/plans.js'
import './editor.css'

// All three platforms use the same 9:16 vertical format. The choice only
// changes the file name and the tip shown to the user.
const PLATFORMS = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'shorts', label: 'YouTube Shorts' },
  { id: 'reels', label: 'Instagram Reels' },
]

const MIN_LEN = 0.5

function fmt(t) {
  if (!isFinite(t)) return '0:00.0'
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return m + ':' + s.toFixed(1).padStart(4, '0')
}

export default function ClipEditor({ video, plan, used, limit, onExported, onGoUpload }) {
  const videoRef = useRef(null)
  const cancelRef = useRef(false)
  const resultUrlRef = useRef(null)

  const [duration, setDuration] = useState(0)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [previewing, setPreviewing] = useState(false)
  const [mode, setMode] = useState('crop')
  const [cropPos, setCropPos] = useState(0.5)
  const [platform, setPlatform] = useState('tiktok')
  const [height, setHeight] = useState(1280)
  const [status, setStatus] = useState('idle') // idle | exporting | done
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [playError, setPlayError] = useState(false)
  const [result, setResult] = useState(null)

  const support = useMemo(() => getExportSupport(), [])
  const limitReached = limit !== Infinity && used >= limit
  const clipLen = Math.max(0, end - start)
  const exporting = status === 'exporting'

  // free the audio context and result URL when leaving the editor
  useEffect(() => {
    const v = videoRef.current
    return () => {
      releaseAudio(v)
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    }
  }, [])

  // stop the preview exactly at the end time
  useEffect(() => {
    if (!previewing) return undefined
    const v = videoRef.current
    let raf
    const tick = () => {
      if (!v) return
      if (v.currentTime >= end || v.ended) {
        v.pause()
        setPreviewing(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [previewing, end])

  function onMeta() {
    const v = videoRef.current
    if (!v) return
    if (!isFinite(v.duration) || v.duration <= 0) {
      setError('Could not read the video length. Try an MP4 file.')
      return
    }
    setDuration(v.duration)
    setDims({ w: v.videoWidth, h: v.videoHeight })
    setStart(0)
    setEnd(Math.min(v.duration, 30))
  }

  function seek(t) {
    const v = videoRef.current
    if (!v) return
    v.pause()
    setPreviewing(false)
    v.currentTime = t
  }

  function changeStart(val) {
    const s = Math.min(Math.max(0, val), end - MIN_LEN)
    setStart(s)
    seek(s)
  }

  function changeEnd(val) {
    const e = Math.max(Math.min(duration, val), start + MIN_LEN)
    setEnd(e)
    seek(Math.max(start, e - 0.1))
  }

  function setStartHere() {
    const v = videoRef.current
    if (v) changeStart(v.currentTime)
  }

  function setEndHere() {
    const v = videoRef.current
    if (v) changeEnd(v.currentTime)
  }

  function previewClip() {
    const v = videoRef.current
    if (!v) return
    if (previewing) {
      v.pause()
      setPreviewing(false)
      return
    }
    v.currentTime = start
    setPreviewing(true)
    v.play().catch(() => setPreviewing(false))
  }

  // outline showing what part of the picture stays in 9:16
  const frame = useMemo(() => {
    if (mode !== 'crop' || !dims.w) return null
    const target = 9 / 16
    const src = dims.w / dims.h
    if (src > target) {
      const w = (target / src) * 100
      return { left: cropPos * (100 - w) + '%', top: 0, width: w + '%', height: '100%' }
    }
    if (src < target) {
      const h = (src / target) * 100
      return { left: 0, top: cropPos * (100 - h) + '%', width: '100%', height: h + '%' }
    }
    return null
  }, [mode, dims, cropPos])

  const landscape = dims.w >= dims.h

  async function handleExport() {
    const v = videoRef.current
    if (!v) return
    if (limitReached) {
      setError('You have used all of today\'s clips on the ' + plan.name + ' plan.')
      return
    }
    setError('')
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
    setResult(null)
    setPreviewing(false)
    setProgress(0)
    setStatus('exporting')
    cancelRef.current = false
    try {
      const res = await exportClip({
        video: v,
        start,
        end,
        mode,
        cropPos,
        height,
        watermark: plan.id === 'free',
        onProgress: setProgress,
        shouldCancel: () => cancelRef.current,
      })
      if (res.cancelled) {
        setStatus('idle')
        return
      }
      // the daily counter only goes up after a successful export
      const counted = addUsage()
      if (!counted) {
        setStatus('idle')
        setError('Daily clip limit reached, so this clip was not saved.')
        return
      }
      const url = URL.createObjectURL(res.blob)
      resultUrlRef.current = url
      const name = 'hypeclip-' + platform + '-' + Math.round(start) + 's.' + res.ext
      setResult({ url, blob: res.blob, name, ext: res.ext })
      setStatus('done')
      onExported()
    } catch (err) {
      setStatus('idle')
      setError((err && err.message) || 'Export failed.')
    }
  }

  async function handleShare() {
    if (!result) return
    try {
      const file = new File([result.blob], result.name, { type: result.blob.type })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'HypeClip clip' })
      } else {
        setError('Sharing files is not supported here. Use the Download button.')
      }
    } catch (err) {
      if (err && err.name !== 'AbortError') setError('Could not open the share sheet. Use Download instead.')
    }
  }

  const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare && !!navigator.share

  return (
    <div className="stack">
      <div className="editor-grid">
        <div className="card">
          <h3>
            Preview<span className="tag working">working</span>
          </h3>
          <div
            className="video-wrap"
            style={dims.w ? { aspectRatio: dims.w + ' / ' + dims.h, marginTop: 12 } : { marginTop: 12 }}
          >
            <video
              ref={videoRef}
              key={video.url}
              src={video.url}
              controls={!exporting}
              playsInline
              preload="auto"
              onLoadedMetadata={onMeta}
              onPause={() => setPreviewing(false)}
              onError={() => setPlayError(true)}
              style={exporting ? { pointerEvents: 'none' } : undefined}
            />
            {frame && <div className="crop-frame" style={frame} />}
          </div>
          {playError && (
            <div className="notice error" style={{ marginTop: 12 }}>
              This browser cannot play this video. Try Safari on iPhone, or an MP4 file.
            </div>
          )}
          <p style={{ marginTop: 10 }}>
            {video.name}
            {dims.w ? ' · ' + dims.w + 'x' + dims.h : ''}
            {duration ? ' · ' + fmt(duration) : ''}
          </p>
        </div>

        <div className="card">
          <h3>Trim</h3>
          <div className="stack" style={{ marginTop: 10 }}>
            <div className="field">
              <label>
                Start <b>{fmt(start)}</b>
              </label>
              <input
                type="range"
                min="0"
                max={duration || 0}
                step="0.1"
                value={start}
                disabled={!duration || exporting}
                onChange={(e) => changeStart(parseFloat(e.target.value))}
              />
              <div className="row">
                <button className="btn small" disabled={exporting} onClick={() => changeStart(start - 0.5)}>
                  -0.5s
                </button>
                <button className="btn small" disabled={exporting} onClick={() => changeStart(start + 0.5)}>
                  +0.5s
                </button>
                <button className="btn small" disabled={exporting} onClick={setStartHere}>
                  Use current frame
                </button>
              </div>
            </div>

            <div className="field">
              <label>
                End <b>{fmt(end)}</b>
              </label>
              <input
                type="range"
                min="0"
                max={duration || 0}
                step="0.1"
                value={end}
                disabled={!duration || exporting}
                onChange={(e) => changeEnd(parseFloat(e.target.value))}
              />
              <div className="row">
                <button className="btn small" disabled={exporting} onClick={() => changeEnd(end - 0.5)}>
                  -0.5s
                </button>
                <button className="btn small" disabled={exporting} onClick={() => changeEnd(end + 0.5)}>
                  +0.5s
                </button>
                <button className="btn small" disabled={exporting} onClick={setEndHere}>
                  Use current frame
                </button>
              </div>
            </div>

            <p style={{ margin: 0 }}>
              Clip length: <b style={{ color: 'var(--text)' }}>{fmt(clipLen)}</b>
            </p>
            <button className="btn block" disabled={!duration || exporting} onClick={previewClip}>
              {previewing ? 'Stop preview' : 'Preview selected clip'}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>
          9:16 vertical export<span className="tag working">working</span>
        </h3>
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="field">
            <label>Export for</label>
            <div className="chips">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  className={'chip' + (platform === p.id ? ' active' : '')}
                  disabled={exporting}
                  onClick={() => setPlatform(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p style={{ margin: 0 }}>All three use the same 9:16 vertical format. The choice only names the file.</p>
          </div>

          <div className="field">
            <label>Framing</label>
            <div className="chips">
              <button className={'chip' + (mode === 'crop' ? ' active' : '')} disabled={exporting} onClick={() => setMode('crop')}>
                Crop to fill
              </button>
              <button className={'chip' + (mode === 'fit' ? ' active' : '')} disabled={exporting} onClick={() => setMode('fit')}>
                Fit with black bars
              </button>
            </div>
          </div>

          {mode === 'crop' && frame && (
            <div className="field">
              <label>
                Crop position <b>{landscape ? 'Left to right' : 'Top to bottom'}</b>
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={cropPos}
                disabled={exporting}
                onChange={(e) => setCropPos(parseFloat(e.target.value))}
              />
            </div>
          )}

          <div className="field">
            <label>Quality</label>
            <div className="chips">
              <button className={'chip' + (height === 1280 ? ' active' : '')} disabled={exporting} onClick={() => setHeight(1280)}>
                720x1280 (faster)
              </button>
              <button className={'chip' + (height === 1920 ? ' active' : '')} disabled={exporting} onClick={() => setHeight(1920)}>
                1080x1920
              </button>
            </div>
          </div>

          {!support.supported && (
            <div className="notice error">
              This browser cannot record video, so in-browser export is not available. Working alternative: on iPhone,
              open the video in Photos, tap Edit, and trim it with the slider. Then use Safari (iOS 14.3 or newer) or
              Chrome on a computer to export the 9:16 version here.
            </div>
          )}
          {support.supported && !support.isMp4 && (
            <div className="notice warn">
              This browser exports WebM, not MP4. Some apps will not accept WebM. For MP4 output, open HypeClip in
              Safari on your iPhone.
            </div>
          )}
          <div className="notice">
            Export runs in real time: a 20 second clip takes about 20 seconds. Keep the screen on and this tab open
            until it finishes.
            {plan.id === 'free' ? ' The Free plan adds a small HypeClip watermark.' : ''}
          </div>

          {limitReached && (
            <div className="notice warn">
              You have used all {limit} clips for today on the {plan.name} plan. Come back tomorrow or switch plan in
              the Overview tab (demo only).
            </div>
          )}
          {error && <div className="notice error">{error}</div>}

          {exporting && (
            <div className="stack" style={{ marginTop: 0 }}>
              <div className="progress">
                <div style={{ width: Math.round(progress * 100) + '%' }} />
              </div>
              <button className="btn block" onClick={() => (cancelRef.current = true)}>
                Cancel export ({Math.round(progress * 100)}%)
              </button>
            </div>
          )}

          {!exporting && (
            <button
              className="btn primary block"
              disabled={!support.supported || !duration || limitReached || playError}
              onClick={handleExport}
            >
              Export 9:16 clip ({limit === Infinity ? 'unlimited' : Math.max(0, limit - used) + ' left today'})
            </button>
          )}
        </div>
      </div>

      {result && (
        <div className="card result">
          <h3>
            Your clip is ready<span className="tag working">done</span>
          </h3>
          <video src={result.url} controls playsInline style={{ marginTop: 12 }} />
          <div className="row" style={{ marginTop: 12 }}>
            <a className="btn primary" href={result.url} download={result.name}>
              Download .{result.ext}
            </a>
            {canShareFiles && (
              <button className="btn" onClick={handleShare}>
                Share / Save to Photos
              </button>
            )}
          </div>
          <div className="notice ok" style={{ marginTop: 12 }}>
            Counted 1 clip toward today's limit.
          </div>
        </div>
      )}

      <div>
        <button className="btn small" onClick={onGoUpload} disabled={exporting}>
          Choose a different video
        </button>
      </div>
    </div>
  )
}
