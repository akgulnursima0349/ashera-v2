import asyncio
import logging

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, BackgroundTasks, HTTPException

from db import get_pool, close_pool, run_migrations
from pipeline import submit_call
from providers import alotech, twilio, generic

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [call-receiver] %(message)s",
)
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await run_migrations()
    asyncio.create_task(alotech.start_polling_loop())
    yield
    await close_pool()


app = FastAPI(title="Call Receiver", lifespan=lifespan)


@app.post("/calls/twilio")
async def twilio_webhook(request: Request, background_tasks: BackgroundTasks):
    form = await request.form()
    call = twilio.parse(dict(form))
    background_tasks.add_task(submit_call, call)
    return {"status": "accepted"}   # Must return fast — Twilio has a 15s timeout


@app.post("/calls/webhook/{token}")
async def generic_webhook(token: str, request: Request, background_tasks: BackgroundTasks):
    payload = await request.json()
    pool = await get_pool()
    config = await pool.fetchrow(
        "SELECT * FROM call_provider_configs WHERE webhook_token = $1 AND is_active = TRUE",
        token,
    )
    if not config:
        raise HTTPException(status_code=401, detail="Invalid webhook token")
    try:
        call = generic.parse(payload, token)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    background_tasks.add_task(submit_call, call)
    return {"status": "accepted"}


@app.get("/transcripts/phone_call/{call_id}")
async def get_transcript(call_id: str):
    pool = await get_pool()
    meeting = await pool.fetchrow(
        "SELECT id FROM meetings WHERE platform = 'phone_call' AND platform_specific_id = $1",
        call_id,
    )
    if not meeting:
        raise HTTPException(status_code=404, detail="Call not found")
    segments = await pool.fetch(
        """SELECT speaker, text, start_time AS start, end_time AS end, language
           FROM transcriptions WHERE meeting_id = $1 ORDER BY start_time""",
        meeting["id"],
    )
    return {
        "meeting_id": call_id,
        "segments": [dict(s) for s in segments],
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
