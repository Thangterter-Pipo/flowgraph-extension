import React, { useMemo } from 'react';
import {
  Box,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clapperboard,
  Clock3,
  Film,
  FolderKanban,
  Layers3,
  MapPin,
  Plus,
  Sparkles,
  UserRound,
  Video,
  Workflow,
} from 'lucide-react';
import type { FilmProject, FilmShot, ShotStatus } from '../../types/film';
import { addShot, allScenes, allShots, projectDuration, toggleShotAsset, updateShot } from './filmModel';

type Props = {
  project: FilmProject;
  setProject: React.Dispatch<React.SetStateAction<FilmProject>>;
  selectedSceneId: string;
  setSelectedSceneId: (id: string) => void;
  selectedShotId: string;
  setSelectedShotId: (id: string) => void;
  openFlowForShot: (shot: FilmShot) => void;
};

const shotStatuses: ShotStatus[] = ['PLANNED', 'READY', 'GENERATING', 'REVIEW', 'APPROVED', 'LOCKED'];

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

function statusClass(status: ShotStatus) {
  return status.toLowerCase().replace('_', '-');
}

export default function FilmWorkspace({
  project,
  setProject,
  selectedSceneId,
  setSelectedSceneId,
  selectedShotId,
  setSelectedShotId,
  openFlowForShot,
}: Props) {
  const scenes = useMemo(() => allScenes(project), [project]);
  const shots = useMemo(() => allShots(project), [project]);
  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0];
  const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? selectedScene?.shots[0];
  const approved = shots.filter((shot) => shot.status === 'APPROVED' || shot.status === 'LOCKED').length;

  const patchShot = (patch: Partial<FilmShot>) => {
    if (!selectedShot) return;
    setProject((current) => updateShot(current, selectedShot.id, (shot) => ({ ...shot, ...patch })));
  };

  const patchCamera = (key: keyof FilmShot['camera'], value: string) => {
    if (!selectedShot) return;
    setProject((current) => updateShot(current, selectedShot.id, (shot) => ({
      ...shot,
      camera: { ...shot.camera, [key]: value },
    })));
  };

  const createShot = () => {
    if (!selectedScene) return;
    setProject((current) => {
      const result = addShot(current, selectedScene.id);
      window.setTimeout(() => setSelectedShotId(result.shotId), 0);
      return result.project;
    });
  };

  const addTake = () => {
    if (!selectedShot) return;
    setProject((current) => updateShot(current, selectedShot.id, (shot) => {
      const version = shot.takes.length + 1;
      const id = `take-${shot.id}-${Date.now()}`;
      return {
        ...shot,
        status: 'REVIEW',
        takes: [...shot.takes, {
          id,
          shotId: shot.id,
          version,
          status: 'REVIEW',
          durationSeconds: shot.durationSeconds,
          createdAt: new Date().toISOString(),
        }],
        selectedTakeId: id,
      };
    }));
  };

  const approveTake = () => {
    if (!selectedShot?.selectedTakeId) return;
    setProject((current) => updateShot(current, selectedShot.id, (shot) => ({
      ...shot,
      status: 'APPROVED',
      takes: shot.takes.map((take) => take.id === shot.selectedTakeId ? { ...take, status: 'APPROVED' } : take),
    })));
  };

  const toggleAsset = (assetId: string) => {
    if (!selectedShot) return;
    const asset = project.assets.find((item) => item.id === assetId);
    if (!asset) return;
    setProject((current) => toggleShotAsset(current, selectedShot.id, asset));
  };

  const assetSelected = (assetId: string) => Boolean(selectedShot && (selectedShot.characters.includes(assetId) || selectedShot.location === assetId || (selectedShot.props ?? []).includes(assetId)));

  return (
    <main className="film-workspace">
      <aside className="film-project-panel">
        <div className="film-panel-heading"><FolderKanban size={15} /><span>PROJECT</span></div>
        <div className="film-project-card">
          <div className="film-project-title">{project.title}</div>
          <div className="film-project-meta"><span>{project.aspectRatio}</span><span>{project.frameRate} FPS</span><span>{formatDuration(projectDuration(project))}</span></div>
          <div className="film-progress"><span style={{ width: `${shots.length ? Math.round((approved / shots.length) * 100) : 0}%` }} /></div>
          <div className="film-progress-copy"><span>{approved}/{shots.length} approved</span><span>{project.status.replace('_', ' ')}</span></div>
        </div>

        <div className="film-tree">
          {project.sequences.map((sequence) => (
            <div className="film-sequence" key={sequence.id}>
              <div className="film-sequence-title"><Layers3 size={13} /><span>SEQ {sequence.sequenceNumber}</span><strong>{sequence.title}</strong></div>
              {sequence.scenes.map((scene) => (
                <button
                  className={`film-scene-row ${scene.id === selectedScene?.id ? 'active' : ''}`}
                  key={scene.id}
                  onClick={() => {
                    setSelectedSceneId(scene.id);
                    if (scene.shots[0]) setSelectedShotId(scene.shots[0].id);
                  }}
                >
                  <Clapperboard size={13} />
                  <span><strong>SC {scene.sceneNumber}</strong><small>{scene.title}</small></span>
                  <em>{scene.shots.length}</em>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <section className="film-shot-board">
        <header className="film-board-header">
          <div>
            <div className="film-kicker">SHOT MANAGER</div>
            <h2>{selectedScene ? `Scene ${selectedScene.sceneNumber} · ${selectedScene.title}` : 'No scene'}</h2>
            {selectedScene && <p>{selectedScene.description}</p>}
          </div>
          <button className="fg-btn fg-btn-primary" onClick={createShot}><Plus size={14} /> Add Shot</button>
        </header>

        <div className="film-scene-stats">
          <div><Film size={14} /><span>Shots</span><strong>{selectedScene?.shots.length ?? 0}</strong></div>
          <div><Clock3 size={14} /><span>Scene duration</span><strong>{formatDuration(selectedScene?.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0) ?? 0)}</strong></div>
          <div><MapPin size={14} /><span>Location</span><strong>{selectedScene?.location ?? '—'}</strong></div>
        </div>

        <div className="shot-grid">
          {selectedScene?.shots.map((shot) => (
            <button className={`shot-card ${shot.id === selectedShot?.id ? 'selected' : ''}`} key={shot.id} onClick={() => setSelectedShotId(shot.id)}>
              <div className="shot-card-preview">
                <Video size={22} />
                <span>SHOT {shot.shotNumber}</span>
                <em>{shot.durationSeconds}s</em>
              </div>
              <div className="shot-card-body">
                <div className="shot-card-title"><strong>{shot.title}</strong><span className={`shot-status ${statusClass(shot.status)}`}>{shot.status}</span></div>
                <p>{shot.description}</p>
                <div className="shot-card-camera"><Camera size={11} /><span>{shot.camera.shotSize ?? '—'}</span><span>{shot.camera.lens ?? '—'}</span><span>{shot.camera.movement ?? '—'}</span></div>
                <div className="shot-card-footer"><span>{shot.takes.length} take{shot.takes.length === 1 ? '' : 's'}</span><span>{shot.selectedTakeId ? 'Take selected' : 'No take selected'}</span></div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <aside className="film-shot-inspector">
        {!selectedShot ? (
          <div className="film-empty-inspector"><Clapperboard size={36} /><strong>No shot selected</strong><span>Select a shot to edit production details.</span></div>
        ) : (
          <>
            <div className="film-inspector-head">
              <div><span>SHOT {selectedShot.shotNumber}</span><strong>{selectedShot.title}</strong></div>
              <span className={`shot-status ${statusClass(selectedShot.status)}`}>{selectedShot.status}</span>
            </div>
            <div className="film-inspector-body">
              <label><span className="form-label">Shot title</span><input className="form-control" value={selectedShot.title} onChange={(event) => patchShot({ title: event.target.value })} /></label>
              <div className="film-form-row">
                <label><span className="form-label">Duration</span><input className="form-control" type="number" min="1" value={selectedShot.durationSeconds} onChange={(event) => patchShot({ durationSeconds: Math.max(1, Number(event.target.value) || 1) })} /></label>
                <label><span className="form-label">Status</span><select className="form-control" value={selectedShot.status} onChange={(event) => patchShot({ status: event.target.value as ShotStatus })}>{shotStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
              </div>
              <label><span className="form-label">Description</span><textarea className="form-control film-description" value={selectedShot.description} onChange={(event) => patchShot({ description: event.target.value })} /></label>
              <label><span className="form-label">Dialogue</span><textarea className="form-control film-dialogue" placeholder="Optional dialogue for this shot" value={selectedShot.dialogue ?? ''} onChange={(event) => patchShot({ dialogue: event.target.value })} /></label>

              <div className="film-inspector-section">
                <div className="film-section-title"><Camera size={13} /> Camera plan</div>
                <div className="film-form-row">
                  <label><span className="form-label">Shot size</span><input className="form-control" value={selectedShot.camera.shotSize ?? ''} onChange={(event) => patchCamera('shotSize', event.target.value)} /></label>
                  <label><span className="form-label">Lens</span><input className="form-control" value={selectedShot.camera.lens ?? ''} onChange={(event) => patchCamera('lens', event.target.value)} /></label>
                </div>
                <div className="film-form-row">
                  <label><span className="form-label">Angle</span><input className="form-control" value={selectedShot.camera.angle ?? ''} onChange={(event) => patchCamera('angle', event.target.value)} /></label>
                  <label><span className="form-label">Movement</span><input className="form-control" value={selectedShot.camera.movement ?? ''} onChange={(event) => patchCamera('movement', event.target.value)} /></label>
                </div>
              </div>

              <div className="film-inspector-section">
                <div className="film-section-title"><UserRound size={13} /> Production assets</div>
                <div className="shot-asset-group"><span>Characters</span><div>{project.assets.filter((asset) => asset.type === 'CHARACTER').map((asset) => <button key={asset.id} className={assetSelected(asset.id) ? 'active' : ''} onClick={() => toggleAsset(asset.id)}>{asset.name}</button>)}</div></div>
                <div className="shot-asset-group"><span>Location</span><div>{project.assets.filter((asset) => asset.type === 'LOCATION').map((asset) => <button key={asset.id} className={assetSelected(asset.id) ? 'active' : ''} onClick={() => toggleAsset(asset.id)}><MapPin size={10} /> {asset.name}</button>)}</div></div>
                <div className="shot-asset-group"><span>Props</span><div>{project.assets.filter((asset) => asset.type === 'PROP').map((asset) => <button key={asset.id} className={assetSelected(asset.id) ? 'active' : ''} onClick={() => toggleAsset(asset.id)}><Box size={10} /> {asset.name}</button>)}</div></div>
              </div>

              <div className="film-inspector-section">
                <div className="film-section-title"><Sparkles size={13} /> Generation</div>
                <button className="film-open-flow" onClick={() => openFlowForShot(selectedShot)}><Workflow size={15} /><span><strong>Open FlowGraph</strong><small>{selectedShot.workflowId ?? 'Create workflow'}</small></span><ChevronRight size={15} /></button>
              </div>

              <div className="film-inspector-section">
                <div className="film-section-title"><Clapperboard size={13} /> Takes</div>
                <div className="film-take-list">
                  {selectedShot.takes.length === 0 && <div className="film-no-takes">No takes yet. Generate or add a take for review.</div>}
                  {selectedShot.takes.map((take) => (
                    <button className={`film-take-row ${take.id === selectedShot.selectedTakeId ? 'active' : ''}`} key={take.id} onClick={() => patchShot({ selectedTakeId: take.id })}>
                      <span>Take {take.version}</span><em>{take.status}</em>
                    </button>
                  ))}
                </div>
                <div className="film-take-actions">
                  <button className="fg-btn" onClick={addTake}><Plus size={13} /> Add Take</button>
                  <button className="fg-btn" disabled={!selectedShot.selectedTakeId} onClick={approveTake}><CheckCircle2 size={13} /> Approve</button>
                </div>
              </div>
            </div>
          </>
        )}
      </aside>
    </main>
  );
}
