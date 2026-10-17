let seq = 0;

export function newChatId() {
  seq += 1;
  return `chat_${Date.now()}_${seq}`;
}

/**
 * Stream a chat completion through the main process.
 * Returns { id, abort }.
 */
export function streamChat({ config, messages, onDelta, onDone, onError }) {
  const id = newChatId();

  const offChunk = window.nova.onChunk((d) => {
    if (d.chatId === id) onDelta && onDelta(d.delta);
  });
  const offDone = window.nova.onDone((d) => {
    if (d.chatId !== id) return;
    cleanup();
    onDone && onDone(d);
  });
  const offError = window.nova.onError((d) => {
    if (d.chatId !== id) return;
    cleanup();
    onError && onError(d.message);
  });

  function cleanup() {
    offChunk();
    offDone();
    offError();
  }

  window.nova.chat({ chatId: id, config, messages }).catch((e) => {
    cleanup();
    onError && onError(String((e && e.message) || e));
  });

  return {
    id,
    abort: () => window.nova.abort(id),
  };
}
