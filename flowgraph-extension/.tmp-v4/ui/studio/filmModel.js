"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDemoFilmProject = createDemoFilmProject;
exports.allScenes = allScenes;
exports.allShots = allShots;
exports.projectDuration = projectDuration;
exports.updateShot = updateShot;
exports.addShot = addShot;
exports.updateAsset = updateAsset;
exports.addAsset = addAsset;
exports.toggleShotAsset = toggleShotAsset;
exports.assetUsageCount = assetUsageCount;
const now = () => new Date().toISOString();
function createDemoFilmProject() {
    const projectId = 'film-demo-001';
    const sequenceId = 'seq-001';
    const sceneId = 'scene-001';
    const scene2Id = 'scene-002';
    return {
        id: projectId,
        title: 'Neon Run',
        status: 'PRODUCTION',
        targetDurationSeconds: 180,
        aspectRatio: '16:9',
        frameRate: 24,
        createdAt: now(),
        updatedAt: now(),
        assets: [
            {
                id: 'asset-char-driver',
                projectId,
                type: 'CHARACTER',
                name: 'The Driver',
                description: 'Lead driver with a calm, focused expression and dark futuristic racing jacket.',
                tags: ['lead', 'driver', 'hero'],
                continuityNotes: 'Keep hairstyle, jacket silhouette and facial structure consistent across all interior shots.',
                locked: true,
            },
            {
                id: 'asset-location-neon',
                projectId,
                type: 'LOCATION',
                name: 'Neon Downtown',
                description: 'Rain-soaked cyberpunk downtown street with magenta and cyan signage.',
                tags: ['night', 'rain', 'neon'],
                continuityNotes: 'Wet asphalt, dense signage and cool-magenta palette.',
                locked: true,
            },
            {
                id: 'asset-location-tunnel',
                projectId,
                type: 'LOCATION',
                name: 'City Tunnel',
                description: 'Long modern tunnel with repeating warm ceiling lights and reflective road surface.',
                tags: ['tunnel', 'night'],
                continuityNotes: 'Keep ceiling light spacing and lane markings stable.',
            },
            {
                id: 'asset-prop-car',
                projectId,
                type: 'PROP',
                name: 'Hero Car',
                description: 'Low futuristic sports car with sharp LED signature and graphite bodywork.',
                tags: ['vehicle', 'hero'],
                continuityNotes: 'Do not change body shape, headlights, wheels or graphite paint.',
                locked: true,
            },
        ],
        timeline: [],
        sequences: [
            {
                id: sequenceId,
                projectId,
                sequenceNumber: '01',
                title: 'Night Chase',
                scenes: [
                    {
                        id: sceneId,
                        sequenceId,
                        sceneNumber: '01',
                        title: 'Neon Street',
                        description: 'A futuristic car enters a rain-soaked neon street and accelerates into the night.',
                        location: 'Neon Downtown',
                        shots: [
                            shot(sceneId, '001', 'Establishing street', 6, 'Wide establishing shot of the neon district in heavy rain.', 'WIDE', 'Eye level', '24mm', 'Slow dolly in', 'APPROVED'),
                            shot(sceneId, '002', 'Car reveal', 8, 'Hero car emerges from shadow and crosses the wet intersection.', 'MEDIUM WIDE', 'Low angle', '35mm', 'Tracking', 'REVIEW'),
                            shot(sceneId, '003', 'Acceleration', 8, 'The car accelerates hard; reflections stretch across the road.', 'CLOSE', 'Low angle', '50mm', 'Side tracking', 'READY'),
                        ],
                    },
                    {
                        id: scene2Id,
                        sequenceId,
                        sceneNumber: '02',
                        title: 'Tunnel Pursuit',
                        description: 'The chase enters a tunnel with fast lighting transitions.',
                        location: 'City Tunnel',
                        shots: [
                            shot(scene2Id, '004', 'Tunnel entrance', 6, 'Car dives into the tunnel as city lights fall away.', 'WIDE', 'Rear three-quarter', '28mm', 'Follow', 'PLANNED'),
                            shot(scene2Id, '005', 'Driver insert', 4, 'Short interior insert showing the driver focused on the road.', 'CLOSE', 'Eye level', '70mm', 'Locked', 'PLANNED'),
                        ],
                    },
                ],
            },
        ],
    };
}
function shot(sceneId, shotNumber, title, durationSeconds, description, shotSize, angle, lens, movement, status) {
    return {
        id: `shot-${shotNumber}`,
        sceneId,
        shotNumber,
        title,
        durationSeconds,
        description,
        characters: [],
        props: [],
        camera: { shotSize, angle, lens, movement },
        workflowId: `workflow-shot-${shotNumber}`,
        takes: [],
        status,
    };
}
function allScenes(project) {
    return project.sequences.flatMap((sequence) => sequence.scenes);
}
function allShots(project) {
    return allScenes(project).flatMap((scene) => scene.shots);
}
function projectDuration(project) {
    return allShots(project).reduce((total, item) => total + item.durationSeconds, 0);
}
function updateShot(project, shotId, updater) {
    return {
        ...project,
        updatedAt: now(),
        sequences: project.sequences.map((sequence) => ({
            ...sequence,
            scenes: sequence.scenes.map((scene) => ({
                ...scene,
                shots: scene.shots.map((item) => item.id === shotId ? updater(item) : item),
            })),
        })),
    };
}
function addShot(project, sceneId) {
    const shots = allShots(project);
    const nextNumber = String(shots.length + 1).padStart(3, '0');
    const shotId = `shot-${Date.now()}`;
    const newShot = {
        id: shotId,
        sceneId,
        shotNumber: nextNumber,
        title: 'New Shot',
        durationSeconds: 6,
        description: 'Describe the visual action for this shot.',
        characters: [],
        props: [],
        camera: { shotSize: 'MEDIUM', angle: 'Eye level', lens: '50mm', movement: 'Static' },
        workflowId: `workflow-${shotId}`,
        takes: [],
        status: 'PLANNED',
    };
    return {
        shotId,
        project: {
            ...project,
            updatedAt: now(),
            sequences: project.sequences.map((sequence) => ({
                ...sequence,
                scenes: sequence.scenes.map((scene) => scene.id === sceneId ? { ...scene, shots: [...scene.shots, newShot] } : scene),
            })),
        },
    };
}
function updateAsset(project, assetId, patch) {
    return {
        ...project,
        updatedAt: now(),
        assets: project.assets.map((asset) => asset.id === assetId ? { ...asset, ...patch } : asset),
    };
}
function addAsset(project, type) {
    const assetId = `asset-${type.toLowerCase()}-${Date.now()}`;
    const asset = {
        id: assetId,
        projectId: project.id,
        type,
        name: type === 'CHARACTER' ? 'New Character' : type === 'LOCATION' ? 'New Location' : type === 'PROP' ? 'New Prop' : `New ${type}`,
        description: '',
        tags: [],
        referenceUrls: [],
        continuityNotes: '',
        locked: false,
    };
    return {
        assetId,
        project: { ...project, updatedAt: now(), assets: [...project.assets, asset] },
    };
}
function toggleShotAsset(project, shotId, asset) {
    return updateShot(project, shotId, (shot) => {
        if (asset.type === 'CHARACTER') {
            const exists = shot.characters.includes(asset.id);
            return { ...shot, characters: exists ? shot.characters.filter((id) => id !== asset.id) : [...shot.characters, asset.id] };
        }
        if (asset.type === 'PROP') {
            const props = shot.props ?? [];
            const exists = props.includes(asset.id);
            return { ...shot, props: exists ? props.filter((id) => id !== asset.id) : [...props, asset.id] };
        }
        if (asset.type === 'LOCATION') {
            return { ...shot, location: shot.location === asset.id ? undefined : asset.id };
        }
        return shot;
    });
}
function assetUsageCount(project, assetId) {
    return allShots(project).filter((shot) => shot.characters.includes(assetId) || shot.location === assetId || (shot.props ?? []).includes(assetId)).length;
}
