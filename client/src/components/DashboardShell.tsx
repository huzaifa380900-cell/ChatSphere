import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.tsx';
import { useChatSocket } from '../context/ChatSocketContext.tsx';
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
  const { connected, reconnecting, conversations, unreadNotificationCount } = useChatSocket();
  const { pathname, navigate } = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const totalUnreadMessages = conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);

  const navItems = [
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

  const handleSignOut = async () => {
    await logout();
    toast.success('Signed out of ChatSphere.');
    navigate('/login');
  };

  return (
    <div className="min-h-screen h-screen flex bg-base-100 text-base-content overflow-hidden">

      {/* ── Desktop Sidebar ──────────────────────────────────────────────── */}
      <aside className="hidden lg:flex lg:w-60 shrink-0 flex-col bg-base-200 border-r border-white/5">
        {/* Logo row */}
        <div className="h-16 px-5 flex items-center justify-between border-b border-white/5">
          <AppLink href="/chat" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <MessageSquare className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-base-content">ChatSphere</span>
          </AppLink>

          {/* Connection indicator */}
          <motion.div
            animate={{ opacity: 1 }}
            className="flex items-center gap-1.5"
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
        <nav className="flex-1 p-2.5 space-y-0.5 overflow-y-auto" aria-label="Workspace navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <AppLink
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  item.active
                    ? 'bg-primary/15 text-primary shadow-sm'
                    : 'text-base-content/60 hover:bg-white/5 hover:text-base-content'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className={`w-4 h-4 shrink-0 ${item.active ? 'text-primary' : ''}`} />
                  <span className="truncate">{item.label}</span>
                </span>
                <AnimatePresence>
                  {item.count > 0 && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-content text-[10px] font-bold flex items-center justify-center tabular-nums"
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
        <div className="p-3 border-t border-white/5 space-y-2">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <Avatar
              src={user?.avatarUrl}
              name={user?.displayName || 'User'}
              size="sm"
              showPresence
              isOnline={connected}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-base-content truncate">{user?.displayName}</p>
              <p className="text-[10px] text-base-content/50 truncate font-mono">@{user?.username}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void setThemePreference(theme === 'dark' ? 'light' : 'dark')}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs text-base-content/60 hover:text-base-content hover:bg-white/5 transition-all duration-200 cursor-pointer"
              aria-label="Toggle color theme"
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs text-error/80 hover:text-error hover:bg-error/8 transition-all duration-200 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Mobile Navigation Drawer ─────────────────────────────────────── */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 lg:hidden bg-black/60 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            />

            {/* Drawer */}
            <motion.div
              key="drawer"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 w-72 max-w-[88vw] bg-base-200 border-r border-white/5 flex flex-col lg:hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="h-14 px-4 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 flex items-center justify-center">
                    <MessageSquare className="w-3.5 h-3.5 text-white" />
                  </div>
                  <span className="text-sm font-bold">ChatSphere</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-base-content/60 hover:text-base-content hover:bg-white/5 transition-colors cursor-pointer"
                  aria-label="Close menu"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <nav className="flex-1 p-2.5 space-y-0.5 overflow-y-auto">
                {navItems.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <motion.div
                      key={item.href}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                    >
                      <AppLink
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                          item.active ? 'bg-primary/15 text-primary' : 'text-base-content/60 hover:bg-white/5 hover:text-base-content'
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          <Icon className="w-4 h-4" />
                          {item.label}
                        </span>
                        {item.count > 0 && (
                          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-content text-[10px] font-bold flex items-center justify-center tabular-nums">
                            {item.count}
                          </span>
                        )}
                      </AppLink>
                    </motion.div>
                  );
                })}
              </nav>

              <div className="p-3 border-t border-white/5">
                <div className="flex items-center gap-2.5 px-2 py-1.5 mb-2">
                  <Avatar src={user?.avatarUrl} name={user?.displayName || 'User'} size="sm" showPresence isOnline={connected} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{user?.displayName}</p>
                    <p className="text-[10px] text-base-content/50 font-mono truncate">@{user?.username}</p>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void setThemePreference(theme === 'dark' ? 'light' : 'dark')}
                    className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs text-base-content/60 hover:text-base-content hover:bg-white/5 transition-all cursor-pointer"
                  >
                    {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                    <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs text-error/80 hover:text-error hover:bg-error/8 transition-all cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">

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
            {/* Mobile hamburger */}
            <motion.button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              whileTap={{ scale: 0.9 }}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-base-content/60 hover:text-base-content hover:bg-white/5 transition-colors lg:hidden cursor-pointer"
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" />
            </motion.button>

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
              ? 'overflow-hidden flex flex-col'
              : 'overflow-y-auto p-4 lg:p-6'
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
