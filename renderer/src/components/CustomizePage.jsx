import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { timeAgo } from '../timeAgo';

const FILTERS = ['All', 'Addons', 'Skills', 'MCPs', 'Plugins', 'Rules', 'Commands', 'Hooks'];

function Section({ title, count, action, children }) {
  return (
    <div className="cz-section">
      <div className="cz-section-head">
        <span className="cz-section-title">
          {title} {count != null && <span className="muted">{count}</span>}
        </span>
        <div className="spacer" />
        {action}
      </div>
      {children}
    </div>
  );
}

export default function CustomizePage() {
  const skills = useStore((s) => s.skills);
  const mcpInfo = useStore((s) => s.mcpInfo);
  const addons = useStore((s) => s.addons);
  const appInfo = useStore((s) => s.appInfo);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [showNew, setShowNew] = useState(false);
  const [addonUrls, setAddonUrls] = useState({});
  const [newName, setNewName] = useState('');

  useEffect(() => {
    useStore.getState().loadSkills();
    useStore.getState().loadMcpStatus();
    useStore.getState().loadAddons();
  }, []);

  const q = query.trim().toLowerCase();
  const skillList = useMemo(
    () =>
      (skills || []).filter(
        (sk) => !q || sk.name.toLowerCase().includes(q) || (sk.description || '').toLowerCase().includes(q)
      ),
    [skills, q]
  );
  const servers = useMemo(
    () => (mcpInfo && mcpInfo.servers ? mcpInfo.servers.filter((sv) => !q || sv.name.toLowerCase().includes(q)) : []),
    [mcpInfo, q]
  );
  const allTools = servers.reduce((n, sv) => n + (sv.tools ? sv.tools.length : 0), 0);

  async function createSkill() {
    const name = newName.trim();
    if (!name) return;
    const sk = await useStore.getState().newSkill(name);
    setNewName('');
    setShowNew(false);
    if (sk) {
      useStore.getState().setStatus(`Skill "${sk.name}" created — opening SKILL.md`);
      useStore.getState().openFile(sk.path);
    }
  }

  const skillsDir = appInfo && appInfo.home ? `${appInfo.home}/.nova-ide/skills` : null;

  return (
    <div className="page-main">
      <div className="cz-top">
        <div className="cz-search">
          <span className="cz-search-ico">{'\u{1F50D}'}</span>
          <input
            className="cz-search-input"
            placeholder="Search Skills, MCPs, Plugins, Rules…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className="btn dark"
          onClick={() => {
            if (skillsDir) window.nova.openPath(skillsDir);
            useStore.getState().setStatus('Marketplace is coming soon — your skills folder was opened.');
          }}
        >
          Browse Marketplace
        </button>
      </div>

      <div className="cz-filters">
        {FILTERS.map((fl) => (
          <button
            key={fl}
            className={'cz-pill' + ((fl === 'All' ? filter === 'All' : filter === fl) ? ' active' : '')}
            onClick={() => setFilter(fl === 'All' ? 'All' : fl)}
          >
            {fl === 'All' ? `\u2295 All` : fl}
          </button>
        ))}
      </div>

      {(filter === 'All' || filter === 'Addons') && (
        <Section title="Featured Addons" count={addons && addons.addons ? addons.addons.length : undefined}>
          {!addons && <div className="cz-empty muted small">Loading addons…</div>}
          {addons && addons.error && <div className="cz-empty muted small">Could not load addons: {addons.error}</div>}
          {addons &&
            addons.addons &&
            addons.addons.map((a) => (
              <div key={a.id} className="cz-row">
                <span
                  className={
                    'cz-dot ' + (a.enabled && a.state === 'running' ? 'ok' : a.enabled && a.state === 'error' ? 'err' : '')
                  }
                />
                <div className="cz-row-main">
                  <div className="cz-row-title">
                    {a.name}{' '}
                    <span className="muted small">
                      {!a.enabled
                        ? 'disabled'
                        : a.state === 'running'
                          ? `${a.toolCount} tools${a.bridge ? ' \u00B7 bridge mode (token saver)' : ''}`
                          : a.state}
                    </span>
                  </div>
                  <div className="cz-row-desc muted">{a.error || a.description}</div>
                  {a.needsUrl && (
                    <input
                      className="input cz-row-url"
                      placeholder={a.defaultUrl || "MCP server URL"}
                      value={addonUrls[a.id] !== undefined ? addonUrls[a.id] : a.url || a.defaultUrl || ""}
                      onChange={(e) => setAddonUrls((m) => ({ ...m, [a.id]: e.target.value }))}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </div>
                <a
                  className="cz-row-time muted small"
                  href={a.site}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.nova.openExternal(a.site);
                  }}
                >
                  GitHub
                </a>
                <button
                  className={'switch' + (a.enabled ? ' on' : '')}
                  role="switch"
                  aria-checked={!!a.enabled}
                  title={a.enabled ? 'Disable addon' : 'Enable addon'}
                  onClick={(e) => {
                    e.stopPropagation();
                    useStore.getState().toggleAddon(a.id, !a.enabled, addonUrls[a.id]);
                  }}
                >
                  <span className="knob" />
                </button>
              </div>
            ))}
          <div className="cz-foot muted small">
            Addons are MCP servers Nova manages for you. <b>REA</b> gives the agent reverse-engineering tools (Ghidra,
            Frida, decompile, memory) and <b>LeanToken</b> keeps repo exploration token-bounded so you spend fewer
            tokens. Toggling writes to {addons?.configPath || '~/.nova-ide/mcp.json'} — new agent turns pick it up.
          </div>
        </Section>
      )}

      {(filter === 'All' || filter === 'Skills') && (
        <Section
          title="Your Skills"
          count={skillList.length}
          action={
            <button className="btn small" onClick={() => setShowNew((v) => !v)}>
              {showNew ? 'Cancel' : '+ New'}
            </button>
          }
        >
          {showNew && (
            <div className="cz-new-row">
              <input
                className="input"
                placeholder="skill-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createSkill()}
              />
              <button className="btn primary small" onClick={createSkill} disabled={!newName.trim()}>
                Create
              </button>
            </div>
          )}
          {skillList.length === 0 && !showNew && (
            <div className="cz-empty muted small">
              No skills yet. A skill is a folder with a SKILL.md that teaches the agent a workflow. The agent reads its
              name and description and loads the full instructions when a task matches.
            </div>
          )}
          {skillList.map((sk) => (
            <div key={sk.id} className="cz-row" onClick={() => useStore.getState().openFile(sk.path)}>
              <span className="cz-row-ico">{'\u{1F9E9}'}</span>
              <div className="cz-row-main">
                <div className="cz-row-title">{sk.name}</div>
                <div className="cz-row-desc muted">{sk.description || 'No description yet.'}</div>
              </div>
              <span className="cz-row-time muted small">{timeAgo(sk.updatedAt)}</span>
              <button
                className="btn-icon"
                title="Open SKILL.md"
                onClick={(e) => {
                  e.stopPropagation();
                  useStore.getState().openFile(sk.path);
                }}
              >
                {'\u22EF'}
              </button>
            </div>
          ))}
        </Section>
      )}

      {(filter === 'All' || filter === 'MCPs') && (
        <Section
          title="MCP Servers"
          count={servers.length}
          action={
            <button className="btn small" onClick={() => useStore.getState().reloadMcp()}>
              Reload
            </button>
          }
        >
          {(mcpInfo && mcpInfo.hasConfig) === false && (
            <div className="cz-empty muted small">
              No MCP config yet. Create <code>{mcpInfo?.configPath || '~/.nova-ide/mcp.json'}</code> to connect
              external tool servers (Cursor has this in paid tiers — Nova includes it for free).
            </div>
          )}
          {mcpInfo && mcpInfo.hasConfig && servers.length === 0 && (
            <div className="cz-empty muted small">No servers configured yet.</div>
          )}
          {servers.map((sv) => (
            <div key={sv.name} className="cz-row">
              <span className={'cz-dot ' + (sv.state === 'running' ? 'ok' : sv.state === 'error' ? 'err' : '')} />
              <div className="cz-row-main">
                <div className="cz-row-title">
                  {sv.name}{' '}
                  <span className="muted small">
                    {sv.state === 'running'
                      ? `${sv.tools ? sv.tools.length : 0} tools`
                      : sv.state === 'error'
                        ? 'error'
                        : sv.state}
                  </span>
                </div>
                <div className="cz-row-desc muted">
                  {sv.error
                    ? sv.error
                    : sv.tools && sv.tools.length
                      ? sv.tools.map((t) => t.name).slice(0, 6).join(', ') + (sv.tools.length > 6 ? '…' : '')
                      : sv.serverInfo
                        ? `${sv.serverInfo.name || ''} ${sv.serverInfo.version || ''}`.trim()
                        : 'Connected'}
                </div>
              </div>
            </div>
          ))}
          {allTools > 0 && (
            <div className="cz-foot muted small">
              {allTools} MCP tool{allTools === 1 ? '' : 's'} available to the agent (approval: Settings → Agents).
            </div>
          )}
        </Section>
      )}

      {filter === 'Rules' && (
        <Section title="Rules">
          <div className="cz-empty muted small">
            Project rules live in the workspace: add a <code>NOVA.md</code> file or a <code>.nova/rules/*.md</code>{' '}
            folder. Nova loads them into the agent's system prompt automatically.
          </div>
        </Section>
      )}

      {(filter === 'Plugins' || filter === 'Commands' || filter === 'Hooks') && (
        <Section title={filter}>
          <div className="cz-empty muted small">
            {filter} are coming soon in Nova. Skills and MCP servers already work today.
          </div>
        </Section>
      )}

      <div className="cz-foot muted small">
        Skills folder: {skillsDir || '~/.nova-ide/skills'} {'\u00B7'} MCP config: {mcpInfo?.configPath || '~/.nova-ide/mcp.json'}
      </div>
    </div>
  );
}
