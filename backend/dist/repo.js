import db from './db.js';
import { nanoid } from 'nanoid';
export function createConversation(userId, title = null) {
    const id = nanoid();
    const stmt = db.prepare("INSERT INTO conversations (id, user_id, title, created_at) VALUES (?, ?, ?, datetime('now'))");
    stmt.run(id, userId, title);
    return id;
}
export function addMessage(conversationId, msg) {
    const stmt = db.prepare('INSERT INTO messages (id, conversation_id, role, content, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(nanoid(), conversationId, msg.role, msg.content, msg.timestamp, JSON.stringify(msg.metadata ?? null));
}
export function listConversations(userId) {
    const rows = db
        .prepare(`SELECT c.id, c.title, c.created_at as createdAt,
              (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) as lastMessage,
              (SELECT timestamp FROM messages m WHERE m.conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) as lastTimestamp
         FROM conversations c
        WHERE c.user_id = ?
        ORDER BY c.created_at DESC`)
        .all(userId);
    return rows;
}
export function listMessages(conversationId, userId) {
    const owner = db.prepare('SELECT 1 FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId);
    if (!owner)
        return null;
    const rows = db
        .prepare('SELECT role, content, timestamp, metadata FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
        .all(conversationId);
    return rows.map((r) => ({
        role: r.role,
        content: r.content,
        timestamp: r.timestamp,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
}
