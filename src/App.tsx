import React from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
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
import PasswordPage from '@/pages/admin/PasswordPage';
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
import ErrorPage from '@/pages/ErrorPage';
import ReloadPrompt from '@/components/pwa/ReloadPrompt';
import TitleManager from '@/components/TitleManager';
import DialogHost from '@/components/DialogHost';
import AnimatedBackground from '@/components/AnimatedBackground';
import ErrorBoundary from '@/components/ErrorBoundary';

/**
 * Page-level boundary. The `key` is load-bearing: without it React keeps the
 * failed boundary mounted after a route change, so the user stays stuck on the
 * fallback even once they navigate somewhere that works. Re-keying on the path
 * gives each route a fresh boundary instance.
 */
function RouteBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary boundaryName="page" key={location.pathname}>
      {children}
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <ErrorBoundary boundaryName="app">
    <TooltipProvider delayDuration={200}>
      <AnimatedBackground />
      <div className="app-content">
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <TitleManager />
          <RouteBoundary>
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
          <Route path="files" element={<FilesPage />} />
          <Route path="files/:requestId/revise" element={<RevisePage />} />
          <Route path="schedule/:postId" element={<RevisePage />} />
          <Route path="branding" element={<BrandingPage />} />
          <Route path="models" element={<ModelsPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="permissions" element={<PermissionsPage />} />
          <Route path="holidays" element={<HolidaysCalendarPage />} />
          <Route path="annual-planner" element={<AnnualPlannerPage />} />
          <Route path="errors" element={<ErrorsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="user-settings" element={<UserSettingsPage />} />
          <Route path="password" element={<PasswordPage />} />
          <Route path="meta-connection" element={<MetaConnectionPage />} />
        </Route>
        <Route path="*" element={<ErrorPage />} />
          </Routes>
          </RouteBoundary>
          <ReloadPrompt />
          <DialogHost />
        </BrowserRouter>
      </div>
    </TooltipProvider>
    </ErrorBoundary>
  );
}
