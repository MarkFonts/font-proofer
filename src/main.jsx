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
import '../shared/src/motion.css'   // --dur-* (wm-primitives)
import '../shared/src/corners.css'
import '../shared/src/space.css'
import '../shared/src/editRail.css' // canonical edit-rail affordance (wm-primitives)
import '../shared/src/scrollbar.css' // house 6px scrollbar (wm-primitives)
import '../shared/src/toggleGroup.css' // house Toggle Group (wm-primitives)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
