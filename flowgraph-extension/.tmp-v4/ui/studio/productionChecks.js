"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.continuityChecks = continuityChecks;
exports.renderPreflightChecks = renderPreflightChecks;
exports.diffProjects = diffProjects;
const filmModel_1 = require("./filmModel");
function issue(domain, severity, code, message, extra = {}) {
    return { id: `${domain}-${code}-${extra.shotId ?? extra.sceneId ?? extra.takeId ?? Math.random().toString(36).slice(2)}`, domain, severity, code, message, ...extra };
}
function selectedTake(shot) {
    return shot.selectedTakeId ? shot.takes.find((take) => take.id === shot.selectedTakeId) : undefined;
}
function continuityChecks(project) {
    const issues = [];
    const shots = (0, filmModel_1.allShots)(project);
    const shotById = new Map(shots.map((shot) => [shot.id, shot]));
    const assetIds = new Set(project.assets.map((asset) => asset.id));
    for (const sequence of project.sequences) {
        for (const scene of sequence.scenes) {
            for (let index = 0; index < scene.shots.length; index += 1) {
                const shot = scene.shots[index];
                const previous = scene.shots[index - 1];
                if (shot.location && !assetIds.has(shot.location)) {
                    issues.push(issue('CONTINUITY', 'ERROR', 'MISSING_LOCATION_ASSET', `Shot ${shot.shotNumber} references a location asset that no longer exists.`, { shotId: shot.id, sceneId: scene.id }));
                }
                for (const assetId of [...shot.characters, ...(shot.props ?? [])]) {
                    if (!assetIds.has(assetId))
                        issues.push(issue('CONTINUITY', 'ERROR', 'MISSING_ASSET', `Shot ${shot.shotNumber} references a deleted character/prop asset.`, { shotId: shot.id, sceneId: scene.id, detail: assetId }));
                }
                if ((shot.status === 'APPROVED' || shot.status === 'LOCKED') && !selectedTake(shot)) {
                    issues.push(issue('CONTINUITY', 'ERROR', 'APPROVED_WITHOUT_TAKE', `Shot ${shot.shotNumber} is ${shot.status} but has no valid selected take.`, { shotId: shot.id, sceneId: scene.id }));
                }
                if (scene.location && shot.location) {
                    const sceneLocationAsset = project.assets.find((asset) => asset.id === shot.location)?.name;
                    if (sceneLocationAsset && scene.location !== sceneLocationAsset) {
                        issues.push(issue('CONTINUITY', 'WARNING', 'SCENE_LOCATION_MISMATCH', `Shot ${shot.shotNumber} location differs from the scene location.`, { shotId: shot.id, sceneId: scene.id, detail: `${scene.location} → ${sceneLocationAsset}` }));
                    }
                }
                if (previous) {
                    const prevDirection = previous.continuity?.screenDirection;
                    const direction = shot.continuity?.screenDirection;
                    if (prevDirection && direction && prevDirection !== 'NEUTRAL' && direction !== 'NEUTRAL' && prevDirection !== direction) {
                        issues.push(issue('CONTINUITY', 'WARNING', 'SCREEN_DIRECTION_FLIP', `Screen direction flips between shots ${previous.shotNumber} and ${shot.shotNumber}.`, { shotId: shot.id, sceneId: scene.id, detail: `${prevDirection} → ${direction}` }));
                    }
                    if (previous.continuity?.timeOfDay && shot.continuity?.timeOfDay && previous.continuity.timeOfDay !== shot.continuity.timeOfDay) {
                        issues.push(issue('CONTINUITY', 'WARNING', 'TIME_OF_DAY_CHANGE', `Time of day changes inside Scene ${scene.sceneNumber}.`, { shotId: shot.id, sceneId: scene.id, detail: `${previous.continuity.timeOfDay} → ${shot.continuity.timeOfDay}` }));
                    }
                    if (previous.continuity?.weather && shot.continuity?.weather && previous.continuity.weather !== shot.continuity.weather) {
                        issues.push(issue('CONTINUITY', 'WARNING', 'WEATHER_CHANGE', `Weather continuity changes between adjacent shots.`, { shotId: shot.id, sceneId: scene.id, detail: `${previous.continuity.weather} → ${shot.continuity.weather}` }));
                    }
                }
                for (const dependencyId of shot.dependencies ?? []) {
                    const dependency = shotById.get(dependencyId);
                    if (!dependency) {
                        issues.push(issue('CONTINUITY', 'ERROR', 'MISSING_DEPENDENCY', `Shot ${shot.shotNumber} depends on a shot that no longer exists.`, { shotId: shot.id, sceneId: scene.id, detail: dependencyId }));
                    }
                    else if ((shot.status === 'READY' || shot.status === 'GENERATING' || shot.status === 'REVIEW' || shot.status === 'APPROVED' || shot.status === 'LOCKED') && dependency.status !== 'APPROVED' && dependency.status !== 'LOCKED') {
                        issues.push(issue('CONTINUITY', 'WARNING', 'DEPENDENCY_NOT_APPROVED', `Shot ${shot.shotNumber} depends on Shot ${dependency.shotNumber}, which is not approved yet.`, { shotId: shot.id, sceneId: scene.id, detail: dependency.status }));
                    }
                }
            }
        }
    }
    // Detect dependency cycles with DFS.
    const visiting = new Set();
    const visited = new Set();
    const visit = (shot, trail) => {
        if (visiting.has(shot.id)) {
            issues.push(issue('CONTINUITY', 'ERROR', 'DEPENDENCY_CYCLE', `Shot dependency cycle detected.`, { shotId: shot.id, detail: [...trail, shot.shotNumber].join(' → ') }));
            return;
        }
        if (visited.has(shot.id))
            return;
        visiting.add(shot.id);
        for (const depId of shot.dependencies ?? []) {
            const dep = shotById.get(depId);
            if (dep)
                visit(dep, [...trail, shot.shotNumber]);
        }
        visiting.delete(shot.id);
        visited.add(shot.id);
    };
    shots.forEach((shot) => visit(shot, []));
    return issues;
}
function renderPreflightChecks(project) {
    const issues = [];
    const shots = (0, filmModel_1.allShots)(project);
    const shotById = new Map(shots.map((shot) => [shot.id, shot]));
    const takeById = new Map(shots.flatMap((shot) => shot.takes.map((take) => [take.id, take])));
    const videoTracks = project.timeline.filter((track) => track.type === 'VIDEO' && !track.muted);
    const clips = videoTracks.flatMap((track) => track.clips).sort((a, b) => a.startSeconds - b.startSeconds);
    if (!clips.length)
        issues.push(issue('PREFLIGHT', 'ERROR', 'NO_VIDEO', 'Master timeline has no active video clips.'));
    clips.forEach((clip, index) => {
        if (!clip.takeId) {
            issues.push(issue('PREFLIGHT', 'ERROR', 'CLIP_WITHOUT_TAKE', 'A video timeline clip has no Take source.', { shotId: clip.shotId, detail: clip.id }));
        }
        else {
            const take = takeById.get(clip.takeId);
            if (!take) {
                issues.push(issue('PREFLIGHT', 'ERROR', 'MISSING_TAKE', 'Timeline references a Take that no longer exists.', { shotId: clip.shotId, takeId: clip.takeId }));
            }
            else if (!take.localPath) {
                issues.push(issue('PREFLIGHT', 'ERROR', 'MEDIA_NOT_MATERIALIZED', 'Take has no local source path for FFmpeg render.', { shotId: clip.shotId, takeId: take.id, detail: take.fileName ?? take.previewUrl }));
            }
        }
        const previous = clips[index - 1];
        if (previous) {
            const previousEnd = previous.startSeconds + previous.durationSeconds;
            if (clip.startSeconds > previousEnd + 0.02) {
                issues.push(issue('PREFLIGHT', 'WARNING', 'PICTURE_GAP', `Picture gap of ${(clip.startSeconds - previousEnd).toFixed(2)}s before this clip.`, { shotId: clip.shotId, detail: clip.id }));
            }
            if (clip.startSeconds < previousEnd - 0.02 && (!clip.transitionIn || clip.transitionIn === 'NONE')) {
                issues.push(issue('PREFLIGHT', 'WARNING', 'UNDECLARED_OVERLAP', 'Video clips overlap without an explicit transition.', { shotId: clip.shotId, detail: clip.id }));
            }
        }
    });
    for (const shot of shots.filter((item) => item.status === 'APPROVED' || item.status === 'LOCKED')) {
        if (!clips.some((clip) => clip.shotId === shot.id)) {
            issues.push(issue('PREFLIGHT', 'INFO', 'APPROVED_NOT_ASSEMBLED', `Approved Shot ${shot.shotNumber} is not present in the master timeline.`, { shotId: shot.id }));
        }
        for (const depId of shot.dependencies ?? []) {
            const dep = shotById.get(depId);
            if (dep && dep.status !== 'APPROVED' && dep.status !== 'LOCKED') {
                issues.push(issue('PREFLIGHT', 'WARNING', 'UNRESOLVED_DEPENDENCY', `Shot ${shot.shotNumber} has an unresolved dependency on Shot ${dep.shotNumber}.`, { shotId: shot.id }));
            }
        }
    }
    const duration = clips.reduce((max, clip) => Math.max(max, clip.startSeconds + clip.durationSeconds), 0);
    if (project.targetDurationSeconds && duration > 0) {
        const delta = Math.abs(duration - project.targetDurationSeconds) / project.targetDurationSeconds;
        if (delta > 0.1)
            issues.push(issue('PREFLIGHT', 'INFO', 'TARGET_DURATION_DELTA', `Timeline duration differs from target by ${Math.round(delta * 100)}%.`, { detail: `${duration.toFixed(1)}s / ${project.targetDurationSeconds}s` }));
    }
    return issues;
}
function diffProjects(base, current) {
    const baseShots = new Map((0, filmModel_1.allShots)(base).map((shot) => [shot.id, shot]));
    const currentShots = new Map((0, filmModel_1.allShots)(current).map((shot) => [shot.id, shot]));
    const baseScenes = new Set(base.sequences.flatMap((sequence) => sequence.scenes.map((scene) => scene.id)));
    const currentScenes = new Set(current.sequences.flatMap((sequence) => sequence.scenes.map((scene) => scene.id)));
    let shotsChanged = 0;
    let takesAdded = 0;
    currentShots.forEach((shot, id) => {
        const before = baseShots.get(id);
        if (!before)
            return;
        const comparable = (value) => JSON.stringify({ title: value.title, durationSeconds: value.durationSeconds, description: value.description, dialogue: value.dialogue, characters: value.characters, location: value.location, props: value.props, camera: value.camera, status: value.status, selectedTakeId: value.selectedTakeId, continuity: value.continuity, dependencies: value.dependencies });
        if (comparable(before) !== comparable(shot))
            shotsChanged += 1;
        takesAdded += Math.max(0, shot.takes.length - before.takes.length);
    });
    const clipSignature = (projectValue) => JSON.stringify(projectValue.timeline.map((track) => ({ id: track.id, muted: track.muted, clips: track.clips })));
    const assets = (value) => JSON.stringify(value.assets);
    return {
        shotsAdded: [...currentShots.keys()].filter((id) => !baseShots.has(id)).length,
        shotsRemoved: [...baseShots.keys()].filter((id) => !currentShots.has(id)).length,
        shotsChanged,
        scenesAdded: [...currentScenes].filter((id) => !baseScenes.has(id)).length,
        scenesRemoved: [...baseScenes].filter((id) => !currentScenes.has(id)).length,
        takesAdded,
        timelineClipsChanged: clipSignature(base) === clipSignature(current) ? 0 : current.timeline.reduce((sum, track) => sum + track.clips.length, 0),
        assetsChanged: assets(base) === assets(current) ? 0 : Math.abs(current.assets.length - base.assets.length) || 1,
    };
}
