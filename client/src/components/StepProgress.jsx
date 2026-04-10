import { Check, Circle, X } from 'lucide-react'

import styles from './StepProgress.module.css'

function getStepState(stepNumber, completedSteps, currentStep, errorStep) {
  if (errorStep === stepNumber) {
    return 'error'
  }

  if (completedSteps.some((step) => step.stepNumber === stepNumber)) {
    return 'done'
  }

  if (currentStep === stepNumber) {
    return 'running'
  }

  return 'waiting'
}

function StepProgress({ steps, completedSteps, currentStep, errorStep }) {
  return (
    <aside className={styles.panel}>
      <div className={styles.titleWrap}>
        <p className={styles.eyebrow}>Pipeline</p>
        <h2>8 bước xử lý</h2>
      </div>

      <div className={styles.list}>
        {steps.map((step) => {
          const state = getStepState(
            step.stepNumber,
            completedSteps,
            currentStep,
            errorStep
          )

          return (
            <div key={step.stepNumber} className={styles.item}>
              <div className={`${styles.marker} ${styles[state]}`}>
                {state === 'done' && <Check size={15} />}
                {state === 'error' && <X size={15} />}
                {state === 'waiting' && <Circle size={12} />}
                {state === 'running' && <span className={styles.pulseDot} />}
              </div>
              <div className={styles.content}>
                <span className={styles.stepNumber}>Step {step.stepNumber}</span>
                <strong>{step.name}</strong>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

export default StepProgress
