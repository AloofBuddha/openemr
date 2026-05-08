import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Maximize2, Minimize2, Paperclip, RotateCcw, Send,
  FlaskConical,
} from 'lucide-react';
import './styles.css';

import { MessageBubble }    from './components/MessageBubble';
import { PatientSnapshot }  from './components/PatientSnapshot';
import { SourceDrawer }     from './components/SourceDrawer';
import { StatusBadge }      from './components/StatusBadge';
import { UploadModal }      from './components/UploadModal';
import type { CopilotPanelProps } from './types';
import { useCopilotChat }   from './useCopilotChat';

const WIDE_BREAKPOINT       = 800;
const DRAWER_DEFAULT_WIDTH  = 260;
const DRAWER_MIN_WIDTH      = 180;
const DRAWER_MAX_WIDTH      = 500;
const SEND_AFTER_RESTART_MS = 30;

export function CopilotPanel({
  pid, apiUrl, csrfToken, physicianId, webRoot, categories,
}: CopilotPanelProps) {
  const {
    messages, sources, activeSource, activeCitedText, setActiveSource, snapshot,
    status, statusMessage, send, restart,
    addDocToSnapshot, addLabsToSnapshot, addIntakeToSnapshot, addDocId, uploadedDocIds, labsFlash,
  } = useCopilotChat(pid, apiUrl, csrfToken, physicianId);

  const uploadUrl = apiUrl.replace(/chat\.php([^/]*)$/, `upload.php?pid=${pid}&site=default`);

  const [collapsed, setCollapsed]           = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [inputText, setInputText]           = useState('');
  const [drawerWidth, setDrawerWidth]       = useState(DRAWER_DEFAULT_WIDTH);
  const [uploadOpen, setUploadOpen]         = useState(false);

  const wrapRef        = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);
  const messagesRef    = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Stick-to-bottom toggle: true while the user is at (or near) the latest
  // message, false once they scroll up to read history. Auto-scroll fires
  // only while true, so streaming text never yanks the page out from under
  // a doctor mid-read. Refocusing the input snaps back to the latest.
  const stickToBottomRef = useRef(true);
  const dragStartX     = useRef(0);
  const dragStartWidth = useRef(DRAWER_DEFAULT_WIDTH);
  const STICK_THRESHOLD_PX = 60;

  const isBusy = status === 'loading' || status === 'streaming';
  const isWide = containerWidth >= WIDE_BREAKPOINT;

  // Watch the panel container so we can swap to a side-by-side layout when wide.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Auto-scroll to the latest message — but only when the user is already
  // pinned to the bottom. If they've scrolled up to read prior content,
  // we don't pull the view down on every streaming delta.
  useEffect(() => {
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [messages]);

  // Track scroll position: re-engage stick-to-bottom only when the user
  // returns to within STICK_THRESHOLD_PX of the bottom themselves.
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distanceFromBottom <= STICK_THRESHOLD_PX;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // ─── Drawer drag-resize ─────────────────────────────────────────────────
  const onDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    dragStartX.current     = e.clientX;
    dragStartWidth.current = drawerWidth;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onDividerPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
    const delta    = dragStartX.current - e.clientX;
    const newWidth = Math.max(DRAWER_MIN_WIDTH, Math.min(DRAWER_MAX_WIDTH, dragStartWidth.current + delta));
    setDrawerWidth(newWidth);
  };

  // ─── Send actions ───────────────────────────────────────────────────────
  // Re-engage stick-to-bottom whenever the user explicitly signals "I want
  // the live view again" — sending a message or focusing the input.
  // Declared ahead of handleSend so the latter's useCallback deps array
  // doesn't hit a temporal dead zone on first render.
  const snapToBottom = useCallback((): void => {
    stickToBottomRef.current = true;
    messagesEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const handleSend = useCallback((): void => {
    const text = inputText.trim();
    if (!text || isBusy) return;
    setInputText('');
    send(text);
    inputRef.current?.focus();
    snapToBottom();
  }, [inputText, isBusy, send, snapToBottom]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChip = useCallback((text: string): void => {
    if (isBusy) return;
    // Guideline-themed chips trigger the slower W2 RAG path; everything else
    // uses the fast W1 chat (Sonnet over patient context only). Saves several
    // seconds of latency on the two non-guidelines chips per brief.
    const isGuidelinesChip = /guideline/i.test(text);
    send(text, false, [], false, !isGuidelinesChip);
  }, [isBusy, send]);

  // ─── Sub-renders ────────────────────────────────────────────────────────
  const chatMessages = (
    <div className="copilot-messages" ref={messagesRef}>
      {messages.map((msg, i) => {
        if (msg.hidden) return null;
        const isLastAssistant = msg.role === 'assistant'
          && messages.slice(i + 1).every(m => m.role !== 'assistant');
        const isLastStreaming = msg.role === 'assistant' && msg.isStreaming
          && messages.slice(i + 1).every(m => m.role !== 'assistant');
        return (
          <MessageBubble
            key={msg.id}
            msg={msg}
            sources={sources}
            onCite={(src, citedText) => setActiveSource(src, citedText)}
            onChip={handleChip}
            isBusy={isBusy}
            showDisclaimer={isLastAssistant && !msg.isStreaming && !msg.isError}
            statusMessage={isLastStreaming ? statusMessage : ''}
          />
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );

  const inputRow = (
    <div className="copilot-input-row">
      <input
        ref={inputRef}
        className="copilot-input"
        type="text"
        placeholder="Ask a follow-up…"
        value={inputText}
        onChange={e => setInputText(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={snapToBottom}
        disabled={isBusy}
      />
      <button
        className="copilot-upload-btn"
        onClick={() => setUploadOpen(true)}
        title="Upload document"
        type="button"
      ><Paperclip size={14} /></button>
      <button
        className="copilot-send-btn"
        onClick={handleSend}
        disabled={isBusy || !inputText.trim()}
        title="Send"
      ><Send size={14} /></button>
    </div>
  );

  return (
    <div className="copilot-header-wrap" ref={wrapRef}>
      <div className="copilot-header">
        <strong>Clinical Co-Pilot</strong>
        <div className="copilot-header-actions">
          {uploadedDocIds.length > 0 && (
            <span className="copilot-badge copilot-badge-docs"
                  title={`${uploadedDocIds.length} document(s) uploaded this session`}>
              <FlaskConical size={11} style={{ marginRight: 3 }} />
              {uploadedDocIds.length} doc{uploadedDocIds.length !== 1 ? 's' : ''}
            </span>
          )}
          <StatusBadge status={status} />
          <button className="copilot-btn-icon" onClick={restart} disabled={isBusy} title="Restart">
            <RotateCcw size={14} />
          </button>
          <button
            className="copilot-btn-icon"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Minimize'}
          >
            {collapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          </button>
        </div>
      </div>

      <div className={`copilot-body${collapsed ? ' collapsed' : ''}${isWide ? ' copilot-body-wide' : ''}`}>
        <div className="copilot-main">
          {snapshot && (
            <PatientSnapshot
              snapshot={snapshot}
              compact={!isWide}
              onOpenSource={setActiveSource}
              onOpenUpload={() => setUploadOpen(true)}
              webRoot={webRoot}
              pid={pid}
              labsFlash={labsFlash}
            />
          )}
          {chatMessages}
          {inputRow}
        </div>
        {activeSource && (
          <>
            <div
              className="copilot-divider"
              onPointerDown={onDividerPointerDown}
              onPointerMove={onDividerPointerMove}
            />
            <SourceDrawer
              source={activeSource}
              onClose={() => setActiveSource(null)}
              width={drawerWidth}
              webRoot={webRoot}
              docId={activeSource.openemr_doc_id}
              citedText={activeCitedText}
            />
          </>
        )}
      </div>

      <UploadModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        uploadUrl={uploadUrl}
        csrfToken={csrfToken}
        categories={categories}
        pid={pid}
        onUploaded={(doc, extraction) => {
          addDocToSnapshot(doc);
          addDocId(doc.id);

          // Push extracted data into the snapshot card immediately.
          if (extraction?.doc_type === 'lab_pdf' && extraction.results?.length) {
            const today = new Date().toISOString().slice(0, 10);
            addLabsToSnapshot(extraction.results.map(r => ({
              test:     r.test_name,
              value:    r.value,
              units:    r.unit ?? '',
              abnormal: r.abnormal_flag ?? '',
              date:     today,
            })));
          } else if (extraction?.doc_type === 'intake_form') {
            addIntakeToSnapshot(extraction);
          }

          // Dismiss the modal so the user sees the copilot panel + extraction summary.
          setUploadOpen(false);

          // After a lab upload, the chart now has new procedure_result rows;
          // schedule a reload of the OpenEMR cards once the agent analysis
          // streaming completes (handled below).
          if (extraction?.doc_type === 'lab_pdf') {
            sessionStorage.setItem(`copilot_reload_after_done_${pid}`, '1');
          }

          // Auto-trigger agent analysis.
          const label = extraction?.doc_type === 'intake_form' ? 'intake form' : 'lab report';
          setTimeout(() => {
            send(
              `Analyze the uploaded ${label} and highlight any abnormal values or clinical concerns. Reference applicable guidelines.`,
              false,
              [doc.id],
            );
          }, SEND_AFTER_RESTART_MS);
        }}
      />
    </div>
  );
}
