'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const YAML = require('yaml');

const execFileAsync = promisify(execFile);
const MAX_PROFILE_BYTES = 10 * 1024 * 1024;
const MODES = new Set(['rule', 'global', 'direct']);
const PORT = 17890;
const CONTROLLER_PORT = 19090;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(temporary, file);
}

function requireHttps(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入有效的 HTTPS 订阅链接。'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('订阅及远程规则地址必须使用 HTTPS，且不能包含 URL 用户名或密码。');
  if (url.hash) url.hash = '';
  return url;
}

async function fetchSubscription(value, fetcher = fetch) {
  let url = requireHttps(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await fetcher(url, { redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/yaml, text/yaml, text/plain, */*', 'User-Agent': 'DEX-STUDIO/0.1.0 Clash' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        if (redirects === 5) throw new Error('订阅重定向超过 5 次。');
        const location = response.headers.get('location');
        if (!location) throw new Error('订阅服务器的重定向缺少目标地址。');
        url = requireHttps(new URL(location, url).href);
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`订阅服务器返回 HTTP ${response.status}。`); }
      if (Number(response.headers.get('content-length')) > MAX_PROFILE_BYTES) { await response.body?.cancel(); throw new Error('订阅文件不能超过 10 MiB。'); }
      if (/text\/html/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw new Error('订阅返回了网页，请提供直接返回 Clash YAML 的订阅链接。'); }
      if (!response.body) throw new Error('订阅服务器返回空内容。');
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > MAX_PROFILE_BYTES) { controller.abort(); throw new Error('订阅文件不能超过 10 MiB。'); }
        chunks.push(Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf8');
      parseProfile(text);
      return text;
    }
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw new Error('订阅下载超时，请检查网络后重试。');
    // Never surface a token-bearing URL from a network exception.
    if (error instanceof TypeError) throw new Error('无法下载订阅，请检查 HTTPS 地址与网络连接。');
    throw error;
  } finally { clearTimeout(timer); }
}

function parseProfile(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_PROFILE_BYTES) throw new Error('配置文件不能超过 10 MiB。');
  if (/^\s*(?:<!doctype|<html)/i.test(text)) throw new Error('内容是网页，请使用 Clash YAML 配置。');
  let parsed;
  try {
    const doc = YAML.parseDocument(text, { uniqueKeys: true });
    if (doc.errors.length) throw new Error('invalid');
    parsed = doc.toJS({ maxAliasCount: 50 });
  } catch { throw new Error('YAML 配置解析失败，请检查格式、重复字段或过多的别名引用。'); }
  if (!isRecord(parsed) || !['proxies', 'proxy-groups', 'proxy-providers', 'rules'].some(key => Object.hasOwn(parsed, key))) {
    throw new Error('需要普通 Clash YAML 配置；不支持网页、Base64 节点列表或专属客户端协议。');
  }
  for (const key of ['proxies', 'proxy-groups', 'rules']) if (parsed[key] !== undefined && !Array.isArray(parsed[key])) throw new Error(`${key} 必须是列表。`);
  if (parsed.script !== undefined || String(parsed.mode).toLowerCase() === 'script' || parsed.rules?.some(rule => typeof rule === 'string' && /^\s*SCRIPT,/i.test(rule))) throw new Error('此版本不运行订阅内的脚本，请改用标准 Clash 规则配置。');
  return parsed;
}

function normalizeConfig(parsed, secret, profileId) {
  // Explicit allow-list keeps remote profiles from changing control listeners,
  // loading UI files, enabling tunnels, or selecting arbitrary local files.
  const result = {};
  for (const key of ['proxies', 'proxy-groups', 'rules', 'hosts', 'ipv6', 'udp', 'unified-delay', 'tcp-concurrent', 'global-client-fingerprint', 'geodata-mode', 'sniffer']) {
    if (parsed[key] !== undefined) result[key] = structuredClone(parsed[key]);
  }
  // Legacy Clash does not support arbitrary proxy-level filesystem references.
  for (const proxy of result.proxies || []) {
    if (!isRecord(proxy)) throw new Error('proxies 中的节点必须是对象。');
    for (const key of ['private-key', 'certificate', 'ca', 'ca-cert', 'private-key-path', 'certificate-path']) {
      if (proxy[key] !== undefined) throw new Error(`节点包含不支持的本地凭据字段 ${key}。`);
    }
  }
  for (const kind of ['proxy-providers', 'rule-providers']) {
    if (parsed[kind] === undefined) continue;
    if (!isRecord(parsed[kind])) throw new Error(`${kind} 必须是对象。`);
    result[kind] = {};
    let index = 0;
    for (const [name, provider] of Object.entries(parsed[kind])) {
      if (!isRecord(provider) || provider.type !== 'http') throw new Error('仅支持 HTTPS 远程 provider，不读取订阅指定的本地文件。');
      const clean = { type: 'http', url: requireHttps(provider.url).href, path: `./providers/${profileId}-${kind}-${index++}.yaml` };
      if (Number.isFinite(provider.interval) && provider.interval >= 0) clean.interval = provider.interval;
      if (kind === 'rule-providers' && ['domain', 'ipcidr', 'classical'].includes(provider.behavior)) clean.behavior = provider.behavior;
      if (kind === 'proxy-providers' && isRecord(provider['health-check'])) {
        const check = provider['health-check'];
        clean['health-check'] = { enable: check.enable === true, url: typeof check.url === 'string' ? check.url : 'https://www.gstatic.com/generate_204', interval: Math.max(60, Number(check.interval) || 300) };
      }
      Object.defineProperty(result[kind], name, { value: clean, enumerable: true, configurable: true, writable: true });
    }
  }
  if (isRecord(parsed.dns)) {
    result.dns = {};
    for (const key of ['enable', 'ipv6', 'default-nameserver', 'enhanced-mode', 'fake-ip-range', 'fake-ip-filter', 'nameserver', 'fallback', 'nameserver-policy', 'fallback-filter', 'use-hosts']) if (parsed.dns[key] !== undefined) result.dns[key] = structuredClone(parsed.dns[key]);
  }
  result['mixed-port'] = PORT;
  result.port = 0;
  result['socks-port'] = 0;
  result['redir-port'] = 0;
  result['tproxy-port'] = 0;
  result['allow-lan'] = false;
  result['bind-address'] = '127.0.0.1';
  result['external-controller'] = `127.0.0.1:${CONTROLLER_PORT}`;
  result.secret = secret;
  result.mode = MODES.has(String(parsed.mode).toLowerCase()) ? String(parsed.mode).toLowerCase() : 'rule';
  result['log-level'] = ['debug', 'info', 'warning', 'error', 'silent'].includes(parsed['log-level']) ? parsed['log-level'] : 'info';
  result.profile = { 'store-selected': true, 'store-fake-ip': false };
  result.tun = { enable: false };
  return result;
}

async function ensurePortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`本应用端口 ${port} 已被占用，请关闭占用该端口的程序后重试。`)));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolve));
  });
}

class WindowsProxyAdapter {
  constructor(scriptPath, recoveryFile) { this.scriptPath = scriptPath; this.recoveryFile = recoveryFile; }
  async run(mode) {
    if (process.platform !== 'win32') throw new Error('系统代理控制目前仅支持 Windows。');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath, '-Mode', mode, '-StateFile', this.recoveryFile], { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 });
    return JSON.parse(stdout.trim().replace(/^\uFEFF/, ''));
  }
  async enable() { return this.run('Apply'); }
  async restore() { return this.run('Restore'); }
  async read() { return this.run('Read'); }
}

class CoreService {
  constructor(options) {
    this.dataDir = options.dataDir;
    this.coreDir = options.coreDir;
    this.scriptsDir = options.scriptsDir;
    this.version = options.version || '0.1.0';
    this.fetcher = options.fetcher || fetch;
    this.spawnProcess = options.spawnProcess || spawn;
    this.portCheck = options.portCheck || ensurePortAvailable;
    this.watchdogEnabled = options.watchdog !== false;
    this.proxyAdapter = options.proxyAdapter || new WindowsProxyAdapter(path.join(this.scriptsDir, 'proxy-state.ps1'), path.join(this.dataDir, 'proxy-recovery.json'));
    this.state = { profiles: [], activeProfileId: null, settings: { theme: 'obsidian', startMinimized: false } };
    this.secret = crypto.randomBytes(32).toString('hex');
    this.child = null;
    this.watchdog = null;
    this.ready = false;
    this.disposed = false;
    this.systemProxy = false;
    this.coreVersion = null;
    this.logs = [];
    this.lastError = null;
    this.mode = 'rule';
    this.startPromise = null;
    this.stopPromise = null;
    this.snapshotPromise = null;
    this.restoreProxyPromise = null;
    this.proxyCheckedAt = 0;
  }

  async init() {
    await fs.mkdir(path.join(this.dataDir, 'profiles'), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'core', 'providers'), { recursive: true });
    try {
      const saved = JSON.parse(await fs.readFile(path.join(this.dataDir, 'state.json'), 'utf8'));
      if (Array.isArray(saved.profiles)) this.state.profiles = saved.profiles.filter(p => /^[a-f0-9-]{36}$/.test(p.id) && typeof p.name === 'string');
      this.state.activeProfileId = this.state.profiles.some(p => p.id === saved.activeProfileId) ? saved.activeProfileId : null;
      if (isRecord(saved.settings)) this.state.settings = { ...this.state.settings, ...saved.settings };
    } catch (error) { if (error.code !== 'ENOENT') this.log('warning', '已忽略无法读取的应用设置。'); }
    // Recovery belongs only to this app. Existing CFW state is never queried.
    if (await this.exists(path.join(this.dataDir, 'proxy-recovery.json'))) {
      try { await this.proxyAdapter.restore(); this.log('info', '已处理上次退出时的系统代理恢复记录。'); }
      catch { this.log('error', '上次的系统代理尚未恢复，请在设置中关闭系统代理重试。'); }
    }
    return this;
  }

  async exists(file) { try { await fs.access(file); return true; } catch { return false; } }
  async persist() { await atomicJson(path.join(this.dataDir, 'state.json'), this.state); }
  profile(id) { const profile = this.state.profiles.find(item => item.id === id); if (!profile) throw new Error('找不到该配置。'); return profile; }
  log(level, message) {
    // URLs and credentials can be present in core diagnostics; never show tokens.
    const safe = String(message).replace(/https?:\/\/[^\s"'<>]+/gi, '[远程地址]').replace(/(secret|password|token|authorization)\s*[:=]\s*\S+/gi, '$1=[已隐藏]').slice(0, 2000);
    this.logs.push({ time: new Date().toISOString(), level, message: safe });
    if (this.logs.length > 200) this.logs.shift();
  }
  failure(error) { this.lastError = error.message || '操作失败。'; this.log('error', this.lastError); }

  async commitProfileChange(apply, rollback = async () => {}, shouldRestart = true) {
    const previousState = structuredClone(this.state);
    const wasRunning = this.ready;
    const wasSystemProxy = this.systemProxy;
    const previousMode = this.mode;
    let restartAttempted = false;
    try {
      const result = await apply();
      await this.persist();
      if (wasRunning && shouldRestart) { restartAttempted = true; await this.restart(); }
      return result;
    } catch (error) {
      try {
        await rollback();
        this.state = previousState;
        await this.persist();
        if (wasRunning && restartAttempted) {
          await this.stop();
          await this.start();
          if (this.mode !== previousMode) await this.setMode({ mode: previousMode });
          if (wasSystemProxy) await this.setSystemProxy({ enabled: true });
          this.log('warning', '新配置未能应用，已恢复此前正常运行的配置。');
        }
      } catch (restoreError) {
        this.failure(new Error('新配置未能应用，且此前配置恢复失败。请查看日志后重新启动。'));
        throw new Error(`${error.message} 此前配置恢复失败，请重新导入原配置。`);
      }
      throw new Error(`${error.message}${wasRunning && restartAttempted ? ' 已恢复此前配置。' : ''}`);
    }
  }

  async importText(text, name, extra = {}) {
    const parsed = parseProfile(text);
    const id = crypto.randomUUID();
    normalizeConfig(parsed, this.secret, id);
    const profile = { id, name: String(name || '未命名配置').trim().slice(0, 100) || '未命名配置', updatedAt: new Date().toISOString(), source: extra.url ? 'subscription' : 'file', ...(extra.url ? { url: extra.url } : {}) };
    const file = path.join(this.dataDir, 'profiles', `${id}.yaml`);
    await this.commitProfileChange(async () => {
      await fs.writeFile(file, text, { mode: 0o600 });
      this.state.profiles.push(profile);
      this.state.activeProfileId = id;
    }, () => fs.rm(file, { force: true }));
    this.log('info', `已导入配置：${profile.name}`);
    return this.publicProfile(profile);
  }
  async importProfile(file) {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_PROFILE_BYTES) throw new Error('请选择不超过 10 MiB 的 YAML 文件。');
    return this.importText(await fs.readFile(file, 'utf8'), path.basename(file).replace(/\.ya?ml$/i, ''));
  }
  async importSubscription({ url, name } = {}) {
    const address = requireHttps(url).href;
    return this.importText(await fetchSubscription(address, this.fetcher), name || new URL(address).hostname, { url: address });
  }
  async refreshProfile({ id } = {}) {
    const profile = this.profile(id);
    if (profile.source !== 'subscription' || !profile.url) throw new Error('本地文件配置不能在线刷新，请重新导入。');
    const text = await fetchSubscription(profile.url, this.fetcher);
    normalizeConfig(parseProfile(text), this.secret, id);
    const file = path.join(this.dataDir, 'profiles', `${id}.yaml`);
    const original = await fs.readFile(file, 'utf8');
    await this.commitProfileChange(async () => {
      await fs.writeFile(file, text, { mode: 0o600 });
      profile.updatedAt = new Date().toISOString();
    }, () => fs.writeFile(file, original, { mode: 0o600 }), this.state.activeProfileId === id);
    this.log('info', `已刷新订阅：${profile.name}`);
    return this.publicProfile(profile);
  }
  async activateProfile({ id } = {}) {
    this.profile(id);
    if (this.state.activeProfileId === id) return { activeProfileId: id };
    await this.commitProfileChange(async () => { this.state.activeProfileId = id; });
    return { activeProfileId: id };
  }
  async deleteProfile({ id } = {}) {
    this.profile(id);
    if (this.state.activeProfileId === id) { await this.stop(); this.state.activeProfileId = null; }
    this.state.profiles = this.state.profiles.filter(profile => profile.id !== id);
    await this.persist();
    await fs.rm(path.join(this.dataDir, 'profiles', `${id}.yaml`), { force: true });
    return { deleted: id };
  }
  publicProfile(profile) { return { id: profile.id, name: profile.name, active: profile.id === this.state.activeProfileId, updatedAt: profile.updatedAt, source: profile.source || 'file' }; }
  async saveSettings(settings = {}) {
    if (typeof settings.theme === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(settings.theme)) this.state.settings.theme = settings.theme;
    else if (settings.theme !== undefined) throw new Error('主题 ID 格式无效。');
    if (typeof settings.startMinimized === 'boolean') this.state.settings.startMinimized = settings.startMinimized;
    await this.persist(); return { ...this.state.settings };
  }

  async api(endpoint, options = {}) {
    const response = await this.fetcher(`http://127.0.0.1:${CONTROLLER_PORT}${endpoint}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(options.timeout || 4000), headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json', ...options.headers } });
    if (!response.ok) throw new Error(`Clash 控制接口返回 HTTP ${response.status}。`);
    if (response.status === 204) return {};
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { throw new Error('Clash 控制接口返回无效数据。'); }
  }
  requireRunning() { if (!this.ready || !this.child) throw new Error('请先导入配置并启动内核。'); }
  async start() {
    if (this.disposed) throw new Error('应用正在退出。');
    if (this.ready) return { running: true };
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._start();
    try { return await this.startPromise; } finally { this.startPromise = null; }
  }
  async _start() {
    if (this.stopPromise) await this.stopPromise;
    if (this.disposed) throw new Error('应用正在退出。');
    if (!this.state.activeProfileId) throw new Error('请先导入 Clash YAML 配置或订阅链接，再启动内核。');
    const profile = this.profile(this.state.activeProfileId);
    const executable = path.join(this.coreDir, process.platform === 'win32' ? 'clash.exe' : 'clash');
    if (!(await this.exists(executable))) throw new Error('未找到 Clash 内核，请检查 resources/core 目录。');
    if (!(await this.exists(path.join(this.coreDir, 'Country.mmdb')))) throw new Error('未找到 Country.mmdb，无法安全启动内核。');
    const parsed = parseProfile(await fs.readFile(path.join(this.dataDir, 'profiles', `${profile.id}.yaml`), 'utf8'));
    const config = normalizeConfig(parsed, this.secret, profile.id);
    await Promise.all([this.portCheck(PORT), this.portCheck(CONTROLLER_PORT)]);
    await fs.copyFile(path.join(this.coreDir, 'Country.mmdb'), path.join(this.dataDir, 'core', 'Country.mmdb'));
    const configPath = path.join(this.dataDir, 'core', 'runtime.yaml');
    await fs.writeFile(configPath, YAML.stringify(config), { mode: 0o600 });
    if (this.disposed) throw new Error('应用正在退出。');
    this.lastError = null;
    this.mode = config.mode;
    const child = this.spawnProcess(executable, ['-d', path.join(this.dataDir, 'core'), '-f', configPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: this.coreDir });
    this.child = child;
    let startupError;
    child.once('error', error => { startupError = error; this.failure(new Error('Clash 内核进程启动失败。')); });
    const onOutput = (buffer, level) => {
      for (const line of buffer.toString('utf8').split(/\r?\n/).filter(Boolean)) this.log(level, line.replace(/\u001b\[[0-9;]*m/g, ''));
    };
    child.stdout?.on('data', chunk => onOutput(chunk, 'info'));
    child.stderr?.on('data', chunk => onOutput(chunk, 'warning'));
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null; this.ready = false;
      if (!this.stopPromise && !this.disposed) this.failure(new Error(`Clash 内核已退出（${signal || code}）。`));
      this.restoreProxy().catch(error => this.failure(error));
    });
    if (process.platform === 'win32' && this.watchdogEnabled && child.pid) {
      const watcher = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.scriptsDir, 'proxy-watchdog.ps1'), '-ParentId', String(process.pid), '-CoreId', String(child.pid), '-CorePath', executable, '-StateFile', path.join(this.dataDir, 'proxy-recovery.json')], { windowsHide: true, detached: true, stdio: 'ignore' });
      watcher.on('error', () => this.log('warning', '未能建立退出监控，关闭应用时仍会尝试恢复系统代理。'));
      watcher.unref(); this.watchdog = watcher;
    }
    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        if (startupError || this.child !== child || child.exitCode !== null && child.exitCode !== undefined) throw new Error('Clash 内核启动失败，请查看日志和配置兼容性。');
        try {
          const version = await this.api('/version', { timeout: 700 });
          this.coreVersion = version.version || 'unknown'; this.ready = true;
          this.log('info', `内核已启动，监听 127.0.0.1:${PORT}。`);
          return { running: true };
        } catch { await delay(150); }
      }
      throw new Error('Clash 内核启动超时，请查看日志。');
    } catch (error) { await this.stop(); this.failure(error); throw error; }
  }
  async restart() { const restoreSystemProxy = this.systemProxy; await this.stop(); await this.start(); if (restoreSystemProxy) await this.setSystemProxy({ enabled: true }); }
  async restoreProxy() {
    if (this.restoreProxyPromise) return this.restoreProxyPromise;
    this.restoreProxyPromise = this._restoreProxy();
    try { return await this.restoreProxyPromise; } finally { this.restoreProxyPromise = null; }
  }
  async _restoreProxy() {
    if (!this.systemProxy && !(await this.exists(path.join(this.dataDir, 'proxy-recovery.json')))) return;
    const result = await this.proxyAdapter.restore(); this.systemProxy = false;
    if (result?.restored === false && result.reason === 'changed') this.log('warning', '系统代理已被其他程序更改，已保留新的设置。');
  }
  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this._stop();
    try { return await this.stopPromise; } finally { this.stopPromise = null; }
  }
  async _stop() {
    let proxyError;
    try { await this.restoreProxy(); } catch (error) { proxyError = error; this.failure(new Error('系统代理恢复失败，请在设置中重试关闭系统代理。')); }
    const child = this.child;
    this.ready = false; this.child = null;
    if (child && child.exitCode === null) {
      await new Promise(resolve => {
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 2500);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        try { child.kill(); } catch { clearTimeout(timer); resolve(); }
      });
    }
    if (this.watchdog) { try { this.watchdog.kill(); } catch {} this.watchdog = null; }
    if (child) this.log('info', '内核已停止。');
    if (proxyError) throw proxyError;
    return { running: false };
  }
  async setMode({ mode } = {}) { this.requireRunning(); if (!MODES.has(mode)) throw new Error('不支持的代理模式。'); await this.api('/configs', { method: 'PATCH', body: JSON.stringify({ mode }) }); this.mode = mode; return { mode }; }
  async selectProxy({ group, name } = {}) {
    this.requireRunning();
    const { proxies } = await this.api('/proxies');
    if (typeof group !== 'string' || typeof name !== 'string' || !Object.hasOwn(proxies || {}, group) || proxies[group].type !== 'Selector' || !proxies[group].all?.includes(name)) throw new Error('该代理组不能手动选择此节点。');
    await this.api(`/proxies/${encodeURIComponent(group)}`, { method: 'PUT', body: JSON.stringify({ name }) }); return { group, name };
  }
  async testProxy({ name } = {}) {
    this.requireRunning(); if (typeof name !== 'string' || name.length > 300) throw new Error('节点名称无效。');
    const result = await this.api(`/proxies/${encodeURIComponent(name)}/delay?timeout=5000&url=${encodeURIComponent('https://www.gstatic.com/generate_204')}`, { timeout: 6500 });
    if (!Number.isFinite(result.delay)) throw new Error('该节点测速失败。'); return { name, delay: result.delay };
  }
  async closeConnection({ id } = {}) { this.requireRunning(); if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('连接 ID 无效。'); await this.api(`/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }); return { closed: id }; }
  async setSystemProxy({ enabled } = {}) {
    if (typeof enabled !== 'boolean') throw new Error('系统代理开关参数无效。');
    if (enabled) { this.requireRunning(); if (!this.systemProxy) await this.proxyAdapter.enable(); this.systemProxy = true; this.proxyCheckedAt = Date.now(); this.log('info', '系统代理已开启。'); }
    else { await this.restoreProxy(); this.log('info', '系统代理已关闭并恢复原设置。'); }
    return { enabled: this.systemProxy };
  }
  async snapshot() {
    if (this.snapshotPromise) return this.snapshotPromise;
    this.snapshotPromise = this._snapshot();
    try { return await this.snapshotPromise; } finally { this.snapshotPromise = null; }
  }
  async _snapshot() {
    let proxies = {}, connections = [], rules = [], totals = { upload: 0, download: 0 };
    let controllerError = null;
    if (this.systemProxy && Date.now() - this.proxyCheckedAt > 10_000 && this.proxyAdapter.read) {
      this.proxyCheckedAt = Date.now();
      try { this.systemProxy = (await this.proxyAdapter.read()).enabled === true; } catch { controllerError = '无法确认当前系统代理状态。'; }
    }
    if (this.ready && this.child) {
      const result = await Promise.allSettled([this.api('/proxies'), this.api('/connections'), this.api('/rules'), this.api('/configs')]);
      if (result[0].status === 'fulfilled') proxies = result[0].value.proxies || {};
      if (result[1].status === 'fulfilled') { connections = result[1].value.connections || []; totals = { upload: Number(result[1].value.uploadTotal) || 0, download: Number(result[1].value.downloadTotal) || 0 }; }
      if (result[2].status === 'fulfilled') rules = result[2].value.rules || [];
      if (result[3].status === 'fulfilled' && MODES.has(result[3].value.mode)) this.mode = result[3].value.mode;
      if (result.some(item => item.status === 'rejected')) controllerError = '部分内核状态暂时无法读取。';
    }
    return { appVersion: this.version, core: { running: this.ready && !!this.child, available: await this.exists(path.join(this.coreDir, process.platform === 'win32' ? 'clash.exe' : 'clash')), version: this.coreVersion, port: PORT, controllerPort: CONTROLLER_PORT, error: controllerError || this.lastError }, mode: this.mode, systemProxy: this.systemProxy, profiles: this.state.profiles.map(profile => this.publicProfile(profile)), proxies, connections, totals, rules, logs: this.logs.slice(), settings: { ...this.state.settings }, lastError: this.lastError };
  }
  async dispose() { this.disposed = true; await this.stop(); }
}

module.exports = { CoreService, WindowsProxyAdapter, parseProfile, normalizeConfig, fetchSubscription, requireHttps, PORT, CONTROLLER_PORT, MAX_PROFILE_BYTES };
