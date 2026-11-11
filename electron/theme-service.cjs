'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { BUILTIN_THEMES, validateTheme, MAX_THEME_BYTES } = require('../shared/themes.cjs');

const builtinIds = new Set(BUILTIN_THEMES.map(theme => theme.id));
const MAX_CATALOG_BYTES = 512 * 1024;

function normalizeServerUrl(input) {
  if (input === '') return '';
  if (typeof input !== 'string' || input.length > 2048) throw new Error('请输入有效的主题库地址');
  let url;
  try { url = new URL(input); } catch { throw new Error('请输入完整的 HTTPS 主题库地址'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) {
    throw new Error('主题库仅接受 HTTPS 地址，或本机 HTTP 地址；不能包含凭据、查询或片段');
  }
  return url.toString().replace(/\/+$/, '');
}

async function atomicJson(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temp, filename);
  } finally { await fs.rm(temp, { force: true }); }
}

async function readLimitedJson(filename, max) {
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > max) throw new Error('JSON 文件超出大小限制');
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}

async function responseJson(response, maxBytes = MAX_CATALOG_BYTES) {
  const announced = Number(response.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > maxBytes) throw new Error('主题库响应过大');
  let text;
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new Error('主题库响应过大'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    text = Buffer.concat(chunks).toString('utf8');
  } else {
    text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('主题库响应过大');
  }
  try { return JSON.parse(text); } catch { throw new Error('主题库返回的内容不是有效 JSON'); }
}

class ThemeService {
  constructor({ userData, dialog, getWindow = () => undefined, fetchImpl = globalThis.fetch }) {
    if (!userData) throw new Error('ThemeService 需要 userData 目录');
    this.directory = path.join(userData, 'themes');
    this.configPath = path.join(userData, 'theme-settings.json');
    this.dialog = dialog;
    this.getWindow = getWindow;
    this.fetch = fetchImpl;
    this.local = [];
    this.remote = [];
    this.serverUrl = '';
    this.selectedId = 'obsidian';
    this.remoteError = null;
    this.ready = this.initialize();
  }

  async initialize() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const config = await readLimitedJson(this.configPath, 4096);
      this.serverUrl = normalizeServerUrl(config.serverUrl || '');
      if (typeof config.selectedId === 'string' && /^[a-z][a-z0-9-]{2,47}$/.test(config.selectedId)) this.selectedId = config.selectedId;
    } catch (error) { if (error.code !== 'ENOENT') this.remoteError = '主题设置文件已损坏，请重新设置主题库地址'; }
    for (const file of (await fs.readdir(this.directory)).sort()) {
      if (!/^[a-z][a-z0-9-]{2,47}\.json$/.test(file)) continue;
      try {
        const theme = validateTheme(await readLimitedJson(path.join(this.directory, file), MAX_THEME_BYTES));
        if (!builtinIds.has(theme.id) && file === `${theme.id}.json`) this.local.push(theme);
      } catch { /* A malformed local file must never prevent the desktop app from opening. */ }
    }
  }

  async persistConfig() { await atomicJson(this.configPath, { serverUrl: this.serverUrl, selectedId: this.selectedId }); }

  async list() {
    await this.ready;
    return structuredClone({ builtins: BUILTIN_THEMES, local: this.local, remote: this.remote, serverUrl: this.serverUrl, remoteError: this.remoteError, selectedId: this.selectedId });
  }

  async save({ theme } = {}) {
    await this.ready;
    const safe = validateTheme(theme);
    if (builtinIds.has(safe.id)) throw new Error('请使用新的主题 ID，内置主题不可覆盖');
    await atomicJson(path.join(this.directory, `${safe.id}.json`), safe);
    this.local = [...this.local.filter(item => item.id !== safe.id), safe];
    return structuredClone(safe);
  }

  async import() {
    await this.ready;
    if (!this.dialog) throw new Error('本地文件对话框不可用');
    const options = { title: '导入 D.E.X 主题', filters: [{ name: 'D.E.X 主题 JSON', extensions: ['json'] }], properties: ['openFile'] };
    const window = this.getWindow();
    const result = await (window ? this.dialog.showOpenDialog(window, options) : this.dialog.showOpenDialog(options));
    if (result.canceled || !result.filePaths?.length) return null;
    return this.save({ theme: await readLimitedJson(result.filePaths[0], MAX_THEME_BYTES) });
  }

  async find(id) {
    await this.ready;
    const theme = this.local.find(item => item.id === id) || BUILTIN_THEMES.find(item => item.id === id) || this.remote.find(item => item.id === id);
    if (!theme) throw new Error('没有找到这个主题');
    return theme;
  }

  async export({ id } = {}) {
    const theme = await this.find(id);
    if (!this.dialog) throw new Error('本地文件对话框不可用');
    const options = { title: '导出 D.E.X 主题', defaultPath: `${theme.id}.json`, filters: [{ name: 'D.E.X 主题 JSON', extensions: ['json'] }] };
    const window = this.getWindow();
    const result = await (window ? this.dialog.showSaveDialog(window, options) : this.dialog.showSaveDialog(options));
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, JSON.stringify(theme, null, 2) + '\n', 'utf8');
    return { saved: true, filename: path.basename(result.filePath) };
  }

  async apply({ id } = {}) {
    const theme = await this.find(id);
    // Cache selected community themes locally so the appearance survives offline restarts.
    if (!builtinIds.has(theme.id) && !this.local.some(item => item.id === theme.id)) await this.save({ theme });
    this.selectedId = theme.id;
    await this.persistConfig();
    return structuredClone(theme);
  }

  async configure({ url } = {}) {
    await this.ready;
    this.serverUrl = normalizeServerUrl(url);
    this.remote = [];
    this.remoteError = null;
    await this.persistConfig();
    return this.list();
  }

  async request(endpoint, options = {}, serverUrl = this.serverUrl) {
    if (!serverUrl) throw new Error('请先设置主题库服务器地址');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.fetch(`${serverUrl}${endpoint}`, { ...options, redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', ...options.headers } });
      const data = await responseJson(response);
      if (!response.ok) {
        const errors = { 400: '主题数据未通过服务器校验', 401: '发布令牌无效', 403: '此主题已存在，更新需要管理员令牌', 409: '此主题 ID 已存在，更新需要管理员令牌', 413: '主题文件过大', 429: '发布过于频繁，请稍后重试', 503: '服务器暂未启用主题发布' };
        throw new Error(errors[response.status] || `主题库请求失败（${response.status}）`);
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('连接主题库超时，请检查服务器地址');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async refresh() {
    await this.ready;
    if (!this.serverUrl) return this.list();
    const serverUrl = this.serverUrl;
    try {
      const remote = [];
      const ids = new Set();
      for (let offset = 0; offset < 1000; offset += 50) {
        const data = await this.request(`/themes?limit=50&offset=${offset}`, {}, serverUrl);
        if (!data || !Array.isArray(data.themes) || data.themes.length > 50) throw new Error('主题库目录格式不正确');
        for (const item of data.themes) {
          const theme = validateTheme(item);
          if (!builtinIds.has(theme.id) && !ids.has(theme.id)) { ids.add(theme.id); remote.push(theme); }
        }
        if (data.themes.length < 50 || data.nextOffset == null) break;
      }
      if (this.serverUrl === serverUrl) {
        this.remote = remote;
        this.remoteError = null;
      }
    } catch (error) {
      if (this.serverUrl === serverUrl) this.remoteError = error.message || '无法连接主题库';
    }
    return this.list();
  }

  async publish({ id, token } = {}) {
    await this.ready;
    const serverUrl = this.serverUrl;
    const theme = await this.find(id);
    if (builtinIds.has(theme.id)) throw new Error('请先将内置主题保存为新的设计，再发布到主题库');
    if (typeof token !== 'string' || token.length < 32 || token.length > 512 || /[\s\x00-\x1f\x7f]/.test(token)) throw new Error('请输入有效的发布令牌（至少 32 个字符）');
    const result = await this.request('/themes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(theme) }, serverUrl);
    const published = validateTheme(result.theme);
    if (published.id !== theme.id) throw new Error('服务器返回了不匹配的主题');
    if (this.serverUrl === serverUrl) {
      this.remote = [...this.remote.filter(item => item.id !== published.id), published];
      this.remoteError = null;
    }
    return structuredClone(published);
  }

  async handle(action, payload) {
    const method = action.replace(/^themes\./, '');
    if (!['list', 'import', 'export', 'apply', 'publish', 'configure', 'refresh', 'save'].includes(method)) throw new Error('不支持的主题操作');
    return this[method](payload);
  }
}

module.exports = { ThemeService, normalizeServerUrl };
