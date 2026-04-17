import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import api from './api'
import Layout from './components/Layout'
import Login from './pages/Login'
import Home from './pages/Home'
import VMList from './pages/VMList'
import VMDetail from './pages/VMDetail'
import CreateVM from './pages/CreateVM'
import EditVM from './pages/EditVM'
import Storage from './pages/Storage'
import Dashboard from './pages/Dashboard'
import Monitor from './pages/Monitor'
import Docker from './pages/Docker'
import NetworkMgmt from './pages/NetworkMgmt'
import Metrics from './pages/Metrics'
import Files from './pages/Files'
import Kubernetes from './pages/Kubernetes'
import Images from './pages/Images'
import Console from './pages/Console'
import SystemProcesses from './pages/SystemProcesses'
import SystemServices from './pages/SystemServices'
import Firewall from './pages/Firewall'
import Security from './pages/Security'
import OpenShiftClusters from './pages/OpenShiftClusters'
import ClusterDetail from './pages/ClusterDetail'
import OpenShiftList from './pages/OpenShiftList'
import OpenShiftDeploy from './pages/OpenShift'
import OpenShiftJob from './pages/OpenShiftJob'
import OcpAgentList from './pages/OcpAgentList'
import OcpAgentDeploy from './pages/OcpAgentDeploy'
import OcpAgentJob from './pages/OcpAgentJob'
import Settings from './pages/Settings'
import PhysicalServers from './pages/PhysicalServers'
import PhysicalServerDetail from './pages/PhysicalServerDetail'

function PrivateRoute({ children, authState }) {
  if (authState === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-navy-900">
        <div className="text-sky-400 text-lg">Loading...</div>
      </div>
    )
  }
  if (!authState.authenticated) {
    return <Navigate to="/login" replace />
  }
  return children
}

export default function App() {
  const [authState, setAuthState] = useState('loading')

  // staxv-hypervisor auth API diverges from vm-manager's — see .claude/memory/multi_tenancy.md:
  //   GET  /api/auth/me      -> 200 {id, username, is_admin}  or 401 {error}
  //   POST /api/auth/logout  -> 204
  //   POST /api/auth/login   (handled in pages/Login.jsx)
  // Wrap the user object with {authenticated: true} so the existing
  // PrivateRoute shape keeps working unchanged.
  useEffect(() => {
    api.get('/auth/me')
      .then(res => setAuthState({ authenticated: true, ...res.data }))
      .catch(() => setAuthState({ authenticated: false }))
  }, [])

  const handleLogout = async () => {
    await api.post('/auth/logout')
    setAuthState({ authenticated: false })
    window.location.href = '/login'
  }

  return (
    <Routes>
      <Route path="/login" element={<Login onLogin={() => api.get('/auth/me').then(r => setAuthState({ authenticated: true, ...r.data }))} />} />
      {/* VNC console is full-screen — outside Layout */}
      <Route
        path="/vnc/:uuid"
        element={
          <PrivateRoute authState={authState}>
            <Console />
          </PrivateRoute>
        }
      />
      <Route
        path="/*"
        element={
          <PrivateRoute authState={authState}>
            <Layout username={authState?.username} onLogout={handleLogout}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/vms" element={<VMList />} />
                <Route path="/vms/create" element={<CreateVM />} />
                <Route path="/vms/:uuid" element={<VMDetail />} />
                <Route path="/vms/:uuid/edit" element={<EditVM />} />
                <Route path="/vms/:uuid/monitor" element={<Monitor />} />
                <Route path="/storage" element={<Storage />} />
                <Route path="/docker" element={<Docker />} />
                <Route path="/network" element={<NetworkMgmt />} />
                <Route path="/metrics" element={<Metrics />} />
                <Route path="/files"      element={<Files />} />
                <Route path="/kubernetes" element={<Kubernetes />} />
                <Route path="/images"     element={<Images />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/system/processes" element={<SystemProcesses />} />
                <Route path="/system/services"  element={<SystemServices />} />
                <Route path="/system/firewall"  element={<Firewall />} />
                <Route path="/system/security"  element={<Security />} />
                <Route path="/openshift/clusters"                     element={<OpenShiftClusters />} />
                <Route path="/openshift/clusters/:source/:jobId"  element={<ClusterDetail />} />
                <Route path="/openshift"              element={<OpenShiftList />} />
                <Route path="/openshift/deploy"      element={<OpenShiftDeploy />} />
                <Route path="/openshift/jobs/:jobId" element={<OpenShiftJob />} />
                <Route path="/ocp-agent"              element={<OcpAgentList />} />
                <Route path="/ocp-agent/deploy"      element={<OcpAgentDeploy />} />
                <Route path="/ocp-agent/jobs/:jobId" element={<OcpAgentJob />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/physical-servers" element={<PhysicalServers />} />
                <Route path="/physical-servers/:serverId" element={<PhysicalServerDetail />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </PrivateRoute>
        }
      />
    </Routes>
  )
}
