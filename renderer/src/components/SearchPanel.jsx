import { useStore } from '../store';

function rel(path, root) {
  if (root && path.startsWith(root)) {
    return path.slice(root.length).replace(/^\//, '');
  }
  return path;
}

export default function SearchPanel() {
  const query = useStore((s) => s.searchQuery);
  const results = useStore((s) => s.searchResults);
  const running = useStore((s) => s.searchRunning);
  const rootFolder = useStore((s) => s.rootFolder);
  const setQuery = useStore((s) => s.setSearchQuery);
  const runSearch = useStore((s) => s.runSearch);
  const openResult = useStore((s) => s.openSearchResult);

  return (
    <div className="search-panel">
      <div className="search-row">
        <input
          className="input"
          placeholder="Search (regex)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <button className="btn small" disabled={running} onClick={() => runSearch()}>
          {running ? '…' : 'Go'}
        </button>
      </div>

      {!rootFolder && <p className="muted small">Open a folder to search.</p>}

      {results && results.error && <p className="search-error">{results.error}</p>}

      {results && results.results && (
        <>
          <div className="search-count">
            {results.count} result{results.count === 1 ? '' : 's'}
            {results.truncated ? ' (truncated)' : ''}
          </div>
          <div className="search-results">
            {results.results.map((r, i) => (
              <div
                key={i}
                className="search-result"
                title={`${r.path}:${r.line}`}
                onClick={() => openResult(r.path, r.line)}
              >
                <div className="search-result-path">
                  {rel(r.path, rootFolder)}:{r.line}
                </div>
                <div className="search-result-text">{r.text.trim()}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
