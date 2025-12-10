import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import embed from "vega-embed";
import type { VisualizationSpec } from "vega-lite";
import "./App.css";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

type CubeEvent = {
  type: "delta" | "done" | "event";
  content?: string;
  raw?: any;
  conversationId?: string;
  messages?: ChatMessage[];
};

type Segment =
  | { type: "thinking"; value: string }
  | { type: "text"; value: string }
  | { type: "toolCall"; value: unknown }
  | { type: "toolResult"; value: unknown }
  | { type: "sql"; value: unknown }
  | { type: "sqlResult"; value: unknown };

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  assistantChunks?: string[];
  thinkingSteps?: string[];
  thinkingBuffer?: string;
  toolCalls?: unknown[];
  toolResults?: unknown[];
  sqlToolCalls?: unknown[];
  sqlToolResults?: unknown[];
  segments?: Segment[];
  metadata?: {
    chartType?: string;
    visualization?: unknown;
    query?: unknown;
    thinking?: string;
    toolCall?: unknown | unknown[];
    toolCallResult?: unknown | unknown[];
    sqlToolCall?: unknown | unknown[];
    sqlToolCallResult?: unknown | unknown[];
    events?: unknown[];
  };
};

type ConversationSummary = {
  id: string;
  title: string | null;
  createdAt: string;
  lastMessage?: string | null;
  lastTimestamp?: string | null;
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatVegaData(rawData: (string | number)[][], vegaSchema: any) {
  if (!vegaSchema?.encoding) return rawData;

  // 1. Lấy danh sách field theo thứ tự xuất hiện trong encoding
  const fieldDefs: any[] = [];

  Object.values(vegaSchema.encoding).forEach((enc: any) => {
    if (Array.isArray(enc)) {
      enc.forEach((e) => e?.field && fieldDefs.push(e));
    } else if (enc?.field) {
      fieldDefs.push(enc);
    }
  });

  // 2. Loại trùng field (tooltip hay bị lặp)
  const uniqueFields = Array.from(
    new Map(fieldDefs.map((f) => [f.field, f])).values(),
  );

  // 3. Map array → object + ép kiểu
  const formatted = rawData.map((row) => {
    const obj: Record<string, any> = {};

    uniqueFields.forEach((fieldDef, index) => {
      let value: any = row[index];

      // ✅ Ép number
      if (fieldDef.type === "quantitative") {
        value = value != null ? Number(value) : null;
      }

      // ✅ XỬ LÝ TEMPORAL ĐÚNG CÁCH
      if (fieldDef.type === "temporal") {
        if (fieldDef.timeUnit) {
          // 👉 CÓ timeUnit → GIỮ STRING cho Vega tự parse
          value = value != null ? String(value) : null;
        } else {
          // 👉 KHÔNG timeUnit → convert sang Date
          value = value != null ? new Date(value) : null;
        }
      }

      obj[fieldDef.field] = value;
    });

    return obj;
  });

  return formatted;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

async function fetchJSON(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const backendConfigured = useMemo(() => Boolean(BACKEND_URL), []);
  const userId = useMemo(() => {
    const existing =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("cube_chat_user_id")
        : null;
    if (existing) return existing;
    const generated = crypto.randomUUID();
    if (typeof localStorage !== "undefined")
      localStorage.setItem("cube_chat_user_id", generated);
    return generated;
  }, []);

  useEffect(() => {
    if (!backendConfigured) return;
    void loadConversations();
  }, [backendConfigured]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const loadConversations = async () => {
    setIsLoadingList(true);
    try {
      const data = await fetchJSON(
        `${BACKEND_URL}/api/conversations?userId=${encodeURIComponent(userId)}`,
      );
      setConversations(data);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Unable to load conversations";
      setError(msg);
    } finally {
      setIsLoadingList(false);
    }
  };

  const loadMessages = async (id: string) => {
    try {
      const data = await fetchJSON(
        `${BACKEND_URL}/api/conversations/${id}/messages?userId=${encodeURIComponent(userId)}`,
      );
      setConversationId(id);
      setMessages(data);
      setError(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Unable to load messages";
      setError(msg);
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || !backendConfigured) return;

    setIsSending(true);
    setError(null);

    // show the user message immediately
    const now = new Date().toISOString();
    const userMessage: ChatMessage = {
      role: "user",
      content: trimmed,
      timestamp: now,
    };
    const assistantPlaceholder: ChatMessage = {
      role: "assistant",
      content: "",
      timestamp: now,
    };
    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    setInput("");

    try {
      const resp = await fetch(`${BACKEND_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          content: trimmed,
          conversationId: conversationId ?? undefined,
        }),
      });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as CubeEvent;
            if (evt.type === "delta" && typeof evt.content === "string") {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === "assistant") {
                  const chunks = [...(last.assistantChunks || [])];
                  chunks.push(evt.content);
                  const segments = [...(last.segments || [])];
                  segments.push({ type: "text", value: evt.content });
                  updated[updated.length - 1] = {
                    ...last,
                    content: chunks.join(""),
                    assistantChunks: chunks,
                    segments,
                  };
                }
                return updated;
              });
            } else if (evt.type === "event" && evt.raw) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === "assistant") {
                  const meta = { ...(last.metadata || {}) };
                  const events = Array.isArray(meta.events)
                    ? meta.events
                    : meta.events
                      ? [meta.events]
                      : [];
                  const lastEvent = events[events.length - 1];
                  if (
                    lastEvent &&
                    JSON.stringify(lastEvent) === JSON.stringify(evt.raw)
                  ) {
                    return updated;
                  }

                  const segments = [...(last.segments || [])];
                  const pushSeg = (seg: Segment) => {
                    const prevSeg = segments[segments.length - 1];
                    if (
                      prevSeg &&
                      prevSeg.type === seg.type &&
                      JSON.stringify(prevSeg.value) ===
                        JSON.stringify(seg.value)
                    )
                      return;
                    segments.push(seg);
                  };

                  const dedupPush = (arr: unknown[], val: unknown) => {
                    if (val === undefined || val === null) return arr;
                    const lastVal = arr[arr.length - 1];
                    return lastVal &&
                      JSON.stringify(lastVal) === JSON.stringify(val)
                      ? arr
                      : [...arr, val];
                  };

                  const thinkingSteps = [...(last.thinkingSteps || [])];
                  let thinkingBuffer = last.thinkingBuffer || "";
                  if (evt.raw.thinking) {
                    thinkingBuffer += String(evt.raw.thinking);
                    const parts = thinkingBuffer.split(/\n+/);
                    thinkingBuffer = parts.pop() || "";
                    for (const part of parts) {
                      if (part.trim()) {
                        thinkingSteps.push(part);
                        pushSeg({ type: "thinking", value: part });
                      }
                    }
                    if (
                      evt.raw.isInProcess === false &&
                      thinkingBuffer.trim()
                    ) {
                      thinkingSteps.push(thinkingBuffer);
                      pushSeg({ type: "thinking", value: thinkingBuffer });
                      thinkingBuffer = "";
                    }
                    meta.thinking = [...thinkingSteps, thinkingBuffer].join(
                      "\n",
                    );
                  }

                  const toolCalls = dedupPush(
                    [...(last.toolCalls || [])],
                    evt.raw.toolCall,
                  );
                  let toolResults = [...(last.toolResults || [])];
                  let sqlCalls = [...(last.sqlToolCalls || [])];
                  let sqlResults = [...(last.sqlToolResults || [])];
                  if (evt.raw.toolCall?.result)
                    toolResults = dedupPush(
                      toolResults,
                      evt.raw.toolCall.result,
                    );
                  if (evt.raw.toolCall?.input)
                    sqlCalls = dedupPush(sqlCalls, evt.raw.toolCall.input);
                  if (evt.raw.toolCall?.result)
                    sqlResults = dedupPush(sqlResults, evt.raw.toolCall.result);

                  if (evt.raw.toolCall) {
                    pushSeg({
                      type: "toolCall",
                      value: {
                        call: evt.raw.toolCall,
                        result: evt.raw.toolCall?.result,
                      },
                    });
                  }

                  if (evt.raw.chartType) meta.chartType = evt.raw.chartType;
                  if (evt.raw.visualization !== undefined)
                    meta.visualization = evt.raw.visualization;
                  if (evt.raw.query !== undefined) meta.query = evt.raw.query;

                  meta.events = [...events, evt.raw];

                  updated[updated.length - 1] = {
                    ...last,
                    metadata: meta,
                    thinkingSteps,
                    thinkingBuffer,
                    toolCalls,
                    toolResults,
                    sqlToolCalls: sqlCalls,
                    sqlToolResults: sqlResults,
                    segments,
                  };
                }
                return updated;
              });
            } else if (evt.type === "done" && evt.messages) {
              setConversationId(evt.conversationId || conversationId);
              // normalize assistant messages to include chunks/steps/arrays from metadata if present
              const normalized = evt.messages.map((m) => {
                if (m.role !== "assistant") return m;
                const meta = m.metadata || {};
                return {
                  ...m,
                  assistantChunks:
                    m.assistantChunks || (m.content ? [m.content] : []),
                  thinkingSteps:
                    m.thinkingSteps || (meta.thinking ? [meta.thinking] : []),
                  toolCalls:
                    m.toolCalls ||
                    (meta.toolCall
                      ? Array.isArray(meta.toolCall)
                        ? meta.toolCall
                        : [meta.toolCall]
                      : []),
                  toolResults:
                    m.toolResults ||
                    (meta.toolCallResult
                      ? Array.isArray(meta.toolCallResult)
                        ? meta.toolCallResult
                        : [meta.toolCallResult]
                      : []),
                  sqlToolCalls:
                    m.sqlToolCalls ||
                    (meta.sqlToolCall
                      ? Array.isArray(meta.sqlToolCall)
                        ? meta.sqlToolCall
                        : [meta.sqlToolCall]
                      : []),
                  sqlToolResults:
                    m.sqlToolResults ||
                    (meta.sqlToolCallResult
                      ? Array.isArray(meta.sqlToolCallResult)
                        ? meta.sqlToolCallResult
                        : [meta.sqlToolCallResult]
                      : []),
                  metadata: meta,
                };
              });
              // setMessages(normalized);
              void loadConversations();
            }
          } catch (err) {
            console.warn("Failed to parse stream line", err, line);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleClear = () => {
    setConversationId(null);
    setMessages([]);
    setError(null);
    setInput("");
  };

  const handleCopy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .catch(() => setError("Unable to copy to clipboard"));
  };

  const renderVega = useCallback(
    async (
      spec: unknown,
      container: HTMLDivElement | null,
      dataset?: Record<string, any[]>,
    ) => {
      if (!container || !spec) return;
      try {
        await embed(container, spec as VisualizationSpec, {
          actions: false,
          renderer: "canvas",
          datasets: dataset,
        });
      } catch (err) {
        console.warn("Failed to render vega", err);
      }
    },
    [],
  );

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <p className="eyebrow">Cube Chat</p>
            <h2>Conversations</h2>
          </div>
          <button className="ghost" onClick={handleClear} disabled={isSending}>
            New chat
          </button>
        </div>
        {!backendConfigured && (
          <div className="banner warn">
            <strong>Missing backend.</strong> Set VITE_BACKEND_URL.
          </div>
        )}
        {isLoadingList ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="conversation-list">
            {conversations.length === 0 && (
              <p className="muted">No conversations yet.</p>
            )}
            {conversations.map((c) => (
              <button
                key={c.id}
                className={`conversation ${c.id === conversationId ? "active" : ""}`}
                onClick={() => loadMessages(c.id)}
              >
                <div className="conversation-title">
                  {c.title || "Untitled"}
                </div>
                <div className="conversation-meta">
                  <span>{c.lastMessage || "—"}</span>
                  {c.lastTimestamp && (
                    <span>{formatDate(c.lastTimestamp)}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </aside>

      <div className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Ask your data</p>
            <h1>Data Q&A</h1>
            <p className="subtitle">Chat via backend proxy with Cube.</p>
          </div>
          <div className="actions">
            <button
              className="ghost"
              onClick={handleClear}
              disabled={isSending && !messages.length}
            >
              Clear chat
            </button>
          </div>
        </header>

        {error && (
          <div className="banner error">
            <strong>Error:</strong> {error}
          </div>
        )}

        <main className="panel">
          <section className="messages" aria-live="polite">
            {messages.length === 0 && (
              <div className="empty">
                Start by asking a question about your data.
              </div>
            )}

            {messages.map((msg, idx) => (
              <article key={idx} className={`bubble ${msg.role}`}>
                <div className="bubble-header">
                  <span className="role">{msg.role}</span>
                  <span className="time">{formatTime(msg.timestamp)}</span>
                  {msg.role === "assistant" && (
                    <button
                      className="ghost small"
                      onClick={() => handleCopy(msg.content)}
                    >
                      Copy
                    </button>
                  )}
                </div>
                {msg.segments ? (
                  <div className="stack">
                    {(() => {
                      const out: JSX.Element[] = [];
                      let textBuf = "";
                      let thinkingBuf = "";
                      const flushText = () => {
                        if (!textBuf) return;
                        out.push(
                          <p key={`t-${out.length}`} className="content">
                            {textBuf}
                          </p>,
                        );
                        textBuf = "";
                      };
                      const flushThinking = () => {
                        if (!thinkingBuf.trim()) return;
                        out.push(
                          <div
                            key={`th-${out.length}`}
                            className="thinking inline"
                          >
                            <div className="label">Thinking</div>
                            <pre style={{ whiteSpace: "pre-wrap" }}>
                              {thinkingBuf.trim()}
                            </pre>
                          </div>,
                        );
                        thinkingBuf = "";
                      };

                      msg.segments?.forEach((seg) => {
                        if (seg.type === "text") {
                          textBuf += String(seg.value ?? "");
                          return;
                        }
                        if (seg.type === "thinking") {
                          thinkingBuf +=
                            (thinkingBuf ? " " : "") +
                            String(seg.value ?? "").replace(/\s+/g, " ");
                          return;
                        }
                        // flush buffers before non-text/non-thinking
                        flushText();
                        flushThinking();
                        if (seg.type === "toolCall") {
                          const payload = seg.value as any;
                          const call = payload?.call;
                          const result = payload?.result;
                          if (call?.name === "cubeSqlApi") {
                            let parsed: any = null;
                            try {
                              parsed = call.input
                                ? JSON.parse(call.input)
                                : null;
                            } catch (_err) {
                              parsed = null;
                            }

                            let contentParsed: any = null;
                            try {
                              contentParsed = result
                                ? JSON.parse(result)
                                : null;
                            } catch (_err) {
                              contentParsed = null;
                            }
                            // const first = Array.isArray(result)
                            //   ? result[0]
                            //   : result;
                            // const rows = Array.isArray(first?.data)
                            //   ? first.data
                            //   : Array.isArray(first?.rows)
                            //     ? first.rows
                            //     : null;

                            const chartSpec = contentParsed?.vegaSpec || {};
                            const chartData = formatVegaData(
                              contentParsed?.data || [],
                              chartSpec,
                            );

                            chartSpec.data = { values: chartData };

                            out.push(
                              <div
                                key={`tc-${out.length}`}
                                className="info-block"
                              >
                                <div className="label">SQL Query</div>
                                <div className="stack">
                                  {parsed?.queryTitle && (
                                    <div className="meta-row">
                                      <strong>{parsed.queryTitle}</strong>
                                    </div>
                                  )}
                                  {parsed?.description && (
                                    <div className="meta-row">
                                      {parsed.description}
                                    </div>
                                  )}
                                  {parsed?.sqlQuery && (
                                    <pre className="code-block">
                                      {parsed.sqlQuery}
                                    </pre>
                                  )}
                                  {!parsed?.sqlQuery && (
                                    <pre>{JSON.stringify(call, null, 2)}</pre>
                                  )}
                                  {chartSpec && chartData && (
                                    <div className="vega-block">
                                      <div className="label">Chart</div>
                                      <div
                                        className="vega-host"
                                        ref={(el) =>
                                          renderVega(chartSpec, el, undefined)
                                        }
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>,
                            );
                          } else {
                            out.push(
                              <div
                                key={`tc-${out.length}`}
                                className="info-block"
                              >
                                <div className="label">Toolcall</div>
                                <pre>{JSON.stringify(call, null, 2)}</pre>
                                {result !== undefined && (
                                  <>
                                    <div className="label">Result</div>
                                    <pre>{JSON.stringify(result, null, 2)}</pre>
                                  </>
                                )}
                              </div>,
                            );
                          }
                        }
                      });
                      // flush remaining buffers
                      flushText();
                      flushThinking();
                      return out;
                    })()}
                  </div>
                ) : (
                  <p className="content">{msg.content}</p>
                )}

                {msg.metadata && (
                  <div className="meta padded">
                    {msg.metadata.chartType && (
                      <div className="meta-row">
                        <span className="label">Chart:</span>{" "}
                        {msg.metadata.chartType}
                      </div>
                    )}
                    {msg.metadata.visualization !== undefined ? (
                      <details>
                        <summary>Visualization config</summary>
                        <pre>
                          {JSON.stringify(msg.metadata.visualization, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                    {msg.metadata.query !== undefined ? (
                      <details>
                        <summary>Generated query</summary>
                        <pre>{JSON.stringify(msg.metadata.query, null, 2)}</pre>
                      </details>
                    ) : null}
                    {msg.metadata.chartType && (
                      <div className="meta-row">
                        <span className="label">Chart:</span>{" "}
                        {msg.metadata.chartType}
                      </div>
                    )}
                    {msg.metadata.visualization !== undefined ? (
                      <details>
                        <summary>Visualization config</summary>
                        <pre>
                          {JSON.stringify(msg.metadata.visualization, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                    {msg.metadata.query !== undefined ? (
                      <details>
                        <summary>Generated query</summary>
                        <pre>{JSON.stringify(msg.metadata.query, null, 2)}</pre>
                      </details>
                    ) : null}
                    {msg.metadata.thinking && (
                      <details>
                        <summary>Thinking</summary>
                        <pre>{msg.metadata.thinking}</pre>
                      </details>
                    )}
                    {msg.metadata.toolCall && (
                      <details>
                        <summary>Tool calls</summary>
                        <pre>
                          {JSON.stringify(msg.metadata.toolCall, null, 2)}
                        </pre>
                      </details>
                    )}
                    {msg.metadata.toolCallResult && (
                      <details>
                        <summary>Tool results</summary>
                        <pre>
                          {JSON.stringify(msg.metadata.toolCallResult, null, 2)}
                        </pre>
                      </details>
                    )}
                    {msg.metadata.sqlToolCall && (
                      <details>
                        <summary>SQL tool calls</summary>
                        <pre>
                          {JSON.stringify(msg.metadata.sqlToolCall, null, 2)}
                        </pre>
                      </details>
                    )}
                    {msg.metadata.sqlToolCallResult && (
                      <details>
                        <summary>SQL tool results</summary>
                        <pre>
                          {JSON.stringify(
                            msg.metadata.sqlToolCallResult,
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    )}
                    {msg.metadata.events && (
                      <details>
                        <summary>Raw events</summary>
                        <pre>
                          {JSON.stringify(msg.metadata.events, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </article>
            ))}
            {isSending && (
              <article className="bubble assistant typing">
                <div className="dots" aria-label="Assistant is typing">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </article>
            )}
            <div ref={bottomRef} />
          </section>

          <section className="composer" aria-label="Message composer">
            <label className="sr-only" htmlFor="chat-input">
              Ask a question
            </label>
            <textarea
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about sales, revenue, trends..."
              rows={4}
              disabled={isSending || !backendConfigured}
            />
            <div className="composer-actions">
              <span className="hint">Shift+Enter for newline</span>
              <button
                onClick={handleSend}
                disabled={isSending || !backendConfigured || !input.trim()}
              >
                {isSending ? "Sending…" : "Send"}
              </button>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
