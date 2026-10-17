import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import RepoMenu from './RepoMenu';
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

function RepoPicker() {
  const github = useStore((s) => s.github);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [token, setToken] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    useStore.getState().loadGithub();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open && github.connected && github.repos.length === 0 && !github.loading) {
      useStore.getState().loadGithubRepos('');
    }
  }, [open, github.connected]);

  async function connect() {
    const ok = await useStore.getState().saveGithubToken(token);
    if (ok) setToken('');
  }

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        className="btn-icon tiny"
        title="Connect GitHub or open a repository"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="folder-plus">+</span>
      </button>
      {open && (
        <div className="dropdown repo-picker">
          <RepoMenu onClose={() => setOpen(false)} />
        </div>
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

  const [chatMenu, setChatMenu] = useState(null); // { id, x, y, pinned }
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');

  useEffect(() => {
    if (!chatMenu) return;
    const onDown = (e) => {
      if (e.target && e.target.closest && (e.target.closest('.chat-menu') || e.target.closest('.sb-chat-x'))) return;
      setChatMenu(null);
    };
    const onScroll = () => setChatMenu(null);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [chatMenu]);

  function commitRename(id) {
    const t = editTitle.trim();
    if (t) useStore.getState().renameChat(id, t);
    setEditingId(null);
  }

  const userName = appInfo?.username || 'you';

  // Group chats by the folder they were created in, newest group first.
  const groups = [];
  const byKey = new Map();
  const sorted = [...chats].sort((a, b) => {
    const pa = a.pinned ? 1 : 0;
    const pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa; // pinned first
    if (pa && pb) return (b.pinnedAt || 0) - (a.pinnedAt || 0);
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
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
          className={'sb-item' + (mainView === 'cloud' ? ' active' : '')}
          onClick={() => useStore.getState().openCloud()}
        >
          <span className="sb-ico">{'\u2601\uFE0F'}</span> Cloud
        </button>
        <button
          className={'sb-item' + (mainView === 'memory' ? ' active' : '')}
          onClick={() => useStore.getState().openMemory()}
        >
          <span className="sb-ico">{'\u{1F9E0}'}</span> Memory
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
        <RepoPicker />
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
                {editingId === c.id ? (
                  <input
                    className="sb-chat-edit"
                    value={editTitle}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(c.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={() => commitRename(c.id)}
                  />
                ) : (
                  <span className="sb-chat-title">
                    {c.pinned ? <span className="sb-pin">{'\u{1F4CC}'}</span> : null}
                    {c.title || 'New chat'}
                  </span>
                )}
                <span className="sb-time">{timeAgo(c.updatedAt)}</span>
                <button
                  className="sb-chat-x"
                  title="More"
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setChatMenu((m) => (m && m.id === c.id ? null : { id: c.id, x: r.right, y: r.bottom, pinned: !!c.pinned }));
                  }}
                >
                  {'\u22EF'}
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>


      {chatMenu && (
        <div
          className="chat-menu dropdown"
          style={{ position: 'fixed', left: Math.max(8, chatMenu.x - 168), top: chatMenu.y + 4 }}
        >
          <button
            className="dropdown-item"
            onClick={() => {
              useStore.getState().pinChat(chatMenu.id, !chatMenu.pinned);
              setChatMenu(null);
            }}
          >
            {chatMenu.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button
            className="dropdown-item"
            onClick={() => {
              const c = chats.find((x) => x.id === chatMenu.id);
              setEditingId(chatMenu.id);
              setEditTitle((c && c.title) || '');
              setChatMenu(null);
            }}
          >
            Rename
          </button>
          <button
            className="dropdown-item danger"
            onClick={() => {
              removeChat(chatMenu.id);
              setChatMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}

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
