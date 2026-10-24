import { useState, useMemo, useEffect } from 'react';
import { useStore } from '../store';

const STATUS_CONFIG = {
  pending: { label: 'Pending', icon: '⏳', bg: 'rgba(139, 141, 145, 0.15)', border: 'rgba(139, 141, 145, 0.35)', color: 'var(--muted)' },
  generating: { label: 'Generating', icon: '⚙️', bg: 'rgba(217, 165, 63, 0.15)', border: 'rgba(217, 165, 63, 0.4)', color: '#e3b64f' },
  done: { label: 'Done', icon: '✅', bg: 'rgba(70, 167, 88, 0.15)', border: 'rgba(70, 167, 88, 0.4)', color: '#7ad18a' },
  verified: { label: 'Verified', icon: '🧪', bg: 'rgba(91, 141, 239, 0.15)', border: 'rgba(91, 141, 239, 0.4)', color: '#8ab4ff' },
  skipped: { label: 'Skipped', icon: '⏭️', bg: 'rgba(139, 141, 145, 0.1)', border: 'rgba(139, 141, 145, 0.25)', color: 'var(--muted)' },
};

export default function ChallengePage() {
  const rootFolder = useStore((s) => s.rootFolder);
  const challenge = useStore((s) => s.challenge);
  const { spec, progress, loading, ingesting, packing, packResult, error, filterGroup, filterStatus, searchQuery, finding, availableChallenges } = challenge;

  const setFilterGroup = useStore((s) => s.setChallengeFilterGroup);
  const setFilterStatus = useStore((s) => s.setChallengeFilterStatus);
  const setSearchQuery = useStore((s) => s.setChallengeSearchQuery);
  const loadChallenge = useStore((s) => s.loadChallenge);
  const ingestChallenge = useStore((s) => s.ingestChallenge);
  const findChallenges = useStore((s) => s.findChallenges);
  const setChallengeItem = useStore((s) => s.setChallengeItem);
  const packChallenge = useStore((s) => s.packChallenge);
  const newAgentChat = useStore((s) => s.newAgentChat);
  const sendAgentMessage = useStore((s) => s.sendAgentMessage);
  const setMainView = useStore((s) => s.setMainView);

  const [showIngestModal, setShowIngestModal] = useState(false);
  const [ingestMode, setIngestMode] = useState('live'); // 'live' | 'url' | 'paste'
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingestName, setIngestName] = useState('');
  const [ingestText, setIngestText] = useState('');
  const [ingestError, setIngestError] = useState('');
  const [liveTrackFilter, setLiveTrackFilter] = useState('all');
  const [liveDeliverableOnly, setLiveDeliverableOnly] = useState(true);
  const [liveSearch, setLiveSearch] = useState('');

  const [showPackModal, setShowPackModal] = useState(false);
  const [packFiles, setPackFiles] = useState('README.md, dist/');
  const [forcePack, setForcePack] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState({});
  const [editingNote, setEditingNote] = useState({});

  useEffect(() => {
    loadChallenge();
  }, [rootFolder]);

  useEffect(() => {
    if (showIngestModal && ingestMode === 'live' && (!availableChallenges || availableChallenges.length === 0)) {
      findChallenges({ deliverableOnly: liveDeliverableOnly });
    }
  }, [showIngestModal, ingestMode]);

  // Unique groups in spec
  const groups = useMemo(() => {
    if (!spec || !Array.isArray(spec.items)) return [];
    return Array.from(new Set(spec.items.map((i) => i.group || 'General')));
  }, [spec]);

  const displayedChallenges = useMemo(() => {
    if (!availableChallenges || !Array.isArray(availableChallenges)) return [];
    return availableChallenges.filter((c) => {
      if (liveTrackFilter !== 'all' && !String(c.track || '').toLowerCase().includes(liveTrackFilter)) return false;
      if (liveSearch.trim()) {
        const q = liveSearch.toLowerCase();
        if (!c.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [availableChallenges, liveTrackFilter, liveSearch]);

  // Filter items
  const filteredItems = useMemo(() => {
    if (!spec || !Array.isArray(spec.items)) return [];
    return spec.items.filter((item) => {
      if (filterGroup !== 'all' && (item.group || 'General') !== filterGroup) return false;
      if (filterStatus !== 'all' && item.status !== filterStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchText = (item.text || '').toLowerCase().includes(q);
        const matchGroup = (item.group || '').toLowerCase().includes(q);
        const matchNote = (item.note || '').toLowerCase().includes(q);
        if (!matchText && !matchGroup && !matchNote) return false;
      }
      return true;
    });
  }, [spec, filterGroup, filterStatus, searchQuery]);

  // Group filtered items by group name
  const itemsByGroup = useMemo(() => {
    const map = {};
    for (const item of filteredItems) {
      const g = item.group || 'General';
      if (!map[g]) map[g] = [];
      map[g].push(item);
    }
    return map;
  }, [filteredItems]);

  const handleIngestSubmit = async (e) => {
    e.preventDefault();
    setIngestError('');
    let res;
    if (ingestMode === 'url') {
      if (!ingestUrl.trim()) {
        setIngestError('Please enter a TopCoder challenge URL or ID');
        return;
      }
      res = await ingestChallenge({ url: ingestUrl.trim() });
    } else {
      if (!ingestText.trim()) {
        setIngestError('Please paste the challenge requirements text');
        return;
      }
      res = await ingestChallenge({
        text: ingestText.trim(),
        name: ingestName.trim() || 'Custom Challenge',
      });
    }
    if (res && res.ok) {
      setShowIngestModal(false);
      setIngestUrl('');
      setIngestText('');
      setIngestName('');
    } else {
      setIngestError((res && res.error) || 'Ingestion failed');
    }
  };

  const handleStatusChange = async (itemId, newStatus) => {
    await setChallengeItem(itemId, { status: newStatus });
  };

  const handleSaveNote = async (itemId) => {
    const note = editingNote[itemId] !== undefined ? editingNote[itemId] : '';
    await setChallengeItem(itemId, { note });
    setExpandedNotes((prev) => ({ ...prev, [itemId]: false }));
  };

  const handleAskAgent = (item) => {
    const prompt = `Please implement the TopCoder challenge requirement:\n\n**Deliverable**: ${item.text}\n**Section**: ${item.group}\n\nReview the current workspace and codebase, implement the necessary files and changes, and test the deliverable to make sure it fully satisfies this requirement.`;
    newAgentChat();
    setMainView('agent');
    setTimeout(() => {
      sendAgentMessage(prompt);
    }, 100);
  };

  const handlePackSubmit = async (e) => {
    e.preventDefault();
    const files = packFiles
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await packChallenge({ files, force: forcePack });
    if (res && res.ok) {
      setShowPackModal(false);
    }
  };

  const percentComplete = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="challenge-page">
      {/* Top Header Bar */}
      <div className="challenge-header">
        <div className="challenge-title-area">
          <div className="challenge-title-row">
            <span className="challenge-trophy">🏆</span>
            <h1 className="challenge-title">{spec ? spec.name : 'TopCoder Challenge Studio'}</h1>
            {spec && spec.source && (
              <span className="challenge-source-badge">
                {spec.source === 'topcoder' ? 'TopCoder Contest' : 'Pasted Spec'}
              </span>
            )}
            {spec && spec.track && (
              <span className={`challenge-track-badge ${spec.track.toLowerCase().includes('design') ? 'warning' : 'deliverable'}`}>
                Track: {spec.track}
              </span>
            )}
          </div>
          {spec && (
            <div className="challenge-meta-row">
              {spec.id && <span className="challenge-id-badge">ID: {spec.id}</span>}
              {spec.url && (
                <a
                  href={spec.url}
                  target="_blank"
                  rel="noreferrer"
                  className="challenge-link"
                  onClick={(e) => {
                    e.preventDefault();
                    window.nova.openExternal(spec.url);
                  }}
                >
                  View on TopCoder ↗
                </a>
              )}
              {spec.tags && spec.tags.length > 0 && (
                <div className="challenge-tags">
                  {spec.tags.map((t, idx) => (
                    <span key={idx} className="challenge-tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {spec.deadlines && spec.deadlines.length > 0 && (
                <div className="challenge-deadlines">
                  {spec.deadlines.map((d, idx) => (
                    <span key={idx} className="challenge-deadline-badge" title={d.at}>
                      📅 {d.phase}: {new Date(d.at).toLocaleDateString()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="challenge-actions">
          <button
            className="challenge-btn secondary"
            onClick={() => loadChallenge()}
            disabled={loading}
            title="Refresh Challenge"
          >
            🔄 Refresh
          </button>
          <button
            className="challenge-btn secondary"
            onClick={() => {
              setIngestError('');
              setIngestMode('live');
              setShowIngestModal(true);
              findChallenges({ deliverableOnly: liveDeliverableOnly });
            }}
            title="Browse Open TopCoder Contests"
          >
            🔍 Explore Contests
          </button>
          <button
            className="challenge-btn primary"
            onClick={() => {
              setIngestError('');
              setIngestMode('url');
              setShowIngestModal(true);
            }}
          >
            📥 Ingest Challenge
          </button>
          <button
            className="challenge-btn pack-btn"
            onClick={() => setShowPackModal(true)}
            disabled={!spec || packing}
          >
            📦 Package Submission (.zip)
          </button>
        </div>
      </div>

      {/* Deliverability Warning if Track is DESIGN */}
      {spec && spec.track && spec.track.toLowerCase().includes('design') && (
        <div className="challenge-track-warning">
          <span className="warning-icon">⚠️</span>
          <div className="warning-text">
            <strong>Design Track Notice:</strong> TopCoder Design challenges require Figma source files (.fig), which Nova cannot author autonomously. A human designer is needed for craft, though Nova can generate UI skeletons and deliverable code.
          </div>
        </div>
      )}

      {/* Progress & KPI Metrics Bar */}
      {spec ? (
        <div className="challenge-kpi-bar">
          <div className="challenge-progress-card">
            <div className="challenge-progress-labels">
              <span className="challenge-progress-title">Readiness Score</span>
              <span className="challenge-progress-percent">{percentComplete}% Complete</span>
            </div>
            <div className="challenge-progress-track">
              <div
                className={`challenge-progress-fill ${progress.complete ? 'complete' : ''}`}
                style={{ width: `${percentComplete}%` }}
              />
            </div>
            <div className="challenge-progress-sub">
              {progress.done} of {progress.total} deliverables ready for judging
            </div>
          </div>

          <div className="challenge-stat-grid">
            <div className="challenge-stat-chip total" onClick={() => setFilterStatus('all')}>
              <span className="stat-label">Total</span>
              <span className="stat-val">{progress.total}</span>
            </div>
            <div className="challenge-stat-chip pending" onClick={() => setFilterStatus('pending')}>
              <span className="stat-label">Pending</span>
              <span className="stat-val">{progress.byStatus.pending || 0}</span>
            </div>
            <div className="challenge-stat-chip generating" onClick={() => setFilterStatus('generating')}>
              <span className="stat-label">In-Progress</span>
              <span className="stat-val">{progress.byStatus.generating || 0}</span>
            </div>
            <div className="challenge-stat-chip done" onClick={() => setFilterStatus('done')}>
              <span className="stat-label">Done</span>
              <span className="stat-val">{progress.byStatus.done || 0}</span>
            </div>
            <div className="challenge-stat-chip verified" onClick={() => setFilterStatus('verified')}>
              <span className="stat-label">Verified</span>
              <span className="stat-val">{progress.byStatus.verified || 0}</span>
            </div>
            <div className="challenge-stat-chip skipped" onClick={() => setFilterStatus('skipped')}>
              <span className="stat-label">Skipped</span>
              <span className="stat-val">{progress.byStatus.skipped || 0}</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Packaging Status Feedback Banner */}
      {packResult && (
        <div className={`challenge-pack-banner ${packResult.ok ? 'success' : 'blocked'}`}>
          {packResult.ok ? (
            <div className="pack-banner-content">
              <span className="pack-banner-icon">🎉</span>
              <div className="pack-banner-text">
                <strong>Submission package ready!</strong> Created zip at <code>{packResult.path}</code> (
                {Math.round((packResult.bytes || 0) / 1024)} KB, {packResult.files?.length || 0} files).
              </div>
            </div>
          ) : (
            <div className="pack-banner-content">
              <span className="pack-banner-icon">⚠️</span>
              <div className="pack-banner-text">
                <strong>Packaging Blocked:</strong> {packResult.error}
                {packResult.blocked && packResult.blocked.length > 0 && (
                  <div className="pack-blocked-list">
                    Missing deliverables:
                    <ul>
                      {packResult.blocked.map((b, idx) => (
                        <li key={idx}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <button
                className="challenge-btn force-pack-btn"
                onClick={() => packChallenge({ files: packFiles.split(',').map((s) => s.trim()).filter(Boolean), force: true })}
              >
                Force Package Anyway
              </button>
            </div>
          )}
        </div>
      )}

      {error && !packResult && (
        <div className="challenge-alert error">
          <span>⚠️ {error}</span>
        </div>
      )}

      {/* Main Checklist View or Empty State */}
      {!spec ? (
        <div className="challenge-empty-state">
          <div className="empty-state-icon">🎯</div>
          <h2>No Active Challenge in this Workspace</h2>
          <p>
            Nova turns TopCoder briefs into structured deliverables so your agent can execute,
            verify, and package submissions autonomously.
          </p>
          <div className="empty-actions">
            <button
              className="challenge-btn primary large"
              onClick={() => {
                setIngestError('');
                setIngestMode('live');
                setShowIngestModal(true);
                findChallenges({ deliverableOnly: liveDeliverableOnly });
              }}
            >
              🔍 Explore Open Contests
            </button>
            <button
              className="challenge-btn secondary large"
              onClick={() => {
                setIngestError('');
                setIngestMode('url');
                setShowIngestModal(true);
              }}
            >
              📥 Ingest by URL or Brief
            </button>
          </div>
          <div className="empty-tip">
            💡 Tip: Paste a TopCoder challenge URL (e.g. <code>https://www.topcoder.com/challenges/...</code>) or paste raw markdown requirements. Re-ingesting will never overwrite completed work.
          </div>
        </div>
      ) : (
        <div className="challenge-content">
          {/* Filters Bar */}
          <div className="challenge-filter-bar">
            <div className="challenge-search-box">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Filter deliverables or notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="challenge-search-input"
              />
              {searchQuery && (
                <button className="clear-search-btn" onClick={() => setSearchQuery('')}>
                  ✕
                </button>
              )}
            </div>

            <div className="challenge-filter-controls">
              <label>Section:</label>
              <select
                value={filterGroup}
                onChange={(e) => setFilterGroup(e.target.value)}
                className="challenge-select"
              >
                <option value="all">All Sections ({spec.items.length})</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g} ({spec.items.filter((i) => (i.group || 'General') === g).length})
                  </option>
                ))}
              </select>

              <label>Status:</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="challenge-select"
              >
                <option value="all">All Statuses</option>
                <option value="pending">⏳ Pending</option>
                <option value="generating">⚙️ In-Progress</option>
                <option value="done">✅ Done</option>
                <option value="verified">🧪 Verified</option>
                <option value="skipped">⏭️ Skipped</option>
              </select>
            </div>
          </div>

          {/* Grouped Checklist */}
          {Object.keys(itemsByGroup).length === 0 ? (
            <div className="challenge-no-results">
              No deliverables match your search and filter criteria.
            </div>
          ) : (
            <div className="challenge-groups-list">
              {Object.entries(itemsByGroup).map(([groupName, items]) => (
                <div key={groupName} className="challenge-group-card">
                  <div className="challenge-group-header">
                    <span className="group-title">{groupName}</span>
                    <span className="group-count">
                      {items.filter((i) => i.status === 'done' || i.status === 'verified').length}/{items.length} Ready
                    </span>
                  </div>

                  <div className="challenge-items-table">
                    {items.map((item) => {
                      const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
                      const isNoteExpanded = !!expandedNotes[item.id];
                      return (
                        <div key={item.id} className={`challenge-item-row ${item.status}`}>
                          <div className="challenge-item-main">
                            <div className="item-status-col">
                              <select
                                value={item.status}
                                onChange={(e) => handleStatusChange(item.id, e.target.value)}
                                className="item-status-select"
                                style={{ background: cfg.bg, borderColor: cfg.border, color: cfg.color }}
                              >
                                <option value="pending">⏳ Pending</option>
                                <option value="generating">⚙️ In-Progress</option>
                                <option value="done">✅ Done</option>
                                <option value="verified">🧪 Verified</option>
                                <option value="skipped">⏭️ Skipped</option>
                              </select>
                            </div>

                            <div className="item-text-col">
                              <div className="item-text">{item.text}</div>
                              {item.note && !isNoteExpanded && (
                                <div className="item-note-preview" onClick={() => setExpandedNotes((prev) => ({ ...prev, [item.id]: true }))}>
                                  📝 <em>{item.note}</em>
                                </div>
                              )}
                            </div>

                            <div className="item-actions-col">
                              <button
                                className="item-action-btn note-btn"
                                onClick={() => {
                                  const next = !isNoteExpanded;
                                  setExpandedNotes((prev) => ({ ...prev, [item.id]: next }));
                                  if (next && editingNote[item.id] === undefined) {
                                    setEditingNote((prev) => ({ ...prev, [item.id]: item.note || '' }));
                                  }
                                }}
                                title="Add/Edit Note"
                              >
                                📝 {item.note ? 'Edit Note' : 'Add Note'}
                              </button>
                              <button
                                className="item-action-btn agent-btn"
                                onClick={() => handleAskAgent(item)}
                                title="Instruct Nova Agent to implement this deliverable"
                              >
                                🤖 Ask Agent
                              </button>
                            </div>
                          </div>

                          {/* Expandable Notes Drawer */}
                          {isNoteExpanded && (
                            <div className="item-notes-drawer">
                              <textarea
                                className="item-note-input"
                                placeholder="Write implementation notes, file paths, or verification details..."
                                value={editingNote[item.id] !== undefined ? editingNote[item.id] : (item.note || '')}
                                onChange={(e) => setEditingNote((prev) => ({ ...prev, [item.id]: e.target.value }))}
                              />
                              <div className="item-notes-actions">
                                <button
                                  className="challenge-btn small primary"
                                  onClick={() => handleSaveNote(item.id)}
                                >
                                  Save Note
                                </button>
                                <button
                                  className="challenge-btn small secondary"
                                  onClick={() => setExpandedNotes((prev) => ({ ...prev, [item.id]: false }))}
                                >
                                  Close
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ingest Modal */}
      {showIngestModal && (
        <div className="challenge-modal-backdrop" onClick={() => setShowIngestModal(false)}>
          <div className="challenge-modal" onClick={(e) => e.stopPropagation()}>
            <div className="challenge-modal-header">
              <h3>📥 Ingest TopCoder Challenge Spec</h3>
              <button className="modal-close-btn" onClick={() => setShowIngestModal(false)}>
                ✕
              </button>
            </div>

            <div className="challenge-modal-body">
              <div className="ingest-tabs">
                <button
                  type="button"
                  className={`ingest-tab-btn ${ingestMode === 'live' ? 'active' : ''}`}
                  onClick={() => {
                    setIngestMode('live');
                    findChallenges({ deliverableOnly: liveDeliverableOnly });
                  }}
                >
                  🌐 Live Open Contests
                </button>
                <button
                  type="button"
                  className={`ingest-tab-btn ${ingestMode === 'url' ? 'active' : ''}`}
                  onClick={() => setIngestMode('url')}
                >
                  🔗 TopCoder URL or ID
                </button>
                <button
                  type="button"
                  className={`ingest-tab-btn ${ingestMode === 'paste' ? 'active' : ''}`}
                  onClick={() => setIngestMode('paste')}
                >
                  📋 Paste Brief / Markdown
                </button>
              </div>

              {ingestMode === 'live' ? (
                <div className="live-contests-container">
                  <div className="live-contests-filters">
                    <input
                      type="text"
                      className="challenge-input small"
                      placeholder="Filter contests..."
                      value={liveSearch}
                      onChange={(e) => setLiveSearch(e.target.value)}
                    />
                    <select
                      className="challenge-select"
                      value={liveTrackFilter}
                      onChange={(e) => setLiveTrackFilter(e.target.value)}
                    >
                      <option value="all">All Tracks</option>
                      <option value="develop">Development</option>
                      <option value="qa">QA / Bug Hunt</option>
                      <option value="data science">Data Science</option>
                      <option value="ideation">Ideation</option>
                      <option value="design">Design</option>
                    </select>
                    <label className="force-checkbox-label" style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={liveDeliverableOnly}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setLiveDeliverableOnly(next);
                          findChallenges({ deliverableOnly: next });
                        }}
                      />
                      Deliverable only
                    </label>
                    <button
                      type="button"
                      className="challenge-btn small secondary"
                      onClick={() => findChallenges({ deliverableOnly: liveDeliverableOnly })}
                      disabled={finding}
                      title="Refresh contest list"
                    >
                      {finding ? '...' : '🔄'}
                    </button>
                  </div>

                  {finding ? (
                    <div className="live-loading">Fetching open TopCoder contests...</div>
                  ) : displayedChallenges.length === 0 ? (
                    <div className="live-empty">No matching open contests found.</div>
                  ) : (
                    <div className="live-contests-list">
                      {displayedChallenges.map((c) => (
                        <div key={c.id} className="live-contest-card">
                          <div className="live-contest-info">
                            <div className="live-contest-title-row">
                              <span className="live-contest-title">{c.name}</span>
                              <span className={`challenge-track-badge ${c.deliverable ? 'deliverable' : 'warning'}`}>
                                {c.track || 'Track'}
                              </span>
                              {!c.deliverable && <span className="figma-note">Requires Figma</span>}
                            </div>
                            <div className="live-contest-meta">
                              {c.endsAt && (
                                <span className="live-meta-item">
                                  📅 Closes: {new Date(c.endsAt).toLocaleDateString()}
                                </span>
                              )}
                              <span className="live-meta-item">
                                👥 {c.registrants} reg · 📄 {c.submissions} subs
                              </span>
                              <a
                                href={c.url}
                                className="challenge-link"
                                onClick={(e) => {
                                  e.preventDefault();
                                  window.nova.openExternal(c.url);
                                }}
                              >
                                TopCoder ↗
                              </a>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="challenge-btn primary small"
                            onClick={async () => {
                              setIngestError('');
                              const res = await ingestChallenge({ url: c.url });
                              if (res && res.ok) setShowIngestModal(false);
                              else setIngestError((res && res.error) || 'Failed to ingest');
                            }}
                            disabled={ingesting}
                          >
                            {ingesting ? 'Ingesting...' : '⚡ Ingest & Start'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <form onSubmit={handleIngestSubmit}>
                  {ingestMode === 'url' ? (
                    <div className="ingest-form-group">
                      <label>TopCoder Challenge URL or UUID:</label>
                      <input
                        type="text"
                        className="challenge-input"
                        placeholder="https://www.topcoder.com/challenges/e68b8eaf-48d9-4f9a-86a2-1f7f3fab9e83"
                        value={ingestUrl}
                        onChange={(e) => setIngestUrl(e.target.value)}
                        autoFocus
                      />
                      <p className="ingest-help-text">
                        Nova will automatically query the TopCoder v6 API to extract all rolling and final submission requirements into a structured checklist.
                      </p>
                    </div>
                  ) : (
                    <div className="ingest-form-group">
                      <label>Challenge Title:</label>
                      <input
                        type="text"
                        className="challenge-input"
                        placeholder="e.g. Premium Fashion Storefront Design"
                        value={ingestName}
                        onChange={(e) => setIngestName(e.target.value)}
                      />
                      <label style={{ marginTop: 12 }}>Requirements Text / Markdown Brief:</label>
                      <textarea
                        className="challenge-textarea"
                        placeholder="Paste the challenge objectives, numbered requirements, and deliverable list here..."
                        rows={10}
                        value={ingestText}
                        onChange={(e) => setIngestText(e.target.value)}
                        autoFocus
                      />
                      <p className="ingest-help-text">
                        Nova automatically groups deliverables by headings and strips boilerplate like submission rules and payment disclaimers.
                      </p>
                    </div>
                  )}

                  {ingestError && <div className="challenge-modal-error">⚠️ {ingestError}</div>}

                  <div className="challenge-modal-footer">
                    <span className="preserve-badge">
                      🛡️ Re-ingest preserves existing item statuses
                    </span>
                    <div className="modal-buttons">
                      <button
                        type="button"
                        className="challenge-btn secondary"
                        onClick={() => setShowIngestModal(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="challenge-btn primary"
                        disabled={ingesting}
                      >
                        {ingesting ? 'Ingesting...' : 'Ingest & Generate Checklist'}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {ingestMode === 'live' && (
                <div className="challenge-modal-footer">
                  <span className="preserve-badge">
                    ⚡ 1-click live challenge discovery
                  </span>
                  <div className="modal-buttons">
                    <button
                      type="button"
                      className="challenge-btn secondary"
                      onClick={() => setShowIngestModal(false)}
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pack Submission Modal */}
      {showPackModal && (
        <div className="challenge-modal-backdrop" onClick={() => setShowPackModal(false)}>
          <div className="challenge-modal" onClick={(e) => e.stopPropagation()}>
            <div className="challenge-modal-header">
              <h3>📦 Package Submission ZIP</h3>
              <button className="modal-close-btn" onClick={() => setShowPackModal(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handlePackSubmit} className="challenge-modal-body">
              <div className="ingest-form-group">
                <label>Files & Folders to include (comma-separated):</label>
                <input
                  type="text"
                  className="challenge-input"
                  placeholder="README.md, dist/, src/"
                  value={packFiles}
                  onChange={(e) => setPackFiles(e.target.value)}
                  autoFocus
                />
                <p className="ingest-help-text">
                  Files relative to the workspace root. The built-in dependency-free ZIP writer bundles them with valid CRC32 headers for standard unzipping.
                </p>
              </div>

              {!progress.complete && (
                <div className="pack-warning-box">
                  <div className="warning-title">⚠️ Checklist Incomplete</div>
                  <p>
                    {progress.done} of {progress.total} deliverables completed. TopCoder submissions missing key deliverables often score zero or fail review.
                  </p>
                  <label className="force-checkbox-label">
                    <input
                      type="checkbox"
                      checked={forcePack}
                      onChange={(e) => setForcePack(e.target.checked)}
                    />
                    Force packaging anyway (override completion check)
                  </label>
                </div>
              )}

              <div className="challenge-modal-footer">
                <button
                  type="button"
                  className="challenge-btn secondary"
                  onClick={() => setShowPackModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="challenge-btn primary"
                  disabled={packing || (!progress.complete && !forcePack)}
                >
                  {packing ? 'Packaging...' : 'Generate submission.zip'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
