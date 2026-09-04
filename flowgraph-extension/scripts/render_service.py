from __future__ import annotations

import json
import shutil
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
JOBS = ROOT / 'renders' / 'jobs'
PROXIES = ROOT / 'proxies'
PACKAGES = ROOT / 'packages'
for directory in (JOBS, PROXIES, PACKAGES):
    directory.mkdir(parents=True, exist_ok=True)
LOCK = threading.Lock()
STATE: dict[str, dict[str, Any]] = {}
PROCESSES: dict[str, subprocess.Popen[str]] = {}


def _json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload).encode('utf-8')


def _update(job_id: str, **patch: Any) -> None:
    with LOCK:
        STATE.setdefault(job_id, {}).update(patch)


def _safe_name(value: str, fallback: str = 'project') -> str:
    return ''.join(ch.lower() if ch.isalnum() else '-' for ch in value).strip('-') or fallback


def _all_takes(project: dict[str, Any]) -> list[dict[str, Any]]:
    takes: list[dict[str, Any]] = []
    for sequence in project.get('sequences', []):
        for scene in sequence.get('scenes', []):
            for shot in scene.get('shots', []):
                for take in shot.get('takes', []):
                    takes.append({**take, '_shotId': shot.get('id'), '_shotNumber': shot.get('shotNumber')})
    return takes


def _validate_project(project: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    ready = 0
    proxied = 0
    for take in _all_takes(project):
        local_path = take.get('localPath')
        proxy_path = take.get('proxyPath')
        local_ok = bool(local_path and Path(local_path).expanduser().is_file())
        proxy_ok = bool(proxy_path and Path(proxy_path).expanduser().is_file())
        if local_ok:
            ready += 1
        if proxy_ok:
            proxied += 1
        if not local_ok and take.get('status') in {'APPROVED', 'REVIEW', 'GENERATED'}:
            issues.append({
                'kind': 'MISSING_MEDIA',
                'shotId': take.get('_shotId'),
                'shotNumber': take.get('_shotNumber'),
                'takeId': take.get('id'),
                'fileName': take.get('fileName'),
                'localPath': local_path,
                'message': 'Source media is not available on disk.',
            })
    timeline_take_ids = {
        clip.get('takeId')
        for track in project.get('timeline', [])
        if track.get('type') == 'VIDEO' and not track.get('muted')
        for clip in track.get('clips', [])
        if clip.get('takeId')
    }
    known_take_ids = {take.get('id') for take in _all_takes(project)}
    for take_id in sorted(timeline_take_ids - known_take_ids):
        issues.append({'kind': 'ORPHAN_TIMELINE_CLIP', 'takeId': take_id, 'message': 'Timeline references a Take that no longer exists.'})
    return {
        'ok': not issues,
        'issues': issues,
        'takeCount': len(_all_takes(project)),
        'mediaReady': ready,
        'proxyReady': proxied,
        'missingMedia': sum(1 for issue in issues if issue['kind'] == 'MISSING_MEDIA'),
    }


def _make_proxy(source: Path, take_id: str | None = None) -> Path:
    if not source.is_file():
        raise FileNotFoundError(str(source))
    stem = _safe_name(take_id or source.stem, 'media')
    output = PROXIES / f'{stem}-proxy.mp4'
    command = [
        'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(source),
        '-vf', "scale='min(1280,iw)':-2", '-r', '24',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(output),
    ]
    completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    if completed.returncode:
        raise RuntimeError(completed.stderr[-1200:] or f'ffmpeg exitCode={completed.returncode}')
    return output.resolve()


def _relink(project: dict[str, Any], search_root: Path) -> dict[str, str]:
    if not search_root.is_dir():
        raise NotADirectoryError(str(search_root))
    missing = [take for take in _all_takes(project) if take.get('fileName') and not (take.get('localPath') and Path(take['localPath']).is_file())]
    needed = {str(take['fileName']).lower(): take.get('id') for take in missing}
    matches: dict[str, str] = {}
    if not needed:
        return matches
    for path in search_root.rglob('*'):
        if not path.is_file():
            continue
        take_id = needed.get(path.name.lower())
        if take_id and take_id not in matches:
            matches[str(take_id)] = str(path.resolve())
        if len(matches) == len(needed):
            break
    return matches


def _package_project(project: dict[str, Any]) -> tuple[Path, int, list[str]]:
    safe = _safe_name(str(project.get('title') or 'film'))
    stamp = time.strftime('%Y%m%d-%H%M%S')
    package_path = PACKAGES / f'{safe}-{stamp}.zip'
    copied = 0
    missing: list[str] = []
    used_names: set[str] = set()
    with zipfile.ZipFile(package_path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('project.json', json.dumps({'schemaVersion': 1, 'project': project}, indent=2))
        for take in _all_takes(project):
            raw = take.get('localPath')
            if not raw:
                continue
            source = Path(raw).expanduser()
            if not source.is_file():
                missing.append(str(raw))
                continue
            base = source.name
            name = base
            counter = 2
            while name.lower() in used_names:
                name = f'{source.stem}-{counter}{source.suffix}'
                counter += 1
            used_names.add(name.lower())
            archive.write(source, f'media/{name}')
            copied += 1
        for take in _all_takes(project):
            raw = take.get('proxyPath')
            if raw and Path(raw).is_file():
                archive.write(Path(raw), f'proxies/{Path(raw).name}')
    return package_path.resolve(), copied, missing


def _run(job_id: str, job_path: Path, output: Path) -> None:
    command = [sys.executable, str(ROOT / 'scripts' / 'render_worker.py'), str(job_path), '--output', str(output)]
    process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    with LOCK:
        PROCESSES[job_id] = process
    _update(job_id, status='RUNNING', progress=0, output=str(output))
    assert process.stdout is not None
    for raw in process.stdout:
        line = raw.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            _update(job_id, message=line[-500:])
            continue
        status = event.get('status')
        if status == 'progress':
            _update(job_id, progress=int(event.get('progress', 0)), seconds=event.get('seconds'))
        elif status == 'running':
            _update(job_id, status='RUNNING', output=event.get('output'))
        elif status == 'done':
            _update(job_id, status='DONE', progress=100, output=event.get('output'))
        elif status in {'error', 'ffmpeg-error'}:
            _update(job_id, status='ERROR', message=event.get('message') or f"exitCode={event.get('exitCode')}")
    code = process.wait()
    with LOCK:
        PROCESSES.pop(job_id, None)
    current = STATE.get(job_id, {})
    if current.get('status') not in {'DONE', 'CANCELLED'}:
        _update(job_id, status='ERROR' if code else 'DONE', progress=100 if code == 0 else current.get('progress', 0), exitCode=code)


class Handler(BaseHTTPRequestHandler):
    server_version = 'FlowGraphProduction/2.0'

    def _cors(self) -> None:
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = _json_bytes(payload)
        self.send_response(status)
        self._cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == '/health':
            self._send(200, {'ok': True, 'service': 'FlowGraph Production Service', 'version': 2})
            return
        if self.path.startswith('/proxy-media/'):
            name = self.path.split('/proxy-media/', 1)[1]
            if '/' in name or '\\' in name or '..' in name:
                self._send(400, {'ok': False, 'error': 'Invalid proxy filename'})
                return
            target = PROXIES / name
            if not target.is_file():
                self._send(404, {'ok': False, 'error': 'Proxy not found'})
                return
            body = target.read_bytes()
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'video/mp4')
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith('/status/'):
            job_id = self.path.rsplit('/', 1)[-1]
            with LOCK:
                state = dict(STATE.get(job_id, {}))
            if not state:
                self._send(404, {'ok': False, 'error': 'Unknown render job'})
                return
            self._send(200, {'ok': True, 'jobId': job_id, **state})
            return
        self._send(404, {'ok': False, 'error': 'Not found'})

    def do_POST(self) -> None:
        length = int(self.headers.get('Content-Length', '0'))
        try:
            data = json.loads(self.rfile.read(length) or b'{}')
        except json.JSONDecodeError:
            self._send(400, {'ok': False, 'error': 'Invalid JSON'})
            return

        try:
            if self.path == '/validate':
                project = data.get('project') or data
                self._send(200, {'ok': True, **_validate_project(project)})
                return

            if self.path == '/proxy':
                source = Path(str(data.get('path') or '')).expanduser()
                output = _make_proxy(source, data.get('takeId'))
                self._send(200, {'ok': True, 'proxyPath': str(output), 'proxyUrl': f'http://127.0.0.1:3091/proxy-media/{output.name}'})
                return

            if self.path == '/relink':
                project = data.get('project') or {}
                root = Path(str(data.get('searchRoot') or '')).expanduser()
                matches = _relink(project, root)
                self._send(200, {'ok': True, 'matches': matches, 'count': len(matches)})
                return

            if self.path == '/package':
                project = data.get('project') or data
                package_path, copied, missing = _package_project(project)
                self._send(200, {'ok': True, 'packagePath': str(package_path), 'mediaCopied': copied, 'missing': missing})
                return

            if self.path == '/render':
                job_id = uuid.uuid4().hex[:12]
                job_path = JOBS / f'{job_id}.json'
                job_path.write_text(json.dumps(data, indent=2), encoding='utf-8')
                safe_title = _safe_name(str(data.get('projectTitle') or 'master'), 'master')
                output = ROOT / 'renders' / f'{safe_title}-{job_id}.mp4'
                _update(job_id, status='QUEUED', progress=0, output=str(output))
                threading.Thread(target=_run, args=(job_id, job_path, output), daemon=True).start()
                self._send(202, {'ok': True, 'jobId': job_id, 'status': 'QUEUED', 'output': str(output)})
                return

            if self.path.startswith('/cancel/'):
                job_id = self.path.rsplit('/', 1)[-1]
                with LOCK:
                    process = PROCESSES.get(job_id)
                if process and process.poll() is None:
                    process.terminate()
                    _update(job_id, status='CANCELLED')
                    self._send(200, {'ok': True, 'jobId': job_id, 'status': 'CANCELLED'})
                    return
                self._send(409, {'ok': False, 'error': 'Render is not running'})
                return
        except Exception as exc:
            self._send(400, {'ok': False, 'error': str(exc)})
            return

        self._send(404, {'ok': False, 'error': 'Not found'})

    def log_message(self, format: str, *args: Any) -> None:
        print(f'[production-service] {self.address_string()} {format % args}')


def main() -> None:
    host = '127.0.0.1'
    port = 3091
    print(f'FlowGraph Production Service listening on http://{host}:{port}', flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == '__main__':
    main()
