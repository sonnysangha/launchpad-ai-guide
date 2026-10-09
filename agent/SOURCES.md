# Official integration sources

Checked 2026-10-05; speech, RPC, testing, nodes, and installed SDK source rechecked 2026-10-06. The product content in `../docs/product/` is original, fictional Launchpad documentation. Task creation updates first-project, board-stages, and limits to version 1.1.0; the other documents remain 1.0.0. Moving tasks (2026-10-08) updates board-stages and limits to 1.2.0. It is not vendor documentation.

- [Synthesia minimal quickstart](https://docs.synthesia.io/reference/interactive-avatar-minimal-quickstart): Python agent, text-only Realtime brain with separate STT/TTS, real-room testing, explicit dispatch, stream synchronization, and eligible Interactive IDs.
- [Official quickstart source](https://github.com/synthesia-ai/interactive-avatar-quickstarts/tree/main/minimal): model identifiers used as configurable defaults. Its sample avatar ID is deliberately not included.
- [LiveKit Cartesia voices](https://docs.livekit.io/agents/models/tts/cartesia/#voices): the configurable default is male voice Blake, `a167e0f3-df7e-4d52-a9c3-f949145efdab`.
- [LiveKit Synthesia integration](https://docs.livekit.io/agents/models/avatar/plugins/synthesia/): avatar lifecycle and typed entitlement/auth/quota errors.
- [LiveKit agent sessions](https://docs.livekit.io/agents/logic/sessions/): participant-linked room configuration and transcription output.
- [LiveKit function tools](https://docs.livekit.io/agents/logic/tools/definition): typed tool parameters and per-response tool controls.
- [LiveKit data packets](https://docs.livekit.io/transport/data/packets): reliable packets addressed to the authenticated participant.
- [LiveKit audio and speech](https://docs.livekit.io/agents/multimodality/audio): `SpeechHandle.wait_for_playout()` and interruption state used to pace the feature tour. Installed 1.8.4 source also verifies checking `SpeechHandle.exception()` after completion; waiting alone does not surface a provider error.
- [LiveKit agent events](https://docs.livekit.io/reference/agents/events/): `conversation_item_added` metrics for actual per-turn latency; the old session `metrics_collected` event is deprecated.
- [LiveKit RPC](https://docs.livekit.io/transport/data/rpc/): participant-directed browser calls and response timeouts; the installed Python `LocalParticipant.perform_rpc` accepts seconds. A separate asyncio timeout bounds transport plus response time.
- [LiveKit audio and speech](https://docs.livekit.io/agents/multimodality/audio/): `session.say` supports fixed text, interruption, transcript and chat-history preservation; optional cached audio exists but is not enabled here.
- [LiveKit nodes](https://docs.livekit.io/agents/logic/nodes/): wrapping `Agent.default.tts_node` measures the first generated audio frame without changing audio routing.
- [LiveKit observability](https://docs.livekit.io/testing/observability/data/): per-message `llm_node_ttft` and `tts_node_ttfb` are empty with realtime models. The deprecated but installed `metrics_collected` event supplies available provider timings without logging transcripts.
- [LiveKit unit tests](https://docs.livekit.io/testing/unit-tests/): roomless `AgentSession.run` for real-model tool selection, and separate deterministic effect assertions. Installed SDK also verifies `ToolResult(reply_required=False)` for code-owned narration.
- Installed `livekit.agents.inference.TTS.prewarm` delegates to the connection pool's non-blocking prewarm and synthesizes no text. It now overlaps the existing required avatar startup; voice and model settings remain unchanged. The official Synthesia minimal agent still uses the same text-only realtime/STT/TTS architecture.
- [LiveKit Python source at release commit e684c2379e1c385afe8edcd1f02ea422051b035f](https://github.com/livekit/agents/tree/e684c2379e1c385afe8edcd1f02ea422051b035f): verified `JobRequest.accept(identity=...)`, `room_io.RoomOptions(participant_identity=...)`, `AgentSession.start(record=False, session_host=False)`, `ToolError`, avatar startup/cleanup, and reconnect behavior.

Pinned primary dependencies, verified against official PyPI stable releases:

| Package | Version | Release source |
| --- | --- | --- |
| livekit-agents (openai, silero extras) | 1.8.4 | [PyPI](https://pypi.org/project/livekit-agents/1.8.4/) |
| livekit-plugins-synthesia | 1.8.4 | [PyPI](https://pypi.org/project/livekit-plugins-synthesia/1.8.4/) |
| python-dotenv | 1.2.4 | [PyPI](https://pypi.org/project/python-dotenv/1.2.4/) |

The two LiveKit releases are published from commit `e684c2379e1c385afe8edcd1f02ea422051b035f`, as recorded in their PyPI provenance. No private SDK, OAuth MCP, sample avatar ID, speculative Realtime patch, or audio-only/mock fallback is used.

## Guide audit, 2026-10-06

Rechecked the [Synthesia plugin reference](https://docs.synthesia.io/reference/ia-livekit-plugin-reference), [LiveKit RPC](https://docs.livekit.io/transport/data/rpc/), and [speech control](https://docs.livekit.io/agents/multimodality/audio/) against installed Agents/Synthesia 1.8.4 and RTC 1.1.20. Avatar attachment precedes session start, the browser registers its bound RPC before connecting, and tour narration waits for acknowledged UI changes and completed speech. Installed signatures for `AvatarSession.start`, `AgentSession.start`, `LocalParticipant.perform_rpc`, `SpeechHandle.wait_for_playout`, `SpeechHandle.exception`, and `TTS.prewarm` match their usage. This audit required no provider or model call.

The browser action controller now also verifies the click point reaches its real target. [Native modal dialogs make the rest of the document inert](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal) without requiring an `inert` attribute. A provider-free regression reproduced background navigation and a false successful acknowledgement before this guard; it now rejects the obstructed action and succeeds after the dialog closes. See `../e2e/guide-navigation/README.md` for the isolated actual-component checks.

## Task creation and conversational follow-ups

The task write uses the installed SDK's `RunContext.disallow_interruptions()` and `ToolFlag.IGNORE_ON_ENTER` to avoid losing a committed result through speech interruption. The browser still permits manual takeover before sending the save; after submission, it reports the durable receipt. Unknown outcomes are not automatically retried by the agent. The authenticated application endpoint enforces ownership and request-id idempotency independently of the model.

Stage demonstrations reuse the documented `session.say(..., add_to_chat_ctx=True)` and `SpeechHandle.wait_for_playout()` pattern for one short sourced explanation, with `ToolResult(reply_required=False)` preventing duplicate model narration. Follow-up intent and answers remain model-generated. Successful demonstration tools return the confirmed stage and next workflow stage, rather than implying the agent can continuously see the browser.
