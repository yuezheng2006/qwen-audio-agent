import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import SupportApp from './SupportApp.jsx'
import { isSupportPath } from './support-workspace.js'
import './styles.css'

if (new URLSearchParams(window.location.search).get('desktop') === 'orb') {
  document.documentElement.dataset.desktop = 'orb'
}

const root = isSupportPath() ? <SupportApp /> : <App />

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {root}
  </StrictMode>,
)
