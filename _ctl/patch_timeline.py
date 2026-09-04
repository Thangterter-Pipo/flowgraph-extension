from pathlib import Path
p = Path(r'E:\Flow_veo\flowgraph-extension\src\ui\studio\main.tsx')
s = p.read_text(encoding='utf-8')
s = s.replace("import StoryboardWorkspace from './StoryboardWorkspace';", "import StoryboardWorkspace from './StoryboardWorkspace';\nimport TimelineWorkspace from './TimelineWorkspace';")
s = s.replace("useState<'shots' | 'assets' | 'storyboard' | 'flow'>('shots')", "useState<'shots' | 'assets' | 'storyboard' | 'timeline' | 'flow'>('shots')")
s = s.replace("<button className={workspace === 'storyboard' ? 'active' : ''} onClick={() => setWorkspace('storyboard')}>STORYBOARD</button>", "<button className={workspace === 'storyboard' ? 'active' : ''} onClick={() => setWorkspace('storyboard')}>STORYBOARD</button>\n            <button className={workspace === 'timeline' ? 'active' : ''} onClick={() => setWorkspace('timeline')}>TIMELINE</button>")
s = s.replace("      ) : workspace === 'storyboard' ? (", "      ) : workspace === 'timeline' ? (\n        <TimelineWorkspace project={filmProject} setProject={setFilmProject} />\n      ) : workspace === 'storyboard' ? (")
p.write_text(s, encoding='utf-8')
