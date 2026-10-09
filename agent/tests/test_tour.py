import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from guide_core import GuideTools, ValidationError
from tour import TOUR_SECTIONS, TourController, run_feature_tour


class Playback:
    def __init__(self):
        self.id = 'test-speech'
        self.released = asyncio.Event()
        self.interrupted = False
        self.error = None

    async def wait_for_playout(self):
        await self.released.wait()

    def exception(self):
        return self.error

    def interrupt(self, *, force=False):
        self.interrupted = True
        self.released.set()


class PacedTourTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.events = []
        self.actions = asyncio.Queue()
        self.replies = asyncio.Queue()
        self.stop = asyncio.Event()
        self.action_gates = []
        self.action_cancelled = False

        async def publish(event):
            self.events.append(event)

        async def action(kind, target):
            gate = asyncio.Event()
            self.action_gates.append(gate)
            self.actions.put_nowait((kind, target, gate))
            try:
                await gate.wait()
            except asyncio.CancelledError:
                self.action_cancelled = True
                raise
            self.events.append({'type': 'applied', 'kind': kind, 'target': target})
            return {'status': 'applied'}

        self.tools = GuideTools(publish, experience='qa', draft={'projectName': 'Keep unchanged'}, perform_action=action)

    def say(self, text, **options):
        self.assertTrue(options['allow_interruptions'])
        self.assertTrue(options['add_to_chat_ctx'])
        self.assertLessEqual(len(text.split()), 18)
        handle = Playback()
        self.replies.put_nowait(handle)
        self.events.append({'type': 'speech', 'text': text})
        return handle

    def test_tour_sources_support_each_explanation_instead_of_false_refusals(self):
        for section, source in zip(TOUR_SECTIONS, ['first-project', 'board-stages', 'roles', 'board-stages']):
            result = self.tools.documents.lookup(section.query)
            self.assertEqual(result['status'], 'documented')
            self.assertIn(source, [item['id'] for item in result['sources']])

    async def test_narration_matches_saved_project_views_and_unsaved_onboarding(self):
        for mode, labels in [('help', ('Board', 'List')), ('onboarding', ('Setup', 'Preview'))]:
            with self.subTest(mode=mode):
                spoken = []
                async def applied(kind, target):
                    return {'status': 'applied', 'kind': kind, 'target': target}
                async def publish(_event):
                    pass
                def say(text, **options):
                    spoken.append(text)
                    self.assertLessEqual(len(text.split()), 18)
                    handle = Playback()
                    handle.released.set()
                    return handle
                operations = GuideTools(publish, mode=mode, experience='qa', perform_action=applied)
                result = await run_feature_tour(operations, say, asyncio.Event())
                self.assertEqual(result['status'], 'completed')
                self.assertIn(labels[0], spoken[0])
                self.assertIn(labels[1], spoken[1])
                self.assertEqual('unsaved' in spoken[1], mode == 'onboarding')
                self.assertIn('example Reviewer role', spoken[2])
                self.assertIn('People lists your account', spoken[2])
                self.assertIn('Help center', spoken[3])

    async def next_action(self):
        return await asyncio.wait_for(self.actions.get(), 1)

    async def next_speech(self):
        return await asyncio.wait_for(self.replies.get(), 1)

    async def test_ack_sources_speech_playout_order_for_actual_feature_controls(self):
        task = asyncio.create_task(run_feature_tour(self.tools, self.say, self.stop))
        expected = [('navigate', 'overview'), ('stage', 'review'), ('role', 'reviewer'), ('faq', 'handoff')]
        for pair in expected:
            kind, target, gate = await self.next_action()
            self.assertEqual((kind, target), pair)
            self.assertTrue(self.replies.empty(), 'Speech must wait for actual UI acknowledgement')
            gate.set()
            handle = await self.next_speech()
            self.assertEqual(self.events[-2]['type'], 'source')
            await asyncio.sleep(0)
            self.assertTrue(self.actions.empty(), 'Next action must wait for narration playout')
            handle.released.set()
        result = await task
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['completed_tabs'], ['overview', 'workflow', 'roles', 'handbook'])
        self.assertEqual(self.tools.draft, {'projectName': 'Keep unchanged'})
        self.assertFalse(any(event['type'] == 'draft' for event in self.events))

    async def test_user_speech_cancels_pending_action_without_narration(self):
        task = asyncio.create_task(run_feature_tour(self.tools, self.say, self.stop))
        await self.next_action()
        self.stop.set()
        self.assertEqual((await asyncio.wait_for(task, 1))['status'], 'interrupted')
        self.assertTrue(self.action_cancelled)
        self.assertTrue(self.replies.empty())
        self.assertEqual(self.events, [])

    async def test_user_speech_interrupts_narration_without_next_action(self):
        observed = []
        task = asyncio.create_task(run_feature_tour(self.tools, self.say, self.stop,
                                  observe=lambda event, **fields: observed.append((event, fields))))
        _, _, gate = await self.next_action()
        gate.set()
        handle = await self.next_speech()
        self.stop.set()
        self.assertEqual((await asyncio.wait_for(task, 1))['status'], 'interrupted')
        self.assertTrue(handle.interrupted)
        self.assertTrue(self.actions.empty())
        evidence = next(fields for event, fields in observed if event == "tour_narration_interrupted")
        self.assertEqual(evidence["tab"], "overview")
        self.assertEqual(evidence["speech_id"], handle.id)

    async def test_action_failure_never_narrates_or_advances(self):
        async def failure(*_):
            raise ValidationError('Browser action was not confirmed.')
        self.tools.perform_action = failure
        with self.assertRaises(ValidationError):
            await run_feature_tour(self.tools, self.say, self.stop)
        self.assertTrue(self.replies.empty())
        self.assertEqual(self.events, [])

    async def test_interrupted_or_failed_playback_does_not_advance(self):
        for fails in (False, True):
            with self.subTest(fails=fails):
                task = asyncio.create_task(run_feature_tour(self.tools, self.say, self.stop))
                _, _, gate = await self.next_action()
                gate.set()
                handle = await self.next_speech()
                handle.interrupted = not fails
                handle.error = RuntimeError('provider detail') if fails else None
                handle.released.set()
                if fails:
                    with self.assertRaises(ValidationError) as caught:
                        await task
                    self.assertNotIn('provider detail', str(caught.exception))
                else:
                    self.assertEqual((await task)['status'], 'interrupted')
                self.assertTrue(self.actions.empty())

    async def test_prior_speech_prevents_any_tour_effect(self):
        self.stop.set()
        self.assertEqual((await run_feature_tour(self.tools, self.say, self.stop))['status'], 'interrupted')
        self.assertEqual(self.events, [])
        self.assertTrue(self.actions.empty())

    async def test_duplicate_tour_is_rejected_and_resume_skips_completed_overview(self):
        controller = TourController(self.tools, self.say)
        first = asyncio.create_task(controller.run())
        _, _, gate = await self.next_action()
        self.assertEqual(await controller.run(), {'status': 'already_running'})
        gate.set()
        (await self.next_speech()).released.set()
        kind, target, _ = await self.next_action()
        self.assertEqual((kind, target), ('stage', 'review'))
        controller.stop()
        self.assertEqual((await first)['next_index'], 1)
        second = asyncio.create_task(controller.run())
        kind, target, _ = await self.next_action()
        self.assertEqual((kind, target), ('stage', 'review'))
        controller.stop()
        await second

    async def test_task_cancellation_cleans_up_pending_action(self):
        task = asyncio.create_task(run_feature_tour(self.tools, self.say, self.stop))
        await self.next_action()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(self.action_cancelled)
        self.assertTrue(self.replies.empty())

    async def test_sdk_tool_cancellation_preserves_completed_sections_for_resume(self):
        controller = TourController(self.tools, self.say)
        task = asyncio.create_task(controller.run())
        _, _, gate = await self.next_action()
        gate.set()
        (await self.next_speech()).released.set()
        await self.next_action()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertFalse(controller.active)
        self.assertEqual(controller.next_index, 1)
