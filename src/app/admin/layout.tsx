import { redirect } from 'next/navigation';
import { getAdminUser } from '@/lib/require-admin';
import AdminNav from '@/components/AdminNav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getAdminUser();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-screen">
      <AdminNav email={user.email} />
      <main className="flex-1 p-6 max-w-6xl">{children}</main>
    </div>
  );
}
