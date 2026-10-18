import { useRef, useState, useCallback, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { monaco } from '../monaco-setup';
import { useStore } from '../store';
import { streamChat } from '../aiClient';
import InlineEditOverlay from './InlineEditOverlay';

export default function EditorArea() {
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const closeTab = useStore((s) => s.closeTab);
  const pendingReveal = useStore((s) => s.pendingReveal);
  const theme = useStore((s) => s.theme);
  const tab = tabs.find((t) => t.path === activePath) || null;

  const editorRef = useRef(null);
  const [inline, setInline] = useState(null);
  const inlineAbortRef = useRef(null);

  const handleMount = useCallback((editor) => {
    editorRef.current = editor;
    window.__novaEditor = editor;

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
      const model = editor.getModel();
      if (!model) return;
      const sel = editor.getSelection();
      const text = sel ? model.getValueInRange(sel) : '';
      const pos = editor.getPosition() || { lineNumber: 1, column: 1 };
      const hasSelection = !!(text && text.trim());
      const effectiveRange = hasSelection
        ? sel
        : new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
      const effectiveText = hasSelection ? text : '';
      setInline({
        range: effectiveRange,
        selectedText: effectiveText,
        prompt: '',
        output: '',
        streaming: false,
        error: null,
        isInsertion: !hasSelection,
      });
    });
  }, []);

  // Reveal a line requested from search results / agent edits
  useEffect(() => {
    if (!pendingReveal || !tab || pendingReveal.path !== tab.path) return;
    const t = setTimeout(() => {
      const ed = editorRef.current;
      if (!ed) return;
      const line = Math.max(1, pendingReveal.line || 1);
      try {
        ed.revealLineInCenter(line);
        ed.setPosition({ lineNumber: line, column: 1 });
        ed.focus();
      } catch {}
      useStore.setState({ pendingReveal: null });
    }, 90);
    return () => clearTimeout(t);
  }, [pendingReveal, tab?.path]);

  function runInline(prompt) {
    const activeModel = useStore.getState().models.find((m) => m.id === useStore.getState().activeModelId);
    if (!activeModel) {
      setInline((i) => (i ? { ...i, error: 'No model configured. Open Settings (Ctrl+,).' } : i));
      return;
    }
    setInline((i) => (i ? { ...i, streaming: true, output: '', error: null } : i));
    inlineAbortRef.current = streamChat({
      config: {
        baseUrl: activeModel.baseUrl,
        apiKey: activeModel.apiKey,
        model: activeModel.model,
        auth: activeModel.auth,
      },
      messages: [
        {
          role: 'system',
          content:
            'You are a precise code editor. Reply with ONLY the replacement or generated code. No markdown fences, no explanation, no preamble.',
        },
        {
          role: 'user',
          content: inline.selectedText
            ? `INSTRUCTION: ${prompt}\n\nSELECTED CODE:\n${inline.selectedText}`
            : `INSTRUCTION: ${prompt}\n\nFILE: ${tab?.path || 'current file'}\nGenerate the requested code to insert at cursor.`,
        },
      ],
      onDelta: (d) => setInline((i) => (i ? { ...i, output: i.output + d } : i)),
      onDone: () => {
        setInline((i) => (i ? { ...i, streaming: false } : i));
        inlineAbortRef.current = null;
      },
      onError: (m) => {
        setInline((i) => (i ? { ...i, streaming: false, error: m } : i));
        inlineAbortRef.current = null;
      },
    });
  }

  function acceptInline() {
    const ed = editorRef.current;
    if (!ed || !inline) return;
    ed.executeEdits('nova-inline', [{ range: inline.range, text: inline.output }]);
    ed.pushUndoStop();
    ed.focus();
    setInline(null);
  }

  function rejectInline() {
    if (inlineAbortRef.current) inlineAbortRef.current.abort();
    setInline(null);
    editorRef.current?.focus();
  }

  if (!tab) {
    return (
      <div className="editor-area">
        <div className="tabs-row">
          <div className="tabs" />
          <div className="tab-actions">
            <button
              className="pill"
              title="Back to the agent chat (Ctrl+Shift+A)"
              onClick={() => useStore.getState().setMainView('agent')}
            >
              {'Agent \u2197'}
            </button>
          </div>
        </div>
        <div className="welcome">
          <div className="welcome-logo">Nova</div>
          <p className="welcome-sub">An agentic AI IDE — your models, your keys, full control</p>
          <div className="welcome-keys">
            <div>
              <kbd>Ctrl</kbd> <kbd>O</kbd> — Open folder
            </div>
            <div>
              <kbd>Ctrl</kbd> <kbd>K</kbd> — Edit selection with AI
            </div>
            <div>
              <kbd>Ctrl</kbd> <kbd>`</kbd> — Toggle terminal
            </div>
            <div>
              <kbd>Ctrl</kbd> <kbd>,</kbd> — Settings (models, agent, browser)
            </div>
          </div>
          <p className="welcome-hint muted small">
            The <b>Agent</b> view (Ctrl+Shift+A) can read &amp; write files, run commands, drive a real browser and
            control your desktop.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-area">
      <div className="tabs-row">
        <div className="tabs">
          {tabs.map((t) => (
            <div
              key={t.path}
              className={'tab' + (t.path === activePath ? ' active' : '')}
              onClick={() => useStore.setState({ activePath: t.path })}
              title={t.path}
            >
              <span className="tab-name">{t.name}</span>
              {t.dirty && <span className="tab-dot">&bull;</span>}
              <span
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.path);
                }}
              >
                &#215;
              </span>
            </div>
          ))}
        </div>
        <div className="tab-actions">
          <button
            className="pill"
            title="Back to the agent chat (Ctrl+Shift+A)"
            onClick={() => useStore.getState().setMainView('agent')}
          >
            {'Agent \u2197'}
          </button>
        </div>
      </div>
      <div className="editor-wrap">
        <Editor
          path={tab.path}
          language={tab.language}
          value={tab.content}
          onChange={(v) => useStore.getState().updateActiveContent(v ?? '')}
          onMount={handleMount}
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          options={{
            fontSize: 13.5,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
            fontLigatures: true,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            readOnly: !!tab.truncated,
            renderWhitespace: 'selection',
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            padding: { top: 10 },
            inlineSuggest: { enabled: true, mode: 'subwordSmart' },
            suggest: { preview: true },
          }}
        />
        {inline && (
          <InlineEditOverlay
            inline={inline}
            onPromptChange={(p) => setInline((i) => (i ? { ...i, prompt: p } : i))}
            onSubmit={() => inline.prompt.trim() && runInline(inline.prompt.trim())}
            onAccept={acceptInline}
            onReject={rejectInline}
          />
        )}
      </div>
    </div>
  );
}
