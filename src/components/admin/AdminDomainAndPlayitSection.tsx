import React, { useEffect, useState, useCallback } from 'react';
import {
  Globe,
  Radio,
  Check,
  Copy,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  Play,
  Square,
  Download,
  Terminal,
  Save,
  Loader2,
  ExternalLink,
  KeyRound,
  ChevronDown,
  ChevronUp,
  Server as ServerIcon,
  Zap,
  Clock
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { useToast } from '../../lib/ToastContext';
import { DomainConnectionSettings, PlayitTunnelSettings } from '../../types';

interface HostNetworkInfo {
  publicIp: string | null;
  localIps: string[];
  panelPort: number;
}

interface DomainVerificationResult {
  domain: string;
  validHostname: boolean;
  dnsStatus: 'verified' | 'mismatch' | 'unconfigured' | 'invalid';
  resolvedIpv4: string[];
  resolvedIpv6: string[];
  cnames: string[];
  matchesExpectedIp: boolean;
  httpReachable: boolean | null;
  httpsReachable: boolean | null;
  checkedAt: string;
  summary: string;
}

interface AutomationStepResult {
  id: string;
  label: string;
  status: 'done' | 'waiting' | 'skipped' | 'action_required';
  detail: string;
}

interface ProxyCapabilities {
  caddyInstalled: boolean;
  nginxInstalled: boolean;
  isRoot: boolean;
  canWriteCaddy: boolean;
  canWriteNginx: boolean;
  systemctlAvailable: boolean;
}

interface PlayitAgentStatus {
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  running: boolean;
  state: 'not_installed' | 'stopped' | 'starting' | 'awaiting_claim' | 'connected' | 'error';
  pid: number | null;
  claimUrl: string | null;
  detectedAddresses: string[];
  lastError: string | null;
  logs: string[];
  startedAt: string | null;
}

export const AdminDomainAndPlayitSection: React.FC = () => {
  const { toast } = useToast();

  // Domain state
  const [loadingDomain, setLoadingDomain] = useState(true);
  const [savingDomain, setSavingDomain] = useState(false);
  const [autoPublishing, setAutoPublishing] = useState(false);
  const [verifyingDomain, setVerifyingDomain] = useState(false);
  const [showCloudflarePanel, setShowCloudflarePanel] = useState(false);
  const [domainConfig, setDomainConfig] = useState<DomainConnectionSettings>({
    panelDomain: '',
    gameDomain: '',
    enforceHttps: true,
    reverseProxyMode: 'caddy',
    verified: false,
    autoPublish: true,
    cloudflareApiToken: '',
    cloudflareProxied: false,
    autoStatus: 'idle'
  });
  const [hostNetwork, setHostNetwork] = useState<HostNetworkInfo>({
    publicIp: null,
    localIps: [],
    panelPort: 3000
  });
  const [proxyCapabilities, setProxyCapabilities] = useState<ProxyCapabilities | null>(null);
  const [verifyResult, setVerifyResult] = useState<DomainVerificationResult | null>(null);
  const [automationSteps, setAutomationSteps] = useState<AutomationStepResult[]>([]);
  const [oneLineProxyCmd, setOneLineProxyCmd] = useState<string>('');
  const [activeProxySnippet, setActiveProxySnippet] = useState<'caddy' | 'nginx'>('caddy');

  // Playit state
  const [loadingPlayit, setLoadingPlayit] = useState(true);
  const [savingPlayit, setSavingPlayit] = useState(false);
  const [installingPlayit, setInstallingPlayit] = useState(false);
  const [startingAgent, setStartingAgent] = useState(false);
  const [stoppingAgent, setStoppingAgent] = useState(false);
  const [manualInstallCmds, setManualInstallCmds] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  const [playitConfig, setPlayitConfig] = useState<PlayitTunnelSettings & { hasSecretKey?: boolean }>({
    enabled: false,
    publicAddress: '',
    agentSecretKey: '',
    claimUrl: '',
    autoStartAgent: false,
    targetPort: 25565,
    protocol: 'tcp',
    notes: ''
  });
  const [playitAgent, setPlayitAgent] = useState<PlayitAgentStatus>({
    installed: false,
    binaryPath: null,
    version: null,
    running: false,
    state: 'not_installed',
    pid: null,
    claimUrl: null,
    detectedAddresses: [],
    lastError: null,
    logs: [],
    startedAt: null
  });

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyText = (value: string, key: string, label?: string) => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    toast.success(label ? `Copied ${label}` : 'Copied to clipboard');
    setTimeout(() => setCopiedKey(null), 2200);
  };

  const fetchDomainData = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingDomain(true);
    try {
      const res = await apiRequest('/admin/network/domain');
      if (res.success && res.data) {
        if (res.data.domainConfig) setDomainConfig(res.data.domainConfig);
        if (res.data.hostNetwork) setHostNetwork(res.data.hostNetwork);
        if (res.data.proxyCapabilities) setProxyCapabilities(res.data.proxyCapabilities);
      }
    } catch (err: any) {
      if (!quiet) toast.error(err?.message || 'Failed to load domain settings');
    } finally {
      if (!quiet) setLoadingDomain(false);
    }
  }, [toast]);

  const fetchPlayitStatus = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingPlayit(true);
    try {
      const res = await apiRequest('/admin/network/playit/status');
      if (res.success && res.data) {
        if (!quiet && res.data.config) {
          setPlayitConfig(res.data.config);
        }
        if (res.data.agent) {
          setPlayitAgent(res.data.agent);
        }
      }
    } catch (err: any) {
      if (!quiet) toast.error(err?.message || 'Failed to load Playit.gg status');
    } finally {
      if (!quiet) setLoadingPlayit(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchDomainData();
    fetchPlayitStatus();
  }, [fetchDomainData, fetchPlayitStatus]);

  // Automatic background propagation watcher when waiting on DNS
  useEffect(() => {
    if (domainConfig.autoStatus !== 'waiting_dns' || !domainConfig.panelDomain.trim()) {
      return;
    }
    let checks = 0;
    const timer = setInterval(async () => {
      checks += 1;
      if (checks > 12) {
        clearInterval(timer);
        return;
      }
      try {
        const res = await apiRequest('/admin/network/domain/verify', {
          method: 'POST',
          body: JSON.stringify({ domain: domainConfig.panelDomain.trim() })
        });
        if (res.success && res.data) {
          if (res.data.dnsStatus === 'verified') {
            setVerifyResult(res.data);
            await fetchDomainData(true);
            toast.success(`${res.data.domain} is now verified and live!`);
            clearInterval(timer);
          }
        }
      } catch {
        // ignore transient poll error
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [domainConfig.autoStatus, domainConfig.panelDomain, fetchDomainData, toast]);

  // Auto-dismiss DNS verification popup after 3 seconds
  useEffect(() => {
    if (!verifyResult) return;
    const timer = setTimeout(() => {
      setVerifyResult(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [verifyResult]);

  // Poll Playit agent logs/claim URL while active
  useEffect(() => {
    if (
      !playitAgent.running &&
      playitAgent.state !== 'starting' &&
      playitAgent.state !== 'awaiting_claim' &&
      playitAgent.state !== 'connected'
    ) {
      return;
    }
    const timer = setInterval(() => {
      fetchPlayitStatus(true);
    }, 3000);
    return () => clearInterval(timer);
  }, [playitAgent.running, playitAgent.state, fetchPlayitStatus]);

  const handleAutoPublishDomain = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const targetPanel = domainConfig.panelDomain.trim();
    if (!targetPanel) {
      toast.warning('Enter a custom domain (e.g. panel.yourdomain.com) first.');
      return;
    }

    setAutoPublishing(true);
    try {
      const res = await apiRequest('/admin/network/domain/auto-publish', {
        method: 'POST',
        body: JSON.stringify({
          panelDomain: domainConfig.panelDomain,
          gameDomain: domainConfig.gameDomain,
          enforceHttps: domainConfig.enforceHttps,
          reverseProxyMode: domainConfig.reverseProxyMode,
          autoPublish: true,
          cloudflareApiToken: domainConfig.cloudflareApiToken || '',
          cloudflareProxied: Boolean(domainConfig.cloudflareProxied)
        })
      });
      if (res.success && res.data) {
        if (res.data.domainConfig) setDomainConfig(res.data.domainConfig);
        if (Array.isArray(res.data.steps)) setAutomationSteps(res.data.steps);
        if (res.data.dnsResult) setVerifyResult(res.data.dnsResult);
        if (res.data.proxyResult?.oneLineCommand) setOneLineProxyCmd(res.data.proxyResult.oneLineCommand);

        await Promise.all([fetchPlayitStatus(false), fetchDomainData(true)]);

        if (res.data.autoStatus === 'live') {
          toast.success(res.data.autoMessage || 'Previous connections disconnected and domain published!');
        } else if (res.data.autoStatus === 'waiting_dns') {
          toast.info(res.data.autoMessage || 'Previous connections disconnected! Watching DNS propagation...');
        } else {
          toast.warning(res.data.autoMessage || 'Previous connections disconnected; complete remaining step below.');
        }
      } else {
        toast.error(res.error?.message || 'Auto-publish failed.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Auto-publish failed.');
    } finally {
      setAutoPublishing(false);
    }
  };

  const handleSaveDomainOnly = async () => {
    setSavingDomain(true);
    try {
      const res = await apiRequest('/admin/network/domain', {
        method: 'PUT',
        body: JSON.stringify({
          panelDomain: domainConfig.panelDomain,
          gameDomain: domainConfig.gameDomain,
          enforceHttps: domainConfig.enforceHttps,
          reverseProxyMode: domainConfig.reverseProxyMode,
          autoPublish: Boolean(domainConfig.autoPublish),
          cloudflareApiToken: domainConfig.cloudflareApiToken || '',
          cloudflareProxied: Boolean(domainConfig.cloudflareProxied)
        })
      });
      if (res.success && res.data) {
        setDomainConfig(res.data);
        toast.success('Domain settings saved.');
      } else {
        toast.error(res.error?.message || 'Failed to save domain settings.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save domain settings.');
    } finally {
      setSavingDomain(false);
    }
  };

  const handleVerifyDomain = async () => {
    const targetDomain = domainConfig.panelDomain.trim() || domainConfig.gameDomain.trim();
    if (!targetDomain) {
      toast.warning('Enter a Panel Domain first to verify DNS.');
      return;
    }
    setVerifyingDomain(true);
    try {
      const res = await apiRequest('/admin/network/domain/verify', {
        method: 'POST',
        body: JSON.stringify({ domain: targetDomain })
      });
      if (res.success && res.data) {
        setVerifyResult(res.data);
        await fetchDomainData(true);
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

  const handleInstallPlayit = async () => {
    setInstallingPlayit(true);
    setManualInstallCmds([]);
    try {
      const res = await apiRequest('/admin/network/playit/install', { method: 'POST' });
      if (res.data?.agent) setPlayitAgent(res.data.agent);
      if (res.success) {
        toast.success(res.message || 'Playit agent installed.');
      } else {
        if (Array.isArray(res.data?.manualCommands)) {
          setManualInstallCmds(res.data.manualCommands);
        }
        toast.warning(res.message || res.error?.message || 'Automatic Playit install unavailable.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Playit installation failed.');
    } finally {
      setInstallingPlayit(false);
    }
  };

  const handleStartPlayit = async () => {
    setStartingAgent(true);
    try {
      const res = await apiRequest('/admin/network/playit/start', {
        method: 'POST',
        body: JSON.stringify({ agentSecretKey: playitConfig.agentSecretKey })
      });
      if (res.data?.agent) setPlayitAgent(res.data.agent);
      if (res.success) {
        setShowLogs(true);
        toast.success(res.message || 'Playit tunnel agent started.');
      } else {
        toast.error(res.error?.message || res.message || 'Could not start Playit agent.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Could not start Playit agent.');
    } finally {
      setStartingAgent(false);
    }
  };

  const handleStopPlayit = async () => {
    setStoppingAgent(true);
    try {
      const res = await apiRequest('/admin/network/playit/stop', { method: 'POST' });
      if (res.data?.agent) setPlayitAgent(res.data.agent);
      if (res.success) {
        toast.info(res.message || 'Playit agent stopped.');
      } else {
        toast.error(res.error?.message || 'Failed to stop Playit agent.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to stop Playit agent.');
    } finally {
      setStoppingAgent(false);
    }
  };

  const handleSavePlayitConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPlayit(true);
    try {
      const res = await apiRequest('/admin/network/playit/config', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: playitConfig.enabled,
          publicAddress: playitConfig.publicAddress,
          agentSecretKey: playitConfig.agentSecretKey || '',
          autoStartAgent: playitConfig.autoStartAgent,
          targetPort: Number(playitConfig.targetPort) || 25565,
          protocol: playitConfig.protocol,
          notes: playitConfig.notes || ''
        })
      });
      if (res.success && res.data) {
        if (res.data.config) setPlayitConfig(res.data.config);
        if (res.data.agent) setPlayitAgent(res.data.agent);
        toast.success('Playit.gg configuration saved.');
      } else {
        toast.error(res.error?.message || 'Failed to save Playit configuration.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save Playit configuration.');
    } finally {
      setSavingPlayit(false);
    }
  };

  const cleanPanelHost = domainConfig.panelDomain.trim() || 'panel.example.com';
  const hostPublicIp = hostNetwork.publicIp || hostNetwork.localIps[0] || '<YOUR_SERVER_PUBLIC_IP>';
  const panelPort = hostNetwork.panelPort || 3000;

  const caddySnippet = `${cleanPanelHost} {\n    reverse_proxy 127.0.0.1:${panelPort}\n}`;
  const nginxSnippet = `server {\n    listen 80;\n    server_name ${cleanPanelHost};\n\n    location / {\n        proxy_pass http://127.0.0.1:${panelPort};\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection "upgrade";\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}`;

  const activeClaimUrl = playitAgent.claimUrl || playitConfig.claimUrl || '';

  return (
    <div className="space-y-6">
      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 1: CONNECT CUSTOM DOMAIN (PANEL & GAME NODES)
         ═══════════════════════════════════════════════════════════════════════ */}
      <section className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Globe className="h-4 w-4 text-amber-400" />
              <span>Connect Custom Domain</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Bind a custom domain name to your panel and game servers with live DNS verification and reverse-proxy configs.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
            <span className="text-zinc-400">
              Host IP: <span className="text-zinc-100 font-semibold">{hostPublicIp}</span>
            </span>
            <span className="text-zinc-600">·</span>
            {domainConfig.autoStatus === 'live' || domainConfig.verified ? (
              <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Live & Public
              </span>
            ) : domainConfig.autoStatus === 'waiting_dns' ? (
              <span className="flex items-center gap-1.5 text-amber-400 font-semibold">
                <Clock className="h-3.5 w-3.5 animate-pulse" />
                Watching DNS
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-zinc-400">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                Not Linked
              </span>
            )}
          </div>
        </div>

        {loadingDomain ? (
          <div className="p-10 flex items-center justify-center gap-2 text-xs text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
            <span>Loading domain and host network details...</span>
          </div>
        ) : (
          <form onSubmit={handleAutoPublishDomain} className="p-5 space-y-5">
            {/* Public URL Banner when active */}
            {domainConfig.panelDomain.trim() && domainConfig.publicUrl && (
              <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-0.5 min-w-0">
                  <div className="text-[11px] font-medium text-zinc-400">Public Panel Address</div>
                  <div className="text-xs font-mono font-semibold text-emerald-400 truncate">
                    {domainConfig.publicUrl}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => copyText(domainConfig.publicUrl || '', 'public_url', 'Public URL')}
                    className="px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedKey === 'public_url' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    Copy URL
                  </button>
                  <a
                    href={domainConfig.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-bold flex items-center gap-1 whitespace-nowrap"
                  >
                    <span>Open Domain</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Panel Domain (Web Dashboard)
                </label>
                <input
                  type="text"
                  value={domainConfig.panelDomain}
                  onChange={(e) => setDomainConfig((prev) => ({ ...prev, panelDomain: e.target.value }))}
                  placeholder="panel.yourdomain.com"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-amber-500 outline-none text-xs font-mono text-zinc-100"
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  Submitting automatically disconnects Playit tunnels &amp; previous domains, then binds DNS + reverse proxy on port {panelPort}.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Default Game / Node Domain (Optional)
                </label>
                <input
                  type="text"
                  value={domainConfig.gameDomain}
                  onChange={(e) => setDomainConfig((prev) => ({ ...prev, gameDomain: e.target.value }))}
                  placeholder="play.yourdomain.com"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-amber-500 outline-none text-xs font-mono text-zinc-100"
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  Automatically linked to your local compute node ({hostPublicIp}).
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Reverse Proxy / Edge Mode
                </label>
                <select
                  value={domainConfig.reverseProxyMode}
                  onChange={(e) =>
                    setDomainConfig((prev) => ({
                      ...prev,
                      reverseProxyMode: e.target.value as DomainConnectionSettings['reverseProxyMode']
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-amber-500 outline-none text-xs text-zinc-100"
                >
                  <option value="caddy">Caddy (Automatic Let's Encrypt HTTPS)</option>
                  <option value="nginx">Nginx + Certbot (Reverse Proxy)</option>
                  <option value="cloudflare">Cloudflare Proxy / Cloudflare Tunnel</option>
                  <option value="direct">Direct Port Access (No Reverse Proxy)</option>
                </select>
              </div>

              <div className="flex items-end">
                <label className="w-full flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 cursor-pointer">
                  <div>
                    <div className="text-xs font-medium text-zinc-200">Enforce HTTPS Redirect</div>
                    <div className="text-[11px] text-zinc-500">Recommended for OAuth logins & WebSocket console</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={domainConfig.enforceHttps}
                    onChange={(e) => setDomainConfig((prev) => ({ ...prev, enforceHttps: e.target.checked }))}
                    className="h-4 w-4 accent-amber-500 rounded"
                  />
                </label>
              </div>
            </div>

            {/* Optional Cloudflare Zero-Touch DNS Token */}
            <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowCloudflarePanel((v) => !v)}
                className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-medium text-zinc-200 hover:text-white cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  <span>Zero-Touch Cloudflare DNS Sync (Optional)</span>
                  {domainConfig.hasCloudflareToken && (
                    <span className="text-[11px] text-emerald-400 font-mono">· Token Connected</span>
                  )}
                </span>
                {showCloudflarePanel ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showCloudflarePanel && (
                <div className="border-t border-zinc-800 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Cloudflare API Token (Zone:DNS:Edit)
                    </label>
                    <input
                      type="password"
                      value={domainConfig.cloudflareApiToken || ''}
                      onChange={(e) => setDomainConfig((prev) => ({ ...prev, cloudflareApiToken: e.target.value }))}
                      placeholder={domainConfig.hasCloudflareToken ? 'Saved Cloudflare API Token (masked)' : 'Paste Cloudflare Zone DNS Edit API Token'}
                      className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 focus:border-amber-500 outline-none text-xs font-mono text-zinc-100"
                    />
                    <p className="text-[11px] text-zinc-500 mt-1">
                      When set, typing any domain automatically creates its DNS A & Minecraft SRV records in Cloudflare.
                    </p>
                  </div>
                  <div className="flex items-center">
                    <label className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 cursor-pointer">
                      <div>
                        <div className="text-xs font-medium text-zinc-200">Proxy Panel via Cloudflare Orange Cloud</div>
                        <div className="text-[11px] text-zinc-500">Game domains stay DNS-only so TCP/UDP ports pass through</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean(domainConfig.cloudflareProxied)}
                        onChange={(e) => setDomainConfig((prev) => ({ ...prev, cloudflareProxied: e.target.checked }))}
                        className="h-4 w-4 accent-amber-500 rounded"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Live Automation Pipeline Result */}
            {automationSteps.length > 0 && (
              <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-200">Automation Pipeline Status</span>
                  <span className="text-[11px] font-mono text-zinc-400">
                    {proxyCapabilities?.caddyInstalled ? 'Caddy Ready' : proxyCapabilities?.nginxInstalled ? 'Nginx Ready' : 'No Local Proxy Detected'}
                  </span>
                </div>
                <div className="divide-y divide-zinc-800">
                  {automationSteps.map((step) => (
                    <div key={step.id} className="px-4 py-2.5 flex items-start gap-2.5 text-xs">
                      <span className="mt-0.5 shrink-0">
                        {step.status === 'done' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        ) : step.status === 'waiting' ? (
                          <Clock className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
                        ) : step.status === 'action_required' ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                        ) : (
                          <Check className="h-3.5 w-3.5 text-zinc-500" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-zinc-200">{step.label}</div>
                        <div className="text-[11px] text-zinc-400 mt-0.5 break-words">{step.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {oneLineProxyCmd && domainConfig.proxyApplied === false && (
                  <div className="p-3.5 border-t border-zinc-800 bg-amber-500/5 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-amber-300">
                      <span>1-Line Host Proxy & Automatic HTTPS Setup (run on VPS if needed)</span>
                      <button
                        type="button"
                        onClick={() => copyText(oneLineProxyCmd, 'one_line_proxy', '1-line proxy setup command')}
                        className="text-zinc-200 hover:text-white flex items-center gap-1 cursor-pointer"
                      >
                        {copiedKey === 'one_line_proxy' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                        Copy Command
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-zinc-300 overflow-x-auto">{oneLineProxyCmd}</pre>
                  </div>
                )}
              </div>
            )}

            {/* Required DNS Records */}
            <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-200">Required DNS Records at Your Registrar</span>
                <span className="text-[11px] font-mono text-zinc-500">Cloudflare / Namecheap / Porkbun</span>
              </div>
              <div className="divide-y divide-zinc-800 text-xs font-mono">
                <div className="px-4 py-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                  <span className="sm:col-span-2 text-amber-400 font-semibold">A</span>
                  <span className="sm:col-span-4 text-zinc-200 truncate">{cleanPanelHost}</span>
                  <span className="sm:col-span-4 text-emerald-400 tabular-nums truncate">{hostPublicIp}</span>
                  <div className="sm:col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => copyText(hostPublicIp, 'dns_ip', 'Host IP')}
                      className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {copiedKey === 'dns_ip' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      Copy IP
                    </button>
                  </div>
                </div>
                {domainConfig.gameDomain.trim() && (
                  <div className="px-4 py-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <span className="sm:col-span-2 text-amber-400 font-semibold">A</span>
                    <span className="sm:col-span-4 text-zinc-200 truncate">{domainConfig.gameDomain.trim()}</span>
                    <span className="sm:col-span-4 text-emerald-400 tabular-nums truncate">{hostPublicIp}</span>
                    <div className="sm:col-span-2 flex justify-end text-[11px] text-zinc-500">DNS Only (No Proxy)</div>
                  </div>
                )}
              </div>
            </div>

            {/* Live DNS Verification Result (Temporary 3s Popup) */}
            {verifyResult && (
              <div
                role="status"
                aria-live="polite"
                className={`fixed top-5 right-5 z-50 w-[min(92vw,28rem)] p-4 rounded-xl border bg-zinc-950/95 backdrop-blur-md shadow-2xl text-xs space-y-1.5 anim-scale-in ${
                  verifyResult.dnsStatus === 'verified'
                    ? 'border-emerald-500/40 text-emerald-200'
                    : verifyResult.dnsStatus === 'mismatch'
                    ? 'border-amber-500/40 text-amber-200'
                    : 'border-rose-500/40 text-rose-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2 font-semibold">
                  <span className="flex items-center gap-1.5 min-w-0">
                    {verifyResult.dnsStatus === 'verified' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
                    )}
                    <span className="break-words">{verifyResult.summary}</span>
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[11px] opacity-80 tabular-nums">
                      {new Date(verifyResult.checkedAt).toLocaleTimeString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => setVerifyResult(null)}
                      className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-zinc-800/70 transition-colors cursor-pointer"
                      aria-label="Dismiss popup"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono opacity-90 pt-0.5">
                  <span>IPv4: {verifyResult.resolvedIpv4.join(', ') || 'None'}</span>
                  <span>·</span>
                  <span>CNAME: {verifyResult.cnames.join(', ') || 'None'}</span>
                  {verifyResult.httpReachable !== null && (
                    <>
                      <span>·</span>
                      <span>HTTP: {verifyResult.httpReachable ? 'Reachable' : 'Closed'}</span>
                      <span>·</span>
                      <span>HTTPS: {verifyResult.httpsReachable ? 'Reachable' : 'Not Configured'}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Reverse Proxy Config Generator */}
            <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
              <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-zinc-200">Reverse Proxy Config</span>
                  <span className="text-zinc-600">·</span>
                  <button
                    type="button"
                    onClick={() => setActiveProxySnippet('caddy')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                      activeProxySnippet === 'caddy' ? 'bg-amber-500 text-zinc-950 font-semibold' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Caddyfile
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveProxySnippet('nginx')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                      activeProxySnippet === 'nginx' ? 'bg-amber-500 text-zinc-950 font-semibold' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Nginx
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      activeProxySnippet === 'caddy' ? caddySnippet : nginxSnippet,
                      'proxy_snippet',
                      `${activeProxySnippet === 'caddy' ? 'Caddyfile' : 'Nginx'} config`
                    )
                  }
                  className="text-[11px] text-zinc-300 hover:text-white flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedKey === 'proxy_snippet' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  Copy Config
                </button>
              </div>
              <pre className="p-3.5 text-[11px] font-mono text-zinc-300 overflow-x-auto leading-relaxed">
                {activeProxySnippet === 'caddy' ? caddySnippet : nginxSnippet}
              </pre>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={handleVerifyDomain}
                disabled={verifyingDomain || (!domainConfig.panelDomain.trim() && !domainConfig.gameDomain.trim())}
                className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-100 flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {verifyingDomain ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />}
                <span>Verify DNS</span>
              </button>
              <button
                type="button"
                onClick={handleSaveDomainOnly}
                disabled={savingDomain || autoPublishing}
                className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-100 flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {savingDomain ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                <span>Save Only</span>
              </button>
              <button
                type="submit"
                disabled={autoPublishing || !domainConfig.panelDomain.trim()}
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-bold text-zinc-950 flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {autoPublishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                <span>{autoPublishing ? 'Disconnecting & Connecting...' : 'Disconnect All & Connect Domain'}</span>
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 2: MAKE A PUBLIC ADDRESS BY PLAYIT.GG
         ═══════════════════════════════════════════════════════════════════════ */}
      <section className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Radio className="h-4 w-4 text-emerald-400" />
              <span>Public Address via Playit.gg</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Expose game servers & services to the internet without port forwarding or exposing your home/VPS IP address.
            </p>
          </div>
          <div className="flex items-center gap-2.5 text-xs font-mono tabular-nums">
            <span
              className={`flex items-center gap-1.5 font-semibold ${
                playitAgent.state === 'connected'
                  ? 'text-emerald-400'
                  : playitAgent.state === 'awaiting_claim' || playitAgent.state === 'starting'
                  ? 'text-amber-400'
                  : playitAgent.state === 'error'
                  ? 'text-rose-400'
                  : 'text-zinc-400'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  playitAgent.state === 'connected'
                    ? 'bg-emerald-400'
                    : playitAgent.running
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-zinc-600'
                }`}
              />
              {playitAgent.state === 'not_installed'
                ? 'CLI Not Installed'
                : playitAgent.state === 'awaiting_claim'
                ? 'Awaiting Claim Link'
                : playitAgent.state === 'connected'
                ? 'Agent Connected'
                : playitAgent.state === 'starting'
                ? 'Starting Agent'
                : playitAgent.state === 'error'
                ? 'Agent Error'
                : 'Agent Stopped'}
            </span>
            {playitAgent.version && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-400">{playitAgent.version}</span>
              </>
            )}
          </div>
        </div>

        {loadingPlayit ? (
          <div className="p-10 flex items-center justify-center gap-2 text-xs text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
            <span>Checking Playit.gg tunnel agent...</span>
          </div>
        ) : (
          <form onSubmit={handleSavePlayitConfig} className="p-5 space-y-5">
            {/* Agent Controls & Claim Banner */}
            <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-zinc-100 flex items-center gap-2">
                    <ServerIcon className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Playit Host Tunnel Agent</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 font-mono">
                    {playitAgent.installed
                      ? `Binary: ${playitAgent.binaryPath}${playitAgent.pid ? ` · PID ${playitAgent.pid}` : ''}`
                      : 'Install the official Playit CLI to generate a claim link and tunnel local ports.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!playitAgent.installed ? (
                    <button
                      type="button"
                      onClick={handleInstallPlayit}
                      disabled={installingPlayit}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {installingPlayit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      <span>{installingPlayit ? 'Installing...' : 'Install Playit CLI'}</span>
                    </button>
                  ) : playitAgent.running ? (
                    <button
                      type="button"
                      onClick={handleStopPlayit}
                      disabled={stoppingAgent}
                      className="px-3.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {stoppingAgent ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                      <span>Stop Agent</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStartPlayit}
                      disabled={startingAgent}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {startingAgent ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      <span>{startingAgent ? 'Starting...' : 'Start Playit Agent'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => fetchPlayitStatus(false)}
                    className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                    title="Refresh Playit Status"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {playitAgent.lastError && (
                <div className="p-2.5 rounded bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                  {playitAgent.lastError}
                </div>
              )}

              {manualInstallCmds.length > 0 && (
                <div className="p-3 rounded bg-zinc-900 border border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-amber-400">
                    <span>Manual Ubuntu/Debian Install Commands</span>
                    <button
                      type="button"
                      onClick={() => copyText(manualInstallCmds.join('\n'), 'manual_playit', 'install commands')}
                      className="text-zinc-300 hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="h-3 w-3" /> Copy All
                    </button>
                  </div>
                  <pre className="text-[11px] font-mono text-zinc-300 overflow-x-auto leading-relaxed">
                    {manualInstallCmds.join('\n')}
                  </pre>
                </div>
              )}

              {/* Claim URL */}
              {activeClaimUrl && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-xs font-semibold text-amber-300">
                      Link Agent to Your Playit.gg Account
                    </div>
                    <div className="text-xs font-mono text-zinc-200 truncate">{activeClaimUrl}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => copyText(activeClaimUrl, 'claim_url', 'Claim URL')}
                      className="px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      {copiedKey === 'claim_url' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      Copy
                    </button>
                    <a
                      href={activeClaimUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold flex items-center gap-1 whitespace-nowrap"
                    >
                      <span>Open Claim Page</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              )}

              {/* Detected Addresses */}
              {playitAgent.detectedAddresses.length > 0 && (
                <div className="pt-1 space-y-1.5">
                  <div className="text-[11px] font-medium text-zinc-400">
                    Detected Playit Tunnel Addresses (click to apply):
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {playitAgent.detectedAddresses.map((addr) => (
                      <button
                        key={addr}
                        type="button"
                        onClick={() =>
                          setPlayitConfig((prev) => ({
                            ...prev,
                            enabled: true,
                            publicAddress: addr
                          }))
                        }
                        className="px-2.5 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-mono cursor-pointer"
                      >
                        {addr}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Tunnel Configuration Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Public Playit Address
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={playitConfig.publicAddress}
                    onChange={(e) => setPlayitConfig((prev) => ({ ...prev, publicAddress: e.target.value }))}
                    placeholder="my-network.gl.joinmc.link"
                    className="flex-1 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-emerald-500 outline-none text-xs font-mono text-zinc-100"
                  />
                  {playitConfig.publicAddress && (
                    <button
                      type="button"
                      onClick={() => copyText(playitConfig.publicAddress, 'playit_addr', 'Playit Address')}
                      className="px-2.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white cursor-pointer"
                      title="Copy Public Playit Address"
                    >
                      {copiedKey === 'playit_addr' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Assigned <span className="font-mono">*.joinmc.link</span> or <span className="font-mono">*.ply.gg:port</span> address from your Playit dashboard.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5 flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Agent Secret Key (Optional)</span>
                </label>
                <input
                  type="password"
                  value={playitConfig.agentSecretKey || ''}
                  onChange={(e) => setPlayitConfig((prev) => ({ ...prev, agentSecretKey: e.target.value }))}
                  placeholder={playitConfig.hasSecretKey ? 'Saved secret key (masked)' : 'Leave blank to generate a Claim URL on start'}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-emerald-500 outline-none text-xs font-mono text-zinc-100"
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  If blank, starting the agent automatically generates a Playit Claim Link above.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">Default Local Target Port</label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={playitConfig.targetPort}
                    onChange={(e) => setPlayitConfig((prev) => ({ ...prev, targetPort: Number(e.target.value) || 25565 }))}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-emerald-500 outline-none text-xs font-mono tabular-nums text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">Tunnel Protocol</label>
                  <select
                    value={playitConfig.protocol}
                    onChange={(e) =>
                      setPlayitConfig((prev) => ({
                        ...prev,
                        protocol: e.target.value as PlayitTunnelSettings['protocol']
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-emerald-500 outline-none text-xs text-zinc-100"
                  >
                    <option value="tcp">TCP (Minecraft Java / Web)</option>
                    <option value="udp">UDP (Bedrock / Voice)</option>
                    <option value="both">TCP + UDP</option>
                  </select>
                </div>
              </div>

              <div className="flex items-end">
                <label className="w-full flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 cursor-pointer">
                  <div>
                    <div className="text-xs font-medium text-zinc-200">Enable Public Playit Address</div>
                    <div className="text-[11px] text-zinc-500">Expose configured tunnel address across panel & server guides</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={playitConfig.enabled}
                    onChange={(e) => setPlayitConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
                    className="h-4 w-4 accent-emerald-500 rounded"
                  />
                </label>
              </div>
            </div>

            {/* Agent Logs Drawer */}
            <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowLogs((v) => !v)}
                className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-medium text-zinc-300 hover:text-white cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Terminal className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Agent Output Logs ({playitAgent.logs.length})</span>
                </span>
                {showLogs ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showLogs && (
                <div className="border-t border-zinc-800 p-3 max-h-48 overflow-y-auto bg-black/40 font-mono text-[11px] text-zinc-300 space-y-1">
                  {playitAgent.logs.length === 0 ? (
                    <div className="text-zinc-500">No output captured yet. Start the Playit agent to inspect live logs.</div>
                  ) : (
                    playitAgent.logs.map((line, idx) => (
                      <div key={idx} className="break-all">
                        {line}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-800">
              <button
                type="submit"
                disabled={savingPlayit}
                className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-xs font-bold text-zinc-950 flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {savingPlayit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                <span>Save Playit Settings</span>
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
};
