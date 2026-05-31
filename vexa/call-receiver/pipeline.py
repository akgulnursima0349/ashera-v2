import logging

import httpx

from config import ASSEMBLYAI_PROXY_URL
from db import create_meeting_record, update_meeting_status, save_transcription_segments
from normalizer import NormalizedCall

log = logging.getLogger(__name__)


async def submit_call(call: NormalizedCall) -> None:
    meeting_id = await create_meeting_record(call)
    log.info("Created meeting record id=%d for call %s (provider=%s).", meeting_id, call.call_id, call.provider)

    try:
        await update_meeting_status(meeting_id, "processing")

        audio_bytes = await _download_audio(call.recording_url)
        log.info("Downloaded %d bytes of audio for call %s.", len(audio_bytes), call.call_id)

        result = await _send_to_proxy(audio_bytes)
        log.info("Proxy returned %d segment(s) for call %s.", len(result.get("segments", [])), call.call_id)

        language = result.get("language", "tr")
        await save_transcription_segments(meeting_id, result.get("segments", []), language)

        await update_meeting_status(meeting_id, "completed")

    except Exception as exc:
        log.error("Pipeline failed for call %s (meeting_id=%d): %s", call.call_id, meeting_id, exc)
        await update_meeting_status(meeting_id, "failed")
        raise


async def _download_audio(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.content


async def _send_to_proxy(audio_bytes: bytes) -> dict:
    """
    POST audio to assemblyai-proxy /v1/audio/transcriptions.

    Endpoint discovered from assemblyai-proxy/main.py:
      POST /v1/audio/transcriptions
      Multipart form fields:
        file     — UploadFile (the audio data)
        language — Optional[str]  (language code, e.g. "tr")
        model    — str            (default "best")
    Returns JSON: { "text": str, "language": str, "duration": float, "segments": [...] }
    """
    async with httpx.AsyncClient(timeout=120.0) as client:
        files = {"file": ("recording.mp3", audio_bytes, "audio/mpeg")}
        data = {
            "model": "best",
            "language": "tr",   # default; can be extended later
        }
        response = await client.post(
            f"{ASSEMBLYAI_PROXY_URL}/v1/audio/transcriptions",
            files=files,
            data=data,
        )
        response.raise_for_status()
        return response.json()
