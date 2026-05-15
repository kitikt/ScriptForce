import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

import ConfigPanel from './components/ConfigPanel'
import ExportButton from './components/ExportButton'
import ReviewPanel from './components/ReviewPanel'
import StatusBar from './components/StatusBar'
import StepProgress from './components/StepProgress'
import StepResult from './components/StepResult'
import TerminalLog from './components/TerminalLog'
import styles from './App.module.css'

const SOCKET_URL = 'http://localhost:3001'

const STEP_DEFINITIONS = [
  { stepNumber: 1, name: 'Phân tích kịch bản gốc' },
  { stepNumber: 2, name: 'Viết outline 3 phần' },
  { stepNumber: 3, name: 'Đánh giá và cải thiện outline' },
  { stepNumber: 4, name: 'Viết Part 1' },
  { stepNumber: 5, name: 'Viết Part 2' },
  { stepNumber: 6, name: 'Viết Part 3' },
  { stepNumber: 7, name: 'Bước 7a: Ghép và kiểm tra' },
  { stepNumber: 8, name: 'Bước 7b: Sửa và tạo file hoàn chỉnh' },
]

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

function createLogEntry(message, time) {
  return {
    time: time || new Date().toLocaleTimeString('en-GB'),
    message,
  }
}

function getCompactMessage(message, maxLength = 260) {
  const text = String(message || '')
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength)}...`
}

function getStepSortValue(step) {
  return typeof step.stepNumber === 'number' ? step.stepNumber : 99
}

function App() {
  const socketRef = useRef(null)
  const phaseRef = useRef('init')
  const [phase, setPhase] = useState('init')
  const [projects, setProjects] = useState([])
  const [steps, setSteps] = useState([])
  const [logs, setLogs] = useState([])
  const [currentStep, setCurrentStep] = useState(0)
  const [statusMessage, setStatusMessage] = useState('San sang ket noi browser.')
  const [errorStep, setErrorStep] = useState(0)
  const [reviewStep, setReviewStep] = useState(null)
  const [showResults, setShowResults] = useState(false)
  const [pipelineConfig, setPipelineConfig] = useState(null)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    const appendLog = (entry) => {
      setLogs((previous) => [
        ...previous,
        createLogEntry(entry?.message || '', entry?.time),
      ])
    }

    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setStatusMessage('Da ket noi Socket.IO toi automation server.')
      appendLog({ message: 'Socket connected to automation server.' })
    })

    socket.on('disconnect', (reason) => {
      setErrorStep(0)
      setStatusMessage(
        `Mat ket noi Socket.IO (${reason}). Vui long thu lai bang Connect Browser.`
      )
      appendLog({ message: `Socket disconnected: ${reason}` })

      if (phaseRef.current !== 'done') {
        setPhase('init')
      }
    })

    socket.on('connect_error', () => {
      setErrorStep(0)
      setStatusMessage(
        'Khong the ket noi toi server localhost:3001. Hay kiem tra backend roi thu lai.'
      )
      appendLog({
        message: 'Socket connection error while reaching localhost:3001.',
      })
      setPhase('init')
    })

    socket.on('login_success', (payload) => {
      setProjects(payload?.projects ?? [])
      setPhase('config')
      setStatusMessage('Login thanh cong. Chon project va cau hinh de bat dau.')
      appendLog({
        message: `Login success. Loaded ${payload?.projects?.length ?? 0} project(s).`,
      })
    })

    socket.on('status', (message) => {
      setStatusMessage(message || '')
    })

    socket.on('log', (payload) => {
      appendLog(payload)
    })

    socket.on('step_start', ({ stepNumber, stepName }) => {
      setCurrentStep(stepNumber)
      setErrorStep(0)
      setStatusMessage(`Dang chay buoc ${stepNumber}: ${stepName}`)
      setSteps((previous) =>
        previous.filter((step) => step.stepNumber !== stepNumber)
      )
      appendLog({
        message: `STEP ${stepNumber} started: ${stepName}`,
      })
    })

    socket.on('step_complete', ({ stepNumber, stepName, result }) => {
      setSteps((previous) => {
        const next = previous.filter((step) => step.stepNumber !== stepNumber)
        next.push({ stepNumber, stepName, result })
        next.sort((a, b) => getStepSortValue(a) - getStepSortValue(b))
        return next
      })
      setCurrentStep(stepNumber)
      setStatusMessage(`Da hoan thanh buoc ${stepNumber}: ${stepName}`)
      appendLog({
        message: `STEP ${stepNumber} completed: ${stepName}`,
      })
    })

    socket.on('pipeline_done', (results) => {
      const normalizedSteps = Object.values(results ?? {}).sort(
        (a, b) => getStepSortValue(a) - getStepSortValue(b)
      )
      setSteps(normalizedSteps)
      setCurrentStep(8)
      setReviewStep(null)
      setPhase('done')
      setStatusMessage('Pipeline hoan tat. Ban co the xem ket qua va export.')
      appendLog({
        message: 'Pipeline completed successfully.',
      })
    })

    socket.on('step_review', ({ stepNumber, stepName }) => {
      setReviewStep({ stepNumber, stepName })
      setStatusMessage(`Buoc ${stepNumber} xong. Review ket qua roi chon hanh dong.`)
      appendLog({ message: `Step ${stepNumber} waiting for review...` })
    })

    socket.on('pipeline_stopped', (results) => {
      const normalizedSteps = Object.values(results ?? {}).sort(
        (a, b) => getStepSortValue(a) - getStepSortValue(b)
      )
      setSteps(normalizedSteps)
      setPhase('done')
      setReviewStep(null)
      setStatusMessage('Pipeline da dung. Ban co the export ket qua da hoan thanh.')
      appendLog({ message: 'Pipeline stopped.' })
    })

    socket.on('error', (payload) => {
      const stepNumber = payload?.stepNumber ?? 0
      const message = getCompactMessage(payload?.error || 'Co loi xay ra.')
      const lowerMessage = message.toLowerCase()
      const shouldResetToInit =
        lowerMessage.includes('browser') || lowerMessage.includes('connect browser')

      setErrorStep(stepNumber)
      if (stepNumber > 0) {
        setCurrentStep(stepNumber)
      }

      setStatusMessage(message)
      appendLog({
        message:
          stepNumber > 0
            ? `ERROR at step ${stepNumber}: ${message}`
            : `ERROR: ${message}`,
      })

      if (shouldResetToInit || phaseRef.current === 'login') {
        setPhase('init')
      } else if (phaseRef.current === 'running') {
        setPhase('done')
      }
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  const handleConnectBrowser = () => {
    if (!socketRef.current) {
      setStatusMessage('Socket chua san sang.')
      return
    }

    setPhase('login')
    setSteps([])
    setLogs([])
    setCurrentStep(0)
    setErrorStep(0)
    setReviewStep(null)
    setShowResults(false)
    setPipelineConfig(null)
    setStatusMessage('Dang mo browser. Vui long login Claude.ai...')
    socketRef.current.emit('init_browser')
  }

  const handleStartPipeline = (config) => {
    if (!socketRef.current) {
      setStatusMessage('Socket chua san sang.')
      return
    }

    setPhase('running')
    setPipelineConfig(config)
    setSteps([])
    setLogs([
      createLogEntry('Pipeline queued from client.'),
    ])
    setCurrentStep(0)
    setErrorStep(0)
    setReviewStep(null)
    setShowResults(false)
    setStatusMessage('Dang khoi dong pipeline...')
    socketRef.current.emit('start_pipeline', config)
  }

  const handleClearLogs = () => {
    setLogs([
      createLogEntry('Terminal cleared.', new Date().toISOString()),
    ])
  }

  const handleReviewContinue = () => {
    setReviewStep(null)
    socketRef.current?.emit('review_continue')
  }

  const handleReviewContinueAuto = () => {
    setReviewStep(null)
    setStatusMessage('Da chuyen sang Auto mode. Pipeline se chay tiep khong dung review.')
    socketRef.current?.emit('review_continue_auto')
  }

  const handleReviewEdit = (message) => {
    setReviewStep(null)
    socketRef.current?.emit('review_edit', { message })
  }

  const handleReviewRedo = () => {
    setReviewStep(null)
    socketRef.current?.emit('review_redo')
  }

  const handleStopPipeline = () => {
    socketRef.current?.emit('stop_pipeline')
    setStatusMessage('Dang dung pipeline...')
  }

  const handleNewPipeline = () => {
    const previousChatName = pipelineConfig?.chatName
    setPhase('config')
    setSteps([])
    setLogs([])
    setCurrentStep(0)
    setErrorStep(0)
    setReviewStep(null)
    setShowResults(false)
    setPipelineConfig(null)
    setStatusMessage(
      previousChatName
        ? `San sang chay pipeline moi sau "${previousChatName}".`
        : 'San sang chay pipeline moi.'
    )
  }

  const handleToggleView = () => {
    setShowResults((previous) => !previous)
  }

  const sortedSteps = [...steps].sort((a, b) => getStepSortValue(a) - getStepSortValue(b))

  return (
    <div className={styles.appShell}>
      <div className={`${styles.orb} ${styles.orbTopLeft}`} />
      <div className={`${styles.orb} ${styles.orbCenterRight}`} />
      <div className={`${styles.orb} ${styles.orbBottomLeft}`} />

      <StatusBar
        message={statusMessage}
        processing={phase === 'login' || phase === 'running'}
      />

      <main className={styles.main}>
        {phase === 'init' && (
          <section className={styles.centerStage}>
            <div className={styles.heroCard}>
              <p className={styles.eyebrow}>Claude browser automation</p>
              <h1 className={styles.heroTitle}>Ket noi browser de bat dau pipeline</h1>
              <p className={styles.heroText}>
                App se mo Chromium persistent mode de ban login Claude.ai, sau do
                chon project va chay 8 buoc viet kich ban tu dong.
              </p>
              <p className={styles.heroHint}>
                Neu browser bi dong hoac Socket.IO ngat ket noi, chi can bam lai
                Connect Browser de retry.
              </p>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleConnectBrowser}
              >
                Connect Browser
              </button>
            </div>
          </section>
        )}

        {phase === 'login' && (
          <section className={styles.centerStage}>
            <div className={styles.waitCard}>
              <div className={styles.spinner} />
              <h2 className={styles.waitTitle}>Dang cho ban login Claude.ai...</h2>
              <p className={styles.waitText}>
                Hay hoan tat dang nhap trong cua so Chromium vua mo. Danh sach
                project se tu dong hien o buoc ke tiep.
              </p>
            </div>
          </section>
        )}

        {phase === 'config' && (
          <section className={styles.configStage}>
            <ConfigPanel projects={projects} onStart={handleStartPipeline} />
          </section>
        )}

        {(phase === 'running' || phase === 'done') && (
          <section className={styles.pipelineLayout}>
            <div className={styles.sidebar}>
              <StepProgress
                steps={STEP_DEFINITIONS}
                completedSteps={sortedSteps}
                currentStep={currentStep}
                errorStep={errorStep}
              />

              <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {phase === 'running' && !reviewStep && (
                  <button
                    type="button"
                    onClick={handleStopPipeline}
                    style={{
                      width: '100%', padding: '8px', borderRadius: '8px',
                      background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)',
                      color: '#ef4444', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                    }}
                  >
                    Stop Pipeline
                  </button>
                )}

                {phase === 'done' && (
                  <button
                    type="button"
                    onClick={handleNewPipeline}
                    style={{
                      width: '100%', padding: '8px', borderRadius: '8px',
                      background: 'rgba(0,212,170,0.2)', border: '1px solid rgba(0,212,170,0.4)',
                      color: '#00d4aa', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                    }}
                  >
                    New Pipeline
                  </button>
                )}

                {sortedSteps.length > 0 && (
                  <button
                    type="button"
                    onClick={handleToggleView}
                    style={{
                      width: '100%', padding: '8px', borderRadius: '8px',
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      color: '#9ca3af', cursor: 'pointer', fontSize: '13px',
                    }}
                  >
                    {showResults ? 'Show Terminal' : 'Show Results'}
                  </button>
                )}
              </div>
            </div>

            <div className={styles.resultsPane}>
              {reviewStep && (
                <ReviewPanel
                  stepNumber={reviewStep.stepNumber}
                  stepName={reviewStep.stepName}
                  result={sortedSteps.find((step) => step.stepNumber === reviewStep.stepNumber)?.result || ''}
                  onContinue={handleReviewContinue}
                  onContinueAuto={handleReviewContinueAuto}
                  onEdit={handleReviewEdit}
                  onRedo={handleReviewRedo}
                  onStop={handleStopPipeline}
                />
              )}

              {!showResults ? (
                <TerminalLog
                  logs={logs}
                  onClear={handleClearLogs}
                  currentStep={currentStep}
                  totalSteps={STEP_DEFINITIONS.length}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px' }}>
                  {sortedSteps.map((step) => (
                    <StepResult
                      key={step.stepNumber}
                      stepNumber={step.stepNumber}
                      stepName={step.stepName}
                      result={step.result}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {phase === 'done' && sortedSteps.length > 0 && (
        <div className={styles.exportDock}>
          <ExportButton steps={sortedSteps} />
        </div>
      )}
    </div>
  )
}

export default App
