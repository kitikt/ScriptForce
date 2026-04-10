import { useState } from 'react'

const MODEL_OPTIONS = [
  'Sonnet 4.6',
  'Opus 4.6',
  'Haiku 4.5',
]

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
    <section className="mx-auto flex max-w-2xl flex-col gap-8 p-8">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Project Selection</h2>
          <p className="text-sm text-gray-400">
            Chọn Claude project nơi pipeline sẽ chạy.
          </p>
        </div>

        <select
          className="w-full rounded-lg border border-gray-600 bg-gray-800 p-3 text-white outline-none focus:border-[#00d4aa] focus:ring-1 focus:ring-[#00d4aa]"
          value={projectUrl}
          onChange={(event) => setProjectUrl(event.target.value)}
        >
          <option value="" disabled>
            Chọn project...
          </option>
          {projects.map((project) => (
            <option key={project.url} value={project.url}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Model Selection</h2>
          <p className="text-sm text-gray-400">
            Chọn model phù hợp trước khi tạo chat mới.
          </p>
        </div>

        <div className="flex gap-3">
          {MODEL_OPTIONS.map((option) => {
            const active = modelName === option

            return (
              <button
                key={option}
                type="button"
                onClick={() => setModelName(option)}
                className={`flex-1 cursor-pointer rounded-lg border p-3 transition ${
                  active
                    ? 'border-[#00d4aa] bg-[#00d4aa]/20 text-[#00d4aa]'
                    : 'border-gray-600 bg-gray-800 text-gray-300'
                }`}
              >
                {option}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Chat Name</h2>
          <p className="text-sm text-gray-400">
            Đặt tên cho cuộc chat mới trong project đã chọn.
          </p>
        </div>

        <input
          className="w-full rounded-lg border border-gray-600 bg-gray-800 p-3 text-white outline-none focus:border-[#00d4aa] focus:ring-1 focus:ring-[#00d4aa]"
          type="text"
          value={chatName}
          onChange={(event) => setChatName(event.target.value)}
          placeholder="Nhập tên cho đoạn chat..."
        />
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Script Input</h2>
          <p className="text-sm text-gray-400">
            Paste toàn bộ kịch bản gốc để pipeline xử lý qua 8 bước.
          </p>
        </div>

        <textarea
          className="min-h-[200px] w-full rounded-lg border border-gray-600 bg-gray-800 p-3 text-white outline-none focus:border-[#00d4aa] focus:ring-1 focus:ring-[#00d4aa]"
          value={originalScript}
          onChange={(event) => setOriginalScript(event.target.value)}
          placeholder="Paste kịch bản gốc vào đây..."
        />
      </div>

      <button
        type="button"
        className={`w-full rounded-lg p-4 text-lg font-bold transition ${
          isDisabled
            ? 'cursor-not-allowed bg-gray-700 text-gray-400'
            : 'bg-gradient-to-r from-[#00d4aa] to-[#00b894] text-black hover:scale-[1.02]'
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
