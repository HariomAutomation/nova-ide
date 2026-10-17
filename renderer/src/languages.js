const MAP = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svelte: 'html',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rb: 'ruby',
  php: 'php',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  swift: 'swift',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  conf: 'ini',
  env: 'ini',
  xml: 'xml',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  txt: 'plaintext',
  log: 'plaintext',
  gitignore: 'plaintext',
};

export function langFromPath(p) {
  if (!p) return 'plaintext';
  const name = String(p).split('/').pop().toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  return MAP[name.slice(dot + 1)] || 'plaintext';
}

const ICONS = {
  javascript: '\u{1F7E8}',
  typescript: '\u{1F535}',
  json: '{ }',
  css: '#',
  html: '<>',
  markdown: 'M\u2193',
  python: '\u{1F40D}',
  rust: '\u2699',
  go: '\u{1F439}',
  shell: '$',
  yaml: 'Y',
};

export function iconForLanguage(lang) {
  return ICONS[lang] || '\u{1F4C4}';
}
