import { useState, useMemo, useEffect } from 'react';
import { useStore } from '../store';

function rel(filePath, root) {
  if (!filePath) return '';
  if (root && filePath.startsWith(root)) {
    return filePath.slice(root.length).replace(/^\//, '');
  }
  return filePath;
}

const SEVERITY_COLORS = {
  critical: { bg: 'rgba(229, 72, 77, 0.15)', border: 'rgba(229, 72, 77, 0.4)', text: '#f2a1a4', label: 'CRITICAL' },
  high: { bg: 'rgba(247, 107, 21, 0.15)', border: 'rgba(247, 107, 21, 0.4)', text: '#ffa066', label: 'HIGH' },
  medium: { bg: 'rgba(217, 165, 63, 0.15)', border: 'rgba(217, 165, 63, 0.4)', text: '#e3b64f', label: 'MEDIUM' },
  low: { bg: 'rgba(91, 141, 239, 0.15)', border: 'rgba(91, 141, 239, 0.4)', text: '#8ab4ff', label: 'LOW' },
};

const STATUS_LABELS = {
  open: { label: 'Open', color: 'var(--muted)', bg: 'rgba(139, 141, 145, 0.15)' },
  triaged: { label: 'Triaged', color: '#8ab4ff', bg: 'rgba(91, 141, 239, 0.15)' },
  confirmed: { label: 'Confirmed', color: '#f2a1a4', bg: 'rgba(229, 72, 77, 0.15)' },
  'false-positive': { label: 'False Positive', color: 'var(--muted)', bg: 'rgba(139, 141, 145, 0.12)' },
  fixed: { label: 'Fixed', color: '#7ad18a', bg: 'rgba(70, 167, 88, 0.15)' },
  'wont-fix': { label: "Won't Fix", color: 'var(--muted)', bg: 'rgba(139, 141, 145, 0.12)' },
};

function FindingCard({ f, rootFolder, onJump, onTriage, onFix, onVerify }) {
  const [editingAnalysis, setEditingAnalysis] = useState(false);
  const [analysisText, setAnalysisText] = useState(f.analysis || '');
  const sevKey = (f.severityAdjusted || f.severity || 'medium').toLowerCase();
  const sevStyle = SEVERITY_COLORS[sevKey] || SEVERITY_COLORS.medium;
  const statusInfo = STATUS_LABELS[f.status] || STATUS_LABELS.open;
  const relPath = rel(f.file, rootFolder);

  function saveAnalysis() {
    onTriage(f.id, f.status, analysisText.trim());
    setEditingAnalysis(false);
  }

  return (
    <div className={`sec-card ${sevKey} ${f.status === 'false-positive' ? 'dismissed' : ''}`}>
      <div className="sec-card-header">
        <div className="sec-tags">
          <span
            className="sec-badge-sev"
            style={{ background: sevStyle.bg, borderColor: sevStyle.border, color: sevStyle.text }}
          >
            {sevStyle.label}
          </span>
          <span className="sec-tag rule">{f.rule}</span>
          {f.cwe && <span className="sec-tag cwe">{f.cwe}</span>}
          {f.confidence && (
            <span className="sec-tag confidence" title="Scanner confidence">
              {f.confidence}
            </span>
          )}
          <span
            className="sec-badge-status"
            style={{ color: statusInfo.color, background: statusInfo.bg }}
          >
            {statusInfo.label}
          </span>
          {f.analysis && f.analysis.includes('[Verification verdict:') && (
            <span
              className="sec-tag verification-badge"
              style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', borderColor: 'rgba(59, 130, 246, 0.4)' }}
              title="Analyzed by deterministic taint reachability engine"
            >
              {f.analysis.includes('HEURISTIC SIGNAL') ? '\u26A1 Heuristic Signal' : '\u2713 Verified'}
            </span>
          )}
        </div>

        <div className="sec-header-actions">
          <button
            className="sec-jump-btn"
            title="Open in editor at line"
            onClick={() => onJump(f.file, f.line)}
          >
            <span className="sec-jump-path">{relPath || f.file}:{f.line}</span>
            <span className="sec-jump-icon">{'\u2197'}</span>
          </button>
        </div>
      </div>

      <div className="sec-card-body">
        <h3 className="sec-card-title">{f.title}</h3>
        {f.message && <p className="sec-card-msg">{f.message}</p>}

        {f.snippet && (
          <div className="sec-snippet-wrapper">
            <div className="sec-snippet-header">
              <span>Line {f.line}</span>
            </div>
            <pre className="sec-snippet">
              <code>{f.snippet}</code>
            </pre>
          </div>
        )}

        {f.analysis && !editingAnalysis && (
          <div className="sec-analysis-box">
            <div className="sec-analysis-head">
              <span className="sec-analysis-label">{'\u{1F916}'} Agent Analysis</span>
              <button className="btn-link small" onClick={() => setEditingAnalysis(true)}>Edit</button>
            </div>
            <p className="sec-analysis-text">{f.analysis}</p>
          </div>
        )}

        {editingAnalysis && (
          <div className="sec-analysis-edit">
            <textarea
              className="input sec-textarea"
              rows={3}
              value={analysisText}
              placeholder="Add triage notes or verification analysis..."
              onChange={(e) => setAnalysisText(e.target.value)}
            />
            <div className="sec-edit-btns">
              <button className="btn small primary" onClick={saveAnalysis}>Save Note</button>
              <button className="btn small" onClick={() => setEditingAnalysis(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="sec-card-footer">
        <div className="sec-triage-group">
          <span className="sec-triage-label">Triage:</span>
          <select
            className="select small sec-status-select"
            value={f.status}
            onChange={(e) => onTriage(f.id, e.target.value)}
          >
            <option value="open">Open</option>
            <option value="confirmed">Confirmed</option>
            <option value="false-positive">False Positive</option>
            <option value="fixed">Fixed</option>
            <option value="wont-fix">Won't Fix</option>
          </select>

          {f.status !== 'confirmed' && (
            <button
              className="btn small sec-btn-confirm"
              title="Mark as confirmed real vulnerability"
              onClick={() => onTriage(f.id, 'confirmed')}
            >
              {'\u2713'} Confirm
            </button>
          )}

          {f.status !== 'false-positive' && (
            <button
              className="btn small sec-btn-fp"
              title="Mark as false positive"
              onClick={() => onTriage(f.id, 'false-positive')}
            >
              {'\u2717'} False Positive
            </button>
          )}

          {!f.analysis && !editingAnalysis && (
            <button
              className="btn small sec-btn-note"
              title="Add analysis note"
              onClick={() => setEditingAnalysis(true)}
            >
              + Note
            </button>
          )}
        </div>

        <div className="sec-action-btns">
          <button
            className="btn small sec-btn-verify"
            title="Verify vulnerability source and reachability with Agent"
            onClick={() => onVerify(f)}
          >
            {'\u{1F50E}'} Verify
          </button>
          <button
            className="btn small primary sec-btn-fix"
            title="Ask Nova Agent to fix this vulnerability"
            onClick={() => onFix(f)}
          >
            {'\u2728'} Fix with Agent
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SecurityPage() {
  const security = useStore((s) => s.security);
  const rootFolder = useStore((s) => s.rootFolder);
  const openFile = useStore((s) => s.openFile);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    useStore.getState().loadSecurityFindings();
  }, [rootFolder]);

  const findings = security.findings || [];
  const counts = security.counts || { critical: 0, high: 0, medium: 0, low: 0 };
  const scanning = !!security.scanning;
  const loading = !!security.loading;

  const filteredFindings = useMemo(() => {
    let list = findings;
    if (filterStatus !== 'all') {
      list = list.filter((f) => f.status === filterStatus);
    }
    if (filterSeverity !== 'all') {
      list = list.filter((f) => (f.severityAdjusted || f.severity) === filterSeverity);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          f.rule.toLowerCase().includes(q) ||
          (f.cwe && f.cwe.toLowerCase().includes(q)) ||
          f.file.toLowerCase().includes(q) ||
          (f.message && f.message.toLowerCase().includes(q)) ||
          (f.snippet && f.snippet.toLowerCase().includes(q))
      );
    }
    return list;
  }, [findings, filterStatus, filterSeverity, searchQuery]);

  const openCount = findings.filter((f) => f.status !== 'false-positive' && f.status !== 'fixed').length;
  const dismissedCount = findings.filter((f) => f.status === 'false-positive').length;
  const fixedCount = findings.filter((f) => f.status === 'fixed').length;

  return (
    <div className="page-main sec-page">
      <div className="page-header wide sec-page-header">
        <div className="sec-title-area">
          <div className="sec-title-row">
            <span className="sec-header-icon">{'\u{1F6E1}\uFE0F'}</span>
            <h1>Security</h1>
          </div>
          <p className="muted">
            Deterministic vulnerability scanner & agent triage memory. Audit vulnerabilities, hardcoded secrets, and unsafe sinks.
          </p>
        </div>

        <div className="sec-toolbar-actions">
          <button
            className={`btn small primary sec-scan-btn ${scanning ? 'running' : ''}`}
            disabled={scanning || !rootFolder}
            onClick={() => useStore.getState().scanSecurity()}
          >
            {scanning ? (
              <>
                <span className="sec-spinner" /> Scanning...
              </>
            ) : (
              <>{'\u26A1'} Scan Workspace</>
            )}
          </button>

          <button
            className="btn small sec-export-btn"
            disabled={!findings.length}
            onClick={() => useStore.getState().verifyAllSecurityFindings()}
            title="Run autonomous reachability & taint analysis across all open findings"
          >
            {'\u{1F50E}'} Verify All
          </button>

          <button
            className="btn small sec-export-btn"
            disabled={!findings.length}
            onClick={() => useStore.getState().exportSecurityReport('sarif')}
            title="Export standard SARIF 2.1.0 for GitHub code scanning and CI gates"
          >
            Export SARIF
          </button>

          <button
            className="btn small sec-export-btn"
            disabled={!findings.length}
            onClick={() => useStore.getState().exportSecurityReport('markdown')}
            title="Export Markdown audit report"
          >
            Export MD
          </button>

          {findings.length > 0 && (
            <button
              className="btn small danger"
              onClick={() => {
                if (window.confirm('Clear all security findings for this workspace?')) {
                  useStore.getState().clearSecurityFindings();
                }
              }}
              title="Clear stored findings"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="sec-kpis">
        <div
          className={`sec-kpi total ${filterStatus === 'all' && filterSeverity === 'all' ? 'active' : ''}`}
          onClick={() => {
            setFilterStatus('all');
            setFilterSeverity('all');
          }}
          title="Click to show all findings"
        >
          <div className="sec-kpi-val">{findings.length}</div>
          <div className="sec-kpi-lbl">Total Findings</div>
          <div className="sec-kpi-sub">{openCount} active · {fixedCount} fixed</div>
        </div>

        <div
          className={`sec-kpi critical ${filterSeverity === 'critical' ? 'active' : ''}`}
          onClick={() => setFilterSeverity(filterSeverity === 'critical' ? 'all' : 'critical')}
          title="Filter by Critical severity"
        >
          <div className="sec-kpi-val critical-val">{counts.critical}</div>
          <div className="sec-kpi-lbl">Critical</div>
          <div className="sec-kpi-sub">Remote Code Exec, Hardcoded Secrets</div>
        </div>

        <div
          className={`sec-kpi high ${filterSeverity === 'high' ? 'active' : ''}`}
          onClick={() => setFilterSeverity(filterSeverity === 'high' ? 'all' : 'high')}
          title="Filter by High severity"
        >
          <div className="sec-kpi-val high-val">{counts.high}</div>
          <div className="sec-kpi-lbl">High</div>
          <div className="sec-kpi-sub">SQLi, Insecure Deserialization, SSRF</div>
        </div>

        <div
          className={`sec-kpi medium ${filterSeverity === 'medium' ? 'active' : ''}`}
          onClick={() => setFilterSeverity(filterSeverity === 'medium' ? 'all' : 'medium')}
          title="Filter by Medium severity"
        >
          <div className="sec-kpi-val medium-val">{counts.medium}</div>
          <div className="sec-kpi-lbl">Medium</div>
          <div className="sec-kpi-sub">Weak Crypto, Path Traversal, Eval</div>
        </div>

        <div
          className={`sec-kpi low ${filterSeverity === 'low' ? 'active' : ''}`}
          onClick={() => setFilterSeverity(filterSeverity === 'low' ? 'all' : 'low')}
          title="Filter by Low severity"
        >
          <div className="sec-kpi-val low-val">{counts.low}</div>
          <div className="sec-kpi-lbl">Low</div>
          <div className="sec-kpi-sub">Debug Modes, Informational</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="sec-filter-bar">
        <div className="sec-search-wrap">
          <input
            className="input sec-search-input"
            type="text"
            placeholder="Filter findings by rule, message, file, or CWE..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="sec-search-clear" onClick={() => setSearchQuery('')}>
              {'\u2715'}
            </button>
          )}
        </div>

        <div className="sec-filter-tabs">
          <button
            className={`sec-tab-btn ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            All ({findings.length})
          </button>
          <button
            className={`sec-tab-btn ${filterStatus === 'open' ? 'active' : ''}`}
            onClick={() => setFilterStatus('open')}
          >
            Open ({findings.filter((f) => f.status === 'open').length})
          </button>
          <button
            className={`sec-tab-btn ${filterStatus === 'confirmed' ? 'active' : ''}`}
            onClick={() => setFilterStatus('confirmed')}
          >
            Confirmed ({findings.filter((f) => f.status === 'confirmed').length})
          </button>
          <button
            className={`sec-tab-btn ${filterStatus === 'false-positive' ? 'active' : ''}`}
            onClick={() => setFilterStatus('false-positive')}
          >
            False Positives ({dismissedCount})
          </button>
          <button
            className={`sec-tab-btn ${filterStatus === 'fixed' ? 'active' : ''}`}
            onClick={() => setFilterStatus('fixed')}
          >
            Fixed ({fixedCount})
          </button>
        </div>

        <div className="sec-filter-select-wrap">
          <select
            className="select small"
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Findings Content */}
      <div className="sec-content">
        {!rootFolder && (
          <div className="sec-empty-state card">
            <span className="sec-empty-icon">{'\u{1F4C1}'}</span>
            <h3>No Workspace Open</h3>
            <p className="muted">Open a folder to scan for security vulnerabilities and secrets.</p>
          </div>
        )}

        {rootFolder && !findings.length && !scanning && !loading && (
          <div className="sec-empty-state card">
            <span className="sec-empty-icon">{'\u{1F6E1}\uFE0F'}</span>
            <h3>No Security Findings Yet</h3>
            <p className="muted">
              Click &quot;Scan Workspace&quot; above to run deterministic scanners across all project files.
            </p>
            <button
              className="btn primary"
              style={{ marginTop: 12 }}
              onClick={() => useStore.getState().scanSecurity()}
            >
              {'\u26A1'} Scan Workspace Now
            </button>
          </div>
        )}

        {rootFolder && findings.length > 0 && filteredFindings.length === 0 && (
          <div className="sec-empty-state card">
            <span className="sec-empty-icon">{'\u{1F50D}'}</span>
            <h3>No Findings Match Filters</h3>
            <p className="muted">Try adjusting your severity, status, or search query filter.</p>
            <button
              className="btn small"
              style={{ marginTop: 10 }}
              onClick={() => {
                setFilterStatus('all');
                setFilterSeverity('all');
                setSearchQuery('');
              }}
            >
              Reset Filters
            </button>
          </div>
        )}

        {filteredFindings.map((f) => (
          <FindingCard
            key={f.id}
            f={f}
            rootFolder={rootFolder}
            onJump={(file, line) => openFile(file, line)}
            onTriage={(id, status, analysis) => useStore.getState().triageSecurityFinding(id, status, analysis)}
            onFix={(finding) => useStore.getState().fixFindingWithAgent(finding)}
            onVerify={(finding) => useStore.getState().verifySecurityFinding(finding.id)}
          />
        ))}
      </div>
    </div>
  );
}
