import { useState } from 'react'

const MODEL_OPTIONS = [
  'Sonnet 4.6',
  'Opus 4.6',
  'Haiku 4.5',
]

const sectionClass =
  'rounded-2xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl transition duration-200 hover:bg-white/[0.07]'

const fieldClass =
  'mt-3 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-white outline-none transition duration-200 placeholder:text-gray-500 focus:border-[#00d4aa] focus:shadow-[0_0_15px_rgba(0,212,170,0.1)] focus:ring-0'

function ConfigPanel({ projects, onStart }) {
  const [projectUrl, setProjectUrl] = useState('')
  const [modelName, setModelName] = useState(MODEL_OPTIONS[0])
  const [chatName, setChatName] = useState('')
  const [originalScript, setOriginalScript] = useState('')

  const isDisabled = !projectUrl || !originalScript.trim()

  const handleSubmit = () => {
    if (isDisabled) {
      return
    }

    onStart({
      originalScript: originalScript.trim(),
      projectUrl,
      modelName,
      chatName: chatName.trim() || 'ScriptForge Session',
    })
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
          className={fieldClass}
          value={projectUrl}
          onChange={(event) => setProjectUrl(event.target.value)}
        >
          <option value="" disabled>
            Chon project...
          </option>
          {projects.map((project) => (
            <option key={project.url} value={project.url}>
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
                className={`flex-1 cursor-pointer rounded-xl border bg-white/5 p-3 backdrop-blur-xl transition duration-200 hover:scale-[1.02] hover:bg-white/10 ${
                  active
                    ? 'border-[#00d4aa] text-[#00d4aa] shadow-[0_0_22px_rgba(0,212,170,0.22)]'
                    : 'border-white/10 text-gray-300'
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
