import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import LoginPage from '@/pages/LoginPage';
import AdminLayout from '@/pages/admin/AdminLayout';
import DashboardPage from '@/pages/admin/DashboardPage';
import RequestsPage from '@/pages/admin/RequestsPage';
import SettingsPage from '@/pages/admin/SettingsPage';
import SimulatorPage from '@/pages/admin/SimulatorPage';
import FilesPage from '@/pages/admin/FilesPage';
import ModelsPage from '@/pages/admin/ModelsPage';
import SkillsPage from '@/pages/admin/SkillsPage';
import ConversationsPage from '@/pages/admin/ConversationsPage';
import CostsPage from '@/pages/admin/CostsPage';
import BrandingPage from '@/pages/admin/BrandingPage';

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<AdminLayout><Outlet /></AdminLayout>}>
          <Route index element={<DashboardPage />} />
          <Route path="requests" element={<RequestsPage />} />
          <Route path="conversations" element={<ConversationsPage />} />
          <Route path="costs" element={<CostsPage />} />
          <Route path="simulator" element={<SimulatorPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="branding" element={<BrandingPage />} />
          <Route path="models" element={<ModelsPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
