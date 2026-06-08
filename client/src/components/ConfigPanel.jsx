import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Pencil } from 'lucide-react'

const MODEL_OPTIONS = ['Sonnet 4.6', 'Opus 4.6', 'Haiku 4.5']

const sectionClass =
  'rounded-2xl border border-[#2d3148] bg-[#1a1a2e] p-5 shadow-2xl shadow-black/25 transition duration-200'

const fieldClass =
  'mt-3 w-full rounded-xl border border-[#5d527b] bg-[#171227] p-3 text-white outline-none transition duration-200 placeholder:text-gray-500 focus:border-[#c4a1ff] focus:shadow-[0_0_15px_rgba(196,161,255,0.18)] focus:ring-0'

const glowButtonClass =
  'transition duration-200 hover:-translate-y-0.5 hover:border-[#c4a1ff] hover:bg-[#c4a1ff]/15 hover:text-[#eadcff] hover:shadow-[0_0_18px_rgba(196,161,255,0.24)] focus-visible:border-[#c4a1ff] focus-visible:shadow-[0_0_18px_rgba(196,161,255,0.24)]'

const dropdownButtonClass =
  `mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-[#7d6aa5] bg-[#171227]/90 p-3 text-left text-white outline-none ${glowButtonClass}`

const dropdownPanelClass =
  'absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 max-h-72 overflow-auto rounded-xl border border-[#8b76b8] bg-[#171227]/95 p-1 shadow-[0_24px_70px_rgba(0,0,0,0.48),0_0_30px_rgba(196,161,255,0.18)] backdrop-blur-xl'

const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  (window.location.port === '5173' ? 'http://localhost:3001' : window.location.origin)

function PrettyDropdown({ value, options, placeholder, onChange, disabled = false, className = '' }) {
  const [open, setOpen] = useState(false)
  const selectedOption = options.find((option) => option.value === value)

  return (
    <div
      className={`relative ${className}`}
      tabIndex={-1}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false)
        }
      }}
    >
      <button
        type="button"
        className={dropdownButtonClass}
        onClick={() => {
          if (!disabled) {
            setOpen((previous) => !previous)
          }
        }}
        disabled={disabled}
      >
        <span className={selectedOption ? 'text-white' : 'text-gray-400'}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-[#d8c7ff] transition ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className={dropdownPanelClass}>
          {options.length === 0 ? (
            <div className="rounded-lg px-3 py-2 text-sm text-gray-400">Chưa có lựa chọn.</div>
          ) : (
            options.map((option) => {
              const active = option.value === value

              return (
                <button
                  key={option.value}
                  type="button"
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                    active
                      ? 'bg-[#c4a1ff]/18 text-[#eadcff]'
                      : 'text-gray-200 hover:bg-[#c4a1ff]/12 hover:text-white'
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{option.label}</span>
                    {option.description && (
                      <span className="mt-0.5 block truncate text-xs text-gray-400">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {active && <Check size={16} className="shrink-0 text-[#c4a1ff]" />}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

function createEmptyStep(stepNumber) {
  return {
    stepNumber,
    name: `Bước ${stepNumber}`,
    prompt: '',
  }
}

function getDefaultStepName(stepNumber) {
  return `Bước ${stepNumber}`
}

function getStepDisplayName(step, index) {
  const defaultName = getDefaultStepName(index + 1)
  const name = String(step?.name || '').trim()

  return name && name !== defaultName ? name : ''
}

function createBlankTemplate() {
  return {
    id: '',
    name: 'Template mới',
    description: '',
    modelName: MODEL_OPTIONS[0],
    adaptiveThinking: true,
    semiAuto: false,
    isDefault: false,
    steps: [createEmptyStep(1)],
  }
}

function normalizeSteps(steps) {
  return (Array.isArray(steps) ? steps : [])
    .map((step, index) => ({
      stepNumber: index + 1,
      name: String(step.name || `Bước ${index + 1}`),
      prompt: String(step.prompt || ''),
    }))
}

function ConfigPanel({
  profiles = [],
  defaultProfileId = '',
  profileSessions = {},
  projectsByProfile = {},
  onConnectProfile,
  onStart,
}) {
  const [selectedProfileId, setSelectedProfileId] = useState(defaultProfileId)
  const [projectUrl, setProjectUrl] = useState('')
  const [templates, setTemplates] = useState([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [templateDraft, setTemplateDraft] = useState(createBlankTemplate)
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const [chatName, setChatName] = useState('')
  const [originalScript, setOriginalScript] = useState('')
  const [templateStatus, setTemplateStatus] = useState('')
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [isEditingTemplateName, setIsEditingTemplateName] = useState(false)

  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ||
    profiles.find((profile) => profile.id === defaultProfileId) ||
    profiles[0]
  const effectiveProfileId = selectedProfile?.id || ''
  const selectedSession = profileSessions[effectiveProfileId] || {}
  const projects = projectsByProfile[effectiveProfileId] || selectedSession.projects || []
  const effectiveProjectUrl = projectUrl || (projects.length === 1 ? projects[0].url : '')
  const steps = templateDraft.steps || []
  const activeStep = steps[activeStepIndex] || steps[0]
  const hasInvalidStep = steps.some((step) => !step.name.trim() || !step.prompt.trim())
  const isDisabled =
    !effectiveProfileId ||
    !effectiveProjectUrl ||
    !originalScript.trim() ||
    steps.length === 0 ||
    hasInvalidStep

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId),
    [selectedTemplateId, templates]
  )
  const projectOptions = projects.map((project) => ({
    value: project.url,
    label: project.name,
  }))
  const profileOptions = profiles.map((profile) => {
    const session = profileSessions[profile.id] || {}
    let statusLabel = 'Chưa kết nối'

    if (session.usageBlock) {
      statusLabel = session.usageBlock.resetText
        ? `Hết usage · ${session.usageBlock.resetText}`
        : `Hết usage · ${session.usageBlock.usedPercent}%`
    } else if (session.responseBusy) {
      statusLabel = session.waitingResponses > 0
        ? `Đang tạo phản hồi · ${session.waitingResponses} pipeline chờ`
        : 'Đang tạo phản hồi'
    } else if (session.connected) {
      statusLabel = 'Đã kết nối'
    } else if (session.status === 'connecting') {
      statusLabel = 'Đang kết nối'
    }

    return {
      value: profile.id,
      label: profile.label,
      description: statusLabel,
    }
  })
  const templateOptions = templates.map((template) => ({
    value: template.id,
    label: template.name,
  }))

  const applyTemplate = (template) => {
    const nextTemplate = {
      ...template,
      steps: normalizeSteps(template.steps),
    }

    setTemplateDraft(nextTemplate)
    setSelectedTemplateId(nextTemplate.id || '')
    setActiveStepIndex(0)
    setTemplateStatus('')
    setIsEditingTemplateName(false)
  }

  const loadTemplates = () => {
    fetch(`${API_BASE_URL}/pipeline-templates`)
      .then((response) => response.json())
      .then((payload) => {
        if (!Array.isArray(payload?.templates)) {
          return
        }

        setTemplates(payload.templates)
        const nextTemplate =
          payload.templates.find((template) => template.id === selectedTemplateId) ||
          payload.templates[0]

        if (nextTemplate) {
          applyTemplate(nextTemplate)
        }
      })
      .catch(() => {
        setTemplateStatus('Chưa tải được template từ server.')
      })
  }

  useEffect(() => {
    loadTemplates()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateTemplateDraft = (patch) => {
    setTemplateDraft((previous) => ({
      ...previous,
      ...patch,
    }))
  }

  const updateActiveStep = (patch) => {
    setTemplateDraft((previous) => {
      const nextSteps = normalizeSteps(previous.steps)
      nextSteps[activeStepIndex] = {
        ...nextSteps[activeStepIndex],
        ...patch,
      }

      return {
        ...previous,
        steps: normalizeSteps(nextSteps),
      }
    })
  }

  const handleAddStep = () => {
    setTemplateDraft((previous) => {
      const nextSteps = normalizeSteps(previous.steps)
      nextSteps.push(createEmptyStep(nextSteps.length + 1))

      return {
        ...previous,
        steps: nextSteps,
      }
    })
    setActiveStepIndex(steps.length)
  }

  const handleRemoveStep = () => {
    if (steps.length <= 1) {
      setTemplateStatus('Template cần ít nhất 1 bước.')
      return
    }

    setTemplateDraft((previous) => {
      const nextSteps = normalizeSteps(previous.steps).filter((_, index) => index !== activeStepIndex)

      return {
        ...previous,
        steps: normalizeSteps(nextSteps),
      }
    })
    setActiveStepIndex((previous) => Math.max(0, previous - 1))
  }

  const handleCreateTemplate = () => {
    applyTemplate(createBlankTemplate())
    setIsEditingTemplateName(true)
    setTemplateStatus('Đang tạo template mới. Nhập nội dung rồi bấm Lưu template.')
  }

  const createTemplatePayload = () => ({
      ...templateDraft,
      name: templateDraft.name.trim(),
      description: templateDraft.description.trim(),
      modelName: templateDraft.modelName,
      adaptiveThinking: templateDraft.adaptiveThinking !== false,
      semiAuto: Boolean(templateDraft.semiAuto),
      steps: normalizeSteps(templateDraft.steps).map((step) => ({
        ...step,
        name: step.name.trim(),
        prompt: step.prompt.trim(),
      })),
    })

  const saveTemplateDraft = async () => {
    const payload = createTemplatePayload()

    if (!payload.name || payload.steps.some((step) => !step.name || !step.prompt)) {
      throw new Error('Hãy nhập tên template, tên bước và prompt trước khi lưu.')
    }

    const response = await fetch(`${API_BASE_URL}/pipeline-templates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const result = await response.json()

    if (!response.ok) {
      throw new Error(result?.error || 'Không lưu được template.')
    }

    setTemplates(result.templates || [])
    applyTemplate(result.template)

    return result.template
  }

  const handleSaveTemplate = async () => {
    try {
      setIsSavingTemplate(true)
      await saveTemplateDraft()
      setTemplateStatus('Đã lưu template.')
    } catch (error) {
      setTemplateStatus(error.message)
    } finally {
      setIsSavingTemplate(false)
    }
  }

  const handleDeleteTemplate = async () => {
    if (!selectedTemplateId || selectedTemplate?.isDefault) {
      setTemplateStatus('Không thể xóa template mặc định của Kiệt.')
      return
    }

    const confirmed = window.confirm(`Xóa template "${templateDraft.name}"?`)

    if (!confirmed) {
      return
    }

    try {
      const response = await fetch(`${API_BASE_URL}/pipeline-templates/${selectedTemplateId}`, {
        method: 'DELETE',
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result?.error || 'Không xóa được template.')
      }

      setTemplates(result.templates || [])
      if (result.templates?.[0]) {
        applyTemplate(result.templates[0])
      } else {
        applyTemplate(createBlankTemplate())
      }
      setTemplateStatus('Đã xóa template.')
    } catch (error) {
      setTemplateStatus(error.message)
    }
  }

  const handleSubmit = async () => {
    if (isDisabled) {
      return
    }

    let savedTemplate = null

    try {
      setIsSavingTemplate(true)
      setTemplateStatus('Đang lưu template trước khi chạy...')
      savedTemplate = await saveTemplateDraft()
      setTemplateStatus('Đã lưu template. Đang bắt đầu pipeline...')
    } catch (error) {
      setTemplateStatus(error.message)
      setIsSavingTemplate(false)
      return
    }

    const promptSteps = normalizeSteps(steps)
      .map((step) => ({
        stepNumber: step.stepNumber,
        name: step.name.trim(),
        prompt: step.prompt.trim(),
      }))
      .filter((step) => step.name && step.prompt)

    onStart({
      profileId: effectiveProfileId,
      profileLabel: selectedProfile?.label || '',
      templateId: savedTemplate?.id || selectedTemplateId || null,
      templateName: savedTemplate?.name || templateDraft.name.trim(),
      originalScript: originalScript.trim(),
      projectUrl: effectiveProjectUrl,
      modelName: savedTemplate?.modelName || templateDraft.modelName,
      adaptiveThinking: savedTemplate ? savedTemplate.adaptiveThinking !== false : templateDraft.adaptiveThinking !== false,
      chatName: chatName.trim() || 'Phiên ScriptForge',
      semiAuto: savedTemplate ? Boolean(savedTemplate.semiAuto) : Boolean(templateDraft.semiAuto),
      promptSteps: savedTemplate?.steps || promptSteps,
      customPromptSteps: [],
      stepPromptOverrides: {},
    })
    setIsSavingTemplate(false)
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Tài khoản chạy pipeline</h2>
          <p className="text-sm text-gray-400">
            Pipeline luôn gắn với tài khoản này, kể cả khi bạn chuyển sang tài khoản khác.
          </p>
        </div>

        <PrettyDropdown
          value={effectiveProfileId}
          options={profileOptions}
          placeholder="Chọn tài khoản Claude..."
          onChange={(profileId) => {
            setSelectedProfileId(profileId)
            setProjectUrl('')
          }}
        />

        {!selectedSession.connected && (
          <button
            type="button"
            className={`mt-3 w-full rounded-xl border border-[#c4a1ff]/45 bg-[#c4a1ff]/12 p-3 text-sm font-bold text-[#eadcff] ${glowButtonClass}`}
            onClick={() => onConnectProfile?.(effectiveProfileId)}
            disabled={!effectiveProfileId || selectedSession.status === 'connecting'}
          >
            {selectedSession.status === 'connecting'
              ? 'Đang kết nối tài khoản...'
              : 'Kết nối tài khoản này'}
          </button>
        )}
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Chọn project</h2>
          <p className="text-sm text-gray-400">Chọn Claude project nơi pipeline sẽ chạy.</p>
        </div>

        <PrettyDropdown
          value={effectiveProjectUrl}
          options={projectOptions}
          placeholder="Chọn project..."
          onChange={setProjectUrl}
          disabled={!selectedSession.connected}
        />
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Pipeline template</h2>
        </div>

        <div className="flex items-start gap-2">
          <PrettyDropdown
            className="min-w-0 flex-1"
            value={selectedTemplateId}
            options={templateOptions}
            placeholder="Template mới chưa lưu"
            onChange={(templateId) => {
              const template = templates.find((candidate) => candidate.id === templateId)
              if (template) {
                applyTemplate(template)
              }
            }}
          />

          <button
            type="button"
            onClick={() => setIsEditingTemplateName((previous) => !previous)}
            className={`mt-3 flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-xl border border-[#7d6aa5] bg-[#171227]/90 text-[#d8c7ff] outline-none ${glowButtonClass}`}
            title="Sửa tên template"
            aria-label="Sửa tên template"
          >
            <Pencil size={18} />
          </button>
        </div>

        {isEditingTemplateName && (
          <input
            className={fieldClass}
            type="text"
            value={templateDraft.name}
            onChange={(event) => updateTemplateDraft({ name: event.target.value })}
            placeholder="Tên template..."
          />
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCreateTemplate}
            className={`rounded-lg border border-[#c4a1ff]/40 bg-[#c4a1ff]/10 px-3 py-2 text-xs font-bold text-[#c4a1ff] ${glowButtonClass}`}
          >
            + Template mới
          </button>
          <button
            type="button"
            onClick={handleSaveTemplate}
            disabled={isSavingTemplate}
            className={`rounded-lg border border-[#c4a1ff]/50 bg-[#c4a1ff]/20 px-3 py-2 text-xs font-bold text-[#eadcff] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:shadow-none ${glowButtonClass}`}
          >
            {isSavingTemplate ? 'Đang lưu...' : 'Lưu template'}
          </button>
          <button
            type="button"
            onClick={handleDeleteTemplate}
            disabled={selectedTemplate?.isDefault || isSavingTemplate}
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300 transition duration-200 hover:-translate-y-0.5 hover:border-red-300 hover:bg-red-500/15 hover:text-red-200 hover:shadow-[0_0_18px_rgba(248,113,113,0.22)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            Xóa template
          </button>
        </div>

        {templateStatus && <p className="mt-3 text-xs text-[#e7dbff]">{templateStatus}</p>}
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Model và chế độ chạy</h2>
          <p className="text-sm text-gray-400">
            Các lựa chọn này được lưu theo template.
          </p>
        </div>

        <div className="mt-3 flex gap-3">
          {MODEL_OPTIONS.map((option) => {
            const active = templateDraft.modelName === option

            return (
              <button
                key={option}
                type="button"
                onClick={() => updateTemplateDraft({ modelName: option })}
                className={`flex-1 cursor-pointer rounded-xl border p-3 ${glowButtonClass} ${
                  active
                    ? 'border-[#c4a1ff] bg-[#c4a1ff]/15 text-[#c4a1ff] shadow-[0_0_18px_rgba(196,161,255,0.24)]'
                    : 'border-[#5d527b] bg-[#171227] text-gray-300'
                }`}
              >
                {option}
              </button>
            )
          })}
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="md:pr-5">
            <p className="text-sm font-bold text-white">Adaptive Thinking</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => updateTemplateDraft({ adaptiveThinking: true })}
                className={`flex-1 rounded-xl border p-3 ${glowButtonClass} ${
                  templateDraft.adaptiveThinking !== false
                    ? 'border-[#c4a1ff] bg-[#c4a1ff]/15 text-[#c4a1ff]'
                    : 'border-[#5d527b] bg-[#171227] text-gray-300'
                }`}
              >
                Bật
              </button>
              <button
                type="button"
                onClick={() => updateTemplateDraft({ adaptiveThinking: false })}
                className={`flex-1 rounded-xl border p-3 ${glowButtonClass} ${
                  templateDraft.adaptiveThinking === false
                    ? 'border-[#c4a1ff] bg-[#c4a1ff]/15 text-[#c4a1ff]'
                    : 'border-[#5d527b] bg-[#171227] text-gray-300'
                }`}
              >
                Tắt
              </button>
            </div>
          </div>

          <div className="border-t border-[#5d527b]/55 pt-5 md:border-l md:border-t-0 md:pl-5 md:pt-0">
            <p className="text-sm font-bold text-white">Chế độ pipeline</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => updateTemplateDraft({ semiAuto: false })}
                className={`flex-1 rounded-xl border p-3 ${glowButtonClass} ${
                  !templateDraft.semiAuto
                    ? 'border-[#c4a1ff] bg-[#c4a1ff]/15 text-[#c4a1ff]'
                    : 'border-[#5d527b] bg-[#171227] text-gray-300'
                }`}
              >
                Auto
              </button>
              <button
                type="button"
                onClick={() => updateTemplateDraft({ semiAuto: true })}
                className={`flex-1 rounded-xl border p-3 ${glowButtonClass} ${
                  templateDraft.semiAuto
                    ? 'border-[#c4a1ff] bg-[#c4a1ff]/15 text-[#c4a1ff]'
                    : 'border-[#5d527b] bg-[#171227] text-gray-300'
                }`}
              >
                Semi-Auto
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Các bước trong template</h2>
          <p className="text-sm text-gray-400">
            Tạo bước, đặt tên bước, rồi paste prompt vào. Kịch bản gốc luôn được tự gửi ở bước 1.
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleAddStep}
            className={`rounded-lg border border-[#c4a1ff]/40 bg-[#c4a1ff]/10 px-3 py-2 text-xs font-bold text-[#c4a1ff] ${glowButtonClass}`}
          >
            + Thêm bước
          </button>
          <button
            type="button"
            onClick={handleRemoveStep}
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300 transition duration-200 hover:-translate-y-0.5 hover:border-red-300 hover:bg-red-500/15 hover:text-red-200 hover:shadow-[0_0_18px_rgba(248,113,113,0.22)]"
          >
            Xóa bước đang chọn
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {steps.map((step, index) => {
            const active = activeStepIndex === index
            const invalid = !step.name.trim() || !step.prompt.trim()

            return (
              <button
                key={`${step.stepNumber}-${index}`}
                type="button"
                onClick={() => setActiveStepIndex(index)}
                className={`min-h-[52px] rounded-lg border p-2 text-left text-xs ${glowButtonClass} ${
                  active
                    ? 'border-[#c4a1ff] bg-[#c4a1ff]/15 text-[#c4a1ff]'
                    : 'border-[#5d527b] bg-[#171227] text-gray-300 hover:border-[#c4a1ff]/50'
                }`}
              >
                <span className="block font-bold">Bước {index + 1}</span>
                {getStepDisplayName(step, index) && (
                  <span className="line-clamp-1 text-gray-300">
                    {getStepDisplayName(step, index)}
                  </span>
                )}
                {invalid && <span className="mt-1 block text-[10px] text-[#eab308]">thiếu nội dung</span>}
              </button>
            )
          })}
        </div>

        {activeStep && (
          <>
            <input
              className={fieldClass}
              type="text"
              value={activeStep.name}
              onChange={(event) => updateActiveStep({ name: event.target.value })}
              placeholder="Tên bước..."
            />

            <textarea
              className={`${fieldClass} min-h-[220px] resize-y font-mono text-sm`}
              value={activeStep.prompt}
              onChange={(event) => updateActiveStep({ prompt: event.target.value })}
              placeholder={`Prompt cho bước ${activeStepIndex + 1}...`}
            />
          </>
        )}
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Tên đoạn chat</h2>
          <p className="text-sm text-gray-400">Đặt tên cho cuộc chat mới trong project đã chọn.</p>
        </div>

        <input
          className={fieldClass}
          type="text"
          value={chatName}
          onChange={(event) => setChatName(event.target.value)}
          placeholder="Nhập tên cho đoạn chat..."
        />
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Kịch bản gốc</h2>
          <p className="text-sm text-gray-400">
            Dán toàn bộ kịch bản gốc tại đây. App sẽ tự đưa nội dung này vào bước 1 của template.
          </p>
        </div>

        <textarea
          className={`${fieldClass} min-h-[240px] resize-y`}
          value={originalScript}
          onChange={(event) => setOriginalScript(event.target.value)}
          placeholder="Dán kịch bản gốc vào đây..."
        />
      </div>

      <button
        type="button"
        className={`w-full rounded-xl p-4 text-lg font-bold transition duration-200 ${
          isDisabled || isSavingTemplate
            ? 'cursor-not-allowed bg-gray-700/70 text-gray-400'
            : 'bg-gradient-to-r from-[#f3e8ff] via-[#c4a1ff] to-[#9f7aea] text-[#2f174a] shadow-[0_4px_20px_rgba(196,161,255,0.34)] hover:scale-[1.02] hover:brightness-110'
        }`}
        disabled={isDisabled || isSavingTemplate}
        onClick={handleSubmit}
      >
        {isSavingTemplate ? 'Đang lưu template...' : 'Bắt đầu pipeline'}
      </button>
    </section>
  )
}

export default ConfigPanel
