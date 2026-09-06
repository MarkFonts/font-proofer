import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
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
