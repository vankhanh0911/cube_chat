export type MessagePayload = {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  metadata?: unknown
}

export type Conversation = {
  id: string
  userId: string
  title: string | null
  createdAt: string
}
