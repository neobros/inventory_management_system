import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import {
  getLatestRelease, publishRelease, validateDownloadUrl, normaliseDownloadUrl, compareVersions,
} from '../../services/appVersion'
import { formatDate } from '../../utils/format'
import { Field, Loading, Stat } from '../../components/ui'

const BLANK = { version: '', downloadUrl: '', notes: '', mandatory: false }

/**
 * Publishes a new till version. Every desktop till reads this on startup and
 * offers the update; changing the link later is just another save here.
 */
export default function AdminRelease() {
  const { profile } = useAuth()
  const toast = useToast()

  const [current, setCurrent] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const latest = await getLatestRelease()
      setCurrent(latest)
      if (latest) {
        setForm({
          version: latest.version || '',
          downloadUrl: latest.downloadUrl || '',
          notes: latest.notes || '',
          mandatory: Boolean(latest.mandatory),
        })
      }
    } catch {
      toast.error('Could not load the published release.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm((f) => ({ ...f, [key]: value }))
  }

  const save = async (e) => {
    e.preventDefault()

    if (!/^\d+(\.\d+)*$/.test(form.version.trim().replace(/^v/i, ''))) {
      return toast.error('Version must be numbers and dots, e.g. 1.0.1')
    }
    const urlProblem = validateDownloadUrl(form.downloadUrl)
    if (urlProblem) return toast.error(urlProblem)

    if (current?.version && compareVersions(form.version, current.version) < 0) {
      const goBack = window.confirm(
        `Version ${form.version} is older than the published ${current.version}.\n\n`
        + 'Tills already on the newer build will not be offered this one. Publish anyway?'
      )
      if (!goBack) return undefined
    }

    setSaving(true)
    try {
      await publishRelease({ ...form, publishedBy: profile?.email || '' })
      toast.success(`Version ${form.version} published — tills will be offered it on next open.`)
      await load()
    } catch (err) {
      toast.error(err.message || 'Could not publish the release.')
    } finally {
      setSaving(false)
    }
    return undefined
  }

  if (loading) return <Loading label="Loading release…" />

  const resolved = normaliseDownloadUrl(form.downloadUrl)
  const rewritten = resolved && resolved !== form.downloadUrl.trim()

  return (
    <div className="grid grid-2" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px', alignItems: 'start' }}>
      <form className="card" onSubmit={save}>
        <div className="card-head">
          <h2>Publish an update</h2>
          <button type="submit" className="btn spacer" disabled={saving}>
            {saving && <span className="spinner" />} Publish
          </button>
        </div>

        <div className="card-body">
          <div className="row">
            <Field label="Version number" required hint="Must be higher than the tills are running, e.g. 1.0.1">
              <input value={form.version} onChange={set('version')} placeholder="1.0.1" required />
            </Field>
            <Field label="Required update">
              <label className="checkbox" style={{ paddingTop: 9 }}>
                <input type="checkbox" checked={form.mandatory} onChange={set('mandatory')} />
                Tills cannot be used until updated
              </label>
            </Field>
          </div>

          <Field
            label="Download link"
            required
            hint="Direct link to the installer .exe. Change it any time — tills read it fresh on every open."
          >
            <input value={form.downloadUrl} onChange={set('downloadUrl')}
              placeholder="https://…/StockPilot-Till-Setup-1.0.1.exe" required />
          </Field>

          {rewritten && (
            <div className="alert alert-blue" style={{ marginTop: -6, marginBottom: 14 }}>
              <span>↪</span>
              <span>
                Google Drive link detected. Tills will use the direct-download form:
                <br />
                <code className="text-sm">{resolved}</code>
              </span>
            </div>
          )}

          <Field label="What changed" hint="Shown in the update popup on the till.">
            <textarea value={form.notes} onChange={set('notes')} rows={5}
              placeholder={'• Faster receipt printing\n• Fixed discount rounding'} />
          </Field>
        </div>
      </form>

      <div style={{ display: 'grid', gap: 16 }}>
        <Stat
          label="Published version"
          value={current?.version || '—'}
          foot={current?.updatedAt ? `Updated ${formatDate(current.updatedAt)}` : 'Nothing published yet'}
          icon="🚀"
          tone={current?.version ? 'green' : 'grey'}
        />

        <div className="card">
          <div className="card-head"><h3>Where to host the installer</h3></div>
          <div className="card-body">
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>
              The link must serve the <code>.exe</code> file itself. Anything that returns a
              web page instead will make the till open a browser rather than update quietly.
            </p>

            <div className="alert alert-blue mt-3">
              <span>★</span>
              <span>
                <strong>Firebase Hosting</strong> is the most reliable and is free on your
                plan. Put the installer in a <code>public/</code> folder and run{' '}
                <code>firebase deploy</code>; the link is then{' '}
                <code>https://your-project.web.app/StockPilot-Till-Setup-1.0.1.exe</code>.
              </span>
            </div>

            <div className="alert alert-amber mt-3">
              <span>!</span>
              <span>
                <strong>Google Drive</strong> works, with a catch. Share the installer{' '}
                <strong>file</strong> (not a folder) as “Anyone with the link”. Drive stops
                large downloads with a virus-scan notice, so the till may open a browser for
                the shop to finish the download by hand.
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>How shops get it</h3></div>
          <div className="card-body text-sm" style={{ color: 'var(--text-2)' }}>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
              <li>Build the installer with <code>npm run electron:build</code></li>
              <li>Upload it and copy its direct link</li>
              <li>Publish it here with a higher version number</li>
              <li>
                Next time a till opens, it shows an update popup. Accepting downloads and
                runs the installer, which replaces the old version.
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
