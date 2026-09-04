from pathlib import Path

root = Path(r'E:\Flow_veo\flowgraph-extension')

# 1) FilmTake carries a stable local render source when the extension downloads media.
film = root / 'src/types/film.ts'
s = film.read_text(encoding='utf-8')
old = "  previewUrl?: string;\n  mediaId?: string;\n  durationSeconds?: number;"
new = "  previewUrl?: string;\n  mediaId?: string;\n  localPath?: string;\n  fileName?: string;\n  mimeType?: string;\n  durationSeconds?: number;"
if old not in s:
    raise SystemExit('film.ts FilmTake anchor not found')
s = s.replace(old, new, 1)
film.write_text(s, encoding='utf-8')

# 2) Main Studio: save the latest workflow video result into the active shot as a Take.
main = root / 'src/ui/studio/main.tsx'
s = main.read_text(encoding='utf-8')
s = s.replace("import { allShots, createDemoFilmProject } from './filmModel';", "import { allShots, createDemoFilmProject, updateShot } from './filmModel';")

anchor = "  const selectedNode = nodes.find((node) => node.id === selectedNodeId);\n  const selectedSpec = selectedNode ? palette.find((spec) => spec.kind === selectedNode.data.kind) : undefined;\n"
insert = r'''  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedSpec = selectedNode ? palette.find((spec) => spec.kind === selectedNode.data.kind) : undefined;

  const workflowVideoResult = useMemo(() => {
    const candidate = [...nodes].reverse().find((node) => {
      const url = node.data.result?.previewUrl ?? node.data.config.resultUrl ?? node.data.config.previewUrl ?? node.data.config.outputUrl;
      const type = node.data.result?.type ?? node.data.config.resultType?.toLowerCase() ?? node.data.preview;
      return Boolean(url && type === 'video' && node.data.status === 'success');
    });
    if (!candidate) return undefined;
    return {
      previewUrl: candidate.data.result?.previewUrl ?? candidate.data.config.resultUrl ?? candidate.data.config.previewUrl ?? candidate.data.config.outputUrl ?? '',
      mediaId: candidate.data.result?.mediaId ?? candidate.data.config.mediaId,
      fileName: candidate.data.result?.fileName ?? candidate.data.config.fileName,
      mimeType: candidate.data.result?.mimeType ?? candidate.data.config.mimeType ?? 'video/mp4',
    };
  }, [nodes]);

  const saveWorkflowAsTake = useCallback(async () => {
    if (!workflowVideoResult?.previewUrl || !selectedShotId) return;
    const shot = allShots(filmProject).find((item) => item.id === selectedShotId);
    if (!shot) return;
    const version = shot.takes.length + 1;
    const safeProject = filmProject.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'film';
    const suggestedFile = `FlowGraph/${safeProject}/shot-${shot.shotNumber}/take-${version}.mp4`;
    let localPath: string | undefined;

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id && /^https?:|^blob:|^data:/.test(workflowVideoResult.previewUrl)) {
        const response = await chrome.runtime.sendMessage({
          type: 'FLOWGRAPH_DOWNLOAD_MEDIA',
          url: workflowVideoResult.previewUrl,
          filename: suggestedFile,
        }) as { ok?: boolean; filename?: string } | undefined;
        if (response?.ok && response.filename) localPath = response.filename;
      }
    } catch (error) {
      console.warn('[FlowGraph] Could not materialize workflow media locally; Take will keep provider URL.', error);
    }

    setFilmProject((current) => updateShot(current, selectedShotId, (currentShot) => {
      const takeId = `take-${currentShot.id}-${Date.now()}`;
      return {
        ...currentShot,
        status: 'REVIEW',
        selectedTakeId: takeId,
        takes: [...currentShot.takes, {
          id: takeId,
          shotId: currentShot.id,
          version: currentShot.takes.length + 1,
          status: 'REVIEW',
          previewUrl: workflowVideoResult.previewUrl,
          mediaId: workflowVideoResult.mediaId,
          localPath,
          fileName: localPath ? localPath.split(/[\\/]/).pop() : workflowVideoResult.fileName,
          mimeType: workflowVideoResult.mimeType,
          durationSeconds: currentShot.durationSeconds,
          createdAt: new Date().toISOString(),
        }],
      };
    }));
    setWorkspace('shots');
  }, [filmProject, selectedShotId, workflowVideoResult]);
'''
if anchor not in s:
    raise SystemExit('main selectedNode anchor not found')
s = s.replace(anchor, insert, 1)

# Ensure opening Flow pins the correct shot/scene even when launched from Storyboard.
open_anchor = "  const openFlowForShot = useCallback((shot: FilmShot) => {\n    const camera ="
open_replace = "  const openFlowForShot = useCallback((shot: FilmShot) => {\n    setSelectedSceneId(shot.sceneId);\n    setSelectedShotId(shot.id);\n    const camera ="
if open_anchor not in s:
    raise SystemExit('openFlowForShot anchor not found')
s = s.replace(open_anchor, open_replace, 1)

# Add Save Take action beside Run Workflow.
top_anchor = "          {workspace === 'flow' && (runStatus === 'running' ? <button className=\"fg-btn fg-btn-primary\" onClick={stopWorkflow}><Square size={13} /> Stop Workflow</button> : <button className=\"fg-btn fg-btn-primary\" onClick={() => void runWorkflow(false)}><Play size={14} /> Run Workflow</button>)}\n"
top_replace = top_anchor + "          {workspace === 'flow' && <button className=\"fg-btn\" disabled={!workflowVideoResult} title={workflowVideoResult ? 'Save latest successful video result as a Take' : 'No successful video result available'} onClick={() => void saveWorkflowAsTake()}><Download size={14} /> Save Take</button>}\n"
if top_anchor not in s:
    raise SystemExit('topbar run button anchor not found')
s = s.replace(top_anchor, top_replace, 1)
main.write_text(s, encoding='utf-8')

# 3) Render job embeds the concrete Take source beside each timeline clip.
render = root / 'src/ui/studio/RenderWorkspace.tsx'
s = render.read_text(encoding='utf-8')
old = "  const makeRenderJob = () => ({\n    schemaVersion: 1,\n    projectId: project.id,\n    projectTitle: project.title,\n    timeline: project.timeline,"
new = r'''  const makeRenderJob = () => {
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
    timeline,'''
if old not in s:
    raise SystemExit('RenderWorkspace makeRenderJob anchor not found')
s = s.replace(old, new, 1)
old_tail = "      container: 'mp4',\n    },\n  });"
new_tail = "      container: 'mp4',\n    },\n  };\n  };"
if old_tail not in s:
    raise SystemExit('RenderWorkspace makeRenderJob tail not found')
s = s.replace(old_tail, new_tail, 1)
render.write_text(s, encoding='utf-8')

print('patched media/take/render bridge')
