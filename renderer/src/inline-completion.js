import * as monaco from 'monaco-editor';
import { useStore } from './store.js';
import { streamChat } from './aiClient.js';

let registered = false;
let lastRequestTime = 0;

import { getHeuristicCompletion } from './completion-heuristics.js';
export { getHeuristicCompletion };

export function registerInlineCompletion() {
  if (registered) return;
  registered = true;

  try {
    monaco.languages.registerInlineCompletionsProvider('*', {
      provideInlineCompletions: async (model, position, _context, token) => {
        const state = useStore.getState();
        if (!state.agentSettings?.agentAutocomplete) {
          return { items: [] };
        }

        const lineContent = model.getLineContent(position.lineNumber);
        const textBeforeCursor = lineContent.substring(0, position.column - 1);

        if (textBeforeCursor.trim().length === 0) {
          return { items: [] };
        }

        // 1. Instant heuristic completion
        const heuristic = getHeuristicCompletion(textBeforeCursor);
        if (heuristic && !token.isCancellationRequested) {
          return {
            items: [
              {
                insertText: heuristic,
                range: new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column
                ),
              },
            ],
          };
        }

        // 2. LLM-based inline completion if active model configured
        const activeModel = state.models?.find((m) => m.id === state.activeModelId);
        if (activeModel && activeModel.baseUrl && activeModel.baseUrl !== 'mock') {
          const now = Date.now();
          if (now - lastRequestTime < 250) {
            return { items: [] };
          }
          lastRequestTime = now;

          try {
            const fullText = model.getValue();
            const offset = model.getOffsetAt(position);
            const prefix = fullText.slice(Math.max(0, offset - 1200), offset);
            const suffix = fullText.slice(offset, Math.min(fullText.length, offset + 400));

            const prompt = `You are an inline code autocompleter. Output ONLY the short continuation to insert at <CURSOR>. Do not repeat prefix or suffix. No markdown fences. Maximum 3 lines.\n\nCode:\n${prefix}<CURSOR>${suffix}`;

            const completion = await new Promise((resolve) => {
              let result = '';
              const timeout = setTimeout(() => resolve(null), 1200);

              try {
                streamChat({
                  config: {
                    baseUrl: activeModel.baseUrl,
                    apiKey: activeModel.apiKey,
                    model: activeModel.model,
                    auth: activeModel.auth,
                  },
                  messages: [{ role: 'user', content: prompt }],
                  onDelta: (d) => {
                    result += d;
                    if (result.includes('\n\n') || result.length > 250) {
                      clearTimeout(timeout);
                      resolve(result.trimEnd());
                    }
                  },
                  onDone: () => {
                    clearTimeout(timeout);
                    resolve(result.trimEnd());
                  },
                  onError: () => {
                    clearTimeout(timeout);
                    resolve(null);
                  },
                });
              } catch {
                clearTimeout(timeout);
                resolve(null);
              }
            });

            if (completion && !token.isCancellationRequested) {
              return {
                items: [
                  {
                    insertText: completion,
                    range: new monaco.Range(
                      position.lineNumber,
                      position.column,
                      position.lineNumber,
                      position.column
                    ),
                  },
                ],
              };
            }
          } catch {
            // Ignore error and fall through
          }
        }

        return { items: [] };
      },
      freeInlineCompletions: () => {},
    });
  } catch (err) {
    console.error('Failed to register inline completions:', err);
  }
}
