import React, { useMemo, useState } from 'react';
import {
  Box,
  Check,
  Film,
  Image as ImageIcon,
  Link2,
  Lock,
  MapPin,
  Plus,
  Search,
  Tag,
  Unlock,
  UserRound,
} from 'lucide-react';
import type { FilmAsset, FilmAssetType, FilmProject } from '../../types/film';
import { addAsset, allShots, assetUsageCount, toggleShotAsset, updateAsset } from './filmModel';

type Props = {
  project: FilmProject;
  setProject: React.Dispatch<React.SetStateAction<FilmProject>>;
  selectedAssetId: string;
  setSelectedAssetId: (id: string) => void;
  selectedShotId: string;
};

type AssetFilter = 'ALL' | 'CHARACTER' | 'LOCATION' | 'PROP';

const filters: AssetFilter[] = ['ALL', 'CHARACTER', 'LOCATION', 'PROP'];

function AssetIcon({ type, size = 16 }: { type: FilmAssetType; size?: number }) {
  if (type === 'CHARACTER') return <UserRound size={size} />;
  if (type === 'LOCATION') return <MapPin size={size} />;
  if (type === 'PROP') return <Box size={size} />;
  return <ImageIcon size={size} />;
}

function isAssigned(asset: FilmAsset, shot: ReturnType<typeof allShots>[number] | undefined) {
  if (!shot) return false;
  if (asset.type === 'CHARACTER') return shot.characters.includes(asset.id);
  if (asset.type === 'LOCATION') return shot.location === asset.id;
  if (asset.type === 'PROP') return (shot.props ?? []).includes(asset.id);
  return false;
}

export default function AssetWorkspace({ project, setProject, selectedAssetId, setSelectedAssetId, selectedShotId }: Props) {
  const [filter, setFilter] = useState<AssetFilter>('ALL');
  const [search, setSearch] = useState('');
  const shots = useMemo(() => allShots(project), [project]);
  const selectedShot = shots.find((shot) => shot.id === selectedShotId);
  const assets = project.assets.filter((asset) => {
    if (!['CHARACTER', 'LOCATION', 'PROP'].includes(asset.type)) return false;
    if (filter !== 'ALL' && asset.type !== filter) return false;
    const haystack = `${asset.name} ${asset.description ?? ''} ${(asset.tags ?? []).join(' ')}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });
  const selectedAsset = project.assets.find((asset) => asset.id === selectedAssetId) ?? assets[0];

  const patch = (patchValue: Partial<FilmAsset>) => {
    if (!selectedAsset) return;
    setProject((current) => updateAsset(current, selectedAsset.id, patchValue));
  };

  const create = (type: FilmAssetType) => {
    setProject((current) => {
      const result = addAsset(current, type);
      window.setTimeout(() => setSelectedAssetId(result.assetId), 0);
      return result.project;
    });
  };

  const toggleAssignment = () => {
    if (!selectedAsset || !selectedShot) return;
    setProject((current) => toggleShotAsset(current, selectedShot.id, selectedAsset));
  };

  return (
    <main className="asset-workspace">
      <aside className="asset-sidebar">
        <div className="film-panel-heading"><Film size={15} /><span>ASSET LIBRARY</span></div>
        <div className="asset-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets..." /></div>
        <div className="asset-filters">
          {filters.map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}
        </div>
        <div className="asset-create-group">
          <span>CREATE</span>
          <button onClick={() => create('CHARACTER')}><UserRound size={13} /> Character</button>
          <button onClick={() => create('LOCATION')}><MapPin size={13} /> Location</button>
          <button onClick={() => create('PROP')}><Box size={13} /> Prop</button>
        </div>
        <div className="asset-sidebar-note">Locked assets act as continuity anchors for future generation workflows.</div>
      </aside>

      <section className="asset-board">
        <header className="asset-board-head">
          <div><div className="film-kicker">PRODUCTION ASSETS</div><h2>Characters, Locations & Props</h2><p>Reusable visual anchors keep shots consistent across scenes and takes.</p></div>
          <div className="asset-count"><strong>{project.assets.filter((asset) => ['CHARACTER', 'LOCATION', 'PROP'].includes(asset.type)).length}</strong><span>assets</span></div>
        </header>
        <div className="asset-grid">
          {assets.map((asset) => {
            const usage = assetUsageCount(project, asset.id);
            const assigned = isAssigned(asset, selectedShot);
            return (
              <button className={`asset-card ${asset.id === selectedAsset?.id ? 'selected' : ''}`} key={asset.id} onClick={() => setSelectedAssetId(asset.id)}>
                <div className={`asset-preview asset-${asset.type.toLowerCase()}`}>
                  {asset.previewUrl ? <img src={asset.previewUrl} alt={asset.name} /> : <AssetIcon type={asset.type} size={28} />}
                  <span>{asset.type}</span>
                  {asset.locked && <em><Lock size={11} /> LOCKED</em>}
                </div>
                <div className="asset-card-body">
                  <div className="asset-card-title"><strong>{asset.name}</strong>{assigned && <span className="asset-assigned"><Check size={10} /> SHOT</span>}</div>
                  <p>{asset.description || 'No description yet.'}</p>
                  <div className="asset-tag-row">{(asset.tags ?? []).slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>
                  <div className="asset-card-foot"><span>{usage} shot{usage === 1 ? '' : 's'}</span><span>{asset.referenceUrls?.length ?? 0} refs</span></div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="asset-inspector">
        {!selectedAsset ? <div className="film-empty-inspector"><Box size={36} /><strong>No asset selected</strong><span>Select or create an asset.</span></div> : (
          <>
            <div className="asset-inspector-head"><span className={`asset-type-icon asset-${selectedAsset.type.toLowerCase()}`}><AssetIcon type={selectedAsset.type} /></span><div><small>{selectedAsset.type}</small><strong>{selectedAsset.name}</strong></div><button className={`asset-lock ${selectedAsset.locked ? 'active' : ''}`} onClick={() => patch({ locked: !selectedAsset.locked })}>{selectedAsset.locked ? <Lock size={14} /> : <Unlock size={14} />}</button></div>
            <div className="asset-inspector-body">
              {selectedShot && ['CHARACTER', 'LOCATION', 'PROP'].includes(selectedAsset.type) && <button className={`asset-shot-link ${isAssigned(selectedAsset, selectedShot) ? 'active' : ''}`} onClick={toggleAssignment}><Link2 size={14} /><span><strong>{isAssigned(selectedAsset, selectedShot) ? 'Assigned to current shot' : 'Assign to current shot'}</strong><small>Shot {selectedShot.shotNumber} · {selectedShot.title}</small></span>{isAssigned(selectedAsset, selectedShot) && <Check size={14} />}</button>}
              <label><span className="form-label">Name</span><input className="form-control" value={selectedAsset.name} onChange={(event) => patch({ name: event.target.value })} /></label>
              <label><span className="form-label">Description</span><textarea className="form-control asset-description" value={selectedAsset.description ?? ''} onChange={(event) => patch({ description: event.target.value })} /></label>
              <label><span className="form-label"><Tag size={11} /> Tags</span><input className="form-control" value={(selectedAsset.tags ?? []).join(', ')} onChange={(event) => patch({ tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} placeholder="hero, night, jacket" /></label>
              <div className="asset-inspector-section"><div className="film-section-title"><Lock size={13} /> Continuity</div><textarea className="form-control asset-continuity" value={selectedAsset.continuityNotes ?? ''} onChange={(event) => patch({ continuityNotes: event.target.value })} placeholder="What must remain visually consistent?" /></div>
              <div className="asset-inspector-section"><div className="film-section-title"><ImageIcon size={13} /> Reference</div><label><span className="form-label">Primary preview URL</span><input className="form-control" value={selectedAsset.previewUrl ?? ''} onChange={(event) => patch({ previewUrl: event.target.value })} placeholder="https://..." /></label><label><span className="form-label">Reference URLs</span><textarea className="form-control asset-refs" value={(selectedAsset.referenceUrls ?? []).join('\n')} onChange={(event) => patch({ referenceUrls: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) })} placeholder="One URL per line" /></label></div>
              <div className="asset-usage-summary"><span>Used in</span><strong>{assetUsageCount(project, selectedAsset.id)} shots</strong></div>
            </div>
          </>
        )}
      </aside>
    </main>
  );
}
