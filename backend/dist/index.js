import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import asyncHandler from "express-async-handler";
import path from "path";
import { fileURLToPath } from "url";
import { createConversation, addMessage, listConversations, listMessages, } from "./repo.js";
import { sendToCube, exchangeToken } from "./cubeClient.js";
import { nanoid } from "nanoid";
dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirname, "../static");
const indexFile = path.join(staticDir, "index.html");
app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});
app.get("/api/token", asyncHandler(async (req, res) => {
    const externalId = req.query.externalId || "anonymous";
    const token = await exchangeToken(externalId);
    res.json({ token });
}));
app.get("/api/conversations", asyncHandler(async (req, res) => {
    const userId = req.query.userId || "anonymous";
    const convos = listConversations(userId);
    res.json(convos);
}));
app.get("/api/conversations/:id/messages", asyncHandler(async (req, res) => {
    const userId = req.query.userId || "anonymous";
    const { id } = req.params;
    const rows = listMessages(id, userId);
    if (!rows) {
        res.status(404).json({ error: "Not found" });
        return;
    }
    res.json(rows);
}));
app.post("/api/chat", asyncHandler(async (req, res) => {
    const { userId = "anonymous", content, conversationId, } = req.body;
    if (!content) {
        res.status(400).json({ error: "content required" });
        return;
    }
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
    }
    const ts = new Date().toISOString();
    let convoId = conversationId;
    if (!convoId) {
        convoId = createConversation(userId, content.slice(0, 50));
    }
    const userMessage = {
        role: "user",
        content,
        timestamp: ts,
    };
    addMessage(convoId, userMessage);
    const chatId = convoId || nanoid();
    let assistantAccum = "";
    let lastMetadata = undefined;
    const cubeResponse = await sendToCube({
        chatId,
        input: content,
        externalId: userId,
        onDelta: (chunk, raw) => {
            const chunkStr = typeof chunk === "string" ? chunk : String(chunk ?? "");
            const delta = chunkStr.startsWith(assistantAccum)
                ? chunkStr.slice(assistantAccum.length)
                : chunkStr;
            if (delta) {
                assistantAccum += delta;
                res.write(JSON.stringify({ type: "delta", content: delta }) + "\n");
            }
            if (raw &&
                (raw.thinking ||
                    raw.toolCall ||
                    raw.toolCallResult ||
                    raw.sqlToolCall ||
                    raw.sqlToolCallResult ||
                    raw.chartType ||
                    raw.visualization ||
                    raw.query)) {
                res.write(JSON.stringify({ type: "event", raw }) + "\n");
            }
        },
    });
    const assistantText = cubeResponse?.message ?? assistantAccum ?? "No response";
    lastMetadata = cubeResponse?.metadata ?? lastMetadata;
    const assistantMessage = {
        role: "assistant",
        content: assistantText,
        timestamp: new Date().toISOString(),
        metadata: lastMetadata,
    };
    addMessage(convoId, assistantMessage);
    const updatedMessages = listMessages(convoId, userId) ?? [];
    res.write(JSON.stringify({
        type: "done",
        conversationId: convoId,
        messages: assistantMessage,
    }) + "\n");
    res.end();
}));
app.use(express.static(staticDir));
app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
        next();
        return;
    }
    res.sendFile(indexFile, (err) => {
        if (err) {
            res.status(404).send("Static assets not found");
        }
    });
});
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal error" });
});
app.listen(PORT, () => {
    console.log(`Backend listening on ${PORT}`);
});
