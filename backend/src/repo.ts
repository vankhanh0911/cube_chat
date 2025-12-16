import db from './db.js'
import { v4 as uuidv4 } from 'uuid';
import { MessagePayload } from './types.js'

export function createConversation(userId: string, title: string | null = null) {
  const id = uuidv4()
  const stmt = db.prepare(
    "INSERT INTO conversations (id, user_id, title, created_at) VALUES (?, ?, ?, datetime('now'))"
  )
  stmt.run(id, userId, title)
  return id
}

export function addMessage(
  conversationId: string,
  msg: MessagePayload
) {
  const stmt = db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?)'
  )
  stmt.run(uuidv4(), conversationId, msg.role, msg.content, msg.timestamp, JSON.stringify(msg.metadata ?? null))
}

export function listConversations(userId: string) {
  const rows = db
    .prepare(
      `SELECT c.id, c.title, c.created_at as createdAt,
              (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) as lastMessage,
              (SELECT timestamp FROM messages m WHERE m.conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) as lastTimestamp
         FROM conversations c
        WHERE c.user_id = ?
        ORDER BY c.created_at DESC`
    )
    .all(userId)
  return rows
}

type MessageRow = {
  role: string
  content: string
  timestamp: string
  metadata: string | null
}

export function listMessages(conversationId: string, userId: string) {
  const owner = db.prepare('SELECT 1 FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId)
  if (!owner) return null
  const rows = db
    .prepare('SELECT role, content, timestamp, metadata FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
    .all(conversationId) as MessageRow[]
  return rows.map((r) => ({
    role: r.role as MessagePayload['role'],
    content: r.content,
    timestamp: r.timestamp,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
  }))
}
