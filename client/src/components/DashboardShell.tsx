import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  LogOut,
  MessageSquare,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  WifiOff,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.tsx';
import { useChatRealtime } from '../context/RealtimeContext.tsx';
import { AppLink, useRouter } from '../context/RouterContext.tsx';
import { Avatar } from './Avatar.tsx';

interface DashboardShellProps {
  title: string;
  subtitle?: string;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  fullBleed?: boolean;
}

export function DashboardShell({
  title,
  subtitle,
  headerActions,
  children,
  fullBleed = false,
}: DashboardShellProps) {
  const { user, theme, setThemePreference, logout } = useAuth();
  const { connected, reconnecting, conversations, unreadNotificationCount } = useChatRealtime();
  const { pathname, navigate } = useRouter();

  const totalUnreadMessages = conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);

  const navItems = [
    ...(user?.role === 'ADMIN'
      ? []
      : [
          {
            label: 'All Messages',
            href: '/chat',
            icon: MessageSquare,
            active: pathname === '/chat',
            count: totalUnreadMessages,
          },
          {
            label: 'Direct Chats',
            href: '/chat/direct',
            icon: MessageSquare,
            active: pathname === '/chat/direct',
            count: conversations.filter((c) => c.type === 'DIRECT').reduce((a, c) => a + (c.unreadCount || 0), 0),
          },
          {
            label: 'Group Channels',
            href: '/chat/groups',
            icon: Users,
            active: pathname === '/chat/groups',
            count: conversations.filter((c) => c.type === 'GROUP').reduce((a, c) => a + (c.unreadCount || 0), 0),
          },
          {
            label: 'Notifications',
            href: '/notifications',
            icon: Bell,
            active: pathname === '/notifications',
            count: unreadNotificationCount,
          },
        ]),
    {
      label: 'Profile & Settings',
      href: '/profile',
      icon: Settings,
      active: pathname === '/profile',
      count: 0,
    },
    ...(user?.role === 'ADMIN'
      ? [{ label: 'Admin Console', href: '/admin', icon: ShieldCheck, active: pathname === '/admin', count: 0 }]
      : []),
  ];

  const mobileNavItems =
    user?.role === 'ADMIN'
      ? [
          {
            label: 'Admin',
            href: '/admin',
            icon: ShieldCheck,
            active: pathname === '/admin',
            count: 0,
          },
          {
            label: 'Settings',
            href: '/profile',
            icon: Settings,
            active: pathname === '/profile',
            count: 0,
          },
        ]
      : [
          {
            label: 'Chats',
            href: '/chat',
            icon: MessageSquare,
            active: pathname === '/chat' || pathname === '/chat/direct',
            count: totalUnreadMessages,
          },
          {
            label: 'Groups',
            href: '/chat/groups',
            icon: Users,
            active: pathname === '/chat/groups',
            count: conversations
              .filter((conversation) => conversation.type === 'GROUP')
              .reduce((count, conversation) => count + (conversation.unreadCount || 0), 0),
          },
          {
            label: 'Alerts',
            href: '/notifications',
            icon: Bell,
            active: pathname === '/notifications',
            count: unreadNotificationCount,
          },
          {
            label: 'Settings',
            href: '/profile',
            icon: Settings,
            active: pathname === '/profile',
            count: 0,
          },
        ];

  const handleSignOut = async () => {
    await logout();
    toast.success('Signed out of ChatSphere.');
    navigate('/login');
  };

  return (
    <div className="relative min-h-screen h-dvh flex bg-base-100 text-base-content overflow-hidden">

      {/* ── Workspace Sidebar ───────────────────────────────────────────── */}
      <aside className="flex w-16 lg:w-60 shrink-0 flex-col bg-base-200 border-r border-white/5">
        {/* Logo row */}
        <div className="h-16 px-2 lg:px-5 flex items-center justify-center lg:justify-between border-b border-white/5">
          <AppLink
            href={user?.role === 'ADMIN' ? '/admin' : '/chat'}
            className="flex items-center justify-center lg:justify-start gap-2.5"
            aria-label="ChatSphere home"
            title="ChatSphere"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <MessageSquare className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="hidden lg:inline text-sm font-bold text-base-content">ChatSphere</span>
          </AppLink>

          {/* Connection indicator */}
          <motion.div
            animate={{ opacity: 1 }}
            className="hidden lg:flex items-center gap-1.5"
            title={connected ? 'Real-time connected' : 'Reconnecting…'}
          >
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400'}`}>
              {connected && (
                <span className="block w-2 h-2 rounded-full bg-emerald-400 animate-ping opacity-60" />
              )}
            </div>
            <span className="text-[10px] text-base-content/50 font-mono">{connected ? 'Live' : 'Sync…'}</span>
          </motion.div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 p-1.5 lg:p-2.5 space-y-0.5 overflow-y-auto" aria-label="Workspace navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <AppLink
                key={item.href}
                href={item.href}
                aria-label={item.label}
                title={item.label}
                className={`relative flex items-center justify-center lg:justify-between gap-3 px-2 lg:px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  item.active
                    ? 'bg-primary/15 text-primary shadow-sm'
                    : 'text-base-content/60 hover:bg-white/5 hover:text-base-content'
                }`}
              >
                <span className="flex items-center justify-center lg:justify-start gap-3 min-w-0">
                  <Icon className={`w-5 h-5 lg:w-4 lg:h-4 shrink-0 ${item.active ? 'text-primary' : ''}`} />
                  <span className="hidden lg:block truncate">{item.label}</span>
                </span>
                <AnimatePresence>
                  {item.count > 0 && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      className="absolute right-0 top-0 lg:static min-w-[18px] lg:min-w-[20px] h-[18px] lg:h-5 px-1.5 rounded-full bg-primary text-primary-content text-[9px] lg:text-[10px] font-bold flex items-center justify-center tabular-nums"
                    >
                      {item.count > 99 ? '99+' : item.count}
                    </motion.span>
                  )}
                </AnimatePresence>
              </AppLink>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="p-1.5 lg:p-3 border-t border-white/5 space-y-2">
          <div className="flex items-center justify-center lg:justify-start gap-2.5 px-0 lg:px-2 py-1.5">
            <Avatar
              src={user?.avatarUrl}
              name={user?.displayName || 'User'}
              size="sm"
              showPresence
              isOnline={connected}
            />
            <div className="hidden lg:block min-w-0 flex-1">
              <p className="text-xs font-semibold text-base-content truncate">{user?.displayName}</p>
              <p className="text-[10px] text-base-content/50 truncate font-mono">@{user?.username}</p>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row items-stretch gap-1.5">
            <button
              type="button"
              onClick={() => void setThemePreference(theme === 'dark' ? 'light' : 'dark')}
              className="flex-1 flex items-center justify-center gap-1.5 h-9 lg:h-8 rounded-lg text-xs text-base-content/60 hover:text-base-content hover:bg-white/5 transition-all duration-200 cursor-pointer"
              aria-label="Toggle color theme"
              title="Toggle color theme"
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              <span className="hidden lg:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="flex-1 flex items-center justify-center gap-1.5 h-9 lg:h-8 rounded-lg text-xs text-error/80 hover:text-error hover:bg-error/8 transition-all duration-200 cursor-pointer"
              aria-label="Sign out of ChatSphere"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <div className="relative flex-1 flex flex-col min-w-0 h-full overflow-hidden">

        {/* Reconnection banner */}
        <AnimatePresence>
          {!connected && reconnecting && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-warning/12 border-b border-warning/20 px-4 py-1.5 text-xs text-warning flex items-center justify-center gap-2 overflow-hidden"
            >
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              <span>Reconnecting — missed messages will synchronize automatically.</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Top header */}
        <header className="h-14 lg:h-16 px-4 lg:px-6 border-b border-white/5 bg-base-200/50 backdrop-blur-sm flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-base-content truncate">{title}</h1>
              {subtitle && (
                <p className="text-[11px] text-base-content/50 truncate">{subtitle}</p>
              )}
            </div>
          </div>

          {headerActions && (
            <div className="flex items-center gap-2 shrink-0">{headerActions}</div>
          )}
        </header>

        {/* Content */}
        <main
          className={`flex-1 min-h-0 ${
            fullBleed
              ? 'overflow-hidden flex flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0'
              : 'overflow-y-auto p-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:p-6'
          }`}
        >
          {children}
        </main>

        <nav
          aria-label="Mobile navigation"
          className="lg:hidden absolute inset-x-0 bottom-0 z-30 border-t border-white/10 bg-base-200/95 px-1 pt-1.5 backdrop-blur-xl"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)' }}
        >
          <div className="flex items-stretch justify-around gap-1">
            {mobileNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <AppLink
                  key={item.href}
                  href={item.href}
                  className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1.5 text-[10px] font-medium transition-colors ${
                    item.active
                      ? 'bg-primary/10 text-primary'
                      : 'text-base-content/60 hover:bg-white/5 hover:text-base-content'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="max-w-full truncate">{item.label}</span>
                  {item.count > 0 && (
                    <span className="absolute right-1/4 top-0 min-w-4 rounded-full bg-primary px-1 text-[9px] font-bold leading-4 text-primary-content">
                      {item.count > 99 ? '99+' : item.count}
                    </span>
                  )}
                </AppLink>
              );
            })}
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1.5 text-[10px] font-medium text-error/75 transition-colors hover:bg-error/10 hover:text-error"
              aria-label="Sign out of ChatSphere"
            >
              <LogOut className="h-5 w-5" />
              <span className="max-w-full truncate">Sign out</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
