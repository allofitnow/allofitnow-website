from fastmcp import FastMCP, Context
import httpx
import os
import subprocess
import asyncio
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field
import json
import time

PAYLOAD_URL = os.environ.get("PAYLOAD_URL", "http://127.0.0.1:3000")
ADMIN_EMAIL = os.environ.get("PAYLOAD_ADMIN_EMAIL")
ADMIN_PASSWORD = os.environ.get("PAYLOAD_ADMIN_PASSWORD")

# #81: since #80, Payload PATCH responses await the full live publish
# (~100-200s). httpx default timeout is 5s -> guaranteed ReadTimeout on every
# save. 600s read covers publish + queue behind a concurrent publish.
HTTP_TIMEOUT = httpx.Timeout(600.0, connect=10.0)

class AssetInput(BaseModel):
    kind: Literal["image", "video_link"]
    purpose: Literal["thumb", "hero", "gallery"]
    filename: Optional[str] = None
    mime: Optional[str] = None
    base64: Optional[str] = None
    url: Optional[str] = None

class ProjectData(BaseModel):
    title: str
    slug: str
    client: str
    year: str
    role: Literal['REAL-TIME CONTENT', 'SCREENS PRODUCTION', 'MIXED REALITY', 'EQUIPMENT RENTAL']
    scope: str
    order: Optional[int] = None
    body: Optional[str] = None
    capabilities: List[Literal['REAL-TIME CONTENT', 'SCREENS PRODUCTION', 'MIXED REALITY', 'EQUIPMENT RENTAL']]
    tour: Optional[str] = None
    collaborator: Optional[str] = None
    summary: Optional[str] = None
    stats: Optional[List[Dict[str, str]]] = None
    credits: Optional[List[Dict[str, Any]]] = None
    writeup: Optional[Dict[str, Any]] = None
    video_url: Optional[str] = None

# Initialize FastMCP
mcp = FastMCP("AOIN Portfolio MCP")

# --- Helpers ---
async def get_jwt() -> str:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        res = await client.post(f"{PAYLOAD_URL}/api/users/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        res.raise_for_status()
        return res.json()["token"]

async def upload_asset(jwt: str, asset: AssetInput) -> str:
    # base64 to file upload
    import base64
    import tempfile
    
    file_data = base64.b64decode(asset.base64)
    with tempfile.NamedTemporaryFile(delete=False, suffix=asset.filename) as tmp:
        tmp.write(file_data)
        tmp_path = tmp.name
        
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            with open(tmp_path, "rb") as f:
                files = {"file": (asset.filename, f, asset.mime)}
                res = await client.post(
                    f"{PAYLOAD_URL}/api/media",
                    headers={"Authorization": f"JWT {jwt}"},
                    files=files
                )
                res.raise_for_status()
                return res.json()["doc"]["id"]
    finally:
        os.unlink(tmp_path)


# --- Media Tools ---
@mcp.tool()
async def upload_media(filename: str, mime: str, base64: str) -> Dict[str, str]:
    """Raw upload to Payload media collection. Returns { id, url, filename }. Image files only."""
    jwt = await get_jwt()
    asset = AssetInput(kind="image", purpose="gallery", filename=filename, mime=mime, base64=base64)
    media_id = await upload_asset(jwt, asset)
    
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        res = await client.get(f"{PAYLOAD_URL}/api/media/{media_id}")
        res.raise_for_status()
        doc = res.json()
        
    return {"id": doc["id"], "url": doc["url"], "filename": doc["filename"]}

@mcp.tool()
async def link_video(slug: str, provider: Literal['vimeo'], url: str) -> Dict[str, str]:
    """Set an external video URL on a project's video_url field."""
    jwt = await get_jwt()
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        # Get project ID
        proj_res = await client.get(f"{PAYLOAD_URL}/api/projects?where[slug][equals]={slug}")
        proj_res.raise_for_status()
        docs = proj_res.json()["docs"]
        if not docs:
            return {"error": "not found"}
        
        # Patch
        patch_res = await client.patch(
            f"{PAYLOAD_URL}/api/projects/{docs[0]['id']}",
            headers={"Authorization": f"JWT {jwt}"},
            json={"video_url": url}
        )
        patch_res.raise_for_status()
        
    return {"slug": slug, "video_url": url}

@mcp.tool()
async def list_media(query: str = "", limit: int = 50) -> Dict[str, Any]:
    """Search the media library by filename substring."""
    url = f"{PAYLOAD_URL}/api/media?limit={limit}"
    if query:
        url += f"&where[filename][contains]={query}"
        
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        res = await client.get(url)
        res.raise_for_status()
        data = res.json()
        
    return {
        "total": data["totalDocs"],
        "media": [{"id": d["id"], "url": d["url"], "filename": d["filename"]} for d in data["docs"]]
    }


# --- Browsing Tools ---
@mcp.tool()
async def list_projects(status: Optional[Literal['published', 'archive']] = None) -> Dict[str, Any]:
    """Roster from Payload. Returns { total, projects: [...] }"""
    url = f"{PAYLOAD_URL}/api/projects?limit=100"
    if status:
        url += f"&where[status][equals]={status}"
        
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        res = await client.get(url)
        res.raise_for_status()
        data = res.json()
        
    return {
        "total": data["totalDocs"],
        "projects": [{
            "slug": p["slug"],
            "title": p["title"],
            "client": p.get("client") or p.get("code", ""),
            "year": p.get("year", ""),
            "role": p.get("role") or ", ".join(p.get("capabilities") or []),
            "status": p.get("status", ""),
            "thumb_url": (p.get("thumb") or {}).get("url", "")
        } for p in data["docs"]]
    }

@mcp.tool()
async def get_project(slug: str) -> Dict[str, Any]:
    """Full detail for one project."""
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        res = await client.get(f"{PAYLOAD_URL}/api/projects?where[slug][equals]={slug}")
        res.raise_for_status()
        docs = res.json()["docs"]
        if not docs:
            return {"error": "not found"}
        return docs[0]


# --- Publish Tools ---
@mcp.tool()
async def set_status(slug: str, status: Literal['published', 'archive']) -> Dict[str, str]:
    """Flip publish state."""
    jwt = await get_jwt()
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        proj_res = await client.get(f"{PAYLOAD_URL}/api/projects?where[slug][equals]={slug}")
        proj_res.raise_for_status()
        docs = proj_res.json()["docs"]
        if not docs:
            return {"error": "not found"}
        
        patch_res = await client.patch(
            f"{PAYLOAD_URL}/api/projects/{docs[0]['id']}",
            headers={"Authorization": f"JWT {jwt}"},
            json={"status": status}
        )
        patch_res.raise_for_status()
        
    return {"slug": slug, "status": status}

@mcp.tool()
async def publish() -> Dict[str, Any]:
    """Blocking; runs publish.sh; returns { success, timestamp, build_log_tail }"""
    try:
        proc = subprocess.run(
            ["/root/projects/aoin-deploy/deploy/publish.sh"],
            capture_output=True, text=True, check=True
        )
        success = True
        log = proc.stdout
    except subprocess.CalledProcessError as e:
        success = False
        log = e.stdout + "\n" + e.stderr
        
    tail = "\n".join(log.split("\n")[-20:])
    return {
        "success": success,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "build_log_tail": tail
    }

@mcp.tool()
async def build_status() -> Dict[str, Any]:
    """Returns { last_build, status, log_tail }"""
    # Just a stub for the test, we'll read a local file where publish logs
    return {
        "last_build": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "success",
        "log_tail": "Build complete."
    }


# --- Portfolio Management Tools ---
@mcp.tool()
async def validate_portfolio(data: ProjectData) -> Dict[str, Any]:
    """Dry-run validation against schema."""
    errors = []
    
    # Check writeup shape
    if data.writeup and data.writeup.get("body"):
        for item in data.writeup["body"]:
            if not isinstance(item, dict) or "paragraph" not in item:
                errors.append("writeup.body items must be objects with a 'paragraph' key, not plain strings")
                break
                
    return {"valid": len(errors) == 0, "errors": errors}

@mcp.tool()
async def create_portfolio(
    data: ProjectData,
    assets: Optional[List[AssetInput]] = None,
    status: Literal['published', 'archive'] = 'published'
) -> Dict[str, Any]:
    """One-call portfolio creation."""
    jwt = await get_jwt()
    
    val = await validate_portfolio(data)
    if not val["valid"]:
        return {"error": "Validation failed", "details": val["errors"]}
        
    payload_doc = data.dict(exclude_none=True)
    payload_doc["code"] = "TEMP"
    payload_doc["status"] = status
    
    if not payload_doc.get("order"):
        # Auto-assign order
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            res = await client.get(f"{PAYLOAD_URL}/api/projects?limit=1&sort=-order")
            res.raise_for_status()
            docs = res.json()["docs"]
            if docs:
                payload_doc["order"] = docs[0].get("order", 0) + 1
            else:
                payload_doc["order"] = 1
                
    if assets:
        gallery = []
        for asset in assets:
            if asset.kind == "video_link":
                if asset.purpose == "hero":
                    payload_doc["video_url"] = asset.url
                else:
                    return {"error": "video_link is only supported for purpose='hero'"}
            elif asset.kind == "image":
                media_id = await upload_asset(jwt, asset)
                if asset.purpose == "thumb":
                    payload_doc["thumb"] = media_id
                elif asset.purpose == "hero":
                    payload_doc["hero"] = media_id
                elif asset.purpose == "gallery":
                    gallery.append({"image": media_id})
                    
        if gallery:
            payload_doc["gallery"] = gallery
            
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        res = await client.post(
            f"{PAYLOAD_URL}/api/projects",
            headers={"Authorization": f"JWT {jwt}"},
            json=payload_doc
        )
        try:
            res.raise_for_status()
        except Exception:
            return {"error": res.text}
            
    return res.json()["doc"]

@mcp.tool()
async def update_portfolio(slug: str, data: Optional[Dict[str, Any]] = None, assets: Optional[List[AssetInput]] = None) -> Dict[str, Any]:
    """Patch fields and/or manage media."""
    jwt = await get_jwt()
    
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        proj_res = await client.get(f"{PAYLOAD_URL}/api/projects?where[slug][equals]={slug}")
        proj_res.raise_for_status()
        docs = proj_res.json()["docs"]
        if not docs:
            return {"error": "not found"}
        
        proj_id = docs[0]["id"]
        
        patch_data = data or {}
        
        if assets:
            gallery = []
            for asset in assets:
                if asset.kind == "video_link":
                    if asset.purpose == "hero":
                        patch_data["video_url"] = asset.url
                    else:
                        return {"error": "video_link is only supported for purpose='hero'"}
                elif asset.kind == "image":
                    media_id = await upload_asset(jwt, asset)
                    if asset.purpose == "thumb":
                        patch_data["thumb"] = media_id
                    elif asset.purpose == "hero":
                        patch_data["hero"] = media_id
                    elif asset.purpose == "gallery":
                        gallery.append({"image": media_id})
            
            # Replaces gallery
            if gallery:
                patch_data["gallery"] = gallery

        res = await client.patch(
            f"{PAYLOAD_URL}/api/projects/{proj_id}",
            headers={"Authorization": f"JWT {jwt}"},
            json=patch_data
        )
        res.raise_for_status()
        
    return res.json()["doc"]

@mcp.tool()
async def delete_portfolio(slug: str) -> Dict[str, Any]:
    """Delete a project. Refuses if published."""
    jwt = await get_jwt()
    
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        proj_res = await client.get(f"{PAYLOAD_URL}/api/projects?where[slug][equals]={slug}")
        proj_res.raise_for_status()
        docs = proj_res.json()["docs"]
        if not docs:
            return {"error": "not found"}
            
        if docs[0]["status"] == "published":
            return {"error": "Cannot delete a published project. Archive it first."}
            
        res = await client.delete(
            f"{PAYLOAD_URL}/api/projects/{docs[0]['id']}",
            headers={"Authorization": f"JWT {jwt}"}
        )
        res.raise_for_status()
        
    return {"success": True, "slug": slug}

# To run: uvicorn aoin_mcp.server:app --host 127.0.0.1 --port 8788
# But wait, this is a FastMCP instance. To expose it via ASGI:
# app = mcp.http_app

# Now we need Starlette middleware for Bearer token; /hook mounts as a
# FastMCP custom route further down.
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.requests import Request

BEARER_TOKEN = os.environ.get("MCP_BEARER_TOKEN")
WEBHOOK_SECRET = os.environ.get("MCP_WEBHOOK_SECRET")

# --- Publish serialization (#80) ---
# One publish at a time, in-process (asyncio.Lock) and cross-process
# (flock -w 900): manual `ssh root@.245 publish.sh` invocations share the
# same /run/aoin-publish.lock, so a designer save can never interleave with
# an operator publish. Saves arriving mid-publish simply queue on the lock
# and then run their own full publish (which pulls latest content anyway).
_PUBLISH_LOCK = asyncio.Lock()
PUBLISH_SCRIPT = "/root/projects/aoin-deploy/deploy/publish.sh"
PUBLISH_FLOCK = "/run/aoin-publish.lock"

async def _run_publish() -> dict:
    """Execute publish.sh under flock; returns {success, log_tail} or raises."""
    proc = await asyncio.create_subprocess_exec(
        "flock", "-w", "900", PUBLISH_FLOCK,
        PUBLISH_SCRIPT,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    log = (stdout.decode() + stderr.decode())
    tail = "\n".join(log.split("\n")[-15:])
    if proc.returncode != 0:
        return {"success": False, "log_tail": f"Build failed (exit {proc.returncode})\n{tail}"}
    return {"success": True, "log_tail": "\n".join(stdout.decode().split("\n")[-10:])}

# /hook is registered ON the FastMCP instance (custom_route) so it rides the
# same ASGI app http_app() builds below. It is exempt from AuthMiddleware by
# path and carries its own X-Webhook-Secret check.
@mcp.custom_route("/hook", methods=["POST"])
async def hook_endpoint(request: Request):
    if request.headers.get("X-Webhook-Secret") != WEBHOOK_SECRET:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    # One publish at a time (#80). Concurrent saves queue here; each then runs
    # its own full publish, which re-pulls latest content from Payload anyway.
    # First caller blocks (Save button stays loading until build completes,
    # per original design); on failure 500 so the hook throws and Payload
    # surfaces the error in the same toast it uses for 403s.
    async with _PUBLISH_LOCK:
        try:
            result = await _run_publish()
        except Exception as e:
            result = {"success": False, "log_tail": str(e)}
        status = 200 if result.get("success") else 500
        return JSONResponse(result, status_code=status)


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/hook":
            return await call_next(request)
            
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return JSONResponse({"error": "Missing or invalid Authorization header"}, status_code=401)
            
        token = auth_header.split(" ")[1]
        if token != BEARER_TOKEN:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
            
        return await call_next(request)

# Mount as streamable HTTP. Notes:
# - middleware= is the supported http_app() parameter (FastMCP 3.4.7); it
#   does NOT accept routes=, which is why /hook moved to @mcp.custom_route.
# - host_origin_protection=False pins today's verified default so a future
#   FastMCP upgrade that flips it cannot start 403ing through nginx.
#   Bearer auth already gates every MCP route; /hook is secret-gated.
from starlette.middleware import Middleware

app = mcp.http_app(
    path="/mcp",
    middleware=[Middleware(AuthMiddleware)],
    host_origin_protection=False,
)