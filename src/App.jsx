import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import Navbar from './components/Navbar';
import UploadPage from './pages/UploadPage';
import PackagesPage from './pages/PackagesPage';
import DeploymentsPage from './pages/DeploymentsPage';
import DeploymentDetailPage from './pages/DeploymentDetailPage';

function AppRoutes() {
  const { isLoggedIn, isAdmin } = useAuth();

  if (!isLoggedIn) return <LoginPage />;

  return (
    <>
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/"                   element={<Navigate to="/upload" replace />} />
          <Route path="/upload"             element={<UploadPage />} />
          {isAdmin && <Route path="/packages"           element={<PackagesPage />} />}
          {isAdmin && <Route path="/deployments"        element={<DeploymentsPage />} />}
          {isAdmin && <Route path="/deployments/:jobId" element={<DeploymentDetailPage />} />}
          <Route path="*"                   element={<Navigate to="/upload" replace />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
