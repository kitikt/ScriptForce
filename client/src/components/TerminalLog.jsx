import { useEffect, useRef } from 'react'

import styles from './TerminalLog.module.css'

function TerminalLog({ logs }) {
  const viewportRef = useRef(null)

  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    }
  }, [logs])

  return (
    <section className={styles.terminal}>
      <header className={styles.header}>
        <div className={styles.lights}>
          <span className={`${styles.light} ${styles.red}`} />
          <span className={`${styles.light} ${styles.yellow}`} />
          <span className={`${styles.light} ${styles.green}`} />
        </div>
        <div className={styles.title}>terminal.log</div>
      </header>

      <div ref={viewportRef} className={styles.viewport}>
        {logs.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.prompt}>$</span>
            <span>Waiting for pipeline logs...</span>
          </div>
        ) : (
          logs.map((log, index) => (
            <div key={`${log.time}-${index}`} className={styles.line}>
              <span className={styles.time}>[{log.time}]</span>
              <span className={styles.prompt}>&gt;</span>
              <span className={styles.message}>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

export default TerminalLog
