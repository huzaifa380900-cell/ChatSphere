'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Camera, Laptop, LogOut, Shield, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, extractApiError, uploadMediaToCloudinary } from '../lib/api.ts';
import { DashboardShell } from '../components/DashboardShell.tsx';
import { Avatar } from '../components/Avatar.tsx';
import type { ActiveSessionItem, AuthUser, UserSettings } from '../types/models.ts';

const profileSchema = z.object({
  displayName: z.string().trim().min(2, 'Display name must be at least 2 characters.').max(60),
  bio: z.string().trim().max(300, 'Bio cannot exceed 300 characters.'),
  customStatus: z.string().trim().max(80, 'Status cannot exceed 80 characters.'),
});
type ProfileFormValues = z.infer<typeof profileSchema>;

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters.')
    .regex(/[A-Z]/, 'Include at least one uppercase letter.')
    .regex(/[a-z]/, 'Include at least one lowercase letter.')
    .regex(/[0-9]/, 'Include at least one number.'),
});
type PasswordFormValues = z.infer<typeof passwordChangeSchema>;

export function ProfileSettingsPage() {
  const { user, setAuthenticatedUser, theme, setThemePreference, logout } = useAuth();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarProgress, setAvatarProgress] = useState<number | null>(null);
  const [sessions, setSessions] = useState<ActiveSessionItem[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: user?.displayName || '',
      bio: user?.bio || '',
      customStatus: user?.presence?.customStatus || '',
    },
  });

  const passwordForm = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordChangeSchema),
  });

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await apiClient.get<{
        success: boolean;
        data: { currentSessionId: string; sessions: ActiveSessionItem[] };
      }>('/auth/sessions');
      setSessions(res.data.data.sessions);
      setCurrentSessionId(res.data.data.currentSessionId);
    } catch {
      // Ignore
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setAvatarProgress(0);
    try {
      const staged = await uploadMediaToCloudinary({
        file,
        purpose: 'AVATAR',
        onProgress: (pct) => setAvatarProgress(pct),
      });

      const res = await apiClient.patch<{
        success: boolean;
        data: { user: AuthUser };
      }>('/users/me/profile', { avatarAttachmentId: staged.id });
      setAuthenticatedUser(res.data.data.user);
      toast.success('Profile avatar updated via Cloudinary.');
    } catch (err) {
      toast.error(extractApiError(err).message);
    } finally {
      setAvatarProgress(null);
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      const res = await apiClient.patch<{
        success: boolean;
        data: { user: AuthUser };
      }>('/users/me/profile', { avatarAttachmentId: null });
      setAuthenticatedUser(res.data.data.user);
      toast.success('Profile avatar removed.');
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const onSaveProfile = async (values: ProfileFormValues) => {
    try {
      const res = await apiClient.patch<{
        success: boolean;
        data: { user: AuthUser };
      }>('/users/me/profile', {
        displayName: values.displayName,
        bio: values.bio,
        customStatus: values.customStatus || null,
      });
      setAuthenticatedUser(res.data.data.user);
      toast.success('Profile saved.');
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const handleToggleSetting = async (key: keyof UserSettings, value: boolean) => {
    try {
      const res = await apiClient.patch<{
        success: boolean;
        data: { settings: UserSettings };
      }>('/users/me/settings', { [key]: value });
      if (user) {
        setAuthenticatedUser({ ...user, settings: res.data.data.settings });
      }
      toast.success('Preference updated.');
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const onChangePassword = async (values: PasswordFormValues) => {
    try {
      await apiClient.post('/users/me/password', values);
      passwordForm.reset();
      await loadSessions();
      toast.success('Password updated and other sessions signed out.');
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const handleRevokeSession = async (id: string) => {
    try {
      await apiClient.delete(`/auth/sessions/${id}`);
      await loadSessions();
      toast.success('Device session revoked.');
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const handleLogoutAllDevices = async () => {
    try {
      await apiClient.post('/auth/logout-all');
      await logout();
      toast.success('Signed out across all devices.');
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const settings = user?.settings;

  return (
    <DashboardShell
      title="Profile & Settings"
      subtitle="Manage your identity, privacy controls, cloud avatar, and active device sessions"
    >
      <div className="max-w-4xl mx-auto space-y-6 pb-8">
        {/* Identity & Avatar Section */}
        <section className="p-6 rounded-xl bg-base-200 border border-base-300 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-base-300">
            <div className="flex items-center gap-4">
              <Avatar src={user?.avatarUrl} name={user?.displayName || 'User'} size="xl" />
              <div className="space-y-1">
                <h2 className="text-lg font-bold">{user?.displayName}</h2>
                <p className="text-xs text-base-content/65 font-mono">
                  @{user?.username} · {user?.email} · {user?.role}
                </p>
                {avatarProgress !== null && (
                  <p className="text-xs text-primary font-mono tabular-nums">
                    Uploading avatar to Cloudinary: {avatarProgress}%
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleAvatarUpload}
                className="hidden"
              />
              <button
                type="button"
                disabled={avatarProgress !== null}
                onClick={() => avatarInputRef.current?.click()}
                className="btn btn-sm btn-primary gap-1.5"
              >
                <Camera className="w-4 h-4" />
                <span>Upload Avatar</span>
              </button>
              {user?.avatarUrl && (
                <button
                  type="button"
                  onClick={() => void handleRemoveAvatar()}
                  className="btn btn-sm btn-ghost text-error gap-1"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Remove</span>
                </button>
              )}
            </div>
          </div>

          <form onSubmit={profileForm.handleSubmit(onSaveProfile)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5">Display name</label>
                <input
                  type="text"
                  {...profileForm.register('displayName')}
                  className="w-full px-3.5 py-2 text-sm rounded-lg bg-base-100 border border-base-300 focus:outline-none focus:border-primary"
                />
                {profileForm.formState.errors.displayName && (
                  <p className="text-xs text-error mt-1">
                    {profileForm.formState.errors.displayName.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5">Custom presence note</label>
                <input
                  type="text"
                  placeholder="In deep work until 3 PM"
                  {...profileForm.register('customStatus')}
                  className="w-full px-3.5 py-2 text-sm rounded-lg bg-base-100 border border-base-300 focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5">Bio</label>
              <textarea
                rows={3}
                placeholder="Share your team role or focus areas..."
                {...profileForm.register('bio')}
                className="w-full p-3 text-sm rounded-lg bg-base-100 border border-base-300 focus:outline-none focus:border-primary"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={profileForm.formState.isSubmitting}
                className="btn btn-sm btn-primary"
              >
                {profileForm.formState.isSubmitting ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        </section>

        {/* Privacy, Theme & Notification Controls */}
        <section className="p-6 rounded-xl bg-base-200 border border-base-300 space-y-4">
          <h3 className="text-base font-semibold">Appearance, Privacy &amp; Notifications</h3>

          <div className="divide-y divide-base-300/60 text-sm">
            <div className="py-3 flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">Interface Theme</p>
                <p className="text-xs text-base-content/60">
                  Synchronized with your PostgreSQL account settings across devices
                </p>
              </div>
              <div className="inline-flex p-1 rounded-lg bg-base-100 border border-base-300 gap-1">
                <button
                  type="button"
                  onClick={() => void setThemePreference('dark')}
                  className={`px-3 py-1 text-xs rounded-md cursor-pointer ${
                    theme === 'dark' ? 'bg-primary text-primary-content font-semibold' : ''
                  }`}
                >
                  Dark Navy
                </button>
                <button
                  type="button"
                  onClick={() => void setThemePreference('light')}
                  className={`px-3 py-1 text-xs rounded-md cursor-pointer ${
                    theme === 'light' ? 'bg-primary text-primary-content font-semibold' : ''
                  }`}
                >
                  Crisp Light
                </button>
              </div>
            </div>

            {(
              [
                [
                  'onlineStatusVisible',
                  'Share Online Presence',
                  'Allow peers to see when you are online or last active',
                ],
                [
                  'readReceiptsEnabled',
                  'Send Read Receipts',
                  'Let conversation members see when you have read messages',
                ],
                [
                  'typingIndicatorsEnabled',
                  'Broadcast Typing Indicators',
                  'Show live typing indicators while composing messages',
                ],
                [
                  'desktopNotifications',
                  'In-App Real-Time Notifications',
                  'Receive instant alerts for mentions and direct messages',
                ],
                [
                  'emailNotifications',
                  'Security & Account Emails',
                  'Receive important security notices at your verified email',
                ],
              ] as const
            ).map(([key, label, desc]) => (
              <label
                key={key}
                className="py-3 flex items-center justify-between gap-4 cursor-pointer"
              >
                <div>
                  <p className="font-medium">{label}</p>
                  <p className="text-xs text-base-content/60">{desc}</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings ? Boolean(settings[key]) : true}
                  onChange={(e) => void handleToggleSetting(key, e.target.checked)}
                  className="toggle toggle-primary toggle-sm"
                />
              </label>
            ))}
          </div>
        </section>

        {/* Password Security */}
        <section className="p-6 rounded-xl bg-base-200 border border-base-300 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <h3 className="text-base font-semibold">Change Password</h3>
          </div>

          <form
            onSubmit={passwordForm.handleSubmit(onChangePassword)}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end"
          >
            <div>
              <label className="block text-xs font-medium mb-1.5">Current password</label>
              <input
                type="password"
                autoComplete="current-password"
                {...passwordForm.register('currentPassword')}
                className="w-full px-3.5 py-2 text-sm rounded-lg bg-base-100 border border-base-300 focus:outline-none focus:border-primary"
              />
              {passwordForm.formState.errors.currentPassword && (
                <p className="text-xs text-error mt-1">
                  {passwordForm.formState.errors.currentPassword.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5">New password</label>
              <input
                type="password"
                autoComplete="new-password"
                {...passwordForm.register('newPassword')}
                className="w-full px-3.5 py-2 text-sm rounded-lg bg-base-100 border border-base-300 focus:outline-none focus:border-primary"
              />
              {passwordForm.formState.errors.newPassword && (
                <p className="text-xs text-error mt-1">
                  {passwordForm.formState.errors.newPassword.message}
                </p>
              )}
            </div>

            <div className="sm:col-span-2 flex justify-end">
              <button
                type="submit"
                disabled={passwordForm.formState.isSubmitting}
                className="btn btn-sm btn-primary"
              >
                {passwordForm.formState.isSubmitting ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        </section>

        {/* Active Multi-Device Sessions */}
        <section className="p-6 rounded-xl bg-base-200 border border-base-300 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold">Active Sessions</h3>
              <p className="text-xs text-base-content/60">
                Manage devices signed into your account via rotating HttpOnly refresh tokens.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleLogoutAllDevices()}
              className="btn btn-xs btn-outline btn-error gap-1.5 whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out Everywhere</span>
            </button>
          </div>

          {loadingSessions ? (
            <p className="text-xs text-base-content/60">Loading active sessions...</p>
          ) : (
            <div className="divide-y divide-base-300/60">
              {sessions.map((sess) => {
                const isCurrent = sess.id === currentSessionId;
                return (
                  <div
                    key={sess.id}
                    className="py-3 flex items-center justify-between gap-4 text-xs"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <Laptop className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">
                          {sess.deviceLabel || 'Browser Session'}
                          {isCurrent ? ' · Current Device' : ''}
                        </p>
                        <p className="text-base-content/60 truncate">
                          {sess.ipAddress || 'IP hidden'} · Created{' '}
                          {new Date(sess.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    {!isCurrent && (
                      <button
                        type="button"
                        onClick={() => void handleRevokeSession(sess.id)}
                        className="btn btn-xs btn-ghost text-error"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
