import { describe, expect, it } from 'vitest';

import { parseSseStream } from './sse';

// Build a ReadableStream<Uint8Array> that yields the given chunks one at
// a time — lets us simulate partial reads and multi-byte boundaries.
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

describe('parseSseStream', () => {
  it('parses a single complete event', async () => {
    const stream = streamFromChunks([
      'event: status\ndata: {"text":"hi"}\n\n',
    ]);
    const events = [];
    for await (const e of parseSseStream(stream)) events.push(e);
    expect(events).toEqual([{ event: 'status', data: '{"text":"hi"}' }]);
  });

  it('parses multiple events in one chunk', async () => {
    const stream = streamFromChunks([
      'event: status\ndata: 1\n\nevent: delta\ndata: 2\n\n',
    ]);
    const events = [];
    for await (const e of parseSseStream(stream)) events.push(e);
    expect(events.map(e => e.event)).toEqual(['status', 'delta']);
  });

  it('reassembles events split across reads', async () => {
    const stream = streamFromChunks([
      'event: del',
      'ta\ndata: {"text":',
      '"chunk-1"}\n\n',
    ]);
    const events = [];
    for await (const e of parseSseStream(stream)) events.push(e);
    expect(events).toEqual([{ event: 'delta', data: '{"text":"chunk-1"}' }]);
  });

  it('drops a data line that arrives without a preceding event', async () => {
    const stream = streamFromChunks([
      'data: orphan\n\nevent: status\ndata: real\n\n',
    ]);
    const events = [];
    for await (const e of parseSseStream(stream)) events.push(e);
    expect(events).toEqual([{ event: 'status', data: 'real' }]);
  });

  it('handles many delta events in a row (stream-of-chunks pattern)', async () => {
    const chunks = Array.from({ length: 20 }, (_, i) =>
      `event: delta\ndata: {"text":"${i}"}\n\n`
    );
    const stream = streamFromChunks(chunks);
    const events = [];
    for await (const e of parseSseStream(stream)) events.push(e);
    expect(events.length).toBe(20);
    expect(events[0].data).toContain('"0"');
    expect(events[19].data).toContain('"19"');
  });
});
