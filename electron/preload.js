const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb) {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('nova', {
  // dialogs
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  saveFileDialog: (defaultName) => ipcRenderer.invoke('dialog:saveFile', defaultName),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),

  // filesystem
  listDir: (dir) => ipcRenderer.invoke('fs:list', dir),
  readFile: (file) => ipcRenderer.invoke('fs:read', file),
  writeFile: (file, content) => ipcRenderer.invoke('fs:write', file, content),
  search: (payload) => ipcRenderer.invoke('search:run', payload),
  workspaceFiles: (root) => ipcRenderer.invoke('workspace:files', root),
  onFsChanged: (cb) => subscribe('fs:changed', cb),

  // skills / mcp / checkpoints
  listSkills: () => ipcRenderer.invoke('skills:list'),
  newSkill: (name) => ipcRenderer.invoke('skills:new', name),
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  mcpReload: () => ipcRenderer.invoke('mcp:reload'),
  addonsStatus: () => ipcRenderer.invoke('addons:status'),
  addonsToggle: (id, enable, url) => ipcRenderer.invoke('addons:toggle', { id, enable, url }),
  restoreCheckpoint: (agentId) => ipcRenderer.invoke('checkpoint:restore', { agentId }),
  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (obj) => ipcRenderer.invoke('settings:set', obj),
  listModels: (payload) => ipcRenderer.invoke('models:list', payload),
  testModel: (payload) => ipcRenderer.invoke('models:ping', payload),

  // Gemini Web (jugaad provider — drives the signed-in web app tab)
  reportGeminiWebview: (id) => ipcRenderer.send('gemini:wc-id', id),
  geminiNewChat: () => ipcRenderer.invoke('gemini:newChat'),
  geminiStatus: () => ipcRenderer.invoke('gemini:status'),
  openGeminiLoginWindow: (url) => ipcRenderer.invoke('gemini:openLoginWindow', url),
  onGeminiSignedIn: (cb) => {
    const l = (_e, d) => cb(d);
    ipcRenderer.on('gemini:signedIn', l);
    return () => ipcRenderer.removeListener('gemini:signedIn', l);
  },
  // Clean Chrome UA (no Electron token) so Google sign-in works in the webview.
  chromeUA: (() => {
    try {
      const ua = navigator.userAgent || '';
      const m = ua.match(/Chrome\/([\d.]+)/);
      if (!m) return null;
      const plat = /Windows/.test(ua)
        ? 'Windows NT 10.0; Win64; x64'
        : /Macintosh/.test(ua)
          ? 'Macintosh; Intel Mac OS X 10_15_7'
          : 'X11; Linux x86_64';
      return `Mozilla/5.0 (${plat}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${m[1]} Safari/537.36`;
    } catch {
      return null;
    }
  })(),

  // AI (ask mode)
  chat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  abort: (chatId) => ipcRenderer.invoke('ai:abort', chatId),
  onChunk: (cb) => subscribe('ai:chunk', cb),
  onDone: (cb) => subscribe('ai:done', cb),
  onError: (cb) => subscribe('ai:error', cb),

  // agent
  agentStart: (payload) => ipcRenderer.invoke('agent:start', payload),
  agentStop: (agentId) => ipcRenderer.invoke('agent:stop', { agentId }),
  agentApprove: (agentId, callId, allow) => ipcRenderer.invoke('agent:approve', { agentId, callId, allow }),
  agentNew: (agentId) => ipcRenderer.invoke('agent:new', { agentId }),
  onAgentEvent: (cb) => subscribe('agent:event', cb),
  onAutomationWebhook: (cb) => subscribe('automation:webhook', cb),

  // terminal
  termRun: (payload) => ipcRenderer.invoke('term:run', payload),
  onTermStart: (cb) => subscribe('term:start', cb),
  onTermData: (cb) => subscribe('term:data', cb),
  onTermExit: (cb) => subscribe('term:exit', cb),

  // browser / computer
  browserStatus: () => ipcRenderer.invoke('browser:status'),
  browserReset: () => ipcRenderer.invoke('browser:reset'),
  browserTest: () => ipcRenderer.invoke('browser:test'),
  computerStatus: () => ipcRenderer.invoke('computer:status'),
  computerScreenshot: () => ipcRenderer.invoke('computer:screenshot'),

  // git (source control)
  gitStatus: (cwd) => ipcRenderer.invoke('git:status', { cwd }),
  gitDiff: (payload) => ipcRenderer.invoke('git:diff', payload),
  gitStage: (payload) => ipcRenderer.invoke('git:stage', payload),
  gitUnstage: (payload) => ipcRenderer.invoke('git:unstage', payload),
  gitCommit: (payload) => ipcRenderer.invoke('git:commit', payload),
  gitBranches: (cwd) => ipcRenderer.invoke('git:branches', { cwd }),
  gitCheckout: (payload) => ipcRenderer.invoke('git:checkout', payload),
  gitPush: (cwd) => ipcRenderer.invoke('git:push', { cwd }),
  gitPull: (cwd) => ipcRenderer.invoke('git:pull', { cwd }),
  gitLog: (payload) => ipcRenderer.invoke('git:log', payload),
  gitWorktreeAdd: (payload) => ipcRenderer.invoke('git:worktreeAdd', payload),
  gitWorktreeList: (cwd) => ipcRenderer.invoke('git:worktreeList', { cwd }),

  // memory (long-term notes)
  memoryList: () => ipcRenderer.invoke('memory:list'),
  memoryAdd: (payload) => ipcRenderer.invoke('memory:add', payload),
  memoryUpdate: (payload) => ipcRenderer.invoke('memory:update', payload),
  memoryRemove: (id) => ipcRenderer.invoke('memory:remove', { id }),
  memorySet: (notes) => ipcRenderer.invoke('memory:set', { notes }),
  memorySetAccount: (account) => ipcRenderer.invoke('memory:setAccount', { account }),
  memoryClear: () => ipcRenderer.invoke('memory:clear'),

  // cloud (google drive, read-only)
  gdriveStatus: () => ipcRenderer.invoke('gdrive:status'),
  gdriveSave: (patch) => ipcRenderer.invoke('gdrive:save', patch),
  gdriveLogin: () => ipcRenderer.invoke('gdrive:login'),
  gdriveLogout: () => ipcRenderer.invoke('gdrive:logout'),
  gdriveLastUrl: () => ipcRenderer.invoke('gdrive:last-url'),
  gdriveList: (query) => ipcRenderer.invoke('gdrive:list', { query }),
  gdriveRead: (id) => ipcRenderer.invoke('gdrive:read', { id }),
  gdriveDownload: (payload) => ipcRenderer.invoke('gdrive:download', payload),
  gdriveMemoryPull: () => ipcRenderer.invoke('gdrive:memoryPull'),
  gdriveMemoryPush: (notes) => ipcRenderer.invoke('gdrive:memoryPush', { notes }),

  // misc
  appInfo: () => ipcRenderer.invoke('app:info'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
});
