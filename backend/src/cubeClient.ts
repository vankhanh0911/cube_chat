import dotenv from "dotenv";
dotenv.config();

const CUBE_API_BASE = process.env.CUBE_API_BASE; // e.g. https://ai-engineer.cubecloud.dev
const CUBE_CHAT_PATH = process.env.CUBE_CHAT_PATH; // e.g. api/v1/public/antsomi/1/chat/stream-chat-state
const CUBE_API_KEY = process.env.CUBE_API_KEY; // for session/token exchange

if (!CUBE_API_BASE || !CUBE_CHAT_PATH || !CUBE_API_KEY) {
  console.warn(
    "CUBE_API_BASE, CUBE_CHAT_PATH, or CUBE_API_KEY missing; cube chat proxy will fail until configured.",
  );
}

type SessionResponse = { sessionId: string };
type TokenResponse = { token: string };

type CubeDelta = {
  role?: string;
  content?: string;
  metadata?: any;
  thinking?: string;
  toolCall?: any;
  toolCallResult?: any;
  sqlToolCall?: any;
  sqlToolCallResult?: any;
  [key: string]: any;
};

function mergeMeta(base: any, msg: CubeDelta) {
  const out = { ...(base || {}) };
  if (msg.metadata) Object.assign(out, msg.metadata);
  if (msg.thinking) out.thinking = msg.thinking;
  if (msg.toolCall) out.toolCall = msg.toolCall;
  if (msg.toolCallResult) out.toolCallResult = msg.toolCallResult;
  if (msg.sqlToolCall) out.sqlToolCall = msg.sqlToolCall;
  if (msg.sqlToolCallResult) out.sqlToolCallResult = msg.sqlToolCallResult;
  return out;
}

export async function exchangeToken(externalId: string) {
  if (!CUBE_API_BASE || !CUBE_API_KEY) {
    throw new Error("Cube API not configured");
  }

  const sessionRes = await fetch(
    `${CUBE_API_BASE.replace(/\/$/, "")}/api/v1/embed/generate-session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Api-Key ${CUBE_API_KEY}`,
      },
      body: JSON.stringify({ externalId, deploymentId: 1 }),
    },
  );
  console.log("sessionRes", sessionRes);
  console.log(
    "sss",
    `${CUBE_API_BASE.replace(/\/$/, "")}/api/v1/embed/generate-session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Api-Key ${CUBE_API_KEY}`,
      },
      body: JSON.stringify({ externalId, deploymentId: 1 }),
    },
  );

  if (!sessionRes.ok) {
    throw new Error(`Session gen HTTP ${sessionRes.status}`);
  }
  const sessionJson = (await sessionRes.json()) as SessionResponse;

  const tokenRes = await fetch(
    `${CUBE_API_BASE.replace(/\/$/, "")}/api/v1/embed/session/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Api-Key ${CUBE_API_KEY}`,
      },
      body: JSON.stringify({ sessionId: sessionJson.sessionId }),
    },
  );

  if (!tokenRes.ok) {
    throw new Error(`Session token HTTP ${tokenRes.status}`);
  }
  const tokenJson = (await tokenRes.json()) as TokenResponse;
  return tokenJson.token;
}

export async function sendToCube({
  chatId,
  input,
  externalId,
  onDelta,
}: {
  chatId: string;
  input: string;
  externalId: string;
  onDelta?: (chunk: string, raw?: CubeDelta) => void;
}) {
  if (!CUBE_API_BASE || !CUBE_CHAT_PATH || !CUBE_API_KEY) {
    throw new Error("Cube API not configured");
  }

  const bearer = await exchangeToken("khanhhv@antsomi.com");
  const url = `https://ai-engineer.cubecloud.dev/${CUBE_CHAT_PATH.replace(/^\//, "")}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ chatId, input }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Cube API HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let assistantText = "";
  let lastMetadata: any = undefined;
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const decoded = decoder.decode(value, { stream: true });
    buffer += decoded;

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // keep incomplete line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as CubeDelta;
        lastMetadata = mergeMeta(lastMetadata, msg);
        onDelta?.("", msg);
        if (msg.role === "assistant" && typeof msg.content === "string") {
          assistantText += msg.content;
          onDelta?.(msg.content, msg);
        }
      } catch (err) {
        console.warn("Failed to parse stream line", err, line);
      }
    }
  }

  if (buffer.trim()) {
    try {
      const msg = JSON.parse(buffer) as CubeDelta;
      lastMetadata = mergeMeta(lastMetadata, msg);
      onDelta?.("", msg);
      if (msg.role === "assistant" && typeof msg.content === "string") {
        assistantText += msg.content;
        onDelta?.(msg.content, msg);
      }
    } catch (err) {
      console.warn("Failed to parse trailing stream line", err, buffer);
    }
  }

  return { message: assistantText || "No response", metadata: lastMetadata };
}
