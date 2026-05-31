let lastSegmentCount = 0

function startPolling(meetingId, onNewSegments) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`http://localhost:8056/transcripts/google_meet/${meetingId}`)
      if (!res.ok) return
      const data = await res.json()
      const segments = data.segments || []

      if (segments.length > lastSegmentCount) {
        const newSegments = segments.slice(lastSegmentCount)
        lastSegmentCount = segments.length
        onNewSegments(newSegments)
      }
    } catch (err) {
      console.error('Transcript poll error:', err)
    }
  }, 10000)

  return () => clearInterval(interval)
}

module.exports = { startPolling }
