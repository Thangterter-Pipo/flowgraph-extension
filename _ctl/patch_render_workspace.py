from pathlib import Path
p=Path(r'E:\Flow_veo\flowgraph-extension\src\ui\studio\main.tsx')
s=p.read_text(encoding='utf-8')
if "import RenderWorkspace from './RenderWorkspace';" not in s:
    s=s.replace("import TimelineWorkspace from './TimelineWorkspace';", "import TimelineWorkspace from './TimelineWorkspace';\nimport RenderWorkspace from './RenderWorkspace';")
s=s.replace("useState<'shots' | 'assets' | 'storyboard' | 'timeline' | 'flow'>('shots')", "useState<'shots' | 'assets' | 'storyboard' | 'timeline' | 'render' | 'flow'>('shots')")
s=s.replace("<button className={workspace === 'timeline' ? 'active' : ''} onClick={() => setWorkspace('timeline')}>TIMELINE</button>", "<button className={workspace === 'timeline' ? 'active' : ''} onClick={() => setWorkspace('timeline')}>TIMELINE</button>\n            <button className={workspace === 'render' ? 'active' : ''} onClick={() => setWorkspace('render')}>RENDER</button>")
needle="      ) : workspace === 'timeline' ? (\n        <TimelineWorkspace project={filmProject} setProject={setFilmProject} openShotManager={openShotManager} />\n"
if needle in s and "workspace === 'render'" not in s:
    s=s.replace(needle, needle+"      ) : workspace === 'render' ? (\n        <RenderWorkspace project={filmProject} />\n")
p.write_text(s, encoding='utf-8')
