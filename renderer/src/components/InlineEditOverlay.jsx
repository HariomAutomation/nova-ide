export default function InlineEditOverlay({ inline, onPromptChange, onSubmit, onAccept, onReject }) {
  return (
    <div className="inline-overlay">
      <div className="inline-box">
        <div className="inline-row">
          <input
            autoFocus
            className="inline-input"
            placeholder="Edit with AI\u2026 (e.g. \u201crefactor this\u201d, \u201cfix the bug\u201d, \u201cadd error handling\u201d)"
            value={inline.prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit();
              if (e.key === 'Escape') onReject();
            }}
            disabled={inline.streaming}
          />
          {!inline.streaming && inline.output === '' && (
            <button className="btn primary" onClick={onSubmit}>
              Generate
            </button>
          )}
          {inline.streaming && <span className="inline-status">generating\u2026</span>}
        </div>

        {inline.error && <div className="inline-error">{inline.error}</div>}

        {inline.output !== '' && (
          <>
            <div className="inline-preview">
              <pre>{inline.output}</pre>
            </div>
            {!inline.streaming && (
              <div className="inline-actions">
                <button className="btn primary" onClick={onAccept}>
                  Accept (replace selection)
                </button>
                <button className="btn" onClick={onReject}>
                  Reject
                </button>
              </div>
            )}
          </>
        )}

        {!inline.streaming && inline.output === '' && (
          <div className="inline-hint">Enter = generate &middot; Esc = cancel</div>
        )}
      </div>
    </div>
  );
}
