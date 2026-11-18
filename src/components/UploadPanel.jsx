import { useRef, useState } from 'react'
import './editor.css'

const OK_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const OK_EXT = ['mp4', 'mov', 'webm']

function isAllowed(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  return OK_TYPES.includes(file.type) || OK_EXT.includes(ext)
}

function fmtSize(bytes) {
  if (bytes > 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

export default function UploadPanel({ video, onSelect, onClear, onOpenEditor }) {
  const inputRef = useRef(null)
  const [error, setError] = useState('')
  const [over, setOver] = useState(false)
  const [playError, setPlayError] = useState(false)

  function handleFile(file) {
    setError('')
    setPlayError(false)
    if (!file) return
    if (!isAllowed(file)) {
      setError('Unsupported file. Please choose an MP4, MOV or WebM video.')
      return
    }
    onSelect(file)
  }

  return (
    <div className="stack">
      {!video && (
        <div
          className={'drop' + (over ? ' over' : '')}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            handleFile(e.dataTransfer.files && e.dataTransfer.files[0])
          }}
        >
          <h3 style={{ margin: 0 }}>
            Upload a video<span className="tag working">working</span>
          </h3>
          <p>MP4, MOV or WebM. Your video stays on your device and is never uploaded to a server.</p>
          <button className="btn primary" onClick={() => inputRef.current && inputRef.current.click()}>
            Choose video
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        className="hidden-input"
        type="file"
        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
        onChange={(e) => {
          handleFile(e.target.files && e.target.files[0])
          e.target.value = ''
        }}
      />

      {error && <div className="notice error">{error}</div>}

      {video && (
        <div className="card">
          <h3>{video.name}</h3>
          <p>{fmtSize(video.size)}</p>
          <div className="video-wrap" style={{ marginTop: 12 }}>
            <video
              key={video.url}
              src={video.url}
              controls
              playsInline
              preload="metadata"
              onError={() => setPlayError(true)}
            />
          </div>
          {playError && (
            <div className="notice error" style={{ marginTop: 12 }}>
              This browser cannot play this file. On iPhone, Safari plays most MP4 and MOV files. WebM may not
              play on older iOS versions.
            </div>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={onOpenEditor} disabled={playError}>
              Open in clip editor
            </button>
            <button className="btn" onClick={() => inputRef.current && inputRef.current.click()}>
              Choose another
            </button>
            <button className="btn" onClick={onClear}>
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
