import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Film,
  GitBranch,
  Layers3,
  Link2,
  ListChecks,
  MapPin,
  Plus,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { FilmProject, FilmScene, FilmShot } from '../../types/film';
import { allShots, updateShot } from './filmModel';
import { continuityChecks, renderPreflightChecks, type ProductionCheckIssue } from './productionChecks';

type Props = {
  project: FilmProject;
  setProject: React.Dispatch<React.SetStateAction<FilmProject>>;
  openShotManager?: (shotId: string) => void;
};

type CheckTab = 'CONTINUITY' | 'PREFLIGHT';

function nextNumber(values: string[]) {
  const max = values.reduce((value, item) => Math.max(value, Number.parseInt(item, 10) || 0), 0);
  return String(max + 1).padStart(2, '0');
}

function severityIcon(issue: ProductionCheckIssue) {
  if (issue.severity === 'ERROR') return <CircleAlert size={14} />;
  if (issue.severity === 'WARNING') return <TriangleAlert size={14} />;
  return <CheckCircle2 size={14} />;
}

export default function ContinuityWorkspace({ project, setProject, openShotManager }: Props) {
  const shots = useMemo(() => allShots(project), [project]);
  const [selectedShotId, setSelectedShotId] = useState(shots[0]?.id ?? '');
  const [tab, setTab] = useState<CheckTab>('CONTINUITY');
  const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? shots[0];
  const continuity = useMemo(() => continuityChecks(project), [project]);
  const preflight = useMemo(() => renderPreflightChecks(project), [project]);
  const issues = tab === 'CONTINUITY' ? continuity : preflight;
  const errors = issues.filter((item) => item.severity === 'ERROR').length;
  const warnings = issues.filter((item) => item.severity === 'WARNING').length;

  const touch = (next: FilmProject): FilmProject => ({ ...next, updatedAt: new Date().toISOString() });

  const patchShot = (shotId: string, patch: Partial<FilmShot>) => {
    setProject((current) => touch(updateShot(current, shotId, (shot) => ({ ...shot, ...patch }))));
  };

  const patchContinuity = (key: keyof NonNullable<FilmShot['continuity']>, value: string) => {
    if (!selectedShot) return;
    setProject((current) => touch(updateShot(current, selectedShot.id, (shot) => ({
      ...shot,
      continuity: { ...shot.continuity, [key]: value || undefined },
    }))));
  };

  const toggleDependency = (dependencyId: string) => {
    if (!selectedShot || dependencyId === selectedShot.id) return;
    const current = selectedShot.dependencies ?? [];
    patchShot(selectedShot.id, { dependencies: current.includes(dependencyId) ? current.filter((id) => id !== dependencyId) : [...current, dependencyId] });
  };

  const addSequence = () => {
    setProject((current) => {
      const sequenceNumber = nextNumber(current.sequences.map((item) => item.sequenceNumber));
      return touch({
        ...current,
        sequences: [...current.sequences, {
          id: `sequence-${Date.now()}`,
          projectId: current.id,
          sequenceNumber,
          title: `Sequence ${sequenceNumber}`,
          scenes: [],
        }],
      });
    });
  };

  const addScene = (sequenceId: string) => {
    setProject((current) => {
      const numbers = current.sequences.flatMap((sequence) => sequence.scenes.map((scene) => scene.sceneNumber));
      const sceneNumber = nextNumber(numbers);
      const scene: FilmScene = {
        id: `scene-${Date.now()}`,
        sequenceId,
        sceneNumber,
        title: `Scene ${sceneNumber}`,
        description: '',
        shots: [],
      };
      return touch({
        ...current,
        sequences: current.sequences.map((sequence) => sequence.id === sequenceId ? { ...sequence, scenes: [...sequence.scenes, scene] } : sequence),
      });
    });
  };

  const patchSequence = (sequenceId: string, title: string) => {
    setProject((current) => touch({ ...current, sequences: current.sequences.map((sequence) => sequence.id === sequenceId ? { ...sequence, title } : sequence) }));
  };

  const patchScene = (sceneId: string, patch: Partial<FilmScene>) => {
    setProject((current) => touch({
      ...current,
      sequences: current.sequences.map((sequence) => ({
        ...sequence,
        scenes: sequence.scenes.map((scene) => scene.id === sceneId ? { ...scene, ...patch } : scene),
      })),
    }));
  };

  const moveScene = (sequenceId: string, sceneId: string, direction: -1 | 1) => {
    setProject((current) => touch({
      ...current,
      sequences: current.sequences.map((sequence) => {
        if (sequence.id !== sequenceId) return sequence;
        const index = sequence.scenes.findIndex((scene) => scene.id === sceneId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= sequence.scenes.length) return sequence;
        const scenes = [...sequence.scenes];
        [scenes[index], scenes[target]] = [scenes[target], scenes[index]];
        return { ...sequence, scenes };
      }),
    }));
  };

  const moveSceneToSequence = (sceneId: string, targetSequenceId: string) => {
    setProject((current) => {
      let moving: FilmScene | undefined;
      const stripped = current.sequences.map((sequence) => {
        const found = sequence.scenes.find((scene) => scene.id === sceneId);
        if (found) moving = found;
        return { ...sequence, scenes: sequence.scenes.filter((scene) => scene.id !== sceneId) };
      });
      if (!moving) return current;
      return touch({
        ...current,
        sequences: stripped.map((sequence) => sequence.id === targetSequenceId ? { ...sequence, scenes: [...sequence.scenes, { ...moving!, sequenceId: targetSequenceId }] } : sequence),
      });
    });
  };

  const focusIssue = (item: ProductionCheckIssue) => {
    if (item.shotId) setSelectedShotId(item.shotId);
  };

  return (
    <main className="continuity-workspace">
      <aside className="continuity-structure">
        <div className="continuity-pane-head"><Layers3 size={14} /><strong>STRUCTURE</strong><button onClick={addSequence} title="Add sequence"><Plus size={13} /></button></div>
        <div className="continuity-tree">
          {project.sequences.map((sequence) => (
            <section className="continuity-sequence" key={sequence.id}>
              <div className="continuity-sequence-head">
                <span>SEQ {sequence.sequenceNumber}</span>
                <input value={sequence.title} onChange={(event) => patchSequence(sequence.id, event.target.value)} />
                <button onClick={() => addScene(sequence.id)} title="Add scene"><Plus size={12} /></button>
              </div>
              {sequence.scenes.map((scene, sceneIndex) => (
                <div className="continuity-scene" key={scene.id}>
                  <div className="continuity-scene-row">
                    <Film size={11} />
                    <input value={scene.title} onChange={(event) => patchScene(scene.id, { title: event.target.value })} />
                    <span>{scene.shots.length}</span>
                  </div>
                  <div className="continuity-scene-tools">
                    <input value={scene.location ?? ''} onChange={(event) => patchScene(scene.id, { location: event.target.value })} placeholder="Scene location" />
                    <button disabled={sceneIndex === 0} onClick={() => moveScene(sequence.id, scene.id, -1)}><ArrowUp size={11} /></button>
                    <button disabled={sceneIndex === sequence.scenes.length - 1} onClick={() => moveScene(sequence.id, scene.id, 1)}><ArrowDown size={11} /></button>
                    {project.sequences.length > 1 && (
                      <select value={sequence.id} onChange={(event) => moveSceneToSequence(scene.id, event.target.value)}>
                        {project.sequences.map((target) => <option key={target.id} value={target.id}>SEQ {target.sequenceNumber}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="continuity-shot-list">
                    {scene.shots.map((shot) => (
                      <button key={shot.id} className={shot.id === selectedShot?.id ? 'active' : ''} onClick={() => setSelectedShotId(shot.id)}>
                        <span>{shot.shotNumber}</span><strong>{shot.title}</strong><em>{shot.status}</em>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </aside>

      <section className="continuity-center">
        <header className="continuity-header">
          <div><div className="film-kicker">SCRIPT SUPERVISION / QC</div><h2>Continuity & Preflight</h2><p>Catch production continuity problems and render blockers before they reach the master timeline.</p></div>
          <div className="continuity-score"><strong>{errors ? 'BLOCKED' : warnings ? 'REVIEW' : 'READY'}</strong><span>{errors} errors · {warnings} warnings</span></div>
        </header>
        <div className="continuity-tabs">
          <button className={tab === 'CONTINUITY' ? 'active' : ''} onClick={() => setTab('CONTINUITY')}><ShieldCheck size={13} /> Continuity <span>{continuity.length}</span></button>
          <button className={tab === 'PREFLIGHT' ? 'active' : ''} onClick={() => setTab('PREFLIGHT')}><ListChecks size={13} /> Render Preflight <span>{preflight.length}</span></button>
        </div>
        <div className="continuity-issue-list">
          {!issues.length && <div className="continuity-clear"><CheckCircle2 size={26} /><strong>{tab === 'CONTINUITY' ? 'Continuity clear' : 'Preflight clear'}</strong><span>No issues detected by the current rule set.</span></div>}
          {issues.map((item) => (
            <button className={`continuity-issue ${item.severity.toLowerCase()}`} key={item.id} onClick={() => focusIssue(item)}>
              {severityIcon(item)}
              <div><strong>{item.code.replaceAll('_', ' ')}</strong><span>{item.message}</span>{item.detail && <small>{item.detail}</small>}</div>
              {item.shotId && <ChevronRight size={13} />}
            </button>
          ))}
        </div>
      </section>

      <aside className="continuity-inspector">
        {!selectedShot ? <div className="continuity-clear"><Film size={24} /><strong>No shot selected</strong></div> : <>
          <div className="continuity-inspector-head"><div><span>SHOT {selectedShot.shotNumber}</span><strong>{selectedShot.title}</strong></div>{openShotManager && <button onClick={() => openShotManager(selectedShot.id)}>Open Shot</button>}</div>
          <div className="continuity-inspector-body">
            <div className="continuity-form-title"><MapPin size={12} /> CONTINUITY METADATA</div>
            <label><span>Screen direction</span><select value={selectedShot.continuity?.screenDirection ?? ''} onChange={(event) => patchContinuity('screenDirection', event.target.value)}><option value="">Not set</option><option value="LTR">Left → Right</option><option value="RTL">Right → Left</option><option value="NEUTRAL">Neutral</option></select></label>
            <label><span>Time of day</span><input value={selectedShot.continuity?.timeOfDay ?? ''} onChange={(event) => patchContinuity('timeOfDay', event.target.value)} placeholder="Night / Dawn / Day" /></label>
            <label><span>Weather</span><input value={selectedShot.continuity?.weather ?? ''} onChange={(event) => patchContinuity('weather', event.target.value)} placeholder="Rain / Clear / Fog" /></label>
            <label><span>Wardrobe</span><input value={selectedShot.continuity?.wardrobe ?? ''} onChange={(event) => patchContinuity('wardrobe', event.target.value)} /></label>
            <label><span>Hair / Makeup</span><input value={selectedShot.continuity?.hairMakeup ?? ''} onChange={(event) => patchContinuity('hairMakeup', event.target.value)} /></label>
            <label><span>Continuity notes</span><textarea value={selectedShot.continuity?.notes ?? ''} onChange={(event) => patchContinuity('notes', event.target.value)} /></label>

            <div className="continuity-form-title dependency-title"><GitBranch size={12} /> SHOT DEPENDENCIES</div>
            <p className="continuity-help">Use dependencies when a shot requires an approved result from another shot, such as matching an end frame, action state or generated reference.</p>
            <div className="dependency-list">
              {shots.filter((shot) => shot.id !== selectedShot.id).map((shot) => {
                const active = (selectedShot.dependencies ?? []).includes(shot.id);
                return <button className={active ? 'active' : ''} key={shot.id} onClick={() => toggleDependency(shot.id)}><Link2 size={11} /><span>Shot {shot.shotNumber}</span><strong>{shot.title}</strong><em>{shot.status}</em></button>;
              })}
            </div>
          </div>
        </>}
      </aside>
    </main>
  );
}
