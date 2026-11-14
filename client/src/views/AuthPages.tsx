'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Lock, Mail, MessageCircle, RefreshCw, User } from 'lucide-react';
import { apiClient, extractApiError } from '../lib/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { AppLink, useRouter, useRouterSearchParams } from '../context/RouterContext.tsx';
import type { AuthUser } from '../types/models.ts';

// Ephemeral in-memory notice strictly for local/sandbox development when external SMTP isn't configured
let pendingDevVerificationHint: { email: string; code?: string; previewUrl?: string } | null = null;

const loginFormSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
type LoginFormValues = z.infer<typeof loginFormSchema>;

const registerFormSchema = z.object({
  displayName: z.string().trim().min(2, 'Display name must be at least 2 characters.').max(60),
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters.')
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, 'Use letters, numbers, and underscores only.'),
  email: z.string().trim().email('Enter a valid email address.'),
  password: z
    .string()
    .min(8, 'At least 8 characters required.')
    .regex(/[A-Z]/, 'Include at least one uppercase letter.')
    .regex(/[a-z]/, 'Include at least one lowercase letter.')
    .regex(/[0-9]/, 'Include at least one number.'),
});
type RegisterFormValues = z.infer<typeof registerFormSchema>;

const verifyOtpFormSchema = z.object({
  email: z.string().trim().email('Enter your registered email address.'),
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit verification code.'),
});
type VerifyOtpFormValues = z.infer<typeof verifyOtpFormSchema>;

const forgotFormSchema = z.object({
  email: z.string().trim().email('Enter your account email address.'),
});
type ForgotFormValues = z.infer<typeof forgotFormSchema>;

const resetFormSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'At least 8 characters required.')
      .regex(/[A-Z]/, 'Include at least one uppercase letter.')
      .regex(/[a-z]/, 'Include at least one lowercase letter.')
      .regex(/[0-9]/, 'Include at least one number.'),
    confirmPassword: z.string().min(1, 'Confirm your new password.'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });
type ResetFormValues = z.infer<typeof resetFormSchema>;

function AuthCardLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#080E1A] text-slate-100 flex flex-col justify-between px-4 py-8 relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-cyan-600/6 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[300px] bg-indigo-600/6 rounded-full blur-3xl pointer-events-none" />
      {/* Grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.012] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />

      <div className="max-w-md w-full mx-auto relative z-10">
        <AppLink
          href="/"
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-200 transition-colors duration-200"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to ChatSphere</span>
        </AppLink>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="max-w-md w-full mx-auto my-8 relative z-10"
      >
        {/* Card */}
        <div className="glass-card rounded-2xl p-7 sm:p-8 space-y-6 border border-white/8 shadow-2xl shadow-black/40">
          {/* Header */}
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                <MessageCircle className="w-4.5 h-4.5 text-white" />
              </div>
              <span className="text-xs font-semibold text-cyan-400 tracking-wide">ChatSphere</span>
            </div>
            <h1 className="max-w-full break-words text-xl sm:text-2xl font-bold leading-snug tracking-normal text-white">
              {title}
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">{subtitle}</p>
          </div>
          {children}
        </div>
      </motion.div>

      <div className="max-w-md w-full mx-auto text-center text-xs text-slate-600 relative z-10">
        Protected by HttpOnly cookie sessions &amp; CSRF verification
      </div>
    </div>
  );
}

/* ─── Shared styled input ─────────────────────────────────────────────────── */
function AuthInput({
  id,
  label,
  error,
  icon: Icon,
  rightSlot,
  ...inputProps
}: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string;
  icon?: React.ElementType;
  rightSlot?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-300 mb-1.5">
        {label}
      </label>
      <div
        className={`relative rounded-xl transition-all duration-200 ${
          focused ? 'ring-1 ring-cyan-500/60 shadow-lg shadow-cyan-500/10' : ''
        }`}
      >
        {Icon && (
          <Icon className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors duration-200 ${focused ? 'text-cyan-400' : 'text-slate-500'}`} />
        )}
        <input
          id={id}
          {...inputProps}
          onFocus={(e) => { setFocused(true); inputProps.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); inputProps.onBlur?.(e); }}
          className={`w-full ${Icon ? 'pl-10' : 'pl-3.5'} ${rightSlot ? 'pr-10' : 'pr-3.5'} py-2.5 text-sm rounded-xl bg-white/4 border ${error ? 'border-red-500/50' : 'border-white/8'} text-white placeholder:text-slate-600 focus:outline-none transition-colors duration-200 ${inputProps.className || ''}`}
        />
        {rightSlot && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">{rightSlot}</div>
        )}
      </div>
      {error && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-red-400 mt-1.5 flex items-center gap-1"
        >
          {error}
        </motion.p>
      )}
    </div>
  );
}

/* ─── Primary submit button ─────────────────────────────────────────────── */
function AuthSubmitButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <motion.button
      type="submit"
      disabled={loading}
      whileHover={!loading ? { scale: 1.02, boxShadow: '0 0 24px rgba(6,182,212,0.3)' } : {}}
      whileTap={!loading ? { scale: 0.97 } : {}}
      className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-950 font-semibold text-sm shadow-lg shadow-cyan-500/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <span className="w-4 h-4 rounded-full border-2 border-slate-950/30 border-t-slate-950 animate-spin" />
          {children}
        </span>
      ) : (
        children
      )}
    </motion.button>
  );
}

function GoogleOAuthButton() {
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      const res = await apiClient.get<{
        success: boolean;
        data: { url: string };
      }>('/auth/google/url');
      const url = res.data?.data?.url;
      if (typeof url !== 'string') {
        throw new Error('Google sign-in could not be started. Please try again.');
      }
      window.location.assign(url);
    } catch (err) {
      toast.error(extractApiError(err).message);
      setGoogleLoading(false);
    }
  };

  return (
    <motion.button
      type="button"
      onClick={() => void handleGoogleLogin()}
      disabled={googleLoading}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      className="w-full py-2.5 px-4 rounded-xl border border-white/10 bg-white/4 hover:bg-white/7 text-sm font-medium text-white flex items-center justify-center gap-2.5 transition-all duration-200 cursor-pointer disabled:opacity-50"
    >
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.8-5.5 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.8 9.1-9.2 0-.6-.1-1.1-.2-1.6H12z" />
      </svg>
      <span>{googleLoading ? 'Connecting to Google…' : 'Continue with Google'}</span>
    </motion.button>
  );
}

export function LoginPage() {
  const { setAuthenticatedUser, refreshUser } = useAuth();
  const { navigate } = useRouter();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
  });

  const onSubmit = async (values: LoginFormValues) => {
    try {
      const res = await apiClient.post<{
        success: boolean;
        data: { user: AuthUser };
      }>('/auth/login', values);
      setAuthenticatedUser(res.data.data.user);
      toast.success('Welcome back to ChatSphere.');
      navigate('/chat');
    } catch (err) {
      const parsed = extractApiError(err);
      if (parsed.code === 'EMAIL_UNVERIFIED') {
        toast('Please verify your email with your 6-digit OTP.');
        navigate(`/verify-email?email=${encodeURIComponent(values.email)}`);
        return;
      }
      toast.error(parsed.message);
    }
  };

  return (
    <AuthCardLayout
      title="Sign in to your account"
      subtitle="Access your real-time conversations and workspaces."
    >
      <GoogleOAuthButton />

      <div className="flex items-center gap-3 text-xs text-slate-600">
        <div className="flex-1 h-px bg-white/6" />
        <span>or continue with email</span>
        <div className="flex-1 h-px bg-white/6" />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <AuthInput
          id="login-email"
          label="Email address"
          type="email"
          autoComplete="email"
          placeholder="name@company.com"
          icon={Mail}
          error={errors.email?.message}
          {...register('email')}
        />

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="login-password" className="text-xs font-medium text-slate-300">Password</label>
            <AppLink href="/forgot-password" className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
              Forgot password?
            </AppLink>
          </div>
          <AuthInput
            id="login-password"
            label=""
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            icon={Lock}
            error={errors.password?.message}
            rightSlot={
              <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="text-slate-500 hover:text-slate-200 transition-colors cursor-pointer">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            }
            {...register('password')}
          />
        </div>

        <AuthSubmitButton loading={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign In'}
        </AuthSubmitButton>
      </form>

      <p className="text-xs text-center text-slate-500">
        New to ChatSphere?{' '}
        <AppLink href="/register" className="text-cyan-400 hover:text-cyan-300 font-medium transition-colors">
          Create an account
        </AppLink>
      </p>
    </AuthCardLayout>
  );
}

export function RegisterPage() {
  const { navigate } = useRouter();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
  });

  const onSubmit = async (values: RegisterFormValues) => {
    try {
      const res = await apiClient.post<{
        success: boolean;
        data: {
          email: string;
          message: string;
          devMailNotice?: { sandboxCode?: string; previewUrl?: string };
        };
      }>('/auth/register', values);

      if (res.data.data.devMailNotice) {
        pendingDevVerificationHint = {
          email: values.email.toLowerCase(),
          code: res.data.data.devMailNotice.sandboxCode,
          previewUrl: res.data.data.devMailNotice.previewUrl,
        };
      } else {
        pendingDevVerificationHint = null;
      }

      toast.success('Verification code sent! Check your email to activate your account.');
      navigate(`/verify-email?email=${encodeURIComponent(values.email.toLowerCase())}`);
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  return (
    <AuthCardLayout
      title="Create your ChatSphere account"
      subtitle="Register with a verified email address to start messaging."
    >
      <GoogleOAuthButton />

      <div className="flex items-center gap-3 text-xs text-slate-600">
        <div className="flex-1 h-px bg-white/6" />
        <span>or continue with email</span>
        <div className="flex-1 h-px bg-white/6" />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <AuthInput
          id="reg-name"
          label="Full or display name"
          type="text"
          autoComplete="name"
          placeholder="Elena Rostova"
          icon={User}
          error={errors.displayName?.message}
          {...register('displayName')}
        />

        <AuthInput
          id="reg-username"
          label="Username"
          type="text"
          autoComplete="username"
          placeholder="elena_rostova"
          icon={User}
          error={errors.username?.message}
          className="font-mono"
          {...register('username')}
        />

        <AuthInput
          id="reg-email"
          label="Work or personal email"
          type="email"
          autoComplete="email"
          placeholder="elena@company.com"
          icon={Mail}
          error={errors.email?.message}
          {...register('email')}
        />

        <AuthInput
          id="reg-password"
          label="Password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder="Min 8 chars, upper, lower & number"
          icon={Lock}
          error={errors.password?.message}
          rightSlot={
            <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? 'Hide' : 'Show'} className="text-slate-500 hover:text-slate-200 transition-colors cursor-pointer">
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          }
          {...register('password')}
        />

        <AuthSubmitButton loading={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Register & Send OTP'}
        </AuthSubmitButton>
      </form>

      <p className="text-xs text-center text-slate-500">
        Already have an account?{' '}
        <AppLink href="/login" className="text-cyan-400 hover:text-cyan-300 font-medium transition-colors">
          Sign in
        </AppLink>
      </p>
    </AuthCardLayout>
  );
}

export function VerifyEmailPage() {
  const { navigate } = useRouter();
  const { searchParams } = useRouterSearchParams();
  const { setAuthenticatedUser } = useAuth();
  const initialEmail = searchParams.get('email') || pendingDevVerificationHint?.email || '';

  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [sandboxHint, setSandboxHint] = useState(() =>
    pendingDevVerificationHint && pendingDevVerificationHint.email === initialEmail.toLowerCase()
      ? pendingDevVerificationHint
      : null
  );

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<VerifyOtpFormValues>({
    resolver: zodResolver(verifyOtpFormSchema),
    defaultValues: { email: initialEmail, otp: '' },
  });

  const watchedEmail = watch('email');

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const onSubmit = async (values: VerifyOtpFormValues) => {
    try {
      const res = await apiClient.post<{
        success: boolean;
        data: { user: AuthUser };
      }>('/auth/verify-email', values);
      pendingDevVerificationHint = null;
      setAuthenticatedUser(res.data.data.user);
      toast.success('Email verified! Your ChatSphere account is now active.');
      navigate('/chat');
    } catch (err) {
      const parsed = extractApiError(err);
      if (parsed.code === 'ALREADY_VERIFIED') {
        toast.success('Your email is already verified. Sign in to continue.');
        navigate('/login', { replace: true });
        return;
      }
      toast.error(parsed.message);
    }
  };

  const handleResend = async () => {
    if (!watchedEmail) {
      toast.error('Enter your email address first.');
      return;
    }
    setResending(true);
    try {
      const res = await apiClient.post<{
        success: boolean;
        data: {
          cooldownSeconds: number;
          message: string;
          devMailNotice?: { sandboxCode?: string; previewUrl?: string };
        };
      }>('/auth/resend-otp', { email: watchedEmail });

      setCooldown(res.data.data.cooldownSeconds || 60);
      if (res.data.data.devMailNotice) {
        const nextHint = {
          email: watchedEmail.toLowerCase(),
          code: res.data.data.devMailNotice.sandboxCode,
          previewUrl: res.data.data.devMailNotice.previewUrl,
        };
        pendingDevVerificationHint = nextHint;
        setSandboxHint(nextHint);
      }
      toast.success('A fresh 6-digit verification code has been sent.');
    } catch (err) {
      const parsed = extractApiError(err);
      if (typeof parsed.details?.retryAfterSeconds === 'number') {
        setCooldown(parsed.details.retryAfterSeconds);
      }
      toast.error(parsed.message);
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthCardLayout
      title="Verify your email address"
      subtitle="Enter the 6-digit one-time verification code sent to your inbox."
    >
      {sandboxHint?.code && (
        <div className="p-3.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-xs space-y-1.5">
          <p className="font-semibold text-cyan-300">
            Development Mail Sink (SMTP not configured in environment)
          </p>
          <p className="text-slate-300">
            Sandbox OTP code:{' '}
            <button
              type="button"
              onClick={() => setValue('otp', sandboxHint.code || '')}
              className="font-mono font-bold text-cyan-300 underline cursor-pointer"
            >
              {sandboxHint.code}
            </button>{' '}
            (click to fill)
          </p>
          {sandboxHint.previewUrl && (
            <a
              href={sandboxHint.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 underline inline-block"
            >
              Open Ethereal Email Preview
            </a>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <label htmlFor="otp-email" className="block text-xs font-medium text-slate-300 mb-1.5">
            Email address
          </label>
          <input
            id="otp-email"
            type="email"
            {...register('email')}
            className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
          />
          {errors.email && <p className="text-xs text-red-400 mt-1">{errors.email.message}</p>}
        </div>

        <div>
          <label htmlFor="otp-code" className="block text-xs font-medium text-slate-300 mb-1.5">
            6-digit OTP code
          </label>
          <input
            id="otp-code"
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            {...register('otp')}
            className="w-full px-4 py-3 text-center tracking-[0.5em] font-mono text-xl rounded-lg bg-slate-950 border border-slate-800 text-cyan-300 focus:outline-none focus:border-cyan-500 tabular-nums"
          />
          {errors.otp && <p className="text-xs text-red-400 mt-1">{errors.otp.message}</p>}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 px-4 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer disabled:opacity-60"
        >
          {isSubmitting ? 'Verifying...' : 'Verify & Activate Account'}
        </button>
      </form>

      <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
        <span>Didn’t receive the email?</span>
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={cooldown > 0 || resending}
          className="inline-flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 disabled:text-slate-500 font-medium tabular-nums cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${resending ? 'animate-spin' : ''}`} />
          <span>{cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}</span>
        </button>
      </div>
    </AuthCardLayout>
  );
}

export function ForgotPasswordPage() {
  const { navigate } = useRouter();
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);
  const [devResetToken, setDevResetToken] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotFormValues>({
    resolver: zodResolver(forgotFormSchema),
  });

  const onSubmit = async (values: ForgotFormValues) => {
    try {
      const res = await apiClient.post<{
        success: boolean;
        data: {
          message: string;
          devResetNotice?: { sandboxResetToken?: string };
        };
      }>('/auth/forgot-password', values);

      setSubmittedMessage(res.data.data.message);
      if (res.data.data.devResetNotice?.sandboxResetToken) {
        setDevResetToken(res.data.data.devResetNotice.sandboxResetToken);
      }
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  return (
    <AuthCardLayout
      title="Reset your password"
      subtitle="Enter your registered email and we will send a time-limited reset link."
    >
      {submittedMessage ? (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-sm text-slate-200">{submittedMessage}</p>
          </div>

          {devResetToken && (
            <div className="p-3.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-xs space-y-2">
              <p className="font-semibold text-cyan-300">
                Development Mail Sink (SMTP not configured)
              </p>
              <button
                type="button"
                onClick={() =>
                  navigate(`/reset-password?token=${encodeURIComponent(devResetToken)}`)
                }
                className="btn btn-xs btn-primary"
              >
                Open Sandbox Password Reset Link
              </button>
            </div>
          )}

          <AppLink
            href="/login"
            className="block w-full text-center py-2.5 px-4 rounded-lg border border-slate-700 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
          >
            Return to Sign In
          </AppLink>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="forgot-email" className="block text-xs font-medium text-slate-300 mb-1.5">
              Account email address
            </label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              placeholder="name@company.com"
              {...register('email')}
              className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
            />
            {errors.email && <p className="text-xs text-red-400 mt-1">{errors.email.message}</p>}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer disabled:opacity-60"
          >
            {isSubmitting ? 'Sending instructions...' : 'Send Reset Link'}
          </button>

          <p className="text-xs text-center text-slate-400">
            Remembered your password?{' '}
            <AppLink href="/login" className="text-cyan-400 hover:text-cyan-300 font-medium">
              Sign in
            </AppLink>
          </p>
        </form>
      )}
    </AuthCardLayout>
  );
}

export function ResetPasswordPage() {
  const { navigate } = useRouter();
  const { searchParams } = useRouterSearchParams();
  const token = searchParams.get('token') || '';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetFormValues>({
    resolver: zodResolver(resetFormSchema),
  });

  const onSubmit = async (values: ResetFormValues) => {
    if (!token) {
      toast.error('Reset token is missing from the URL.');
      return;
    }
    try {
      await apiClient.post('/auth/reset-password', {
        token,
        newPassword: values.newPassword,
      });
      toast.success('Password updated! Sign in with your new credentials.');
      navigate('/login');
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  return (
    <AuthCardLayout
      title="Choose a new password"
      subtitle="Updating your password immediately revokes any older active sessions."
    >
      {!token ? (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200 flex items-center gap-2.5">
            <KeyRound className="w-4 h-4 shrink-0" />
            <span>Missing password reset token. Request a fresh link from Forgot Password.</span>
          </div>
          <AppLink
            href="/forgot-password"
            className="block w-full text-center py-2.5 px-4 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-sm"
          >
            Request New Reset Link
          </AppLink>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="new-pass" className="block text-xs font-medium text-slate-300 mb-1.5">
              New password
            </label>
            <input
              id="new-pass"
              type="password"
              autoComplete="new-password"
              placeholder="Min 8 chars, upper, lower & number"
              {...register('newPassword')}
              className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
            />
            {errors.newPassword && (
              <p className="text-xs text-red-400 mt-1">{errors.newPassword.message}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="confirm-pass"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Confirm new password
            </label>
            <input
              id="confirm-pass"
              type="password"
              autoComplete="new-password"
              placeholder="Re-enter your new password"
              {...register('confirmPassword')}
              className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-cyan-500"
            />
            {errors.confirmPassword && (
              <p className="text-xs text-red-400 mt-1">{errors.confirmPassword.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer disabled:opacity-60"
          >
            {isSubmitting ? 'Updating password...' : 'Save New Password'}
          </button>
        </form>
      )}
    </AuthCardLayout>
  );
}

export function GoogleCallbackPage() {
  const { navigate } = useRouter();
  const { searchParams } = useRouterSearchParams();
  const { refreshUser } = useAuth();
  const status = searchParams.get('status');
  const reason = searchParams.get('reason');

  useEffect(() => {
    if (status === 'success') {
      void refreshUser().then((u) => {
        if (u) {
          toast.success(`Signed in as ${u.displayName}`);
          navigate('/chat', { replace: true });
        } else {
          navigate('/login', { replace: true });
        }
      });
    }
  }, [status, refreshUser, navigate]);

  return (
    <AuthCardLayout
      title="Google Authentication"
      subtitle={
        status === 'error'
          ? 'Google sign-in could not be completed.'
          : 'Completing secure OAuth session handshake...'
      }
    >
      {status === 'error' ? (
        <div className="space-y-4">
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3.5">
            {reason || 'Unable to verify Google OAuth callback.'}
          </p>
          <AppLink
            href="/login"
            className="block w-full text-center py-2.5 px-4 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-sm"
          >
            Back to Sign In
          </AppLink>
        </div>
      ) : (
        <div className="flex items-center justify-center py-8">
          <span className="loading loading-spinner loading-md text-cyan-400" />
        </div>
      )}
    </AuthCardLayout>
  );
}
