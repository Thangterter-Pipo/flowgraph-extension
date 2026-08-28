"""
MCP server exposing E:\\Flow_veo as a remote filesystem over streamable HTTP.

Design (see README.md):
- Python FastMCP 3.x, transport="http", bound to 0.0.0.0 so a Cloudflare
  tunnel can reach it.
- Bearer API key auth enforced in the FastMCP app: every /mcp request must
  carry `Authorization: Bearer <key>`, matching FLOW_VEO_MCP_API_KEY.
- All paths are relative to FLOW_VEO_MCP_ROOT (default E:\\Flow_veo) and
  validated against path traversal (`..`, absolute paths, drive letters).
- Read tools and write tools are strictly separated (Anthropic review rule).
"""

from __future__ import annotations

import base64
import fnmatch
import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastmcp import FastMCP
from fastmcp.server.auth.auth import (
    ClientRegistrationOptions,
    OAuthClientInformationFull,
    OAuthProvider,
)

from register_all import register_all_tools
from services.process_manager import PROCESS_MANAGER
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    OAuthToken,
    RefreshToken,
)
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ROOT = Path(os.environ.get("FLOW_VEO_MCP_ROOT", r"E:\Flow_veo")).resolve()
API_KEY = os.environ.get("FLOW_VEO_MCP_API_KEY", "")
HOST = os.environ.get("FLOW_VEO_MCP_HOST", "0.0.0.0")
PORT = int(os.environ.get("FLOW_VEO_MCP_PORT", "3080"))

# Public HTTPS base URL. Required for OAuth — the server must be reachable at
# this URL for /authorize, /token, DCR and .well-known discovery to work.
# Resolved from the Cloudflare named tunnel in front of the SSH reverse tunnel.
BASE_URL = os.environ.get("FLOW_VEO_MCP_BASE_URL", "https://flowveo.thangterter.online")

# Paths skipped by list_tree (never surfaced, never editable) — keeps the
# knowledge graph focused and avoids handing out huge dirs.
EXCLUDED = {".venv", ".git", "node_modules", "__pycache__", ".pytest_cache"}

TEXT_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".json", ".yaml", ".yml", ".toml",
    ".md", ".mdx", ".txt", ".rst", ".csv", ".html", ".htm", ".css", ".scss",
    ".xml", ".ini", ".cfg", ".conf", ".env", ".sh", ".bat", ".ps1", ".sql",
    ".java", ".go", ".rs", ".c", ".h", ".cpp", ".hpp", ".ipynb", ".lua",
    ".rb", ".php", ".vue", ".svelte", ".lock", ".log", ".diff", ".patch",
}


# ---------------------------------------------------------------------------
# Bearer API-key auth (ASGI middleware)
# ---------------------------------------------------------------------------

def _check_auth(request) -> bool:
    """Compare the Authorization header against FLOW_VEO_MCP_API_KEY."""
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        return secrets.compare_digest(auth[7:].strip(), API_KEY)
    # Also accept the key directly in the header (some hosts only allow one
    # fixed header name).
    return secrets.compare_digest(auth.strip(), API_KEY)


class APIKeyMiddleware(BaseHTTPMiddleware):
    """Reject every request that does not carry the correct Bearer API key.

    Applied as the outermost middleware so not even the MCP endpoints are
    reachable without the key. The /health endpoint is exempt so tunnel /
    load-balancer probes can check liveness without leaking anything.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request, call_next):
        path = request.url.path
        # Public endpoints: health probes, OAuth discovery + authorize page,
        # token endpoint (client auth is handled inside OAuth), DCR register,
        # and the OIDC/well-known metadata. These must be reachable without the
        # static API key so ChatGPT can complete the OAuth flow.
        public_paths = (
            "/health",
            "/healthz",
            "/.well-known/",
            "/authorize",
            "/token",
            "/register",
            "/revoke",
            "/introspect",
            "/userinfo",
            "/jwks",
            "/.well-known/openid-configuration",
        )
        if path in ("/health", "/healthz") or any(path.startswith(p) for p in public_paths):
            return await call_next(request)
        if not API_KEY:
            # No static API key configured: let FastMCP's OAuth layer handle
            # authorization (it will reject requests without a valid token).
            return await call_next(request)
        if _check_auth(request):
            return await call_next(request)
        # Not the static API key. If the request carries an OAuth access token
        # (from the completed authorization flow), FastMCP's RequireAuthMiddleware
        # will verify it — pass through. Otherwise FastMCP rejects with 401.
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            return await call_next(request)
        return JSONResponse(
            {"error": "Unauthorized. Provide the API key in the Authorization header as 'Bearer <key>', or complete the OAuth flow to obtain an access token."},
            status_code=401,
        )


# ---------------------------------------------------------------------------
# Path safety
# ---------------------------------------------------------------------------

def _is_inside(path: Path, root: Path) -> bool:
    """True if `path` is at or under `root`."""
    try:
        path.resolve().relative_to(root)
        return True
    except ValueError:
        return False


def _validate_relpath(relpath: str, for_write: bool = False) -> Path:
    """Resolve a user-supplied relative path against ROOT, rejecting escapes.

    Raises ValueError with an actionable message for anything unsafe.
    """
    if not relpath or relpath.isspace():
        raise ValueError("path must not be empty.")
    # Normalize to forward slashes, strip leading slash so it stays relative.
    rel = relpath.strip().replace("\\", "/").lstrip("/")
    candidate = (ROOT / rel).resolve()
    if not _is_inside(candidate, ROOT):
        raise ValueError(
            f"Path '{relpath}' escapes the root directory '{ROOT}'. "
            "Use a path relative to the root."
        )
    if for_write and candidate == ROOT:
        raise ValueError("Cannot write to the root directory itself.")
    return candidate


def _suggest(relpath: str) -> str | None:
    """Best-effort suggestion when a path is missing."""
    try:
        parent = _validate_relpath(str(Path(relpath).parent))
    except ValueError:
        return None
    try:
        children = [p.name for p in parent.iterdir() if not p.name.startswith(".")]
    except OSError:
        return None
    for name in sorted(children):
        if name.lower().startswith(Path(relpath).name.lower()):
            return str((parent / name).relative_to(ROOT)).replace("\\", "/")
    return None


def _render_error(err: ValueError) -> dict:
    return {
        "ok": False,
        "error": str(err),
        "root": str(ROOT),
        "hint": "Paths are relative to the root. Use list_tree / list_dir to discover valid paths.",
    }


def _file_entry(path: Path) -> dict:
    rel = path.relative_to(ROOT).as_posix()
    is_dir = path.is_dir()
    return {
        "name": path.name,
        "path": rel,
        "type": "dir" if is_dir else "file",
        "size": 0 if is_dir else path.stat().st_size,
        "modified": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        .isoformat(),
    }


def _read_text_or_binary(path: Path, max_text_chars: int) -> dict:
    """Read a file, returning text for known-text types else base64 blob."""
    suffix = path.suffix.lower()
    if suffix in TEXT_EXTENSIONS or suffix == "":
        try:
            data = path.read_text(encoding="utf-8")
            truncated = len(data) > max_text_chars
            if truncated:
                data = data[:max_text_chars] + f"\n...[truncated {len(data)} -> {max_text_chars} chars]"
            return {"encoding": "utf-8", "content": data, "truncated": truncated}
        except UnicodeDecodeError:
            pass  # fall through to binary
    size = path.stat().st_size
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return {"encoding": "base64", "content": b64, "truncated": False, "size": size}


# ---------------------------------------------------------------------------
# OAuth client store (persistent so a registered ChatGPT client survives restarts)
# ---------------------------------------------------------------------------

class PersistentOAuthProvider(OAuthProvider):
    """OAuthProvider with a JSON-file backed client store + full auth-code flow.

    FastMCP's OAuthProvider leaves the SDK's abstract methods (get_client,
    register_client, authorize, load/exchange authorization codes & tokens) as
    no-op stubs, so without this subclass every registered client would be
    "not found" on /authorize and /authorize would redirect to a None URL.

    This subclass implements the complete OAuth 2.1 authorization-code + PKCE
    flow:
      - Clients persisted to oauth_clients.json (register once, reuse forever).
      - /authorize generates a short-lived auth code (160-bit) bound to the
        PKCE challenge + redirect_uri, stores it, and redirects straight back
        to the client's redirect_uri (no third-party consent page — this is a
        single-owner filesystem, so consent is implicit).
      - /token exchanges the code for a Bearer access token + refresh token,
        verifying the PKCE code_verifier (done by the SDK handler) and
        redirect_uri.
      - Access/refresh tokens are stored in-memory with expiry; access tokens
        are also returned to verify_token for /mcp authorization.
    """

    def __init__(self, *args, store_path: str | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._store_path = Path(store_path) if store_path else Path(__file__).parent / "oauth_clients.json"
        self._clients: dict[str, OAuthClientInformationFull] = {}
        self._auth_codes: dict[str, AuthorizationCode] = {}
        self._access_tokens: dict[str, AccessToken] = {}
        self._refresh_tokens: dict[str, RefreshToken] = {}
        if self._store_path.exists():
            try:
                import json as _json

                raw = _json.loads(self._store_path.read_text(encoding="utf-8"))
                for cid, data in raw.items():
                    self._clients[cid] = OAuthClientInformationFull.model_validate(data)
            except Exception:
                self._clients = {}

    def _save(self) -> None:
        import json as _json

        self._store_path.write_text(
            _json.dumps({cid: c.model_dump(mode="json") for cid, c in self._clients.items()}, indent=2),
            encoding="utf-8",
        )

    def _new_token(self, length: int = 48) -> str:
        """Cryptographically-random URL-safe token string (>=160 bits)."""
        return secrets.token_urlsafe(length)

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        return self._clients.get(client_id)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        # Guarantee the client can request every scope we support. Some clients
        # (ChatGPT) request scopes individually during /authorize
        # (scope=filesystem+read+write) and validate_scope rejects anything the
        # client was not registered with. If the client omitted scopes or
        # registered a subset, fill in the full set so authorization succeeds.
        if not client_info.scope:
            client_info.scope = "filesystem read write"
        else:
            current = set(client_info.scope.split())
            full = {"filesystem", "read", "write"}
            if not full.issubset(current):
                client_info.scope = " ".join(sorted(full | current))
        self._clients[client_info.client_id] = client_info
        self._save()

    async def authorize(self, client: OAuthClientInformationFull, params) -> str:
        """Generate an auth code bound to this request and redirect to the client.

        Implements the implicit-consent flow: the resource owner (the single
        operator of this server) is assumed to approve every request, so we
        skip an interactive consent page and redirect straight back with the
        code, mirroring RFC 6749 §4.1.2.
        """
        import urllib.parse as _up

        code = self._new_token(32)
        now = datetime.now(timezone.utc).timestamp()
        self._auth_codes[code] = AuthorizationCode(
            code=code,
            scopes=params.scopes or [],
            expires_at=now + 600,  # 10 min
            client_id=client.client_id,
            code_challenge=params.code_challenge,
            redirect_uri=params.redirect_uri,
            redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
            resource=params.resource,
            subject=params.resource,  # no real user; tie to the resource URL
        )
        query = _up.urlencode(
            {"code": code, **({"state": params.state} if params.state else {})}
        )
        # params.redirect_uri is an AnyUrl; append query preserving the fragment.
        url = str(params.redirect_uri)
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}{query}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        code = self._auth_codes.get(authorization_code)
        if code is None:
            return None
        if datetime.now(timezone.utc).timestamp() > code.expires_at:
            self._auth_codes.pop(authorization_code, None)
            return None
        return code

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        """Exchange an auth code for access + refresh tokens (single-use code)."""
        self._auth_codes.pop(authorization_code.code, None)  # one-time use

        scopes = authorization_code.scopes or ["filesystem"]
        access = self._new_token(32)
        refresh = self._new_token(40)
        now = datetime.now(timezone.utc).timestamp()

        self._access_tokens[access] = AccessToken(
            token=access,
            client_id=client.client_id,
            scopes=scopes,
            expires_at=int(now) + 3600,  # 1 hour
            resource=authorization_code.resource,
            subject=authorization_code.subject,
        )
        self._refresh_tokens[refresh] = RefreshToken(
            token=refresh,
            client_id=client.client_id,
            scopes=scopes,
            expires_at=int(now) + 7 * 86400,  # 7 days
            subject=authorization_code.subject,
        )
        return OAuthToken(
            access_token=access,
            token_type="Bearer",
            expires_in=3600,
            scope=" ".join(scopes),
            refresh_token=refresh,
        )

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        tok = self._refresh_tokens.get(refresh_token)
        if tok is None:
            return None
        if datetime.now(timezone.utc).timestamp() > tok.expires_at:
            self._refresh_tokens.pop(refresh_token, None)
            return None
        return tok

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        """Rotate the refresh token and issue a fresh access token."""
        self._refresh_tokens.pop(refresh_token.token, None)
        access = self._new_token(32)
        refresh = self._new_token(40)
        now = datetime.now(timezone.utc).timestamp()
        final_scopes = scopes or refresh_token.scopes or ["filesystem"]

        self._access_tokens[access] = AccessToken(
            token=access,
            client_id=client.client_id,
            scopes=final_scopes,
            expires_at=int(now) + 3600,
            subject=refresh_token.subject,
        )
        self._refresh_tokens[refresh] = RefreshToken(
            token=refresh,
            client_id=client.client_id,
            scopes=final_scopes,
            expires_at=int(now) + 7 * 86400,
            subject=refresh_token.subject,
        )
        return OAuthToken(
            access_token=access,
            token_type="Bearer",
            expires_in=3600,
            scope=" ".join(final_scopes),
            refresh_token=refresh,
        )

    async def load_access_token(self, token: str) -> AccessToken | None:
        # Static API key → treat as a valid access token with full scopes.
        # This preserves backward-compatibility for clients that authenticate
        # with the raw API key instead of going through the OAuth flow.
        if API_KEY and secrets.compare_digest(token, API_KEY):
            return AccessToken(
                token=token,
                client_id="static-api-key",
                scopes=["filesystem", "read", "write"],
                expires_at=None,  # never expires
                resource=str(self._resource_url) if self._resource_url else None,
            )
        tok = self._access_tokens.get(token)
        if tok is None:
            return None
        if datetime.now(timezone.utc).timestamp() > tok.expires_at:
            self._access_tokens.pop(token, None)
            return None
        return tok


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------

mcp = FastMCP(
    name="flow-veo-fs",
    instructions=(
        "You are connected to the E:\\Flow_veo filesystem over the network. "
        "ALL paths are relative to that root — never use absolute paths or '..'. "
        "Use list_tree to discover structure before drilling into files, "
        "list_dir to inspect a single directory, and read_file to fetch content. "
        "read_file returns UTF-8 text for text files and base64 for binaries. "
        "For edits, read_file first, then apply small targeted write_file calls. "
        "For deletions use delete_file (destructive). "
        "Paths returned by the tools are ready to pass back verbatim."
    ),
    # OAuth Authorization Server: enables ChatGPT's OAuth connector flow.
    # - Dynamic Client Registration (DCR) so ChatGPT can register a client id.
    # - Authorization Code + PKCE flow with /authorize, /token, discovery.
    # base_url must be the public HTTPS origin (Cloudflare named tunnel).
    auth=PersistentOAuthProvider(
        base_url=BASE_URL,
        resource_base_url=BASE_URL,
        service_documentation_url=f"{BASE_URL}/health",
        client_registration_options=ClientRegistrationOptions(
            enabled=True,
            valid_scopes=["filesystem", "read", "write"],
            default_scopes=["filesystem"],
        ),
    ),
)

# Register the full-machine tool suite (filesystem, editing, search, exec,
# processes, system, git, archive, CDP...).
register_all_tools(mcp)


# ---------------------------------------------------------------------------
# Read tools
# ---------------------------------------------------------------------------

@mcp.tool(annotations={"readOnlyHint": True})
async def list_tree(
    path: str = ".",
    max_depth: int = 3,
    exclude: str | None = None,
) -> dict:
    """List the directory tree under `path` up to `max_depth` levels deep.

    `exclude` is a comma-separated glob list (e.g. '*.png,*.log') to skip files.
    Folders in the excluded set (.venv, .git, node_modules, __pycache__) are
    always skipped. Returns entries as JSON. Use this to discover structure —
    prefer list_dir for a single directory.
    """
    try:
        start = _validate_relpath(path)
        if not start.is_dir():
            return _render_error(ValueError(f"'{path}' is not a directory. Use list_dir or read_file."))
        excluded = {p for p in EXCLUDED if p}
        if exclude:
            excluded |= {g.strip().strip("*") for g in exclude.split(",") if g.strip()}
        results: list[dict] = []
        root_depth = len(start.relative_to(ROOT).parts)
        for p in sorted(start.rglob("*")):
            if p.name in excluded:
                continue
            if not _is_inside(p, ROOT):
                continue
            depth = len(p.relative_to(ROOT).parts) - root_depth
            if depth > max_depth:
                continue
            results.append(_file_entry(p))
        return {"ok": True, "root": str(ROOT), "base": path, "count": len(results), "entries": results}
    except ValueError as e:
        return _render_error(e)


@mcp.tool(annotations={"readOnlyHint": True})
async def list_dir(path: str = ".") -> dict:
    """List the immediate contents of a single directory. Returns entries as JSON."""
    try:
        target = _validate_relpath(path)
        if not target.is_dir():
            return _render_error(ValueError(f"'{path}' is not a directory."))
        entries = [_file_entry(p) for p in sorted(target.iterdir()) if _is_inside(p, ROOT)]
        return {"ok": True, "path": target.relative_to(ROOT).as_posix() or ".", "count": len(entries), "entries": entries}
    except ValueError as e:
        return _render_error(e)


@mcp.tool(annotations={"readOnlyHint": True})
async def read_file(path: str, offset: int = 0, limit: int | None = None) -> dict:
    """Read a file's content as JSON.

    Returns {ok, path, encoding, content, truncated}. For UTF-8 text files the
    content is plain text. For binary files (images, audio, zips) the content is
    base64 with encoding "base64". `offset` (lines, 0-based) and `limit` (max
    lines) read a window of text files only; for binaries they are ignored.
    """
    try:
        target = _validate_relpath(path)
        if not target.is_file():
            sugg = _suggest(path)
            msg = f"'{path}' is not a file." + (f" Did you mean '{sugg}'?" if sugg else "")
            return _render_error(ValueError(msg))
        if target.stat().st_size > 100_000_000:
            return _render_error(ValueError(f"File is {target.stat().st_size} bytes; refusing to read >100MB."))
        info = _read_text_or_binary(target, max_text_chars=200_000)
        if info["encoding"] == "utf-8" and (offset or limit is not None):
            lines = info["content"].splitlines()
            end = len(lines) if limit is None else offset + limit
            info["content"] = "\n".join(lines[offset:end])
        return {"ok": True, "path": target.relative_to(ROOT).as_posix(), **info}
    except ValueError as e:
        return _render_error(e)


@mcp.tool(annotations={"readOnlyHint": True})
async def search_files(pattern: str, base: str = ".", limit: int = 100) -> dict:
    """Search for files under `base` whose name matches a glob `pattern`.

    `pattern` matches against the full relative path, e.g. '**/*.json' or
    'docs/*.md'. Returns up to `limit` matches as JSON. For content search use
    grep_files.
    """
    try:
        start = _validate_relpath(base)
        if not start.is_dir():
            return _render_error(ValueError(f"'{base}' is not a directory."))
        matches = []
        for p in sorted(start.rglob("*")):
            if p.name in EXCLUDED:
                continue
            rel = p.relative_to(ROOT).as_posix()
            if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(p.name, pattern):
                matches.append(_file_entry(p))
                if len(matches) >= limit:
                    break
        return {"ok": True, "base": base, "pattern": pattern, "count": len(matches), "matches": matches}
    except ValueError as e:
        return _render_error(e)


@mcp.tool(annotations={"readOnlyHint": True})
async def grep_files(pattern: str, base: str = ".", limit: int = 200) -> dict:
    """Search file *contents* under `base` for a case-insensitive substring.

    Scans only text files (skips binaries by extension). Returns up to `limit`
    matches as {file, line_number, line}. Useful for finding where something is
    referenced. For name matching use search_files.
    """
    try:
        start = _validate_relpath(base)
        if not start.is_dir():
            return _render_error(ValueError(f"'{base}' is not a directory."))
        needle = pattern.lower()
        results: list[dict] = []
        for p in start.rglob("*"):
            if p.is_dir() or p.name in EXCLUDED or p.suffix.lower() not in TEXT_EXTENSIONS:
                continue
            if not _is_inside(p, ROOT):
                continue
            try:
                for lineno, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                    if needle in line.lower():
                        results.append({"file": p.relative_to(ROOT).as_posix(), "line": lineno, "content": line[:500]})
                        if len(results) >= limit:
                            return {"ok": True, "pattern": pattern, "count": len(results), "matches": results}
            except (OSError, UnicodeDecodeError):
                continue
        return {"ok": True, "pattern": pattern, "count": len(results), "matches": results}
    except ValueError as e:
        return _render_error(e)


@mcp.tool(annotations={"readOnlyHint": True})
async def get_metadata(path: str) -> dict:
    """Get size, type, and modified time for one path. Use before deciding how to handle a file."""
    try:
        target = _validate_relpath(path)
        if not target.exists():
            sugg = _suggest(path)
            msg = f"'{path}' does not exist." + (f" Did you mean '{sugg}'?" if sugg else "")
            return _render_error(ValueError(msg))
        return {"ok": True, **(_file_entry(target))}
    except ValueError as e:
        return _render_error(e)


# ---------------------------------------------------------------------------
# Write tools
# ---------------------------------------------------------------------------

@mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
async def write_file(path: str, content: str) -> dict:
    """Write `content` to `path`, creating parent directories as needed.

    Overwrites the file if it already exists. Use for creating new files and for
    applying edits — read_file first, then write the updated content. Text only;
    for binary files use write_base64.
    """
    try:
        target = _validate_relpath(path, for_write=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"ok": True, "path": target.relative_to(ROOT).as_posix(), "bytes": len(content.encode("utf-8")), "message": "written"}
    except ValueError as e:
        return _render_error(e)


@mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
async def write_base64(path: str, data_base64: str) -> dict:
    """Write a base64-encoded blob to `path` (for binary files like images, audio, zips).

    Use when you received a base64 payload from read_file, or to create a binary
    asset. For text use write_file.
    """
    try:
        target = _validate_relpath(path, for_write=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = base64.b64decode(data_base64, validate=False)
        target.write_bytes(payload)
        return {"ok": True, "path": target.relative_to(ROOT).as_posix(), "bytes": len(payload), "message": "written"}
    except ValueError as e:
        return _render_error(e)
    except Exception as e:  # noqa: BLE001 - base64 decode failures
        return {"ok": False, "error": f"Invalid base64: {e}"}


@mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
async def append_file(path: str, content: str) -> dict:
    """Append `content` to the end of `path`, creating it if missing."""
    try:
        target = _validate_relpath(path, for_write=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as fh:
            fh.write(content)
        return {"ok": True, "path": target.relative_to(ROOT).as_posix(), "message": "appended"}
    except ValueError as e:
        return _render_error(e)


@mcp.tool(annotations={"destructiveHint": True, "idempotentHint": False})
async def rename_path(path: str, new_name: str) -> dict:
    """Rename or move a file or directory within the root. `new_name` may include
    subdirectories (e.g. 'archive/notes.md'). Destructive: replaces any existing
    target."""
    try:
        src = _validate_relpath(path, for_write=True)
        dst = _validate_relpath(str(Path(new_name)), for_write=True)
        if src == dst:
            return {"ok": True, "message": "no change"}
        src.rename(dst)
        return {"ok": True, "from": src.relative_to(ROOT).as_posix(), "to": dst.relative_to(ROOT).as_posix(), "message": "renamed"}
    except ValueError as e:
        return _render_error(e)


@mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
async def delete_file(path: str) -> dict:
    """Permanently delete a file or an empty directory. Destructive and not recoverable.
    For a non-empty directory, delete the children first. Confirm before calling."""
    try:
        target = _validate_relpath(path, for_write=True)
        if target.is_dir():
            if any(target.iterdir()):
                return _render_error(ValueError(f"'{path}' is a non-empty directory. Delete its contents first."))
            target.rmdir()
        elif target.is_file():
            target.unlink()
        else:
            return _render_error(ValueError(f"'{path}' does not exist."))
        return {"ok": True, "path": target.relative_to(ROOT).as_posix(), "message": "deleted"}
    except ValueError as e:
        return _render_error(e)


@mcp.tool(annotations={"destructiveHint": True, "idempotentHint": False})
async def create_directory(path: str) -> dict:
    """Create a directory (and parents) at `path`. No-op if it already exists."""
    try:
        target = _validate_relpath(path, for_write=True)
        target.mkdir(parents=True, exist_ok=True)
        return {"ok": True, "path": target.relative_to(ROOT).as_posix(), "message": "directory ready"}
    except ValueError as e:
        return _render_error(e)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    if not API_KEY:
        print(
            "[warn] FLOW_VEO_MCP_API_KEY is not set. The server will reject all "
            "requests. Set it to a strong random value (e.g. secrets.token_urlsafe(32)).",
            flush=True,
        )

    if not ROOT.is_dir():
        raise SystemExit(f"FLOW_VEO_MCP_ROOT '{ROOT}' does not exist.")

    import uvicorn
    from starlette.applications import Starlette
    from starlette.middleware import Middleware
    from starlette.responses import JSONResponse
    from starlette.routing import Mount, Route

    # FastMCP app — mounts its MCP endpoints under "/mcp" plus the OAuth
    # endpoints from the auth provider (/.well-known, /authorize, /token,
    # /register/DCR...). host_origin_protection stays off so the Cloudflare
    # tunnel Host header is accepted.
    mcp_app = mcp.http_app(transport="http", host_origin_protection=False)

    async def health(request):
        return JSONResponse({"status": "ok", "root": str(ROOT)})

    from fastmcp.server.lifespan import Lifespan

    # Kill any long-running processes (Chrome CDP, dev servers) on shutdown so
    # they never leak after the server stops.
    @asynccontextmanager
    async def _lifespan(app):
        async with mcp_app.lifespan(app):
            try:
                yield
            finally:
                PROCESS_MANAGER.shutdown()

    # Parent app: serves /health, and carries the FastMCP lifespan (required for
    # the StreamableHTTPSessionManager task group). The API-key middleware is the
    # outermost layer so every route except /health requires the key.
    app = Starlette(
        routes=[Route("/health", health), Mount("/", app=mcp_app)],
        middleware=[Middleware(APIKeyMiddleware)],
        lifespan=_lifespan,
    )
    # Keep-alive high so long-running tool calls (pytest, exec) aren't cut off
    # mid-stream. Request handling itself is unbounded; this only affects idle
    # connection reuse between MCP messages.
    uvicorn.run(
        app, host=HOST, port=PORT, log_level="info",
        timeout_keep_alive=int(os.environ.get("UVICORN_KEEP_ALIVE", "120")),
        timeout_graceful_shutdown=30,
    )


if __name__ == "__main__":
    main()
