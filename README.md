# Launchpad with an AI onboarding guide

A small, fictional project-management app with a talking onboarding guide built on
[Synthesia Interactive Avatars](https://www.synthesia.io/features/avatars/interactive-avatars?utm_source=youtube&utm_medium=creator&utm_campaign=interactive_avatar_api&utm_content=sonny)
and [LiveKit](https://livekit.io). This is the finished app from the build video.

The guide greets new users, tours the app by clicking the real buttons, answers
questions from six product docs (and shows which page each answer came from), and
adds and moves tasks through the same New task and Move task controls you use.
You can interrupt it at any point.

The app itself is Next.js, React, Clerk sign-in, and Node's built-in SQLite. The
guide is a separate Python worker using LiveKit Agents and the Synthesia avatar
plugin. There are no real invitations, payments, uploads, or customer data.

Want to build the guide yourself? Start from the app without it:
[launchpad-starter](https://github.com/sonnysangha/launchpad-starter). Its README
has the skills to install and the prompts used in the video.

## What you need

- [Node 24](https://nodejs.org) or newer
- [Python](https://www.python.org/downloads/) 3.13 (3.10 to 3.14 work)
- A microphone, and Chrome or another modern browser
- These accounts and keys:

| Key | Where to get it |
| --- | --- |
| Clerk publishable key and secret key | In the [Clerk dashboard](https://dashboard.clerk.com), create an application and open **API keys**. Use the development keys. |
| LiveKit URL, API key, API secret | Create a free project on [LiveKit Cloud](https://cloud.livekit.io). It also runs the speech-to-text and Cartesia voice, so you don't need a separate Cartesia key. |
| Synthesia account | [Sign up for Synthesia Interactive Avatars](https://www.synthesia.io/features/avatars/interactive-avatars?utm_source=youtube&utm_medium=creator&utm_campaign=interactive_avatar_api&utm_content=sonny). |
| Synthesia API key | [Create your API key](https://docs.synthesia.io/reference/synthesia-api-quickstart#create-your-api-key). Your plan needs Interactive Avatars. |
| Synthesia avatar ID | In [Synthesia Studio](https://app.synthesia.io), open an avatar's ••• menu and choose **Copy Interactive ID**. Stock actor avatars such as Ryan or Ada don't work. |
| OpenAI API key | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |

## Setup

1. Clone and install the app.

   ```sh
   git clone https://github.com/sonnysangha/launchpad-ai-guide.git
   cd launchpad-ai-guide
   npm ci
   ```

2. Install the Python agent in its own virtual environment.

   ```sh
   python3.13 -m venv agent/.venv
   agent/.venv/bin/python -m pip install -r agent/requirements.txt
   ```

3. Create the app's env file and fill it in.

   ```sh
   cp .env.example .env.local
   ```

   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from Clerk
   - `LIVEKIT_URL` (starts with `wss://`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` from LiveKit Cloud
   - `LAUNCHPAD_AGENT_SECRET`: any random string of at least 32 characters, shared by the app and the agent. Generate one with `openssl rand -base64 48`.
   - Leave `LAUNCHPAD_APP_ORIGIN` as `http://127.0.0.1:3212`.

4. Create the agent's env file and fill in `SYNTHESIA_API_KEY`, `SYNTHESIA_AVATAR_ID` and `OPENAI_API_KEY`. The model and voice settings below them already have working defaults.

   ```sh
   cp agent/.env.example agent/.env
   ```

   The agent also reads the LiveKit keys and `LAUNCHPAD_AGENT_SECRET` from `.env.local`, so you don't repeat them. Both env files are git-ignored. Never put a server secret in a `NEXT_PUBLIC_` variable.

5. Check your configuration. Both commands print only missing or invalid names, never values.

   ```sh
   npm run preflight
   agent/.venv/bin/python agent/preflight.py
   ```

## Run it

Use two terminals:

```sh
npm run dev                                  # the app
agent/.venv/bin/python agent/agent.py dev    # the guide
```

Open <http://127.0.0.1:3212>. Use this exact address, because sign-in and the API
only accept requests from it. Create an account, set up a workspace (or let the
guide help you fill it in), then start a conversation with the guide and allow the
microphone. Wait for its greeting, then try:

- "I just signed up and I'm a bit lost. Where do I start?"
- Interrupt it: "Wait, show me Review."
- "What happens next?"
- "Add a task called Design homepage."
- "Move Design homepage to Build."

Press **End** when you're done, then refresh: the tasks are still there. Every
conversation uses your LiveKit, Synthesia and OpenAI usage, so end it when you
finish. Don't use the agent's `console` command; it can't render the avatar.

## Synthesia docs to get started

- [Interactive Avatars overview](https://docs.synthesia.io/reference/interactive-avatars): what they are and how they work
- [Concepts](https://docs.synthesia.io/reference/ia-concepts): how a LiveKit agent attaches the avatar, the session lifecycle, and a glossary
- [Integration overview](https://docs.synthesia.io/reference/ia-overview): the pieces you connect and what each one does
- [Minimal quickstart](https://docs.synthesia.io/reference/interactive-avatar-minimal-quickstart): the starting point for this project
- [Tools quickstart](https://docs.synthesia.io/reference/interactive-avatar-tools-quickstart): an avatar that fills in a form as you talk
- [RAG quickstart](https://docs.synthesia.io/reference/interactive-avatar-rag-quickstart): an avatar that answers from your own documents
- [LiveKit plugin reference](https://docs.synthesia.io/reference/ia-livekit-plugin-reference)
- [Quickstart source code on GitHub](https://github.com/synthesia-ai/interactive-avatar-quickstarts)

## How it works

The browser asks the app for a short-lived LiveKit room token. The token
dispatches the `launchpad-guide` worker into that user's private room, and the
worker brings the Synthesia avatar with it. Before it starts the avatar, the
worker checks with the app (`POST /api/room/validate`, signed with
`LAUNCHPAD_AGENT_SECRET`) that the session is still active.

The guide never touches the database directly. To show part of the app, add a
task, or move one, it asks the browser over LiveKit RPC, and the browser clicks
the real control and saves through the signed-in user's API. The guide only says
a task is saved after the save succeeds. Each save carries a request ID, so a
retry never creates a duplicate or repeats a move.

| Path | What it is |
| --- | --- |
| `src/app` | Pages (landing, sign-in, onboarding, dashboard) and API routes |
| `src/app/api` | `workspace`, `tasks` (add), `tasks/stage` (move), `room` (start, end, validate), `reset` |
| `src/components/AvatarGuide.tsx` | The guide widget: room connection, avatar video, captions, End |
| `src/components` | Onboarding form, board/list views, New task form, Move task panel |
| `src/lib/store.ts` | SQLite store; every read and write is scoped to the signed-in user |
| `agent/agent.py` | The Python worker: model, voice, avatar, and tools |
| `agent/guide_core.py` | Doc search, task validation, and dispatch checks |
| `agent/tour.py` | The guided tour of the app |
| `docs/product` | The six product docs the guide answers from |

The agent's design notes and browser contract are in [agent/README.md](agent/README.md),
and the SDK references it follows are in [agent/SOURCES.md](agent/SOURCES.md).

## Data and reset

The database lives in `.data/launchpad.sqlite`, which is git-ignored. Each
signed-in account has its own isolated workspace. To start over, open **Reset demo
workspace** at the bottom of the board and type `RESET`. That removes only your
own sample workspace and ends your guide room.

## Checks

None of these need provider keys or start a paid avatar session.

```sh
npm run typecheck
npm test
npm run build
node scripts/check-client-secrets.mjs   # after a build: no server secret in browser assets
agent/.venv/bin/python -m unittest discover -s agent/tests -v
agent/.venv/bin/python -m unittest discover -s agent/tests_sdk -v
```

Browser checks are described in [e2e/README.md](e2e/README.md).
