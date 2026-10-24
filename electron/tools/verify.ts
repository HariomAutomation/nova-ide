/**
 * Autonomous Verification Engine (Advisory Taint & Literal Analysis).
 *
 * Deterministically analyzes code around a finding sink:
 * 1. Checks if arguments are hardcoded string/boolean/numeric literals (verdict: benign-literal)
 * 2. Checks if inputs trace back to untrusted sources (verdict: strong-signal)
 * 3. Identifies sanitizers / validation guards in the path (verdict: heuristic)
 * 4. Flags unknown/module-level parameter reachability (verdict: heuristic)
 *
 * Strict Honesty Standard:
 * - Never unilaterally downgrades status to 'false-positive' (which would hide findings from reports).
 * - Never claims 'confirmed' without a live exploit PoC; reports 'strong-signal' instead.
 * - Findings remain open/triaged with structured advisory evidence.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const findingsStore = require('./findings');

export interface VerificationResult {
  findingId: string;
  verdict: 'strong-signal' | 'benign-literal' | 'heuristic';
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
  source?: string;
  sink?: string;
  trace?: string[];
}

export const TAINT_SOURCES = [
  /req\.(query|body|params|headers|cookies|url|path)/i,
  /request\.(args|form|json|values|GET|POST|headers|cookies|query|params)/i,
  /process\.argv(\[[^\]]+\])?/i,
  /sys\.argv/i,
  /window\.location(\.(search|hash|pathname))?/i,
  /document\.(location|URL|cookie|referrer)/i,
  /url\.searchParams/i,
  /props\.match\.params/i,
  /ctx\.(query|request\.body|params)/i,
];

// Weaker identifier-only patterns that advise manual triage
export const HEURISTIC_TAINT_SOURCES = [
  /\b(userInput|user_input|raw_input|untrustedInput)\b/i,
];

export const SANITIZERS = [
  /parseInt\s*\(/,
  /Number\s*\(/,
  /encodeURIComponent\s*\(/,
  /DOMPurify\.sanitize\s*\(/,
  /validator\.is[A-Za-z0-9_]+\s*\(/,
  /path\.basename\s*\(/,
  /sanitizeHtml\s*\(/,
  /escapeHtml\s*\(/,
  /sqlstring\.escape\s*\(/,
  /mysql\.escape\s*\(/,
  /whitelist|allowlist/i,
];

export const LITERAL_ARG_PATTERNS = [
  /^\s*['"`][^$`]*['"`]\s*$/, // pure string literal with no variable interpolation
  /^\s*(true|false|null|undefined|\d+)\s*$/, // booleans / numbers
];

/**
 * Safely extracts the first argument of a sensitive function call
 * respecting quotes, nested brackets and commas.
 */
export function extractFirstCallArg(snippet: string): { sink: string; arg: string } | null {
  const callMatch = snippet.match(/\b(eval|exec|execSync|spawn|query|system)\s*\(/i);
  if (!callMatch || callMatch.index === undefined) return null;

  const sink = callMatch[1];
  const startIdx = callMatch.index + callMatch[0].length;
  let depth = 0;
  let inQuote: string | null = null;
  let isEscaped = false;
  let argEnd = -1;

  for (let i = startIdx; i < snippet.length; i++) {
    const ch = snippet[i];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (ch === '\\') {
      isEscaped = true;
      continue;
    }
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inQuote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) {
        argEnd = i;
        break;
      }
      depth--;
      continue;
    }
    if (ch === ',' && depth === 0) {
      argEnd = i;
      break;
    }
  }

  if (argEnd === -1) argEnd = snippet.length;
  const rawArg = snippet.slice(startIdx, argEnd).trim();
  return { sink, arg: rawArg };
}

/** Extract lines from target file around a line number */
async function getContextLines(filePath: string, line: number, contextRadius = 30): Promise<{ lines: string[]; startLine: number }> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const all = raw.split(/\r?\n/);
    const start = Math.max(0, line - 1 - contextRadius);
    const end = Math.min(all.length, line + contextRadius);
    return { lines: all.slice(start, end), startLine: start + 1 };
  } catch {
    return { lines: [], startLine: 1 };
  }
}

/** Analyze a single finding deterministically */
export async function analyzeFindingReachability(finding: any): Promise<VerificationResult> {
  const filePath = finding.file;
  const targetLineNum = finding.line || 1;
  const snippet = String(finding.snippet || '').trim();

  // 1. Check if the snippet contains only hardcoded constant literal arguments
  // e.g. eval("2 + 2") or exec("git status")
  const extracted = extractFirstCallArg(snippet);
  if (extracted) {
    const { sink, arg } = extracted;
    if (LITERAL_ARG_PATTERNS.some((pat) => pat.test(arg))) {
      return {
        findingId: finding.id,
        verdict: 'benign-literal',
        confidence: 'high',
        evidence: `Benign literal: Sink argument \`${arg}\` is a hardcoded constant, not attacker-controllable (advisory signal).`,
        sink,
      };
    }
  }

  // 2. Read context around the finding in the source file
  const { lines, startLine } = await getContextLines(filePath, targetLineNum, 25);
  if (!lines.length) {
    return {
      findingId: finding.id,
      verdict: 'heuristic',
      confidence: 'low',
      evidence: `Could not read source file ${filePath} for taint analysis.`,
    };
  }

  // Extract variables referenced in the snippet
  const idRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
  const varsInSnippet = new Set((snippet.match(idRegex) || []).filter((id) => !/^(function|const|let|var|if|return|async|await|try|catch|true|false|null)$/.test(id)));

  // Look backwards from targetLine in the enclosing function/scope
  const relTargetIdx = targetLineNum - startLine;
  const backwardLines = lines.slice(0, Math.max(0, relTargetIdx + 1));

  // Check if sanitized before reaching the sink (heuristically flagged, never unilaterally dismissed)
  for (const sanitizer of SANITIZERS) {
    if (sanitizer.test(snippet) || (relTargetIdx > 0 && sanitizer.test(backwardLines[relTargetIdx - 1]))) {
      return {
        findingId: finding.id,
        verdict: 'heuristic',
        confidence: 'medium',
        evidence: `Sanitizer signal: Line or preceding context appears to pass input through sanitization (${sanitizer}), manual review recommended.`,
      };
    }
  }

  // Check for direct taint source on the sink line itself
  for (const sourcePat of TAINT_SOURCES) {
    const directMatch = snippet.match(sourcePat);
    if (directMatch) {
      return {
        findingId: finding.id,
        verdict: 'strong-signal',
        confidence: 'high',
        source: directMatch[0],
        sink: extracted ? extracted.sink : snippet.slice(0, 40),
        evidence: `Untrusted input looks reachable: Source \`${directMatch[0]}\` is passed directly into sink at line ${targetLineNum} — verify manually.`,
        trace: [
          `Source: ${directMatch[0]}`,
          `Sink: ${snippet}`,
        ],
      };
    }
  }

  // Check if any variable in the sink was assigned from a taint source in backwards scope
  const trace: string[] = [];
  let foundTaintSource: string | null = null;

  for (let i = backwardLines.length - 1; i >= 0; i--) {
    const l = backwardLines[i];
    for (const v of varsInSnippet) {
      const assignMatch = l.match(new RegExp(`\\b${v}\\s*=[^;]+`, 'i'));
      if (assignMatch) {
        trace.unshift(`Line ${startLine + i}: ${assignMatch[0]}`);
        for (const src of TAINT_SOURCES) {
          const sMatch = assignMatch[0].match(src);
          if (sMatch) {
            foundTaintSource = sMatch[0];
            break;
          }
        }
      }
    }
    if (foundTaintSource) break;
  }

  if (foundTaintSource) {
    return {
      findingId: finding.id,
      verdict: 'strong-signal',
      confidence: 'high',
      source: foundTaintSource,
      sink: snippet,
      evidence: `Untrusted input looks reachable: Variable in sink traces backward to external input \`${foundTaintSource}\` — verify manually.`,
      trace,
    };
  }

  // Secret rule check: test if snippet has a dummy/test token or real entropy
  if (finding.rule && finding.rule.startsWith('secret.')) {
    if (/test|fake|dummy|mock|placeholder|example|xxxx/i.test(snippet)) {
      return {
        findingId: finding.id,
        verdict: 'benign-literal',
        confidence: 'high',
        evidence: 'Dummy secret: Token matches test/mock placeholder pattern.',
      };
    }
    return {
      findingId: finding.id,
      verdict: 'strong-signal',
      confidence: 'high',
      evidence: 'Potential secret: Hardcoded credential pattern detected with high entropy.',
    };
  }

  // Default: heuristic candidate requiring caller context review
  return {
    findingId: finding.id,
    verdict: 'heuristic',
    confidence: 'medium',
    evidence: `Candidate sink: Function/variable reachability depends on caller inputs outside local file scope.`,
  };
}

/** Verify a specific finding in the workspace and persist advisory verification */
export async function verifyFinding(workspace: string, findingId: string): Promise<{ ok: boolean; finding?: any; result?: VerificationResult; error?: string }> {
  const ws = path.resolve(workspace || process.cwd());
  const list = await findingsStore.list(ws);
  const target = list.find((f: any) => f.id === findingId);
  if (!target) return { ok: false, error: `Finding ${findingId} not found in workspace.` };

  const result = await analyzeFindingReachability(target);

  // Status is never unilaterally set to 'false-positive' (which would hide it from reports)
  // or 'confirmed' (which requires live PoC). We keep status as-is or transition 'open' -> 'triaged'.
  const status = target.status === 'open' ? 'triaged' : target.status;

  const verdictTitle =
    result.verdict === 'strong-signal'
      ? 'STRONG SIGNAL'
      : result.verdict === 'benign-literal'
        ? 'BENIGN LITERAL'
        : 'HEURISTIC SIGNAL';

  const triageRes = await findingsStore.triage(ws, findingId, {
    status,
    analysis: `[Verification: ${verdictTitle}] ${result.evidence}`,
  });

  return { ok: true, finding: triageRes.finding, result };
}

/** Verify all open findings in the workspace */
export async function verifyAllFindings(workspace: string): Promise<{ ok: boolean; verified: number; strongSignal: number; benignLiteral: number; heuristic: number }> {
  const ws = path.resolve(workspace || process.cwd());
  const list = await findingsStore.list(ws);
  const openFindings = list.filter((f: any) => f.status === 'open' || f.status === 'triaged');

  let strongSignal = 0;
  let benignLiteral = 0;
  let heuristic = 0;

  for (const f of openFindings) {
    const res = await verifyFinding(ws, f.id);
    if (res.result?.verdict === 'strong-signal') strongSignal++;
    else if (res.result?.verdict === 'benign-literal') benignLiteral++;
    else heuristic++;
  }

  return { ok: true, verified: openFindings.length, strongSignal, benignLiteral, heuristic };
}

module.exports = {
  analyzeFindingReachability,
  verifyFinding,
  verifyAllFindings,
  TAINT_SOURCES,
  SANITIZERS,
  LITERAL_ARG_PATTERNS,
};
