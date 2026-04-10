import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

import ConfigPanel from './components/ConfigPanel'
import ExportButton from './components/ExportButton'
import Header from './components/Header'
import StatusBar from './components/StatusBar'
import StepProgress from './components/StepProgress'
import TerminalLog from './components/TerminalLog'
import styles from './App.module.css'

const SOCKET_URL = 'http://localhost:3001'

const STEP_DEFINITIONS = [
  { stepNumber: 1, name: 'Phan tich kich ban goc' },
  { stepNumber: 2, name: 'Viet outline 3 phan' },
  { stepNumber: 3, name: 'Danh gia va cai thien outline' },
  { stepNumber: 4, name: 'Viet Part 1' },
  { stepNumber: 5, name: 'Viet Part 2' },
  { stepNumber: 6, name: 'Viet Part 3' },
  { stepNumber: 7, name: 'Ghep va kiem tra chat luong' },
  { stepNumber: 8, name: 'Sua loi va hoan thien' },
]

function createLogEntry(message, time) {
  return {
    time: time || new Date().toLocaleTimeString('en-GB'),
    message,
  }
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
        next.sort((a, b) => a.stepNumber - b.stepNumber)
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
        (a, b) => a.stepNumber - b.stepNumber
      )
      setSteps(normalizedSteps)
      setCurrentStep(8)
      setPhase('done')
      setStatusMessage('Pipeline hoan tat. Ban co the xem ket qua va export.')
      appendLog({
        message: 'Pipeline completed successfully.',
      })
    })

    socket.on('error', (payload) => {
      const stepNumber = payload?.stepNumber ?? 0
      const message = payload?.error || 'Co loi xay ra.'
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
    setStatusMessage('Dang mo browser. Vui long login Claude.ai...')
    socketRef.current.emit('init_browser')
  }

  const handleStartPipeline = (config) => {
    if (!socketRef.current) {
      setStatusMessage('Socket chua san sang.')
      return
    }

    setPhase('running')
    setSteps([])
    setLogs([
      createLogEntry('Pipeline queued from client.'),
    ])
    setCurrentStep(0)
    setErrorStep(0)
    setStatusMessage('Dang khoi dong pipeline...')
    socketRef.current.emit('start_pipeline', config)
  }

  const sortedSteps = [...steps].sort((a, b) => a.stepNumber - b.stepNumber)

  return (
    <div className={styles.appShell}>
      <Header />
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
            </div>

            <div className={styles.resultsPane}>
              <TerminalLog logs={logs} />
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
