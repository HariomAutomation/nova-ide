/**
 * Penpot — a design authoring provider.
 *
 * This is the first time Nova can WRITE a design file rather than only describe
 * one. Figma cannot be targeted at all (proprietary .fig, no way to author it);
 * Penpot's format is open (a ZIP of JSON) and Penpot publishes @penpot/library to
 * build files in memory and export them. That difference is the whole reason this
 * file exists.
 *
 * Verified before building, rather than assumed:
 *   - @penpot/library loads from CommonJS via require() on Node 20 (require(esm))
 *   - the context really has addFile/addPage/addBoard/addRect/addText/addCircle/
 *     addPath/addGroup
 *   - exportAsBytes produces a ZIP whose layout matches the documented .penpot v3
 *     spec (manifest.json + files/{id}/pages/{id}/{shape-id}.json)
 *
 * What this does NOT do: make anyone a designer. It produces structure — boards,
 * boxes, text, circles — with real coordinates. Craft is still the human's.
 *
 * The library has no type definitions, so it is loaded as `any` deliberately.
 */

const fs = require('node:fs/promises');
const path = require('node:path');

type Element =
  | { kind: 'rect'; name?: string; x: number; y: number; width: number; height: number; fill?: string; radius?: number }
  | { kind: 'circle'; name?: string; x: number; y: number; width: number; height: number; fill?: string }
  | { kind: 'text'; name?: string; x: number; y: number; width: number; height: number; content: string };

interface Board {
  name: string;
  width: number;
  height: number;
  elements?: Element[];
}

interface DesignInput {
  name?: string;
  pageName?: string;
  outPath?: string;
  boards: Board[];
}

const ELEMENT_KINDS = ['rect', 'circle', 'text'];

/** Validate before touching the library, so a bad design fails with a clear reason. */
export function validateDesign(input: any): { ok: boolean; error?: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'design must be an object' };
  if (!Array.isArray(input.boards) || !input.boards.length) {
    return { ok: false, error: 'design needs a non-empty `boards` array' };
  }
  for (let i = 0; i < input.boards.length; i++) {
    const b = input.boards[i];
    if (!b || typeof b !== 'object') return { ok: false, error: `board ${i} is not an object` };
    if (!b.name) return { ok: false, error: `board ${i} needs a name` };
    for (const dim of ['width', 'height']) {
      if (typeof b[dim] !== 'number' || !(b[dim] > 0)) return { ok: false, error: `board "${b.name}" needs a positive ${dim}` };
    }
    if (b.elements === undefined) continue;
    if (!Array.isArray(b.elements)) return { ok: false, error: `board "${b.name}" elements must be an array` };
    for (let j = 0; j < b.elements.length; j++) {
      const e = b.elements[j];
      if (!e || typeof e !== 'object') return { ok: false, error: `board "${b.name}" element ${j} is not an object` };
      if (!ELEMENT_KINDS.includes(e.kind)) {
        return { ok: false, error: `board "${b.name}" element ${j}: kind must be one of ${ELEMENT_KINDS.join(', ')} (got ${JSON.stringify(e.kind)})` };
      }
      for (const k of ['x', 'y', 'width', 'height']) {
        if (typeof e[k] !== 'number') return { ok: false, error: `board "${b.name}" element ${j} needs a numeric ${k}` };
      }
      if (e.kind === 'text' && typeof e.content !== 'string') {
        return { ok: false, error: `board "${b.name}" element ${j}: a text element needs \`content\`` };
      }
    }
  }
  return { ok: true };
}

/**
 * Build a .penpot file from a plain design description and write it to disk.
 *
 * Coordinates are absolute within each board, which is how a screen design is
 * naturally described ("a 1440x72 navbar at the top, a 700-wide heading at y=180").
 */
export async function createDesign(
  workspace: string,
  input: DesignInput
): Promise<{ ok: boolean; error?: string; path?: string; bytes?: number; boards?: number; elements?: number }> {
  const v = validateDesign(input);
  if (!v.ok) return { ok: false, error: v.error };

  let penpot: any;
  try {
    penpot = require('@penpot/library');
  } catch (e: any) {
    return { ok: false, error: `@penpot/library is not installed: ${(e && e.message) || e}` };
  }

  const ws = path.resolve(workspace || process.cwd());
  const outPath = input.outPath || path.join(ws, 'design', `${slug(input.name || 'design')}.penpot`);

  let elements = 0;
  try {
    const ctx = penpot.createBuildContext();
    ctx.addFile({ name: input.name || 'Nova Design' });
    ctx.addPage({ name: input.pageName || 'Design' });

    for (const b of input.boards) {
      ctx.addBoard({ name: b.name, x: 0, y: 0, width: b.width, height: b.height });
      for (const e of b.elements || []) {
        const base = { name: e.name || e.kind, x: e.x, y: e.y, width: e.width, height: e.height };
        if (e.kind === 'rect') {
          ctx.addRect({ ...base, ...(e.fill ? { fills: [{ fillColor: e.fill, fillOpacity: 1 }] } : {}), ...(e.radius ? { r1: e.radius, r2: e.radius, r3: e.radius, r4: e.radius } : {}) });
        } else if (e.kind === 'circle') {
          ctx.addCircle({ ...base, ...(e.fill ? { fills: [{ fillColor: e.fill, fillOpacity: 1 }] } : {}) });
        } else {
          ctx.addText({ ...base, content: e.content });
        }
        elements += 1;
      }
      ctx.closeBoard();
    }
    ctx.closeFile();

    const bytes = await penpot.exportAsBytes(ctx);
    const buf = Buffer.from(bytes);
    if (!buf.length) return { ok: false, error: 'the library produced an empty file' };
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, buf);
    return { ok: true, path: outPath, bytes: buf.length, boards: input.boards.length, elements };
  } catch (e: any) {
    return { ok: false, error: `could not build the design: ${(e && e.message) || e}` };
  }
}

function slug(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'design';
}

module.exports = { createDesign, validateDesign };
