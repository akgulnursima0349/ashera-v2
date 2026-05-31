let meetingStartTime = null
let timerInterval = null
let briefCount = 0
let phaseIndex = 0

function startTimer() {
  meetingStartTime = Date.now()
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - meetingStartTime) / 1000)
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0')
    const s = String(elapsed % 60).padStart(2, '0')
    document.getElementById('timer').textContent = `${m}:${s}`
  }, 1000)
}

function advancePhase() {
  if (phaseIndex < 5) {
    for (let i = 0; i < phaseIndex; i++) {
      document.getElementById('p' + i).className = 'phase-seg done'
    }
    document.getElementById('p' + phaseIndex).className = 'phase-seg active'
    phaseIndex++
  }
}

function renderAlerts(alerts) {
  const section = document.createElement('div')
  section.className = 'alert-section'
  section.id = 'alert-section'
  alerts.forEach(a => {
    const chip = document.createElement('div')
    chip.className = `alert-chip ${a.type}`
    chip.textContent = a.text
    section.appendChild(chip)
  })
  return section
}

function renderBriefs(briefs) {
  const section = document.createElement('div')
  section.className = 'brif-section'
  section.id = 'brif-section'
  briefs.forEach(b => {
    section.appendChild(makeBrifItem(b, true))
  })
  return section
}

function makeBrifItem(b, isNew) {
  const item = document.createElement('div')
  item.className = 'brif-item'
  const newBadge = isNew ? '<span class="new-badge">yeni</span>' : ''
  item.innerHTML = `
    <span class="brif-tag ${b.tag}">${b.tag}${newBadge}</span>
    <span class="brif-text">${b.text}</span>
  `
  return item
}

function updateLastUpdated() {
  document.getElementById('last-update').textContent = 'şimdi güncellendi'
  setTimeout(() => {
    document.getElementById('last-update').textContent = 'son güncelleme 10s önce'
  }, 10000)
}

function updateDealScore(score) {
  const el = document.getElementById('deal-score')
  el.textContent = score
  el.style.color = score >= 75 ? '#5DCAA5' : score >= 50 ? '#FAC775' : '#F09595'
}

// IPC from main process
window.overlayAPI.onBriefUpdate((data) => {
  const content = document.getElementById('main-content')
  document.getElementById('connecting').style.display = 'none'
  document.getElementById('footer').style.display = 'flex'

  // Mark existing briefs as old
  document.querySelectorAll('.brif-item').forEach(el => el.classList.add('old'))

  // Remove and re-render alerts
  const existingAlerts = document.getElementById('alert-section')
  if (existingAlerts) existingAlerts.remove()

  const existingBriefs = document.getElementById('brif-section')
  if (existingBriefs) existingBriefs.remove()
  const divider = document.getElementById('main-divider')
  if (divider) divider.remove()

  if (data.alerts && data.alerts.length > 0) {
    content.appendChild(renderAlerts(data.alerts))
    const div = document.createElement('div')
    div.className = 'divider'
    div.id = 'main-divider'
    content.appendChild(div)
  }

  if (data.briefs && data.briefs.length > 0) {
    content.appendChild(renderBriefs(data.briefs))
  }

  if (data.dealScore !== undefined) updateDealScore(data.dealScore)
  updateLastUpdated()
  advancePhase()

  // Tell main process new content height for window resize
  window.overlayAPI.reportHeight(document.getElementById('overlay').scrollHeight)
})

window.overlayAPI.onMeetingStart(() => {
  startTimer()
})
