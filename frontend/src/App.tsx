import { useEffect, useLayoutEffect, useRef } from 'react'
import { Icon } from '@iconify/react'
import restartCircleLinear from '@iconify-icons/solar/restart-circle-linear'
import { Route, Routes, useLocation } from 'react-router-dom'

import { trackPageview } from '@/analytics/posthog'
import Header from '@/components/Header'
import { useAuth } from '@/context/AuthContext'
import AdminPage from '@/pages/AdminPage'
import HomePage from '@/pages/HomePage'
import HotspotPage from '@/pages/HotspotPage'
import LoginPage from '@/pages/LoginPage'
import MembershipPage from '@/pages/MembershipPage'
import ProcessingPage from '@/pages/ProcessingPage'
import ProjectDetailPage from '@/pages/ProjectDetailPage'
import ProjectsPage from '@/pages/ProjectsPage'
import ScriptEditorPage from '@/pages/ScriptEditorPage'
import ScriptLibraryPage from '@/pages/ScriptLibraryPage'
import SettingsPage from '@/pages/SettingsPage'

const LOCAL_APP_PREVIEW_KEY = 'mycut-local-app-preview'

function usePageviewTracking() {
  const location = useLocation()

  useEffect(() => {
    trackPageview(location.pathname + location.search)
  }, [location.pathname, location.search])
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/hotspots" element={<HotspotPage />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/scripts" element={<ScriptLibraryPage />} />
      <Route path="/script" element={<ScriptEditorPage />} />
      <Route path="/processing/:id" element={<ProcessingPage />} />
      <Route path="/project/:id" element={<ProjectDetailPage />} />
      <Route path="/membership" element={<MembershipPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  )
}

function App() {
  usePageviewTracking()
  const location = useLocation()
  const pageViewportRef = useRef<HTMLDivElement>(null)
  const { authEnabled, loading, user } = useAuth()
  const previewMode = new URLSearchParams(location.search).get('preview')
  const hasLocalAppPreview =
    import.meta.env.DEV &&
    sessionStorage.getItem(LOCAL_APP_PREVIEW_KEY) === 'true'

  useEffect(() => {
    if (!import.meta.env.DEV || authEnabled) return

    if (previewMode === 'home') {
      sessionStorage.setItem(LOCAL_APP_PREVIEW_KEY, 'true')
    } else if (previewMode === 'login') {
      sessionStorage.removeItem(LOCAL_APP_PREVIEW_KEY)
    }
  }, [authEnabled, previewMode])

  useLayoutEffect(() => {
    const viewport = pageViewportRef.current
    if (!viewport) return
    viewport.scrollTop = 0
    viewport.scrollLeft = 0
  }, [location.pathname])

  const showLocalAppPreview =
    import.meta.env.DEV &&
    !authEnabled &&
    previewMode !== 'login' &&
    (previewMode === 'home' || hasLocalAppPreview)
  const showLocalAuthPreview =
    import.meta.env.DEV &&
    !authEnabled &&
    import.meta.env.VITE_AUTH_PREVIEW === 'true' &&
    !showLocalAppPreview

  if (authEnabled && loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--workspace-background)]">
        <span className="brand-gradient flex size-11 items-center justify-center rounded-2xl text-white shadow-[var(--brand-card-shadow)]">
          <Icon icon={restartCircleLinear} className="size-5 motion-safe:animate-spin" />
        </span>
      </div>
    )
  }

  if ((authEnabled && !user) || showLocalAuthPreview) {
    return <LoginPage />
  }

  return (
    <div className="mycut-app-shell flex h-svh min-w-0 flex-col overflow-hidden bg-[var(--workspace-background)]">
      <Header />
      <div ref={pageViewportRef} className="mycut-page-viewport min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-scroll">
        <AppRoutes />
      </div>
    </div>
  )
}

export default App
