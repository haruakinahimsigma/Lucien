# Lucien

A soft, minimal AI chat interface with a warm ivory palette, subtle star mark, responsive layout, and optional dark mode.

## Included
- Responsive chat UI for desktop, tablet, and mobile
- New chats and a conversation list for the current browser session
- Light/dark appearance toggle saved in local storage
- Prompt suggestions and keyboard shortcuts
- Node.js server that serves the UI and provides `POST /api/chat`
- AI API key kept server-side in environment variables

## Run locally
Requires Node.js 20 or newer.

```sh
npm start
```

Then open `http://localhost:3000`.

## Connect an AI model
Set these environment variables on the server/hosting platform:

- `AI_API_KEY` — required secret API key
- `AI_BASE_URL` — optional OpenAI-compatible API base URL; defaults to `https://api.openai.com/v1`
- `AI_MODEL` — optional model name; defaults to `gpt-4o-mini`

The backend expects an OpenAI-compatible `/chat/completions` endpoint. Never put the API key in browser code or commit it to GitHub.

## Deploy
Connect this repository to a Node.js hosting service and use `npm start` as the start command. Set the environment variables above in the hosting dashboard. The UI can load without a key, but real AI responses require a valid provider key and a model supported by that provider.
