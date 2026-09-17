// Sentry must be the very first import so errors during module init are captured.
import './sentry'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { installAppUpdate, AppUpdateWatcher } from './utils/appUpdate'
import './index.css'
installAppUpdate()
ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AppUpdateWatcher /><App /></BrowserRouter>
)
