from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)

VERIFIED_ARTIFACTS = {
    "t2v": "evidence/download/verified_fox_video.mp4",
    "i2v": "evidence/download/i2v_verified_cd2ef7e8-606b-47a7-89b2-681117c0451d.mp4",
    "interpolation": "evidence/download/interpolation_verified_d6e527a8-2089-4b2c-8e88-c7a26bd4a764.mp4",
    "reference": "evidence/video/reference/reference_verified_1d2d1e90-a4be-4b6a-82b3-f691e787632e.mp4",
    "extend_edit": "evidence/download/extend_verified_9f714655-adcc-4c67-adb6-ad7847c4d49b.mp4",
}


def repo_path(rel: str | Path) -> Path:
    return ROOT / rel


def load_json(rel: str | Path) -> Any:
    with repo_path(rel).open("r", encoding="utf-8") as fh:
        return json.load(fh)


def read_text(rel: str | Path) -> str:
    return repo_path(rel).read_text(encoding="utf-8")


def assert_uuid(value: str) -> None:
    assert isinstance(value, str) and UUID_RE.match(value), f"Expected UUID, got: {value!r}"


def assert_mp4(path: Path, expected_size: int | None = None) -> None:
    assert path.exists(), f"Missing MP4 artifact: {path}"
    size = path.stat().st_size
    assert size > 1024, f"Artifact too small to be a real MP4: {size} bytes"
    if expected_size is not None:
        assert size == expected_size, f"MP4 size mismatch: disk={size}, evidence={expected_size}"
    with path.open("rb") as fh:
        head = fh.read(16)
    assert len(head) >= 8 and head[4:8] == b"ftyp", f"Not an ISO BMFF/MP4 file: {path}"


@pytest.fixture(scope="session")
def manifest() -> dict[str, Any]:
    return load_json("evidence_manifest.json")


@pytest.fixture(scope="session")
def master_text() -> str:
    return read_text("GOOGLE_FLOW_API_REFERENCE.md")


@pytest.fixture(scope="session")
def live_enabled() -> bool:
    return os.getenv("FLOW_RUN_LIVE_PAID", "0") == "1"
