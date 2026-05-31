"""
Ashera Realtime Transcriber
===========================
WhisperLive'ı tamamen bypass eder. Doğrudan AssemblyAI Real-time WebSocket
API kullanır → çok daha düşük gecikme (~1-2s), toplantı başından beri tam bağlam.

Akış:
  vexa-bot  ──WS──►  bu servis  ──WS──►  AssemblyAI Real-time
                         │
                         ├──►  vexa-bot (partial/final transkript)
                         └──►  Redis Streams (transcription-collector için)
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import redis.asyncio as aioredis
import websockets
from websockets.server import WebSocketServerProtocol

# ─── Konfigürasyon ───────────────────────────────────────────────────────────

ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY", "")
REDIS_URL          = os.getenv("REDIS_URL", "redis://redis:6379/0")
HOST               = "0.0.0.0"
PORT               = 9090

# Redis stream isimleri — WhisperLive ile aynı (transcription-collector bunları okur)
TRANSCRIPTION_STREAM = os.getenv("REDIS_STREAM_KEY",                             "transcription_segments")
SPEAKER_STREAM       = os.getenv("REDIS_SPEAKER_EVENTS_RELATIVE_STREAM_KEY",     "speaker_events_relative")

# AssemblyAI Real-time endpoint
AAI_WS_URL = "wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000"

# ─── Logging ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [rt] %(message)s"
)
log = logging.getLogger(__name__)

# ─── Global Redis ─────────────────────────────────────────────────────────────

_redis: Optional[aioredis.Redis] = None

async def get_redis() -> Optional[aioredis.Redis]:
    global _redis
    if _redis is None:
        try:
            _redis = await aioredis.from_url(REDIS_URL, decode_responses=True)
            await _redis.ping()
            log.info("Redis bağlantısı kuruldu: %s", REDIS_URL)
        except Exception as exc:
            log.error("Redis bağlanamadı: %s", exc)
            _redis = None
    return _redis


# ─── Ses dönüşümü ─────────────────────────────────────────────────────────────

def float32_to_pcm16(data: bytes) -> bytes:
    """
    vexa-bot Float32Array gönderir (Web Audio API formatı).
    AssemblyAI PCM16 (int16, little-endian, mono, 16kHz) bekler.
    """
    arr = np.frombuffer(data, dtype=np.float32)
    arr = np.clip(arr, -1.0, 1.0)
    return (arr * 32767).astype('<i2').tobytes()  # little-endian int16


# ─── Bot Seansı ──────────────────────────────────────────────────────────────

class BotSession:
    """
    Tek bir toplantı botunun transkripsiyon seansını yönetir.
    Bot WebSocket ↔ AssemblyAI Real-time ↔ Redis
    """

    def __init__(self, bot_ws: WebSocketServerProtocol, config: dict):
        self.bot_ws      = bot_ws
        self.uid         = config.get("uid", "unknown")
        self.language    = config.get("language") or "en"
        self.token       = config.get("token", "")
        self.platform    = config.get("platform", "google_meet")
        self.meeting_id  = config.get("meeting_id")
        self.meeting_url = config.get("meeting_url", "")
        self.start_time  = datetime.now(timezone.utc)

        self._closed      = False
        self._aai_ws      = None
        self._audio_queue: asyncio.Queue = asyncio.Queue(maxsize=512)

    # ── Ana döngü ──────────────────────────────────────────────────────────

    async def run(self):
        log.info("Seans başladı  uid=%s  platform=%s  meeting=%s",
                 self.uid, self.platform, self.meeting_id)
        try:
            await self._connect_assemblyai()
            await self._publish_event("session_start",
                                      start_timestamp=self.start_time.isoformat())
            await asyncio.gather(
                self._bot_reader(),
                self._aai_audio_sender(),
                self._aai_transcript_receiver(),
                return_exceptions=True,
            )
        except Exception as exc:
            log.error("Seans hatası uid=%s: %s", self.uid, exc)
        finally:
            await self._cleanup()

    # ── AssemblyAI bağlantısı ──────────────────────────────────────────────

    async def _connect_assemblyai(self):
        headers = {"Authorization": ASSEMBLYAI_API_KEY}
        self._aai_ws = await websockets.connect(
            AAI_WS_URL,
            extra_headers=headers,
            ping_interval=20,
            ping_timeout=30,
        )
        # İlk mesaj her zaman SessionBegins olmalı
        raw = await asyncio.wait_for(self._aai_ws.recv(), timeout=15.0)
        msg = json.loads(raw)
        if msg.get("message_type") != "SessionBegins":
            raise RuntimeError(f"Beklenmeyen AAI mesajı: {msg}")
        log.info("AssemblyAI real-time bağlantısı kuruldu  uid=%s", self.uid)

    # ── Bot'tan gelen mesajları oku ────────────────────────────────────────

    async def _bot_reader(self):
        try:
            async for message in self.bot_ws:
                if self._closed:
                    break

                if isinstance(message, bytes):
                    # Ham ses verisi (Float32Array)
                    pcm16 = float32_to_pcm16(message)
                    if pcm16:
                        try:
                            self._audio_queue.put_nowait(pcm16)
                        except asyncio.QueueFull:
                            # Kuyruk doluysa en eski paketi at
                            try:
                                self._audio_queue.get_nowait()
                            except asyncio.QueueEmpty:
                                pass
                            self._audio_queue.put_nowait(pcm16)

                else:
                    # JSON mesajı
                    await self._handle_json(message)

        except websockets.exceptions.ConnectionClosed:
            log.info("Bot bağlantısı kapandı  uid=%s", self.uid)
        finally:
            self._closed = True

    async def _handle_json(self, raw: str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return

        msg_type = data.get("type")

        if msg_type == "speaker_activity":
            await self._publish_speaker_event(data)

        elif msg_type == "session_control":
            event = data.get("payload", {}).get("event", "")
            if event == "LEAVING_MEETING":
                log.info("Bot toplantıdan ayrılıyor  uid=%s", self.uid)
                self._closed = True

    # ── AssemblyAI'ye ses gönder ───────────────────────────────────────────

    async def _aai_audio_sender(self):
        while not self._closed or not self._audio_queue.empty():
            try:
                pcm16 = await asyncio.wait_for(
                    self._audio_queue.get(), timeout=1.0
                )
            except asyncio.TimeoutError:
                continue

            if self._aai_ws and not self._aai_ws.closed:
                try:
                    await self._aai_ws.send(pcm16)
                except Exception as exc:
                    log.warning("AAI ses gönderme hatası: %s", exc)
                    break

    # ── AssemblyAI'den transkript al ───────────────────────────────────────

    async def _aai_transcript_receiver(self):
        if not self._aai_ws:
            return

        while not self._closed:
            try:
                raw = await asyncio.wait_for(self._aai_ws.recv(), timeout=2.0)
            except asyncio.TimeoutError:
                continue
            except websockets.exceptions.ConnectionClosed:
                break
            except Exception as exc:
                log.warning("AAI alım hatası: %s", exc)
                break

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("message_type", "")
            text = (msg.get("text") or "").strip()

            if not text:
                continue

            if msg_type == "PartialTranscript":
                # Kısmi sonucu bota gönder (completed=False)
                await self._send_to_bot(msg, completed=False)

            elif msg_type == "FinalTranscript":
                # Kesinleşmiş sonucu bota gönder ve Redis'e yaz
                await self._send_to_bot(msg, completed=True)
                await self._publish_transcription(msg)
                log.info("Final  [%.0f-%.0fs]  %s",
                         (msg.get("audio_start") or 0) / 1000,
                         (msg.get("audio_end")   or 0) / 1000,
                         text[:80])

    # ── Bot'a segment gönder ───────────────────────────────────────────────

    async def _send_to_bot(self, msg: dict, completed: bool):
        text = (msg.get("text") or "").strip()
        if not text:
            return

        segment = {
            "text":      text,
            "start":     (msg.get("audio_start") or 0) / 1000.0,
            "end":       (msg.get("audio_end")   or 0) / 1000.0,
            "completed": completed,
            "language":  self.language,
        }
        payload = json.dumps({"uid": self.uid, "segments": [segment]})

        try:
            await self.bot_ws.send(payload)
        except Exception:
            pass  # Bot bağlantısı kopmuş olabilir

    # ── Redis yayıncıları ─────────────────────────────────────────────────

    async def _publish_transcription(self, msg: dict):
        r = await get_redis()
        if not r:
            return

        text = (msg.get("text") or "").strip()
        if not text:
            return

        segment = {
            "text":      text,
            "start":     (msg.get("audio_start") or 0) / 1000.0,
            "end":       (msg.get("audio_end")   or 0) / 1000.0,
            "completed": True,
            "language":  self.language,
        }

        payload = json.dumps({
            "type":       "transcription",
            "token":      self.token,
            "platform":   self.platform,
            "meeting_id": self.meeting_id,
            "uid":        self.uid,
            "segments":   [segment],
        })
        try:
            await r.xadd(TRANSCRIPTION_STREAM, {"payload": payload})
        except Exception as exc:
            log.warning("Redis transcription yazma hatası: %s", exc)

    async def _publish_speaker_event(self, data: dict):
        r = await get_redis()
        if not r:
            return

        payload = data.get("payload", {})
        event = {
            "uid":                           self.uid,
            "event_type":                    payload.get("event_type", ""),
            "participant_name":              payload.get("participant_name", ""),
            "participant_id_meet":           payload.get("participant_id_meet", ""),
            "relative_client_timestamp_ms":  str(payload.get("relative_client_timestamp_ms", 0)),
            "token":                         self.token,
            "platform":                      self.platform,
            "meeting_id":                    str(self.meeting_id or ""),
            "meeting_url":                   self.meeting_url or "",
            "server_received_timestamp_iso": datetime.now(timezone.utc).isoformat(),
        }
        try:
            await r.xadd(SPEAKER_STREAM, event)
        except Exception as exc:
            log.warning("Redis speaker event yazma hatası: %s", exc)

    async def _publish_event(self, event_type: str, **extra):
        r = await get_redis()
        if not r:
            return

        payload = json.dumps({
            "type":       event_type,
            "token":      self.token,
            "platform":   self.platform,
            "meeting_id": self.meeting_id,
            "uid":        self.uid,
            **extra,
        })
        try:
            await r.xadd(TRANSCRIPTION_STREAM, {"payload": payload})
        except Exception as exc:
            log.warning("Redis event yazma hatası (%s): %s", event_type, exc)

    # ── Temizlik ──────────────────────────────────────────────────────────

    async def _cleanup(self):
        self._closed = True

        # AssemblyAI seansını kapat
        if self._aai_ws and not self._aai_ws.closed:
            try:
                await self._aai_ws.send(json.dumps({"terminate_session": True}))
                await self._aai_ws.close()
            except Exception:
                pass

        # Redis'e seans sonu yaz
        await self._publish_event(
            "session_end",
            end_timestamp=datetime.now(timezone.utc).isoformat(),
        )

        log.info("Seans bitti  uid=%s", self.uid)


# ─── WebSocket sunucusu ──────────────────────────────────────────────────────

async def handle_connection(websocket: WebSocketServerProtocol, path: str):
    """Her yeni bot bağlantısı için çağrılır."""
    if not ASSEMBLYAI_API_KEY:
        await websocket.close(1011, "ASSEMBLYAI_API_KEY eksik")
        return

    try:
        # İlk mesaj: bot'un konfigürasyon JSON'u
        raw = await asyncio.wait_for(websocket.recv(), timeout=30.0)
        config = json.loads(raw)
    except asyncio.TimeoutError:
        log.warning("Bot konfigürasyon zaman aşımı")
        await websocket.close(1008, "Config timeout")
        return
    except Exception as exc:
        log.error("Konfigürasyon hatası: %s", exc)
        return

    # SERVER_READY gönder — bot bunu alınca ses göndermeye başlar
    await websocket.send(json.dumps({
        "status": "SERVER_READY",
        "uid":    config.get("uid"),
    }))

    # Seansı başlat
    session = BotSession(websocket, config)
    await session.run()


# ─── Başlangıç ───────────────────────────────────────────────────────────────

async def main():
    if not ASSEMBLYAI_API_KEY:
        log.error("ASSEMBLYAI_API_KEY tanımlı değil!")
        return

    # Redis bağlantısını hazırla
    await get_redis()

    log.info("=" * 55)
    log.info("  Ashera Realtime Transcriber")
    log.info("  ws://%s:%d", HOST, PORT)
    log.info("  AssemblyAI Real-time API kullanıyor")
    log.info("  Redis: %s", REDIS_URL)
    log.info("=" * 55)

    async with websockets.serve(
        handle_connection,
        HOST,
        PORT,
        ping_interval=20,
        ping_timeout=30,
        max_size=10 * 1024 * 1024,  # 10 MB maks mesaj boyutu
    ):
        await asyncio.Future()  # Sonsuza kadar çalış


if __name__ == "__main__":
    asyncio.run(main())
