import { useState } from 'react';

/**
 * Extracts thinking content (<think>...</think> or <thought>...</thought>)
 * from text. Handles both completed blocks and in-progress streaming blocks.
 */
export function extractThinking(text) {
  if (!text || typeof text !== 'string') return { thinking: null, body: text || '', isLive: false };

  let thinkingParts = [];
  // 1. Extract closed <think>...</think> or <thought>...</thought>
  let body = text.replace(/<(?:think|thought)>([\s\S]*?)<\/(?:think|thought)>/gi, (_, thought) => {
    if (thought && thought.trim()) thinkingParts.push(thought.trim());
    return '';
  });

  // 2. Extract unclosed <think> during live streaming
  let isLive = false;
  const openMatch = body.match(/<(?:think|thought)>([\s\S]*)$/i);
  if (openMatch) {
    isLive = true;
    if (openMatch[1] && openMatch[1].trim()) {
      thinkingParts.push(openMatch[1].trim());
    }
    body = body.slice(0, openMatch.index);
  }

  const thinking = thinkingParts.filter(Boolean).join('\n\n') || null;
  return { thinking, body: body.trim(), isLive };
}

export default function ThinkingBlock({ text, isLive = false, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  if (!text && !isLive) return null;

  return (
    <div className={`nova-think-block ${open ? 'expanded' : 'collapsed'} ${isLive ? 'live' : ''}`}>
      <button
        type="button"
        className="nova-think-header"
        onClick={() => setOpen(!open)}
        title={open ? 'Collapse thinking process' : 'Expand thinking process'}
        aria-expanded={open}
      >
        <span className="nova-think-icon">{open ? '\u25BC' : '\u25B6'}</span>
        <span className="nova-think-title">
          {isLive ? '\uD83D\uDCAD Thinking\u2026' : '\uD83D\uDCAD Thought process'}
        </span>
        {isLive && <span className="nova-think-pulse" />}
      </button>

      {open && (
        <div className="nova-think-drawer">
          <pre className="nova-think-body">{text || (isLive ? 'Reasoning in progress\u2026' : '')}</pre>
        </div>
      )}
    </div>
  );
}
