"""Rebuild generated repository state in canonical, non-live order."""
from __future__ import annotations
import os
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PY=sys.executable

def run(args, *, env=None):
    print('+',' '.join(map(str,args)),flush=True)
    subprocess.run(args,cwd=ROOT,env=env,check=True)

for script in (
    'bootstrap_system.py','generate_skills.py','expand_skills.py','render_docs.py','add_pipeline.py',
    'apply_pointer_ownership.py','postprocess_skill_graph.py','finalize_phase2_docs.py','finalize_runtime_surface.py',
):
    run([PY,str(ROOT/'tools'/script)])

env=os.environ.copy()
env['PYTHONPATH']=str(ROOT/'src')+(os.pathsep+env['PYTHONPATH'] if env.get('PYTHONPATH') else '')
run([PY,'-m','gfs.registry_build','--root',str(ROOT)],env=env)
run([PY,'-m','pytest','-q'],env=env)
run([PY,'-m','gfs.cli','cases'],env=env)
run([PY,str(ROOT/'tools'/'audit_semantics.py')],env=env)
print('Repository rebuild complete: no live browser or credit-spending operation was executed')
