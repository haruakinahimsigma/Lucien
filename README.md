# Lucien

A soft, minimal AI chat interface with a warm ivory palette, subtle star mark, responsive layout, and optional dark mode.

## Current state
- Responsive chat UI for desktop, tablet, and mobile
- New chat and local session conversation list
- Light/dark appearance toggle (saved in local storage)
- Prompt suggestions, keyboard shortcuts, and message composer
- Frontend is prepared to call a server endpoint at `POST /api/chat`

## Important
The interface is ready, but real AI replies require a backend that implements `POST /api/chat` and securely calls an AI model provider. Keep API keys in server-side environment variables; never put secrets in browser JavaScript.

## Run locally
Serve this directory with any static web server and open `index.html`. For real AI functionality, deploy a backend alongside it and configure the frontend endpoint as needed.
