'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  CheckCircle2,
  RefreshCw,
  Search,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, extractApiError } from '../lib/api.ts';
import { DashboardShell } from '../components/DashboardShell.tsx';

interface AdminOverviewData {
  stats: {
    totalUsers: number;
    activeUsers: number;
    suspendedUsers: number;
    pendingUsers: number;
    onlineUsers: number;
    newUsers7d: number;
    totalConversations: number;
    totalGroups: number;
    totalMessages: number;
    totalAttachments: number;
    openReports: number;
  };
  operationalHealth: {
    uptimeSeconds: number;
    nodeVersion: string;
    environment: string;
    database: {
      healthy: boolean;
      latencyMs: number;
      engine: string;
      externalNeonConfigured: boolean;
    };
    integrations: {
      cloudinaryConfigured: boolean;
      googleOAuthConfigured: boolean;
      smtpConfigured: boolean;
    };
  };
}

interface AdminUserRow {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';
  suspendedReason: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  presence: { isOnline: boolean } | null;
  _count: { sentMessages: number; reportsAgainst: number };
}

interface AdminReportRow {
  id: string;
  reason: string;
  details: string;
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED';
  resolutionNotes: string | null;
  createdAt: string;
  reporter: { username: string; displayName: string };
  targetUser: { id: string; username: string; displayName: string; status: string } | null;
  message: { id: string; content: string; isDeleted: boolean } | null;
}

interface AuditLogRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: string;
  actor: { username: string; displayName: string; role: string } | null;
  targetUser: { username: string; displayName: string } | null;
}

export function AdminDashboardPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'OVERVIEW' | 'USERS' | 'REPORTS' | 'AUDIT'>('OVERVIEW');

  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [userPage, setUserPage] = useState(1);
  const [userTotalPages, setUserTotalPages] = useState(1);
  const [userQuery, setUserQuery] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState('');

  const [reports, setReports] = useState<AdminReportRow[]>([]);
  const [reportFilter, setReportFilter] = useState('');
  const [activeReportModal, setActiveReportModal] = useState<AdminReportRow | null>(null);
  const [resolutionStatus, setResolutionStatus] = useState<'RESOLVED' | 'DISMISSED' | 'IN_REVIEW'>('RESOLVED');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [deleteReportedMsg, setDeleteReportedMsg] = useState(false);
  const [suspendReportedUser, setSuspendReportedUser] = useState(false);

  const [suspendModalUser, setSuspendModalUser] = useState<AdminUserRow | null>(null);
  const [suspendReason, setSuspendReason] = useState('');

  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [auditActionFilter, setAuditActionFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ success: boolean; data: AdminOverviewData }>(
        '/admin/overview'
      );
      setOverview(res.data.data);
    } catch (err) {
      toast.error(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{
        success: boolean;
        data: { users: AdminUserRow[]; pagination: { totalPages: number } };
      }>('/admin/users', {
        params: {
          page: userPage,
          q: userQuery || undefined,
          status: userStatusFilter || undefined,
        },
      });
      setUsers(res.data.data.users);
      setUserTotalPages(res.data.data.pagination.totalPages);
    } catch (err) {
      toast.error(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [userPage, userQuery, userStatusFilter]);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{
        success: boolean;
        data: { reports: AdminReportRow[] };
      }>('/admin/reports', {
        params: { status: reportFilter || undefined },
      });
      setReports(res.data.data.reports);
    } catch (err) {
      toast.error(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [reportFilter]);

  const loadAuditLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{
        success: boolean;
        data: { logs: AuditLogRow[] };
      }>('/admin/audit-logs', {
        params: { action: auditActionFilter || undefined },
      });
      setAuditLogs(res.data.data.logs);
    } catch (err) {
      toast.error(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [auditActionFilter]);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    if (tab === 'OVERVIEW') void loadOverview();
    if (tab === 'USERS') void loadUsers();
    if (tab === 'REPORTS') void loadReports();
    if (tab === 'AUDIT') void loadAuditLogs();
  }, [user, tab, loadOverview, loadUsers, loadReports, loadAuditLogs]);

  if (user?.role !== 'ADMIN') {
    return (
      <DashboardShell title="Administrator Console">
        <div className="max-w-md mx-auto mt-16 p-6 rounded-xl bg-base-200 border border-base-300 text-center space-y-3">
          <ShieldAlert className="w-10 h-10 text-error mx-auto" />
          <h2 className="text-lg font-bold">Administrator Access Required</h2>
          <p className="text-xs text-base-content/65">
            Your account ({user?.role}) does not hold server-enforced ADMIN permissions.
          </p>
        </div>
      </DashboardShell>
    );
  }

  const handleSuspendConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendModalUser) return;
    try {
      await apiClient.patch(`/admin/users/${suspendModalUser.id}/status`, {
        status: 'SUSPENDED',
        reason: suspendReason.trim() || 'Suspended by platform moderator',
      });
      toast.success(`Suspended @${suspendModalUser.username}`);
      setSuspendModalUser(null);
      setSuspendReason('');
      await loadUsers();
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const handleReactivateUser = async (target: AdminUserRow) => {
    try {
      await apiClient.patch(`/admin/users/${target.id}/status`, { status: 'ACTIVE' });
      toast.success(`Reactivated @${target.username}`);
      await loadUsers();
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const handleResolveReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReportModal || resolutionNotes.trim().length < 3) return;
    try {
      await apiClient.patch(`/admin/reports/${activeReportModal.id}`, {
        status: resolutionStatus,
        resolutionNotes: resolutionNotes.trim(),
        deleteReportedMessage: deleteReportedMsg,
        suspendTargetUser: suspendReportedUser,
      });
      toast.success('Moderation action recorded.');
      setActiveReportModal(null);
      setResolutionNotes('');
      setDeleteReportedMsg(false);
      setSuspendReportedUser(false);
      await loadReports();
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  return (
    <DashboardShell
      title="Administrator Console"
      subtitle="Platform governance, user moderation, abuse reports, and security audit trail"
      headerActions={
        <button
          type="button"
          onClick={() => {
            if (tab === 'OVERVIEW') void loadOverview();
            if (tab === 'USERS') void loadUsers();
            if (tab === 'REPORTS') void loadReports();
            if (tab === 'AUDIT') void loadAuditLogs();
          }}
          className="btn btn-sm btn-ghost border border-base-300 gap-1.5"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      }
    >
      <div className="max-w-7xl mx-auto space-y-6 pb-8">
        <div className="inline-flex flex-wrap p-1 rounded-lg bg-base-200 border border-base-300 gap-1">
          {(
            [
              ['OVERVIEW', 'Overview & Health'],
              ['USERS', 'User Directory'],
              ['REPORTS', 'Abuse Reports'],
              ['AUDIT', 'Audit Logs'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
                tab === id ? 'bg-primary text-primary-content font-semibold' : ''
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'OVERVIEW' && overview && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-xl bg-base-200 border border-base-300">
                <p className="text-xs text-base-content/60">Total Accounts</p>
                <p className="text-2xl font-bold font-mono mt-1 tabular-nums">
                  {overview.stats.totalUsers}
                </p>
                <p className="text-xs text-base-content/60 mt-1 tabular-nums">
                  {overview.stats.activeUsers} active · {overview.stats.onlineUsers} online now
                </p>
              </div>

              <div className="p-5 rounded-xl bg-base-200 border border-base-300">
                <p className="text-xs text-base-content/60">Suspended / Pending</p>
                <p className="text-2xl font-bold font-mono mt-1 tabular-nums">
                  {overview.stats.suspendedUsers}
                </p>
                <p className="text-xs text-base-content/60 mt-1 tabular-nums">
                  {overview.stats.pendingUsers} awaiting email OTP
                </p>
              </div>

              <div className="p-5 rounded-xl bg-base-200 border border-base-300">
                <p className="text-xs text-base-content/60">Persisted Messages</p>
                <p className="text-2xl font-bold font-mono mt-1 tabular-nums">
                  {overview.stats.totalMessages}
                </p>
                <p className="text-xs text-base-content/60 mt-1 tabular-nums">
                  {overview.stats.totalConversations} threads · {overview.stats.totalAttachments} files
                </p>
              </div>

              <div className="p-5 rounded-xl bg-base-200 border border-base-300">
                <p className="text-xs text-base-content/60">Open Abuse Reports</p>
                <p className="text-2xl font-bold font-mono mt-1 tabular-nums">
                  {overview.stats.openReports}
                </p>
                <p className="text-xs text-base-content/60 mt-1">
                  +{overview.stats.newUsers7d} registrations (7d)
                </p>
              </div>
            </div>

            <div className="p-6 rounded-xl bg-base-200 border border-base-300 space-y-4">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Operational Health (Zero Secrets Exposed)</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                <div className="p-4 rounded-lg bg-base-100 border border-base-300 space-y-1">
                  <p className="font-semibold">PostgreSQL Engine</p>
                  <p className="text-base-content/70 font-mono tabular-nums">
                    {overview.operationalHealth.database.healthy ? 'Healthy' : 'Degraded'} ·{' '}
                    {overview.operationalHealth.database.latencyMs}ms ·{' '}
                    {overview.operationalHealth.database.engine}
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-base-100 border border-base-300 space-y-1">
                  <p className="font-semibold">Runtime &amp; Uptime</p>
                  <p className="text-base-content/70 font-mono tabular-nums">
                    Node {overview.operationalHealth.nodeVersion} ·{' '}
                    {overview.operationalHealth.uptimeSeconds}s uptime
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-base-100 border border-base-300 space-y-1">
                  <p className="font-semibold">External Credentials Readiness</p>
                  <p className="text-base-content/70">
                    Cloudinary:{' '}
                    {overview.operationalHealth.integrations.cloudinaryConfigured
                      ? 'Configured'
                      : 'Unconfigured'}{' '}
                    · OAuth:{' '}
                    {overview.operationalHealth.integrations.googleOAuthConfigured
                      ? 'Configured'
                      : 'Unconfigured'}{' '}
                    · SMTP:{' '}
                    {overview.operationalHealth.integrations.smtpConfigured
                      ? 'Configured'
                      : 'Dev Sink'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'USERS' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 text-base-content/50 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={userQuery}
                  onChange={(e) => {
                    setUserPage(1);
                    setUserQuery(e.target.value);
                  }}
                  placeholder="Search email, username, or display name..."
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-base-200 border border-base-300"
                />
              </div>
              <select
                value={userStatusFilter}
                onChange={(e) => {
                  setUserPage(1);
                  setUserStatusFilter(e.target.value);
                }}
                className="px-3 py-2 text-sm rounded-lg bg-base-200 border border-base-300"
              >
                <option value="">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="PENDING_VERIFICATION">Pending OTP</option>
              </select>
            </div>

            <div className="rounded-xl bg-base-200 border border-base-300 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-base-300 text-base-content/65">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Account</th>
                    <th className="py-3 px-4 font-semibold">Role &amp; Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Messages</th>
                    <th className="py-3 px-4 font-semibold text-right">Reports</th>
                    <th className="py-3 px-4 font-semibold">Registered</th>
                    <th className="py-3 px-4 font-semibold text-right">Moderation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-base-300/60">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-base-300/30">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-sm">{u.displayName}</p>
                        <p className="text-base-content/60 font-mono">
                          @{u.username} · {u.email}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <span>
                          {u.role} ·{' '}
                          <strong
                            className={
                              u.status === 'SUSPENDED'
                                ? 'text-error'
                                : u.status === 'ACTIVE'
                                  ? 'text-success'
                                  : 'text-warning'
                            }
                          >
                            {u.status}
                          </strong>
                        </span>
                        {u.suspendedReason && (
                          <p className="text-error/80 truncate max-w-xs">{u.suspendedReason}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {u._count.sentMessages}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {u._count.reportsAgainst}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {u.role !== 'ADMIN' && u.id !== user.id && (
                          <>
                            {u.status === 'SUSPENDED' ? (
                              <button
                                type="button"
                                onClick={() => void handleReactivateUser(u)}
                                className="btn btn-xs btn-success btn-outline"
                              >
                                Reactivate
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSuspendModalUser(u)}
                                className="btn btn-xs btn-error btn-outline"
                              >
                                Suspend
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-xs tabular-nums">
              <span>
                Page {userPage} of {userTotalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={userPage <= 1}
                  onClick={() => setUserPage((p) => p - 1)}
                  className="btn btn-xs btn-ghost border border-base-300"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={userPage >= userTotalPages}
                  onClick={() => setUserPage((p) => p + 1)}
                  className="btn btn-xs btn-ghost border border-base-300"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'REPORTS' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <select
                value={reportFilter}
                onChange={(e) => setReportFilter(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg bg-base-200 border border-base-300"
              >
                <option value="">All Reports</option>
                <option value="OPEN">Open</option>
                <option value="IN_REVIEW">In Review</option>
                <option value="RESOLVED">Resolved</option>
                <option value="DISMISSED">Dismissed</option>
              </select>
            </div>

            <div className="rounded-xl bg-base-200 border border-base-300 divide-y divide-base-300/60">
              {reports.length === 0 ? (
                <div className="p-10 text-center text-xs text-base-content/60">
                  <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-2" />
                  No abuse reports match the current filter.
                </div>
              ) : (
                reports.map((rep) => (
                  <div
                    key={rep.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs"
                  >
                    <div className="space-y-1 max-w-2xl">
                      <p className="font-semibold text-sm flex items-center gap-2">
                        <AlertOctagon className="w-4 h-4 text-warning shrink-0" />
                        <span>
                          {rep.reason} · Status: {rep.status}
                        </span>
                      </p>
                      <p className="text-base-content/80">{rep.details}</p>
                      {rep.message && (
                        <p className="p-2 rounded bg-base-100 border border-base-300 font-mono">
                          Reported Message:{' '}
                          {rep.message.isDeleted ? '[Deleted]' : rep.message.content}
                        </p>
                      )}
                      <p className="text-base-content/55">
                        Reporter: @{rep.reporter.username}
                        {rep.targetUser ? ` · Target: @${rep.targetUser.username}` : ''} ·{' '}
                        {new Date(rep.createdAt).toLocaleString()}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveReportModal(rep);
                        setResolutionNotes(rep.resolutionNotes || '');
                      }}
                      className="btn btn-xs btn-primary shrink-0"
                    >
                      Review &amp; Act
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'AUDIT' && (
          <div className="space-y-4">
            <input
              type="search"
              value={auditActionFilter}
              onChange={(e) => setAuditActionFilter(e.target.value)}
              placeholder="Filter by action (e.g., ADMIN_USER_SUSPENDED, AUTH_LOGIN_FAILED)..."
              className="w-full max-w-md px-3.5 py-2 text-sm rounded-lg bg-base-200 border border-base-300"
            />

            <div className="rounded-xl bg-base-200 border border-base-300 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-base-300 text-base-content/65">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Timestamp</th>
                    <th className="py-3 px-4 font-semibold">Action</th>
                    <th className="py-3 px-4 font-semibold">Actor</th>
                    <th className="py-3 px-4 font-semibold">Target</th>
                    <th className="py-3 px-4 font-semibold">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-base-300/60 font-mono">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2.5 px-4 tabular-nums">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-primary font-semibold">{log.action}</td>
                      <td className="py-2.5 px-4">
                        {log.actor ? `@${log.actor.username}` : 'system'}
                      </td>
                      <td className="py-2.5 px-4">
                        {log.targetUser ? `@${log.targetUser.username}` : log.entityId || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-base-content/60">{log.ipAddress || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Suspend User Modal */}
      {suspendModalUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleSuspendConfirm}
            className="bg-base-200 border border-base-300 rounded-xl p-5 max-w-md w-full space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">
                Suspend @{suspendModalUser.username}?
              </h3>
              <button
                type="button"
                onClick={() => setSuspendModalUser(null)}
                className="btn btn-xs btn-ghost btn-square"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-base-content/70">
              Suspending an account immediately revokes all active refresh sessions and sends a
              realtime sign-out event to connected clients.
            </p>
            <textarea
              rows={3}
              required
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Enter suspension reason for audit log..."
              className="w-full p-2.5 text-sm rounded-lg bg-base-100 border border-base-300"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSuspendModalUser(null)}
                className="btn btn-sm btn-ghost"
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-sm btn-error">
                Confirm Suspension
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Resolve Report Modal */}
      {activeReportModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleResolveReport}
            className="bg-base-200 border border-base-300 rounded-xl p-5 max-w-md w-full space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Moderate Abuse Report</h3>
              <button
                type="button"
                onClick={() => setActiveReportModal(null)}
                className="btn btn-xs btn-ghost btn-square"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <select
              value={resolutionStatus}
              onChange={(e) => setResolutionStatus(e.target.value as typeof resolutionStatus)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-base-100 border border-base-300"
            >
              <option value="IN_REVIEW">Mark In Review</option>
              <option value="RESOLVED">Resolve Report</option>
              <option value="DISMISSED">Dismiss Report</option>
            </select>

            <textarea
              rows={3}
              required
              minLength={3}
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              placeholder="Moderation resolution notes..."
              className="w-full p-2.5 text-sm rounded-lg bg-base-100 border border-base-300"
            />

            {activeReportModal.message && !activeReportModal.message.isDeleted && (
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteReportedMsg}
                  onChange={(e) => setDeleteReportedMsg(e.target.checked)}
                  className="checkbox checkbox-xs checkbox-error"
                />
                <span>Delete the reported message &amp; cloud attachments</span>
              </label>
            )}

            {activeReportModal.targetUser && (
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={suspendReportedUser}
                  onChange={(e) => setSuspendReportedUser(e.target.checked)}
                  className="checkbox checkbox-xs checkbox-error"
                />
                <span>Suspend reported user (@{activeReportModal.targetUser.username})</span>
              </label>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveReportModal(null)}
                className="btn btn-sm btn-ghost"
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-sm btn-primary">
                Apply Moderation
              </button>
            </div>
          </form>
        </div>
      )}
    </DashboardShell>
  );
}
