import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PLANS, getPlan, setPlan, getUsage } from '../lib/plans.js'
import UploadPanel from '../components/UploadPanel.jsx'
import ClipEditor from '../components/ClipEditor.jsx'

const TABS = ['Overview', 'Twitch', 'YouTube', 'Kick', 'Upload', 'Editor']
const PLATFORM_TABS = ['Twitch', 'YouTube', 'Kick']

export default function Dashboard() {
  const [tab, setTab] = useState('Overview')
  const [planId, setPlanId] = useState(getPlan().id)
  const [used, setUsed] = useState(getUsage())
  const [video, setVideo] = useState(null) // { file, url, name, size }
  const urlRef = useRef(null)

  const plan = PLANS.find((p) => p.id === planId)
  const limit = plan.clipsPerDay
  const pct = limit === Infinity ? 5 : Math.min(100, (used / limit) * 100)

  // release the video's memory when leaving the dashboard
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  function choose(id) {
    setPlan(id)
    setPlanId(id)
  }

  function selectVideo(file) {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    const url = URL.createObjectURL(file)
    urlRef.current = url
    setVideo({ file, url, name: file.name, size: file.size })
  }

  function clearVideo() {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
    setVideo(null)
  }

  return (
    <div className="container">
      <nav className="nav">
        <Link to="/" className="logo">Hype<span>Clip</span></Link>
        <span className="tag working">{plan.name} plan</span>
      </nav>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={'tab' + (t === tab ? ' active' : '')} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="grid" style={{ marginTop: 16 }}>
          <div className="card">
            <h3>Clips today<span className="tag working">working</span></h3>
            <div className="meter"><div style={{ width: pct + '%' }} /></div>
            <p>{used} / {limit === Infinity ? 'unlimited' : limit} used</p>
          </div>
          <div className="card">
            <h3>Switch plan (demo)<span className="tag placeholder">placeholder</span></h3>
            <p>No real billing yet. This only changes your limit locally.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {PLANS.map((p) => (
                <button key={p.id} className="btn" onClick={() => choose(p.id)}>{p.name}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {PLATFORM_TABS.includes(tab) && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>{tab}<span className="tag placeholder">coming in a later step</span></h3>
          <p>This section is a placeholder. It will be built in a later step.</p>
        </div>
      )}

      {tab === 'Upload' && (
        <UploadPanel
          video={video}
          onSelect={selectVideo}
          onClear={clearVideo}
          onOpenEditor={() => setTab('Editor')}
        />
      )}

      {tab === 'Editor' && !video && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Clip editor</h3>
          <p>Upload a video first, then come back here to trim and export it.</p>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => setTab('Upload')}>
            Go to Upload
          </button>
        </div>
      )}

      {tab === 'Editor' && video && (
        <ClipEditor
          video={video}
          plan={plan}
          used={used}
          limit={limit}
          onExported={() => setUsed(getUsage())}
          onGoUpload={() => setTab('Upload')}
        />
      )}
    </div>
  )
}
