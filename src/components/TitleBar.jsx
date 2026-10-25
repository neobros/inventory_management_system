import { useEffect, useState } from 'react'
import { isDesktop, appVersion } from '../utils/desktop'

/**
 * The window's title strip, painted by the app.
 *
 * Electron hides the native frame and overlays only the min/max/close buttons,
 * so everything to the left of those is ours to draw — which is what lets the
 * window chrome match the sidebar instead of being system white. The strip is
 * marked as a drag region so the window can still be moved by it.
 *
 * Renders nothing on the web, where the browser owns the chrome.
 */
export default function TitleBar() {
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (isDesktop()) appVersion().then(setVersion).catch(() => {})
  }, [])

  if (!isDesktop()) return null

  return (
    <div className="titlebar no-print">
      <img src="./icon.png" alt="" className="titlebar-icon" />
      <span className="titlebar-name">StockPilot Till</span>
      {version && <span className="titlebar-version">v{version}</span>}
    </div>
  )
}
