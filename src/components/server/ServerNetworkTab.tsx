import React, { useState, useEffect } from 'react';
import {
  Globe, Copy, Check, RefreshCw, AlertTriangle,
  Wifi, CheckCircle2, XCircle, Loader2, ShieldCheck, Save,
  Lock, Download, Server as ServerIcon,
  Users, Radio, FileCode, Plus, Trash2, Star, Edit2, Zap, Clock
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { useToast } from '../../lib/ToastContext';
import { Server as ServerType, SftpConnectionInfo, Allocation, SftpActiveSessionDTO } from '../../types';

interface ServerNetworkTabProps {
  server: ServerType;
  onRefreshServer: () => void;
}

interface ServerNetworkData {
  allocations: Allocation[];
  primaryAllocationId?: string;
  availableAllocations: Allocation[];
  node: {
    id: string;
    name: string;
    ip: string;
    fqdn?: string;
    publicIpv4?: string;
    sftpPort: number;
  };
  customDomain?: string;
  domainVerified?: boolean;
  domainLastVerifiedAt?: string | null;
  autoPublishStatus?: 'idle' | 'waiting_dns' | 'live' | 'partial' | 'action_required';
  autoPublishMessage?: string;
  cloudflareSynced?: boolean;
  cloudflareConfigured?: boolean;
  playitEnabled?: boolean;
  playitAddress?: string;
  playitUpdatedAt?: string | null;
  hostPlayit?: {
    installed: boolean;
    running: boolean;
    state: string;
    detectedAddresses: string[];
  };
}

interface ServerAutomationStep {
  id: string;
  label: string;
  status: 'done' | 'waiting' | 'skipped' | 'action_required';
  detail: string;
}

interface ServerDnsVerificationResult {
  domain: string;
  validHostname: boolean;
  dnsStatus: 'verified' | 'mismatch' | 'unconfigured' | 'invalid';
  resolvedIpv4: string[];
  cnames: string[];
  srvRecords: Array<{ name: string; port: number; priority: number; weight: number }>;
  matchesExpectedIp: boolean;
  srvMatches: boolean;
  checkedAt: string;
  summary: string;
}

export const ServerNetworkTab: React.FC<ServerNetworkTabProps> = ({ server, onRefreshServer }) => {
  const { toast } = useToast();
  const [networkData, setNetworkData] = useState<ServerNetworkData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // SFTP state
  const [sftpInfo, setSftpInfo] = useState<SftpConnectionInfo | null>(null);
  const [loadingSftp, setLoadingSftp] = useState<boolean>(true);
  const [terminatingSessionId, setTerminatingSessionId] = useState<string | null>(null);

  // Allocation actions
  const [assigningPort, setAssigningPort] = useState<boolean>(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState<boolean>(false);
  const [selectedAllocId, setSelectedAllocId] = useState<string>('');
  const [allocNotesInput, setAllocNotesInput] = useState<string>('');

  // Editing notes
  const [editingAllocId, setEditingAllocId] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<string>('');

  // Custom Domain & Playit state
  const [customDomainInput, setCustomDomainInput] = useState<string>(server.customDomain || '');
  const [savingDomain, setSavingDomain] = useState<boolean>(false);
  const [autoPublishingDomain, setAutoPublishingDomain] = useState<boolean>(false);
  const [verifyingDomain, setVerifyingDomain] = useState<boolean>(false);
  const [domainVerifyResult, setDomainVerifyResult] = useState<ServerDnsVerificationResult | null>(null);
  const [serverAutoSteps, setServerAutoSteps] = useState<ServerAutomationStep[]>([]);

  const [playitEnabledInput, setPlayitEnabledInput] = useState<boolean>(Boolean(server.playitEnabled));
  const [playitAddressInput, setPlayitAddressInput] = useState<string>(server.playitAddress || '');
  const [savingPlayit, setSavingPlayit] = useState<boolean>(false);

  const fetchNetworkData = async (quiet = false) => {
    try {
      if (!quiet) setLoading(true);
      setError(null);
      const res = await apiRequest(`/servers/${server.id}/network/allocations`);
      if (res.success && res.data) {
        setNetworkData(res.data);
        if (!quiet) {
          setCustomDomainInput(res.data.customDomain || '');
          setPlayitEnabledInput(Boolean(res.data.playitEnabled));
          setPlayitAddressInput(res.data.playitAddress || '');
        }
      } else if (!quiet) {
        setError(res.error?.message || 'Failed to fetch network allocations.');
      }
    } catch (err: any) {
      if (!quiet) setError(err.message || 'Error loading allocations.');
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  const fetchSftpInfo = async () => {
    try {
      setLoadingSftp(true);
      const res = await apiRequest(`/servers/${server.id}/sftp`);
      if (res.success && res.data) {
        setSftpInfo(res.data);
      }
    } catch {
      // fallback
    } finally {
      setLoadingSftp(false);
    }
  };

  useEffect(() => {
    fetchNetworkData();
    fetchSftpInfo();
  }, [server.id]);

  // Automatic background propagation watcher while waiting on DNS
  useEffect(() => {
    if (networkData?.autoPublishStatus !== 'waiting_dns' || !networkData?.customDomain) {
      return;
    }
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      if (attempts > 12) {
        clearInterval(timer);
        return;
      }
      try {
        const res = await apiRequest(`/servers/${server.id}/network/domain/verify`, {
          method: 'POST',
          body: JSON.stringify({ customDomain: networkData.customDomain })
        });
        if (res.success && res.data) {
          setDomainVerifyResult(res.data);
          if (res.data.dnsStatus === 'verified') {
            await fetchNetworkData(true);
            onRefreshServer();
            toast.success(`${res.data.domain} is verified and live!`);
            clearInterval(timer);
          }
        }
      } catch {
        // ignore transient poll error
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [networkData?.autoPublishStatus, networkData?.customDomain, server.id]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleSetPrimary = async (allocId: string) => {
    setActionLoadingId(allocId);
    try {
      const res = await apiRequest(`/servers/${server.id}/network/allocations/${allocId}/primary`, {
        method: 'POST'
      });
      if (res.success) {
        await fetchNetworkData();
        onRefreshServer();
      } else {
        toast.error(res.error?.message || 'Failed to set primary allocation.');
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleAssignAllocation = async () => {
    setAssigningPort(true);
    try {
      const res = await apiRequest(`/servers/${server.id}/network/allocations`, {
        method: 'POST',
        body: JSON.stringify({
          allocationId: selectedAllocId || undefined,
          notes: allocNotesInput.trim() || undefined
        })
      });
      if (res.success) {
        setShowAssignModal(false);
        setSelectedAllocId('');
        setAllocNotesInput('');
        await fetchNetworkData();
        onRefreshServer();
        toast.success('Port allocation assigned.');
      } else {
        toast.error(res.error?.message || 'Failed to assign allocation.');
      }
    } finally {
      setAssigningPort(false);
    }
  };

  const handleDeleteAllocation = async (allocId: string, port: number) => {
    if (!confirm(`Are you sure you want to release port ${port} from this server back to the node pool?`)) return;
    setActionLoadingId(allocId);
    try {
      const res = await apiRequest(`/servers/${server.id}/network/allocations/${allocId}`, {
        method: 'DELETE'
      });
      if (res.success) {
        await fetchNetworkData();
        onRefreshServer();
        toast.info(`Released port ${port}.`);
      } else {
        toast.error(res.error?.message || 'Failed to release allocation.');
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleSaveNotes = async (allocId: string) => {
    setActionLoadingId(allocId);
    try {
      const res = await apiRequest(`/servers/${server.id}/network/allocations/${allocId}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes: editingNotes })
      });
      if (res.success) {
        setEditingAllocId(null);
        await fetchNetworkData();
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleTerminateSession = async (sessionId: string) => {
    if (!confirm('Are you sure you want to disconnect this active SFTP session?')) return;
    setTerminatingSessionId(sessionId);
    try {
      const res = await apiRequest(`/servers/${server.id}/sftp/sessions/${sessionId}`, { method: 'DELETE' });
      if (res.success) {
        await fetchSftpInfo();
      }
    } finally {
      setTerminatingSessionId(null);
    }
  };

  const handleAutoPublishServerDomain = async () => {
    if (!customDomainInput.trim()) {
      toast.warning('Enter a custom domain (e.g. play.yourdomain.com) first.');
      return;
    }
    setAutoPublishingDomain(true);
    try {
      const res = await apiRequest(`/servers/${server.id}/network/domain/auto-publish`, {
        method: 'POST',
        body: JSON.stringify({ customDomain: customDomainInput.trim() })
      });
      if (res.success && res.data) {
        if (Array.isArray(res.data.steps)) setServerAutoSteps(res.data.steps);
        if (res.data.dnsResult) setDomainVerifyResult(res.data.dnsResult);
        if (typeof res.data.customDomain === 'string') setCustomDomainInput(res.data.customDomain);
        setPlayitEnabledInput(Boolean(res.data.playitEnabled));
        setPlayitAddressInput(res.data.playitAddress || '');
        await fetchNetworkData(true);
        onRefreshServer();
        if (res.data.autoStatus === 'live') {
          toast.success(res.data.autoMessage || 'Previous connections disconnected and domain linked!');
        } else {
          toast.info(res.data.autoMessage || 'Previous connections disconnected! Watching DNS propagation...');
        }
      } else {
        toast.error(res.error?.message || 'Could not auto-link domain.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Could not auto-link domain.');
    } finally {
      setAutoPublishingDomain(false);
    }
  };

  const handleSaveCustomDomain = async (domainOverride?: string) => {
    setSavingDomain(true);
    try {
      const target = domainOverride !== undefined ? domainOverride : customDomainInput;
      const res = await apiRequest(`/servers/${server.id}/network/domain`, {
        method: 'PUT',
        body: JSON.stringify({ customDomain: target })
      });
      if (res.success) {
        setDomainVerifyResult(null);
        setServerAutoSteps([]);
        await fetchNetworkData();
        onRefreshServer();
        toast.success(res.message || 'Custom domain updated.');
      } else {
        toast.error(res.error?.message || 'Failed to save custom domain.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save custom domain.');
    } finally {
      setSavingDomain(false);
    }
  };

  const handleVerifyCustomDomain = async () => {
    if (!customDomainInput.trim()) {
      toast.warning('Enter a custom domain first to verify DNS.');
      return;
    }
    setVerifyingDomain(true);
    try {
      const res = await apiRequest(`/servers/${server.id}/network/domain/verify`, {
        method: 'POST',
        body: JSON.stringify({ customDomain: customDomainInput.trim() })
      });
      if (res.success && res.data) {
        setDomainVerifyResult(res.data);
        await fetchNetworkData();
        onRefreshServer();
        if (res.data.dnsStatus === 'verified') {
          toast.success(res.data.summary);
        } else {
          toast.warning(res.data.summary);
        }
      } else {
        toast.error(res.error?.message || 'DNS verification failed.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'DNS verification failed.');
    } finally {
      setVerifyingDomain(false);
    }
  };

  const handleSavePlayit = async () => {
    setSavingPlayit(true);
    try {
      const res = await apiRequest(`/servers/${server.id}/network/playit`, {
        method: 'PUT',
        body: JSON.stringify({
          playitEnabled: playitEnabledInput,
          playitAddress: playitAddressInput
        })
      });
      if (res.success) {
        await fetchNetworkData();
        onRefreshServer();
        toast.success(res.message || 'Playit.gg settings saved.');
      } else {
        toast.error(res.error?.message || 'Failed to save Playit.gg settings.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save Playit.gg settings.');
    } finally {
      setSavingPlayit(false);
    }
  };

  const primaryAlloc = networkData?.allocations.find(a => a.id === networkData.primaryAllocationId) || networkData?.allocations[0];
  const primaryPort = primaryAlloc?.port || (server as any).port || server.primaryPort || 25565;
  const primaryHost = networkData?.node.fqdn || networkData?.node.publicIpv4 || (networkData?.node.ip !== '0.0.0.0' ? networkData?.node.ip : '127.0.0.1') || '127.0.0.1';
  const primaryEndpoint = `${primaryHost}:${primaryPort}`;
  const activeCustomDomain = networkData?.customDomain || server.customDomain || '';
  const activePlayitAddress = (networkData?.playitEnabled ?? server.playitEnabled)
    ? (networkData?.playitAddress || server.playitAddress || '')
    : '';

  return (
    <div className="space-y-4">
      {/* ─────────────────────────────────────────────────────────────────────────────
          1. PRIMARY CONNECTION BANNER (PTERODACTYL-STYLE)
      ───────────────────────────────────────────────────────────────────────────── */}
      <div className="p-4 sm:p-5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)]">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wider bg-[var(--color-ok)]/10 text-[var(--color-ok)] border border-[var(--color-ok)]/40">
                Pterodactyl Node Allocation
              </span>
              <span className="text-xs text-[var(--color-ink-mute)] font-medium flex items-center gap-1 font-mono">
                <ServerIcon className="h-3.5 w-3.5 text-[var(--color-ink-mute)]" />
                {networkData?.node.name || 'Primary Node'}
              </span>
            </div>
            <h2 className="text-base font-semibold text-[var(--color-ink)] tracking-tight flex items-center gap-2">
              <Wifi className="h-4 w-4 text-[var(--color-accent)]" />
              <span>Connection Address</span>
            </h2>
            <p className="text-xs text-[var(--color-ink-mute)]">
              Direct connection address routed through your node's assigned network interface.
            </p>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="px-3 py-1.5 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-line)] text-xs font-mono text-[var(--color-ink)] flex items-center gap-3 w-full md:w-auto justify-between">
              <span className="select-all font-semibold text-[var(--color-accent)]">{primaryEndpoint}</span>
              <button
                type="button"
                onClick={() => copyToClipboard(primaryEndpoint, 'primary_endpoint')}
                className="p-1 rounded hover:bg-[var(--color-surface-3)] text-[var(--color-ink-mute)] hover:text-[var(--color-ink)] transition-colors cursor-pointer"
                title="Copy Connection Address"
              >
                {copiedKey === 'primary_endpoint' ? (
                  <Check className="h-3.5 w-3.5 text-[var(--color-ok)]" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowAssignModal(true)}
              className="btn btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Assign Port</span>
            </button>
          </div>
        </div>

        {(activeCustomDomain || activePlayitAddress) && (
          <div className="mt-3.5 pt-3 border-t border-[var(--color-line)] flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            {activeCustomDomain && (
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                <span className="text-[var(--color-ink-mute)]">Custom Domain:</span>
                <span className="font-mono font-semibold text-[var(--color-ink)] select-all">{activeCustomDomain}</span>
                {networkData?.domainVerified && (
                  <span title="DNS Verified" className="inline-flex items-center">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-ok)]" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => copyToClipboard(activeCustomDomain, 'banner_domain')}
                  className="p-1 text-[var(--color-ink-mute)] hover:text-[var(--color-ink)] cursor-pointer"
                  title="Copy Custom Domain"
                >
                  {copiedKey === 'banner_domain' ? <Check className="h-3 w-3 text-[var(--color-ok)]" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            )}

            {activePlayitAddress && (
              <div className="flex items-center gap-2">
                <Radio className="h-3.5 w-3.5 text-[var(--color-ok)]" />
                <span className="text-[var(--color-ink-mute)]">Playit.gg Public Address:</span>
                <span className="font-mono font-semibold text-[var(--color-ok)] select-all">{activePlayitAddress}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(activePlayitAddress, 'banner_playit')}
                  className="p-1 text-[var(--color-ink-mute)] hover:text-[var(--color-ink)] cursor-pointer"
                  title="Copy Playit.gg Address"
                >
                  {copiedKey === 'banner_playit' ? <Check className="h-3 w-3 text-[var(--color-ok)]" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          1B. CUSTOM DOMAIN & PLAYIT.GG PUBLIC ADDRESS
      ───────────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Connect Custom Domain */}
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 sm:p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-[var(--color-ink)] flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                  <span>Connect Custom Domain</span>
                </h3>
                <p className="text-xs text-[var(--color-ink-mute)] mt-0.5">
                  Point your own domain name (e.g. play.yourdomain.com) directly to this server.
                </p>
              </div>
              {networkData?.domainVerified ? (
                <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-ok)] shrink-0">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Live & Public
                </span>
              ) : networkData?.autoPublishStatus === 'waiting_dns' ? (
                <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-warn)] shrink-0">
                  <Clock className="h-3.5 w-3.5 animate-pulse" />
                  Watching DNS
                </span>
              ) : activeCustomDomain ? (
                <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-warn)] shrink-0">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Pending DNS
                </span>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label className="label block">Domain / Subdomain</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={customDomainInput}
                  onChange={(e) => setCustomDomainInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAutoPublishServerDomain();
                    }
                  }}
                  placeholder="play.yourdomain.com"
                  className="field flex-1 text-xs font-mono"
                />
                {activeCustomDomain && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomDomainInput('');
                      handleSaveCustomDomain('');
                    }}
                    disabled={savingDomain || autoPublishingDomain}
                    className="btn btn-ghost text-xs py-1.5 px-2.5 text-[var(--color-ink-mute)] hover:text-[var(--color-err)] whitespace-nowrap shrink-0"
                    title="Clear Custom Domain"
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="text-[11px] text-[var(--color-ink-mute)]">
                {networkData?.cloudflareConfigured
                  ? 'Automatically disconnects Playit & previous domains, then creates Cloudflare A/SRV records and connects this domain.'
                  : 'Automatically disconnects Playit & previous domains, then binds and watches DNS propagation for the entered domain.'}
              </p>
            </div>

            {serverAutoSteps.length > 0 && (
              <div className="rounded-md bg-[var(--color-surface-2)] border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
                {serverAutoSteps.map((step) => (
                  <div key={step.id} className="px-3 py-2 flex items-start gap-2 text-xs">
                    <span className="mt-0.5 shrink-0">
                      {step.status === 'done' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-ok)]" />
                      ) : step.status === 'waiting' ? (
                        <Clock className="h-3.5 w-3.5 text-[var(--color-warn)] animate-pulse" />
                      ) : step.status === 'action_required' ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-err)]" />
                      ) : (
                        <Check className="h-3.5 w-3.5 text-[var(--color-ink-mute)]" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[var(--color-ink)]">{step.label}</div>
                      <div className="text-[11px] text-[var(--color-ink-mute)] break-words">{step.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Required A + SRV Records */}
            <div className="rounded-md bg-[var(--color-surface-2)] border border-[var(--color-line)] p-3 space-y-2 text-[11px] font-mono">
              <div className="text-[var(--color-ink-mute)] font-sans font-medium">
                DNS Records for <span className="font-mono text-[var(--color-ink)]">{customDomainInput.trim() || 'play.yourdomain.com'}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--color-accent)]">A · {customDomainInput.trim() || 'play.yourdomain.com'}</span>
                <span className="text-[var(--color-ink)] tabular-nums">{primaryHost}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--color-accent)]">SRV · _minecraft._tcp</span>
                <span className="text-[var(--color-ink)] tabular-nums truncate">
                  0 5 {primaryPort} {customDomainInput.trim() || primaryHost}
                </span>
              </div>
            </div>

            {domainVerifyResult && (
              <div
                className={`p-2.5 rounded-md border text-xs space-y-1 ${
                  domainVerifyResult.dnsStatus === 'verified'
                    ? 'bg-[var(--color-ok)]/10 border-[var(--color-ok)]/30 text-[var(--color-ok)]'
                    : 'bg-[var(--color-warn)]/10 border-[var(--color-warn)]/30 text-[var(--color-warn)]'
                }`}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  {domainVerifyResult.dnsStatus === 'verified' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span>{domainVerifyResult.summary}</span>
                </div>
                <div className="text-[11px] font-mono opacity-90">
                  A: {domainVerifyResult.resolvedIpv4.join(', ') || 'None'} · SRV: {domainVerifyResult.srvRecords.length > 0 ? `${domainVerifyResult.srvRecords[0].name}:${domainVerifyResult.srvRecords[0].port}` : 'None'}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-[var(--color-line)]">
            <button
              type="button"
              onClick={handleVerifyCustomDomain}
              disabled={verifyingDomain || !customDomainInput.trim()}
              className="btn btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {verifyingDomain ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 text-[var(--color-accent)]" />}
              <span>Verify DNS</span>
            </button>
            <button
              type="button"
              onClick={handleAutoPublishServerDomain}
              disabled={autoPublishingDomain || !customDomainInput.trim()}
              className="btn btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {autoPublishingDomain ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              <span>{autoPublishingDomain ? 'Disconnecting & Connecting...' : 'Disconnect & Connect'}</span>
            </button>
          </div>
        </div>

        {/* Public Address via Playit.gg */}
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 sm:p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-[var(--color-ink)] flex items-center gap-2">
                  <Radio className="h-3.5 w-3.5 text-[var(--color-ok)]" />
                  <span>Public Address by Playit.gg</span>
                </h3>
                <p className="text-xs text-[var(--color-ink-mute)] mt-0.5">
                  Tunnel players through Playit.gg without opening router/VPS firewall ports.
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--color-ink)] cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={playitEnabledInput}
                  onChange={(e) => setPlayitEnabledInput(e.target.checked)}
                  className="h-4 w-4 accent-emerald-500 rounded"
                />
                <span>Enabled</span>
              </label>
            </div>

            <div className="space-y-1.5">
              <label className="label block">Playit.gg Public Address</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={playitAddressInput}
                  onChange={(e) => setPlayitAddressInput(e.target.value)}
                  placeholder="my-server.gl.joinmc.link"
                  className="field flex-1 text-xs font-mono"
                />
                {playitAddressInput.trim() && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(playitAddressInput.trim(), 'playit_input')}
                    className="btn btn-ghost text-xs p-2 shrink-0"
                    title="Copy Playit Address"
                  >
                    {copiedKey === 'playit_input' ? <Check className="h-3.5 w-3.5 text-[var(--color-ok)]" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
            </div>

            {/* Local Forward Target Info */}
            <div className="rounded-md bg-[var(--color-surface-2)] border border-[var(--color-line)] p-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--color-ink-mute)]">Playit Tunnel Local Target:</span>
                <span className="font-mono font-semibold text-[var(--color-ink)] tabular-nums">
                  127.0.0.1:{primaryPort}
                </span>
              </div>
              <p className="text-[11px] text-[var(--color-ink-mute)]">
                In your Playit.gg dashboard, point your tunnel to local port <span className="font-mono text-[var(--color-ink)]">{primaryPort}</span>, then paste the assigned <span className="font-mono">*.joinmc.link</span> or <span className="font-mono">*.ply.gg</span> address above.
              </p>
            </div>

            {networkData?.hostPlayit?.detectedAddresses && networkData.hostPlayit.detectedAddresses.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] text-[var(--color-ink-mute)]">
                  Detected from Host Playit Agent (click to use):
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {networkData.hostPlayit.detectedAddresses.map((addr) => (
                    <button
                      key={addr}
                      type="button"
                      onClick={() => {
                        setPlayitAddressInput(addr);
                        setPlayitEnabledInput(true);
                      }}
                      className="px-2 py-1 rounded bg-[var(--color-ok)]/10 hover:bg-[var(--color-ok)]/20 border border-[var(--color-ok)]/30 text-[var(--color-ok)] text-[11px] font-mono cursor-pointer"
                    >
                      {addr}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-line)]">
            <button
              type="button"
              onClick={handleSavePlayit}
              disabled={savingPlayit}
              className="btn btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {savingPlayit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              <span>Save Playit Address</span>
            </button>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          2. NETWORK ALLOCATIONS TABLE
      ───────────────────────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] overflow-hidden">
        <div className="p-3.5 sm:p-4 border-b border-[var(--color-line)] flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-[var(--color-ink)] flex items-center gap-2">
              <Radio className="h-3.5 w-3.5 text-[var(--color-accent)]" />
              <span>Network Allocations ({networkData?.allocations.length || 0})</span>
            </h3>
            <p className="text-xs text-[var(--color-ink-mute)] mt-0.5">
              IP addresses and ports bound to this server container on the compute node.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchNetworkData(false)}
            disabled={loading}
            className="p-1.5 rounded-md bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-ink-mute)] hover:text-[var(--color-ink)] border border-[var(--color-line)] transition-colors cursor-pointer"
            title="Refresh Allocations"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loading && !networkData ? (
          <div className="p-12 text-center text-xs text-[var(--color-ink-mute)] space-y-2">
            <RefreshCw className="h-5 w-5 animate-spin text-[var(--color-accent)] mx-auto" />
            <p>Loading server allocations...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-[var(--color-err)] space-y-2">
            <AlertTriangle className="h-5 w-5 text-[var(--color-err)] mx-auto" />
            <p>{error}</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-line)]">
            {networkData?.allocations.map((alloc) => {
              const isPrimary = alloc.id === networkData.primaryAllocationId || alloc.port === (server as any).port;
              const isEditing = editingAllocId === alloc.id;

              return (
                <div key={alloc.id} className="p-3 sm:px-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-[var(--color-surface-2)]/60 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-md border ${isPrimary ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]/40 text-[var(--color-accent)]' : 'bg-[var(--color-surface-2)] border-[var(--color-line)] text-[var(--color-ink-mute)]'}`}>
                      <ServerIcon className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[var(--color-ink)]">
                          {alloc.ip}:{alloc.port}
                        </span>
                        {isPrimary && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-medium uppercase tracking-wider bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/30 flex items-center gap-1">
                            <Star className="h-2.5 w-2.5 fill-current" />
                            Primary
                          </span>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="flex items-center gap-2 mt-1">
                          <input
                            type="text"
                            value={editingNotes}
                            onChange={(e) => setEditingNotes(e.target.value)}
                            placeholder="e.g. Dynmap Web Server"
                            className="field px-2 py-0.5 text-xs font-sans"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveNotes(alloc.id)}
                            className="btn btn-primary text-[10px] py-1 px-2.5"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingAllocId(null)}
                            className="btn btn-ghost text-[10px] py-1 px-2"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-[var(--color-ink-mute)]">
                            {alloc.notes || (isPrimary ? 'Primary game/bot allocation' : 'Secondary port')}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingAllocId(alloc.id);
                              setEditingNotes(alloc.notes || '');
                            }}
                            className="p-0.5 text-[var(--color-ink-mute)] hover:text-[var(--color-ink)] transition-colors cursor-pointer"
                            title="Edit Notes"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 self-end sm:self-auto">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`${primaryHost}:${alloc.port}`, `alloc_${alloc.id}`)}
                      className="btn btn-ghost text-xs py-1 px-2.5 flex items-center gap-1.5"
                    >
                      {copiedKey === `alloc_${alloc.id}` ? (
                        <Check className="h-3 w-3 text-[var(--color-ok)]" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      <span>Copy</span>
                    </button>

                    {!isPrimary && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSetPrimary(alloc.id)}
                          disabled={actionLoadingId === alloc.id}
                          className="btn btn-ghost text-xs py-1 px-2.5 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
                        >
                          Make Primary
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAllocation(alloc.id, alloc.port)}
                          disabled={actionLoadingId === alloc.id}
                          className="btn btn-danger text-xs p-1.5"
                          title="Remove Allocation"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          3. FULLY FUNCTIONAL SFTP CREDENTIALS & DETAILS CARD
      ───────────────────────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] overflow-hidden">
        <div className="p-3.5 sm:p-4 border-b border-[var(--color-line)] flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-[var(--color-ink)] flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-[var(--color-ok)]" />
              <span>Secure File Transfer (SFTP)</span>
            </h3>
            <p className="text-xs text-[var(--color-ink-mute)] mt-0.5">
              Connect directly via FileZilla, Cyberduck, WinSCP, or the command line using your panel credentials.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase bg-[var(--color-ok)]/10 text-[var(--color-ok)] border border-[var(--color-ok)]/40">
              Port 2022 Active
            </span>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Host */}
            <div className="p-3 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-line)] space-y-1">
              <span className="label block">Server Address</span>
              <div className="flex items-center justify-between font-mono text-xs font-semibold text-[var(--color-ink)]">
                <span className="truncate">{sftpInfo?.host || primaryHost}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(sftpInfo?.host || primaryHost, 'sftp_host')}
                  className="p-1 hover:text-[var(--color-accent)] transition-colors cursor-pointer text-[var(--color-ink-mute)]"
                >
                  {copiedKey === 'sftp_host' ? <Check className="h-3 w-3 text-[var(--color-ok)]" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            </div>

            {/* Port */}
            <div className="p-3 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-line)] space-y-1">
              <span className="label block">Port</span>
              <div className="flex items-center justify-between font-mono text-xs font-semibold text-[var(--color-ink)]">
                <span>{sftpInfo?.port || 2022}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(String(sftpInfo?.port || 2022), 'sftp_port')}
                  className="p-1 hover:text-[var(--color-accent)] transition-colors cursor-pointer text-[var(--color-ink-mute)]"
                >
                  {copiedKey === 'sftp_port' ? <Check className="h-3 w-3 text-[var(--color-ok)]" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            </div>

            {/* Username */}
            <div className="p-3 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-line)] space-y-1">
              <span className="label block">Username</span>
              <div className="flex items-center justify-between font-mono text-xs font-semibold text-[var(--color-ink)]">
                <span className="truncate">{sftpInfo?.username || `admin.${server.id.substring(0, 8)}`}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(sftpInfo?.username || `admin.${server.id.substring(0, 8)}`, 'sftp_user')}
                  className="p-1 hover:text-[var(--color-accent)] transition-colors cursor-pointer text-[var(--color-ink-mute)]"
                >
                  {copiedKey === 'sftp_user' ? <Check className="h-3 w-3 text-[var(--color-ok)]" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            </div>

            {/* Password */}
            <div className="p-3 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-line)] space-y-1">
              <span className="label block">Password</span>
              <div className="flex items-center justify-between text-xs text-[var(--color-ink-dim)]">
                <span>Account Password</span>
                <span className="text-[10px] text-[var(--color-ink-mute)] font-mono">(Login pass)</span>
              </div>
            </div>
          </div>

          {/* SFTP One-Click Launch & Client Profiles */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <a
              href={sftpInfo?.uri || `sftp://${sftpInfo?.username || 'admin'}@${primaryHost}:2022`}
              className="btn btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Launch SFTP Client</span>
            </a>

            <a
              href={`/api/v1/servers/${server.id}/sftp/config/filezilla`}
              download={`${server.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-filezilla.xml`}
              className="btn btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5"
            >
              <FileCode className="h-3.5 w-3.5 text-[var(--color-accent)]" />
              <span>FileZilla Config</span>
            </a>

            <a
              href={`/api/v1/servers/${server.id}/sftp/config/cyberduck`}
              download={`${server.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.duck`}
              className="btn btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5"
            >
              <FileCode className="h-3.5 w-3.5 text-[var(--color-ink-mute)]" />
              <span>Cyberduck Profile</span>
            </a>
          </div>

          {/* Active SFTP Sessions */}
          {sftpInfo?.activeSessions && sftpInfo.activeSessions.length > 0 && (
            <div className="pt-3 border-t border-[var(--color-line)] space-y-2">
              <h4 className="label flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-[var(--color-ok)]" />
                <span>Live Active SFTP Connections ({sftpInfo.activeSessions.length})</span>
              </h4>
              <div className="space-y-1.5">
                {sftpInfo.activeSessions.map((sess: SftpActiveSessionDTO) => (
                  <div key={sess.id} className="p-2.5 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-line)] flex items-center justify-between text-xs">
                    <div className="space-y-0.5">
                      <span className="font-mono text-[var(--color-ink)] font-semibold">{sess.username}</span>
                      <span className="text-[var(--color-ink-mute)] ml-2">from {sess.clientIp}</span>
                      <p className="text-[10px] text-[var(--color-ink-mute)] font-mono">Connected at: {new Date(sess.connectedAt).toLocaleTimeString()}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTerminateSession(sess.id)}
                      disabled={terminatingSessionId === sess.id}
                      className="btn btn-danger text-[10px] py-1 px-2.5"
                    >
                      {terminatingSessionId === sess.id ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          4. ASSIGN ALLOCATION MODAL
      ───────────────────────────────────────────────────────────────────────────── */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-lg bg-[var(--color-surface)] border border-[var(--color-line)] p-5 space-y-4 anim-scale-in">
            <div>
              <h3 className="text-base font-semibold text-[var(--color-ink)]">Assign Port Allocation</h3>
              <p className="text-xs text-[var(--color-ink-mute)] mt-0.5">
                Select an unassigned port from {networkData?.node.name || 'the node'} to attach to this server.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="label block mb-1">
                  Select Port
                </label>
                {networkData?.availableAllocations && networkData.availableAllocations.length > 0 ? (
                  <select
                    value={selectedAllocId}
                    onChange={(e) => setSelectedAllocId(e.target.value)}
                    className="field w-full text-xs font-mono"
                  >
                    <option value="">Auto-assign next available port</option>
                    {networkData.availableAllocations.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.ip}:{a.port} {a.notes ? `(${a.notes})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="p-2.5 rounded-md bg-[var(--color-warn)]/10 border border-[var(--color-warn)]/30 text-[var(--color-warn)] text-xs">
                    No unassigned ports in the node's allocation pool. The system will auto-allocate a new port.
                  </div>
                )}
              </div>

              <div>
                <label className="label block mb-1">
                  Port Purpose / Notes (Optional)
                </label>
                <input
                  type="text"
                  value={allocNotesInput}
                  onChange={(e) => setAllocNotesInput(e.target.value)}
                  placeholder="e.g. Dynmap Web Server, Votifier"
                  className="field w-full text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-line)]">
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="btn btn-ghost text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAssignAllocation}
                disabled={assigningPort}
                className="btn btn-primary text-xs"
              >
                {assigningPort ? 'Assigning...' : 'Assign Port'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
