export type FilmProjectStatus = 'DEVELOPMENT' | 'PRODUCTION' | 'POST_PRODUCTION' | 'DELIVERED';
export type ShotStatus = 'PLANNED' | 'READY' | 'GENERATING' | 'REVIEW' | 'APPROVED' | 'LOCKED';
export type TakeStatus = 'GENERATED' | 'REVIEW' | 'APPROVED' | 'REJECTED';

export interface FilmCameraPlan {
  shotSize?: string;
  angle?: string;
  lens?: string;
  movement?: string;
}

export interface FilmTake {
  id: string;
  shotId: string;
  version: number;
  status: TakeStatus;
  previewUrl?: string;
  mediaId?: string;
  localPath?: string;
  proxyPath?: string;
  proxyUrl?: string;
  fileName?: string;
  mimeType?: string;
  durationSeconds?: number;
  createdAt: string;
  notes?: string;
}

export interface FilmShot {
  id: string;
  sceneId: string;
  shotNumber: string;
  title: string;
  durationSeconds: number;
  description: string;
  dialogue?: string;
  characters: string[];
  location?: string;
  props?: string[];
  camera: FilmCameraPlan;
  workflowId?: string;
  takes: FilmTake[];
  selectedTakeId?: string;
  status: ShotStatus;
  dependencies?: string[];
  continuity?: {
    screenDirection?: 'LTR' | 'RTL' | 'NEUTRAL';
    timeOfDay?: string;
    weather?: string;
    wardrobe?: string;
    hairMakeup?: string;
    notes?: string;
  };
}

export interface FilmScene {
  id: string;
  sequenceId: string;
  sceneNumber: string;
  title: string;
  description?: string;
  location?: string;
  shots: FilmShot[];
}

export interface FilmSequence {
  id: string;
  projectId: string;
  sequenceNumber: string;
  title: string;
  scenes: FilmScene[];
}

export type FilmAssetType = 'CHARACTER' | 'LOCATION' | 'PROP' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'MUSIC';

export interface FilmAsset {
  id: string;
  projectId: string;
  type: FilmAssetType;
  name: string;
  description?: string;
  previewUrl?: string;
  mediaId?: string;
  referenceUrls?: string[];
  tags?: string[];
  continuityNotes?: string;
  locked?: boolean;
}

export interface TimelineClip {
  id: string;
  trackId: string;
  shotId?: string;
  takeId?: string;
  assetId?: string;
  startSeconds: number;
  durationSeconds: number;
  trimInSeconds?: number;
  trimOutSeconds?: number;
  sourceDurationSeconds?: number;
  transitionIn?: 'NONE' | 'DISSOLVE' | 'FADE' | 'WIPE';
  transitionOut?: 'NONE' | 'DISSOLVE' | 'FADE' | 'WIPE';
  volume?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  text?: string;
  label?: string;
  title?: string;
}

export type TimelineTrackType = 'VIDEO' | 'DIALOGUE' | 'SFX' | 'MUSIC' | 'SUBTITLE';

export interface TimelineTrack {
  id: string;
  projectId: string;
  type: TimelineTrackType;
  name: string;
  clips: TimelineClip[];
  muted?: boolean;
  locked?: boolean;
}

export interface FilmProject {
  id: string;
  title: string;
  status: FilmProjectStatus;
  targetDurationSeconds?: number;
  aspectRatio: string;
  frameRate: number;
  sequences: FilmSequence[];
  assets: FilmAsset[];
  timeline: TimelineTrack[];
  createdAt: string;
  updatedAt: string;
}
