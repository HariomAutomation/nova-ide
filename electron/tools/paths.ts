'use strict';

/**
 * Path containment helpers.
 *
 * Both the agent's workspace protections (agent.js) and the `app://` static
 * handler (main.js) need to answer the same question — "is this target inside
 * that root?" — and both used to do it with a naive `String.startsWith`,
 * which treats `/root/dist` and `/root/dist-evil` as the same directory.
 *
 * `isWithin` normalises both sides and compares on path-component boundaries,
 * so a sibling directory whose name merely shares a prefix is correctly
 * rejected.
 */

const path = require('node:path');
const os = require('node:os');

/**
 * @param {string} root   absolute directory the target must live inside
 * @param {string} target file/dir path to test (absolute, or resolved from cwd)
 * @returns {boolean} true when `target` is `root` itself or a descendant
 */
function isWithin(root, target) {
  if (!root || !target || typeof root !== 'string' || typeof target !== 'string') return false;
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(target);
  if (targetAbs === rootAbs) return true;
  const rel = path.relative(rootAbs, targetAbs);
  return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}

/**
 * Single source of truth for Nova IDE's configuration root directory.
 * Respects NOVA_HOME or NOVA_CONFIG_DIR env overrides, defaulting to ~/.nova-ide.
 * @returns {string}
 */
function configRoot() {
  return process.env.NOVA_HOME || process.env.NOVA_CONFIG_DIR || path.join(os.homedir(), '.nova-ide');
}

module.exports = { isWithin, configRoot };

