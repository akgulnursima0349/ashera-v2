"""
AssemblyAI Proxy — Birikimli buffer versiyonu.

WhisperLive LIFO modunda fresh ~1s chunk'lar gönderir (büyümeyen).
Biz bunları biriktirir, MIN_CHUNK_SECONDS dolunca transcribe ederiz.
"""

import io
import os
import wave
import time
import threading
import logging
from typing import Optional

import assemblyai as aai
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [proxy] %(message)s"
)
log = logging.getLogger(__name__)

app = FastAPI(title="AssemblyAI Proxy")

ASSEMBLYAI_API_KEY      = os.getenv("ASSEMBLYAI_API_KEY", "")
ASSEMBLYAI_SPEECH_MODEL = os.getenv("ASSEMBLYAI_SPEECH_MODEL", "best")
MIN_CHUNK_SECONDS       = float(os.getenv("MIN_CHUNK_SECONDS", "5.0"))
IDLE_FLUSH_SECONDS      = float(os.getenv("IDLE_FLUSH_SECONDS", "4.0"))

if not ASSEMBLYAI_API_KEY:
    log.warning("⚠️  ASSEMBLYAI_API_KEY ayarlanmamış!")
else:
    log.info("✅ Proxy hazır | model=%s | min_chunk=%.0fs | idle_flush=%.0fs",
             ASSEMBLYAI_SPEECH_MODEL, MIN_CHUNK_SECONDS, IDLE_FLUSH_SECONDS)


# ─── WAV yardımcıları ────────────────────────────────────────────────────────

def _wav_duration(wav_bytes: bytes) -> float:
    try:
        with wave.open(io.BytesIO(wav_bytes)) as wf:
            return wf.getnframes() / wf.getframerate()
    except Exception:
        return 0.0


def _wav_params(wav_bytes: bytes):
    try:
        with wave.open(io.BytesIO(wav_bytes)) as wf:
            return wf.getnchannels(), wf.getsampwidth(), wf.getframerate()
    except Exception:
        return 1, 2, 16000


def _wav_frames(wav_bytes: bytes) -> bytes:
    try:
        with wave.open(io.BytesIO(wav_bytes)) as wf:
            return wf.readframes(wf.getnframes())
    except Exception:
        return b""


def _build_wav(frames: bytes, params) -> bytes:
    nchannels, sampwidth, framerate = params
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(nchannels)
        wf.setsampwidth(sampwidth)
        wf.setframerate(framerate)
        wf.writeframes(frames)
    return buf.getvalue()


# ─── Birikimli ses buffer'ı ───────────────────────────────────────────────────

class AudioBuffer:
    """
    WhisperLive'dan gelen fresh 1s chunk'ları biriktirir.
    MIN_CHUNK_SECONDS dolunca flush() ile tüm birikmiş sesi döndürür.
    """

    def __init__(self):
        self._frames: list[bytes] = []
        self._params = None
        self._total_duration: float = 0.0
        self._last_add_time: float = 0.0
        self._lock = threading.Lock()

    def add(self, wav_bytes: bytes) -> float:
        """Chunk ekle, toplam süreyi döndür."""
        with self._lock:
            frames = _wav_frames(wav_bytes)
            if not frames:
                return self._total_duration
            if self._params is None:
                self._params = _wav_params(wav_bytes)
            duration = _wav_duration(wav_bytes)
            self._frames.append(frames)
            self._total_duration += duration
            self._last_add_time = time.monotonic()
            log.debug("Buffer: +%.2fs → toplam %.2fs", duration, self._total_duration)
            return self._total_duration

    def flush(self) -> Optional[bytes]:
        """Tüm birikmiş sesi WAV olarak döndür ve buffer'ı sıfırla."""
        with self._lock:
            if not self._frames or self._params is None:
                return None
            wav = _build_wav(b"".join(self._frames), self._params)
            self._frames.clear()
            self._total_duration = 0.0
            return wav

    def flush_if_idle(self) -> Optional[bytes]:
        """IDLE_FLUSH_SECONDS geçtiyse ve buffer doluysa flush et."""
        with self._lock:
            idle = time.monotonic() - self._last_add_time
            if (self._frames
                    and self._total_duration >= 1.0
                    and idle >= IDLE_FLUSH_SECONDS):
                wav = _build_wav(b"".join(self._frames), self._params)
                self._frames.clear()
                self._total_duration = 0.0
                return wav
        return None

    @property
    def duration(self) -> float:
        with self._lock:
            return self._total_duration


_buffer = AudioBuffer()


# ─── Segment oluşturucu ──────────────────────────────────────────────────────

def _build_segments(transcript: aai.Transcript, audio_duration_s: float) -> list:
    if not transcript.words:
        if not transcript.text:
            return []
        return [{
            "id": 0, "seek": 0,
            "start": 0.0, "end": audio_duration_s,
            "text": " " + (transcript.text or ""),
            "tokens": [], "avg_logprob": -0.3,
            "compression_ratio": 1.0, "no_speech_prob": 0.0,
            "audio_start": 0.0, "audio_end": audio_duration_s,
        }]

    PAUSE_MS  = 600
    MIN_WORDS = 3
    MAX_WORDS = 50
    segments: list = []
    current:  list = []
    seg_id = 0

    for i, word in enumerate(transcript.words):
        current.append(word)
        is_last = (i == len(transcript.words) - 1)

        long_pause = False
        if not is_last:
            gap_ms = transcript.words[i + 1].start - word.end
            long_pause = gap_ms > PAUSE_MS

        sentence_end = word.text.rstrip().endswith((".", "?", "!"))
        over_max     = len(current) >= MAX_WORDS

        if is_last or over_max or (long_pause and len(current) >= MIN_WORDS) or (sentence_end and len(current) >= MIN_WORDS):
            start_s = current[0].start / 1000.0
            end_s   = current[-1].end   / 1000.0
            text    = " ".join(w.text for w in current)

            confs    = [w.confidence for w in current if w.confidence is not None]
            avg_conf = sum(confs) / len(confs) if confs else 0.9

            segments.append({
                "id": seg_id, "seek": 0,
                "start": round(start_s, 3), "end": round(end_s, 3),
                "text": " " + text,
                "tokens": [],
                "avg_logprob":       round(-(1.0 - avg_conf), 4),
                "compression_ratio": 1.0, "no_speech_prob": 0.0,
                "audio_start": round(start_s, 3),
                "audio_end":   round(end_s,   3),
            })
            seg_id += 1
            current = []

    return segments


# ─── AssemblyAI transkripsiyon ────────────────────────────────────────────────

def _transcribe(wav_bytes: bytes, language: str) -> dict:
    aai.settings.api_key = ASSEMBLYAI_API_KEY

    duration_s = _wav_duration(wav_bytes)
    log.info("🎙️  AssemblyAI → %.1fs ses, dil=%s, model=%s",
             duration_s, language, ASSEMBLYAI_SPEECH_MODEL)

    config = aai.TranscriptionConfig(
        language_code=language,
        punctuate=True,
        format_text=True,
        disfluencies=False,
        speech_model=(
            aai.SpeechModel.best
            if ASSEMBLYAI_SPEECH_MODEL == "best"
            else aai.SpeechModel.nano
        ),
    )

    t0 = time.monotonic()
    transcript = aai.Transcriber(config=config).transcribe(io.BytesIO(wav_bytes))
    elapsed = time.monotonic() - t0

    if transcript.status == aai.TranscriptStatus.error:
        raise RuntimeError(f"AssemblyAI hatası: {transcript.error}")

    audio_dur_s = (transcript.audio_duration or 0) / 1000.0
    segments    = _build_segments(transcript, audio_dur_s)

    log.info("✅ %.1fs'de tamamlandı → %d segment | %.70s",
             elapsed, len(segments), transcript.text or "")

    return {
        "text":     transcript.text or "",
        "language": language,
        "duration": round(audio_dur_s, 3),
        "segments": segments,
    }


_EMPTY = {"text": "", "language": "en", "duration": 0.0, "segments": []}


# ─── Endpoint ─────────────────────────────────────────────────────────────────

@app.post("/v1/audio/transcriptions")
async def transcribe(
    file:            UploadFile    = File(...),
    model:           str           = Form(default="best"),
    language:        Optional[str] = Form(default=None),
    response_format: str           = Form(default="verbose_json"),
    temperature:     str           = Form(default="0"),
    task:            str           = Form(default="transcribe"),
    prompt:          Optional[str] = Form(default=None),
    vad_model:       Optional[str] = Form(default=None),
):
    if not ASSEMBLYAI_API_KEY:
        return JSONResponse(status_code=500, content={"error": "ASSEMBLYAI_API_KEY eksik"})

    wav_bytes = await file.read()
    lang      = language or "en"

    # 1) Toplantı sonu kurtarma: uzun süredir chunk gelmiyorsa flush et
    idle_wav = _buffer.flush_if_idle()
    if idle_wav:
        log.info("⏰ Idle flush: %.1fs ses işleniyor", _wav_duration(idle_wav))
        try:
            return _transcribe(idle_wav, lang)
        except Exception as exc:
            log.error("Idle flush hatası: %s", exc)

    # 2) Gelen chunk'ı buffer'a ekle
    total = _buffer.add(wav_bytes)

    # 3) Yeterli ses birikti mi?
    if total < MIN_CHUNK_SECONDS:
        return _EMPTY

    # 4) Yeterli → flush et ve transcribe
    buffered_wav = _buffer.flush()
    if not buffered_wav:
        return _EMPTY

    try:
        return _transcribe(buffered_wav, lang)
    except Exception as exc:
        log.error("Transkripsiyon hatası: %s", exc)
        return JSONResponse(status_code=500, content={"error": str(exc)})


@app.get("/health")
def health():
    return {
        "status":             "ok",
        "api_key_set":        bool(ASSEMBLYAI_API_KEY),
        "model":              ASSEMBLYAI_SPEECH_MODEL,
        "min_chunk_seconds":  MIN_CHUNK_SECONDS,
        "idle_flush_seconds": IDLE_FLUSH_SECONDS,
        "buffer_duration_s":  round(_buffer.duration, 2),
    }
