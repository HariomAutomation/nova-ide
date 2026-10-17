// Deterministic mock LLM: speaks OpenAI SSE + tool_calls so Nova's agent loop
// can be tested end-to-end without any API key.
//
// Usage: node scripts/mock-llm.mjs [testDir] [port]
import http from 'node:http';

const DIR = process.argv[2] || process.env.NOVA_TEST_DIR || '/tmp/opencode/nova-agent-test';
const PORT = Number(process.argv[3] || process.env.MOCK_PORT || 9977);

function chunkFor(delta, finish = null) {
  return {
    id: 'mock-1',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

function toolCallChunks(name, args, id) {
  return [
    chunkFor({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] }),
    chunkFor({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }),
  ];
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404).end('not found');
    return;
  }
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', async () => {
    let payload = {};
    try {
      payload = JSON.parse(body);
    } catch {}

    const messages = payload.messages || [];
    const toolCount = messages.filter((m) => m.role === 'tool').length;
    const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = async (objs) => {
      for (const o of objs) {
        res.write(`data: ${JSON.stringify(o)}\n\n`);
        await new Promise((r) => setTimeout(r, 12));
      }
      res.write('data: [DONE]\n\n');
      res.end();
    };

    if (!hasTools) {
      // Ask-mode (plain chat) request
      const words = 'ASK-MODE-OK reply from the mock model.'.split(' ');
      await send([
        ...words.map((w, i) => chunkFor({ content: (i ? ' ' : '') + w })),
        chunkFor({}, 'stop'),
      ]);
    } else if (toolCount === 0) {
      await send([
        ...toolCallChunks('write_file', { path: `${DIR}/hello.txt`, content: 'hello from nova agent\nline2' }, 'call_w1'),
        chunkFor({}, 'tool_calls'),
      ]);
    } else if (toolCount === 1) {
      await send([
        ...toolCallChunks('run_terminal_cmd', { command: 'cat hello.txt && echo MOCK-OK', cwd: DIR }, 'call_t1'),
        chunkFor({}, 'tool_calls'),
      ]);
    } else if (toolCount === 2) {
      await send([
        ...toolCallChunks(
          'browser',
          {
            action: 'open',
            url: 'data:text/html,<title>Nova Test Page</title><body style="font-family:sans-serif"><h1>Nova browser test</h1><p>Playwright page loaded.</p></body>',
          },
          'call_b1'
        ),
        chunkFor({}, 'tool_calls'),
      ]);
    } else if (toolCount === 3) {
      await send([...toolCallChunks('browser', { action: 'screenshot' }, 'call_b2'), chunkFor({}, 'tool_calls')]);
    } else if (toolCount === 4) {
      await send([
        ...toolCallChunks('grep_search', { pattern: 'hello', path: DIR }, 'call_g1'),
        chunkFor({}, 'tool_calls'),
      ]);
    } else {
      const text =
        'All tools verified. I wrote hello.txt, ran a shell command, opened a Chromium page and captured a screenshot. MOCK-DONE';
      const words = text.split(' ');
      await send([
        ...words.map((w, i) => chunkFor({ content: (i ? ' ' : '') + w })),
        chunkFor({}, 'stop'),
      ]);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock-llm-ready http://127.0.0.1:${PORT}/v1 dir=${DIR}`);
});
