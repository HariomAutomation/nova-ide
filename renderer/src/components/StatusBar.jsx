import { useStore } from '../store';

export default function StatusBar() {
  const activeModel = useStore((s) => s.models.find((m) => m.id === s.activeModelId) || null);
  const status = useStore((s) => s.status);
  const folder = useStore((s) => s.rootFolder);
  const dirty = useStore((s) => {
    const t = s.tabs.find((t) => t.path === s.activePath);
    return !!t && t.dirty;
  });
  const agentBusy = useStore((s) => s.agentBusy);
  const chatBusy = useStore((s) => s.chatBusy);
  const agentStep = useStore((s) => s.agentStep);
  const terminalOpen = useStore((s) => s.terminalOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setTerminalOpen = useStore((s) => s.setTerminalOpen);

  return (
    <div className="statusbar">
      <button
        className="status-chip"
        title="Change model / add API keys"
        onClick={() => setSettingsOpen(true, 'models')}
      >
        {activeModel ? `\u26A1 ${activeModel.label} · ${activeModel.model}` : '\u26A1 Add a model…'}
      </button>
      {agentBusy && <span className="status-msg accent">agent running (step {agentStep})…</span>}
      {chatBusy && <span className="status-msg accent">generating…</span>}
      <span className="status-msg">{status}</span>
      <div className="spacer" />
      {dirty && <span className="status-msg">\u25CF unsaved</span>}
      <button
        className={'status-chip' + (terminalOpen ? ' active' : '')}
        title="Toggle terminal (Ctrl+`)"
        onClick={() => setTerminalOpen(!terminalOpen)}
      >
        &gt;_ terminal
      </button>
      <span className="status-msg">{folder ? folder.split('/').pop() : 'no folder opened'}</span>
    </div>
  );
}
