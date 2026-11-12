import type { Metadata, Viewport } from 'next';
import '../index.css';
import { AppProviders } from './providers';

/**
 * Root layout — a React Server Component.
 *
 * Everything that is statically known at build time (document shell, metadata,
 * font preconnects, body classes) lives here and is streamed as HTML.
 * Only the provider tree below <body> ships JavaScript.
 */

const DESCRIPTION =
  'Production-grade real-time messaging platform featuring direct and group chats, secure authentication, encrypted cloud media attachments, presence tracking, and role-based administration.';

export const metadata: Metadata = {
  title: 'ChatSphere',
  description: DESCRIPTION,
  manifest: '/manifest.webmanifest',
  applicationName: 'ChatSphere',
  appleWebApp: {
    capable: true,
    title: 'ChatSphere',
    statusBarStyle: 'black-translucent',
  },
  openGraph: {
    title: 'ChatSphere',
    description: DESCRIPTION,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
  icons: {
    apple: '/icons/chatsphere-192.png',
    icon: '/icons/chatsphere-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0B1120',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="chatsphere" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#0B1120] text-slate-100 antialiased selection:bg-cyan-500/30 selection:text-cyan-100">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
