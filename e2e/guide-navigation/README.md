# Provider-free guide navigation test

From the repository root:

```sh
npx playwright test --config e2e/guide-navigation/playwright.config.ts
```

This test bundles the actual `LaunchpadTabs`, `ProjectTasks`, `TaskComposer`, `TaskMover`, and `useGuideActions` components with the already-installed esbuild. It renders them in an isolated Chrome page with all network requests blocked. It needs no running app, Clerk account, LiveKit room, environment file, or provider usage.

It checks Help → project → List/Preview → Review against the rendered task rows and final action acknowledgement, clearing a prior nonmatching task search through the actual control, plus manual takeover and a successful subsequent request. The fixture's action trigger exists only in this test bundle; no debug hook or test route is added to the product.

The modal regression proves a guide action cannot click through an open native dialog or report success, then verifies recovery after it closes. A 320px Board/List check covers page overflow and usable task search.

The actual `AvatarGuide` is also rendered at desktop and mobile sizes. Those checks verify fixed positioning relative to the document content edge (accounting for the stable scrollbar gutter), the 520px height cap, scrolling continuity, and no network requests when opening the widget or changing conversation type.

Task creation renders the real `TaskComposer` with the same guide driver. Five tests verify visible New task/Add task clicks, waiting for a committed receipt, preserving an existing manual draft, cancelling before a write, retrying an uncertain save with the same request ID, and 320/390px layouts. Only the API response is substituted; these tests do not claim real authentication, database writes, speech, or avatar media. Use the ordinary authenticated suite and a real room test for those layers.

Task movement renders the real `TaskMover` beside the composer with the same driver, using saved-style UUID task IDs. Eight tests verify visible Move task → stage → Move task clicks with no result before the held receipt (a tagged sample task, same LP reference, now in Review); busy with no clicks or requests while the New task form, Move panel, or task details are open; interruption before Move task writes nothing; an uncertain 503 that locks the fields and retries the identical body without a duplicate card; not found, already in stage, and ambiguous (with stages) requests that make no clicks or requests; create and move refusing each other while a save is in flight; the manual Move to another stage shortcut, which also clears a stale search; and 320/390px layouts. Only the API responses are substituted.
