// Smart heuristic completions when offline or before LLM responds
export function getHeuristicCompletion(textBefore) {
  const trimmed = textBefore.trim();
  if (!trimmed) return null;

  // React & JS common idioms
  if (trimmed === 'const [' || trimmed.endsWith(' const [') || trimmed.endsWith('\tconst [')) {
    return 'state, setState] = useState(null);';
  }
  if (trimmed === 'useEffect(() => {' || trimmed.endsWith(' useEffect(() => {')) {
    return '\n  return () => {};\n}, []);';
  }
  if (trimmed === 'useCallback(() => {' || trimmed.endsWith(' useCallback(() => {')) {
    return '\n}, []);';
  }
  if (trimmed === 'console.') return 'log()';
  if (trimmed === 'console.l') return 'og()';
  if (trimmed === 'console.e') return 'rror()';
  if (trimmed === 'try {') return '\n} catch (err) {\n  console.error(err);\n}';
  if (trimmed === 'if (') return 'condition) {\n  \n}';
  if (trimmed === 'export default function') {
    return ' Component() {\n  return (\n    <div>\n    </div>\n  );\n}';
  }
  if (trimmed === 'export const') return ' handler = async (req, res) => {\n  \n};';
  if (trimmed.endsWith('() => {') && !textBefore.includes('}')) return '\n  \n};';

  // Pair closing
  if (trimmed.endsWith('{') && !textBefore.includes('}')) return '\n  \n}';
  if (trimmed.endsWith('(') && !textBefore.includes(')')) return ')';
  if (trimmed.endsWith('[') && !textBefore.includes(']')) return ']';

  return null;
}
