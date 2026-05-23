import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import {
  Check,
  Gauge,
  ListPlus,
  Pencil,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  UserPlus,
  UserRound,
  X,
} from 'lucide-react'

import ConfigPanel from './components/ConfigPanel'
import ExportButton from './components/ExportButton'
import ReviewPanel from './components/ReviewPanel'
import StatusBar from './components/StatusBar'
import StepProgress from './components/StepProgress'
import StepResult from './components/StepResult'
import TerminalLog from './components/TerminalLog'
import styles from './App.module.css'

const SOCKET_URL = 'http://localhost:3001'
const DEFAULT_MAX_ACTIVE_PIPELINES = 2

const STEP_DEFINITIONS = [
  { stepNumber: 1, name: 'Phân tích kịch bản gốc' },
  { stepNumber: 2, name: 'Viết outline 3 phần' },
  { stepNumber: 3, name: 'Đánh giá và cải thiện outline' },
  { stepNumber: 4, name: 'Bước 5: Viết Part 1' },
  { stepNumber: 5, name: 'Bước 6: Viết Part 2' },
  { stepNumber: 6, name: 'Bước 7: Viết Part 3' },
  { stepNumber: 7, name: 'Bước 7a: Ghép và kiểm tra' },
  { stepNumber: 8, name: 'Bước 8: Sửa và tạo file hoàn chỉnh' },
]

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const TERMINAL_STATUSES = new Set(['done', 'stopped', 'error'])

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

function normalizeResults(results) {
  return Object.values(results ?? {}).sort(
    (a, b) => getStepSortValue(a) - getStepSortValue(b)
  )
}

function isActivePipeline(pipeline) {
  return pipeline && !TERMINAL_STATUSES.has(pipeline.status)
}

function getPipelineTitle(pipeline) {
  return pipeline?.config?.chatName || 'Pipeline chưa đặt tên'
}

function getPipelineStatusLabel(status) {
  const labels = {
    starting: 'Đang khởi động',
    running: 'Đang chạy',
    review: 'Chờ kiểm tra',
    done: 'Hoàn tất',
    stopped: 'Đã dừng',
    error: 'Có lỗi',
  }

  return labels[status] || status || 'Không rõ'
}

function createPipelineFromJob(job) {
  return {
    id: job.pipelineId,
    config: job.config || {},
    status: job.status || 'starting',
    statusMessage: job.statusMessage || 'Pipeline đã được đưa vào hàng chạy.',
    steps: normalizeResults(job.steps || job.results || {}),
    logs:
      Array.isArray(job.logs) && job.logs.length > 0
        ? job.logs
        : [createLogEntry('Pipeline đã được đưa vào hàng chạy từ client.')],
    currentStep: job.currentStep || 0,
    errorStep: job.errorStep || 0,
    reviewStep: job.reviewStep || null,
    showResults: false,
    startedAt: job.startedAt || new Date().toISOString(),
    finishedAt: job.finishedAt || null,
  }
}

function getPipelineStepDefinitions(pipeline) {
  return [
    ...STEP_DEFINITIONS,
    ...(pipeline?.config?.customPromptSteps || []).map((step) => ({
      stepNumber: step.stepNumber,
      name: step.name,
    })),
  ]
}

function updatePipeline(pipelines, pipelineId, updater) {
  return pipelines.map((pipeline) => {
    if (pipeline.id !== pipelineId) {
      return pipeline
    }

    return updater(pipeline)
  })
}

function getUsageTone(metric) {
  const used = metric?.usedPercent

  if (used === null || used === undefined) {
    return ''
  }

  if (used >= 95) {
    return styles.usageDanger
  }

  if (used >= 75) {
    return styles.usageWarning
  }

  return styles.usageOk
}

function UsageMeter({ metric }) {
  const usedPercent = metric?.usedPercent
  const remainingPercent = metric?.remainingPercent
  const width = usedPercent === null || usedPercent === undefined ? 0 : usedPercent

  return (
    <div className={styles.usageMetric}>
      <div className={styles.usageMetricHeader}>
        <strong>{metric?.label}</strong>
        <span>
          {usedPercent === null || usedPercent === undefined
            ? 'Đang chờ'
            : `${usedPercent}% đã dùng / ${remainingPercent}% còn lại`}
        </span>
      </div>
      <div className={styles.usageTrack}>
        <div
          className={`${styles.usageFill} ${getUsageTone(metric)}`}
          style={{ width: `${width}%` }}
        />
      </div>
      {(metric?.resetText || metric?.note) && (
        <p className={styles.usageNote}>{metric.resetText || metric.note}</p>
      )}
    </div>
  )
}

function UsagePanel({ usage, error, onRefresh }) {
  const routine = usage?.dailyRoutineRuns
  const routinePercent =
    routine?.limit > 0 ? Math.min(100, Math.round((routine.used / routine.limit) * 100)) : 0

  return (
    <section className={styles.usagePanel}>
      <header className={styles.usageHeader}>
        <div>
          <p className={styles.eyebrow}>Claude</p>
          <h3>Giới hạn sử dụng</h3>
        </div>
        <button
          type="button"
          className={styles.usageRefresh}
          onClick={onRefresh}
          title="Cập nhật mức sử dụng ngay"
        >
          <RefreshCw size={14} />
        </button>
      </header>

      {!usage && !error && (
        <div className={styles.usageEmpty}>
          <Gauge size={16} />
          <span>Đang chờ dữ liệu mức sử dụng...</span>
        </div>
      )}

      {error && <p className={styles.usageError}>{error}</p>}

      {usage && (
        <>
          {usage.plan && <p className={styles.usagePlan}>Gói: {usage.plan}</p>}
          <UsageMeter metric={usage.currentSession} />
          <div className={styles.usageWeekly}>
            {usage.weekly?.map((metric) => (
              <UsageMeter key={metric.label} metric={metric} />
            ))}
          </div>
          {routine && (
            <div className={styles.usageMetric}>
              <div className={styles.usageMetricHeader}>
                <strong>Lượt routine hằng ngày</strong>
                <span>
                  {routine.used}/{routine.limit}
                </span>
              </div>
              <div className={styles.usageTrack}>
                <div className={styles.usageFill} style={{ width: `${routinePercent}%` }} />
              </div>
            </div>
          )}
          <p className={styles.usageUpdated}>
            {usage.lastUpdated || `Đã lấy lúc ${new Date(usage.fetchedAt).toLocaleTimeString('en-GB')}`}
          </p>
        </>
      )}
    </section>
  )
}

function UsageCompactPanel({ usage, error, onRefresh }) {
  const currentSession = usage?.currentSession
  const usedPercent = currentSession?.usedPercent
  const remainingPercent = currentSession?.remainingPercent
  const width = usedPercent === null || usedPercent === undefined ? 0 : usedPercent

  return (
    <section className={styles.compactPanel}>
      <header className={styles.compactHeader}>
        <div>
          <p className={styles.eyebrow}>Usage</p>
          <h3>Current session</h3>
        </div>
        <button
          type="button"
          className={styles.compactIconButton}
          onClick={onRefresh}
          title="Cập nhật usage"
        >
          <RefreshCw size={14} />
        </button>
      </header>

      {error ? (
        <p className={styles.compactError}>{error}</p>
      ) : (
        <>
          <div className={styles.compactUsageLine}>
            <strong>{usedPercent === null || usedPercent === undefined ? '...' : `${usedPercent}%`}</strong>
            <span>
              {remainingPercent === null || remainingPercent === undefined
                ? 'Đang đọc usage'
                : `${remainingPercent}% còn lại`}
            </span>
          </div>
          <div className={styles.usageTrack}>
            <div
              className={`${styles.usageFill} ${getUsageTone(currentSession)}`}
              style={{ width: `${width}%` }}
            />
          </div>
          {(currentSession?.resetText || usage?.lastUpdated) && (
            <p className={styles.compactMeta}>{currentSession?.resetText || usage.lastUpdated}</p>
          )}
        </>
      )}
    </section>
  )
}

function AccountCompactPanel({ profilesState, error }) {
  const profiles = profilesState?.profiles || []
  const activeProfile = profiles.find((profile) => profile.isActive)

  return (
    <section className={styles.compactPanel}>
      <header className={styles.compactHeader}>
        <div>
          <p className={styles.eyebrow}>Tài khoản</p>
          <h3 title={activeProfile?.label || 'Chưa chọn profile'}>
            {activeProfile?.label || 'Chưa chọn profile'}
          </h3>
        </div>
        <UserRound size={17} />
      </header>
      {error ? (
        <p className={styles.compactError}>{error}</p>
      ) : (
        <p className={styles.compactMeta}>
          {profiles.length > 0 ? `${profiles.length} profile Claude` : 'Chưa có profile'}
        </p>
      )}
    </section>
  )
}

function AccountPanel({
  profilesState,
  error,
  activePipelineCount,
  onCreate,
  onSwitch,
  onRename,
  onDelete,
}) {
  const [newProfileLabel, setNewProfileLabel] = useState('')
  const [editingProfileId, setEditingProfileId] = useState(null)
  const [editingLabel, setEditingLabel] = useState('')
  const profiles = profilesState?.profiles || []
  const activeProfile = profiles.find((profile) => profile.isActive)
  const isSwitchLocked = activePipelineCount > 0

  const handleCreate = () => {
    const label = newProfileLabel.trim()
    onCreate(label || `Tài khoản Claude ${profiles.length + 1}`)
    setNewProfileLabel('')
  }

  const startRename = (profile) => {
    setEditingProfileId(profile.id)
    setEditingLabel(profile.label)
  }

  const submitRename = () => {
    if (!editingProfileId || !editingLabel.trim()) {
      return
    }

    onRename(editingProfileId, editingLabel.trim())
    setEditingProfileId(null)
    setEditingLabel('')
  }

  return (
    <section className={styles.accountPanel}>
      <header className={styles.accountHeader}>
        <div>
          <p className={styles.eyebrow}>Tài khoản Claude</p>
          <h3>{activeProfile?.label || 'Chưa chọn profile'}</h3>
        </div>
        <UserRound size={18} />
      </header>

      {error && <p className={styles.accountError}>{error}</p>}
      {isSwitchLocked && (
        <p className={styles.accountHint}>
          Hãy dừng các pipeline đang chạy trước khi đổi ô tài khoản.
        </p>
      )}

      <div className={styles.profileList}>
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className={`${styles.profileRow} ${profile.isActive ? styles.profileActive : ''}`}
          >
            {editingProfileId === profile.id ? (
              <>
                <input
                  className={styles.profileInput}
                  value={editingLabel}
                  onChange={(event) => setEditingLabel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      submitRename()
                    }
                    if (event.key === 'Escape') {
                      setEditingProfileId(null)
                      setEditingLabel('')
                    }
                  }}
                />
                <button type="button" className={styles.profileIconButton} onClick={submitRename}>
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  className={styles.profileIconButton}
                  onClick={() => {
                    setEditingProfileId(null)
                    setEditingLabel('')
                  }}
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.profileSelect}
                  onClick={() => onSwitch(profile.id)}
                  disabled={profile.isActive || isSwitchLocked}
                >
                  <span>{profile.label}</span>
                  <small>{profile.isActive ? 'Đang dùng' : 'Chuyển'}</small>
                </button>
                <button
                  type="button"
                  className={styles.profileIconButton}
                  onClick={() => startRename(profile)}
                  title="Đổi tên profile"
                >
                  <Pencil size={14} />
                </button>
                {!profile.isDefault && (
                  <button
                    type="button"
                    className={styles.profileIconButton}
                    onClick={() => onDelete(profile.id)}
                    disabled={isSwitchLocked}
                    title="Xóa profile"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <div className={styles.profileCreate}>
        <input
          value={newProfileLabel}
          onChange={(event) => setNewProfileLabel(event.target.value)}
          placeholder="Tên tài khoản mới"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleCreate()
            }
          }}
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={isSwitchLocked}
          title="Thêm ô tài khoản Claude"
        >
          <UserPlus size={15} />
        </button>
      </div>
    </section>
  )
}

function App() {
  const socketRef = useRef(null)
  const [phase, setPhase] = useState('init')
  const [projects, setProjects] = useState([])
  const [pipelines, setPipelines] = useState([])
  const [selectedPipelineId, setSelectedPipelineId] = useState(null)
  const [showConfig, setShowConfig] = useState(false)
  const [globalStatus, setGlobalStatus] = useState('Sẵn sàng kết nối browser.')
  const [usageSnapshot, setUsageSnapshot] = useState(null)
  const [usageError, setUsageError] = useState('')
  const [profilesState, setProfilesState] = useState({ activeProfileId: null, profiles: [] })
  const [profileError, setProfileError] = useState('')
  const [activeCapacity, setActiveCapacity] = useState({
    activeCount: 0,
    maxActivePipelines: DEFAULT_MAX_ACTIVE_PIPELINES,
  })

  const activePipelineCount = useMemo(
    () => pipelines.filter(isActivePipeline).length,
    [pipelines]
  )
  const maxActivePipelines =
    activeCapacity.maxActivePipelines || DEFAULT_MAX_ACTIVE_PIPELINES
  const selectedPipeline =
    pipelines.find((pipeline) => pipeline.id === selectedPipelineId) || pipelines[0] || null
  const sortedSteps = selectedPipeline
    ? [...selectedPipeline.steps].sort((a, b) => getStepSortValue(a) - getStepSortValue(b))
    : []
  const canStartPipeline = activePipelineCount < maxActivePipelines
  const selectedStepDefinitions = selectedPipeline
    ? getPipelineStepDefinitions(selectedPipeline)
    : STEP_DEFINITIONS

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setGlobalStatus('Đã kết nối Socket.IO tới automation server.')
      socket.emit('list_profiles')
      socket.emit('list_pipelines')
    })

    socket.on('disconnect', (reason) => {
      setGlobalStatus(`Mất kết nối Socket.IO (${reason}). Vui lòng thử lại bằng Kết nối trình duyệt.`)
      setPhase((previous) => (previous === 'workspace' ? previous : 'init'))
    })

    socket.on('connect_error', () => {
      setGlobalStatus('Không thể kết nối tới server localhost:3001. Hãy kiểm tra backend rồi thử lại.')
      setPhase('init')
    })

    socket.on('login_success', (payload) => {
      setProjects(payload?.projects ?? [])
      setPhase((previous) => (previous === 'workspace' ? 'workspace' : 'config'))
      setShowConfig((previous) => previous)
      setGlobalStatus('Đăng nhập thành công. Chọn project và cấu hình pipeline.')
      socket.emit('request_usage')
    })

    socket.on('pipeline_started', ({ job, activeCount, maxActivePipelines }) => {
      if (!job?.pipelineId) {
        return
      }

      setActiveCapacity({
        activeCount: activeCount ?? 0,
        maxActivePipelines: maxActivePipelines ?? DEFAULT_MAX_ACTIVE_PIPELINES,
      })
      setPipelines((previous) => [...previous, createPipelineFromJob(job)])
      setSelectedPipelineId(job.pipelineId)
      setShowConfig(false)
      setPhase('workspace')
      setGlobalStatus(`Pipeline "${job.config?.chatName || job.pipelineId}" đã bắt đầu.`)
    })

    socket.on('pipeline_capacity', (payload) => {
      setActiveCapacity({
        activeCount: payload?.activeCount ?? 0,
        maxActivePipelines: payload?.maxActivePipelines ?? DEFAULT_MAX_ACTIVE_PIPELINES,
      })
    })

    socket.on('pipeline_rejected', (payload) => {
      setGlobalStatus(payload?.error || 'Pipeline bị từ chối.')
    })

    socket.on('pipelines_snapshot', (payload) => {
      const jobs = Array.isArray(payload?.jobs) ? payload.jobs : []
      const restoredPipelines = jobs.map(createPipelineFromJob)

      setActiveCapacity({
        activeCount: payload?.activeCount ?? restoredPipelines.filter(isActivePipeline).length,
        maxActivePipelines: payload?.maxActivePipelines ?? DEFAULT_MAX_ACTIVE_PIPELINES,
      })
      setPipelines(restoredPipelines)

      if (restoredPipelines.length > 0) {
        setSelectedPipelineId((previous) =>
          restoredPipelines.some((pipeline) => pipeline.id === previous)
            ? previous
            : restoredPipelines[restoredPipelines.length - 1].id
        )
        setShowConfig(false)
        setPhase('workspace')
      }
    })
    socket.on('profiles_update', (payload) => {
      setProfilesState(payload || { activeProfileId: null, profiles: [] })
      setProfileError('')
    })

    socket.on('profile_error', (payload) => {
      const message = payload?.error || 'Không thao tác được Claude profile.'
      setProfileError(message)
      setGlobalStatus(message)
    })

    socket.on('profile_ready_for_login', ({ profile }) => {
      setUsageSnapshot(null)
      setUsageError('')
      setProjects([])
      setPipelines([])
      setSelectedPipelineId(null)
      setShowConfig(false)
      setPhase('init')
      setGlobalStatus(`Profile "${profile?.label || 'Tài khoản Claude'}" đã sẵn sàng. Bấm Kết nối trình duyệt để đăng nhập hoặc dùng lại session.`)
    })

    socket.on('usage_update', (payload) => {
      setUsageSnapshot(payload)
      setUsageError('')
    })

    socket.on('usage_error', (payload) => {
      setUsageError(payload?.error || 'Không đọc được mức sử dụng Claude.')
    })

    socket.on('status', (payload) => {
      if (typeof payload === 'string') {
        setGlobalStatus(payload)
        return
      }

      const pipelineId = payload?.pipelineId
      const message = payload?.message || ''
      if (!pipelineId) {
        setGlobalStatus(message)
        return
      }

      setPipelines((previous) =>
        updatePipeline(previous, pipelineId, (pipeline) => ({
          ...pipeline,
          statusMessage: message,
        }))
      )
    })

    socket.on('log', (payload) => {
      const pipelineId = payload?.pipelineId
      const entry = createLogEntry(payload?.message || '', payload?.time)

      if (!pipelineId) {
        setGlobalStatus(entry.message)
        return
      }

      setPipelines((previous) =>
        updatePipeline(previous, pipelineId, (pipeline) => ({
          ...pipeline,
          logs: [...pipeline.logs, entry],
        }))
      )
    })

    socket.on('step_start', ({ pipelineId, stepNumber, stepName }) => {
      setPipelines((previous) =>
        updatePipeline(previous, pipelineId, (pipeline) => ({
          ...pipeline,
          status: 'running',
          currentStep: stepNumber,
          errorStep: 0,
          reviewStep: null,
          statusMessage: `Đang chạy bước ${stepNumber}: ${stepName}`,
          steps: pipeline.steps.filter((step) => step.stepNumber !== stepNumber),
          logs: [...pipeline.logs, createLogEntry(`Bước ${stepNumber} đã bắt đầu: ${stepName}`)],
        }))
      )
    })

    socket.on('step_complete', ({ pipelineId, stepNumber, stepName, result }) => {
      setPipelines((previous) =>
        updatePipeline(previous, pipelineId, (pipeline) => {
          const nextSteps = pipeline.steps.filter((step) => step.stepNumber !== stepNumber)
          nextSteps.push({ stepNumber, stepName, result })
          nextSteps.sort((a, b) => getStepSortValue(a) - getStepSortValue(b))

          return {
            ...pipeline,
            currentStep: stepNumber,
            statusMessage: `Đã hoàn thành bước ${stepNumber}: ${stepName}`,
            steps: nextSteps,
            logs: [...pipeline.logs, createLogEntry(`Bước ${stepNumber} đã hoàn thành: ${stepName}`)],
          }
        })
      )
    })

    socket.on('step_review', ({ pipelineId, stepNumber, stepName }) => {
      setPipelines((previous) =>
        updatePipeline(previous, pipelineId, (pipeline) => ({
          ...pipeline,
          status: 'review',
          reviewStep: { stepNumber, stepName },
          statusMessage: `Bước ${stepNumber} xong. Kiểm tra kết quả rồi chọn hành động.`,
          logs: [...pipeline.logs, createLogEntry(`Bước ${stepNumber} đang chờ kiểm tra...`)],
        }))
      )
    })

    socket.on('pipeline_done', ({ pipelineId, results }) => {
      setPipelines((previous) =>
        updatePipeline(previous, pipelineId, (pipeline) => ({
          ...pipeline,
          status: 'done',
          currentStep: getPipelineStepDefinitions(pipeline).length,
          reviewStep: null,
          statusMessage: 'Pipeline hoàn tất. Bạn có thể xem kết quả và xuất file.',
          steps: normalizeResults(results),
          logs: [...pipeline.logs, createLogEntry('Pipeline đã hoàn tất thành công.')],
          finishedAt: new Date().toISOString(),
        }))
      )
      setGlobalStatus('Một pipeline vừa hoàn tất.')
    })

    socket.on('pipeline_stopped', ({ pipelineId, results }) => {
      setPipelines((previous) =>
        updatePipeline(previous, pipelineId, (pipeline) => ({
          ...pipeline,
          status: 'stopped',
          reviewStep: null,
          statusMessage: 'Pipeline đã dừng. Bạn có thể xuất kết quả đã hoàn thành.',
          steps: normalizeResults(results),
          logs: [...pipeline.logs, createLogEntry('Pipeline đã dừng.')],
          finishedAt: new Date().toISOString(),
        }))
      )
      setGlobalStatus('Một pipeline đã dừng.')
    })

    socket.on('pipeline_failed', ({ pipelineId, error }) => {
      const message = getCompactMessage(error || 'Pipeline gặp lỗi.')
      setPipelines((previous) =>
        updatePipeline(previous, pipelineId, (pipeline) => ({
          ...pipeline,
          status: 'error',
          errorStep: pipeline.currentStep,
          reviewStep: null,
          statusMessage: message,
          logs: [...pipeline.logs, createLogEntry(`LỖI: ${message}`)],
          finishedAt: new Date().toISOString(),
        }))
      )
      setGlobalStatus(message)
    })

    socket.on('error', (payload) => {
      const pipelineId = payload?.pipelineId
      const stepNumber = payload?.stepNumber ?? 0
      const message = getCompactMessage(payload?.error || 'Có lỗi xảy ra.')

      if (!pipelineId) {
        setGlobalStatus(message)
        if (message.toLowerCase().includes('browser')) {
          setPhase('init')
        }
        return
      }

      setPipelines((previous) =>
        updatePipeline(previous, pipelineId, (pipeline) => ({
          ...pipeline,
          status: 'error',
          errorStep: stepNumber,
          currentStep: stepNumber > 0 ? stepNumber : pipeline.currentStep,
          statusMessage: message,
          logs: [
            ...pipeline.logs,
            createLogEntry(stepNumber > 0 ? `LỖI ở bước ${stepNumber}: ${message}` : `LỖI: ${message}`),
          ],
        }))
      )
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  const handleConnectBrowser = () => {
    if (!socketRef.current) {
      setGlobalStatus('Socket chưa sẵn sàng.')
      return
    }

    setPhase('login')
    setGlobalStatus('Đang mở trình duyệt. Vui lòng đăng nhập Claude.ai...')
    socketRef.current.emit('init_browser')
  }

  const handleStartPipeline = (config) => {
    if (!socketRef.current) {
      setGlobalStatus('Socket chưa sẵn sàng.')
      return
    }

    if (!canStartPipeline) {
      setGlobalStatus(`Đang đạt giới hạn ${maxActivePipelines} pipeline chạy song song.`)
      return
    }

    setGlobalStatus('Đang tạo pipeline mới...')
    socketRef.current.emit('start_pipeline', config)
  }

  const handleClearLogs = (pipelineId) => {
    setPipelines((previous) =>
      updatePipeline(previous, pipelineId, (pipeline) => ({
        ...pipeline,
        logs: [createLogEntry('Đã xóa terminal.', new Date().toISOString())],
      }))
    )
  }

  const handleReviewContinue = (pipelineId) => {
    socketRef.current?.emit('review_continue', { pipelineId })
    clearReviewState(pipelineId)
  }

  const handleReviewContinueAuto = (pipelineId) => {
    socketRef.current?.emit('review_continue_auto', { pipelineId })
    clearReviewState(pipelineId, 'Đã chuyển sang chế độ Auto. Pipeline sẽ chạy tiếp không dừng kiểm tra.')
  }

  const handleReviewEdit = (pipelineId, message) => {
    socketRef.current?.emit('review_edit', { pipelineId, message })
    clearReviewState(pipelineId)
  }

  const handleReviewRedo = (pipelineId) => {
    socketRef.current?.emit('review_redo', { pipelineId })
    clearReviewState(pipelineId)
  }

  const handleStopPipeline = (pipelineId) => {
    socketRef.current?.emit('stop_pipeline', { pipelineId })
    setPipelines((previous) =>
      updatePipeline(previous, pipelineId, (pipeline) => ({
        ...pipeline,
        statusMessage: 'Đang dừng pipeline...',
        logs: [...pipeline.logs, createLogEntry('Client đã yêu cầu dừng pipeline.')],
      }))
    )
  }

  const clearReviewState = (pipelineId, statusMessage) => {
    setPipelines((previous) =>
      updatePipeline(previous, pipelineId, (pipeline) => ({
        ...pipeline,
        reviewStep: null,
        status: 'running',
        statusMessage: statusMessage || pipeline.statusMessage,
      }))
    )
  }

  const handleToggleView = (pipelineId) => {
    setPipelines((previous) =>
      updatePipeline(previous, pipelineId, (pipeline) => ({
        ...pipeline,
        showResults: !pipeline.showResults,
      }))
    )
  }

  const handleOpenNewPipeline = () => {
    if (!canStartPipeline) {
      setGlobalStatus(`Đang đạt giới hạn ${maxActivePipelines} pipeline chạy song song.`)
      return
    }

    setShowConfig(true)
    setPhase('workspace')
  }

  const handleRefreshUsage = () => {
    if (!socketRef.current) {
      setUsageError('Socket chưa sẵn sàng.')
      return
    }

    socketRef.current.emit('request_usage')
  }

  const handleCreateProfile = (label) => {
    if (activePipelineCount > 0) {
      setProfileError('Hãy dừng các pipeline đang chạy trước khi thêm ô tài khoản Claude.')
      return
    }

    socketRef.current?.emit('create_profile', { label })
  }

  const handleSwitchProfile = (profileId) => {
    if (activePipelineCount > 0) {
      setProfileError('Hãy dừng các pipeline đang chạy trước khi đổi ô tài khoản Claude.')
      return
    }

    socketRef.current?.emit('switch_profile', { profileId })
  }

  const handleRenameProfile = (profileId, label) => {
    socketRef.current?.emit('rename_profile', { profileId, label })
  }

  const handleDeleteProfile = (profileId) => {
    if (activePipelineCount > 0) {
      setProfileError('Hãy dừng các pipeline đang chạy trước khi xóa ô tài khoản Claude.')
      return
    }

    const profile = profilesState.profiles.find((candidate) => candidate.id === profileId)
    const confirmed = window.confirm(`Xóa ô tài khoản Claude "${profile?.label || profileId}"?`)

    if (!confirmed) {
      return
    }

    socketRef.current?.emit('delete_profile', { profileId })
  }

  return (
    <div className={styles.appShell}>
      <div className={`${styles.orb} ${styles.orbTopLeft}`} />
      <div className={`${styles.orb} ${styles.orbCenterRight}`} />
      <div className={`${styles.orb} ${styles.orbBottomLeft}`} />

      <StatusBar
        message={selectedPipeline?.statusMessage || globalStatus}
        processing={activePipelineCount > 0 || phase === 'login'}
      />

      <main className={styles.main}>
        {phase === 'init' && (
          <section className={styles.centerStage}>
            <div className={styles.heroCard}>
              <p className={styles.eyebrow}>Tự động hóa Claude</p>
              <h1 className={styles.heroTitle}>Kết nối browser để bắt đầu pipeline</h1>
              <p className={styles.heroText}>
                App sẽ mở Chromium ở chế độ lưu session để bạn đăng nhập Claude.ai, sau đó
                chọn project và chạy tối đa 2 pipeline song song.
              </p>
              <p className={styles.heroHint}>
                Nếu trình duyệt bị đóng hoặc Socket.IO ngắt kết nối, chỉ cần bấm lại
                Kết nối trình duyệt để thử lại.
              </p>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleConnectBrowser}
              >
                Kết nối trình duyệt
              </button>
            </div>
          </section>
        )}

        {phase === 'login' && (
          <section className={styles.centerStage}>
            <div className={styles.waitCard}>
              <div className={styles.spinner} />
              <h2 className={styles.waitTitle}>Đang chờ bạn đăng nhập Claude.ai...</h2>
              <p className={styles.waitText}>
                Hãy hoàn tất đăng nhập trong cửa sổ Chromium vừa mở. Danh sách
                project sẽ tự động hiện ở bước kế tiếp.
              </p>
            </div>
          </section>
        )}

        {phase === 'config' && (
          <section className={styles.configStage}>
            <AccountPanel
              profilesState={profilesState}
              error={profileError}
              activePipelineCount={activePipelineCount}
              onCreate={handleCreateProfile}
              onSwitch={handleSwitchProfile}
              onRename={handleRenameProfile}
              onDelete={handleDeleteProfile}
            />
            <UsagePanel
              usage={usageSnapshot}
              error={usageError}
              onRefresh={handleRefreshUsage}
            />
            <ConfigPanel projects={projects} onStart={handleStartPipeline} />
          </section>
        )}

        {phase === 'workspace' && (
          <section className={styles.workspaceLayout}>
            <aside className={styles.pipelineQueue}>
              <div className={styles.queueHeader}>
                <div>
                  <p className={styles.eyebrow}>Không gian chạy</p>
                  <h2>Hàng pipeline</h2>
                </div>
                <span className={styles.capacityBadge}>
                  {activePipelineCount}/{maxActivePipelines}
                </span>
              </div>

              <button
                type="button"
                className={styles.newPipelineButton}
                onClick={handleOpenNewPipeline}
                disabled={!canStartPipeline}
              >
                <Plus size={16} />
                <span>Pipeline mới</span>
              </button>

              <div className={styles.sidebarCompactGrid}>
                <AccountCompactPanel profilesState={profilesState} error={profileError} />
                <UsageCompactPanel
                  usage={usageSnapshot}
                  error={usageError}
                  onRefresh={handleRefreshUsage}
                />
              </div>

              <div className={styles.pipelineList}>
                {pipelines.length === 0 ? (
                  <div className={styles.emptyPipelineList}>
                    <ListPlus size={18} />
                    <span>Chưa có pipeline nào.</span>
                  </div>
                ) : (
                  pipelines.map((pipeline) => (
                    <button
                      key={pipeline.id}
                      type="button"
                      className={`${styles.pipelineCard} ${
                        pipeline.id === selectedPipeline?.id ? styles.pipelineCardActive : ''
                      }`}
                      onClick={() => {
                        setSelectedPipelineId(pipeline.id)
                        setShowConfig(false)
                      }}
                    >
                      <span className={styles.pipelineName}>{getPipelineTitle(pipeline)}</span>
                      <span className={`${styles.pipelineStatus} ${styles[pipeline.status] || ''}`}>
                        {getPipelineStatusLabel(pipeline.status)}
                      </span>
                      <span className={styles.pipelineMeta}>
                        Bước {pipeline.currentStep || 0}/{getPipelineStepDefinitions(pipeline).length}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </aside>

            <div className={styles.workspaceDetail}>
              {showConfig ? (
                <div className={styles.configPanelWrap}>
                  <div className={styles.detailHeader}>
                    <div>
                      <p className={styles.eyebrow}>Lượt chạy mới</p>
                      <h2>Tạo pipeline mới</h2>
                    </div>
                    <span className={styles.detailHint}>
                      Đang chạy {activePipelineCount}/{maxActivePipelines}
                    </span>
                  </div>
                  <ConfigPanel projects={projects} onStart={handleStartPipeline} />
                </div>
              ) : selectedPipeline ? (
                <>
                  <div className={styles.detailHeader}>
                    <div>
                      <p className={styles.eyebrow}>Pipeline đang chọn</p>
                      <h2>{getPipelineTitle(selectedPipeline)}</h2>
                    </div>
                    <div className={styles.detailActions}>
                      {isActivePipeline(selectedPipeline) && (
                        <button
                          type="button"
                          className={styles.stopButton}
                          onClick={() => handleStopPipeline(selectedPipeline.id)}
                        >
                          <Square size={14} />
                          <span>Dừng</span>
                        </button>
                      )}
                      {sortedSteps.length > 0 && (
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => handleToggleView(selectedPipeline.id)}
                        >
                          {selectedPipeline.showResults ? 'Hiện Terminal' : 'Hiện kết quả'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className={styles.progressRail}>
                    <StepProgress
                      steps={selectedStepDefinitions}
                      completedSteps={sortedSteps}
                      currentStep={selectedPipeline.currentStep}
                      errorStep={selectedPipeline.errorStep}
                      variant="horizontal"
                    />
                  </div>

                  <div className={styles.resultsPane}>
                    {selectedPipeline.reviewStep && (
                      <ReviewPanel
                        stepNumber={selectedPipeline.reviewStep.stepNumber}
                        stepName={selectedPipeline.reviewStep.stepName}
                        result={
                          sortedSteps.find(
                            (step) => step.stepNumber === selectedPipeline.reviewStep.stepNumber
                          )?.result || ''
                        }
                        onContinue={() => handleReviewContinue(selectedPipeline.id)}
                        onContinueAuto={() => handleReviewContinueAuto(selectedPipeline.id)}
                        onEdit={(message) => handleReviewEdit(selectedPipeline.id, message)}
                        onRedo={() => handleReviewRedo(selectedPipeline.id)}
                        onStop={() => handleStopPipeline(selectedPipeline.id)}
                      />
                    )}

                    {!selectedPipeline.showResults ? (
                      <TerminalLog
                        logs={selectedPipeline.logs}
                        onClear={() => handleClearLogs(selectedPipeline.id)}
                        currentStep={selectedPipeline.currentStep}
                        totalSteps={selectedStepDefinitions.length}
                      />
                    ) : (
                      <div className={styles.resultList}>
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
                </>
              ) : (
                <div className={styles.emptyState}>
                  <div className={styles.spinnerSmall} />
                  <span>Chọn hoặc tạo pipeline để bắt đầu.</span>
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {selectedPipeline && TERMINAL_STATUSES.has(selectedPipeline.status) && sortedSteps.length > 0 && (
        <div className={styles.exportDock}>
          <ExportButton steps={sortedSteps} chatName={selectedPipeline.config?.chatName} />
        </div>
      )}
    </div>
  )
}

export default App
