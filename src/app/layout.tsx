import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'סוכן AI ארגוני',
  description: 'ניהול בקשות תוצרים דרך WhatsApp',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&family=Heebo:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
