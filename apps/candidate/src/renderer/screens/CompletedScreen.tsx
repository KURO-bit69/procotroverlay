import styles from './CompletedScreen.module.css'

export default function CompletedScreen() {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.icon}>✓</div>
        <h2 className={styles.heading}>Session Complete</h2>
        <p className={styles.sub}>
          Your interview session has ended. Thank you.
        </p>
        <p className={styles.note}>
          Your proctor will review the session and contact you with next steps.
          You may close this window.
        </p>
      </div>
    </div>
  )
}
