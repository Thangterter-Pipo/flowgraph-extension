from pathlib import Path
import re
src=Path(r'E:\Flow_veo\_handoff\add_pipeline.py')
out=Path(r'E:\Flow_veo\_handoff\add_pipeline_clean.py')
s=src.read_text(encoding='utf-8')
pattern=r"\nw\('tools/rebuild_repository\.py', r'''[\s\S]*?'''\)\n\nprint\(\"Added executable registry/planning/prompt/continuity/budget/orchestration layer\"\)"
replacement='\n# rebuild_repository.py is owned by the canonical build harness.\n\nprint("Added executable registry/planning/prompt/continuity/budget/orchestration layer")'
s,n=re.subn(pattern,replacement,s,count=1)
if n!=1: raise SystemExit(f'expected 1 stale rebuild writer, found {n}')
out.write_text(s,encoding='utf-8')
print(out)
