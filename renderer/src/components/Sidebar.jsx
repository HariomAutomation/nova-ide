import { useStore } from '../store';
import { iconForLanguage, langFromPath } from '../languages';
import { timeAgo, basename } from '../timeAgo';

/* ------------------------------- file tree (editor mode) ------------------------------- */

function TreeNode({ entry, depth }) {
  const expanded = useStore((s) => !!s.expanded[entry.path]);
  const children = useStore((s) => s.childrenByDir[entry.path]);
  const activePath = useStore((s) => s.activePath);
  const toggleDir = useStore((s) => s.toggleDir);
  const openFile = useStore((s) => s.openFile);

  if (entry.isDir) {
    return (
      <div>
        <div
          className="tree-row"
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => toggleDir(entry.path)}
          title={entry.path}
        >
          <span className="chev">{expanded ? '\u25BE' : '\u25B8'}</span>
          <span className="tree-icon">{expanded ? '\u{1F4C2}' : '\u{1F4C1}'}</span>
          <span className="tree-name">{entry.name}</span>
        </div>
        {expanded &&
          (children || []).map((c) => <TreeNode key={c.path} entry={c} depth={depth + 1} />)}
      </div>
    );
  }

  const isActive = activePath === entry.path;
  return (
    <div
      className={'tree-row' + (isActive ? ' active' : '')}
      style={{ paddingLeft: 6 + depth * 12 + 16 }}
      onClick={() => openFile(entry.path)}
      title={entry.path}
    >
      <span className="tree-icon">{iconForLanguage(langFromPath(entry.name))}</span>
      <span className={'tree-name' + (isActive ? ' active' : '')}>{entry.name}</span>
    </div>
  );
}

function FilesView() {
  const rootFolder = useStore((s) => s.rootFolder);
  const rootEntries = useStore((s) => s.childrenByDir[s.rootFolder]) || [];
  const openFolder = useStore((s) => s.openFolder);
  const newFile = useStore((s) => s.newFile);

  return (
    <>
      <div className="sb-head">
        <button
          className="btn-icon"
          title="Back to chat"
          onClick={() => useStore.getState().setMainView('agent')}
        >
          {'\u2190'}
        </button>
        <span className="sb-view-title">Files</span>
        <div className="spacer" />
        <button className="btn-icon" title="New file (Ctrl+N)" onClick={() => newFile()}>
          {'\uFF0B'}
        </button>
        <button className="btn-icon" title="Open folder (Ctrl+O)" onClick={() => openFolder()}>
          {'\u{1F4C2}'}
        </button>
      </div>
      {!rootFolder ? (
        <div className="sidebar-empty">
          <p>No folder opened.</p>
          <button className="btn primary" onClick={() => openFolder()}>
            Open Folder
          </button>
        </div>
      ) : (
        <>
          <div className="folder-name" title={rootFolder}>
            {rootFolder}
          </div>
          <div className="tree">
            {rootEntries.map((e) => (
              <TreeNode key={e.path} entry={e} depth={0} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

/* --------------------------------- getting started --------------------------------- */

function GettingStarted() {
  const models = useStore((s) => s.models);
  const rootFolder = useStore((s) => s.rootFolder);
  const usedAgent = useStore((s) => s.usedAgent);

  const steps = [
    {
      key: 'model',
      label: 'Add a model',
      done: models.length > 0,
      action: () => useStore.getState().setSettingsOpen(true, 'models'),
      cta: 'Add a model\u2026',
      icon: '\u26A1',
    },
    {
      key: 'folder',
      label: 'Open a project folder',
      done: !!rootFolder,
      action: () => useStore.getState().openFolder(),
      cta: 'Open a folder\u2026',
      icon: '\u{1F4C1}',
    },
    {
      key: 'agent',
      label: 'Give the agent a task',
      done: usedAgent,
      action: () => useStore.getState().focusComposer(),
      cta: 'Ask the agent',
      icon: '\u2728',
    },
  ];
  const doneCount = steps.filter((st) => st.done).length;
  const next = steps.find((st) => !st.done);

  const r = 7;
  const c = 2 * Math.PI * r;
  const frac = doneCount / steps.length;

  return (
    <div className="getting-started">
      <div className="gs-head">
        <svg className="gs-ring" width="18" height="18" viewBox="0 0 18 18">
          <circle cx="9" cy="9" r={r} fill="none" stroke="var(--gs-track)" strokeWidth="2.5" />
          <circle
            cx="9"
            cy="9"
            r={r}
            fill="none"
            stroke="var(--accent, #3d7eff)"
            strokeWidth="2.5"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - frac)}
            strokeLinecap="round"
            transform="rotate(-90 9 9)"
          />
        </svg>
        <span className="gs-title">Getting Started</span>
        <div className="spacer" />
        <span className="gs-count">
          {doneCount}/{steps.length}
          {doneCount === steps.length ? ' \u2713' : ''}
        </span>
      </div>
      {next ? (
        <button className="gs-cta" onClick={next.action} title={next.label}>
          <span className="gs-cta-ico">{next.icon}</span>
          {next.cta}
        </button>
      ) : (
        <button className="gs-cta" onClick={() => useStore.getState().openAutomations()}>
          <span className="gs-cta-ico">{'\u26A1'}</span>
          Try an automation
        </button>
      )}
    </div>
  );
}

/* ----------------------------------- chat home ----------------------------------- */

function ChatHome() {
  const chats = useStore((s) => s.chats);
  const currentChatId = useStore((s) => s.currentChatId);
  const rootFolder = useStore((s) => s.rootFolder);
  const appInfo = useStore((s) => s.appInfo);
  const removeChat = useStore((s) => s.removeChat);
  const loadChat = useStore((s) => s.loadChat);
  const mainView = useStore((s) => s.mainView);
  const navHistory = useStore((s) => s.navHistory);
  const navFwd = useStore((s) => s.navFwd);
  const gitBranch = useStore((s) => s.gitBranch);

  const userName = appInfo?.username || 'you';

  // Group chats by the folder they were created in, newest group first.
  const groups = [];
  const byKey = new Map();
  const sorted = [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const c of sorted) {
    const key = c.folder || '__none__';
    if (!byKey.has(key)) {
      const g = { key, folder: c.folder || null, chats: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    byKey.get(key).chats.push(c);
  }

  const atHome = mainView === 'agent' && !currentChatId;

  return (
    <>
      <div className="sb-head">
        <button
          className="btn-icon"
          title="Back"
          disabled={!navHistory.length}
          onClick={() => useStore.getState().navBack()}
        >
          {'\u2190'}
        </button>
        <button
          className="btn-icon"
          title="Forward"
          disabled={!navFwd.length}
          onClick={() => useStore.getState().navForward()}
        >
          {'\u2192'}
        </button>
        <div className="spacer" />
        <button
          className="btn-icon"
          title="New chat"
          onClick={() => useStore.getState().newAgentChat()}
        >
          {'\uFF0B'}
        </button>
      </div>

      <div className="sb-nav">
        <button
          className={'sb-item' + (atHome ? ' active' : '')}
          onClick={() => useStore.getState().newAgentChat()}
        >
          <span className="sb-ico">{'\u270E'}</span> New Chat
        </button>
        <button
          className={'sb-item' + (mainView === 'search' ? ' active' : '')}
          onClick={() => useStore.getState().openSearchPage()}
        >
          <span className="sb-ico">{'\u{1F50D}'}</span> Search
        </button>
        <button
          className={'sb-item' + (mainView === 'automations' ? ' active' : '')}
          onClick={() => useStore.getState().openAutomations()}
        >
          <span className="sb-ico">{'\u26A1'}</span> Automations
        </button>
        <button
          className={'sb-item' + (mainView === 'git' ? ' active' : '')}
          onClick={() => useStore.getState().openSourceControl()}
        >
          <span className="sb-ico">{'\u2387'}</span> Source Control
        </button>
        <button
          className={'sb-item' + (mainView === 'customize' ? ' active' : '')}
          onClick={() => useStore.getState().openCustomize()}
        >
          <span className="sb-ico">{'\u2699'}</span> Customize
        </button>
        <button
          className={'sb-item' + (mainView === 'gemini' ? ' active' : '')}
          onClick={() => useStore.getState().setMainView('gemini')}
        >
          <span className="sb-ico">{'\u{1F310}'}</span> Gemini
        </button>
      </div>

      <div className="sb-section-row">
        <span className="sb-section-label">Repositories</span>
        <div className="spacer" />
        <button
          className="btn-icon tiny"
          title={gitBranch ? `Branch: ${gitBranch}` : 'Sort: recent activity'}
          onClick={() =>
            useStore
              .getState()
              .setStatus(gitBranch ? `Current branch: ${gitBranch}` : 'Chats are sorted by recent activity')
          }
        >
          {'\u21C5'}
        </button>
        <button
          className="btn-icon tiny"
          title="Open a folder (Ctrl+O)"
          onClick={() => useStore.getState().openFolder()}
        >
          <span className="folder-plus">+</span>
        </button>
      </div>

      <div className="sb-repos">
        {groups.length === 0 && (
          <div className="sb-empty">No chats yet — ask the agent something.</div>
        )}
        {groups.map((g) => (
          <div key={g.key} className="sb-repo-group">
            <div
              className={
                'sb-repo' + (g.folder && g.folder === rootFolder ? ' active' : '') + (g.folder ? '' : ' none')
              }
              title={g.folder || 'Chats without a repo'}
              onClick={() => {
                if (g.folder) useStore.getState().openFolder(g.folder);
              }}
            >
              <span className="sb-ico">{g.folder ? '\u{1F4C1}' : '\u{1F3E0}'}</span>
              <span className="sb-chat-title">{g.folder ? basename(g.folder) : 'No Repo'}</span>
            </div>
            {g.chats.map((c) => (
              <div
                key={c.id}
                className={'sb-chat-row' + (c.id === currentChatId ? ' active' : '')}
                onClick={() => loadChat(c.id)}
                title={c.title}
              >
                <span className="sb-dot" />
                <span className="sb-chat-title">{c.title || 'New chat'}</span>
                <span className="sb-time">{timeAgo(c.updatedAt)}</span>
                <button
                  className="sb-chat-x"
                  title="Remove from list"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeChat(c.id);
                  }}
                >
                  {'\u00D7'}
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <GettingStarted />

      <div className="sb-account">
        <span className="avatar">{(userName[0] || 'N').toUpperCase()}</span>
        <span className="sb-chat-title">{userName}</span>
        <span className="plan">Nova Free</span>
        <button
          className="btn-icon"
          title="Settings (Ctrl+,)"
          onClick={() => useStore.getState().setSettingsOpen(true)}
        >
          {'\u2699'}
        </button>
      </div>
    </>
  );
}

export default function Sidebar() {
  const mainView = useStore((s) => s.mainView);
  const inEditor = mainView === 'editor';

  return <div className="sidebar">{inEditor ? <FilesView /> : <ChatHome />}</div>;
}
