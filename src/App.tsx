import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import LoginPage from '@/pages/LoginPage';
import SignupPage from '@/pages/SignupPage';
import OnboardingPage from '@/pages/OnboardingPage';
import AdminLayout from '@/pages/admin/AdminLayout';
import DashboardPage from '@/pages/admin/DashboardPage';
import RequestsCostsPage from '@/pages/admin/RequestsCostsPage';
import SettingsPage from '@/pages/admin/SettingsPage';
import SimulatorPage from '@/pages/admin/SimulatorPage';
import FilesPage from '@/pages/admin/FilesPage';
import ModelsPage from '@/pages/admin/ModelsPage';
import SkillsPage from '@/pages/admin/SkillsPage';
import ConversationsPage from '@/pages/admin/ConversationsPage';
import BrandingPage from '@/pages/admin/BrandingPage';
import ProductionPage from '@/pages/admin/ProductionPage';
import QuotePage from '@/pages/admin/QuotePage';
import RevisePage from '@/pages/admin/RevisePage';
import ErrorsPage from '@/pages/admin/ErrorsPage';
import PermissionsPage from '@/pages/admin/PermissionsPage';
import ReloadPrompt from '@/components/pwa/ReloadPrompt';

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/admin" element={<AdminLayout><Outlet /></AdminLayout>}>
          <Route index element={<DashboardPage />} />
          <Route path="requests" element={<RequestsCostsPage />} />
          <Route path="costs" element={<RequestsCostsPage />} />
          <Route path="conversations" element={<ConversationsPage />} />
          <Route path="production" element={<ProductionPage />} />
          <Route path="production/:type" element={<ProductionPage />} />
          <Route path="quote" element={<QuotePage />} />
          <Route path="simulator" element={<SimulatorPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="files/:requestId/revise" element={<RevisePage />} />
          <Route path="branding" element={<BrandingPage />} />
          <Route path="models" element={<ModelsPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="permissions" element={<PermissionsPage />} />
          <Route path="errors" element={<ErrorsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
      <ReloadPrompt />
    </BrowserRouter>
  );
}
