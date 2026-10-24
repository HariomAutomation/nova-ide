/**
 * Findings store + report writer.
 *
 * The scanner produces candidates; the agent triages them. This module is the
 * memory between the two: findings are stored per workspace, deduplicated, given
 * a stable id, and can be re-emitted as Markdown (for a human) or SARIF (for CI
 * and GitHub code scanning).
 *
 * Storage lives under the Nova config root, so NOVA_HOME isolation keeps test
 * runs out of a developer's real profile.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { configRoot } = require('./paths');

type Severity = 'critical' | 'high' | 'medium' | 'low';
type Status = 'open' | 'triaged' | 'confirmed' | 'false-positive' | 'fixed' | 'wont-fix';

const STATUSES: Status[] = ['open', 'triaged', 'confirmed', 'false-positive', 'fixed', 'wont-fix'];

interface StoredFinding {
  id: string;
  rule: string;
  title: string;
  severity: Severity;
  cwe: string | null;
  file: string;
  line: number;
  snippet: string;
  message: string;
  confidence: string;
  status: Status;
  firstSeen: string;
  lastSeen: string;
  analysis: string | null;
  severityAdjusted: Severity | null;
  triagedAt?: string;
}

interface Store {
  workspace: string;
  updatedAt: string | null;
  findings: StoredFinding[];
}

function dirFor(_workspace: string): string {
  return path.join(configRoot(), 'findings');
}

function fileFor(workspace: string): string {
  const key = crypto.createHash('sha1').update(path.resolve(workspace || process.cwd())).digest('hex').slice(0, 16);
  return path.join(dirFor(workspace), `${key}.json`);
}

/** Stable identity: the same rule at the same place is the same finding. */
function idOf(f: any): string {
  return crypto
    .createHash('sha1')
    .update(`${f.rule}|${path.resolve(f.file || '')}|${f.line || 0}|${String(f.snippet || '').slice(0, 80)}`)
    .digest('hex')
    .slice(0, 16);
}

async function readStore(workspace: string): Promise<Store> {
  const file = fileFor(workspace);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const j = JSON.parse(raw);
    if (j && Array.isArray(j.findings)) return j;
  } catch {
    /* missing or corrupt — start clean rather than throwing */
  }
  return { workspace: path.resolve(workspace || process.cwd()), updatedAt: null, findings: [] };
}

async function writeStore(workspace: string, store: Store): Promise<Store> {
  const file = fileFor(workspace);
  await fs.mkdir(path.dirname(file), { recursive: true });
  store.workspace = path.resolve(workspace || process.cwd());
  store.updatedAt = new Date().toISOString();
  await fs.writeFile(file, JSON.stringify(store, null, 2), 'utf8');
  return store;
}

/**
 * Merge a scan into the store. Existing statuses survive, so a finding marked
 * "false-positive" stays that way when the same code is scanned again.
 */
export async function save(workspace: string, findings: any[] = []): Promise<{ added: number; seen: number; total: number }> {
  const store = await readStore(workspace);
  const byId = new Map<string, StoredFinding>(store.findings.map((f) => [f.id, f]));
  const now = new Date().toISOString();
  let added = 0;
  let seen = 0;

  for (const f of findings) {
    const id = idOf(f);
    const existing = byId.get(id);
    if (existing) {
      existing.lastSeen = now;
      if (f.severity) existing.severity = f.severity;
      seen += 1;
      continue;
    }
    byId.set(id, {
      id,
      rule: f.rule,
      title: f.title,
      severity: f.severity || 'medium',
      cwe: f.cwe || null,
      file: f.file,
      line: f.line || 1,
      snippet: f.snippet || '',
      message: f.message || '',
      confidence: f.confidence || 'medium',
      status: 'open',
      firstSeen: now,
      lastSeen: now,
      analysis: null,
      severityAdjusted: null,
    });
    added += 1;
  }

  store.findings = [...byId.values()];
  await writeStore(workspace, store);
  return { added, seen, total: store.findings.length };
}

export async function list(workspace: string, filter: { status?: string; severity?: string } = {}): Promise<StoredFinding[]> {
  const store = await readStore(workspace);
  let out = store.findings;
  if (filter.status) out = out.filter((f) => f.status === filter.status);
  if (filter.severity) out = out.filter((f) => f.severity === filter.severity);
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...out].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || a.file.localeCompare(b.file) || a.line - b.line);
}

/** Record the agent's triage verdict for a finding. */
export async function triage(
  workspace: string,
  id: string,
  patch: { status?: string; analysis?: string; severity?: string; cwe?: string } = {}
): Promise<{ ok?: boolean; error?: string; finding?: StoredFinding }> {
  const store = await readStore(workspace);
  const f = store.findings.find((x) => x.id === id);
  if (!f) return { error: `no finding with id ${id}` };
  if (patch.status) {
    if (!STATUSES.includes(patch.status as Status)) return { error: `status must be one of ${STATUSES.join(', ')}` };
    f.status = patch.status as Status;
  }
  if (patch.analysis) f.analysis = String(patch.analysis).slice(0, 4000);
  if (patch.severity) f.severityAdjusted = patch.severity as Severity;
  if (patch.cwe) f.cwe = patch.cwe;
  f.triagedAt = new Date().toISOString();
  await writeStore(workspace, store);
  return { ok: true, finding: f };
}

export async function clear(workspace: string): Promise<{ ok: boolean }> {
  await writeStore(workspace, { workspace, updatedAt: null, findings: [] });
  return { ok: true };
}

/** Severity used for reporting: the agent's adjustment wins over the raw rule. */
export function effectiveSeverity(f: any): Severity {
  return (f.severityAdjusted || f.severity || 'medium') as Severity;
}

export function counts(findings: any[]): Record<Severity, number> {
  const c: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (f.status === 'false-positive') continue;
    const s = effectiveSeverity(f);
    if (s in c) c[s] += 1;
  }
  return c;
}

/* ================================ reports ================================ */

export function toMarkdown(workspace: string, findings: any[]): string {
  const open = findings.filter((f) => f.status !== 'false-positive');
  const c = counts(findings);
  const lines: string[] = [];
  lines.push(`# Security findings — ${path.basename(path.resolve(workspace))}`);
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('|---|---|');
  lines.push(`| Critical | ${c.critical} |`);
  lines.push(`| High | ${c.high} |`);
  lines.push(`| Medium | ${c.medium} |`);
  lines.push(`| Low | ${c.low} |`);
  lines.push('');
  lines.push(`${open.length} open · ${findings.length - open.length} dismissed`);
  lines.push('');

  for (const sev of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const group = open.filter((f) => effectiveSeverity(f) === sev);
    if (!group.length) continue;
    lines.push(`## ${sev[0].toUpperCase()}${sev.slice(1)} (${group.length})`);
    lines.push('');
    for (const f of group) {
      const rel = path.relative(path.resolve(workspace), f.file) || f.file;
      lines.push(`### ${f.title}`);
      lines.push('');
      lines.push(`- **Location:** \`${rel}:${f.line}\``);
      lines.push(`- **Rule:** \`${f.rule}\`${f.cwe ? ` · ${f.cwe}` : ''} · confidence: ${f.confidence}`);
      lines.push(`- **Status:** ${f.status}`);
      if (f.snippet) {
        lines.push('');
        lines.push('```');
        lines.push(f.snippet);
        lines.push('```');
      }
      if (f.message) {
        lines.push('');
        lines.push(`**Remediation:** ${f.message}`);
      }
      if (f.analysis) {
        lines.push('');
        lines.push(`**Analysis:** ${f.analysis}`);
      }
      lines.push('');
    }
  }
  if (!open.length) {
    lines.push('No open findings.');
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push("_Findings are candidates from deterministic scanners plus the agent's triage. Verify each before acting — a scanner cannot know whether the input is attacker-controlled._");
  lines.push('');
  return lines.join('\n');
}

/** SARIF 2.1.0 — what GitHub code scanning and most CI security gates ingest. */
export function toSarif(workspace: string, findings: any[]): any {
  const open = findings.filter((f) => f.status !== 'false-positive');
  const rules = new Map<string, any>();
  for (const f of open) {
    if (!rules.has(f.rule)) {
      rules.set(f.rule, {
        id: f.rule,
        name: f.rule,
        shortDescription: { text: f.title || f.rule },
        help: { text: f.message || '' },
        properties: { cwe: f.cwe || undefined, severity: effectiveSeverity(f) },
      });
    }
  }
  const level = (s: Severity) => (s === 'critical' || s === 'high' ? 'error' : s === 'medium' ? 'warning' : 'note');
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Nova IDE Security Scan',
            informationUri: 'https://github.com/HariomAutomation/nova-ide',
            rules: [...rules.values()],
          },
        },
        results: open.map((f) => ({
          ruleId: f.rule,
          level: level(effectiveSeverity(f)),
          message: { text: `${f.title}${f.message ? ` — ${f.message}` : ''}` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: path.relative(path.resolve(workspace), f.file) || f.file },
                region: { startLine: f.line || 1, snippet: f.snippet ? { text: f.snippet } : undefined },
              },
            },
          ],
          properties: { cwe: f.cwe || undefined, confidence: f.confidence, status: f.status },
        })),
      },
    ],
  };
}

export async function report(workspace: string, opts: { format?: string } = {}): Promise<string> {
  const format = opts.format || 'markdown';
  const findings = await list(workspace);
  if (format === 'sarif') return JSON.stringify(toSarif(workspace, findings), null, 2);
  if (format === 'json') return JSON.stringify({ workspace: path.resolve(workspace), counts: counts(findings), findings }, null, 2);
  return toMarkdown(workspace, findings);
}

module.exports = { save, list, triage, clear, report, counts, effectiveSeverity, idOf, fileFor, STATUSES, toMarkdown, toSarif };
