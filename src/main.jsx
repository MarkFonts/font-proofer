import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import '../shared/src/type.css'
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
