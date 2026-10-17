import { useEffect } from 'react';
import { useStore } from './store';
import MenuBar from './components/MenuBar';
import Sidebar from './components/Sidebar';
import AgentMain from './components/AgentMain';
import EditorArea from './components/EditorArea';
import SearchPage from './components/SearchPage';
import AutomationsPage from './components/AutomationsPage';
import SourceControlPage from './components/SourceControlPage';
import CloudPage from './components/CloudPage';
import MemoryPage from './components/MemoryPage';
import CustomizePage from './components/CustomizePage';
import GeminiView from './components/GeminiView';
import ChatPanel from './components/ChatPanel';
import TerminalPanel from './components/TerminalPanel';
import SettingsModal from './components/SettingsModal';
import StatusBar from './components/StatusBar';

export default function App() {
  const settingsOpen = useStore((s) => s.settingsOpen);
  const chatVisible = useStore((s) => s.chatVisible);
  const terminalOpen = useStore((s) => s.terminalOpen);
  const sidebarVisible = useStore((s) => s.sidebarVisible !== false);
  const mainView = useStore((s) => s.mainView);
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    useStore.getState().loadSettings().then(() => {
      // Automations with a startup/interval/daily trigger fire from here.
      useStore.getState().startAutomationScheduler();
      // Load the signed-in Google account (if any) so its details show in the UI.
      useStore.getState().loadDrive().catch(() => {});
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', ['dark', 'anime'].includes(theme) ? theme : 'light');
  }, [theme]);

  useEffect(() => {
    const offAgent = window.nova.onAgentEvent((e) => useStore.getState().agentHandleEvent(e));
    const offFs = window.nova.onFsChanged(({ path }) => useStore.getState().onFsChanged(path));
    const offTermData = window.nova.onTermData((p) => useStore.getState().termData(p));
    const offTermExit = window.nova.onTermExit((p) => useStore.getState().termExit(p));
    const offWebhook = window.nova.onAutomationWebhook
      ? window.nova.onAutomationWebhook(({ token }) => useStore.getState().handleAutomationWebhook(token))
      : () => {};
    return () => {
      offAgent();
      offFs();
      offTermData();
      offTermExit();
      offWebhook();
    };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const s = useStore.getState();
      if (k === 's') {
        e.preventDefault();
        e.stopPropagation();
        s.saveActive();
      } else if (k === 'o') {
        e.preventDefault();
        e.stopPropagation();
        s.openFolder();
      } else if (k === 'n') {
        e.preventDefault();
        e.stopPropagation();
        s.newFile();
      } else if (k === ',') {
        e.preventDefault();
        e.stopPropagation();
        s.setSettingsOpen(true);
      } else if (k === 'w') {
        e.preventDefault();
        e.stopPropagation();
        if (s.activePath) s.closeTab(s.activePath);
      } else if (k === '`') {
        e.preventDefault();
        e.stopPropagation();
        s.setTerminalOpen(!s.terminalOpen);
      } else if (k === 'a' && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        s.setMainView(s.mainView === 'agent' ? 'editor' : 'agent');
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  return (
    <div className="app">
      <MenuBar />
      <div className="main-row">
        {sidebarVisible && <Sidebar />}
        <div className="center-col">
          {mainView === 'agent' && <AgentMain />}
          {mainView === 'editor' && <EditorArea />}
          {mainView === 'search' && <SearchPage />}
          {mainView === 'automations' && <AutomationsPage />}
          {mainView === 'git' && <SourceControlPage />}
          {mainView === 'cloud' && <CloudPage />}
          {mainView === 'memory' && <MemoryPage />}
          {mainView === 'customize' && <CustomizePage />}
          {/* Always mounted (hidden when inactive) so the sign-in session and
              the agent's driver keep working across views. */}
          <GeminiView active={mainView === 'gemini'} />
        </div>
        {chatVisible && <ChatPanel />}
      </div>
      {terminalOpen && <TerminalPanel />}
      <StatusBar />
      {settingsOpen && <SettingsModal />}
    </div>
  );
}
