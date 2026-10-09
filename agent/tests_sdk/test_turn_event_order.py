"""Provider-free real-SDK event regression for the live late-transcript race."""
import asyncio
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tests'))
from agent import bind_tour_turn_events
from browser_actions import BrowserActions
from guide_core import GuideTools
from tour import TourController
from test_tour import Playback
from livekit.agents import AgentSession
from livekit.agents.llm import ChatMessage
from livekit.agents.voice.events import ConversationItemAddedEvent, UserStateChangedEvent


class TurnEventOrderTests(unittest.IsolatedAsyncioTestCase):
    async def test_same_turn_late_commit_does_not_cancel_new_walkthrough_but_next_speech_does(self):
        requests, speech = asyncio.Queue(), asyncio.Queue()
        transport_cancelled = asyncio.Event()
        published, stops, observed = [], [], []

        async def rpc(**options):
            gate = asyncio.Event()
            payload = json.loads(options['payload'])
            requests.put_nowait((payload, gate))
            try:
                await gate.wait()
            except asyncio.CancelledError:
                transport_cancelled.set()
                raise
            return json.dumps({'version': 1, 'actionId': payload['actionId'], 'applied': True})

        async def publish(event):
            published.append(event)

        def say(*_args, **_kwargs):
            handle = Playback()
            speech.put_nowait(handle)
            return handle

        actions = BrowserActions(rpc, 'signed-participant', lambda: True)
        operations = GuideTools(publish, experience='qa', perform_action=actions.perform)
        tour = TourController(operations, say)
        def stop():
            stops.append(actions.in_flight)
            tour.stop()

        async with AgentSession() as session:
            # These are exactly the two handlers registered by production entrypoint.
            bind_tour_turn_events(session, stop, lambda event, **fields: observed.append((event, fields)))
            session.emit('user_state_changed', UserStateChangedEvent(old_state='listening', new_state='speaking'))
            session.emit('user_state_changed', UserStateChangedEvent(old_state='speaking', new_state='listening'))
            self.assertEqual(stops, [False])  # original request's onset, while idle
            running = asyncio.create_task(tour.run())
            try:
                first, gate = await asyncio.wait_for(requests.get(), 1)
                self.assertEqual((first['kind'], first['target']), ('navigate', 'overview'))
                self.assertTrue(actions.in_flight)
                # Live failure ordering: the same user turn commits AFTER its tool/RPC began.
                session.emit('conversation_item_added', ConversationItemAddedEvent(
                    item=ChatMessage(role='user', content=['synthetic request fixture'])))
                await asyncio.sleep(0)
                self.assertEqual(stops, [False])
                self.assertFalse(tour.stop_event.is_set())
                self.assertFalse(transport_cancelled.is_set())
                self.assertTrue(actions.in_flight)
                gate.set()
                first_speech = await asyncio.wait_for(speech.get(), 1)
                self.assertFalse(actions.in_flight)
                self.assertEqual(published[-1]['type'], 'source')
                first_speech.released.set()
                second, _ = await asyncio.wait_for(requests.get(), 1)
                self.assertEqual((second['kind'], second['target']), ('stage', 'review'))
                # A genuinely later utterance must still cancel pending navigation.
                session.emit('user_state_changed', UserStateChangedEvent(old_state='listening', new_state='speaking'))
                result = await asyncio.wait_for(running, 1)
                self.assertEqual(stops, [False, True])
                self.assertEqual(result['status'], 'interrupted')
                self.assertEqual(result['completed_tabs'], ['overview'])
                self.assertTrue(transport_cancelled.is_set())
                self.assertFalse(actions.in_flight)
                self.assertTrue(speech.empty())
                self.assertTrue(requests.empty())
                self.assertTrue(any(name == 'turn_timing' for name, _ in observed))
            finally:
                if not running.done():
                    running.cancel()
                    await asyncio.gather(running, return_exceptions=True)
