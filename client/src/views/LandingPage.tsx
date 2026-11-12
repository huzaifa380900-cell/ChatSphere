'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, useInView, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  Check,
  CheckCheck,
  FileText,
  Lock,
  Mic,
  Shield,
  Users,
  Zap,
  Globe,
  Bell,
  Star,
  ChevronRight,
  MessageCircle,
  Send,
  Sparkles,
} from 'lucide-react';
import { AppLink, useRouter } from '../context/RouterContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

/* ─── Animation Variants ─────────────────────────────────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] },
  }),
};

const fadeIn = {
  hidden: { opacity: 0 },
  visible: (i = 0) => ({
    opacity: 1,
    transition: { duration: 0.5, delay: i * 0.08 },
  }),
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: (i = 0) => ({
    opacity: 1, scale: 1,
    transition: { duration: 0.55, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] },
  }),
};

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px 0px' });
  return { ref, inView };
}

/* ─── Floating Chat Bubble SVG ───────────────────────────────────────────── */
function FloatingBubble({
  delay = 0,
  duration = 5,
  x = 0,
  y = 0,
  variant = 'sent',
  children,
  className = '',
}: {
  delay?: number;
  duration?: number;
  x?: number;
  y?: number;
  variant?: 'sent' | 'received';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={`absolute select-none pointer-events-none ${className}`}
      style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{
        opacity: [0, 1, 1, 0.9],
        y: [0, -14, -8, -14, 0],
        rotate: variant === 'sent' ? [0, 1, -1, 1, 0] : [0, -1.5, 1, -1, 0],
      }}
      transition={{
        opacity: { duration: 0.5, delay },
        y: { duration, delay, repeat: Infinity, ease: 'easeInOut' },
        rotate: { duration: duration * 1.3, delay, repeat: Infinity, ease: 'easeInOut' },
      }}
    >
      <div
        className={`px-3.5 py-2 rounded-2xl text-xs font-medium shadow-xl max-w-[180px] ${
          variant === 'sent'
            ? 'bg-cyan-500/20 border border-cyan-400/30 text-cyan-100 rounded-br-sm'
            : 'bg-indigo-500/20 border border-indigo-400/30 text-indigo-100 rounded-bl-sm'
        }`}
      >
        {children}
      </div>
    </motion.div>
  );
}

/* ─── Hero Graphic — Floating Chat UI ───────────────────────────────────── */
function HeroGraphic() {
  return (
    <div className="relative w-full h-[440px] lg:h-[520px]">
      {/* Glow blobs */}
      <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main chat window mockup */}
      <motion.div
        className="absolute inset-4 lg:inset-8 glass-card rounded-2xl overflow-hidden border border-white/8 shadow-2xl"
        initial={{ opacity: 0, y: 32, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Window chrome */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/3">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-400/70" />
          </div>
          <div className="flex-1 flex items-center justify-center gap-2">
            <div className="relative w-6 h-6 rounded-full bg-gradient-to-br from-cyan-400 to-indigo-500 flex items-center justify-center text-white text-[9px] font-bold">
              E
              <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-400 ring-1 ring-black/30" />
            </div>
            <span className="text-[11px] font-medium text-white/70">Elena Rostova · Engineering Hub</span>
          </div>
        </div>

        {/* Messages */}
        <div className="p-4 space-y-3 overflow-hidden">
          {[
            { align: 'left', text: 'Migration audit passed all load tests. Uploading report now 📊', time: '14:26', read: true },
            { align: 'right', text: 'Zero duplicate inserts across all 8 group members ✅', time: '14:27', read: true },
            { align: 'left', text: 'HttpOnly session handoff confirmed. No token in localStorage.', time: '14:28', read: false },
          ].map((msg, i) => (
            <motion.div
              key={i}
              className={`flex ${msg.align === 'right' ? 'justify-end' : 'justify-start'}`}
              initial={{ opacity: 0, x: msg.align === 'right' ? 20 : -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.6 + i * 0.18 }}
            >
              {msg.align === 'left' && (
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-[9px] font-bold text-white mr-2 mt-1 shrink-0">E</div>
              )}
              <div className={`max-w-[75%] px-3 py-2 rounded-xl text-[11px] leading-relaxed ${
                msg.align === 'right'
                  ? 'bg-cyan-500/20 border border-cyan-400/25 text-cyan-50 rounded-br-sm'
                  : 'bg-white/6 border border-white/8 text-slate-200 rounded-bl-sm'
              }`}>
                <p>{msg.text}</p>
                <div className="flex items-center justify-end gap-1 mt-1 opacity-60">
                  <span className="text-[9px] font-mono">{msg.time}</span>
                  {msg.align === 'right' && (
                    msg.read ? <CheckCheck className="w-2.5 h-2.5 text-cyan-300" /> : <Check className="w-2.5 h-2.5" />
                  )}
                </div>
              </div>
            </motion.div>
          ))}

          {/* Typing indicator */}
          <motion.div
            className="flex items-center gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.4 }}
          >
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-[9px] font-bold text-white shrink-0">E</div>
            <div className="glass-card px-3 py-2 rounded-xl rounded-bl-sm border border-white/8 flex items-center gap-1.5">
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400" />
            </div>
          </motion.div>
        </div>

        {/* Composer */}
        <div className="absolute bottom-0 inset-x-0 p-3 border-t border-white/5 bg-black/20 flex items-center gap-2">
          <div className="flex-1 bg-white/5 border border-white/8 rounded-xl px-3 py-2 text-[11px] text-white/40">Type a message…</div>
          <button className="w-7 h-7 rounded-lg bg-cyan-500 flex items-center justify-center shrink-0">
            <Send className="w-3 h-3 text-white" />
          </button>
        </div>
      </motion.div>

      {/* Floating badge bubbles */}
      <FloatingBubble delay={1.1} duration={5.5} x={8} y={28} variant="sent">
        🔐 E2E JWT isolation
      </FloatingBubble>
      <FloatingBubble delay={1.4} duration={6.2} x={280} y={8} variant="received">
        ✅ 0 localStorage tokens
      </FloatingBubble>
      <FloatingBubble delay={1.7} duration={5} x={310} y={340} variant="sent">
        ⚡ Pusher realtime
      </FloatingBubble>
      <FloatingBubble delay={1.2} duration={6.8} x={-4} y={320} variant="received">
        📦 PostgreSQL persisted
      </FloatingBubble>
    </div>
  );
}

/* ─── Feature Card ───────────────────────────────────────────────────────── */
function FeatureCard({
  icon: Icon,
  title,
  description,
  accent,
  delay = 0,
  badge,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  accent: string;
  delay?: number;
  badge?: string;
}) {
  const { ref, inView } = useScrollReveal();
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      ref={ref}
      variants={scaleIn}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      custom={delay}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative group glass-card rounded-2xl p-6 cursor-default overflow-hidden transition-all duration-300 hover:-translate-y-1"
      style={{
        boxShadow: hovered
          ? `0 0 32px ${accent}22, 0 20px 40px rgba(0,0,0,0.3)`
          : '0 4px 24px rgba(0,0,0,0.2)',
      }}
    >
      {/* Hover border glow */}
      <div
        className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ background: `radial-gradient(circle at 50% 0%, ${accent}18 0%, transparent 70%)` }}
      />

      <div className="relative z-10 space-y-4">
        <div className="flex items-start justify-between">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
            style={{ background: `${accent}18`, border: `1px solid ${accent}35` }}
          >
            <Icon className="w-5 h-5" style={{ color: accent }} />
          </div>
          {badge && (
            <span
              className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
              style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}30` }}
            >
              {badge}
            </span>
          )}
        </div>

        <div>
          <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
          <p className="text-sm text-slate-400 leading-relaxed">{description}</p>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Stat Counter ───────────────────────────────────────────────────────── */
function StatBadge({ value, label }: { value: string; label: string }) {
  const { ref, inView } = useScrollReveal();
  return (
    <motion.div
      ref={ref}
      variants={fadeUp}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      className="text-center"
    >
      <p className="text-3xl font-bold font-mono tabular-nums gradient-text">{value}</p>
      <p className="text-xs text-slate-400 mt-1 max-w-[140px] mx-auto leading-relaxed">{label}</p>
    </motion.div>
  );
}

/* ─── Preview Tab ────────────────────────────────────────────────────────── */
function WorkspacePreview() {
  const [tab, setTab] = useState<'group' | 'direct'>('group');
  const { ref, inView } = useScrollReveal();

  const groupMessages = [
    { from: 'Elena', side: 'left', text: 'Neon cutover passed. Uploading audit PDF.', time: '14:26', hasFile: true },
    { from: 'You', side: 'right', text: 'Confirmed — zero duplicates across all 8 members ✅', time: '14:28', read: true },
  ];
  const directMessages = [
    { from: 'Marcus', side: 'left', text: 'Cloudinary signed URL policy reviewed. TTL at 300s.', time: '09:41', hasVoice: true },
    { from: 'You', side: 'right', text: 'Revoking membership blocks URL renewal immediately.', time: '09:43', read: false },
  ];
  const messages = tab === 'group' ? groupMessages : directMessages;

  return (
    <motion.div
      ref={ref}
      variants={fadeUp}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      className="rounded-2xl border border-white/7 overflow-hidden glass-card"
    >
      {/* Tab bar */}
      <div className="flex items-center gap-1 p-3 border-b border-white/6 bg-white/2">
        {(['group', 'direct'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 cursor-pointer ${
              tab === t
                ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {t === 'group' ? 'Group Channel' : 'Direct Message'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* Sidebar */}
        <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-white/6 p-3 space-y-1.5 bg-white/1">
          {(['group', 'direct'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`w-full text-left p-3 rounded-xl transition-all duration-200 cursor-pointer ${
                tab === t ? 'bg-cyan-500/10 border border-cyan-500/25' : 'hover:bg-white/4 border border-transparent'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white truncate">
                  {t === 'group' ? 'Core Infrastructure Release' : 'Marcus Vance'}
                </span>
                <span className={`text-[10px] font-mono ${t === 'direct' ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {t === 'direct' ? 'Online' : '14:28'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate mt-0.5">
                {t === 'group' ? 'Elena: Signed migration report attached…' : 'Verified Cloudinary TTL at 300s'}
              </p>
            </button>
          ))}
        </div>

        {/* Thread */}
        <div className="lg:col-span-8 p-5 space-y-4">
          <div className="pb-3 border-b border-white/6">
            <p className="text-sm font-semibold text-white">
              {tab === 'group' ? 'Core Infrastructure Release' : 'Marcus Vance · Principal Security Architect'}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {tab === 'group' ? '8 members · Group RBAC enforced' : 'Direct · Read receipts enabled'}
            </p>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-3"
            >
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-2.5 ${msg.side === 'right' ? 'justify-end' : 'justify-start'}`}>
                  {msg.side === 'left' && (
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-1">
                      {msg.from[0]}
                    </div>
                  )}
                  <div className={`max-w-[80%] px-3.5 py-2.5 rounded-xl space-y-1.5 text-xs ${
                    msg.side === 'right'
                      ? 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-50 rounded-br-sm'
                      : 'bg-white/5 border border-white/8 text-slate-200 rounded-bl-sm'
                  }`}>
                    {msg.side === 'left' && (
                      <p className="text-[10px] font-semibold text-slate-400">{msg.from}</p>
                    )}
                    <p>{msg.text}</p>
                    {'hasFile' in msg && msg.hasFile && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-black/20 border border-white/8 text-[10px]">
                        <FileText className="w-3 h-3 text-cyan-400 shrink-0" />
                        <span className="truncate text-slate-300">neon-audit.pdf</span>
                        <span className="text-slate-500 ml-auto font-mono">1.8 MB</span>
                      </div>
                    )}
                    {'hasVoice' in msg && msg.hasVoice && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-black/20 border border-white/8 text-[10px]">
                        <Mic className="w-3 h-3 text-teal-400 shrink-0" />
                        <span className="text-slate-300">Voice note · 0:42</span>
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-1 opacity-50">
                      <span className="font-mono text-[9px]">{msg.time}</span>
                      {msg.side === 'right' && (
                        'read' in msg && msg.read
                          ? <CheckCheck className="w-2.5 h-2.5 text-cyan-300" />
                          : <Check className="w-2.5 h-2.5" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Section Header components (avoid hooks inside IIFEs) ──────────────── */
function FeaturesHeader() {
  const { ref, inView } = useScrollReveal();
  return (
    <motion.div ref={ref} variants={fadeUp} initial="hidden" animate={inView ? 'visible' : 'hidden'} className="max-w-2xl">
      <p className="text-xs font-semibold text-cyan-400 uppercase tracking-widest mb-3">What's inside</p>
      <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">Complete messaging &amp; administration stack</h2>
      <p className="text-slate-400 mt-4 leading-relaxed">Every workflow runs against real database transactions, authenticated Pusher events, and server-authorized cloud storage.</p>
    </motion.div>
  );
}

function PreviewHeader() {
  const { ref, inView } = useScrollReveal();
  return (
    <motion.div ref={ref} variants={fadeUp} initial="hidden" animate={inView ? 'visible' : 'hidden'} className="max-w-2xl">
      <p className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-3">Live workspace</p>
      <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">Built for direct and group communication</h2>
      <p className="text-slate-400 mt-4 leading-relaxed">Inspect read receipts, threaded replies, voice notes, and signed attachments inside the live workspace.</p>
    </motion.div>
  );
}

function SecuritySection({ user, navigate }: { user: ReturnType<typeof useAuth>['user']; navigate: (path: string) => void }) {
  const { ref, inView } = useScrollReveal();
  return (
    <motion.div ref={ref} initial="hidden" animate={inView ? 'visible' : 'hidden'} className="glass-card rounded-3xl p-8 sm:p-12 lg:p-16 overflow-hidden relative">
      <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/8 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-72 h-72 bg-indigo-500/8 rounded-full blur-3xl pointer-events-none" />
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-8">
          <motion.div variants={fadeUp} custom={0}>
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-widest mb-3">Zero-trust architecture</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white leading-tight">Authorization verified on every request and realtime event</h2>
          </motion.div>
          <motion.p variants={fadeUp} custom={1} className="text-slate-400 leading-relaxed">
            ChatSphere never trusts user IDs, roles, or ownership flags from the client. Conversation membership is verified in PostgreSQL before loading history, sending messages, or renewing private media URLs.
          </motion.p>
          <motion.div variants={fadeUp} custom={2} className="space-y-3">
            {[
              { icon: Lock, text: 'HttpOnly cookies — no access from JavaScript', accent: '#06B6D4' },
              { icon: Shield, text: 'HMAC CSRF double-submit protection on mutations', accent: '#818CF8' },
              { icon: Globe, text: 'Short-lived signed Cloudinary URLs per member', accent: '#34D399' },
              { icon: Star, text: 'Bcrypt 12 rounds + 6-digit email OTP verification', accent: '#FBBF24' },
            ].map(({ icon: Icon, text, accent }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accent}18`, border: `1px solid ${accent}30` }}>
                  <Icon className="w-4 h-4" style={{ color: accent }} />
                </div>
                <span className="text-sm text-slate-300">{text}</span>
              </div>
            ))}
          </motion.div>
          <motion.div variants={fadeUp} custom={3} className="flex flex-wrap gap-3 pt-2">
            <motion.button suppressHydrationWarning type="button" whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => navigate(user ? '/chat' : '/register')} className="px-6 py-3 text-sm font-semibold bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-950 rounded-xl shadow-lg shadow-cyan-500/20 cursor-pointer">
              {user ? 'Open Workspace' : 'Create Free Account'}
            </motion.button>
            <AppLink href="/login" className="px-5 py-3 text-sm font-medium text-slate-300 hover:text-white border border-white/10 hover:border-white/20 rounded-xl transition-colors">Sign in</AppLink>
          </motion.div>
        </div>
        <motion.div variants={scaleIn} custom={1} className="space-y-4">
          {[
            { quote: 'Moving to transactional PostgreSQL messaging eliminated dropped attachments and gave us verifiable audit trails.', name: 'Elena Rostova', role: 'Director of Platform Engineering', avatar: 'ER', gradient: 'from-indigo-400 to-purple-500' },
            { quote: 'HttpOnly refresh rotation combined with signed Cloudinary URLs passed our external penetration audit without a single token exposure finding.', name: 'Marcus Vance', role: 'Principal Security Architect', avatar: 'MV', gradient: 'from-cyan-400 to-teal-500' },
          ].map((t) => (
            <div key={t.name} className="p-5 rounded-2xl bg-white/4 border border-white/8 space-y-3">
              <p className="text-sm text-slate-200 leading-relaxed">"{t.quote}"</p>
              <div className="flex items-center gap-3 pt-1">
                <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${t.gradient} flex items-center justify-center text-xs font-bold text-white shrink-0`}>{t.avatar}</div>
                <div>
                  <p className="text-xs font-semibold text-white">{t.name}</p>
                  <p className="text-[11px] text-slate-400">{t.role}</p>
                </div>
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
}

function FinalCta({ user, navigate }: { user: ReturnType<typeof useAuth>['user']; navigate: (path: string) => void }) {
  const { ref, inView } = useScrollReveal();
  return (
    <motion.div ref={ref} variants={fadeUp} initial="hidden" animate={inView ? 'visible' : 'hidden'} className="max-w-3xl mx-auto text-center space-y-8">
      <h2 className="text-4xl sm:text-5xl font-bold text-white leading-tight">Ready to build on a <span className="gradient-text">secure foundation</span>?</h2>
      <p className="text-lg text-slate-400">Production-grade real-time messaging. No config required. Start in seconds.</p>
      <div className="flex flex-wrap justify-center gap-4">
        <motion.button suppressHydrationWarning type="button" whileHover={{ scale: 1.04, boxShadow: '0 0 40px rgba(6,182,212,0.4)' }} whileTap={{ scale: 0.96 }} onClick={() => navigate(user ? '/chat' : '/register')} className="group px-8 py-4 text-base font-semibold bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-950 rounded-xl shadow-2xl shadow-cyan-500/25 inline-flex items-center gap-2 cursor-pointer">
          <span suppressHydrationWarning>{user ? 'Go to ChatSphere' : 'Create Free Account'}</span>
          <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
        </motion.button>
      </div>
    </motion.div>
  );
}
export function LandingPage() {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const { scrollY } = useScroll();
  const headerBg = useTransform(scrollY, [0, 80], ['rgba(8,14,26,0)', 'rgba(8,14,26,0.92)']);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const heroRef = useRef<HTMLDivElement>(null);
  const heroInView = useInView(heroRef, { once: true });

  const featureCards = [
    {
      icon: Zap,
      title: 'Idempotent Real-Time Messaging',
      description: 'Client-generated idempotency keys enforce a unique composite constraint in PostgreSQL. Auto-reconnect synchronizes missed updates without duplicates.',
      accent: '#06B6D4',
      badge: 'Core',
    },
    {
      icon: Lock,
      title: 'HttpOnly Cookie Sessions',
      description: 'Zero credentials in localStorage. JWT access + rotating refresh tokens reside strictly in HttpOnly cookies with HMAC CSRF headers.',
      accent: '#818CF8',
      badge: 'Security',
    },
    {
      icon: FileText,
      title: 'Server-Signed Cloud Media',
      description: 'Uploads validate MIME types and binary magic headers before issuing 300s Cloudinary signatures — never touching local server disk.',
      accent: '#34D399',
      badge: 'Media',
    },
    {
      icon: Users,
      title: 'Group & Platform Moderation',
      description: 'Dedicated USER and ADMIN server roles, abuse reporting, instant session termination for suspended accounts, and immutable audit logs.',
      accent: '#FBBF24',
      badge: 'Admin',
    },
    {
      icon: Bell,
      title: 'Web Push Notifications',
      description: 'VAPID-signed push subscriptions with granular controls. Push, email, and in-app notification layers across all devices.',
      accent: '#F472B6',
      badge: 'Notifications',
    },
    {
      icon: Sparkles,
      title: 'AI-Powered Composer',
      description: 'Integrated AI writer with tone control, grammar correction, and sticker generation. Voice transcription converts recordings to text.',
      accent: '#A78BFA',
      badge: 'AI',
    },
  ];

  const navLinks = [
    { href: '#features', label: 'Features' },
    { href: '#preview', label: 'Workspace' },
    { href: '#security', label: 'Security' },
  ];

  return (
    <div className="min-h-screen bg-[#080E1A] text-slate-100 flex flex-col overflow-x-hidden">

      {/* ── Sticky Header ──────────────────────────────────────────────────── */}
      <motion.header
        className="fixed top-0 inset-x-0 z-50 border-b border-white/5"
        style={{ backgroundColor: headerBg as any }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-6 px-5 sm:px-8 h-16">
          {/* Logo */}
          <AppLink href="/" className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <MessageCircle className="w-4 h-4 text-white" />
            </div>
            <span className="text-base font-bold tracking-tight text-white">ChatSphere</span>
          </AppLink>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-7">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-sm font-medium text-slate-400 hover:text-white transition-colors duration-200"
              >
                {l.label}
              </a>
            ))}
            <AppLink
              suppressHydrationWarning
              href={user ? '/chat' : '/login'}
              className="text-sm font-medium text-slate-400 hover:text-white transition-colors duration-200"
            >
              {user ? 'Dashboard' : 'Sign In'}
            </AppLink>
          </nav>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-3 shrink-0">
            <motion.button
              suppressHydrationWarning
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate(user ? '/chat' : '/register')}
              className="px-4 py-2 text-sm font-semibold bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-950 rounded-xl shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-shadow cursor-pointer"
            >
              {user ? 'Launch Chat' : 'Get Started Free'}
            </motion.button>
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <div className="w-5 flex flex-col gap-1.5">
              <span className={`block h-0.5 bg-current transition-all duration-300 ${mobileMenuOpen ? 'rotate-45 translate-y-2' : ''}`} />
              <span className={`block h-0.5 bg-current transition-all duration-300 ${mobileMenuOpen ? 'opacity-0' : ''}`} />
              <span className={`block h-0.5 bg-current transition-all duration-300 ${mobileMenuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
            </div>
          </button>
        </div>

        {/* Mobile menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="md:hidden overflow-hidden border-t border-white/5 bg-[#080E1A]/95 backdrop-blur-xl"
            >
              <div className="px-5 py-4 flex flex-col gap-3">
                {navLinks.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="text-sm font-medium text-slate-300 hover:text-white py-1.5 transition-colors"
                  >
                    {l.label}
                  </a>
                ))}
                <div className="pt-2 border-t border-white/6 flex flex-col gap-2">
                  <AppLink suppressHydrationWarning href={user ? '/chat' : '/login'} className="text-sm font-medium text-slate-300 hover:text-white py-1.5">
                    {user ? 'Dashboard' : 'Sign In'}
                  </AppLink>
                  <button
                    suppressHydrationWarning
                    type="button"
                    onClick={() => { navigate(user ? '/chat' : '/register'); setMobileMenuOpen(false); }}
                    className="w-full py-2.5 text-sm font-semibold bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-950 rounded-xl cursor-pointer"
                  >
                    {user ? 'Launch Chat' : 'Get Started Free'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>

      {/* ── Hero Section ───────────────────────────────────────────────────── */}
      <section ref={heroRef} className="relative min-h-screen flex items-center pt-16 pb-16 px-5 sm:px-8 overflow-hidden">
        {/* Background elements */}
        <div className="absolute inset-0 animated-bg" />
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
        <div className="absolute top-24 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-cyan-600/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-32 right-0 w-[500px] h-[500px] bg-indigo-600/5 rounded-full blur-3xl pointer-events-none" />

        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.015] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />

        <div className="relative z-10 max-w-7xl mx-auto w-full">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: Copy */}
            <div className="space-y-8">
              {/* Badge */}
              <motion.div
                variants={fadeUp}
                initial="hidden"
                animate={heroInView ? 'visible' : 'hidden'}
                custom={0}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium bg-cyan-500/10 border border-cyan-500/25 text-cyan-300"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Production-grade real-time messaging
              </motion.div>

              {/* Headline */}
              <motion.h1
                variants={fadeUp}
                initial="hidden"
                animate={heroInView ? 'visible' : 'hidden'}
                custom={1}
                className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.06]"
              >
                <span className="text-white">Messaging</span>
                <br />
                <span className="gradient-text">engineered</span>
                <br />
                <span className="text-white">for security.</span>
              </motion.h1>

              {/* Subtext */}
              <motion.p
                variants={fadeUp}
                initial="hidden"
                animate={heroInView ? 'visible' : 'hidden'}
                custom={2}
                className="text-lg text-slate-400 leading-relaxed max-w-lg"
              >
                Direct conversations, group channels, voice notes, and private cloud media — backed by transactional PostgreSQL and HttpOnly session isolation.
              </motion.p>

              {/* CTA row */}
              <motion.div
                variants={fadeUp}
                initial="hidden"
                animate={heroInView ? 'visible' : 'hidden'}
                custom={3}
                className="flex flex-wrap items-center gap-4"
              >
                <motion.button
                  suppressHydrationWarning
                  type="button"
                  whileHover={{ scale: 1.04, boxShadow: '0 0 32px rgba(6,182,212,0.35)' }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => navigate(user ? '/chat' : '/register')}
                  className="group px-6 py-3.5 text-sm font-semibold bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-950 rounded-xl shadow-xl shadow-cyan-500/25 inline-flex items-center gap-2 cursor-pointer"
                >
                  <span suppressHydrationWarning>{user ? 'Open ChatSphere' : 'Start for Free'}</span>
                  <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
                </motion.button>

                <motion.div whileHover={{ scale: 1.02 }}>
                  <AppLink
                    suppressHydrationWarning
                    href={user ? '/profile' : '/login'}
                    className="px-5 py-3.5 text-sm font-medium text-slate-300 hover:text-white border border-white/10 hover:border-white/20 rounded-xl transition-all duration-200 inline-flex items-center gap-2 backdrop-blur-sm"
                  >
                    {user ? 'Account Settings' : 'Sign in'}
                    <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                  </AppLink>
                </motion.div>
              </motion.div>

              {/* Trust strip */}
              <motion.div
                variants={fadeIn}
                initial="hidden"
                animate={heroInView ? 'visible' : 'hidden'}
                custom={5}
                className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-4 border-t border-white/6 text-xs text-slate-500"
              >
                {['HttpOnly JWT rotation', 'Email OTP + Google OAuth', 'Signed Cloudinary uploads', 'Zero localStorage tokens'].map((t) => (
                  <span key={t} className="flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-cyan-500" />
                    {t}
                  </span>
                ))}
              </motion.div>
            </div>

            {/* Right: Hero graphic */}
            <motion.div
              variants={scaleIn}
              initial="hidden"
              animate={heroInView ? 'visible' : 'hidden'}
              custom={1}
              className="relative"
            >
              <HeroGraphic />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Stats Strip ─────────────────────────────────────────────────────── */}
      <section className="py-14 border-y border-white/5 bg-white/1">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 grid grid-cols-2 lg:grid-cols-4 gap-8">
          <StatBadge value="100%" label="PostgreSQL persisted before message acknowledgment" />
          <StatBadge value="12×" label="Bcrypt rounds + hashed 6-digit OTP" />
          <StatBadge value="300s" label="Signed Cloudinary URL TTL per member" />
          <StatBadge value="0 B" label="Credentials or tokens in localStorage" />
        </div>
      </section>

      {/* ── Features Grid ───────────────────────────────────────────────────── */}
      <section id="features" className="py-24 px-5 sm:px-8">
        <div className="max-w-7xl mx-auto space-y-14">
          {/* Section header */}
          <FeaturesHeader />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {featureCards.map((card, i) => (
              <FeatureCard key={card.title} {...card} delay={i * 0.08} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Workspace Preview ───────────────────────────────────────────────── */}
      <section id="preview" className="py-24 px-5 sm:px-8 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-indigo-900/5 to-transparent pointer-events-none" />
        <div className="max-w-7xl mx-auto space-y-12 relative z-10">
          <PreviewHeader />
          <WorkspacePreview />
        </div>
      </section>

      {/* ── Security Section ────────────────────────────────────────────────── */}
      <section id="security" className="py-24 px-5 sm:px-8">
        <div className="max-w-7xl mx-auto">
          <SecuritySection user={user} navigate={navigate} />
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────────── */}
      <section className="py-24 px-5 sm:px-8">
        <FinalCta user={user} navigate={navigate} />
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="mt-auto border-t border-white/5 py-10 px-5 sm:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 flex items-center justify-center">
              <MessageCircle className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">ChatSphere</p>
              <p suppressHydrationWarning className="text-xs text-slate-500">© {new Date().getFullYear()} ChatSphere. Real-time messaging platform.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-xs text-slate-500">
            <AppLink href="/login" className="hover:text-white transition-colors">Sign In</AppLink>
            <AppLink href="/register" className="hover:text-white transition-colors">Register</AppLink>
            <AppLink href="/forgot-password" className="hover:text-white transition-colors">Reset Password</AppLink>
          </div>
        </div>
      </footer>
    </div>
  );
}
