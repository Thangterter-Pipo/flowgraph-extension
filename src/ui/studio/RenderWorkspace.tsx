import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Film, Gauge, HardDriveDownload, Loader2, MonitorUp, Music2, Play, Settings2, Square, Subtitles } from 'lucide-react';
import type { FilmProject } from '../../types/film';
import { allShots } from './filmModel';
import { renderPreflightChecks } from './productionChecks';

type Props = {
  project: FilmProject;
};

type RenderPreset = '1080P' | '4K';
type VideoCodec = 'H264' | 'H265';
type RenderStatus = 'IDLE' | 'QUEUED' | 'RUNNING' | 'DONE' | 'ERROR' | 'CANCELLED' | 'OFFLINE';

const presetMap: Record<RenderPreset, { width: number; height: number }> = {
  '1080P': { width: 1920, height: 1080 },
  '4K': { width: 3840, height: 2160 },
};

function fmt(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export default function RenderWorkspace({ project }: Props) {
  const [preset, setPreset] = useState<RenderPreset>('1080P');
  const [codec, setCodec] = useState<VideoCodec>('H264');
  const [bitrate, setBitrate] = useState('18M');
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [status, setStatus] = useState<RenderStatus>('IDLE');
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<string>();
  const [outputPath, setOutputPath] = useState<string>();
  const [serviceOnline, setServiceOnline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('http://127.0.0.1:3091/health')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Render service unavailable')))
      .then(() => { if (!cancelled) setServiceOnline(true); })
      .catch(() => { if (!cancelled) { setServiceOnline(false); setStatus('OFFLINE'); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!jobId || !['QUEUED', 'RUNNING'].includes(status)) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:3091/status/${jobId}`);
        if (!response.ok) return;
        const data = await response.json() as { status?: RenderStatus; progress?: number; output?: string };
        if (data.status) setStatus(data.status);
        if (typeof data.progress === 'number') setProgress(data.progress);
        if (data.output) setOutputPath(data.output);
      } catch {
        setServiceOnline(false);
        setStatus('OFFLINE');
      }
    }, 600);
    return () => window.clearInterval(timer);
  }, [jobId, status]);

  const timelineDuration = useMemo(() => project.timeline.flatMap((track) => track.clips).reduce((max, clip) => Math.max(max, clip.startSeconds + clip.durationSeconds), 0), [project]);
  const approvedShots = useMemo(() => allShots(project).filter((shot) => shot.status === 'APPROVED' || shot.status === 'LOCKED').length, [project]);
  const activeVideoClips = useMemo(() => project.timeline.filter((track) => track.type === 'VIDEO' && !track.muted).flatMap((track) => track.clips), [project]);
  const audioTracks = project.timeline.filter((track) => ['DIALOGUE', 'SFX', 'MUSIC'].includes(track.type) && !track.muted).length;
  const subtitleClips = project.timeline.filter((track) => track.type === 'SUBTITLE' && !track.muted).flatMap((track) => track.clips).length;
  const preflight = useMemo(() => renderPreflightChecks(project), [project]);
  const preflightErrors = preflight.filter((item) => item.severity === 'ERROR').length;
  const preflightWarnings = preflight.filter((item) => item.severity === 'WARNING').length;
  const resolution = presetMap[preset];

  const makeRenderJob = () => {
    const takes = new Map(allShots(project).flatMap((shot) => shot.takes.map((take) => [take.id, take] as const)));
    const timeline = project.timeline.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        const take = clip.takeId ? takes.get(clip.takeId) : undefined;
        return {
          ...clip,
          source: take ? {
            takeId: take.id,
            mediaId: take.mediaId,
            localPath: take.localPath,
            previewUrl: take.previewUrl,
            fileName: take.fileName,
            mimeType: take.mimeType,
          } : undefined,
        };
      }),
    }));
    return {
    schemaVersion: 1,
    projectId: project.id,
    projectTitle: project.title,
    timeline,
    settings: {
      width: resolution.width,
      height: resolution.height,
      frameRate: project.frameRate,
      codec,
      bitrate,
      includeAudio,
      burnSubtitles,
      container: 'mp4',
    },
  };
  };

  const exportJob = () => {
    const blob = new Blob([JSON.stringify(makeRenderJob(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'film'}-render-job.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const queueRender = async () => {
    if (status === 'RUNNING' || status === 'QUEUED' || preflightErrors > 0) return;
    setProgress(0);
    setOutputPath(undefined);
    try {
      const response = await fetch('http://127.0.0.1:3091/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeRenderJob()),
      });
      if (!response.ok) throw new Error(`Render service returned ${response.status}`);
      const data = await response.json() as { jobId: string; status?: RenderStatus; output?: string };
      setServiceOnline(true);
      setJobId(data.jobId);
      setStatus(data.status ?? 'QUEUED');
      if (data.output) setOutputPath(data.output);
    } catch (error) {
      console.warn('[FlowGraph] Local render service unavailable', error);
      setServiceOnline(false);
      setStatus('OFFLINE');
    }
  };

  const cancelRender = async () => {
    if (!jobId) return;
    try {
      const response = await fetch(`http://127.0.0.1:3091/cancel/${jobId}`, { method: 'POST', body: '{}' });
      if (response.ok) setStatus('CANCELLED');
    } catch (error) {
      console.warn('[FlowGraph] Could not cancel render', error);
    }
  };

  return (
    <main className="render-workspace">
      <section className="render-main">
        <header className="render-header">
          <div>
            <div className="film-kicker">DELIVERY / MASTER</div>
            <h2>Render & Export</h2>
            <p>Package the master timeline as an FFmpeg render job, then render through the local FlowGraph render worker.</p>
          </div>
          <button className="fg-btn" onClick={exportJob}><HardDriveDownload size={14} /> Export Render Job</button>
        </header>

        <div className="render-monitor">
          <div className="render-monitor-screen">
            <MonitorUp size={34} />
            <strong>{project.title}</strong>
            <span>{project.aspectRatio} · {project.frameRate} FPS · {fmt(timelineDuration)}</span>
          </div>
          <div className="render-health-grid">
            <div><Film size={15} /><span>Picture</span><strong>{activeVideoClips.length} clips</strong></div>
            <div><Music2 size={15} /><span>Audio</span><strong>{audioTracks} tracks</strong></div>
            <div><Subtitles size={15} /><span>Subtitle</span><strong>{subtitleClips} clips</strong></div>
            <div><CheckCircle2 size={15} /><span>Approved shots</span><strong>{approvedShots}</strong></div>
          </div>
        </div>

        <section className="render-queue-card">
          <div className="render-queue-title"><Gauge size={14} /><strong>Render queue</strong><span>{preflightErrors ? `PREFLIGHT · ${preflightErrors} BLOCKER${preflightErrors === 1 ? '' : 'S'}` : preflightWarnings ? `READY · ${preflightWarnings} WARNING${preflightWarnings === 1 ? '' : 'S'}` : status}</span></div>
          <div className="render-progress"><span style={{ width: `${progress}%` }} /></div>
          <div className="render-progress-copy"><span>{progress}%</span><span>{status === 'DONE' ? 'Master ready' : status === 'RUNNING' ? 'Encoding frames…' : status === 'QUEUED' ? 'Waiting for worker…' : status === 'ERROR' ? 'Render failed' : status === 'CANCELLED' ? 'Render cancelled' : status === 'OFFLINE' ? 'Render service offline' : 'Ready to queue'}</span></div>
          <div style={{ display: 'flex', gap: 7 }}>
            <button className="fg-btn fg-btn-primary" onClick={() => void queueRender()} disabled={status === 'RUNNING' || status === 'QUEUED' || preflightErrors > 0} title={preflightErrors ? 'Resolve Render Preflight blockers before rendering' : 'Queue master render'}>
              {status === 'RUNNING' || status === 'QUEUED' ? <Loader2 size={14} /> : <Play size={14} />} {preflightErrors ? 'Preflight Blocked' : status === 'DONE' ? 'Render Again' : 'Queue Render'}
            </button>
            {(status === 'RUNNING' || status === 'QUEUED') && <button className="fg-btn" onClick={() => void cancelRender()}><Square size={13} /> Cancel</button>}
          </div>
          <small>{serviceOnline ? `Local FFmpeg service connected${outputPath ? ` · ${outputPath}` : ''}` : 'Start scripts/render_service.py to enable direct rendering. Export Render Job remains available as a fallback.'}</small>
        </section>
      </section>

      <aside className="render-settings">
        <div className="render-settings-head"><Settings2 size={14} /><strong>MASTER SETTINGS</strong></div>
        <div className="render-settings-body">
          <label><span>Resolution</span><select value={preset} onChange={(event) => setPreset(event.target.value as RenderPreset)}><option>1080P</option><option>4K</option></select></label>
          <label><span>Codec</span><select value={codec} onChange={(event) => setCodec(event.target.value as VideoCodec)}><option value="H264">H.264</option><option value="H265">H.265 / HEVC</option></select></label>
          <label><span>Bitrate</span><input value={bitrate} onChange={(event) => setBitrate(event.target.value)} placeholder="18M" /></label>
          <label><span>Frame rate</span><input value={`${project.frameRate} fps`} disabled /></label>
          <label><span>Container</span><input value="MP4" disabled /></label>
          <button className={`render-toggle ${includeAudio ? 'active' : ''}`} onClick={() => setIncludeAudio((value) => !value)}><span>Include audio mix</span><strong>{includeAudio ? 'ON' : 'OFF'}</strong></button>
          <button className={`render-toggle ${burnSubtitles ? 'active' : ''}`} onClick={() => setBurnSubtitles((value) => !value)}><span>Burn subtitles</span><strong>{burnSubtitles ? 'ON' : 'OFF'}</strong></button>

          <div className="render-command-preview">
            <span>FFmpeg target</span>
            <code>{codec === 'H265' ? 'libx265' : 'libx264'} · {resolution.width}×{resolution.height} · {bitrate}</code>
          </div>
        </div>
      </aside>
    </main>
  );
}
