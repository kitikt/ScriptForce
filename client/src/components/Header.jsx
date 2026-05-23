import { Clapperboard } from 'lucide-react'

import styles from './Header.module.css'

function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <div className={styles.iconWrap}>
          <Clapperboard size={20} />
        </div>
        <div>
          <h1>ScriptForge</h1>
          <p>Tự động hóa pipeline viết kịch bản AI</p>
        </div>
      </div>
    </header>
  )
}

export default Header
