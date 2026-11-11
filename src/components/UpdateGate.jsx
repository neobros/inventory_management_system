import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getLatestRelease, isNewer, normaliseDownloadUrl } from '../services/appVersion'
import { isDesktop, appVersion, installUpdate, openUpdateLink } from '../utils/desktop'
import { Modal } from './ui'

/**
 * Checks the published release on startup and offers the update.
 *
 * Runs only in the desktop till — the web app updates itself by being reloaded.
 * A release can be marked mandatory, in which case the dialog cannot be
 * dismissed and the till stays unusable until it updates.
 */
export default function UpdateGate() {
  const { user, loading } = useAuth()
  const [release, setRelease] = useState(null)
  const [current, setCurrent] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState(0)
  const [message, setMessage] = useState('')

  /**
   * Compares the published version with this build and raises the dialog when
   * a newer one exists.
   *
   * Dismissing only lasts for the current session, so every launch asks again
   * until the till is updated.
   */
  const check = useCallback(async () => {
    if (!isDesktop()) return 'not-desktop'

    try {
      const [version, latest] = await Promise.all([appVersion(), getLatestRelease()])

      if (!latest?.version || !latest?.downloadUrl) return 'none-published'
      if (!isNewer(latest.version, version)) return 'up-to-date'

      setCurrent(version)
      setRelease(latest)
      setMessage('')
      setOpen(true)
      return 'available'
    } catch (err) {
      // Never block the till, but do not disappear either — a silent failure
      // here is indistinguishable from "no update available".
      console.warn('[StockPilot] Update check failed:', err?.code || err?.message || err)
      return 'error'
    }
  }, [])

  // Runs at startup. Waits for auth first: reading the release needs a
  // signed-in user, and Firebase restores the session asynchronously — checking
  // before that meant the rules refused the read and no update ever appeared.
  useEffect(() => {
    if (loading || !user) return undefined
    check()
    return undefined
  }, [user, loading, check])

  // "Check for updates" on the account page fires this.
  useEffect(() => {
    const onManual = async (event) => {
      const outcome = await check()
      event.detail?.done?.(outcome)
    }
    window.addEventListener('sp:check-update', onManual)
    return () => window.removeEventListener('sp:check-update', onManual)
  }, [check])

  const startUpdate = useCallback(async () => {
    setBusy(true)
    setPercent(0)
    setMessage('Downloading…')

    const result = await installUpdate(
      { url: normaliseDownloadUrl(release.downloadUrl), version: release.version },
      (p) => setPercent(p)
    )

    if (result?.started) {
      setMessage('Starting the installer — the app will close.')
      return
    }
    setBusy(false)
    setMessage(result?.reason || result?.error || 'The update could not be downloaded.')
  }, [release])

  if (!open || !release) return null

  const mandatory = Boolean(release.mandatory)

  return (
    <Modal
      title={`Update available — version ${release.version}`}
      subtitle={current ? `You are running ${current}` : undefined}
      onClose={mandatory || busy ? undefined : () => setOpen(false)}
      footer={
        <>
          {!mandatory && !busy && (
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Later
            </button>
          )}
          {!busy && (
            <button type="button" className="btn btn-ghost"
              onClick={() => openUpdateLink(normaliseDownloadUrl(release.downloadUrl))}>
              Download manually
            </button>
          )}
          <button type="button" className="btn" onClick={startUpdate} disabled={busy}>
            {busy && <span className="spinner" />} {busy ? 'Updating…' : 'Update now'}
          </button>
        </>
      }
    >
      {release.notes && (
        <div className="mb-4" style={{ whiteSpace: 'pre-wrap', color: 'var(--text-2)' }}>
          {release.notes}
        </div>
      )}

      {mandatory && (
        <div className="alert alert-amber mb-4">
          <span>!</span>
          <span>This update is required. The till cannot be used until it is installed.</span>
        </div>
      )}

      {busy && (
        <div className="mb-4">
          <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              width: `${percent}%`, height: '100%', background: 'var(--brand)',
              transition: 'width 0.2s',
            }} />
          </div>
          <div className="text-sm text-muted mt-2">{percent}% — this is a large file, please wait.</div>
        </div>
      )}

      {message && !busy && <div className="alert alert-amber">{message}</div>}

      {!busy && !message && (
        <p className="text-sm text-muted">
          The installer downloads, then replaces this version automatically. Your data is
          stored online and is not affected.
        </p>
      )}
    </Modal>
  )
}
