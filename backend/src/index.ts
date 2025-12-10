import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import asyncHandler from 'express-async-handler'
import { createConversation, addMessage, listConversations, listMessages } from './repo.js'
import { sendToCube, exchangeToken } from './cubeClient.js'
import { MessagePayload } from './types.js'
import { nanoid } from 'nanoid'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 4000

app.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok' })
})

app.get('/api/token', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const externalId = (req.query.externalId as string) || 'anonymous'
  const token = await exchangeToken(externalId)
  res.json({ token })
}))

app.get('/api/conversations', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const userId = (req.query.userId as string) || 'anonymous'
  const convos = listConversations(userId)
  res.json(convos)
}))

app.get('/api/conversations/:id/messages', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const userId = (req.query.userId as string) || 'anonymous'
  const { id } = req.params
  const rows = listMessages(id, userId)
  if (!rows) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.json(rows)
}))

app.post('/api/chat', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { userId = 'anonymous', content, conversationId } = req.body as {
    userId?: string
    content: string
    conversationId?: string
  }
  if (!content) {
    res.status(400).json({ error: 'content required' })
    return
  }

  res.setHeader('Content-Type', 'application/x-ndjson')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Transfer-Encoding', 'chunked')
  res.setHeader('X-Accel-Buffering', 'no')
  if (typeof (res as any).flushHeaders === 'function') {
    ;(res as any).flushHeaders()
  }

  const ts = new Date().toISOString()
  let convoId = conversationId
  if (!convoId) {
    convoId = createConversation(userId, content.slice(0, 50))
  }

  const userMessage: MessagePayload = {
    role: 'user',
    content,
    timestamp: ts,
  }
  addMessage(convoId, userMessage)

  const chatId = convoId || nanoid()
  let assistantAccum = ''
  let lastMetadata: unknown = undefined

  const cubeResponse = await sendToCube({
    chatId,
    input: content,
    externalId: userId,
    onDelta: (chunk, raw) => {
      const chunkStr = typeof chunk === 'string' ? chunk : String(chunk ?? '')
      const delta = chunkStr.startsWith(assistantAccum)
        ? chunkStr.slice(assistantAccum.length)
        : chunkStr
      if (delta) {
        assistantAccum += delta
        res.write(JSON.stringify({ type: 'delta', content: delta }) + '\n')
      }
      if (raw && (raw.thinking || raw.toolCall || raw.toolCallResult || raw.sqlToolCall || raw.sqlToolCallResult || raw.chartType || raw.visualization || raw.query)) {
        res.write(JSON.stringify({ type: 'event', raw }) + '\n')
      }
    },
  })

  const assistantText: string = cubeResponse?.message ?? assistantAccum ?? 'No response'
  lastMetadata = cubeResponse?.metadata ?? lastMetadata

  const assistantMessage: MessagePayload = {
    role: 'assistant',
    content: assistantText,
    timestamp: new Date().toISOString(),
    metadata: lastMetadata,
  }
  addMessage(convoId, assistantMessage)

  const updatedMessages = listMessages(convoId, userId) ?? []
  res.write(JSON.stringify({
    type: 'done',
    conversationId: convoId,
    messages: updatedMessages,
  }) + '\n')
  res.end()
}))

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Internal error' })
})

app.listen(PORT, () => {
  console.log(`Backend listening on ${PORT}`)
})
