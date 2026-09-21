import { describe, expect, it } from 'vitest';
import { addShot, createFilmProject } from '../../src/ui/studio/filmModel';

describe('Film project binding', () => {
  it('creates a blank production model bound to the active Google Flow project', () => {
    const project = createFilmProject('flow-project-123', 'My Film');

    expect(project.id).toBe('flow-project-123');
    expect(project.title).toBe('My Film');
    expect(project.assets).toEqual([]);
    expect(project.timeline).toEqual([]);
    expect(project.sequences).toHaveLength(1);
    expect(project.sequences[0].projectId).toBe('flow-project-123');
    expect(project.sequences[0].scenes[0].shots).toEqual([]);
  });

  it('assigns every new shot a stable dedicated workflowId', () => {
    const initial = createFilmProject('flow-project-123', 'My Film');
    const sceneId = initial.sequences[0].scenes[0].id;
    const first = addShot(initial, sceneId);
    const firstShot = first.project.sequences[0].scenes[0].shots.find((shot) => shot.id === first.shotId);

    expect(firstShot?.workflowId).toBe(`workflow-${first.shotId}`);
    expect(firstShot?.workflowId).not.toBe('main');
  });
});
