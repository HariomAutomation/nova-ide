import SearchPanel from './SearchPanel';

export default function SearchPage() {
  return (
    <div className="page-main">
      <div className="page-header">
        <h1>Search</h1>
        <p className="muted">Regex search across the open folder. Click a result to jump to it.</p>
      </div>
      <div className="page-inner">
        <SearchPanel />
      </div>
    </div>
  );
}
