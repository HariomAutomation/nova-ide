import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import RepoMenu from './RepoMenu';
import { iconForLanguage, langFromPath } from '../languages';
import { timeAgo, basename } from '../timeAgo';

/* ------------------------------- file tree (editor mode) ------------------------------- */

function NewFileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

function NewFolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function TreeNode({ entry, depth }) {
  const expanded = useStore((s) => !!s.expanded[entry.path]);
  const children = useStore((s) => s.childrenByDir[entry.path]);
  const activePath = useStore((s) => s.activePath);
  const toggleDir = useStore((s) => s.toggleDir);
  const openFile = useStore((s) => s.openFile);
  const deleteFileOrDir = useStore((s) => s.deleteFileOrDir);
  const renameFileOrDir = useStore((s) => s.renameFileOrDir);
  const createFileInDir = useStore((s) => s.createFileInDir);
  const createFolderInDir = useStore((s) => s.createFolderInDir);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(entry.name);
  const [creating, setCreating] = useState(null); // 'file' | 'folder' | null
  const [createName, setCreateName] = useState('');

  const commitRename = async () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== entry.name) {
      const parentDir = entry.path.slice(0, entry.path.lastIndexOf('/'));
      const newPath = parentDir + '/' + trimmed;
      await renameFileOrDir(entry.path, newPath);
    }
    setEditing(false);
  };

  const commitCreate = async () => {
    const trimmed = createName.trim();
    if (trimmed) {
      if (creating === 'file') {
        await createFileInDir(entry.path, trimmed);
      } else if (creating === 'folder') {
        await createFolderInDir(entry.path, trimmed);
      }
    }
    setCreating(null);
    setCreateName('');
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    const kind = entry.isDir ? 'folder' : 'file';
    if (window.confirm(`Delete ${kind} "${entry.name}"?`)) {
      deleteFileOrDir(entry.path);
    }
  };

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
          {editing ? (
            <input
              className="tree-edit-input"
              value={editName}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={commitRename}
            />
          ) : (
            <span className="tree-name">{entry.name}</span>
          )}
          {!editing && (
            <div className="tree-actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="tree-action-btn"
                title="New file in folder"
                aria-label="New file"
                onClick={() => {
                  if (!expanded) toggleDir(entry.path);
                  setCreating('file');
                  setCreateName('');
                }}
              >
                <NewFileIcon />
              </button>
              <button
                className="tree-action-btn"
                title="New subfolder"
                aria-label="New folder"
                onClick={() => {
                  if (!expanded) toggleDir(entry.path);
                  setCreating('folder');
                  setCreateName('');
                }}
              >
                <NewFolderIcon />
              </button>
              <button
                className="tree-action-btn"
                title="Rename folder"
                aria-label="Rename folder"
                onClick={() => {
                  setEditing(true);
                  setEditName(entry.name);
                }}
              >
                <EditIcon />
              </button>
              <button
                className="tree-action-btn danger"
                title="Delete folder"
                aria-label="Delete folder"
                onClick={handleDelete}
              >
                <TrashIcon />
              </button>
            </div>
          )}
        </div>
        {creating && (
          <div
            className="tree-row tree-create-row"
            style={{ paddingLeft: 6 + (depth + 1) * 12 }}
          >
            <span className="tree-icon">{creating === 'file' ? '\u{1F4C4}' : '\u{1F4C1}'}</span>
            <input
              className="tree-edit-input"
              value={createName}
              autoFocus
              placeholder={creating === 'file' ? 'filename.ext' : 'foldername'}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCreate();
                if (e.key === 'Escape') setCreating(null);
              }}
              onBlur={commitCreate}
            />
          </div>
        )}
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
      {editing ? (
        <input
          className="tree-edit-input"
          value={editName}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={commitRename}
        />
      ) : (
        <span className={'tree-name' + (isActive ? ' active' : '')}>{entry.name}</span>
      )}
      {!editing && (
        <div className="tree-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="tree-action-btn"
            title="Rename file"
            aria-label="Rename file"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
              setEditName(entry.name);
            }}
          >
            <EditIcon />
          </button>
          <button
            className="tree-action-btn danger"
            title="Delete file"
            aria-label="Delete file"
            onClick={handleDelete}
          >
            <TrashIcon />
          </button>
        </div>
      )}
    </div>
  );
}

function FilesView() {
  const rootFolder = useStore((s) => s.rootFolder);
  const rootEntries = useStore((s) => s.childrenByDir[s.rootFolder]) || [];
  const openFolder = useStore((s) => s.openFolder);
  const newFile = useStore((s) => s.newFile);
  const refreshFiles = useStore((s) => s.refreshFiles);

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
        <button
          className="btn-icon"
          title="Refresh files"
          data-testid="files-refresh-btn"
          onClick={() => refreshFiles()}
        >
          {'\u21BB'}
        </button>
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

function PinIcon({ pinned }) {
  if (pinned) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5">
        <path d="M16 12V4h1V2H7v2h1v8l-2 3v2h5.2v5l.8 1 .8-1v-5H18v-2l-2-3z" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 12V4h1V2H7v2h1v8l-2 3v2h5.2v5l.8 1 .8-1v-5H18v-2l-2-3z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
      <circle cx="5" cy="12" r="2" />
    </svg>
  );
}

/* ----------------------------------- chat home ----------------------------------- */

function ChatHome() {
  const chats = useStore((s) => s.chats);
  const currentChatId = useStore((s) => s.currentChatId);
  const rootFolder = useStore((s) => s.rootFolder);
  const recentFolders = useStore((s) => s.recentFolders) || [];
  const removeRecentFolder = useStore((s) => s.removeRecentFolder);
  const appInfo = useStore((s) => s.appInfo);
  const removeChat = useStore((s) => s.removeChat);
  const pinChat = useStore((s) => s.pinChat);
  const loadChat = useStore((s) => s.loadChat);
  const mainView = useStore((s) => s.mainView);
  const navHistory = useStore((s) => s.navHistory);
  const navFwd = useStore((s) => s.navFwd);
  const gitBranch = useStore((s) => s.gitBranch);
  const drive = useStore((s) => s.drive);

  const [chatMenu, setChatMenu] = useState(null); // { id, x, y, pinned }
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');

  useEffect(() => {
    if (!chatMenu) return;
    const onDown = (e) => {
      if (
        e.target &&
        e.target.closest &&
        (e.target.closest('.chat-menu') ||
          e.target.closest('.sb-chat-x') ||
          e.target.closest('.sb-chat-actions'))
      )
        return;
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

  // Filter chats strictly for the active workspace (or general chats if none opened)
  const activeChats = rootFolder
    ? chats.filter((c) => c.folder === rootFolder)
    : chats;

  const sortedChats = [...activeChats].sort((a, b) => {
    const pa = a.pinned ? 1 : 0;
    const pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa; // pinned first
    if (pa && pb) return (b.pinnedAt || 0) - (a.pinnedAt || 0);
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

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
          data-testid="sb-nav-chat"
        >
          <span className="sb-ico">{'\u{1F4AC}'}</span> Chat
        </button>
        <button
          className={'sb-item' + (mainView === 'editor' ? ' active' : '')}
          onClick={() => useStore.getState().setMainView('editor')}
          data-testid="sb-nav-files"
        >
          <span className="sb-ico">{'\u{1F4C1}'}</span> Files
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
          className={'sb-item' + (mainView === 'security' ? ' active' : '')}
          onClick={() => useStore.getState().openSecurity()}
          data-testid="sb-nav-security"
        >
          <span className="sb-ico">{'\u{1F6E1}\uFE0F'}</span> Security
        </button>
        <button
          className={'sb-item' + (mainView === 'challenge' ? ' active' : '')}
          onClick={() => useStore.getState().openChallenge()}
          data-testid="sb-nav-challenge"
        >
          <span className="sb-ico">{'\u{1F3C6}'}</span> Challenges
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
      </div>

      <div className="sb-section-row">
        <span className="sb-section-label">Workspace</span>
        <div className="spacer" />
        <RepoPicker />
      </div>

      <div className="sb-repos">
        {!rootFolder ? (
          <div className="sb-repo-group" data-testid="sb-repo-group">
            <div className="sb-empty" style={{ padding: '8px 10px 12px' }}>
              <div>No workspace opened.</div>
              <button
                className="btn small primary"
                style={{ marginTop: '8px', width: '100%', justifyContent: 'center' }}
                onClick={() => useStore.getState().openFolder()}
              >
                📂 Open Folder…
              </button>
            </div>
            {sortedChats.map((c) => (
              <div
                key={c.id}
                className={'sb-chat-row' + (c.id === currentChatId ? ' active' : '')}
                onClick={() => loadChat(c.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setChatMenu({ id: c.id, x: e.clientX, y: e.clientY, pinned: !!c.pinned });
                }}
                title={c.title || 'Untitled'}
                data-testid="sb-chat-row"
                data-chat-id={c.id}
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
                    {c.title || 'Untitled'}
                  </span>
                )}
                <span className="sb-time">{timeAgo(c.updatedAt)}</span>
                {editingId !== c.id && (
                  <div className="sb-chat-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className={'sb-action-btn' + (c.pinned ? ' pinned' : '')}
                      title={c.pinned ? 'Unpin' : 'Pin'}
                      aria-label={c.pinned ? 'Unpin' : 'Pin'}
                      data-testid="chat-pin-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        pinChat(c.id, !c.pinned);
                      }}
                    >
                      <PinIcon pinned={c.pinned} />
                    </button>
                    <button
                      className="sb-action-btn"
                      title="Rename"
                      aria-label="Rename"
                      data-testid="chat-rename-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(c.id);
                        setEditTitle(c.title || '');
                      }}
                    >
                      <EditIcon />
                    </button>
                    <button
                      className="sb-action-btn danger"
                      title="Delete"
                      aria-label="Delete"
                      data-testid="chat-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeChat(c.id);
                      }}
                    >
                      <TrashIcon />
                    </button>
                    <button
                      className="sb-action-btn sb-chat-x"
                      title="More"
                      aria-label="More"
                      data-testid="chat-more-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        const r = e.currentTarget.getBoundingClientRect();
                        setChatMenu((m) =>
                          m && m.id === c.id
                            ? null
                            : { id: c.id, x: r.right, y: r.bottom, pinned: !!c.pinned }
                        );
                      }}
                    >
                      <MoreIcon />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="sb-repo-group" data-testid="sb-repo-group">
            <div
              className="sb-repo active"
              title={rootFolder}
              onClick={() => useStore.getState().setMainView('editor')}
            >
              <span className="sb-ico">{'\u{1F4C1}'}</span>
              <span className="sb-chat-title">{basename(rootFolder)}</span>
              {gitBranch && (
                <span className="muted" style={{ fontSize: '10px', padding: '1px 5px', opacity: 0.8, borderRadius: 4, background: 'var(--bg-elevated)' }}>
                  {gitBranch}
                </span>
              )}
              <div className="sb-repo-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="sb-action-btn"
                  title="Open files in Explorer"
                  aria-label="Open files"
                  onClick={() => useStore.getState().setMainView('editor')}
                >
                  {'\u{1F4C2}'}
                </button>
                <button
                  className="sb-action-btn"
                  title="New chat in this workspace"
                  aria-label="New chat in this workspace"
                  onClick={() => useStore.getState().newAgentChat()}
                >
                  {'\uFF0B'}
                </button>
              </div>
            </div>

            {sortedChats.length === 0 ? (
              <div
                className="sb-chat-row sb-empty-chat-hint"
                onClick={() => useStore.getState().newAgentChat()}
                title="Start a new chat in this repo"
                style={{ opacity: 0.5, fontStyle: 'italic' }}
              >
                <span className="sb-dot" style={{ opacity: 0.2 }} />
                <span className="sb-chat-title" style={{ color: 'var(--muted)', fontSize: '11px' }}>
                  No chats in this workspace yet
                </span>
              </div>
            ) : (
              sortedChats.map((c) => (
                <div
                  key={c.id}
                  className={'sb-chat-row' + (c.id === currentChatId ? ' active' : '')}
                  onClick={() => loadChat(c.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setChatMenu({ id: c.id, x: e.clientX, y: e.clientY, pinned: !!c.pinned });
                  }}
                  title={c.title || 'Untitled'}
                  data-testid="sb-chat-row"
                  data-chat-id={c.id}
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
                      {c.title || 'Untitled'}
                    </span>
                  )}
                  <span className="sb-time">{timeAgo(c.updatedAt)}</span>
                  {editingId !== c.id && (
                    <div className="sb-chat-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className={'sb-action-btn' + (c.pinned ? ' pinned' : '')}
                        title={c.pinned ? 'Unpin' : 'Pin'}
                        aria-label={c.pinned ? 'Unpin' : 'Pin'}
                        data-testid="chat-pin-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          pinChat(c.id, !c.pinned);
                        }}
                      >
                        <PinIcon pinned={c.pinned} />
                      </button>
                      <button
                        className="sb-action-btn"
                        title="Rename"
                        aria-label="Rename"
                        data-testid="chat-rename-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(c.id);
                          setEditTitle(c.title || '');
                        }}
                      >
                        <EditIcon />
                      </button>
                      <button
                        className="sb-action-btn danger"
                        title="Delete"
                        aria-label="Delete"
                        data-testid="chat-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeChat(c.id);
                        }}
                      >
                        <TrashIcon />
                      </button>
                      <button
                        className="sb-action-btn sb-chat-x"
                        title="More"
                        aria-label="More"
                        data-testid="chat-more-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          const r = e.currentTarget.getBoundingClientRect();
                          setChatMenu((m) =>
                            m && m.id === c.id
                              ? null
                              : { id: c.id, x: r.right, y: r.bottom, pinned: !!c.pinned }
                          );
                        }}
                      >
                        <MoreIcon />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
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
        {drive && drive.connected ? (
          <>
            {drive.picture ? (
              <img className="avatar" src={drive.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="avatar">{((drive.name || drive.email || 'G')[0] || 'G').toUpperCase()}</span>
            )}
            <span className="sb-chat-title" title={drive.email || ''}>
              {drive.name || drive.email || 'Google account'}
            </span>
            <span className="plan">Google</span>
          </>
        ) : (
          <>
            <span className="avatar">{(userName[0] || 'N').toUpperCase()}</span>
            <span className="sb-chat-title">{userName}</span>
            <span className="plan">Nova Free</span>
          </>
        )}
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
