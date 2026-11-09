import React from 'react'
import ReactDOM from 'react-dom/client'
/* index.css FIRST, before anything that pulls in a primitive. It carries the @layer
   order statement, and a layer's position is fixed the moment it is first created -- so
   if AxisSlider.css (which opens @layer wm.controls) is evaluated first, wm.controls is
   created before the statement is read and the statement can no longer move it. That is
   not a theoretical ordering nicety: it put app.base ABOVE wm.controls, so the app's
   `button { color: inherit }` reset beat the primitive's own state colour and the green
   `auto` rendered grey. */
import './index.css'
import App from './App.jsx'
import '../shared/src/color.css'    // the ramp, as DEFAULTS (wm-primitives). Layered
                                    // (@layer wm.color), so index.css's own :root always
                                    // wins whatever the import order -- this only decides
                                    // what a token resolves to when the app has not set it,
                                    // which used to be "inherit whatever you are sitting in".
import '../shared/src/type.css'
import '../shared/src/motion.css'
import '../shared/src/button.css'   // .wm-btn, the boxed button (CHROME.md)
import '../shared/src/chip.css'     // .wm-chip, one of a set (the preset bar)
import '../shared/src/select.css'   // .wm-select, a native select wearing the house chevron   // --dur-* (wm-primitives)
import '../shared/src/corners.css'
import '../shared/src/space.css'
import '../shared/src/editRail.css' // canonical edit-rail affordance (wm-primitives)
import '../shared/src/scrollbar.css' // house 6px scrollbar (wm-primitives)
import '../shared/src/toggleGroup.css' // house Toggle Group (wm-primitives)
import '../shared/src/button-sets.css' // 06 Menu, the toast's buttons (wm-primitives)
import '../shared/src/toast.css'       // the house toast (wm-primitives)
import { toast } from '../shared/src/toast.js'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

/* A NEW VERSION, WHILE THE APP IS OPEN. The service worker takes over as soon as a new
   deploy is fetched (skipWaiting + clientsClaim, vite.config.js), and that fires
   controllerchange here. The page still runs the old code, so say so and offer the
   reload. wasControlled skips the very first install, when there is no old version.
   An installed app can stay open for days without a navigation, which is when browsers
   check for a new worker, so it also checks on coming back to the foreground and hourly. */
if ('serviceWorker' in navigator) {
  const wasControlled = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!wasControlled) return
    toast({
      id: 'update',
      title: 'New version available',
      line: 'Reload to update. Dropped-in fonts need adding again.',
      action: { label: 'Reload', mark: 'restart_alt', onClick: () => location.reload() },
    })
  })
  const check = () => navigator.serviceWorker.getRegistration().then(r => r?.update()).catch(() => {})
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check() })
  setInterval(check, 60 * 60 * 1000)
}
