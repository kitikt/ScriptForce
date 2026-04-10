import { LoaderCircle } from 'lucide-react'

import styles from './StatusBar.module.css'

function StatusBar({ message, processing }) {
  return (
    <div className={styles.bar}>
      <div className={styles.inner}>
        {processing ? (
          <LoaderCircle className={styles.spinner} size={16} />
        ) : (
          <span className={styles.dot} />
        )}
        <span>{message}</span>
      </div>
    </div>
  )
}

export default StatusBar
