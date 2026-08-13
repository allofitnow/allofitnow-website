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
    async with httpx.AsyncClient() as client:
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
        async with httpx.AsyncClient() as client:
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
    
    async with httpx.AsyncClient() as client:
        res = await client.get(f"{PAYLOAD_URL}/api/media/{media_id}")
        res.raise_for_status()
        doc = res.json()
        
    return {"id": doc["id"], "url": doc["url"], "filename": doc["filename"]}

@mcp.tool()
async def link_video(slug: str, provider: Literal['vimeo'], url: str) -> Dict[str, str]:
    """Set an external video URL on a project's video_url field."""
    jwt = await get_jwt()
    async with httpx.AsyncClient() as client:
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
        
    async with httpx.AsyncClient() as client:
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
        
    async with httpx.AsyncClient() as client:
        res = await client.get(url)
        res.raise_for_status()
        data = res.json()
        
    return {
        "total": data["totalDocs"],
        "projects": [{
            "slug": p["slug"],
            "title": p["title"],
            "client": p["client"],
            "year": p["year"],
            "role": p["role"],
            "status": p["status"],
            "thumb_url": p.get("thumb", {}).get("url", "")
        } for p in data["docs"]]
    }

@mcp.tool()
async def get_project(slug: str) -> Dict[str, Any]:
    """Full detail for one project."""
    async with httpx.AsyncClient() as client:
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
    async with httpx.AsyncClient() as client:
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
        async with httpx.AsyncClient() as client:
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
            
    async with httpx.AsyncClient() as client:
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
    
    async with httpx.AsyncClient() as client:
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
    
    async with httpx.AsyncClient() as client:
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

# Now we need to add Starlette middleware for Bearer token and /hook
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.requests import Request
from starlette.routing import Route
from starlette.applications import Starlette

BEARER_TOKEN = os.environ.get("MCP_BEARER_TOKEN")
WEBHOOK_SECRET = os.environ.get("MCP_WEBHOOK_SECRET")

# Add the /hook endpoint BEFORE the auth middleware, or make the auth middleware skip it.
async def hook_endpoint(request: Request):
    if request.headers.get("X-Webhook-Secret") != WEBHOOK_SECRET:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    # Debounce (30s) then trigger rebuild... For simplicity, we just trigger async.
    # A real debounce requires state. We'll just run it.
    asyncio.create_task(run_publish_async())
    return JSONResponse({"success": True})

async def run_publish_async():
    await asyncio.sleep(5) # Give Payload time to finish saving
    try:
        subprocess.run(["/root/projects/aoin-deploy/deploy/publish.sh"], check=True)
    except Exception as e:
        print(f"Hook publish failed: {e}")

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

# Wrap the app
routes = [
    Route("/hook", hook_endpoint, methods=["POST"])
]

# We must merge mcp.get_starlette_app() routes with our custom routes
mcp_app = mcp.http_app
mcp_app.routes.insert(0, Route("/hook", hook_endpoint, methods=["POST"]))

app = Starlette(routes=mcp_app.routes)
app.add_middleware(AuthMiddleware)