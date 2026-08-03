// Robustly parse a JSON object out of an LLM text response.
// Models sometimes wrap output in ```json ... ``` fences or add stray prose
// despite instructions, so we strip fences and fall back to extracting the
// outermost {...} span before parsing.
function parseLlmJson(text) {
  let t = (text || '').trim()

  // Strip a leading/trailing markdown code fence if present.
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  }

  try {
    return JSON.parse(t)
  } catch {
    // Fall back to the outermost object span.
    const first = t.indexOf('{')
    const last = t.lastIndexOf('}')
    if (first !== -1 && last !== -1 && last > first) {
      return JSON.parse(t.slice(first, last + 1))
    }
    throw new Error('No JSON object found in response')
  }
}

module.exports = { parseLlmJson }
