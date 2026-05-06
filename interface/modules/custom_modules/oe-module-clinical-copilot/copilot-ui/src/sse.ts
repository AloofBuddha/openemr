// Generic Server-Sent Events parser.
//
// The browser's EventSource doesn't support POST, so we parse the SSE
// wire format by hand off a fetch().body reader. This async generator
// hands back one (event, data) pair at a time.
//
// Wire format the sidecar emits:
//   event: <name>\n
//   data: <json-or-string>\n
//   \n
//
// Blank line terminates an event; we keep state across reader.read() calls
// so multi-byte UTF-8 sequences and partial events are handled correctly.

export interface SseEvent {
  event: string;
  data: string;
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = '';
  let currentEvent = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith('event: ')) {
          currentEvent = t.slice(7);
        } else if (t.startsWith('data: ') && currentEvent !== '') {
          yield { event: currentEvent, data: t.slice(6) };
          currentEvent = '';
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
