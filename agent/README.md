# Launchpad avatar agent

This separate Python worker serves the fictional Launchpad guided setup, feature tour, and Q&A. Its tools can update an unsaved setup draft, highlight a step, retrieve six local product documents, visibly demonstrate read-only controls, and start or stop a paced walkthrough. General confusion starts a demonstration in the current experience; no mode switch is needed. Only onboarding with Guided setup can edit draft fields. The browser's authenticated Create action owns initial workspace persistence. In a saved project, create_task fills and submits the real New task form, and move_task moves one existing task, named by title, to another stage through the visible Move task panel. Each returns its durable receipt. The guide cannot rename, edit, delete, assign, or reorder tasks.

## Install and run

Python 3.10–3.14 is supported by the pinned SDK. From the repository root:

```sh
python3.13 -m venv agent/.venv
agent/.venv/bin/python -m pip install --index-url https://pypi.org/simple -r agent/requirements.txt
agent/.venv/bin/python agent/preflight.py
agent/.venv/bin/python agent/agent.py dev
```

The worker health endpoint uses port 8783 to keep this project separate from other local apps. The frontend connects through LiveKit Cloud, not that health port. Keep the worker running alongside the Next.js app. Do not use `console`: it cannot render a real avatar and the worker explicitly rejects it.

Shared `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `LAUNCHPAD_AGENT_SECRET` load from root `.env.local`. Agent-only settings load from `agent/.env`, which can override the root file. Copy the names from `.env.example`; never commit populated files or paste secrets into chat. Do not put server secrets in `NEXT_PUBLIC_*` variables.

The loader selects only worker settings and does not import Clerk or other unrelated keys from the root file. Set `LAUNCHPAD_APP_ORIGIN` if the local Next.js server uses a different origin than `http://127.0.0.1:3212`.

Required external prerequisites:

- A LiveKit Cloud project with matching URL/key/secret and available Inference usage for STT/TTS.
- A Synthesia workspace enabled for Interactive Avatars, sufficient minutes/concurrency, and its API key.
- `SYNTHESIA_AVATAR_ID`: an eligible Interactive ID copied from that workspace's avatar menu. A video avatar ID or stock actor-based avatar is insufficient. No default ID is assumed.
- An OpenAI API key entitled to the configured Realtime model, with available usage.
- The same server-only `LAUNCHPAD_AGENT_SECRET` of at least 32 characters in the frontend server and worker.

Preflight reads only local configuration and package metadata. It prints missing/invalid names, package versions, and explicitly says remote checks were not run. A passing preflight does not prove entitlement, credits, or a working avatar.

## Frontend/server contract

Dispatch worker name and participant identity are both `launchpad-guide`. Avatar participant identity is `launchpad-avatar`. Browser room tokens must be short-lived and room-scoped, issued after Clerk authentication, with `sync_streams=true` and an explicit `RoomAgentDispatch` named `launchpad-guide` on initial room creation.

The dispatch metadata is JSON `{ "payload": "...", "signature": "..." }`. Payload is unpadded base64url UTF-8 JSON. Signature is unpadded base64url HMAC-SHA256 of the literal payload string, using `LAUNCHPAD_AGENT_SECRET`. Decoded payload:

```json
{
  "v": 1,
  "userId": "user_example",
  "participantIdentity": "member_opaque_identity",
  "roomName": "launchpad-opaque-room",
  "expiresAt": 1800000000,
  "mode": "onboarding",
  "experience": "setup",
  "draft": { "workspaceName": "Orbit Studio", "projectName": "Mars launch", "workflow": "campaign" }
}
```

The shown timestamp is an illustrative placeholder; issue a real timestamp 300 seconds in the future. Worker validation allows at most 600 seconds. Identity and room must be generated server-side. Reserved agent/avatar identities are rejected. Metadata is verified before accepting a job and again before starting paid resources. Only onboarding mode with the setup experience accepts draft updates. Tours and explanatory questions do not mutate data. In saved-project help mode, an explicit user request may create a new task or move an existing task to another stage in any experience.

New dispatches explicitly sign `experience: "setup" | "tour" | "qa"`. Legacy signed payloads without the field default to setup for onboarding and Q&A for help; null and unknown values are rejected. The same default migrates existing SQLite rooms. Changing experience requires ending the current room before creating another.

Before acceptance and again before avatar startup, the worker sends the signed envelope to the read-only `POST /api/room/validate` endpoint on `LAUNCHPAD_APP_ORIGIN`. The app checks that the exact owner, room, identity, mode, and experience still match an active SQLite session. This prevents a cached, otherwise valid room token from reviving an ended or replaced session. Validation fails closed if the app is unavailable. No Clerk key is sent, and redirects are disabled.

The agent sends reliable data packets only to the signed participant, on `launchpad.guide`:

```text
{type: 'draft', patch: {workspaceName?, projectName?, workflow?}}
{type: 'highlight', step: 'workspace'|'project'|'workflow'|'roles'|'confirm'}
{type: 'source', id, title, version, excerpt}
{type: 'navigate', tab: 'overview'|'workflow'|'roles'|'handbook'}
{type: 'cancel_actions'}
```

Accept these events only from participant `launchpad-guide`. Use the avatar's audio/video tracks and standard LiveKit transcription events for captions. There is no fake media or synthesized-success state. A draft event indicates delivery to the room, not persistence or acknowledgment of a visible form update. The user reviews the actual form before Create.

Production browser actions use the `launchpad.perform_action` RPC addressed only to the signed participant. Requests are `{version:1, actionId, kind, target}`; allowlisted kinds are navigate, stage, role, and faq. The browser must return `{version:1, actionId, applied:true}` after the real control is applied. A stale, false, missing, or malformed acknowledgement stops narration and advancement. This read-only RPC exposes no selectors, Create, reset, or saved-data mutations. A separate launchpad.create_task RPC accepts a version, request UUID, title, description, and fixed stage. Only the expected agent in saved-project help mode can call it; the browser uses the actual form and authenticated /api/tasks route. Success requires a matching committed receipt. A separate launchpad.move_task RPC accepts `{version:1, requestId, title, fromStage: Stage|null, stage}`. The browser resolves the title against the owner's loaded tasks with a shared key (NFKC, lowercase, letters and numbers only) and answers not_found, ambiguous (with the matching stages), or already_in_stage without clicking anything; otherwise it uses the visible Move task panel and the authenticated /api/tasks/stage route. Success requires a receipt bound to the request ID, destination stage, and title key. Creation and moving share one write path: one busy slot, no automatic retry, and no blanket cancel while a write is in flight. A lost or malformed receipt from either stays uncertain and blocks new voice task writes until the user checks the project. Trusted user clicks publish a bounded `user_navigation` marker on `launchpad.ui`; only the signed participant can stop this room's walkthrough through that channel. `project-home` and the New task and Move task control markers are accepted only as trusted manual markers, not as new remote action targets.

The walkthrough opens the project's Board, filters its List to Review tasks, selects Reviewer in People's conceptual permission inspector, and opens the Handoff answer in Help center. During onboarding, Setup and the selected workflow's unsaved Preview take the place of Board and List. Prepared narration uses the signed mode to name those views correctly. The internal wire IDs remain overview, workflow, roles, and handbook; they are not the spoken navigation labels. Each step retrieves its supporting source and uses `session.say` for a fixed narration of at most 18 words. This removes a new LLM request per section while retaining narration in chat history for follow-up Q&A. The next action waits for full speech playout. User speech, manual navigation, interrupted playback, or disconnection cancels queued advancement. An explicit continuation resumes from the interrupted section; concurrent duplicate tours are rejected. Q&A and Help can demonstrate these same controls. An unavailable UI action preserves the conversation.

Voice cancellation follows a new `user_state_changed` transition into speaking. The final `conversation_item_added` for an utterance can arrive after that utterance has already started its tool; it records timing without cancelling the newly requested walkthrough. Idle speech onset does not send a browser cancel packet. The installed-SDK regression reproduces this ordering and verifies that subsequent new speech still cancels a pending action.

The session is linked to the signed participant. Refresh/rejoin gets a 30-second grace window for the same identity; the worker then closes its avatar and deletes its own isolated room. End should call the authenticated server endpoint that deletes that user's room. The backend's original 15-minute session expiry caps worker lifetime, so refresh does not extend it. Loss of the avatar participant or its video ends the room instead of continuing an invisible conversation. A fresh room requires fresh signed dispatch metadata. Do not dispatch a second worker into the same active room on ordinary token refresh.

## Verification and real smoke test

No keys are needed for these local checks:

```sh
python3 -m unittest discover -s agent/tests -v
agent/.venv/bin/python -m unittest discover -s agent/tests_sdk -v
python3 -m compileall -q agent/agent.py agent/guide_core.py agent/tour.py agent/browser_actions.py agent/preflight.py agent/summarize_latency.py agent/config.py agent/session_validation.py
```

The first suite exercises real validation/retrieval and measured-log parsing with substituted packet/HTTP transport. Fake speech handles verify the tour's navigation order, playback gates, and interruption behavior. The SDK suite uses installed LiveKit classes and real provider-schema generation, and checks the dispatch acceptance boundary with a substituted backend status response. Neither suite tests a live LLM, microphone, WebRTC, Synthesia entitlement, or avatar rendering.

With your keys configured, do a real 60-second room test:

1. Start the worker and Next.js app. Sign in and start the guide. Allow the microphone. Confirm actual `launchpad-avatar` video and audio, an AI-guide introduction, and captions.
2. Say “Call the workspace Orbit Studio” and “My project is Mars launch.” Confirm draft updates and matching highlights.
3. Ask “How is Campaign different from Client Delivery?” Confirm a `workflows` version 1.0.0 source card. Ask a follow-up, then interrupt a reply with a correction.
4. Ask “Can you send real invites?” Expect the unsupported-feature response with the limits source. Ask an unrelated undocumented question; expect the explicit unknown response.
5. Press End and verify the avatar leaves and the room is removed. Repeat Start/End. Test mic denial, refresh/rejoin within 30 seconds, and a reconnect after expiry.
6. Separately verify the user presses Create, persistence survives refresh, a returning user skips setup, explicit task creation succeeds without changing existing tasks, an explicit move changes only that task's stage, and a second account cannot access the first account's room/project.

Only real observations count as a successful avatar smoke test. Startup errors are logged as safe `avatar_error` codes (including auth, plan, avatar eligibility, quota, and timeout). The app has no audio-only success fallback.

## Measured latency

`turn_timing` logs contain available SDK latency fields in milliseconds, with no transcript text. With the configured realtime brain, the SDK does not populate all pipeline-specific turn fields. `provider_timing` therefore records available provider timings separately. `room_connected`, `avatar_joined`, and `session_ready` measure startup stages. `guide_action_applied` measures browser acknowledgement time; `speech_requested`, `tour_narration_requested`, and `tour_step_completed` bound each narration. `narration_first_audio` measures TTS output before the avatar, not browser audio onset. The TTS connection is prewarmed during avatar startup; no speculative tour audio is generated. Capture local worker logs and run:

```sh
agent/.venv/bin/python agent/summarize_latency.py /path/to/your/local-worker.log
```

The report gives sample counts and p50/p95/max only for observed values. Empty logs report `no_measurements`. SDK end-to-end/playback metrics are not a separate measurement of the browser's final video render. Record browser-visible response onset separately if that timing matters. No vendor targets are presented as measurements.

Current vendor API and release references are recorded in [SOURCES.md](SOURCES.md).
