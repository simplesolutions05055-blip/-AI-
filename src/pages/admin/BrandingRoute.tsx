import { Navigate } from 'react-router-dom';
import { useProfile } from '@/lib/useProfile';
import BrandingPage from '@/pages/admin/BrandingPage';

/**
 * /admin/branding no longer has its own screen for admins — brand management
 * lives in the "מותגים" tab of /admin/permissions. Admins are redirected there
 * (old links and bookmarks keep working). Regular users still reach their own
 * limited brand view here, linked from their settings screen.
 */
export default function BrandingRoute() {
  const { loading, profile } = useProfile();
  if (loading) return null;
  if (profile?.role === 'admin') return <Navigate to="/admin/permissions?tab=brands" replace />;
  return <BrandingPage />;
}
