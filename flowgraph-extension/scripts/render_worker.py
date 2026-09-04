from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterable


def load_job(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding='utf-8'))
    if data.get('schemaVersion') != 1:
        raise ValueError('Unsupported render job schemaVersion')
    return data


def _source_path(clip: dict[str, Any], media_root: Path, exts: Iterable[str]) -> Path | None:
    source = clip.get('source') or {}
    local_path = source.get('localPath')
    if local_path:
        candidate = Path(local_path).expanduser()
        if candidate.exists() and candidate.is_file():
            return candidate.resolve()

    media_id = source.get('mediaId') or clip.get('mediaId') or clip.get('takeId') or clip.get('assetId')
    if not media_id:
        return None
    for ext in exts:
        candidate = media_root / f'{media_id}.{ext}'
        if candidate.exists() and candidate.is_file():
            return candidate.resolve()
    return None


def resolve_track_inputs(job: dict[str, Any], media_root: Path, track_types: set[str], exts: Iterable[str]) -> list[tuple[dict[str, Any], Path, str]]:
    clips: list[tuple[dict[str, Any], Path, str]] = []
    for track in job.get('timeline', []):
        track_type = str(track.get('type', ''))
        if track_type not in track_types or track.get('muted'):
            continue
        for clip in track.get('clips', []):
            found = _source_path(clip, media_root, exts)
            if found:
                clips.append((clip, found, track_type))
    return sorted(clips, key=lambda item: (float(item[0].get('startSeconds', 0)), item[2]))


def timeline_duration(job: dict[str, Any]) -> float:
    end = 0.0
    for track in job.get('timeline', []):
        if track.get('muted'):
            continue
        for clip in track.get('clips', []):
            start = float(clip.get('startSeconds') or 0)
            duration = max(0.0, float(clip.get('durationSeconds') or 0))
            end = max(end, start + duration)
    return end


def ffmpeg_escape_filter_path(path: Path) -> str:
    text = path.resolve().as_posix().replace("'", r"\'")
    if len(text) >= 2 and text[1] == ':':
        text = text[0] + r'\:' + text[2:]
    return text


def make_subtitle_file(job: dict[str, Any], temp_dir: Path) -> Path | None:
    entries: list[tuple[float, float, str]] = []
    for track in job.get('timeline', []):
        if track.get('type') != 'SUBTITLE' or track.get('muted'):
            continue
        for clip in track.get('clips', []):
            text = str(clip.get('text') or clip.get('label') or clip.get('title') or '').strip()
            if not text:
                continue
            start = float(clip.get('startSeconds') or 0)
            end = start + max(0.05, float(clip.get('durationSeconds') or 0))
            entries.append((start, end, text))
    if not entries:
        return None

    def stamp(value: float) -> str:
        ms = int(round(max(0.0, value) * 1000))
        h, rem = divmod(ms, 3_600_000)
        m, rem = divmod(rem, 60_000)
        s, ms = divmod(rem, 1000)
        return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'

    path = temp_dir / 'subtitles.srt'
    body: list[str] = []
    for index, (start, end, text) in enumerate(sorted(entries), 1):
        body.extend([str(index), f'{stamp(start)} --> {stamp(end)}', text, ''])
    path.write_text('\n'.join(body), encoding='utf-8')
    return path


def transition_name(value: str | None) -> str:
    value = (value or 'NONE').upper()
    return {'DISSOLVE': 'fade', 'FADE': 'fadeblack', 'WIPE': 'wipeleft'}.get(value, 'fade')


def build_video_graph(
    video_clips: list[tuple[dict[str, Any], Path, str]],
    settings: dict[str, Any],
    inputs: list[str],
) -> tuple[list[str], str]:
    width = int(settings.get('width', 1920))
    height = int(settings.get('height', 1080))
    fps = float(settings.get('frameRate', 24))
    filters: list[str] = []
    prepared: list[tuple[dict[str, Any], str]] = []

    for index, (clip, media, _track_type) in enumerate(video_clips):
        inputs += ['-i', str(media)]
        trim_in = max(0.0, float(clip.get('trimInSeconds') or 0))
        duration = max(0.05, float(clip.get('durationSeconds') or 0.05))
        label = f'v{index}'
        filters.append(
            f'[{index}:v]trim=start={trim_in:.3f}:duration={duration:.3f},setpts=PTS-STARTPTS,'
            f'scale={width}:{height}:force_original_aspect_ratio=decrease,'
            f'pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,fps={fps},format=yuv420p[{label}]'
        )
        prepared.append((clip, label))

    if not prepared:
        raise ValueError('No resolvable VIDEO clips found')

    current_label = prepared[0][1]
    current_end = max(0.05, float(prepared[0][0].get('durationSeconds') or 0.05))
    cursor = float(prepared[0][0].get('startSeconds') or 0)
    if cursor > 0:
        black_label = 'vlead'
        filters.append(f'color=c=black:s={width}x{height}:r={fps}:d={cursor:.3f}[{black_label}]')
        filters.append(f'[{black_label}][{current_label}]concat=n=2:v=1:a=0[vleadout]')
        current_label = 'vleadout'
        current_end += cursor

    for idx in range(1, len(prepared)):
        clip, next_label = prepared[idx]
        start = max(0.0, float(clip.get('startSeconds') or 0))
        duration = max(0.05, float(clip.get('durationSeconds') or 0.05))
        transition = clip.get('transitionIn') or prepared[idx - 1][0].get('transitionOut') or 'NONE'
        gap = start - current_end

        if gap > 0.001:
            gap_label = f'gap{idx}'
            concat_label = f'vcat{idx}'
            filters.append(f'color=c=black:s={width}x{height}:r={fps}:d={gap:.3f}[{gap_label}]')
            filters.append(f'[{current_label}][{gap_label}][{next_label}]concat=n=3:v=1:a=0[{concat_label}]')
            current_label = concat_label
            current_end = start + duration
            continue

        overlap = max(0.0, current_end - start)
        if overlap > 0.001 or str(transition).upper() != 'NONE':
            trans_duration = min(max(overlap, 0.35), 1.0, max(0.05, duration - 0.01), max(0.05, current_end - 0.01))
            offset = max(0.0, current_end - trans_duration)
            xfade_label = f'vxf{idx}'
            filters.append(
                f'[{current_label}][{next_label}]xfade=transition={transition_name(str(transition))}:'
                f'duration={trans_duration:.3f}:offset={offset:.3f}[{xfade_label}]'
            )
            current_label = xfade_label
            current_end = max(current_end, start + duration)
        else:
            concat_label = f'vcat{idx}'
            filters.append(f'[{current_label}][{next_label}]concat=n=2:v=1:a=0[{concat_label}]')
            current_label = concat_label
            current_end += duration

    return filters, current_label


def build_audio_graph(
    audio_clips: list[tuple[dict[str, Any], Path, str]],
    input_offset: int,
    inputs: list[str],
) -> tuple[list[str], str | None]:
    filters: list[str] = []
    labels: list[str] = []
    for local_index, (clip, media, _track_type) in enumerate(audio_clips):
        input_index = input_offset + local_index
        inputs += ['-i', str(media)]
        trim_in = max(0.0, float(clip.get('trimInSeconds') or 0))
        duration = max(0.05, float(clip.get('durationSeconds') or 0.05))
        delay_ms = max(0, int(round(float(clip.get('startSeconds') or 0) * 1000)))
        volume = float(clip.get('volume') or 1.0)
        fade_in = max(0.0, float(clip.get('fadeInSeconds') or 0))
        fade_out = max(0.0, float(clip.get('fadeOutSeconds') or 0))
        label = f'a{local_index}'
        chain = (
            f'[{input_index}:a]atrim=start={trim_in:.3f}:duration={duration:.3f},asetpts=PTS-STARTPTS,'
            f'volume={volume:.3f},adelay={delay_ms}|{delay_ms}'
        )
        if fade_in > 0:
            chain += f',afade=t=in:st=0:d={min(fade_in, duration):.3f}'
        if fade_out > 0:
            chain += f',afade=t=out:st={max(0.0, duration - fade_out):.3f}:d={min(fade_out, duration):.3f}'
        chain += f'[{label}]'
        filters.append(chain)
        labels.append(label)

    if not labels:
        return filters, None
    mix_label = 'amixout'
    joined = ''.join(f'[{label}]' for label in labels)
    filters.append(f'{joined}amix=inputs={len(labels)}:normalize=0:dropout_transition=0[{mix_label}]')
    return filters, mix_label


def run_ffmpeg(command: list[str], duration: float) -> int:
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    assert process.stdout is not None
    for raw in process.stdout:
        line = raw.strip()
        if not line or '=' not in line:
            continue
        key, value = line.split('=', 1)
        if key == 'out_time_ms':
            try:
                seconds = int(value) / 1_000_000
                progress = 0 if duration <= 0 else min(99, int((seconds / duration) * 100))
                print(json.dumps({'status': 'progress', 'progress': progress, 'seconds': round(seconds, 3)}), flush=True)
            except ValueError:
                pass
        elif key == 'progress' and value == 'end':
            print(json.dumps({'status': 'progress', 'progress': 100, 'seconds': round(duration, 3)}), flush=True)
    stderr = process.stderr.read() if process.stderr else ''
    code = process.wait()
    if code != 0 and stderr:
        print(json.dumps({'status': 'ffmpeg-error', 'message': stderr[-4000:]}), flush=True)
    return code


def render(job: dict[str, Any], media_root: Path, output: Path, ffmpeg: str) -> int:
    temp_dir = output.parent / f'.render-{output.stem}'
    temp_dir.mkdir(parents=True, exist_ok=True)
    settings = job.get('settings', {})
    duration = max(0.05, timeline_duration(job))

    video_clips = resolve_track_inputs(job, media_root, {'VIDEO'}, ('mp4', 'mov', 'webm', 'mkv'))
    audio_clips = resolve_track_inputs(job, media_root, {'DIALOGUE', 'SFX', 'MUSIC'}, ('wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'mp4', 'mov', 'webm')) if settings.get('includeAudio', True) else []
    if not video_clips:
        print(json.dumps({'status': 'error', 'message': 'No resolvable VIDEO clips found', 'mediaRoot': str(media_root)}))
        return 2

    inputs: list[str] = []
    video_filters, video_label = build_video_graph(video_clips, settings, inputs)
    audio_filters, audio_label = build_audio_graph(audio_clips, len(video_clips), inputs)
    filters = video_filters + audio_filters

    subtitle_file = make_subtitle_file(job, temp_dir) if settings.get('burnSubtitles') else None
    if subtitle_file:
        subtitle_label = 'vsub'
        filters.append(f"[{video_label}]subtitles='{ffmpeg_escape_filter_path(subtitle_file)}'[{subtitle_label}]")
        video_label = subtitle_label

    codec = 'libx265' if settings.get('codec') == 'H265' else 'libx264'
    bitrate = str(settings.get('bitrate', '18M'))
    command = [ffmpeg, '-y', '-hide_banner', '-loglevel', 'error', *inputs, '-filter_complex', ';'.join(filters), '-map', f'[{video_label}]']
    if audio_label:
        command += ['-map', f'[{audio_label}]', '-c:a', 'aac', '-b:a', '320k']
    else:
        command += ['-an']
    command += [
        '-c:v', codec, '-b:v', bitrate, '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        '-progress', 'pipe:1', '-nostats', str(output),
    ]

    print(json.dumps({
        'status': 'running',
        'output': str(output),
        'videoClips': len(video_clips),
        'audioClips': len(audio_clips),
        'subtitles': bool(subtitle_file),
        'duration': round(duration, 3),
        'command': command,
    }), flush=True)
    code = run_ffmpeg(command, duration)
    if code == 0:
        print(json.dumps({'status': 'done', 'output': str(output), 'progress': 100}), flush=True)
    else:
        print(json.dumps({'status': 'error', 'exitCode': code}), flush=True)
    return code


def main() -> int:
    parser = argparse.ArgumentParser(description='FlowGraph FFmpeg render worker')
    parser.add_argument('job', type=Path)
    parser.add_argument('--media-root', type=Path, default=Path('evidence'))
    parser.add_argument('--output', type=Path, default=Path('renders/master.mp4'))
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    job = load_job(args.job.resolve())
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    media_root = args.media_root.resolve()

    if args.dry_run:
        video_clips = resolve_track_inputs(job, media_root, {'VIDEO'}, ('mp4', 'mov', 'webm', 'mkv'))
        audio_clips = resolve_track_inputs(job, media_root, {'DIALOGUE', 'SFX', 'MUSIC'}, ('wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'mp4', 'mov', 'webm'))
        print(json.dumps({
            'status': 'dry-run',
            'project': job.get('projectTitle'),
            'videoClipsResolved': len(video_clips),
            'audioClipsResolved': len(audio_clips),
            'timelineDuration': timeline_duration(job),
            'mediaRoot': str(media_root),
            'output': str(output),
            'settings': job.get('settings', {}),
        }, indent=2))
        return 0

    return render(job, media_root, output, args.ffmpeg)


if __name__ == '__main__':
    sys.exit(main())
