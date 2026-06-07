import { useMemo, useState } from 'react'
import { ChevronDown, Download, FileText } from 'lucide-react'

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

function ensureTxtFileName(name, fallbackName) {
  const safeName = getSafeFileName(name || fallbackName)
  return /\.txt$/i.test(safeName) ? safeName : `${safeName}.txt`
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

function isLineNumberOnly(line) {
  return /^\d{1,6}$/.test(String(line || '').trim())
}

function isBlankLikeLine(line) {
  return /^[\s\u00a0\u00c2]*$/.test(String(line || ''))
}

function stripLineNumberGutter(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const numberLines = lines
    .map((line, index) => ({
      index,
      value: isLineNumberOnly(line) ? Number(line.trim()) : null,
    }))
    .filter((entry) => entry.value !== null)

  if (numberLines.length < 5) {
    return lines.join('\n')
  }

  const removable = new Set()

  for (let index = 0; index < numberLines.length; index += 1) {
    const previous = numberLines[index - 1]
    const current = numberLines[index]
    const next = numberLines[index + 1]
    const continuesPrevious = previous && previous.value + 1 === current.value
    const continuesNext = next && current.value + 1 === next.value

    if (continuesPrevious || continuesNext) {
      removable.add(current.index)
    }
  }

  if (removable.size < 5) {
    return lines.join('\n')
  }

  return lines.filter((_, index) => !removable.has(index)).join('\n')
}

function cleanExportText(text) {
  return stripLineNumberGutter(text)
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => (isBlankLikeLine(line) ? '' : line.replace(/\u00c2/g, '')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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
    return cleanExportText(stripAfterReview(trimBeforePart(finalStep.result)))
  }

  if (reviewStep?.result && looksLikeScript(reviewStep.result)) {
    return cleanExportText(stripAfterReview(trimBeforePart(reviewStep.result)))
  }

  const writtenParts = [4, 5, 6]
    .map((stepNumber) => getStep(steps, stepNumber)?.result)
    .filter(Boolean)
    .map((result) => cleanExportText(trimBeforePart(result)))

  if (writtenParts.length > 0) {
    return cleanExportText(writtenParts.join('\n\n'))
  }

  return cleanExportText(steps
    .map(
      (step) =>
        `===== BƯỚC ${step.stepNumber}: ${step.stepName} =====\n${step.result}`
    )
    .join('\n\n')
  )
}

function getArtifactItems(steps) {
  return steps.flatMap((step) => {
    const artifacts = Array.isArray(step.artifacts) ? step.artifacts : []

    return artifacts
      .map((artifact, index) => {
        const text = cleanExportText(artifact?.text || '')

        if (!text) {
          return null
        }

        const fallbackFileName = `step-${step.stepNumber}-artifact-${index + 1}.txt`

        return {
          id: `${step.stepNumber}-${index}-${artifact.createdAt || artifact.fileName || fallbackFileName}`,
          stepNumber: step.stepNumber,
          stepName: step.stepName,
          fileName: ensureTxtFileName(artifact.fileName, fallbackFileName),
          source: artifact.source || 'artifact',
          text,
        }
      })
      .filter(Boolean)
  })
}

function downloadTextFile(fileName, content) {
  const file = new Blob([`\uFEFF${content}`], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function ExportButton({ steps, chatName }) {
  const [isOpen, setIsOpen] = useState(false)
  const artifactItems = useMemo(() => getArtifactItems(steps), [steps])
  const autoFileName = `${getSafeFileName(chatName)}.txt`

  const handleExportAuto = () => {
    downloadTextFile(autoFileName, getExportContent(steps))
    setIsOpen(false)
  }

  const handleExportArtifact = (artifact) => {
    downloadTextFile(artifact.fileName, artifact.text)
    setIsOpen(false)
  }

  const handleExportAllArtifacts = () => {
    for (const artifact of artifactItems) {
      downloadTextFile(artifact.fileName, artifact.text)
    }
    setIsOpen(false)
  }

  return (
    <div className={styles.exportMenu}>
      <button type="button" className={styles.button} onClick={() => setIsOpen((value) => !value)}>
        <Download size={18} />
        <span>Xuất file</span>
        <ChevronDown size={16} />
      </button>

      {isOpen && (
        <div className={styles.menuPanel}>
          <button type="button" className={styles.menuItem} onClick={handleExportAuto}>
            <FileText size={17} />
            <span>
              <strong>Kịch bản tự ghép</strong>
              <small>{autoFileName}</small>
            </span>
          </button>

          {artifactItems.length > 0 && (
            <>
              <div className={styles.menuDivider} />
              <div className={styles.menuLabel}>File TXT từ Claude</div>

              {artifactItems.map((artifact) => (
                <button
                  key={artifact.id}
                  type="button"
                  className={styles.menuItem}
                  onClick={() => handleExportArtifact(artifact)}
                >
                  <FileText size={17} />
                  <span>
                    <strong>{artifact.fileName}</strong>
                    <small>Bước {artifact.stepNumber}: {artifact.stepName}</small>
                  </span>
                </button>
              ))}

              {artifactItems.length > 1 && (
                <button type="button" className={styles.menuItemAccent} onClick={handleExportAllArtifacts}>
                  <Download size={17} />
                  <span>
                    <strong>Tải tất cả file TXT</strong>
                    <small>{artifactItems.length} file từ các bước pipeline</small>
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default ExportButton
