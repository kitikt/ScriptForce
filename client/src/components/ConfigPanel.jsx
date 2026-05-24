import { useEffect, useState } from 'react'

const MODEL_OPTIONS = [
  'Sonnet 4.6',
  'Opus 4.6',
  'Haiku 4.5',
]

const PROMPT_STEPS = [
  { stepNumber: 1, name: 'Phân tích kịch bản gốc' },
  { stepNumber: 2, name: 'Viết outline 3 phần' },
  { stepNumber: 3, name: 'Đánh giá và cải thiện outline' },
  { stepNumber: 4, name: 'Bước 5: Viết Part 1' },
  { stepNumber: 5, name: 'Bước 6: Viết Part 2' },
  { stepNumber: 6, name: 'Bước 7: Viết Part 3' },
  { stepNumber: 7, name: 'Bước 7a: Ghép và kiểm tra' },
  { stepNumber: 8, name: 'Bước 8: Sửa và tạo file hoàn chỉnh' },
]

const sectionClass =
  'rounded-2xl border border-[#2d3148] bg-[#1a1a2e] p-5 shadow-2xl shadow-black/25 transition duration-200'

const fieldClass =
  'mt-3 w-full rounded-xl border border-[#5d527b] bg-[#171227] p-3 text-white outline-none transition duration-200 placeholder:text-gray-500 focus:border-[#c4a1ff] focus:shadow-[0_0_15px_rgba(196,161,255,0.18)] focus:ring-0'

const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  (window.location.port === '5173' ? 'http://localhost:3001' : window.location.origin)

function ConfigPanel({ projects, onStart }) {
  const [projectUrl, setProjectUrl] = useState('')
  const [modelName, setModelName] = useState(MODEL_OPTIONS[0])
  const [adaptiveThinking, setAdaptiveThinking] = useState(true)
  const [chatName, setChatName] = useState('')
  const [semiAuto, setSemiAuto] = useState(false)
  const [originalScript, setOriginalScript] = useState('')
  const [activePromptStep, setActivePromptStep] = useState(1)
  const [stepPromptOverrides, setStepPromptOverrides] = useState({})
  const [basePromptTemplates, setBasePromptTemplates] = useState(PROMPT_STEPS)
  const [customPromptSteps, setCustomPromptSteps] = useState([])

  const promptTemplates = [...basePromptTemplates, ...customPromptSteps]
  const effectiveProjectUrl = projectUrl || (projects.length === 1 ? projects[0].url : '')
  const hasInvalidCustomStep = customPromptSteps.some((step) => {
    const promptValue = stepPromptOverrides[step.stepNumber] ?? step.prompt ?? ''
    return !step.name.trim() || !String(promptValue).trim()
  })
  const isDisabled = !effectiveProjectUrl || !originalScript.trim() || hasInvalidCustomStep
  const activePrompt = promptTemplates.find((step) => step.stepNumber === activePromptStep)
  const isActiveCustomStep = Boolean(activePrompt?.custom)
  const activePromptTemplate = activePrompt?.prompt || ''
  const activePromptValue = Object.prototype.hasOwnProperty.call(stepPromptOverrides, activePromptStep)
    ? stepPromptOverrides[activePromptStep]
    : activePromptTemplate

  useEffect(() => {
    let cancelled = false

    fetch(`${API_BASE_URL}/prompt-templates`)
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled && Array.isArray(payload?.steps)) {
          setBasePromptTemplates(payload.steps)
        }
      })
      .catch(() => {
        // Backend có thể đang tắt khi chỉnh UI. Giữ tên bước fallback.
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = () => {
    if (isDisabled) {
      return
    }

    const sanitizedCustomSteps = customPromptSteps
      .map((step) => ({
        stepNumber: step.stepNumber,
        name: step.name.trim(),
        prompt: String(stepPromptOverrides[step.stepNumber] ?? step.prompt ?? '').trim(),
      }))
      .filter((step) => step.name && step.prompt)

    onStart({
      originalScript: originalScript.trim(),
      projectUrl: effectiveProjectUrl,
      modelName,
      adaptiveThinking,
      chatName: chatName.trim() || 'Phiên ScriptForge',
      semiAuto,
      stepPromptOverrides: Object.fromEntries(
        Object.entries(stepPromptOverrides).filter(([, value]) => value.trim())
      ),
      customPromptSteps: sanitizedCustomSteps,
    })
  }

  const handlePromptOverrideChange = (value) => {
    setStepPromptOverrides((previous) => ({
      ...previous,
      [activePromptStep]: value,
    }))
  }

  const handleAddStep = () => {
    const nextStepNumber = Math.max(...promptTemplates.map((step) => step.stepNumber), 0) + 1
    const newStep = {
      stepNumber: nextStepNumber,
      name: `Bước tùy chỉnh ${nextStepNumber}`,
      prompt: '',
      custom: true,
    }

    setCustomPromptSteps((previous) => [...previous, newStep])
    setStepPromptOverrides((previous) => ({
      ...previous,
      [nextStepNumber]: '',
    }))
    setActivePromptStep(nextStepNumber)
  }

  const handleCustomStepNameChange = (value) => {
    setCustomPromptSteps((previous) =>
      previous.map((step) =>
        step.stepNumber === activePromptStep
          ? {
              ...step,
              name: value,
            }
          : step
      )
    )
  }

  const handleRemoveCustomStep = () => {
    const nextCustomSteps = customPromptSteps.filter(
      (step) => step.stepNumber !== activePromptStep
    )
    setCustomPromptSteps(nextCustomSteps)
    setStepPromptOverrides((previous) => {
      const next = { ...previous }
      delete next[activePromptStep]
      return next
    })
    setActivePromptStep(promptTemplates[0]?.stepNumber || 1)
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Chọn project</h2>
          <p className="text-sm text-gray-400">
            Chọn Claude project nơi pipeline sẽ chạy.
          </p>
        </div>

        <select
          className={`${fieldClass} [color-scheme:dark]`}
          value={effectiveProjectUrl}
          onChange={(event) => setProjectUrl(event.target.value)}
        >
          <option value="" disabled className="bg-[#171227] text-white">
            Chọn project...
          </option>
          {projects.map((project) => (
            <option key={project.url} value={project.url} className="bg-[#171227] text-white">
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Chọn model</h2>
          <p className="text-sm text-gray-400">
            Chọn model phù hợp trước khi gửi prompt đầu tiên.
          </p>
        </div>

        <div className="mt-3 flex gap-3">
          {MODEL_OPTIONS.map((option) => {
            const active = modelName === option

            return (
              <button
                key={option}
                type="button"
                onClick={() => setModelName(option)}
                className={`flex-1 cursor-pointer rounded-xl border p-3 transition duration-200 hover:scale-[1.02] ${
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
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Adaptive Thinking</h2>
          <p className="text-sm text-gray-400">
            Chọn Claude có bật chế độ Adaptive Thinking trong menu model hay không.
          </p>
        </div>

        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={() => setAdaptiveThinking(true)}
            className={`flex-1 cursor-pointer rounded-xl border p-3 transition duration-200 hover:scale-[1.02] ${
              adaptiveThinking
                ? 'border-[#c4a1ff] bg-[#c4a1ff]/15 text-[#c4a1ff] shadow-[0_0_18px_rgba(196,161,255,0.24)]'
                : 'border-[#5d527b] bg-[#171227] text-gray-300'
            }`}
          >
            Bật
          </button>
          <button
            type="button"
            onClick={() => setAdaptiveThinking(false)}
            className={`flex-1 cursor-pointer rounded-xl border p-3 transition duration-200 hover:scale-[1.02] ${
              !adaptiveThinking
                ? 'border-[#c4a1ff] bg-[#c4a1ff]/15 text-[#c4a1ff] shadow-[0_0_18px_rgba(196,161,255,0.24)]'
                : 'border-[#5d527b] bg-[#171227] text-gray-300'
            }`}
          >
            Tắt
          </button>
        </div>
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Tên đoạn chat</h2>
          <p className="text-sm text-gray-400">
            Đặt tên cho cuộc chat mới trong project đã chọn.
          </p>
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
          <h2 className="text-lg font-bold text-white">Chế độ pipeline</h2>
          <p className="text-sm text-gray-400">
            Semi-Auto dừng sau mỗi bước để bạn kiểm tra và chỉnh sửa. Auto chạy liên tục toàn bộ bước.
          </p>
        </div>

        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={() => setSemiAuto(false)}
            className={`flex-1 cursor-pointer rounded-xl border p-3 transition duration-200 hover:scale-[1.02] ${
              !semiAuto
                ? 'border-[#c4a1ff] bg-[#c4a1ff]/15 text-[#c4a1ff] shadow-[0_0_18px_rgba(196,161,255,0.24)]'
                : 'border-[#5d527b] bg-[#171227] text-gray-300'
            }`}
          >
            Auto
          </button>
          <button
            type="button"
            onClick={() => setSemiAuto(true)}
            className={`flex-1 cursor-pointer rounded-xl border p-3 transition duration-200 hover:scale-[1.02] ${
              semiAuto
                ? 'border-[#c4a1ff] bg-[#c4a1ff]/15 text-[#c4a1ff] shadow-[0_0_18px_rgba(196,161,255,0.24)]'
                : 'border-[#5d527b] bg-[#171227] text-gray-300'
            }`}
          >
            Semi-Auto
          </button>
        </div>
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Cấu hình prompt từng bước</h2>
          <p className="text-sm text-gray-400">
            Có thể sửa prompt mặc định hoặc thêm bước mới trước khi chạy. Nếu cần chèn kịch bản gốc vào prompt tùy chỉnh, đặt {'{{originalScript}}'} đúng vị trí bạn muốn.
          </p>
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={handleAddStep}
            className="rounded-lg border border-[#c4a1ff]/40 bg-[#c4a1ff]/10 px-3 py-2 text-xs font-bold text-[#c4a1ff] transition hover:bg-[#c4a1ff]/15"
          >
            + Thêm bước
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {promptTemplates.map((step) => {
            const active = activePromptStep === step.stepNumber
            const hasOverride = Boolean(stepPromptOverrides[step.stepNumber]?.trim())

            return (
              <button
                key={step.stepNumber}
                type="button"
                onClick={() => setActivePromptStep(step.stepNumber)}
                className={`rounded-lg border p-2 text-left text-xs transition ${
                  active
                    ? 'border-[#c4a1ff] bg-[#c4a1ff]/15 text-[#c4a1ff]'
                    : 'border-[#5d527b] bg-[#171227] text-gray-300 hover:border-[#c4a1ff]/50'
                }`}
              >
                <span className="block font-bold">Bước {step.stepNumber}</span>
                <span className="line-clamp-1">{step.name}</span>
                {step.custom && <span className="mt-1 block text-[10px] text-[#eab308]">thêm mới</span>}
                {hasOverride && <span className="mt-1 block text-[10px] text-[#c4a1ff]">đã sửa</span>}
              </button>
            )
          })}
        </div>

        {isActiveCustomStep && (
          <input
            className={fieldClass}
            type="text"
            value={activePrompt?.name || ''}
            onChange={(event) => handleCustomStepNameChange(event.target.value)}
            placeholder="Tên bước tùy chỉnh..."
          />
        )}

        <textarea
          className={`${fieldClass} min-h-[160px] resize-y font-mono text-sm`}
          value={activePromptValue}
          onChange={(event) => handlePromptOverrideChange(event.target.value)}
          placeholder={`Prompt cho bước ${activePromptStep}. ${isActiveCustomStep ? 'Nhập nội dung prompt bắt buộc.' : 'Xóa rỗng để quay về mặc định.'}`}
        />
        <div className="mt-2 flex gap-2">
          {!isActiveCustomStep && (
            <button
              type="button"
              onClick={() => {
                setStepPromptOverrides((previous) => {
                  const next = { ...previous }
                  delete next[activePromptStep]
                  return next
                })
              }}
              className="rounded-lg border border-[#5d527b] bg-[#171227] px-3 py-2 text-xs text-gray-300 transition hover:border-[#c4a1ff]/50 hover:text-white"
            >
              Đặt lại bước này về mặc định
            </button>
          )}
          {isActiveCustomStep && (
            <button
              type="button"
              onClick={handleRemoveCustomStep}
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 transition hover:border-red-400 hover:text-red-200"
            >
              Xóa bước tùy chỉnh
            </button>
          )}
        </div>
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Kịch bản gốc</h2>
          <p className="text-sm text-gray-400">
            Dán toàn bộ kịch bản gốc để pipeline xử lý qua các bước đã cấu hình.
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
          isDisabled
            ? 'cursor-not-allowed bg-gray-700/70 text-gray-400'
            : 'bg-gradient-to-r from-[#f3e8ff] via-[#c4a1ff] to-[#9f7aea] text-[#2f174a] shadow-[0_4px_20px_rgba(196,161,255,0.34)] hover:scale-[1.02] hover:brightness-110'
        }`}
        disabled={isDisabled}
        onClick={handleSubmit}
      >
        Bắt đầu pipeline
      </button>
    </section>
  )
}

export default ConfigPanel
