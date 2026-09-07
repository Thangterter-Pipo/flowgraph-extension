import React, { useMemo } from 'react';
import {
  Camera,
  CheckCircle2,
  Clapperboard,
  Clock3,
  Film,
  Image as ImageIcon,
  MapPin,
  MessageSquareText,
  Sparkles,
  UserRound,
  Workflow,
} from 'lucide-react';
import type { FilmProject, FilmShot } from '../../types/film';
import { allScenes, allShots, projectDuration } from './filmModel';

type Props = {
  project: FilmProject;
  selectedSceneId: string;
  setSelectedSceneId: (id: string) => void;
  selectedShotId: string;
  setSelectedShotId: (id: string) => void;
  openShotManager: (shot: FilmShot) => void;
  openFlowForShot: (shot: FilmShot) => void;
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

function resolveAssetName(project: FilmProject, assetId?: string) {
  if (!assetId) return undefined;
  return project.assets.find((asset) => asset.id === assetId)?.name ?? assetId;
}

export default function StoryboardWorkspace({ project, selectedSceneId, setSelectedSceneId, selectedShotId, setSelectedShotId, openShotManager, openFlowForShot }: Props) {
  const scenes = useMemo(() => allScenes(project), [project]);
  const shots = useMemo(() => allShots(project), [project]);
  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0];
  const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? selectedScene?.shots[0];
  const approvedCount = shots.filter((shot) => shot.status === 'APPROVED' || shot.status === 'LOCKED').length;
  const sceneDuration = selectedScene?.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0) ?? 0;

  return (
    <main className="storyboard-workspace">
      <aside className="storyboard-scenes">
        <div className="film-panel-heading"><Clapperboard size={15} /><span>STORYBOARD</span></div>
        <div className="storyboard-project-summary"><strong>{project.title}</strong><span>{formatDuration(projectDuration(project))} total</span><div><em>{approvedCount}/{shots.length}</em> shots approved</div></div>
        <div className="storyboard-scene-list">
          {scenes.map((scene) => (
            <button key={scene.id} className={scene.id === selectedScene?.id ? 'active' : ''} onClick={() => { setSelectedSceneId(scene.id); if (scene.shots[0]) setSelectedShotId(scene.shots[0].id); }}>
              <span className="storyboard-scene-index">SC {scene.sceneNumber}</span>
              <span><strong>{scene.title}</strong><small>{scene.shots.length} shots · {formatDuration(scene.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0))}</small></span>
            </button>
          ))}
        </div>
      </aside>

      <section className="storyboard-board">
        <header className="storyboard-head">
          <div><div className="film-kicker">SCENE BOARD</div><h2>{selectedScene ? `Scene ${selectedScene.sceneNumber} · ${selectedScene.title}` : 'No scene'}</h2><p>{selectedScene?.description ?? 'Arrange and review visual beats before generation.'}</p></div>
          <div className="storyboard-head-stats"><span><Film size={13} /> {selectedScene?.shots.length ?? 0} shots</span><span><Clock3 size={13} /> {formatDuration(sceneDuration)}</span><span><MapPin size={13} /> {selectedScene?.location ?? 'No location'}</span></div>
        </header>

        <div className="storyboard-strip">
          {selectedScene?.shots.map((shot, index) => {
            const selectedTake = shot.takes.find((take) => take.id === shot.selectedTakeId) ?? shot.takes.find((take) => take.status === 'APPROVED');
            return (
              <button className={`storyboard-card ${shot.id === selectedShot?.id ? 'selected' : ''}`} key={shot.id} onClick={() => setSelectedShotId(shot.id)}>
                <div className="storyboard-frame">
                  {selectedTake?.previewUrl ? <img src={selectedTake.previewUrl} alt={shot.title} /> : <><ImageIcon size={30} /><span>FRAME {String(index + 1).padStart(2, '0')}</span></>}
                  <em>{shot.durationSeconds}s</em>
                  <strong>SHOT {shot.shotNumber}</strong>
                </div>
                <div className="storyboard-card-copy"><div><strong>{shot.title}</strong><span className={`shot-status ${shot.status.toLowerCase().replace('_', '-')}`}>{shot.status}</span></div><p>{shot.description}</p><div className="storyboard-camera"><Camera size={11} /><span>{shot.camera.shotSize ?? '—'}</span><span>{shot.camera.lens ?? '—'}</span><span>{shot.camera.movement ?? '—'}</span></div></div>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="storyboard-inspector">
        {!selectedShot ? <div className="film-empty-inspector"><Clapperboard size={36} /><strong>No storyboard frame</strong><span>Select a shot from the board.</span></div> : (
          <>
            <div className="storyboard-inspector-head"><div><small>SHOT {selectedShot.shotNumber}</small><strong>{selectedShot.title}</strong></div><span>{selectedShot.durationSeconds}s</span></div>
            <div className="storyboard-inspector-body">
              <div className="storyboard-large-frame">{selectedShot.takes.find((take) => take.id === selectedShot.selectedTakeId)?.previewUrl ? <img src={selectedShot.takes.find((take) => take.id === selectedShot.selectedTakeId)?.previewUrl} alt={selectedShot.title} /> : <><ImageIcon size={34} /><span>Storyboard preview</span></>}</div>
              <div className="storyboard-detail-block"><span>Visual action</span><p>{selectedShot.description}</p></div>
              {selectedShot.dialogue && <div className="storyboard-detail-block"><span><MessageSquareText size={11} /> Dialogue</span><p>{selectedShot.dialogue}</p></div>}
              <div className="storyboard-detail-grid"><div><Camera size={12} /><span>Camera</span><strong>{[selectedShot.camera.shotSize, selectedShot.camera.angle, selectedShot.camera.lens, selectedShot.camera.movement].filter(Boolean).join(' · ') || '—'}</strong></div><div><MapPin size={12} /><span>Location</span><strong>{resolveAssetName(project, selectedShot.location) ?? '—'}</strong></div><div><UserRound size={12} /><span>Characters</span><strong>{selectedShot.characters.length ? selectedShot.characters.map((id) => resolveAssetName(project, id)).join(', ') : '—'}</strong></div></div>
              <div className="storyboard-continuity"><span><CheckCircle2 size={12} /> Continuity anchors</span><div>{[...selectedShot.characters, ...(selectedShot.props ?? []), ...(selectedShot.location ? [selectedShot.location] : [])].map((id) => { const asset = project.assets.find((item) => item.id === id); return asset ? <em key={id}>{asset.name}{asset.locked ? ' · LOCK' : ''}</em> : null; })}</div></div>
              <div className="storyboard-actions"><button className="fg-btn" onClick={() => openShotManager(selectedShot)}><Clapperboard size={13} /> Edit Shot</button><button className="fg-btn fg-btn-primary" onClick={() => openFlowForShot(selectedShot)}><Sparkles size={13} /> Generate Shot</button></div>
            </div>
          </>
        )}
      </aside>
    </main>
  );
}
