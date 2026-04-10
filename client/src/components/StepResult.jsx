import { useMemo, useState } from 'react'
import { CheckCheck, ChevronDown, ChevronUp, Copy } from 'lucide-react'

import styles from './StepResult.module.css'

function StepResult({ stepNumber, stepName, result }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const preview = useMemo(() => {
    return result.split('\n').slice(0, 3).join('\n')
  }, [result])

  const wordCount = useMemo(() => {
    return result.trim() ? result.trim().split(/\s+/).length : 0
  }, [result])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(result)
    setCopied(true)

    window.setTimeout(() => {
      setCopied(false)
    }, 1600)
  }

  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Step {stepNumber}</p>
          <h3>{stepName}</h3>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.iconButton} onClick={handleCopy}>
            {copied ? <CheckCheck size={16} /> : <Copy size={16} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            <span>{expanded ? 'Collapse' : 'Expand'}</span>
          </button>
        </div>
      </header>

      <pre className={`${styles.body} ${expanded ? styles.expanded : ''}`}>
        {expanded ? result : preview}
      </pre>

      <footer className={styles.footer}>
        <span>{wordCount} words</span>
        {!expanded && result.split('\n').length > 3 && <span>Preview 3 dòng</span>}
      </footer>
    </article>
  )
}

export default StepResult
