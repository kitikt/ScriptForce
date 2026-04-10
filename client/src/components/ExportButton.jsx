import { Download } from 'lucide-react'

import styles from './ExportButton.module.css'

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`
}

function ExportButton({ steps }) {
  const handleExport = () => {
    const content = steps
      .map(
        (step) =>
          `===== STEP ${step.stepNumber}: ${step.stepName} =====\n${step.result}`
      )
      .join('\n\n')

    const file = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = `script_${formatTimestamp(new Date())}.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button type="button" className={styles.button} onClick={handleExport}>
      <Download size={18} />
      <span>Export Full Script</span>
    </button>
  )
}

export default ExportButton
