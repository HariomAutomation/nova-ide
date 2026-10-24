import { useState, useMemo, useEffect } from 'react';
import { useStore } from '../store';

const STATUS_CONFIG = {
  pending: { label: 'Pending', icon: '⏳', bg: 'rgba(139, 141, 145, 0.15)', border: 'rgba(139, 141, 145, 0.35)', color: 'var(--muted)' },
  generating: { label: 'Generating', icon: '⚙️', bg: 'rgba(217, 165, 63, 0.15)', border: 'rgba(217, 165, 63, 0.4)', color: '#e3b64f' },
  done: { label: 'Done', icon: '✅', bg: 'rgba(70, 167, 88, 0.15)', border: 'rgba(70, 167, 88, 0.4)', color: '#7ad18a' },
  verified: { label: 'Verified', icon: '🧪', bg: 'rgba(91, 141, 239, 0.15)', border: 'rgba(91, 141, 239, 0.4)', color: '#8ab4ff' },
  skipped: { label: 'Skipped', icon: '⏭️', bg: 'rgba(139, 141, 145, 0.1)', border: 'rgba(139, 141, 145, 0.25)', color: 'var(--muted)' },
};

function getDeadlineUrgency(iso) {
  if (!iso) return { text: 'no deadline', urgency: 'unknown' };
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { text: 'no deadline', urgency: 'unknown' };
  const ms = t - Date.now();
  if (ms <= 0) return { text: 'closed', urgency: 'closed' };
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const human = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  const urgency = ms < 6 * 3600 * 1000 ? 'critical' : ms < 24 * 3600 * 1000 ? 'soon' : 'normal';
  return { text: human, urgency };
}

export default function ChallengePage() {
  const rootFolder = useStore((s) => s.rootFolder);
  const challenge = useStore((s) => s.challenge);
  const { spec, progress, loading, ingesting, packing, packResult, error, filterGroup, filterStatus, searchQuery, finding, availableChallenges, authRequired, authSteps, findError } = challenge;

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

  const kaggleSubmissions = useStore((s) => s.challenge.kaggleSubmissions);
  const kaggleSubmissionsLoading = useStore((s) => s.challenge.kaggleSubmissionsLoading);
  const kaggleDownloading = useStore((s) => s.challenge.kaggleDownloading);
  const kaggleSubmitting = useStore((s) => s.challenge.kaggleSubmitting);
  const loadKaggleSubmissions = useStore((s) => s.loadKaggleSubmissions);
  const downloadKaggleData = useStore((s) => s.downloadKaggleData);
  const submitKagglePrediction = useStore((s) => s.submitKagglePrediction);

  const penpotDesigns = useStore((s) => s.challenge.penpotDesigns);
  const penpotLoading = useStore((s) => s.challenge.penpotLoading);
  const penpotCreating = useStore((s) => s.challenge.penpotCreating);
  const loadPenpotDesigns = useStore((s) => s.loadPenpotDesigns);
  const createPenpotDesign = useStore((s) => s.createPenpotDesign);

  const [showIngestModal, setShowIngestModal] = useState(false);
  const [ingestMode, setIngestMode] = useState('live'); // 'live' | 'url' | 'paste'
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingestName, setIngestName] = useState('');
  const [ingestText, setIngestText] = useState('');
  const [ingestError, setIngestError] = useState('');
  const [liveSource, setLiveSource] = useState('topcoder'); // 'topcoder' | 'kaggle'
  const [liveTrackFilter, setLiveTrackFilter] = useState('all');
  const [liveKaggleCategory, setLiveKaggleCategory] = useState('all');
  const [liveDeliverableOnly, setLiveDeliverableOnly] = useState(true);
  const [liveSearch, setLiveSearch] = useState('');

  const [showPackModal, setShowPackModal] = useState(false);
  const [packFiles, setPackFiles] = useState('README.md, dist/');
  const [forcePack, setForcePack] = useState(false);
  const [showKaggleSubmitModal, setShowKaggleSubmitModal] = useState(false);
  const [kaggleSubmitFile, setKaggleSubmitFile] = useState('submission.csv');
  const [kaggleSubmitDesc, setKaggleSubmitDesc] = useState('');
  const [kaggleSubmitError, setKaggleSubmitError] = useState('');
  const [showPenpotModal, setShowPenpotModal] = useState(false);
  const [penpotDesignName, setPenpotDesignName] = useState('Storefront Wireframe');
  const [penpotScreens, setPenpotScreens] = useState('Home Screen, Dashboard, Product Detail');
  const [penpotError, setPenpotError] = useState('');
  const [expandedNotes, setExpandedNotes] = useState({});
  const [editingNote, setEditingNote] = useState({});

  useEffect(() => {
    loadChallenge();
  }, [rootFolder]);

  useEffect(() => {
    if (spec && (spec.source === 'kaggle' || spec.track === 'kaggle') && spec.id) {
      loadKaggleSubmissions(spec.id);
    }
    if (spec && spec.track && spec.track.toLowerCase().includes('design')) {
      loadPenpotDesigns();
    }
  }, [spec?.id, spec?.track]);

  useEffect(() => {
    if (showIngestModal && ingestMode === 'live' && (!availableChallenges || availableChallenges.length === 0)) {
      if (liveSource === 'kaggle') {
        findChallenges({ source: 'kaggle', search: liveSearch.trim() || undefined });
      } else {
        findChallenges({ source: 'topcoder', deliverableOnly: liveDeliverableOnly });
      }
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
      if (liveSource === 'kaggle') {
        if (liveKaggleCategory !== 'all' && String(c.category || '').toLowerCase() !== liveKaggleCategory.toLowerCase()) {
          return false;
        }
        if (liveSearch.trim()) {
          const q = liveSearch.toLowerCase();
          const matchName = String(c.name || '').toLowerCase().includes(q);
          const matchRef = String(c.ref || c.id || '').toLowerCase().includes(q);
          if (!matchName && !matchRef) return false;
        }
        return true;
      }
      if (liveTrackFilter !== 'all' && !String(c.track || '').toLowerCase().includes(liveTrackFilter)) return false;
      if (liveSearch.trim()) {
        const q = liveSearch.toLowerCase();
        if (!c.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [availableChallenges, liveSource, liveKaggleCategory, liveTrackFilter, liveSearch]);

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
            <span className="challenge-trophy">
              {spec && (spec.source === 'kaggle' || spec.track === 'kaggle') ? '📊' : '🏆'}
            </span>
            <h1 className="challenge-title">{spec ? spec.name : 'Contest & Challenge Studio'}</h1>
            {spec && spec.source && (
              <span className="challenge-source-badge">
                {spec.source === 'kaggle' ? 'Kaggle Competition' : spec.source === 'topcoder' ? 'TopCoder Contest' : 'Pasted Spec'}
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
                  {spec.source === 'kaggle' || spec.track === 'kaggle' ? 'View on Kaggle ↗' : 'View on TopCoder ↗'}
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
                  {spec.deadlines.map((d, idx) => {
                    const u = getDeadlineUrgency(d.at);
                    const icon = u.urgency === 'critical' ? '🔥' : u.urgency === 'soon' ? '⏳' : u.urgency === 'closed' ? '🔒' : '📅';
                    return (
                      <span
                        key={idx}
                        className={`challenge-deadline-badge ${u.urgency}`}
                        title={`${d.at} (${u.text})`}
                      >
                        {icon} {d.phase}: {u.text}
                      </span>
                    );
                  })}
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
          {spec && (spec.source === 'kaggle' || spec.track === 'kaggle') ? (
            <>
              <button
                className="challenge-btn secondary"
                onClick={async () => {
                  if (!spec.id) return;
                  const res = await downloadKaggleData(spec.id);
                  if (res && res.error) setIngestError(res.error);
                }}
                disabled={kaggleDownloading}
                title="Download competition files into ./data"
              >
                {kaggleDownloading ? '📥 Downloading...' : '📥 Download Data'}
              </button>
              <button
                className="challenge-btn primary"
                onClick={() => {
                  setKaggleSubmitError('');
                  setKaggleSubmitDesc(`Nova baseline submission - ${new Date().toLocaleTimeString()}`);
                  setShowKaggleSubmitModal(true);
                }}
                disabled={kaggleSubmitting}
                title="Submit submission.csv to Kaggle Leaderboard"
              >
                {kaggleSubmitting ? '🚀 Submitting...' : '🚀 Submit Prediction'}
              </button>
            </>
          ) : spec && spec.track && spec.track.toLowerCase().includes('design') ? (
            <>
              <button
                className="challenge-btn secondary"
                onClick={() => {
                  setPenpotError('');
                  setShowPenpotModal(true);
                }}
                disabled={penpotCreating}
                title="Author layout structure with Penpot"
              >
                {penpotCreating ? '🎨 Authoring...' : '🎨 Author Wireframe'}
              </button>
              <button
                className="challenge-btn pack-btn"
                onClick={() => setShowPackModal(true)}
                disabled={!spec || packing}
              >
                📦 Package Submission (.zip)
              </button>
            </>
          ) : (
            <button
              className="challenge-btn pack-btn"
              onClick={() => setShowPackModal(true)}
              disabled={!spec || packing}
            >
              📦 Package Submission (.zip)
            </button>
          )}
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

      {/* Penpot Vector Design Studio for DESIGN Track */}
      {spec && spec.track && spec.track.toLowerCase().includes('design') && (
        <div className="penpot-studio-card">
          <div className="penpot-studio-header">
            <div className="penpot-title-area">
              <span className="penpot-badge-icon">🎨</span>
              <div>
                <div className="penpot-card-title">
                  Penpot Vector Design Engine
                  <span className="penpot-active-tag">Open Vector Authoring</span>
                </div>
                <div className="penpot-card-subtitle">
                  Nova authors open <code>.penpot</code> ZIP vector designs with multi-board responsive layouts, coordinates, and typography hierarchy.
                </div>
              </div>
            </div>
            <div className="penpot-header-actions">
              <button
                type="button"
                className="challenge-btn secondary"
                onClick={() => {
                  window.nova.openExternal('https://design.penpot.app/');
                }}
                title="Launch Penpot Web Application (open-source vector editor)"
              >
                Penpot Web ↗
              </button>
              <button
                type="button"
                className="challenge-btn primary"
                onClick={() => {
                  setPenpotError('');
                  setShowPenpotModal(true);
                }}
                disabled={penpotCreating}
              >
                {penpotCreating ? 'Creating...' : '🎨 Author Wireframe'}
              </button>
            </div>
          </div>

          <div className="penpot-workflow-callout">
            <div className="penpot-step-item">
              <span className="step-num">1</span>
              <div>
                <strong>Author Structure</strong>
                <p>Nova builds screens, navbar bounds, cards and typography coordinates into <code>./design/*.penpot</code>.</p>
              </div>
            </div>
            <div className="penpot-step-arrow">→</div>
            <div className="penpot-step-item">
              <span className="step-num">2</span>
              <div>
                <strong>Open in Penpot</strong>
                <p>Import into Penpot to inspect vector boards or export SVG/PNG for reviews.</p>
              </div>
            </div>
            <div className="penpot-step-arrow">→</div>
            <div className="penpot-step-item">
              <span className="step-num">3</span>
              <div>
                <strong>TopCoder Deliverable (.fig)</strong>
                <p>Import SVG/vector layout into Figma for high-fidelity hand craft &amp; final <code>.fig</code> export.</p>
              </div>
            </div>
          </div>

          {/* Generated Penpot Designs List */}
          <div className="penpot-files-section">
            <div className="penpot-files-header">
              <span className="penpot-files-title">Generated Design Files ({penpotDesigns?.length || 0})</span>
              {penpotLoading && <span className="penpot-loading-indicator">Scanning ./design/...</span>}
            </div>
            {penpotDesigns && penpotDesigns.length > 0 ? (
              <div className="penpot-files-list">
                {penpotDesigns.map((f, i) => (
                  <div key={f.name || i} className="penpot-file-row">
                    <div className="penpot-file-info">
                      <span className="penpot-file-icon">📐</span>
                      <div className="penpot-file-details">
                        <span className="penpot-file-name">{f.name}</span>
                        <span className="penpot-file-meta">
                          {(f.size / 1024).toFixed(1)} KB · Modified {new Date(f.mtime).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                    <div className="penpot-file-actions">
                      <button
                        className="penpot-action-btn"
                        onClick={() => {
                          if (window.nova.openPath) window.nova.openPath(f.path);
                          else window.nova.openExternal('file://' + f.path);
                        }}
                        title="Show file on disk"
                      >
                        📁 Show File
                      </button>
                      <button
                        className="penpot-action-btn primary"
                        onClick={() => {
                          window.nova.openExternal('https://design.penpot.app/');
                        }}
                        title="Open Penpot to import this file"
                      >
                        Import to Penpot ↗
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="penpot-empty-state">
                No <code>.penpot</code> designs in <code>./design/</code> yet. Click <strong>"🎨 Author Wireframe"</strong> or prompt Nova Agent: <em>"Design the UI structure for this challenge with Penpot"</em>.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Metric-First Objective Banner for Kaggle */}
      {spec && (spec.track === 'kaggle' || spec.source === 'kaggle') && (
        <div className="kaggle-metric-banner">
          <span className="kaggle-metric-icon">🎯</span>
          <div className="kaggle-metric-content">
            <strong>Objective: Metric Optimization</strong>
            <p>
              The Kaggle API does not expose the evaluation metric directly. Fetch the competition overview ({spec.url}) and confirm the exact metric (e.g. <code>RMSE</code>, <code>LogLoss</code>, <code>ROC-AUC</code>, <code>F1</code>). All local cross-validation and <code>submission.csv</code> outputs must align to this metric.
            </p>
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

      {/* Kaggle Submissions Tracker */}
      {spec && (spec.source === 'kaggle' || spec.track === 'kaggle') && (
        <div className="kaggle-submissions-card">
          <div className="submissions-card-header">
            <div className="submissions-header-title">
              <span>📊 Leaderboard & Submissions</span>
              {kaggleSubmissionsLoading && <span className="submissions-loading-dot">Refreshing...</span>}
            </div>
            <button
              className="challenge-btn small secondary"
              onClick={() => loadKaggleSubmissions(spec.id)}
              disabled={kaggleSubmissionsLoading}
            >
              🔄 Refresh Scores
            </button>
          </div>
          {kaggleSubmissions && kaggleSubmissions.length > 0 ? (
            <div className="submissions-table-container">
              <table className="submissions-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>File</th>
                    <th>Status</th>
                    <th>Public Score</th>
                  </tr>
                </thead>
                <tbody>
                  {kaggleSubmissions.map((sub, idx) => (
                    <tr key={idx} className={idx === 0 ? 'latest-submission' : ''}>
                      <td>{sub.date ? new Date(sub.date).toLocaleDateString() : 'Recent'}</td>
                      <td className="sub-desc">{sub.description || '—'}</td>
                      <td><code>{sub.fileName || 'submission.csv'}</code></td>
                      <td>
                        <span className={`sub-status-pill ${String(sub.status || '').toLowerCase()}`}>
                          {sub.status || 'complete'}
                        </span>
                      </td>
                      <td className="sub-score">
                        {sub.publicScore != null ? (
                          <strong className="score-val">{sub.publicScore}</strong>
                        ) : (
                          <span className="score-pending">Processing</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="submissions-empty">
              No submissions yet for this competition. Generate <code>submission.csv</code> and click <strong>🚀 Submit Prediction</strong> to record your first public score!
            </div>
          )}
        </div>
      )}


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
                    if (liveSource === 'kaggle') {
                      findChallenges({ source: 'kaggle', search: liveSearch.trim() || undefined });
                    } else {
                      findChallenges({ source: 'topcoder', deliverableOnly: liveDeliverableOnly });
                    }
                  }}
                >
                  🌐 Live Open Contests
                </button>
                <button
                  type="button"
                  className={`ingest-tab-btn ${ingestMode === 'url' ? 'active' : ''}`}
                  onClick={() => setIngestMode('url')}
                >
                  🔗 TopCoder or Kaggle URL
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
                  <div className="source-platform-toggle">
                    <button
                      type="button"
                      className={`platform-toggle-btn ${liveSource === 'topcoder' ? 'active' : ''}`}
                      onClick={() => {
                        setLiveSource('topcoder');
                        findChallenges({ source: 'topcoder', deliverableOnly: liveDeliverableOnly });
                      }}
                    >
                      🏆 TopCoder Contests
                    </button>
                    <button
                      type="button"
                      className={`platform-toggle-btn ${liveSource === 'kaggle' ? 'active' : ''}`}
                      onClick={() => {
                        setLiveSource('kaggle');
                        findChallenges({ source: 'kaggle', search: liveSearch.trim() || undefined });
                      }}
                    >
                      📊 Kaggle Competitions
                    </button>
                  </div>

                  {authRequired && (
                    <div className="challenge-auth-banner">
                      <div className="auth-banner-title">🔑 Kaggle API Credentials Required</div>
                      <div>Kaggle API requires authentication for full competition access:</div>
                      <ol className="auth-banner-steps">
                        {(authSteps && authSteps.length > 0 ? authSteps : [
                          'kaggle.com -> your account -> Settings -> API -> Create New Token',
                          'Set KAGGLE_API_TOKEN environment variable (or KAGGLE_USERNAME and KAGGLE_KEY)',
                        ]).map((step, idx) => (
                          <li key={idx}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  )}

                  <div className="live-contests-filters">
                    <input
                      type="text"
                      className="challenge-input small"
                      placeholder={liveSource === 'kaggle' ? 'Search Kaggle (e.g. titanic, house prices)...' : 'Filter contests...'}
                      value={liveSearch}
                      onChange={(e) => setLiveSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (liveSource === 'kaggle') {
                            findChallenges({ source: 'kaggle', search: liveSearch.trim() || undefined });
                          }
                        }
                      }}
                    />
                    {liveSource === 'kaggle' ? (
                      <select
                        className="challenge-select"
                        value={liveKaggleCategory}
                        onChange={(e) => setLiveKaggleCategory(e.target.value)}
                      >
                        <option value="all">All Categories</option>
                        <option value="featured">Featured</option>
                        <option value="getting started">Getting Started</option>
                        <option value="research">Research</option>
                        <option value="community">Community</option>
                      </select>
                    ) : (
                      <>
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
                              findChallenges({ source: 'topcoder', deliverableOnly: next });
                            }}
                          />
                          Deliverable only
                        </label>
                      </>
                    )}
                    <button
                      type="button"
                      className="challenge-btn small secondary"
                      onClick={() => {
                        if (liveSource === 'kaggle') {
                          findChallenges({ source: 'kaggle', search: liveSearch.trim() || undefined });
                        } else {
                          findChallenges({ source: 'topcoder', deliverableOnly: liveDeliverableOnly });
                        }
                      }}
                      disabled={finding}
                      title="Refresh contest list"
                    >
                      {finding ? '...' : '🔄'}
                    </button>
                  </div>

                  {finding ? (
                    <div className="live-loading">
                      Fetching open {liveSource === 'kaggle' ? 'Kaggle competitions' : 'TopCoder contests'}...
                    </div>
                  ) : displayedChallenges.length === 0 ? (
                    <div className="live-empty">
                      No matching {liveSource === 'kaggle' ? 'Kaggle competitions' : 'open contests'} found.
                    </div>
                  ) : (
                    <div className="live-contests-list">
                      {displayedChallenges.map((c) => (
                        <div key={c.id || c.ref} className="live-contest-card">
                          <div className="live-contest-info">
                            <div className="live-contest-title-row">
                              <span className="live-contest-title">{c.name}</span>
                              <span className={`challenge-track-badge ${c.deliverable ? 'deliverable' : 'warning'}`}>
                                {c.category || c.track || (liveSource === 'kaggle' ? 'Kaggle ML' : 'Track')}
                              </span>
                              {c.reward && <span className="badge-reward">💰 {c.reward}</span>}
                              {!c.deliverable && <span className="figma-note">Requires Figma</span>}
                            </div>
                            <div className="live-contest-meta">
                              {c.endsAt && (() => {
                                const u = getDeadlineUrgency(c.endsAt);
                                const icon = u.urgency === 'critical' ? '🔥' : u.urgency === 'soon' ? '⏳' : u.urgency === 'closed' ? '🔒' : '📅';
                                return (
                                  <span className={`live-meta-item deadline-pill ${u.urgency}`}>
                                    {icon} Closes: {u.text}
                                  </span>
                                );
                              })()}
                              <span className="live-meta-item">
                                👥 {c.registrants || c.teams || 0} {liveSource === 'kaggle' ? 'teams' : 'reg'}
                                {c.submissions ? ` · 📄 ${c.submissions} subs` : ''}
                              </span>
                              {c.userHasEntered && (
                                <span className="live-meta-item" style={{ color: '#7ad18a', fontWeight: 600 }}>
                                  ✓ Entered {c.userRank ? `(Rank #${c.userRank})` : ''}
                                </span>
                              )}
                              <a
                                href={c.url}
                                className="challenge-link"
                                onClick={(e) => {
                                  e.preventDefault();
                                  window.nova.openExternal(c.url);
                                }}
                              >
                                {liveSource === 'kaggle' || c.track === 'kaggle' ? 'Kaggle ↗' : 'TopCoder ↗'}
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
                      <label>TopCoder or Kaggle Challenge URL / ID:</label>
                      <input
                        type="text"
                        className="challenge-input"
                        placeholder="https://www.kaggle.com/competitions/titanic or TopCoder URL"
                        value={ingestUrl}
                        onChange={(e) => setIngestUrl(e.target.value)}
                        autoFocus
                      />
                      <p className="ingest-help-text">
                        Nova will extract requirements and submission guidelines into a structured checklist with the track submission playbook. Both TopCoder and Kaggle are supported.
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

      {/* Kaggle Submit Modal */}
      {showKaggleSubmitModal && (
        <div className="challenge-modal-backdrop" onClick={() => setShowKaggleSubmitModal(false)}>
          <div className="challenge-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="challenge-modal-header">
              <h2>🚀 Submit Prediction to Kaggle</h2>
              <button className="modal-close-btn" onClick={() => setShowKaggleSubmitModal(false)}>✕</button>
            </div>

            <div className="kaggle-submit-modal-body" style={{ padding: '16px 0 0 0' }}>
              <p className="modal-note" style={{ marginBottom: 14, color: 'var(--text)' }}>
                Target Competition: <strong>{spec?.name}</strong> (<code>{spec?.id}</code>).
              </p>

              {kaggleSubmitError && (
                <div className="modal-error-box" style={{ marginBottom: 12, padding: 10, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: 6, color: '#fca5a5', fontSize: 12 }}>
                  {kaggleSubmitError}
                </div>
              )}

              <div className="ingest-form-group">
                <label>Prediction CSV File:</label>
                <input
                  type="text"
                  className="challenge-input"
                  value={kaggleSubmitFile}
                  onChange={(e) => setKaggleSubmitFile(e.target.value)}
                  placeholder="submission.csv"
                />
                <p className="ingest-help-text">
                  Default is <code>submission.csv</code> in the workspace root. Must match the column format and row count of <code>sample_submission.csv</code>.
                </p>
              </div>

              <div className="ingest-form-group" style={{ marginTop: 12 }}>
                <label>Submission Description:</label>
                <input
                  type="text"
                  className="challenge-input"
                  value={kaggleSubmitDesc}
                  onChange={(e) => setKaggleSubmitDesc(e.target.value)}
                  placeholder="e.g. LightGBM 5-fold CV baseline"
                />
              </div>

              <div className="modal-buttons" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
                <button
                  type="button"
                  className="challenge-btn secondary"
                  onClick={() => setShowKaggleSubmitModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="challenge-btn primary"
                  onClick={async () => {
                    setKaggleSubmitError('');
                    const res = await submitKagglePrediction(spec.id, {
                      filePath: kaggleSubmitFile.trim() || undefined,
                      description: kaggleSubmitDesc.trim(),
                    });
                    if (res && res.ok) {
                      setShowKaggleSubmitModal(false);
                    } else {
                      setKaggleSubmitError((res && res.error) || 'Submission failed');
                    }
                  }}
                  disabled={kaggleSubmitting}
                >
                  {kaggleSubmitting ? 'Uploading...' : '🚀 Submit Now'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Penpot Author Wireframe Modal */}
      {showPenpotModal && (
        <div className="challenge-modal-backdrop" onClick={() => setShowPenpotModal(false)}>
          <div className="challenge-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="challenge-modal-header">
              <h2>🎨 Author Penpot Vector Wireframe</h2>
              <button className="modal-close-btn" onClick={() => setShowPenpotModal(false)}>✕</button>
            </div>

            <div className="penpot-modal-body" style={{ padding: '16px 0 0 0' }}>
              <p className="modal-note" style={{ marginBottom: 14, color: 'var(--text)' }}>
                Nova will build an open vector <code>.penpot</code> file containing responsive screen boards, top navbars, and container layouts.
              </p>

              {penpotError && (
                <div className="modal-error-box" style={{ marginBottom: 12, padding: 10, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: 6, color: '#fca5a5', fontSize: 12 }}>
                  {penpotError}
                </div>
              )}

              <div className="ingest-form-group">
                <label>Design Name:</label>
                <input
                  type="text"
                  className="challenge-input"
                  value={penpotDesignName}
                  onChange={(e) => setPenpotDesignName(e.target.value)}
                  placeholder="e.g. Storefront Layout"
                />
              </div>

              <div className="ingest-form-group" style={{ marginTop: 12 }}>
                <label>Screens to Generate (comma-separated):</label>
                <input
                  type="text"
                  className="challenge-input"
                  value={penpotScreens}
                  onChange={(e) => setPenpotScreens(e.target.value)}
                  placeholder="e.g. Home, Dashboard, Product Detail, Checkout"
                />
                <p className="ingest-help-text">
                  Each screen creates an isolated 1440×900 vector board with responsive navigation, typography hierarchy, and UI cards.
                </p>
              </div>

              <div className="modal-buttons" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
                <button
                  type="button"
                  className="challenge-btn secondary"
                  onClick={() => setShowPenpotModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="challenge-btn primary"
                  onClick={async () => {
                    setPenpotError('');
                    const screenNames = penpotScreens
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (!screenNames.length) {
                      setPenpotError('Please specify at least one screen name');
                      return;
                    }
                    const boards = screenNames.map((name) => ({
                      name,
                      width: 1440,
                      height: 900,
                      elements: [
                        { kind: 'rect', name: 'Navbar', x: 0, y: 0, width: 1440, height: 72, fill: '#0F172A' },
                        { kind: 'text', name: 'Brand', x: 40, y: 26, width: 220, height: 24, content: (spec?.name ? spec.name.slice(0, 24) : 'Nova Design') },
                        { kind: 'text', name: 'Screen Title', x: 80, y: 130, width: 800, height: 48, content: name },
                        { kind: 'rect', name: 'Card 1', x: 80, y: 210, width: 400, height: 260, fill: '#1E293B', radius: 8 },
                        { kind: 'rect', name: 'Card 2', x: 510, y: 210, width: 400, height: 260, fill: '#1E293B', radius: 8 },
                        { kind: 'rect', name: 'Card 3', x: 940, y: 210, width: 420, height: 260, fill: '#1E293B', radius: 8 },
                      ],
                    }));
                    const res = await createPenpotDesign({
                      name: penpotDesignName.trim() || 'Design Wireframe',
                      boards,
                    });
                    if (res && res.ok) {
                      setShowPenpotModal(false);
                    } else {
                      setPenpotError((res && res.error) || 'Failed to create Penpot design');
                    }
                  }}
                  disabled={penpotCreating}
                >
                  {penpotCreating ? 'Building .penpot...' : '🎨 Generate Design'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
