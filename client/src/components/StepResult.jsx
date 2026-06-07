import { useMemo, useState } from 'react'
import { CheckCheck, ChevronDown, ChevronUp, Copy, FileText } from 'lucide-react'

import styles from './StepResult.module.css'

function StepResult({ stepNumber, stepName, result, artifacts = [] }) {
  const primaryArtifact = useMemo(() => {
    return (Array.isArray(artifacts) ? artifacts : []).find((artifact) =>
      String(artifact?.text || '').trim()
    )
  }, [artifacts])
  const displayText = primaryArtifact?.text || result || ''
  const isArtifactText = Boolean(primaryArtifact)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const preview = useMemo(() => {
    return displayText.split('\n').slice(0, 3).join('\n')
  }, [displayText])

  const wordCount = useMemo(() => {
    return displayText.trim() ? displayText.trim().split(/\s+/).length : 0
  }, [displayText])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(displayText)
    setCopied(true)

    window.setTimeout(() => {
      setCopied(false)
    }, 1600)
  }

  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Buoc {stepNumber}</p>
          <h3>{stepName}</h3>
          {isArtifactText && (
            <div className={styles.artifactBadge}>
              <FileText size={14} />
              <span>{primaryArtifact.fileName || 'File TXT tu Claude'}</span>
            </div>
          )}
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.iconButton} onClick={handleCopy}>
            {copied ? <CheckCheck size={16} /> : <Copy size={16} />}
            <span>{copied ? 'Da copy' : 'Copy'}</span>
          </button>

          {!isArtifactText && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              <span>{expanded ? 'Thu gon' : 'Mo rong'}</span>
            </button>
          )}
        </div>
      </header>

      <pre className={`${styles.body} ${expanded || isArtifactText ? styles.expanded : ''} ${isArtifactText ? styles.artifactBody : ''}`}>
        {expanded || isArtifactText ? displayText : preview}
      </pre>

      <footer className={styles.footer}>
        <span>{wordCount} tu</span>
        {isArtifactText ? (
          <span>Dang hien thi noi dung TXT day du</span>
        ) : (
          !expanded && displayText.split('\n').length > 3 && <span>Xem truoc 3 dong</span>
        )}
      </footer>
    </article>
  )
}

export default StepResult
