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
  { stepNumber: 4, name: 'Viết Part 1' },
  { stepNumber: 5, name: 'Viết Part 2' },
  { stepNumber: 6, name: 'Viết Part 3' },
  { stepNumber: 7, name: 'Bước 7a: Ghép và kiểm tra' },
  { stepNumber: 8, name: 'Bước 7b: Sửa và tạo file hoàn chỉnh' },
]

const sectionClass =
  'rounded-2xl border border-[#2d3148] bg-[#1a1a2e] p-5 shadow-2xl shadow-black/25 transition duration-200'

const fieldClass =
  'mt-3 w-full rounded-xl border border-[#3a3f5f] bg-[#10101d] p-3 text-white outline-none transition duration-200 placeholder:text-gray-500 focus:border-[#00d4aa] focus:shadow-[0_0_15px_rgba(0,212,170,0.12)] focus:ring-0'

function ConfigPanel({ projects, onStart }) {
  const [projectUrl, setProjectUrl] = useState('')
  const [modelName, setModelName] = useState(MODEL_OPTIONS[0])
  const [adaptiveThinking, setAdaptiveThinking] = useState(true)
  const [chatName, setChatName] = useState('')
  const [semiAuto, setSemiAuto] = useState(false)
  const [originalScript, setOriginalScript] = useState('')
  const [activePromptStep, setActivePromptStep] = useState(1)
  const [stepPromptOverrides, setStepPromptOverrides] = useState({})
  const [promptTemplates, setPromptTemplates] = useState(PROMPT_STEPS)

  const effectiveProjectUrl = projectUrl || (projects.length === 1 ? projects[0].url : '')
  const isDisabled = !effectiveProjectUrl || !originalScript.trim()
  const activePromptTemplate =
    promptTemplates.find((step) => step.stepNumber === activePromptStep)?.prompt || ''
  const activePromptValue = Object.prototype.hasOwnProperty.call(stepPromptOverrides, activePromptStep)
    ? stepPromptOverrides[activePromptStep]
    : activePromptTemplate

  useEffect(() => {
    let cancelled = false

    fetch('http://localhost:3001/prompt-templates')
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled && Array.isArray(payload?.steps)) {
          setPromptTemplates(payload.steps)
        }
      })
      .catch(() => {
        // Backend may be offline while editing UI. Keep fallback step names.
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = () => {
    if (isDisabled) {
      return
    }

    onStart({
      originalScript: originalScript.trim(),
      projectUrl: effectiveProjectUrl,
      modelName,
      adaptiveThinking,
      chatName: chatName.trim() || 'ScriptForge Session',
      semiAuto,
      stepPromptOverrides: Object.fromEntries(
        Object.entries(stepPromptOverrides).filter(([, value]) => value.trim())
      ),
    })
  }

  const handlePromptOverrideChange = (value) => {
    setStepPromptOverrides((previous) => ({
      ...previous,
      [activePromptStep]: value,
    }))
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Project Selection</h2>
          <p className="text-sm text-gray-400">
            Chon Claude project noi pipeline se chay.
          </p>
        </div>

        <select
          className={`${fieldClass} [color-scheme:dark]`}
          value={effectiveProjectUrl}
          onChange={(event) => setProjectUrl(event.target.value)}
        >
          <option value="" disabled className="bg-[#10101d] text-white">
            Chon project...
          </option>
          {projects.map((project) => (
            <option key={project.url} value={project.url} className="bg-[#10101d] text-white">
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Model Selection</h2>
          <p className="text-sm text-gray-400">
            Chon model phu hop truoc khi gui prompt dau tien.
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
                    ? 'border-[#00d4aa] bg-[#00d4aa]/15 text-[#00d4aa] shadow-[0_0_18px_rgba(0,212,170,0.18)]'
                    : 'border-[#3a3f5f] bg-[#10101d] text-gray-300'
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
            Chon Claude co bat che do Adaptive thinking trong model menu hay khong.
          </p>
        </div>

        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={() => setAdaptiveThinking(true)}
            className={`flex-1 cursor-pointer rounded-xl border p-3 transition duration-200 hover:scale-[1.02] ${
              adaptiveThinking
                ? 'border-[#00d4aa] bg-[#00d4aa]/15 text-[#00d4aa] shadow-[0_0_18px_rgba(0,212,170,0.18)]'
                : 'border-[#3a3f5f] bg-[#10101d] text-gray-300'
            }`}
          >
            On
          </button>
          <button
            type="button"
            onClick={() => setAdaptiveThinking(false)}
            className={`flex-1 cursor-pointer rounded-xl border p-3 transition duration-200 hover:scale-[1.02] ${
              !adaptiveThinking
                ? 'border-[#00d4aa] bg-[#00d4aa]/15 text-[#00d4aa] shadow-[0_0_18px_rgba(0,212,170,0.18)]'
                : 'border-[#3a3f5f] bg-[#10101d] text-gray-300'
            }`}
          >
            Off
          </button>
        </div>
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Chat Name</h2>
          <p className="text-sm text-gray-400">
            Dat ten cho cuoc chat moi trong project da chon.
          </p>
        </div>

        <input
          className={fieldClass}
          type="text"
          value={chatName}
          onChange={(event) => setChatName(event.target.value)}
          placeholder="Nhap ten cho doan chat..."
        />
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Pipeline Mode</h2>
          <p className="text-sm text-gray-400">
            Semi-Auto dung sau moi buoc de ban review va chinh sua. Auto chay lien tuc 8 buoc.
          </p>
        </div>

        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={() => setSemiAuto(false)}
            className={`flex-1 cursor-pointer rounded-xl border p-3 transition duration-200 hover:scale-[1.02] ${
              !semiAuto
                ? 'border-[#00d4aa] bg-[#00d4aa]/15 text-[#00d4aa] shadow-[0_0_18px_rgba(0,212,170,0.18)]'
                : 'border-[#3a3f5f] bg-[#10101d] text-gray-300'
            }`}
          >
            Auto
          </button>
          <button
            type="button"
            onClick={() => setSemiAuto(true)}
            className={`flex-1 cursor-pointer rounded-xl border p-3 transition duration-200 hover:scale-[1.02] ${
              semiAuto
                ? 'border-[#00d4aa] bg-[#00d4aa]/15 text-[#00d4aa] shadow-[0_0_18px_rgba(0,212,170,0.18)]'
                : 'border-[#3a3f5f] bg-[#10101d] text-gray-300'
            }`}
          >
            Semi-Auto
          </button>
        </div>
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Prompt Overrides</h2>
          <p className="text-sm text-gray-400">
            Tuy chon: sua prompt cua tung buoc truoc khi chay. De trong thi dung prompt mac dinh.
            Neu can chen kich ban goc vao custom prompt, dat {'{{originalScript}}'} dung vi tri ban muon.
          </p>
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
                    ? 'border-[#00d4aa] bg-[#00d4aa]/15 text-[#00d4aa]'
                    : 'border-[#3a3f5f] bg-[#10101d] text-gray-300 hover:border-[#00d4aa]/50'
                }`}
              >
                <span className="block font-bold">Step {step.stepNumber}</span>
                <span className="line-clamp-1">{step.name}</span>
                {hasOverride && <span className="mt-1 block text-[10px] text-[#00d4aa]">custom</span>}
              </button>
            )
          })}
        </div>

        <textarea
          className={`${fieldClass} min-h-[160px] resize-y font-mono text-sm`}
          value={activePromptValue}
          onChange={(event) => handlePromptOverrideChange(event.target.value)}
          placeholder={`Prompt cho Step ${activePromptStep}. Xoa rong de quay ve mac dinh.`}
        />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setStepPromptOverrides((previous) => {
                const next = { ...previous }
                delete next[activePromptStep]
                return next
              })
            }}
            className="rounded-lg border border-[#3a3f5f] bg-[#10101d] px-3 py-2 text-xs text-gray-300 transition hover:border-[#00d4aa]/50 hover:text-white"
          >
            Reset step nay ve mac dinh
          </button>
        </div>
      </div>

      <div className={sectionClass}>
        <div>
          <h2 className="text-lg font-bold text-white">Script Input</h2>
          <p className="text-sm text-gray-400">
            Paste toan bo kich ban goc de pipeline xu ly qua 8 buoc.
          </p>
        </div>

        <textarea
          className={`${fieldClass} min-h-[240px] resize-y`}
          value={originalScript}
          onChange={(event) => setOriginalScript(event.target.value)}
          placeholder="Paste kich ban goc vao day..."
        />
      </div>

      <button
        type="button"
        className={`w-full rounded-xl p-4 text-lg font-bold transition duration-200 ${
          isDisabled
            ? 'cursor-not-allowed bg-gray-700/70 text-gray-400'
            : 'bg-gradient-to-r from-[#00d4aa] to-[#00b894] text-black shadow-[0_4px_20px_rgba(0,212,170,0.3)] hover:scale-[1.02] hover:brightness-110'
        }`}
        disabled={isDisabled}
        onClick={handleSubmit}
      >
        Start Pipeline
      </button>
    </section>
  )
}

export default ConfigPanel
