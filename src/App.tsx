import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/Tooltip';
import LoginPage from '@/pages/LoginPage';
import SignupPage from '@/pages/SignupPage';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import OnboardingPage from '@/pages/OnboardingPage';
import PrivacyPolicyPage from '@/pages/legal/PrivacyPolicyPage';
import CookiePolicyPage from '@/pages/legal/CookiePolicyPage';
import DataRequestsPage from '@/pages/legal/DataRequestsPage';
import TermsPage from '@/pages/legal/TermsPage';
import AdminLayout from '@/pages/admin/AdminLayout';
import DashboardPage from '@/pages/admin/DashboardPage';
import RequestsCostsPage from '@/pages/admin/RequestsCostsPage';
import SettingsPage from '@/pages/admin/SettingsPage';
import UserSettingsPage from '@/pages/admin/UserSettingsPage';
import SimulatorPage from '@/pages/admin/SimulatorPage';
import FilesPage from '@/pages/admin/FilesPage';
import ModelsPage from '@/pages/admin/ModelsPage';
import SkillsPage from '@/pages/admin/SkillsPage';
import BrandingPage from '@/pages/admin/BrandingPage';
import ProductionPage from '@/pages/admin/ProductionPage';
import QuotePage from '@/pages/admin/QuotePage';
import RevisePage from '@/pages/admin/RevisePage';
import ErrorsPage from '@/pages/admin/ErrorsPage';
import PermissionsPage from '@/pages/admin/PermissionsPage';
import HolidaysCalendarPage from '@/pages/admin/HolidaysCalendarPage';
import AnnualPlannerPage from '@/pages/admin/AnnualPlannerPage';
import MetaConnectionPage from '@/pages/admin/MetaConnectionPage';
import ReloadPrompt from '@/components/pwa/ReloadPrompt';
import TitleManager from '@/components/TitleManager';
import DialogHost from '@/components/DialogHost';

export default function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <TitleManager />
        <Routes>
          <Route path="/" element={<Navigate to="/admin" replace />} />
          <Route path="/app" element={<Navigate to="/admin" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/cookies" element={<CookiePolicyPage />} />
        <Route path="/data-requests" element={<DataRequestsPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/admin" element={<AdminLayout><Outlet /></AdminLayout>}>
          <Route index element={<DashboardPage />} />
          <Route path="requests" element={<RequestsCostsPage />} />
          <Route path="costs" element={<RequestsCostsPage />} />
          <Route path="conversations" element={<Navigate to="/admin" replace />} />
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
          <Route path="holidays" element={<HolidaysCalendarPage />} />
          <Route path="annual-planner" element={<AnnualPlannerPage />} />
          <Route path="errors" element={<ErrorsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="user-settings" element={<UserSettingsPage />} />
          <Route path="meta-connection" element={<MetaConnectionPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
      <ReloadPrompt />
      <DialogHost />
      </BrowserRouter>
    </TooltipProvider>
  );
}
