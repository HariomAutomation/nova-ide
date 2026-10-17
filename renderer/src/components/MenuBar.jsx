import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

function Menu({ label, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button className={'menu-btn' + (open ? ' open' : '')} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div className="menu-dropdown">
          {items.map((it, i) =>
            it.sep ? (
              <div key={i} className="menu-sep" />
            ) : (
              <button
                key={i}
                className="menu-item"
                disabled={!!it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.action && it.action();
                }}
              >
                <span>{it.label}</span>
                {it.hint && <span className="menu-hint">{it.hint}</span>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

function ed() {
  return window.__novaEditor || null;
}

export default function MenuBar() {
  const store = useStore;
  const theme = useStore((s) => s.theme);

  return (
    <div className="menubar">
      <span className="menubar-brand">Nova</span>
      <Menu
        label="File"
        items={[
          { label: 'Open Folder…', hint: 'Ctrl+O', action: () => useStore.getState().openFolder() },
          { label: 'New File', hint: 'Ctrl+N', action: () => useStore.getState().newFile() },
          { sep: true },
          { label: 'Save', hint: 'Ctrl+S', action: () => useStore.getState().saveActive() },
          {
            label: 'Close Tab',
            hint: 'Ctrl+W',
            action: () => {
              const s = useStore.getState();
              if (s.activePath) s.closeTab(s.activePath);
            },
          },
          { sep: true },
          { label: 'Settings…', hint: 'Ctrl+,', action: () => useStore.getState().setSettingsOpen(true) },
          { sep: true },
          { label: 'Quit', action: () => window.close() },
        ]}
      />
      <Menu
        label="Edit"
        items={[
          { label: 'Undo', hint: 'Ctrl+Z', action: () => ed() && ed().trigger('menu', 'undo', null) },
          { label: 'Redo', hint: 'Ctrl+Shift+Z', action: () => ed() && ed().trigger('menu', 'redo', null) },
          { sep: true },
          { label: 'Find', hint: 'Ctrl+F', action: () => ed() && ed().getAction('actions.find').run() },
          { label: 'Replace', hint: 'Ctrl+H', action: () => ed() && ed().getAction('editor.action.startFindReplaceAction').run() },
        ]}
      />
      <Menu
        label="View"
        items={[
          { label: 'Agent Home', action: () => store.getState().focusComposer() },
          {
            label: 'Code Editor',
            hint: 'Ctrl+Shift+A',
            action: () => store.getState().setMainView(store.getState().mainView === 'editor' ? 'agent' : 'editor'),
          },
          { sep: true },
          { label: 'Search', action: () => store.getState().openSearchPage() },
          { label: 'Automations', action: () => store.getState().openAutomations() },
          { label: 'Customize', action: () => store.getState().openCustomize() },
          {
            label: 'Gemini sign-in (Settings)',
            action: () => store.getState().setSettingsOpen(true, 'models'),
          },
          { sep: true },
          { label: 'Assistant Panel', action: () => store.getState().setChatVisible(!store.getState().chatVisible) },
          { label: 'Toggle Sidebar', action: () => store.getState().setSidebarVisible(!store.getState().sidebarVisible) },
          { label: 'Toggle Terminal', hint: 'Ctrl+`', action: () => store.getState().setTerminalOpen(!store.getState().terminalOpen) },
          { sep: true },
          {
            label: `Theme: ${theme === 'anime' ? 'Anime \u2726' : theme === 'dark' ? 'Dark' : 'Light'}`,
            action: () => {
              const s = store.getState();
              const next = s.theme === 'light' ? 'dark' : s.theme === 'dark' ? 'anime' : 'light';
              s.setTheme(next);
            },
          },
        ]}
      />
      <Menu
        label="Help"
        items={[
          { label: 'About Nova IDE', action: () => useStore.getState().setSettingsOpen(true, 'about') },
          { label: 'Models & API keys', action: () => useStore.getState().setSettingsOpen(true, 'models') },
        ]}
      />
    </div>
  );
}
