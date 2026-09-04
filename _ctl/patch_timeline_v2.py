from pathlib import Path

root = Path(r"E:\Flow_veo\flowgraph-extension")

film = root / "src/types/film.ts"
s = film.read_text(encoding="utf-8")
s = s.replace(
"  trimOutSeconds?: number;\n}",
"  trimOutSeconds?: number;\n  sourceDurationSeconds?: number;\n  transitionIn?: 'NONE' | 'DISSOLVE' | 'FADE' | 'WIPE';\n  transitionOut?: 'NONE' | 'DISSOLVE' | 'FADE' | 'WIPE';\n}"
)
s = s.replace(
"  name: string;\n  clips: TimelineClip[];\n}",
"  name: string;\n  clips: TimelineClip[];\n  muted?: boolean;\n  locked?: boolean;\n}"
)
film.write_text(s, encoding="utf-8")

main = root / "src/ui/studio/main.tsx"
s = main.read_text(encoding="utf-8")
s = s.replace(
"        <TimelineWorkspace project={filmProject} setProject={setFilmProject} />",
"        <TimelineWorkspace\n          project={filmProject}\n          setProject={setFilmProject}\n          openShotManager={(shotId) => {\n            const shot = allShots(filmProject).find((item) => item.id === shotId);\n            if (shot) openShotManager(shot);\n          }}\n        />"
)
if "allShots" not in s.split("from './filmModel';")[0][-120:]:
    s = s.replace("import { createDemoFilmProject } from './filmModel';", "import { allShots, createDemoFilmProject } from './filmModel';")
main.write_text(s, encoding="utf-8")
