import logging
import os

from deepgram import DeepgramClient, PrerecordedOptions

from db import create_meeting_record, update_meeting_status, save_transcription_segments
from normalizer import NormalizedCall

log = logging.getLogger(__name__)

DEEPGRAM_API_KEY = os.environ.get('DEEPGRAM_API_KEY')


async def transcribe_call_recording(recording_url: str) -> list[dict]:
    """Download recording and transcribe with Deepgram."""
    deepgram = DeepgramClient(DEEPGRAM_API_KEY)

    options = PrerecordedOptions(
        model='nova-2',
        detect_language=True,
        diarize=True,
        punctuate=True,
        smart_format=True,
        filler_words=False,
        utterances=True,
    )

    # Use URL source directly (Deepgram can fetch the URL itself)
    source = {'url': recording_url}

    response = deepgram.listen.prerecorded.v('1').transcribe_url(source, options)
    result = response.to_dict()

    segments = []
    utterances = result.get('results', {}).get('utterances', [])

    for utt in utterances:
        segments.append({
            'speaker': f"Speaker {utt.get('speaker', 0) + 1}",
            'text': utt.get('transcript', '').strip(),
            'start_time': utt.get('start', 0),
            'end_time': utt.get('end', 0),
            'language': result.get('results', {})
                .get('channels', [{}])[0]
                .get('detected_language', 'tr'),
        })

    return segments


async def submit_call(call: NormalizedCall) -> None:
    meeting_id = await create_meeting_record(call)
    log.info("Created meeting record id=%d for call %s (provider=%s).", meeting_id, call.call_id, call.provider)

    try:
        await update_meeting_status(meeting_id, 'processing')

        # Transcribe with Deepgram
        segments = await transcribe_call_recording(call.recording_url)
        log.info("Transcribed %d segment(s) for call %s.", len(segments), call.call_id)

        # Save segments to database
        await save_transcription_segments(meeting_id, segments)

        await update_meeting_status(meeting_id, 'completed')
        print(f'[Call receiver] Transcribed {len(segments)} segments for meeting {meeting_id}')

    except Exception as e:
        log.error("Pipeline failed for call %s (meeting_id=%d): %s", call.call_id, meeting_id, e)
        await update_meeting_status(meeting_id, 'failed')
        raise
