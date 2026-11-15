import dns from 'dns/promises';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { ChildProcess, execSync, spawn } from 'child_process';
import { isValidFQDN } from '../network/endpointResolver';

export interface DomainDnsVerificationResult {
  domain: string;
  validHostname: boolean;
  dnsStatus: 'verified' | 'mismatch' | 'unconfigured' | 'invalid';
  resolvedIpv4: string[];
  resolvedIpv6: string[];
  cnames: string[];
  srvRecords: Array<{
    name: string;
    port: number;
    priority: number;
    weight: number;
  }>;
  matchesExpectedIp: boolean;
  srvMatches: boolean;
  httpReachable: boolean | null;
  httpsReachable: boolean | null;
  checkedAt: string;
  summary: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

export function sanitizeHostname(input: string): string {
  return (input || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .split(':')[0]
    .replace(/\.$/, '')
    .toLowerCase();
}

function probeHttpEndpoint(url: string, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const client = url.startsWith('https://') ? https : http;
    try {
      const req = client.get(
        url,
        {
          timeout: timeoutMs,
          ...(url.startsWith('https://') ? { rejectUnauthorized: false } : {})
        } as any,
        (res) => {
          res.resume();
          resolve(typeof res.statusCode === 'number' && res.statusCode > 0);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

export async function verifyDomainDns(
  rawDomain: string,
  options?: {
    expectedIp?: string | null;
    expectedTarget?: string | null;
    expectedPort?: number;
    checkSrv?: boolean;
    checkHttp?: boolean;
  }
): Promise<DomainDnsVerificationResult> {
  const domain = sanitizeHostname(rawDomain);
  const checkedAt = new Date().toISOString();

  if (!isValidFQDN(domain)) {
    return {
      domain,
      validHostname: false,
      dnsStatus: 'invalid',
      resolvedIpv4: [],
      resolvedIpv6: [],
      cnames: [],
      srvRecords: [],
      matchesExpectedIp: false,
      srvMatches: false,
      httpReachable: null,
      httpsReachable: null,
      checkedAt,
      summary: 'Enter a valid fully qualified domain name (for example: panel.example.com or play.example.com).'
    };
  }

  const [resolvedIpv4, resolvedIpv6, cnames, srvRecords] = await Promise.all([
    withTimeout(dns.resolve4(domain), 4500, [] as string[]),
    withTimeout(dns.resolve6(domain), 4500, [] as string[]),
    withTimeout(dns.resolveCname(domain), 4500, [] as string[]),
    options?.checkSrv
      ? withTimeout(dns.resolveSrv(`_minecraft._tcp.${domain}`), 4500, [])
      : Promise.resolve([])
  ]);

  let lookupIps = [...resolvedIpv4];
  if (lookupIps.length === 0 && cnames.length > 0) {
    const lookedUp = await withTimeout(
      dns.lookup(domain, { all: true }).then((rows) => rows.map((r) => r.address)),
      4500,
      [] as string[]
    );
    lookupIps = lookedUp;
  }

  const expectedIp = options?.expectedIp?.trim() || '';
  const expectedTarget = options?.expectedTarget ? sanitizeHostname(options.expectedTarget) : '';
  const matchesExpectedIp = expectedIp
    ? lookupIps.includes(expectedIp)
    : lookupIps.length > 0 || cnames.length > 0;

  const srvMatches = Boolean(
    options?.checkSrv &&
      srvRecords.some((rec) => {
        const portOk = options.expectedPort ? rec.port === options.expectedPort : true;
        const targetHost = sanitizeHostname(rec.name);
        const targetOk =
          !expectedTarget ||
          targetHost === expectedTarget ||
          targetHost === domain;
        return portOk && targetOk;
      })
  );

  let httpReachable: boolean | null = null;
  let httpsReachable: boolean | null = null;

  if (options?.checkHttp && (lookupIps.length > 0 || cnames.length > 0)) {
    const [httpOk, httpsOk] = await Promise.all([
      probeHttpEndpoint(`http://${domain}`),
      probeHttpEndpoint(`https://${domain}`)
    ]);
    httpReachable = httpOk;
    httpsReachable = httpsOk;
  }

  let dnsStatus: DomainDnsVerificationResult['dnsStatus'] = 'unconfigured';
  let summary = '';

  const hasAnyDns = lookupIps.length > 0 || cnames.length > 0 || srvRecords.length > 0;

  if (!hasAnyDns) {
    dnsStatus = 'unconfigured';
    summary = `No A, CNAME${options?.checkSrv ? ', or _minecraft._tcp SRV' : ''} DNS records found yet for ${domain}. DNS propagation can take 1–10 minutes.`;
  } else if ((expectedIp && matchesExpectedIp) || srvMatches || (!expectedIp && hasAnyDns)) {
    dnsStatus = 'verified';
    if (srvMatches) {
      summary = `Verified SRV and host records for ${domain} routing to port ${options?.expectedPort}.`;
    } else if (expectedIp && matchesExpectedIp) {
      summary = `${domain} resolves to host IP ${expectedIp}.`;
    } else {
      summary = `${domain} resolves via DNS (${lookupIps[0] || cnames[0]}).`;
    }
  } else {
    dnsStatus = 'mismatch';
    const foundTarget = lookupIps[0] || cnames[0] || 'unknown';
    summary = expectedIp
      ? `${domain} currently resolves to ${foundTarget}, which differs from detected host IP ${expectedIp}. If using Cloudflare proxy (orange cloud), proxy IPs will differ from origin IP.`
      : `${domain} resolves to ${foundTarget}.`;
  }

  return {
    domain,
    validHostname: true,
    dnsStatus,
    resolvedIpv4: lookupIps,
    resolvedIpv6,
    cnames,
    srvRecords: srvRecords.map((r) => ({
      name: r.name,
      port: r.port,
      priority: r.priority,
      weight: r.weight
    })),
    matchesExpectedIp,
    srvMatches,
    httpReachable,
    httpsReachable,
    checkedAt,
    summary
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Playit.gg Tunnel Agent Manager
// ─────────────────────────────────────────────────────────────────────────────

export type PlayitAgentState =
  | 'not_installed'
  | 'stopped'
  | 'starting'
  | 'awaiting_claim'
  | 'connected'
  | 'error';

export interface PlayitAgentStatus {
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  running: boolean;
  state: PlayitAgentState;
  pid: number | null;
  claimUrl: string | null;
  detectedAddresses: string[];
  lastError: string | null;
  logs: string[];
  startedAt: string | null;
}

const DATA_BIN_DIR = path.join(process.cwd(), 'data', 'bin');
const LOCAL_PLAYIT_BIN = path.join(DATA_BIN_DIR, 'playit');
const PLAYIT_DATA_DIR = path.join(process.cwd(), 'data', 'playit');
const PLAYIT_SECRET_FILE = path.join(PLAYIT_DATA_DIR, 'secret.key');

let playitProc: ChildProcess | null = null;
let playitState: PlayitAgentState = 'stopped';
let playitClaimUrl: string | null = null;
let playitDetectedAddresses: string[] = [];
let playitLastError: string | null = null;
let playitLogs: string[] = [];
let playitStartedAt: string | null = null;

function appendPlayitLog(chunk: string) {
  const lines = chunk
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    playitLogs.push(line);
    if (playitLogs.length > 100) {
      playitLogs = playitLogs.slice(-100);
    }

    const claimMatch = line.match(/https:\/\/playit\.gg\/claim\/[a-zA-Z0-9_-]+/i);
    if (claimMatch) {
      playitClaimUrl = claimMatch[0];
      playitState = 'awaiting_claim';
    }

    const addrMatches = line.match(
      /\b[a-z0-9][a-z0-9-]*\.(?:gl\.)?(?:joinmc\.link|ply\.gg|playit\.gg)(?::\d{2,5})?\b/gi
    );
    if (addrMatches) {
      for (const addr of addrMatches) {
        const lower = addr.toLowerCase();
        if (!playitDetectedAddresses.includes(lower)) {
          playitDetectedAddresses.push(lower);
        }
      }
      playitState = 'connected';
    }

    if (
      /tunnel running|connected to playit|agent registered|program running/i.test(line) &&
      playitState !== 'awaiting_claim'
    ) {
      playitState = 'connected';
    }
  }
}

export function findPlayitBinary(): string | null {
  const candidates = [
    LOCAL_PLAYIT_BIN,
    '/usr/local/bin/playit',
    '/usr/bin/playit',
    '/bin/playit'
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        fs.accessSync(p, fs.constants.X_OK);
        return p;
      }
    } catch {
      // continue
    }
  }
  try {
    const resolved = execSync('command -v playit 2>/dev/null || true', {
      encoding: 'utf8',
      timeout: 1500
    }).trim();
    if (resolved) return resolved;
  } catch {
    // ignore
  }
  return null;
}

export function getPlayitVersion(binaryPath: string | null): string | null {
  if (!binaryPath) return null;
  try {
    const out = execSync(`"${binaryPath}" --version 2>&1 || true`, {
      encoding: 'utf8',
      timeout: 2000
    }).trim();
    return out.split('\n')[0]?.slice(0, 80) || null;
  } catch {
    return null;
  }
}

export function getPlayitAgentStatus(): PlayitAgentStatus {
  const binaryPath = findPlayitBinary();
  const installed = Boolean(binaryPath);
  const running = Boolean(playitProc && playitProc.exitCode === null && !playitProc.killed);

  const effectiveState: PlayitAgentState = !installed
    ? 'not_installed'
    : running
    ? playitState
    : playitLastError
    ? 'error'
    : 'stopped';

  return {
    installed,
    binaryPath,
    version: installed ? getPlayitVersion(binaryPath) : null,
    running,
    state: effectiveState,
    pid: running ? playitProc?.pid || null : null,
    claimUrl: playitClaimUrl,
    detectedAddresses: [...playitDetectedAddresses],
    lastError: playitLastError,
    logs: [...playitLogs],
    startedAt: running ? playitStartedAt : null
  };
}

function downloadFileWithRedirects(url: string, destPath: string, maxRedirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'AetherPanel-PlayitInstaller/1.0' },
        timeout: 20000
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          if (maxRedirects <= 0) {
            return reject(new Error('Too many redirects while downloading Playit binary.'));
          }
          return downloadFileWithRedirects(res.headers.location, destPath, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        }

        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => resolve());
        });
        file.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timed out downloading Playit binary.'));
    });
  });
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'AetherPanel-PlayitInstaller/1.0',
          Accept: 'application/vnd.github+json'
        },
        timeout: 10000
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`GitHub API responded with HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timed out querying Playit release metadata.'));
    });
  });
}

export async function installPlayitBinary(): Promise<{
  success: boolean;
  message: string;
  binaryPath?: string;
  manualCommands?: string[];
}> {
  const existing = findPlayitBinary();
  if (existing) {
    return {
      success: true,
      message: `Playit agent is already installed at ${existing}.`,
      binaryPath: existing
    };
  }

  if (process.platform !== 'linux') {
    return {
      success: false,
      message: `Automated Playit installation is supported on Linux hosts (detected ${process.platform}). Install Playit manually from https://playit.gg/download.`,
      manualCommands: ['https://playit.gg/download']
    };
  }

  const archSlug =
    process.arch === 'arm64'
      ? 'aarch64'
      : process.arch === 'x64'
      ? 'amd64'
      : null;

  if (!archSlug) {
    return {
      success: false,
      message: `Unsupported CPU architecture '${process.arch}' for automatic Playit download.`
    };
  }

  try {
    fs.mkdirSync(DATA_BIN_DIR, { recursive: true });
    const release = await fetchJson(
      'https://api.github.com/repos/playit-cloud/playit-agent/releases/latest'
    );
    const assets: Array<{ name: string; browser_download_url: string }> = release?.assets || [];
    const matched = assets.find((a) => {
      const n = a.name.toLowerCase();
      if (n.endsWith('.deb') || n.endsWith('.tar.gz') || n.endsWith('.zip') || n.endsWith('.exe')) {
        return false;
      }
      return n.includes('linux') && (n.includes(archSlug) || (archSlug === 'amd64' && n.includes('x86_64')));
    });

    if (!matched?.browser_download_url) {
      throw new Error(`No prebuilt Linux (${archSlug}) binary found in latest playit-agent release.`);
    }

    const tmpPath = `${LOCAL_PLAYIT_BIN}.tmp`;
    await downloadFileWithRedirects(matched.browser_download_url, tmpPath);
    fs.chmodSync(tmpPath, 0o755);
    fs.renameSync(tmpPath, LOCAL_PLAYIT_BIN);

    return {
      success: true,
      message: `Installed Playit agent (${matched.name}) to ${LOCAL_PLAYIT_BIN}.`,
      binaryPath: LOCAL_PLAYIT_BIN
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Automatic download failed: ${err?.message || 'Network unavailable'}. You can install Playit manually via apt on Ubuntu/Debian:`,
      manualCommands: [
        'curl -SsL https://playit-cloud.github.io/ppa/key.gpg | gpg --dearmor | sudo tee /etc/apt/trusted.gpg.d/playit.gpg >/dev/null',
        'echo "deb [signed-by=/etc/apt/trusted.gpg.d/playit.gpg] https://playit-cloud.github.io/ppa/data ./" | sudo tee /etc/apt/sources.list.d/playit-cloud.list',
        'sudo apt update && sudo apt install -y playit'
      ]
    };
  }
}

export function startPlayitAgent(secretKey?: string): {
  success: boolean;
  message: string;
  status: PlayitAgentStatus;
} {
  const binaryPath = findPlayitBinary();
  if (!binaryPath) {
    playitLastError = 'Playit CLI binary not found on host.';
    return {
      success: false,
      message: 'Playit CLI is not installed on this host yet. Click Install Playit CLI or install the playit package first.',
      status: getPlayitAgentStatus()
    };
  }

  if (playitProc && playitProc.exitCode === null && !playitProc.killed) {
    return {
      success: true,
      message: 'Playit tunnel agent is already running.',
      status: getPlayitAgentStatus()
    };
  }

  try {
    fs.mkdirSync(PLAYIT_DATA_DIR, { recursive: true });
    if (secretKey && secretKey.trim() && !secretKey.includes('••••')) {
      fs.writeFileSync(PLAYIT_SECRET_FILE, secretKey.trim(), { mode: 0o600 });
    }

    playitClaimUrl = null;
    playitDetectedAddresses = [];
    playitLastError = null;
    playitLogs = [];
    playitState = 'starting';
    playitStartedAt = new Date().toISOString();

    const args = ['--secret_path', PLAYIT_SECRET_FILE, '--stdout'];
    const proc = spawn(binaryPath, args, {
      cwd: PLAYIT_DATA_DIR,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    playitProc = proc;

    proc.stdout?.on('data', (d: Buffer) => appendPlayitLog(d.toString('utf8')));
    proc.stderr?.on('data', (d: Buffer) => appendPlayitLog(d.toString('utf8')));

    proc.on('error', (err) => {
      playitLastError = err.message;
      playitState = 'error';
      playitProc = null;
    });

    proc.on('exit', (code, signal) => {
      if (playitProc === proc) {
        playitProc = null;
      }
      if (code && code !== 0 && signal !== 'SIGTERM') {
        playitLastError = `Playit agent exited with code ${code}`;
        playitState = 'error';
      } else if (playitState !== 'error') {
        playitState = 'stopped';
      }
    });

    return {
      success: true,
      message: 'Playit tunnel agent started. Check claim link or detected tunnel addresses below.',
      status: getPlayitAgentStatus()
    };
  } catch (err: any) {
    playitLastError = err?.message || 'Failed to spawn Playit agent';
    playitState = 'error';
    return {
      success: false,
      message: playitLastError,
      status: getPlayitAgentStatus()
    };
  }
}

export function stopPlayitAgent(): {
  success: boolean;
  message: string;
  status: PlayitAgentStatus;
} {
  if (!playitProc || playitProc.exitCode !== null || playitProc.killed) {
    playitProc = null;
    playitState = 'stopped';
    return {
      success: true,
      message: 'Playit agent is already stopped.',
      status: getPlayitAgentStatus()
    };
  }

  const proc = playitProc;
  proc.kill('SIGTERM');
  setTimeout(() => {
    if (proc.exitCode === null && !proc.killed) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }, 2000);

  playitProc = null;
  playitState = 'stopped';
  playitLastError = null;

  return {
    success: true,
    message: 'Playit tunnel agent stopped.',
    status: getPlayitAgentStatus()
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Automated Domain Linking, Reverse Proxy & Cloudflare DNS Provisioning
// ─────────────────────────────────────────────────────────────────────────────

export interface AutomationStepResult {
  id: string;
  label: string;
  status: 'done' | 'waiting' | 'skipped' | 'action_required';
  detail: string;
}

export interface HostProxyCapabilities {
  caddyInstalled: boolean;
  nginxInstalled: boolean;
  isRoot: boolean;
  canWriteCaddy: boolean;
  canWriteNginx: boolean;
  systemctlAvailable: boolean;
}

function commandExists(cmd: string): boolean {
  try {
    const out = execSync(`command -v ${cmd} 2>/dev/null || true`, {
      encoding: 'utf8',
      timeout: 1500
    }).trim();
    return Boolean(out);
  } catch {
    return false;
  }
}

function canWritePath(targetPath: string): boolean {
  try {
    if (fs.existsSync(targetPath)) {
      fs.accessSync(targetPath, fs.constants.W_OK);
      return true;
    }
    const parent = path.dirname(targetPath);
    if (fs.existsSync(parent)) {
      fs.accessSync(parent, fs.constants.W_OK);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function detectHostProxyCapabilities(): HostProxyCapabilities {
  const isRoot = typeof process.getuid === 'function' ? process.getuid() === 0 : false;
  return {
    caddyInstalled: commandExists('caddy'),
    nginxInstalled: commandExists('nginx'),
    isRoot,
    canWriteCaddy: isRoot || canWritePath('/etc/caddy/Caddyfile'),
    canWriteNginx: isRoot || canWritePath('/etc/nginx/sites-available'),
    systemctlAvailable: commandExists('systemctl') && fs.existsSync('/run/systemd/system')
  };
}

export interface ProxyProvisionResult {
  applied: boolean;
  backend: 'caddy' | 'nginx' | 'cloudflare' | 'direct' | 'none';
  message: string;
  oneLineCommand: string;
}

function buildOneLineCaddyCommand(domains: string[], panelPort: number, enforceHttps: boolean): string {
  const cleanDomains = domains.map(sanitizeHostname).filter(Boolean);
  const blockHost = cleanDomains.map((d) => (enforceHttps ? d : `http://${d}`)).join(', ');
  const caddyBlock = `${blockHost} {\n    reverse_proxy 127.0.0.1:${panelPort}\n}`;
  const b64 = Buffer.from(`${caddyBlock}\n`, 'utf8').toString('base64');
  return `sudo bash -c 'command -v caddy >/dev/null || (apt-get update -qq && apt-get install -y -qq caddy); printf "%s" "${b64}" | base64 -d > /etc/caddy/Caddyfile && caddy fmt --overwrite /etc/caddy/Caddyfile && systemctl enable --now caddy && systemctl reload caddy'`;
}

export function provisionHostReverseProxy(params: {
  domains: string[];
  panelPort: number;
  mode: 'caddy' | 'nginx' | 'cloudflare' | 'direct';
  enforceHttps: boolean;
}): ProxyProvisionResult {
  const cleanDomains = Array.from(new Set(params.domains.map(sanitizeHostname).filter((d) => isValidFQDN(d))));
  if (cleanDomains.length === 0) {
    return {
      applied: false,
      backend: 'none',
      message: 'No valid domain specified for reverse proxy binding.',
      oneLineCommand: ''
    };
  }

  const oneLineCommand = buildOneLineCaddyCommand(cleanDomains, params.panelPort, params.enforceHttps);

  if (params.mode === 'direct') {
    return {
      applied: true,
      backend: 'direct',
      message: `Direct access mode active on port ${params.panelPort}.`,
      oneLineCommand
    };
  }

  const caps = detectHostProxyCapabilities();
  const preferredBackend = params.mode === 'nginx' ? 'nginx' : 'caddy';

  // Try Caddy
  if (preferredBackend === 'caddy' && caps.caddyInstalled && caps.canWriteCaddy) {
    try {
      const caddyFile = '/etc/caddy/Caddyfile';
      fs.mkdirSync('/etc/caddy', { recursive: true });
      const blockHosts = cleanDomains.map((d) => (params.enforceHttps ? d : `http://${d}`)).join(', ');
      const managedBlock = `# BEGIN AETHERPANEL MANAGED DOMAIN\n${blockHosts} {\n\treverse_proxy 127.0.0.1:${params.panelPort}\n}\n# END AETHERPANEL MANAGED DOMAIN`;

      const existing = fs.existsSync(caddyFile) ? fs.readFileSync(caddyFile, 'utf8') : '';
      const stripped = existing
        .replace(/# BEGIN AETHERPANEL MANAGED DOMAIN[\s\S]*?# END AETHERPANEL MANAGED DOMAIN\n?/g, '')
        .trim();
      const nextContent = stripped ? `${stripped}\n\n${managedBlock}\n` : `${managedBlock}\n`;

      fs.writeFileSync(caddyFile, nextContent, 'utf8');
      execSync(`caddy validate --config "${caddyFile}"`, { encoding: 'utf8', timeout: 5000 });
      if (caps.systemctlAvailable) {
        execSync('systemctl reload caddy || systemctl restart caddy', { encoding: 'utf8', timeout: 8000 });
      } else {
        execSync(`caddy reload --config "${caddyFile}" || true`, { encoding: 'utf8', timeout: 5000 });
      }

      return {
        applied: true,
        backend: 'caddy',
        message: `Caddy reverse proxy configured and reloaded for ${cleanDomains.join(', ')} → 127.0.0.1:${params.panelPort}.`,
        oneLineCommand
      };
    } catch (err: any) {
      return {
        applied: false,
        backend: 'caddy',
        message: `Could not auto-apply Caddy config: ${err?.message || 'Permission denied'}.`,
        oneLineCommand
      };
    }
  }

  // Try Nginx
  if ((preferredBackend === 'nginx' || (!caps.caddyInstalled && caps.nginxInstalled)) && caps.nginxInstalled && caps.canWriteNginx) {
    try {
      const confPath = '/etc/nginx/sites-available/aetherpanel.conf';
      const enabledPath = '/etc/nginx/sites-enabled/aetherpanel.conf';
      fs.mkdirSync('/etc/nginx/sites-available', { recursive: true });
      const serverBlock = [
        '# BEGIN AETHERPANEL MANAGED DOMAIN',
        'server {',
        '    listen 80;',
        `    server_name ${cleanDomains.join(' ')};`,
        '    location / {',
        `        proxy_pass http://127.0.0.1:${params.panelPort};`,
        '        proxy_http_version 1.1;',
        '        proxy_set_header Upgrade $http_upgrade;',
        '        proxy_set_header Connection "upgrade";',
        '        proxy_set_header Host $host;',
        '        proxy_set_header X-Real-IP $remote_addr;',
        '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
        '        proxy_set_header X-Forwarded-Proto $scheme;',
        '    }',
        '}',
        '# END AETHERPANEL MANAGED DOMAIN'
      ].join('\n');

      fs.writeFileSync(confPath, `${serverBlock}\n`, 'utf8');
      if (fs.existsSync('/etc/nginx/sites-enabled') && !fs.existsSync(enabledPath)) {
        fs.symlinkSync(confPath, enabledPath);
      }
      execSync('nginx -t', { encoding: 'utf8', timeout: 5000 });
      if (caps.systemctlAvailable) {
        execSync('systemctl reload nginx || nginx -s reload', { encoding: 'utf8', timeout: 8000 });
      } else {
        execSync('nginx -s reload || true', { encoding: 'utf8', timeout: 5000 });
      }

      return {
        applied: true,
        backend: 'nginx',
        message: `Nginx reverse proxy configured and reloaded for ${cleanDomains.join(', ')} → 127.0.0.1:${params.panelPort}.`,
        oneLineCommand
      };
    } catch (err: any) {
      return {
        applied: false,
        backend: 'nginx',
        message: `Could not auto-apply Nginx config: ${err?.message || 'Permission denied'}.`,
        oneLineCommand
      };
    }
  }

  return {
    applied: false,
    backend: params.mode === 'cloudflare' ? 'cloudflare' : 'none',
    message: caps.isRoot
      ? 'Neither Caddy nor Nginx is installed on this host yet. Run the 1-line proxy setup command on your VPS.'
      : 'Panel is not running as root, so /etc/caddy/Caddyfile cannot be edited automatically. Run the 1-line setup command on your VPS.',
    oneLineCommand
  };
}

function cloudflareRequest(
  apiToken: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  apiPath: string,
  payload?: Record<string, any>
): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : undefined;
    const req = https.request(
      `https://api.cloudflare.com/client/v4${apiPath}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
        },
        timeout: 10000
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw || '{}');
            if (!parsed.success) {
              const errMsg = parsed.errors?.[0]?.message || `Cloudflare API error (${res.statusCode})`;
              return reject(new Error(errMsg));
            }
            resolve(parsed);
          } catch {
            reject(new Error(`Invalid Cloudflare response (HTTP ${res.statusCode})`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Cloudflare API request timed out.'));
    });
    if (body) req.write(body);
    req.end();
  });
}

async function findCloudflareZone(hostname: string, apiToken: string): Promise<{ id: string; name: string } | null> {
  const parts = sanitizeHostname(hostname).split('.');
  for (let i = 0; i <= parts.length - 2; i++) {
    const candidate = parts.slice(i).join('.');
    const res = await cloudflareRequest(
      apiToken,
      'GET',
      `/zones?name=${encodeURIComponent(candidate)}&status=active`
    );
    const zone = res?.result?.[0];
    if (zone?.id) {
      return { id: zone.id, name: zone.name };
    }
  }
  return null;
}

async function upsertCloudflareARecord(params: {
  zoneId: string;
  apiToken: string;
  hostname: string;
  ip: string;
  proxied: boolean;
}): Promise<'created' | 'updated'> {
  const existing = await cloudflareRequest(
    params.apiToken,
    'GET',
    `/zones/${params.zoneId}/dns_records?type=A&name=${encodeURIComponent(params.hostname)}`
  );
  const record = existing?.result?.[0];
  const payload = {
    type: 'A',
    name: params.hostname,
    content: params.ip,
    ttl: params.proxied ? 1 : 120,
    proxied: params.proxied
  };
  if (record?.id) {
    await cloudflareRequest(params.apiToken, 'PUT', `/zones/${params.zoneId}/dns_records/${record.id}`, payload);
    return 'updated';
  }
  await cloudflareRequest(params.apiToken, 'POST', `/zones/${params.zoneId}/dns_records`, payload);
  return 'created';
}

async function upsertCloudflareSrvRecord(params: {
  zoneId: string;
  zoneName: string;
  apiToken: string;
  hostname: string;
  port: number;
}): Promise<'created' | 'updated'> {
  const srvFullName = `_minecraft._tcp.${params.hostname}`;
  const servicePart = '_minecraft';
  const protoPart = '_tcp';
  const subPart = params.hostname === params.zoneName
    ? '@'
    : params.hostname.slice(0, Math.max(0, params.hostname.length - params.zoneName.length - 1)) || '@';

  const existing = await cloudflareRequest(
    params.apiToken,
    'GET',
    `/zones/${params.zoneId}/dns_records?type=SRV&name=${encodeURIComponent(srvFullName)}`
  );
  const record = existing?.result?.[0];
  const payload = {
    type: 'SRV',
    name: srvFullName,
    ttl: 120,
    data: {
      service: servicePart,
      proto: protoPart,
      name: subPart,
      priority: 0,
      weight: 5,
      port: params.port,
      target: params.hostname
    }
  };
  if (record?.id) {
    await cloudflareRequest(params.apiToken, 'PUT', `/zones/${params.zoneId}/dns_records/${record.id}`, payload);
    return 'updated';
  }
  await cloudflareRequest(params.apiToken, 'POST', `/zones/${params.zoneId}/dns_records`, payload);
  return 'created';
}

export async function provisionCloudflarePanelDns(params: {
  apiToken: string;
  panelDomain?: string;
  gameDomain?: string;
  publicIp: string;
  proxied?: boolean;
}): Promise<{ synced: boolean; message: string; records: string[] }> {
  const token = params.apiToken.trim();
  if (!token) {
    return { synced: false, message: 'No Cloudflare API Token configured.', records: [] };
  }

  const records: string[] = [];
  const targets: Array<{ host: string; proxied: boolean }> = [];
  if (params.panelDomain && isValidFQDN(params.panelDomain)) {
    targets.push({ host: sanitizeHostname(params.panelDomain), proxied: Boolean(params.proxied) });
  }
  if (params.gameDomain && isValidFQDN(params.gameDomain)) {
    targets.push({ host: sanitizeHostname(params.gameDomain), proxied: false });
  }

  for (const t of targets) {
    const zone = await findCloudflareZone(t.host, token);
    if (!zone) {
      return {
        synced: false,
        message: `Could not find an active Cloudflare zone matching ${t.host}.`,
        records
      };
    }
    const action = await upsertCloudflareARecord({
      zoneId: zone.id,
      apiToken: token,
      hostname: t.host,
      ip: params.publicIp,
      proxied: t.proxied
    });
    records.push(`A ${t.host} → ${params.publicIp} (${action})`);
  }

  return {
    synced: records.length > 0,
    message: records.length > 0 ? `Cloudflare DNS synced: ${records.join('; ')}` : 'No valid hostnames to sync.',
    records
  };
}

export async function provisionCloudflareServerDns(params: {
  apiToken: string;
  hostname: string;
  publicIp: string;
  port: number;
}): Promise<{ synced: boolean; message: string; records: string[] }> {
  const token = params.apiToken.trim();
  const host = sanitizeHostname(params.hostname);
  if (!token || !isValidFQDN(host)) {
    return { synced: false, message: 'Missing Cloudflare token or invalid hostname.', records: [] };
  }

  const zone = await findCloudflareZone(host, token);
  if (!zone) {
    return {
      synced: false,
      message: `No active Cloudflare zone found for ${host}.`,
      records: []
    };
  }

  const aAction = await upsertCloudflareARecord({
    zoneId: zone.id,
    apiToken: token,
    hostname: host,
    ip: params.publicIp,
    proxied: false
  });
  const srvAction = await upsertCloudflareSrvRecord({
    zoneId: zone.id,
    zoneName: zone.name,
    apiToken: token,
    hostname: host,
    port: params.port
  });

  const records = [
    `A ${host} → ${params.publicIp} (${aAction})`,
    `SRV _minecraft._tcp.${host} → ${host}:${params.port} (${srvAction})`
  ];

  return {
    synced: true,
    message: `Cloudflare DNS records synced automatically (${records.join(' · ')}).`,
    records
  };
}

export async function deleteCloudflareHostRecords(
  apiToken: string,
  hostnames: string[]
): Promise<string[]> {
  const token = apiToken.trim();
  const removed: string[] = [];
  if (!token) return removed;

  const uniqueHosts = Array.from(new Set(hostnames.map(sanitizeHostname).filter((h) => isValidFQDN(h))));
  for (const host of uniqueHosts) {
    try {
      const zone = await findCloudflareZone(host, token);
      if (!zone) continue;

      const [aList, srvList] = await Promise.all([
        cloudflareRequest(token, 'GET', `/zones/${zone.id}/dns_records?type=A&name=${encodeURIComponent(host)}`).catch(() => null),
        cloudflareRequest(token, 'GET', `/zones/${zone.id}/dns_records?type=SRV&name=${encodeURIComponent(`_minecraft._tcp.${host}`)}`).catch(() => null)
      ]);

      const toDelete = [...(aList?.result || []), ...(srvList?.result || [])];
      for (const rec of toDelete) {
        if (rec?.id) {
          await cloudflareRequest(token, 'DELETE', `/zones/${zone.id}/dns_records/${rec.id}`).catch(() => {});
          removed.push(`${rec.type} ${rec.name}`);
        }
      }
    } catch {
      // ignore non-matching zone cleanup failures
    }
  }
  return removed;
}

export function cleanupHostReverseProxyConfigs(keepBackend?: 'caddy' | 'nginx' | 'cloudflare' | 'direct' | 'none'): string[] {
  const cleaned: string[] = [];
  const caps = detectHostProxyCapabilities();

  if (keepBackend !== 'caddy' && caps.canWriteCaddy) {
    try {
      const caddyFile = '/etc/caddy/Caddyfile';
      if (fs.existsSync(caddyFile)) {
        const current = fs.readFileSync(caddyFile, 'utf8');
        const next = current.replace(/# BEGIN AETHERPANEL MANAGED DOMAIN[\s\S]*?# END AETHERPANEL MANAGED DOMAIN\n?/g, '').trim();
        if (next !== current.trim()) {
          fs.writeFileSync(caddyFile, next ? `${next}\n` : '', 'utf8');
          if (caps.caddyInstalled && caps.systemctlAvailable) {
            try {
              execSync('systemctl reload caddy || true', { encoding: 'utf8', timeout: 4000 });
            } catch {}
          }
          cleaned.push('Caddy managed domain block');
        }
      }
    } catch {}
  }

  if (keepBackend !== 'nginx' && caps.canWriteNginx) {
    try {
      const enabledPath = '/etc/nginx/sites-enabled/aetherpanel.conf';
      const confPath = '/etc/nginx/sites-available/aetherpanel.conf';
      let touched = false;
      if (fs.existsSync(enabledPath)) {
        fs.unlinkSync(enabledPath);
        touched = true;
      }
      if (fs.existsSync(confPath)) {
        fs.unlinkSync(confPath);
        touched = true;
      }
      if (touched) {
        if (caps.nginxInstalled && caps.systemctlAvailable) {
          try {
            execSync('systemctl reload nginx || nginx -s reload || true', { encoding: 'utf8', timeout: 4000 });
          } catch {}
        }
        cleaned.push('Nginx aetherpanel.conf');
      }
    } catch {}
  }

  return cleaned;
}

export async function autoPublishPanelDomain(params: {
  panelDomain: string;
  gameDomain?: string;
  previousDomains?: string[];
  disconnectedPlayitCount?: number;
  hadGlobalPlayit?: boolean;
  publicIp: string | null;
  panelPort: number;
  reverseProxyMode: 'caddy' | 'nginx' | 'cloudflare' | 'direct';
  enforceHttps: boolean;
  cloudflareApiToken?: string;
  cloudflareProxied?: boolean;
}): Promise<{
  autoStatus: 'live' | 'waiting_dns' | 'partial' | 'action_required';
  autoMessage: string;
  publicUrl: string;
  steps: AutomationStepResult[];
  dnsResult: DomainDnsVerificationResult | null;
  proxyResult: ProxyProvisionResult;
  cloudflareSynced: boolean;
  disconnectedSummary: string[];
}> {
  const cleanPanel = sanitizeHostname(params.panelDomain);
  const cleanGame = params.gameDomain ? sanitizeHostname(params.gameDomain) : '';
  const steps: AutomationStepResult[] = [];
  const scheme = params.enforceHttps ? 'https' : 'http';
  const publicUrl = cleanPanel ? `${scheme}://${cleanPanel}` : '';

  if (!isValidFQDN(cleanPanel)) {
    return {
      autoStatus: 'action_required',
      autoMessage: 'Enter a valid domain name (e.g. panel.yourdomain.com).',
      publicUrl: '',
      steps: [
        {
          id: 'validate',
          label: 'Validate custom domain',
          status: 'action_required',
          detail: 'Domain name is invalid or empty.'
        }
      ],
      dnsResult: null,
      proxyResult: { applied: false, backend: 'none', message: 'Invalid domain.', oneLineCommand: '' },
      cloudflareSynced: false,
      disconnectedSummary: []
    };
  }

  // Step 1: Automatically disconnect everything previously linked (Playit agent, previous domains, stale proxy configs, old Cloudflare DNS)
  const disconnectedSummary: string[] = [];
  const playitWasRunning = getPlayitAgentStatus().running;
  if (playitWasRunning || params.hadGlobalPlayit) {
    stopPlayitAgent();
    disconnectedSummary.push(playitWasRunning ? 'Stopped Playit.gg host agent & disabled global Playit address' : 'Disabled global Playit.gg tunnel');
  }
  if (params.disconnectedPlayitCount && params.disconnectedPlayitCount > 0) {
    disconnectedSummary.push(`Cleared Playit.gg bindings from ${params.disconnectedPlayitCount} server(s)`);
  }

  const staleDomains = (params.previousDomains || [])
    .map(sanitizeHostname)
    .filter((d) => d && d !== cleanPanel && d !== cleanGame);

  if (staleDomains.length > 0) {
    disconnectedSummary.push(`Unlinked previous domain(s): ${staleDomains.join(', ')}`);
    if (params.cloudflareApiToken?.trim()) {
      const removedCf = await deleteCloudflareHostRecords(params.cloudflareApiToken, staleDomains);
      if (removedCf.length > 0) {
        disconnectedSummary.push(`Removed old Cloudflare records (${removedCf.join(', ')})`);
      }
    }
  }

  const proxyTarget = params.reverseProxyMode === 'nginx' ? 'nginx' : params.reverseProxyMode === 'caddy' ? 'caddy' : 'none';
  const cleanedProxies = cleanupHostReverseProxyConfigs(proxyTarget);
  if (cleanedProxies.length > 0) {
    disconnectedSummary.push(`Cleared previous proxy configs (${cleanedProxies.join(', ')})`);
  }

  steps.push({
    id: 'disconnect',
    label: 'Disconnect previous tunnels, proxies & old domains',
    status: 'done',
    detail:
      disconnectedSummary.length > 0
        ? disconnectedSummary.join(' · ')
        : 'No conflicting active tunnels or stale proxy bindings found; clean slate ready.'
  });

  steps.push({
    id: 'bind',
    label: 'Connect entered domain & host IP',
    status: 'done',
    detail: `Connected ${cleanPanel}${cleanGame ? ` + ${cleanGame}` : ''} (${params.publicIp ? `Host IP ${params.publicIp}` : `Port ${params.panelPort}`}).`
  });

  let cloudflareSynced = false;
  if (params.cloudflareApiToken?.trim() && params.publicIp) {
    try {
      const cf = await provisionCloudflarePanelDns({
        apiToken: params.cloudflareApiToken,
        panelDomain: cleanPanel,
        gameDomain: cleanGame || undefined,
        publicIp: params.publicIp,
        proxied: params.cloudflareProxied
      });
      cloudflareSynced = cf.synced;
      steps.push({
        id: 'cloudflare',
        label: 'Cloudflare automatic DNS record creation',
        status: cf.synced ? 'done' : 'action_required',
        detail: cf.message
      });
    } catch (err: any) {
      steps.push({
        id: 'cloudflare',
        label: 'Cloudflare automatic DNS record creation',
        status: 'action_required',
        detail: `Cloudflare API error: ${err?.message || 'Failed to sync DNS records'}`
      });
    }
  } else {
    steps.push({
      id: 'cloudflare',
      label: 'DNS A record routing',
      status: 'skipped',
      detail: params.publicIp
        ? `Manual DNS mode — point A record ${cleanPanel} → ${params.publicIp} (or add a Cloudflare API token for zero-touch DNS).`
        : 'Host public IP unavailable; configure DNS A record manually.'
    });
  }

  const proxyResult = provisionHostReverseProxy({
    domains: [cleanPanel],
    panelPort: params.panelPort,
    mode: params.reverseProxyMode,
    enforceHttps: params.enforceHttps
  });
  steps.push({
    id: 'proxy',
    label: 'Reverse proxy & HTTPS listener',
    status: proxyResult.applied ? 'done' : 'action_required',
    detail: proxyResult.message
  });

  const dnsResult = await verifyDomainDns(cleanPanel, {
    expectedIp: params.publicIp,
    checkHttp: true
  });

  const isDnsOk = dnsResult.dnsStatus === 'verified';
  const isHttpOk = Boolean(dnsResult.httpsReachable || dnsResult.httpReachable);

  steps.push({
    id: 'verify',
    label: 'Live DNS & public reachability check',
    status: isDnsOk && (isHttpOk || proxyResult.applied) ? 'done' : 'waiting',
    detail: dnsResult.summary
  });

  let autoStatus: 'live' | 'waiting_dns' | 'partial' | 'action_required' = 'waiting_dns';
  let autoMessage = '';

  if (isDnsOk && (isHttpOk || proxyResult.applied)) {
    autoStatus = 'live';
    autoMessage = `Previous connections cleared. ${cleanPanel} is now connected, proxied (${proxyResult.backend}), and publicly reachable.`;
  } else if (!isDnsOk && proxyResult.applied) {
    autoStatus = 'waiting_dns';
    autoMessage = `Previous connections cleared & reverse proxy updated for ${cleanPanel}; waiting for DNS A record to propagate to ${params.publicIp || 'this host'}.`;
  } else if (isDnsOk && !proxyResult.applied) {
    autoStatus = 'partial';
    autoMessage = `Previous connections cleared & DNS points to your host; run the 1-line proxy setup command on port 80/443.`;
  } else {
    autoStatus = cloudflareSynced ? 'waiting_dns' : 'action_required';
    autoMessage = cloudflareSynced
      ? `Previous connections cleared & Cloudflare DNS created for ${cleanPanel}; awaiting DNS propagation.`
      : `Previous connections cleared & ${cleanPanel} bound; point DNS A record to ${params.publicIp || 'your VPS IP'} and apply the 1-line proxy setup command.`;
  }

  return {
    autoStatus,
    autoMessage,
    publicUrl,
    steps,
    dnsResult,
    proxyResult,
    cloudflareSynced,
    disconnectedSummary
  };
}

export async function autoPublishServerDomain(params: {
  customDomain: string;
  previousDomain?: string;
  hadPlayit?: boolean;
  previousPlayitAddress?: string;
  publicIp: string | null;
  expectedTarget: string | null;
  port: number;
  cloudflareApiToken?: string;
}): Promise<{
  autoStatus: 'live' | 'waiting_dns' | 'partial' | 'action_required';
  autoMessage: string;
  steps: AutomationStepResult[];
  dnsResult: DomainDnsVerificationResult | null;
  cloudflareSynced: boolean;
  disconnectedSummary: string[];
}> {
  const host = sanitizeHostname(params.customDomain);
  const steps: AutomationStepResult[] = [];

  if (!isValidFQDN(host)) {
    return {
      autoStatus: 'action_required',
      autoMessage: 'Enter a valid domain name (e.g. play.yourdomain.com).',
      steps: [
        {
          id: 'validate',
          label: 'Validate server domain',
          status: 'action_required',
          detail: 'Domain name is invalid.'
        }
      ],
      dnsResult: null,
      cloudflareSynced: false,
      disconnectedSummary: []
    };
  }

  // Step 1: Automatically disconnect previous Playit & previous server domain
  const disconnectedSummary: string[] = [];
  if (params.hadPlayit || params.previousPlayitAddress) {
    disconnectedSummary.push(
      params.previousPlayitAddress
        ? `Disconnected Playit.gg tunnel (${params.previousPlayitAddress})`
        : 'Disabled Playit.gg tunnel'
    );
  }

  const prevHost = params.previousDomain ? sanitizeHostname(params.previousDomain) : '';
  if (prevHost && prevHost !== host) {
    disconnectedSummary.push(`Unlinked previous domain (${prevHost})`);
    if (params.cloudflareApiToken?.trim()) {
      const removedCf = await deleteCloudflareHostRecords(params.cloudflareApiToken, [prevHost]);
      if (removedCf.length > 0) {
        disconnectedSummary.push(`Removed old Cloudflare records (${removedCf.join(', ')})`);
      }
    }
  }

  steps.push({
    id: 'disconnect',
    label: 'Disconnect previous Playit & old domain',
    status: 'done',
    detail:
      disconnectedSummary.length > 0
        ? disconnectedSummary.join(' · ')
        : 'No active Playit tunnel or previous domain to disconnect.'
  });

  steps.push({
    id: 'bind',
    label: 'Connect entered domain & game port',
    status: 'done',
    detail: `Connected ${host} to server port ${params.port}${params.publicIp ? ` on ${params.publicIp}` : ''}.`
  });

  let cloudflareSynced = false;
  if (params.cloudflareApiToken?.trim() && params.publicIp) {
    try {
      const cf = await provisionCloudflareServerDns({
        apiToken: params.cloudflareApiToken,
        hostname: host,
        publicIp: params.publicIp,
        port: params.port
      });
      cloudflareSynced = cf.synced;
      steps.push({
        id: 'cloudflare',
        label: 'Cloudflare automatic A + SRV DNS sync',
        status: cf.synced ? 'done' : 'action_required',
        detail: cf.message
      });
    } catch (err: any) {
      steps.push({
        id: 'cloudflare',
        label: 'Cloudflare automatic A + SRV DNS sync',
        status: 'action_required',
        detail: `Cloudflare sync failed: ${err?.message || 'Unknown error'}`
      });
    }
  } else {
    steps.push({
      id: 'cloudflare',
      label: 'DNS A & _minecraft._tcp SRV records',
      status: 'skipped',
      detail: params.publicIp
        ? `Manual DNS mode — create A (${host} → ${params.publicIp}) and SRV (_minecraft._tcp → port ${params.port}).`
        : 'Create A & SRV DNS records pointing to your node host.'
    });
  }

  const dnsResult = await verifyDomainDns(host, {
    expectedIp: params.publicIp,
    expectedTarget: params.expectedTarget,
    expectedPort: params.port,
    checkSrv: true,
    checkHttp: false
  });

  const verified = dnsResult.dnsStatus === 'verified';
  steps.push({
    id: 'verify',
    label: 'Live DNS & SRV propagation check',
    status: verified ? 'done' : 'waiting',
    detail: dnsResult.summary
  });

  const autoStatus: 'live' | 'waiting_dns' | 'partial' | 'action_required' = verified
    ? 'live'
    : 'waiting_dns';

  const autoMessage = verified
    ? `Previous connections cleared. ${host} is verified and publicly routable to port ${params.port}.`
    : cloudflareSynced
    ? `Previous connections cleared & Cloudflare A + SRV records created for ${host}; waiting for global DNS propagation.`
    : `Previous connections cleared & ${host} connected. Waiting for A + SRV DNS records to propagate to ${params.publicIp || 'your node'}:${params.port}.`;

  return {
    autoStatus,
    autoMessage,
    steps,
    dnsResult,
    cloudflareSynced,
    disconnectedSummary
  };
}



