import { Download } from 'lucide-react'

import styles from './ExportButton.module.css'

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`
}

function getSafeFileName(name) {
  const safeName = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 120)

  return safeName || `final_script_${formatTimestamp(new Date())}`
}

function getStep(steps, stepNumber) {
  return steps.find((step) => Number(step.stepNumber) === stepNumber)
}

function stripAfterReview(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const reviewIndex = lines.findIndex((line) => {
    const trimmed = line.trim()

    return (
      /^QUALITY REVIEW\b/i.test(trimmed) ||
      /^FULL SCREENPLAY AUDIT\b/i.test(trimmed) ||
      /^1\.\s*LOGIC\b/i.test(trimmed) ||
      /^X(?:a|\u00e1)c nh(?:a|\u1ead)n c(?:a|\u00e1)c l(?:o|\u1ed7)i/i.test(trimmed)
    )
  })

  if (reviewIndex < 0) {
    return lines.join('\n').trim()
  }

  return lines.slice(0, reviewIndex).join('\n').trim()
}

function trimBeforePart(text, partPattern = /^part\s+(one|two|three)\b/i) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const partIndex = lines.findIndex((line) => partPattern.test(line.trim()))

  if (partIndex < 0) {
    return String(text || '').trim()
  }

  let titleIndex = partIndex - 1
  while (titleIndex >= 0 && !lines[titleIndex].trim()) {
    titleIndex -= 1
  }

  const titleLine = titleIndex >= 0 ? lines[titleIndex].trim() : ''
  const canIncludeTitle =
    titleLine &&
    titleLine.length <= 140 &&
    !/^=====/.test(titleLine) &&
    !/^(role|old name|new name|seed|errors fixed|vai tro|ten cu|ten moi)$/i.test(titleLine)

  return lines.slice(canIncludeTitle ? titleIndex : partIndex).join('\n').trim()
}

function looksLikeScript(text) {
  const normalized = String(text || '').trim()
  const wordCount = normalized ? normalized.split(/\s+/).length : 0

  if (/part\s+one\b/i.test(normalized)) {
    return true
  }

  if (normalized.length < 5000 || wordCount < 700) {
    return false
  }

  return !/^===== STEP\b/i.test(normalized) &&
    !/^QUALITY REVIEW\b/i.test(normalized) &&
    !/^FULL SCREENPLAY AUDIT\b/i.test(normalized)
}

function getExportContent(steps) {
  const finalStep = getStep(steps, 8)
  const reviewStep = getStep(steps, 7)

  if (finalStep?.result && looksLikeScript(finalStep.result)) {
    return stripAfterReview(trimBeforePart(finalStep.result))
  }

  if (reviewStep?.result && looksLikeScript(reviewStep.result)) {
    return stripAfterReview(trimBeforePart(reviewStep.result))
  }

  const writtenParts = [4, 5, 6]
    .map((stepNumber) => getStep(steps, stepNumber)?.result)
    .filter(Boolean)
    .map((result) => trimBeforePart(result))

  if (writtenParts.length > 0) {
    return writtenParts.join('\n\n').trim()
  }

  return steps
    .map(
      (step) =>
        `===== BƯỚC ${step.stepNumber}: ${step.stepName} =====\n${step.result}`
    )
    .join('\n\n')
    .trim()
}

function ExportButton({ steps, chatName }) {
  const handleExport = () => {
    const content = getExportContent(steps)

    const file = new Blob([`\uFEFF${content}`], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = `${getSafeFileName(chatName)}.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button type="button" className={styles.button} onClick={handleExport}>
      <Download size={18} />
      <span>Xuất kịch bản hoàn chỉnh</span>
    </button>
  )
}

export default ExportButton
