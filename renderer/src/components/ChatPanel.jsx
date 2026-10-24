import { useRef, useState, useEffect } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useStore } from '../store';
import { streamChat } from '../aiClient';
import ThinkingBlock, { extractThinking } from './ThinkingBlock';

marked.setOptions({ gfm: true, breaks: true });

function Markdown({ text }) {
  const html = DOMPurify.sanitize(marked.parse(text || ''));
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

// Right-hand assistant panel: plain Q&A chat with optional active-file
// context. Agent work happens in the main center area (AgentMain).
export default function ChatPanel() {
  const models = useStore((s) => s.models);
  const activeModelId = useStore((s) => s.activeModelId);
  const messages = useStore((s) => s.messages);
  const chatBusy = useStore((s) => s.chatBusy);
  const includeActiveFile = useStore((s) => s.includeActiveFile);
  const setIncludeActiveFile = useStore((s) => s.setIncludeActiveFile);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  const [input, setInput] = useState('');
  const abortRef = useRef(null);
  const listRef = useRef(null);

  const activeModel = models.find((m) => m.id === activeModelId) || null;

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const sticky = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    if (sticky) el.scrollTop = el.scrollHeight;
  }, [messages, chatBusy]);

  function send() {
    const text = input.trim();
    if (!text || chatBusy) return;
    if (!activeModel) {
      setSettingsOpen(true, 'models');
      return;
    }
    setInput('');

    const store = useStore.getState();
    const userMsg = { id: crypto.randomUUID(), role: 'user', content: text };
    const asstMsg = { id: crypto.randomUUID(), role: 'assistant', content: '' };
    useStore.setState({ messages: [...store.messages, userMsg, asstMsg], chatBusy: true });
    scrollToBottom();

    let system =
      'You are Nova, an AI coding assistant embedded in a code editor. Be concise and practical. Use markdown code blocks for code.';
    if (includeActiveFile) {
      const tab = store.tabs.find((t) => t.path === store.activePath);
      if (tab && !tab.truncated) {
        system += `\n\nThe user's active file is: ${tab.path}\n\`\`\`${tab.language}\n${tab.content.slice(0, 60000)}\n\`\`\``;
      }
    }
    const history = store.messages.map(({ role, content }) => ({ role, content }));
    const payload = [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: text },
    ];

    const patch = (id, fn) =>
      useStore.setState({
        messages: useStore.getState().messages.map((m) => (m.id === id ? fn(m) : m)),
      });

    abortRef.current = streamChat({
      config: {
        id: activeModel.id,
        label: activeModel.label,
        baseUrl: activeModel.baseUrl,
        apiKey: activeModel.apiKey,
        model: activeModel.model,
        auth: activeModel.auth,
        modelIds: Array.isArray(activeModel.modelIds) ? activeModel.modelIds.slice(0, 100) : undefined,
      },
      messages: payload,
      onDelta: (d) => {
        patch(asstMsg.id, (m) => ({ ...m, content: m.content + d }));
        scrollToBottom();
      },
      onDone: () => {
        useStore.setState({ chatBusy: false });
        abortRef.current = null;
      },
      onError: (msg) => {
        patch(asstMsg.id, (m) => ({
          ...m,
          content: (m.content ? m.content + '\n\n' : '') + `**Error:** ${msg}`,
        }));
        useStore.setState({ chatBusy: false });
        abortRef.current = null;
      },
    });
  }

  function stop() {
    if (abortRef.current) abortRef.current.abort();
    useStore.setState({ chatBusy: false });
    abortRef.current = null;
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">Ask Nova</span>
        <div className="spacer" />
        <button className="btn small" onClick={() => useStore.getState().newAskChat()} title="Clear the conversation">
          + New
        </button>
        <button
          className="btn-icon"
          title="Hide the assistant panel"
          onClick={() => useStore.getState().setChatVisible(false)}
        >
          {'\u00D7'}
        </button>
      </div>

      <div className="chat-model-row">
        <select
          className="select"
          value={activeModelId ?? ''}
          onChange={(e) => {
            useStore.setState({ activeModelId: e.target.value || null });
            useStore.getState().saveSettings();
          }}
        >
          {models.length === 0 && <option value="">No models — open Settings</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} · {m.model}
            </option>
          ))}
        </select>
        <button
          className="btn-icon"
          title="Manage models & API keys (Ctrl+,)"
          onClick={() => setSettingsOpen(true, 'models')}
        >
          {'\u2699'}
        </button>
      </div>

      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Ask anything about your code.</p>
            <p className="muted">
              Any OpenAI-compatible model works — DeepSeek, OpenRouter, Groq, Ollama, LM Studio, OpenAI…
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={'chat-msg ' + m.role}>
            <div className="chat-role">{m.role === 'user' ? 'You' : 'Nova'}</div>
            {m.role === 'assistant' ? (
              (() => {
                const parsed = extractThinking(m.content);
                return (
                  <>
                    {parsed.thinking && <ThinkingBlock text={parsed.thinking} isLive={parsed.isLive} />}
                    {(parsed.body || chatBusy) ? <Markdown text={parsed.body || (chatBusy ? '\u2026' : '')} /> : null}
                  </>
                );
              })()
            ) : (
              <div className="chat-plain">{m.content}</div>
            )}
          </div>
        ))}
      </div>

      <div className="chat-input-row">
        <label className="chat-context-toggle">
          <input
            type="checkbox"
            checked={includeActiveFile}
            onChange={(e) => setIncludeActiveFile(e.target.checked)}
          />
          include active file
        </label>
        <textarea
          className="chat-input"
          rows={3}
          placeholder={'Ask Nova… (Enter to send)'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="chat-actions">
          {chatBusy ? (
            <button className="btn danger" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="btn primary" onClick={send} disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
