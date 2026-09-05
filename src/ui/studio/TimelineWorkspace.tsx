import React, { useEffect, useMemo, useState } from 'react';
import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Film,
  Gauge,
  Layers3,
  Link2,
  Lock,
  MessageSquareText,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  SkipBack,
  SkipForward,
  Subtitles,
  Trash2,
  Unlock,
  Video,
  Volume2,
  VolumeX,
  WandSparkles,
} from 'lucide-react';
import type { FilmProject, TimelineClip, TimelineTrack, TimelineTrackType } from '../../types/film';
import { allShots, projectDuration } from './filmModel';

type Props = {
  project: FilmProject;
  setProject: React.Dispatch<React.SetStateAction<FilmProject>>;
  openShotManager?: (shotId: string) => void;
};

type TransitionKind = NonNullable<TimelineClip['transitionIn']>;

const trackMeta: Record<TimelineTrackType, { label: string; icon: React.ReactNode }> = {
  VIDEO: { label: 'Video', icon: <Film size={14} /> },
  DIALOGUE: { label: 'Dialogue', icon: <MessageSquareText size={14} /> },
  SFX: { label: 'SFX', icon: <Volume2 size={14} /> },
  MUSIC: { label: 'Music', icon: <Music2 size={14} /> },
  SUBTITLE: { label: 'Subtitle', icon: <Subtitles size={14} /> },
};

const transitionOptions: TransitionKind[] = ['NONE', 'DISSOLVE', 'FADE', 'WIPE'];

function fmt(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const tenths = Math.floor((Math.max(0, seconds) % 1) * 10);
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`
    : `${m}:${String(s).padStart(2, '0')}.${tenths}`;
}

function makeClip(trackId: string, shotId: string, takeId: string | undefined, startSeconds: number, durationSeconds: number): TimelineClip {
  return {
    id: `${trackId}-${shotId}`,
    trackId,
    shotId,
    takeId,
    startSeconds,
    durationSeconds,
    sourceDurationSeconds: durationSeconds,
    trimInSeconds: 0,
    trimOutSeconds: 0,
    transitionIn: 'NONE',
    transitionOut: 'NONE',
  };
}

function defaultTrack(projectId: string, type: TimelineTrackType, name: string, id: string): TimelineTrack {
  return { id, projectId, type, name, clips: [], muted: false, locked: false };
}

function buildAssembly(project: FilmProject): TimelineTrack[] {
  const shots = allShots(project).filter((shot) => shot.status === 'APPROVED' || shot.status === 'LOCKED');
  const videoTrackId = 'timeline-video-main';
  const dialogueTrackId = 'timeline-dialogue-main';
  let cursor = 0;
  const videoClips: TimelineClip[] = [];
  const dialogueClips: TimelineClip[] = [];

  shots.forEach((shot) => {
    videoClips.push(makeClip(videoTrackId, shot.id, shot.selectedTakeId, cursor, shot.durationSeconds));
    if (shot.dialogue?.trim()) dialogueClips.push(makeClip(dialogueTrackId, shot.id, shot.selectedTakeId, cursor, shot.durationSeconds));
    cursor += shot.durationSeconds;
  });

  const firstOfType = (type: TimelineTrackType) => project.timeline.find((track) => track.type === type);
  const video = firstOfType('VIDEO') ?? defaultTrack(project.id, 'VIDEO', 'Picture Lock', videoTrackId);
  const dialogue = firstOfType('DIALOGUE') ?? defaultTrack(project.id, 'DIALOGUE', 'Dialogue', dialogueTrackId);
  const extras = project.timeline.filter((track) => track.id !== video.id && track.id !== dialogue.id);
  const ensuredTypes: TimelineTrack[] = [
    project.timeline.some((track) => track.type === 'SFX') ? null : defaultTrack(project.id, 'SFX', 'Sound Effects', 'timeline-sfx-main'),
    project.timeline.some((track) => track.type === 'MUSIC') ? null : defaultTrack(project.id, 'MUSIC', 'Music', 'timeline-music-main'),
    project.timeline.some((track) => track.type === 'SUBTITLE') ? null : defaultTrack(project.id, 'SUBTITLE', 'Subtitles', 'timeline-subtitle-main'),
  ].filter(Boolean) as TimelineTrack[];

  return [
    { ...video, id: videoTrackId, name: video.name || 'Picture Lock', clips: videoClips },
    { ...dialogue, id: dialogueTrackId, name: dialogue.name || 'Dialogue', clips: dialogueClips },
    ...extras.filter((track) => track.type !== 'VIDEO' && track.type !== 'DIALOGUE'),
    ...ensuredTypes,
  ];
}

function timelineEnd(tracks: TimelineTrack[]) {
  return tracks.flatMap((track) => track.clips).reduce((max, clip) => Math.max(max, clip.startSeconds + clip.durationSeconds), 0);
}

function snapTime(value: number, enabled: boolean) {
  if (!enabled) return Math.max(0, value);
  return Math.max(0, Math.round(value * 2) / 2);
}

export default function TimelineWorkspace({ project, setProject, openShotManager }: Props) {
  const shots = useMemo(() => allShots(project), [project]);
  const timelineTracks = useMemo(() => project.timeline.length ? project.timeline : buildAssembly({ ...project, timeline: [] }), [project]);
  const approvedShots = shots.filter((shot) => shot.status === 'APPROVED' || shot.status === 'LOCKED');
  const timelineDuration = timelineEnd(timelineTracks);
  const plannedDuration = projectDuration(project);
  const target = project.targetDurationSeconds ?? plannedDuration;

  const [selectedClipId, setSelectedClipId] = useState<string>('');
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [ripple, setRipple] = useState(true);
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [newTrackType, setNewTrackType] = useState<TimelineTrackType>('VIDEO');

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setPlayhead((value) => {
        const end = Math.max(timelineDuration, target, 1);
        if (value >= end) {
          setIsPlaying(false);
          return end;
        }
        return Math.min(end, value + 0.1);
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [isPlaying, timelineDuration, target]);

  useEffect(() => {
    if (playhead > Math.max(timelineDuration, target)) setPlayhead(Math.max(timelineDuration, target));
  }, [playhead, target, timelineDuration]);

  const selectedTrack = timelineTracks.find((track) => track.clips.some((clip) => clip.id === selectedClipId));
  const selectedClip = selectedTrack?.clips.find((clip) => clip.id === selectedClipId);
  const selectedShot = selectedClip?.shotId ? shots.find((shot) => shot.id === selectedClip.shotId) : undefined;
  const selectedTake = selectedShot?.takes.find((take) => take.id === selectedClip?.takeId);

  const activeVideo = timelineTracks
    .filter((track) => track.type === 'VIDEO' && !track.muted)
    .flatMap((track) => track.clips)
    .filter((clip) => playhead >= clip.startSeconds && playhead < clip.startSeconds + clip.durationSeconds)
    .at(-1);
  const activeShot = activeVideo?.shotId ? shots.find((shot) => shot.id === activeVideo.shotId) : undefined;
  const activeTake = activeShot?.takes.find((take) => take.id === activeVideo?.takeId);

  const scaleDuration = Math.max(timelineDuration, target, 30);
  const displayDuration = Math.max(10, scaleDuration / zoom);
  const timelineWidth = Math.max(100, zoom * 100);
  const tickStep = displayDuration > 1800 ? 300 : displayDuration > 600 ? 120 : displayDuration > 180 ? 60 : displayDuration > 60 ? 15 : 5;
  const ticks = Array.from({ length: Math.floor(scaleDuration / tickStep) + 1 }, (_, index) => index * tickStep);

  const persistTracks = (updater: (tracks: TimelineTrack[]) => TimelineTrack[]) => {
    setProject((current) => {
      const base = current.timeline.length ? current.timeline : buildAssembly({ ...current, timeline: [] });
      return { ...current, timeline: updater(base), updatedAt: new Date().toISOString() };
    });
  };

  const assemble = () => {
    setProject((current) => ({
      ...current,
      timeline: buildAssembly(current),
      updatedAt: new Date().toISOString(),
      status: current.status === 'DEVELOPMENT' ? 'PRODUCTION' : current.status,
    }));
    setSelectedClipId('');
    setPlayhead(0);
  };

  const setTarget = (seconds: number) => {
    setProject((current) => ({ ...current, targetDurationSeconds: Math.max(1, seconds), updatedAt: new Date().toISOString() }));
  };

  const patchTrack = (trackId: string, patch: Partial<TimelineTrack>) => persistTracks((tracks) => tracks.map((track) => track.id === trackId ? { ...track, ...patch } : track));

  const patchClip = (clipId: string, patch: Partial<TimelineClip>, durationDelta = 0) => {
    persistTracks((tracks) => tracks.map((track) => {
      const index = track.clips.findIndex((clip) => clip.id === clipId);
      if (index < 0) return track;
      const current = track.clips[index];
      const next = { ...current, ...patch };
      const clips = track.clips.map((clip, clipIndex) => {
        if (clipIndex === index) return next;
        if (ripple && durationDelta !== 0 && clip.startSeconds >= current.startSeconds + current.durationSeconds - 0.001) {
          return { ...clip, startSeconds: Math.max(0, clip.startSeconds + durationDelta) };
        }
        return clip;
      });
      return { ...track, clips };
    }));
  };

  const setTrim = (kind: 'in' | 'out', value: number) => {
    if (!selectedClip) return;
    const source = selectedClip.sourceDurationSeconds ?? selectedClip.durationSeconds + (selectedClip.trimInSeconds ?? 0) + (selectedClip.trimOutSeconds ?? 0);
    const other = kind === 'in' ? (selectedClip.trimOutSeconds ?? 0) : (selectedClip.trimInSeconds ?? 0);
    const safe = Math.max(0, Math.min(value, source - other - 0.25));
    const nextDuration = Math.max(0.25, source - other - safe);
    const delta = nextDuration - selectedClip.durationSeconds;
    patchClip(selectedClip.id, {
      sourceDurationSeconds: source,
      durationSeconds: nextDuration,
      ...(kind === 'in' ? { trimInSeconds: safe } : { trimOutSeconds: safe }),
    }, delta);
  };

  const setClipDuration = (value: number) => {
    if (!selectedClip) return;
    const next = Math.max(0.25, value);
    const delta = next - selectedClip.durationSeconds;
    patchClip(selectedClip.id, { durationSeconds: next, sourceDurationSeconds: Math.max(selectedClip.sourceDurationSeconds ?? 0, next + (selectedClip.trimInSeconds ?? 0) + (selectedClip.trimOutSeconds ?? 0)) }, delta);
  };

  const splitClip = () => {
    if (!selectedTrack || !selectedClip) return;
    const local = playhead - selectedClip.startSeconds;
    if (local <= 0.1 || local >= selectedClip.durationSeconds - 0.1) return;
    const rightDuration = selectedClip.durationSeconds - local;
    const source = selectedClip.sourceDurationSeconds ?? selectedClip.durationSeconds + (selectedClip.trimInSeconds ?? 0) + (selectedClip.trimOutSeconds ?? 0);
    const rightId = `${selectedClip.id}-split-${Date.now()}`;
    persistTracks((tracks) => tracks.map((track) => {
      if (track.id !== selectedTrack.id) return track;
      const clips = track.clips.flatMap((clip) => {
        if (clip.id !== selectedClip.id) return [clip];
        const left: TimelineClip = {
          ...clip,
          durationSeconds: local,
          sourceDurationSeconds: source,
          trimOutSeconds: (clip.trimOutSeconds ?? 0) + rightDuration,
          transitionOut: 'NONE',
        };
        const right: TimelineClip = {
          ...clip,
          id: rightId,
          startSeconds: playhead,
          durationSeconds: rightDuration,
          sourceDurationSeconds: source,
          trimInSeconds: (clip.trimInSeconds ?? 0) + local,
          transitionIn: 'NONE',
        };
        return [left, right];
      });
      return { ...track, clips };
    }));
    setSelectedClipId(rightId);
  };

  const deleteClip = () => {
    if (!selectedTrack || !selectedClip) return;
    const removedStart = selectedClip.startSeconds;
    const removedDuration = selectedClip.durationSeconds;
    persistTracks((tracks) => tracks.map((track) => {
      if (track.id !== selectedTrack.id) return track;
      return {
        ...track,
        clips: track.clips
          .filter((clip) => clip.id !== selectedClip.id)
          .map((clip) => ripple && clip.startSeconds >= removedStart + removedDuration - 0.001 ? { ...clip, startSeconds: Math.max(0, clip.startSeconds - removedDuration) } : clip),
      };
    }));
    setSelectedClipId('');
  };

  const addTrack = () => {
    persistTracks((tracks) => {
      const count = tracks.filter((track) => track.type === newTrackType).length + 1;
      const id = `timeline-${newTrackType.toLowerCase()}-${Date.now()}`;
      return [...tracks, defaultTrack(project.id, newTrackType, `${trackMeta[newTrackType].label} ${count}`, id)];
    });
  };

  const moveClip = (clipId: string, targetTrackId: string, rawStart: number) => {
    const sourceTrack = timelineTracks.find((track) => track.clips.some((clip) => clip.id === clipId));
    const targetTrack = timelineTracks.find((track) => track.id === targetTrackId);
    const clip = sourceTrack?.clips.find((item) => item.id === clipId);
    if (!sourceTrack || !targetTrack || !clip || sourceTrack.type !== targetTrack.type || targetTrack.locked) return;
    const startSeconds = snapTime(rawStart, snap);
    persistTracks((tracks) => {
      let moving: TimelineClip | undefined;
      const removed = tracks.map((track) => {
        const found = track.clips.find((item) => item.id === clipId);
        if (found) moving = found;
        return { ...track, clips: track.clips.filter((item) => item.id !== clipId) };
      });
      if (!moving) return tracks;
      return removed.map((track) => track.id === targetTrackId
        ? { ...track, clips: [...track.clips, { ...moving!, trackId: targetTrackId, startSeconds }].sort((a, b) => a.startSeconds - b.startSeconds) }
        : track);
    });
  };

  const positionFromPointer = (event: React.MouseEvent | React.DragEvent, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return snapTime(ratio * scaleDuration, snap);
  };

  const jump = (delta: number) => setPlayhead((value) => Math.max(0, Math.min(Math.max(timelineDuration, target), value + delta)));

  return (
    <main className="timeline-workspace timeline-v2">
      <header className="timeline-header">
        <div>
          <div className="film-kicker">EDIT / ASSEMBLY</div>
          <h2>Master Timeline</h2>
          <p>Cut approved takes into a film-length sequence with non-destructive trim, ripple editing, transitions and layered sound.</p>
        </div>
        <div className="timeline-header-actions">
          <button className={`fg-btn timeline-toggle ${ripple ? 'active' : ''}`} onClick={() => setRipple((value) => !value)}><Link2 size={13} /> Ripple</button>
          <button className={`fg-btn timeline-toggle ${snap ? 'active' : ''}`} onClick={() => setSnap((value) => !value)}><WandSparkles size={13} /> Snap</button>
          <button className="fg-btn fg-btn-primary" onClick={assemble}><RefreshCw size={14} /> Auto Assemble</button>
        </div>
      </header>

      <section className="timeline-summary">
        <div><Layers3 size={15} /><span>Approved shots</span><strong>{approvedShots.length}/{shots.length}</strong></div>
        <div><Film size={15} /><span>Timeline</span><strong>{fmt(timelineDuration)}</strong></div>
        <div><Gauge size={15} /><span>Planned shots</span><strong>{fmt(plannedDuration)}</strong></div>
        <label><span>Target duration</span><input type="number" min="1" value={target} onChange={(event) => setTarget(Number(event.target.value) || 1)} /><em>sec</em></label>
      </section>

      <section className="timeline-stage">
        <div className="timeline-monitor">
          <div className="timeline-monitor-screen">
            {(activeTake?.proxyUrl || activeTake?.previewUrl) ? (
              <video src={activeTake.proxyUrl || activeTake.previewUrl} muted playsInline />
            ) : (
              <div className="timeline-monitor-placeholder">
                <Video size={38} />
                <strong>{activeShot ? `SHOT ${activeShot.shotNumber} · ${activeShot.title}` : 'PROGRAM MONITOR'}</strong>
                <span>{activeShot?.description ?? 'Move the playhead over a video clip to preview the linked shot/take.'}</span>
              </div>
            )}
            <div className="timeline-timecode">{fmt(playhead)}</div>
          </div>
          <div className="timeline-transport">
            <button onClick={() => setPlayhead(0)} title="Go to start"><SkipBack size={14} /></button>
            <button onClick={() => jump(-1)} title="Previous second"><ChevronLeft size={15} /></button>
            <button className="primary" onClick={() => setIsPlaying((value) => !value)}>{isPlaying ? <Pause size={15} /> : <Play size={15} />}</button>
            <button onClick={() => jump(1)} title="Next second"><ChevronRight size={15} /></button>
            <button onClick={() => setPlayhead(Math.max(timelineDuration, target))} title="Go to end"><SkipForward size={14} /></button>
            <span>{activeShot ? `S${activeShot.shotNumber}` : 'No active picture'}</span>
          </div>
        </div>

        <aside className="timeline-clip-inspector">
          {!selectedClip ? (
            <div className="timeline-inspector-empty"><Scissors size={25} /><strong>Clip Inspector</strong><span>Select a clip to trim, split, transition or jump back to its source shot.</span></div>
          ) : (
            <>
              <div className="timeline-inspector-title">
                <div><small>{selectedTrack?.type} CLIP</small><strong>{selectedShot?.title ?? selectedClip.assetId ?? 'Media Clip'}</strong></div>
                <button onClick={deleteClip} title="Delete clip"><Trash2 size={14} /></button>
              </div>
              <div className="timeline-inspector-grid">
                <label><span>Start</span><input type="number" step="0.1" min="0" value={Number(selectedClip.startSeconds.toFixed(2))} onChange={(event) => patchClip(selectedClip.id, { startSeconds: snapTime(Number(event.target.value) || 0, snap) })} /></label>
                <label><span>Duration</span><input type="number" step="0.1" min="0.25" value={Number(selectedClip.durationSeconds.toFixed(2))} onChange={(event) => setClipDuration(Number(event.target.value) || 0.25)} /></label>
                <label><span>Trim In</span><input type="number" step="0.1" min="0" value={Number((selectedClip.trimInSeconds ?? 0).toFixed(2))} onChange={(event) => setTrim('in', Number(event.target.value) || 0)} /></label>
                <label><span>Trim Out</span><input type="number" step="0.1" min="0" value={Number((selectedClip.trimOutSeconds ?? 0).toFixed(2))} onChange={(event) => setTrim('out', Number(event.target.value) || 0)} /></label>
                <label><span>Transition In</span><select value={selectedClip.transitionIn ?? 'NONE'} onChange={(event) => patchClip(selectedClip.id, { transitionIn: event.target.value as TransitionKind })}>{transitionOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label><span>Transition Out</span><select value={selectedClip.transitionOut ?? 'NONE'} onChange={(event) => patchClip(selectedClip.id, { transitionOut: event.target.value as TransitionKind })}>{transitionOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
              </div>
              <div className="timeline-inspector-actions">
                <button className="fg-btn" onClick={splitClip} disabled={playhead <= selectedClip.startSeconds || playhead >= selectedClip.startSeconds + selectedClip.durationSeconds}><Scissors size={13} /> Split at Playhead</button>
                {selectedShot && openShotManager && <button className="fg-btn" onClick={() => openShotManager(selectedShot.id)}><Film size={13} /> Open Shot</button>}
              </div>
              <div className="timeline-source-link"><Link2 size={12} /><span>Source</span><strong>{selectedShot ? `Shot ${selectedShot.shotNumber}` : 'External media'}</strong><em>{selectedClip.takeId ? `Take ${selectedTake?.version ?? '?'}` : 'No take'}</em></div>
            </>
          )}
        </aside>
      </section>

      <section className="timeline-editor-wrap">
        <div className="timeline-tools-row">
          <div className="timeline-add-track">
            <select value={newTrackType} onChange={(event) => setNewTrackType(event.target.value as TimelineTrackType)}>{Object.keys(trackMeta).map((type) => <option key={type} value={type}>{trackMeta[type as TimelineTrackType].label}</option>)}</select>
            <button className="fg-btn" onClick={addTrack}><Plus size={13} /> Add Track</button>
          </div>
          <div className="timeline-zoom"><span>Zoom</span><input type="range" min="1" max="5" step="0.25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><strong>{Math.round(zoom * 100)}%</strong></div>
        </div>

        <div className="timeline-editor-scroll">
          <div className="timeline-editor" style={{ width: `${timelineWidth}%` }}>
            <div className="timeline-ruler-head">TRACKS</div>
            <div className="timeline-ruler" onClick={(event) => setPlayhead(positionFromPointer(event, event.currentTarget))}>
              {ticks.map((tick) => <span key={tick} style={{ left: `${(tick / scaleDuration) * 100}%` }}>{fmt(tick)}</span>)}
              <i className="timeline-playhead" style={{ left: `${(playhead / scaleDuration) * 100}%` }} />
            </div>

            {timelineTracks.map((track) => (
              <React.Fragment key={track.id}>
                <div className="timeline-track-head">
                  <div>{trackMeta[track.type].icon}<strong>{track.name}</strong></div>
                  <div className="timeline-track-controls">
                    <button className={track.muted ? 'active' : ''} onClick={() => patchTrack(track.id, { muted: !track.muted })} title={track.muted ? 'Unmute track' : 'Mute track'}>{track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}</button>
                    <button className={track.locked ? 'active' : ''} onClick={() => patchTrack(track.id, { locked: !track.locked })} title={track.locked ? 'Unlock track' : 'Lock track'}>{track.locked ? <Lock size={11} /> : <Unlock size={11} />}</button>
                    <span>{track.clips.length}</span>
                  </div>
                </div>
                <div
                  className={`timeline-track-lane ${track.type.toLowerCase()} ${track.locked ? 'locked' : ''}`}
                  onClick={(event) => setPlayhead(positionFromPointer(event, event.currentTarget))}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const clipId = event.dataTransfer.getData('application/flowgraph-timeline-clip');
                    if (clipId) moveClip(clipId, track.id, positionFromPointer(event, event.currentTarget));
                  }}
                >
                  {ticks.map((tick) => <i className="timeline-gridline" key={tick} style={{ left: `${(tick / scaleDuration) * 100}%` }} />)}
                  <i className="timeline-playhead lane" style={{ left: `${(playhead / scaleDuration) * 100}%` }} />
                  {track.clips.map((clip) => {
                    const shot = shots.find((item) => item.id === clip.shotId);
                    const left = (clip.startSeconds / scaleDuration) * 100;
                    const width = Math.max((clip.durationSeconds / scaleDuration) * 100, 0.8);
                    return (
                      <div
                        className={`timeline-clip ${clip.id === selectedClipId ? 'selected' : ''}`}
                        key={clip.id}
                        draggable={!track.locked}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('application/flowgraph-timeline-clip', clip.id);
                        }}
                        onClick={(event) => { event.stopPropagation(); setSelectedClipId(clip.id); setPlayhead(Math.max(clip.startSeconds, Math.min(playhead, clip.startSeconds + clip.durationSeconds))); }}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        title={`${shot?.title ?? clip.assetId ?? 'Clip'} · ${fmt(clip.durationSeconds)}`}
                      >
                        {(clip.transitionIn ?? 'NONE') !== 'NONE' && <i className="clip-transition in" title={`In: ${clip.transitionIn}`} />}
                        {(clip.transitionOut ?? 'NONE') !== 'NONE' && <i className="clip-transition out" title={`Out: ${clip.transitionOut}`} />}
                        <strong>{shot ? `S${shot.shotNumber}` : trackMeta[track.type].label}</strong>
                        <span>{shot?.title ?? 'Media'}</span>
                        <em>{fmt(clip.durationSeconds)}</em>
                      </div>
                    );
                  })}
                  {track.clips.length === 0 && <div className="timeline-empty-lane"><AudioLines size={13} /> Drop or add {trackMeta[track.type].label.toLowerCase()} clips</div>}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      <footer className="timeline-footer">
        <span>Drag clips between compatible tracks · click lanes to move playhead · selected take stays linked to Shot Manager.</span>
        <strong>{target ? Math.min(100, Math.round((timelineDuration / target) * 100)) : 0}% of target duration</strong>
      </footer>
    </main>
  );
}
