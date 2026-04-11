import { useEffect, useRef, useState } from 'react'

import styles from './TerminalLog.module.css'

function LogLine({ log }) {
  return (
    <div className={styles.line}>
      <span className={styles.time}>[{log.time}]</span>
      <span className={styles.prompt}>&gt;</span>
      <span className={styles.message}>{log.message}</span>
    </div>
  )
}

function TerminalLog({ logs, onClear, currentStep = 0, totalSteps = 8 }) {
  const viewportRef = useRef(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const lastLog = logs[logs.length - 1]
  const statusText =
    currentStep > 0 && currentStep <= totalSteps
      ? `Step ${currentStep}/${totalSteps} running...`
      : `${logs.length} logs`

  useEffect(() => {
    if (viewportRef.current && !isMinimized) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    }
  }, [logs, isMinimized])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsFullscreen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleClear = () => {
    if (typeof onClear === 'function') {
      onClear()
    }
  }

  const terminalClassName = [
    styles.terminal,
    isMinimized ? styles.minimized : '',
    isFullscreen ? styles.fullscreen : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      {isFullscreen && (
        <button
          type="button"
          className={styles.overlay}
          aria-label="Exit fullscreen"
          onClick={() => setIsFullscreen(false)}
        />
      )}

      <section className={terminalClassName}>
        <header className={styles.header}>
          <div className={styles.lights}>
            <button
              type="button"
              className={`${styles.light} ${styles.red}`}
              title="Clear log"
              aria-label="Clear log"
              onClick={handleClear}
            />
            <button
              type="button"
              className={`${styles.light} ${styles.yellow}`}
              title={isMinimized ? 'Expand' : 'Minimize'}
              aria-label={isMinimized ? 'Expand terminal' : 'Minimize terminal'}
              onClick={() => setIsMinimized((value) => !value)}
            />
            <button
              type="button"
              className={`${styles.light} ${styles.green}`}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen terminal'}
              onClick={() => setIsFullscreen((value) => !value)}
            />
          </div>
          <div className={styles.title}>terminal.log</div>
          <div className={styles.status}>{statusText}</div>
        </header>

        <div ref={viewportRef} className={styles.viewport}>
          {isMinimized && lastLog ? (
            <LogLine log={lastLog} />
          ) : logs.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.prompt}>$</span>
              <span>Waiting for pipeline logs...</span>
            </div>
          ) : (
            logs.map((log, index) => (
              <LogLine key={`${log.time}-${index}`} log={log} />
            ))
          )}
        </div>
      </section>
    </>
  )
}

export default TerminalLog
