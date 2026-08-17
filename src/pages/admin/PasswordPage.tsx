import ChangePasswordCard from '@/components/ChangePasswordCard';

export default function PasswordPage() {
  return (
    <section className="mx-auto w-full max-w-3xl" dir="rtl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-normal text-[var(--text)]">סיסמה</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">החלפת הסיסמה שאיתה אתם נכנסים למערכת.</p>
      </div>

      <ChangePasswordCard />
    </section>
  );
}
