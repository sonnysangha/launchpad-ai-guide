# Browser verification

Run `npm run build` and `npm run start` to serve the production build on
`http://127.0.0.1:3212`, then run `npm run test:e2e` in another terminal.
Tests launch a separate headless Chrome profile. Set `PLAYWRIGHT_CHANNEL=chromium`
to use a locally installed Playwright Chromium browser instead.

`.env.local` must contain this application's Clerk development keys. The suite
refuses production keys. It uses Clerk's official testing-token helper and real
signup/sign-in forms with unique `+clerk_test@example.com` email addresses and
the development verification code `424242`. Passwords are generated in memory.
No fake authentication route, app auth bypass, or saved browser state is used.

The authenticated scenario verifies draft validation, explicit confirmation,
SQLite-backed persistence after refresh, returning-user routing, two-user
isolation, Help reopening, and reset scoped to the signed-in user. It also checks
the Setup/Preview and Board/List views, arrow/Home/End keyboard navigation,
preserved drafts and filters, People access explanations, Help center accordions,
all three guide modes inside the widget, and widget
opening/collapse without allocating a room. Ordinary tests intercept room-start
requests defensively so a regression cannot accidentally create a paid session. Teardown
resets only each generated user's sample workspace and deletes only Clerk users
whose exact email belongs to the current run. It never lists or deletes broadly.

A separate step injects an incomplete room response and failed End response to
verify that End remains available, Create does not POST or navigate, and the
draft survives until cleanup can be retried. This step creates no real room and
does not simulate a working avatar, media, or successful LiveKit connection.

The default suite does **not** start an avatar session or validate audiovisual latency,
turn-taking, interruption, or Synthesia entitlement. Those require the separate
real-room smoke test in [agent/README.md](../agent/README.md). No mocked avatar success is reported.

Traces, automatic screenshots, videos, and auth-state files are disabled. The
only screenshots are fictional onboarding and saved project pages, under the
ignored `e2e/.artifacts/` folder.

Official guidance checked October 5, 2026:
- https://clerk.com/docs/guides/development/testing/playwright/overview
- https://clerk.com/docs/guides/development/testing/playwright/test-sign-up-flows
- https://clerk.com/docs/guides/development/testing/playwright/test-helpers
