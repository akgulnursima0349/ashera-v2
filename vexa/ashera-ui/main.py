"""
Ashera Transkript — UI Backend
Vexa API'sine proxy + kullanıcı key oluşturma
"""

import os
import uuid
import logging
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

VEXA_URL    = os.getenv("VEXA_URL",          "http://vexa-lite:8056")
ADMIN_TOKEN = os.getenv("ADMIN_API_TOKEN",   "")

app = FastAPI(title="Ashera Transkript UI")


# ─── Yardımcı ─────────────────────────────────────────────────────────────────

def _vexa_headers(api_key: str) -> dict:
    return {"X-API-Key": api_key, "Content-Type": "application/json"}

def _admin_headers() -> dict:
    return {"X-Admin-API-Key": ADMIN_TOKEN, "Content-Type": "application/json"}


# ─── API Rotaları ──────────────────────────────────────────────────────────────

@app.post("/api/key")
async def create_api_key():
    """Yeni kullanıcı oluştur ve API key döndür."""
    if not ADMIN_TOKEN:
        raise HTTPException(500, "ADMIN_API_TOKEN sunucuda tanımlı değil")

    uid = uuid.uuid4().hex[:8]
    async with httpx.AsyncClient(timeout=30) as client:
        # Kullanıcı oluştur
        r1 = await client.post(
            f"{VEXA_URL}/admin/users",
            headers=_admin_headers(),
            json={"email": f"user-{uid}@ashera.app", "name": f"Ashera Kullanıcı {uid}"},
        )
        if r1.status_code not in (200, 201):
            log.error("Kullanıcı oluşturulamadı: %s", r1.text)
            raise HTTPException(500, "Kullanıcı oluşturulamadı")

        user_id = r1.json()["id"]

        # Token oluştur
        r2 = await client.post(
            f"{VEXA_URL}/admin/users/{user_id}/tokens",
            headers=_admin_headers(),
        )
        if r2.status_code not in (200, 201):
            log.error("Token oluşturulamadı: %s", r2.text)
            raise HTTPException(500, "Token oluşturulamadı")

        token = r2.json()["token"]
        log.info("Yeni API key oluşturuldu: user_id=%s", user_id)
        return {"api_key": token}


@app.post("/api/bots")
async def start_bot(request: Request):
    """Botu toplantıya gönder."""
    api_key = request.headers.get("X-API-Key", "")
    body    = await request.json()

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{VEXA_URL}/bots",
            headers=_vexa_headers(api_key),
            json=body,
        )
        return JSONResponse(content=r.json(), status_code=r.status_code)


@app.delete("/api/bots/{platform}/{meeting_id}")
async def stop_bot(platform: str, meeting_id: str, request: Request):
    """Botu toplantıdan çıkart."""
    api_key = request.headers.get("X-API-Key", "")

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.delete(
            f"{VEXA_URL}/bots/{platform}/{meeting_id}",
            headers=_vexa_headers(api_key),
        )
        return JSONResponse(content=r.json(), status_code=r.status_code)


@app.get("/api/transcripts/{platform}/{meeting_id}")
async def get_transcript(platform: str, meeting_id: str, request: Request):
    """Transkripti al."""
    api_key = request.headers.get("X-API-Key", "")

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{VEXA_URL}/transcripts/{platform}/{meeting_id}",
            headers=_vexa_headers(api_key),
        )
        return JSONResponse(content=r.json(), status_code=r.status_code)


@app.get("/api/bots/status")
async def bot_status(request: Request):
    """Aktif bot durumlarını al."""
    api_key = request.headers.get("X-API-Key", "")

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{VEXA_URL}/bots/status",
            headers=_vexa_headers(api_key),
        )
        return JSONResponse(content=r.json(), status_code=r.status_code)


# ─── Statik dosyalar (HTML) ────────────────────────────────────────────────────

static_dir = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
