# Cube Chat API - Documentation for Development

## Overview

This document provides essential information about Cube Chat API for building a chat application. The backend uses Cube's Chat API endpoint.

## API Endpoint

```
POST https://your-cube-instance.com/cubejs-api/v1/chat
```

## Authentication

The API requires authentication via API token in the Authorization header:

```
Authorization: Bearer YOUR_API_TOKEN
```

## Request Format

### Basic Request Structure

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Your question here"
    }
  ]
}
```

### Multi-turn Conversation

```json
{
  "messages": [
    {
      "role": "user",
      "content": "What are total sales?"
    },
    {
      "role": "assistant",
      "content": "Total sales are $1.5M"
    },
    {
      "role": "user",
      "content": "How about last month?"
    }
  ]
}
```

## Response Format

### Success Response

```json
{
  "data": {
    "message": "Assistant's response text",
    "metadata": {
      "query": {...},
      "chartType": "line",
      "visualization": {...}
    }
  }
}
```

### Error Response

```json
{
  "error": "Error message description"
}
```

## Key Features

### 1. Natural Language to Data Query

The API converts natural language questions into data queries automatically.

**Example:**

- User: "Show me sales by region last quarter"
- API returns: Data query + visualization recommendations

### 2. Context Awareness

The API maintains conversation context, allowing follow-up questions without repeating information.

### 3. Data Visualization Hints

Response may include suggested chart types and visualization configurations.

## Frontend Implementation Guidelines

### State Management

```javascript
// Recommended state structure
{
  messages: [
    { role: 'user', content: '...', timestamp: Date },
    { role: 'assistant', content: '...', timestamp: Date }
  ],
  isLoading: false,
  error: null
}
```

### API Call Example (JavaScript/TypeScript)

```javascript
async function sendMessage(userMessage, conversationHistory) {
  const response = await fetch(
    "https://your-cube-instance.com/cubejs-api/v1/chat",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`,
      },
      body: JSON.stringify({
        messages: [
          ...conversationHistory,
          { role: "user", content: userMessage },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}
```

## UI/UX Recommendations

### Message Display

- User messages: Right-aligned, distinct color
- Assistant messages: Left-aligned, include data visualizations when available
- System messages: Centered, subtle styling

### Loading States

- Show typing indicator when waiting for response
- Display "Analyzing data..." or similar feedback

### Error Handling

- Network errors: "Unable to connect. Please check your connection."
- API errors: Display error message from API response
- Timeout: "Request took too long. Please try again."

### Features to Implement

1. **Message Input**: Text area with send button
2. **Message History**: Scrollable list of messages
3. **Auto-scroll**: Scroll to bottom on new messages
4. **Clear Chat**: Button to reset conversation
5. **Copy/Share**: Allow copying assistant responses
6. **Data Visualization**: Render charts when provided in response

## Best Practices

### Performance

- Debounce typing indicators
- Paginate message history for long conversations
- Cache recent responses if appropriate

### Security

- Store API token securely (environment variables)
- Never expose API token in client-side code
- Use HTTPS for all API calls
- Validate and sanitize user input

### Accessibility

- Add ARIA labels for screen readers
- Keyboard navigation support
- Sufficient color contrast
- Focus management

## Common Use Cases

1. **Business Intelligence Queries**
   - "What were our top selling products last month?"
   - "Show revenue trend for Q4"
2. **Data Exploration**

   - "Break down sales by customer segment"
   - "Compare this year vs last year"

3. **Follow-up Questions**
   - "What about the previous quarter?"
   - "Show me more details"

## Troubleshooting

### Issue: No response from API

- Check API token validity
- Verify endpoint URL
- Check network connectivity
- Review CORS settings

### Issue: Unexpected responses

- Verify message format
- Check conversation history structure
- Review API documentation for updates

### Issue: Performance problems

- Limit conversation history sent (last 10-20 messages)
- Implement request timeout
- Add retry logic with exponential backoff

## Environment Variables (Recommended)

```bash
CUBE_API_URL=https://your-cube-instance.com/cubejs-api/v1
CUBE_API_TOKEN=your_api_token_here
```

## Sample Tech Stack Suggestions

### Frontend Options

- **React**: Good for complex state management
- **Vue**: Simpler learning curve
- **Vanilla JS**: Lightweight for simple implementations

### UI Libraries

- **Tailwind CSS**: Utility-first styling
- **Material-UI**: Pre-built components
- **shadcn/ui**: Modern React components

### State Management

- **React Context**: For simple apps
- **Redux/Zustand**: For complex state
- **TanStack Query**: For API state management

## Testing Checklist

- [ ] Send single message
- [ ] Multi-turn conversation
- [ ] Error handling (network, API errors)
- [ ] Loading states
- [ ] Message persistence/clear
- [ ] API token security
- [ ] Mobile responsiveness
- [ ] Accessibility features

## Additional Notes

- The API may have rate limits - implement appropriate throttling
- Consider adding message timestamps
- Store conversation history in local storage for user convenience
- Implement data visualization rendering if API returns chart configs
- Add export functionality for data/charts if needed
