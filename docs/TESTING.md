# Testing

| Command                            | What it covers                                                                                                                                        | Needs Supabase |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `npm run test:unit`                | Validation, permissions, media helpers, upload state machine, threads; TUS client against a real local TUS server                                     | No             |
| `npm run test:db`                  | Every migration plus RLS, trigger and storage-policy tests in PGlite, run with and without default grants                                             | No             |
| `npm run test:browser`             | Review viewers, comments, client-portal mode and decisions, AI Studio brief form and script editor in Chromium (run `npm run build` first)            | No             |
| `npm run check:bundle`             | After a build: no secret names, AI SDK code or key-shaped values in the browser bundles                                                               | No             |
| `npm run test:ai-live`             | One real request to the provider in `AI_PROVIDER` only (Gemini: one free-tier request; Anthropic: a few cents); see [SETUP.md](SETUP.md#live-ai-test) | Provider key   |
| `npm run verify:supabase`          | Configuration, auth settings, migrations, buckets, upload limits (read-only)                                                                          | Yes            |
| `npm run verify:supabase -- --e2e` | Real flows against your project with throwaway users, cleaned up afterwards                                                                           | Yes            |

## Phase 5 AI Studio manual checklist (real Supabase + Gemini)

**Status: not run yet.** Needs `GEMINI_API_KEY` and `GEMINI_MODEL` (a free-tier model, project without billing) and
`SUPABASE_SECRET_KEY` on the server, and migration `20261005000000` applied. Each generation uses one request of the
project's free daily quota (with `AI_PROVIDER=anthropic`, each one is a billed request instead).

1. Without `GEMINI_API_KEY` (or `GEMINI_MODEL`): `/app/ai-studio` shows "isn't set up", names the missing setting,
   and the form is disabled; nothing is counted. The page and the brief note name Google Gemini.
2. With the keys: generate from a short brief (< 20 characters) → field error, no usage counted. Generate from a real
   brief linked to a project → "Writing your script…", then the script page opens with scenes, model and tokens.
   The usage meters go up by one; the dashboard activity shows "generated a script".
3. Edit: change a line, move a scene, add a scene with no heading → save is refused naming the scene; fill it in
   and save → "Script saved", "edited by you" appears, total length is recalculated.
4. As a **member** who didn't create it: the script is readable but there is no Edit, Details or Delete. As a
   **manager**: all three are available.
5. Details: rename and link to another project; the project link in the sidebar card follows.
6. "New version" opens the form prefilled with the brief; generating creates a second script and keeps the first.
7. Failure: set `GEMINI_MODEL=gemini-does-not-exist-1` and generate → a clear model error and a "View the failed
   run" link; the failed run shows "Try again". Restore the model afterwards. (A model without free quota is
   reported as such; when the daily free quota runs out, the message says it resets at midnight Pacific time.)
8. Delete a script → back to the list; the activity shows "deleted the script".
9. A client-role user gets a 404 at `/app/ai-studio`; the sidebar has no AI Studio link for them.

## Phase 4 manual browser checklist (real Supabase)

**Status: not run yet.** Apply the Phase 4 migration first (see [SETUP.md](SETUP.md), "Applying later migrations"),
then run `npm run verify:supabase -- --e2e`.

You need three sessions (for example two browsers plus a private window): **Owner** (owner or admin), **Manager**
(role manager), and **Client** (a new email address you can sign in with). Use a project that has a client and at
least one uploaded video.

1. **Invite the client.** As Manager: Clients → the client → **Portal access** → **Invite to portal**, enter the
   Client's email, and copy the link. The invitation is listed as pending. Team → Invite people is still only shown
   to owners and admins, and the Team page doesn't list client invitations.
2. **Join the portal.** As Client, open the link, sign up or sign in with that email, and click Join. You land on
   `/portal` with "You now have access…", not on `/app`. Opening `/app` sends you back to `/portal`.
3. **Nothing is visible yet.** The portal shows "Nothing shared yet". As Owner, open the project → **Client portal
   & approvals** → **Portal settings**: tick **Show in the client portal**, add a summary, keep **Allow downloads**
   on, and save.
4. **What the client sees.** As Client, reload `/portal`. The project appears with its summary and status, but
   never its budget, internal brief, tasks or the client's internal notes. "No files shared yet" is shown.
5. **Request approval.** As Manager, open the video → **Client approval** → **Request approval**, add a message and
   a due date, and send. The file is now "Shared". The card shows "Awaiting approval", the project status is
   **In review**, and `/app/approvals` lists the request.
6. **Notification and review.** As Client, the bell shows "Approval requested: …". Click it to open the file in
   the portal. Play it and post a timestamped comment with a pin. There is no **Internal note** option and no
   **Resolve** button. Internal notes added by the team (step 6 of Phase 3) aren't shown.
7. **Request changes.** As Client, **Request changes**, try to send it empty (it asks for a note), then describe
   the change and send. As Manager: the bell shows "Changes requested: …". The project is in **Revisions** and
   **Revision rounds** shows Round 1 with the note. Set the round to **Completed**.
8. **New version and approval.** As Manager, upload v2 of the file and request approval on v2. As Client, open
   it from the portal and **Approve**. The project status becomes **Approved**. The dashboard activity shows the
   request, the change request, the round, and the approval, all linked.
9. **Guards.** As Manager, request approval on a version, then try **Stop sharing** on it, or untick **Show in the
   client portal**. Both are refused until you **Cancel request**. A second request on the same version isn't
   offered while one is pending.
10. **Downloads off.** As Owner, turn **Allow downloads** off. As Client, reload the file: there is no Download
    button (for formats the browser can't preview, the message no longer says "Download to view"). Turn it back on,
    and Download returns.
11. **Remove access.** As Manager, on the client page remove the Client's portal access. As Client, reload: you
    no longer have access to the workspace (with no other workspace, you're sent to create one).

## Phase 3 manual browser checklist (real Supabase)

**Status: passed.** All 10 steps passed against the real project, and `verify:supabase -- --e2e` reported 64 passed,
1 warning, 0 failed.

Use two browsers, or a normal and a private window, signed in as two members of the same workspace. Use real files:
an MP4 (H.264), an image, an MP3/WAV, a PDF, and if you have one a ProRes `.mov` or an `.avi`.

1. **Upload a video.** Project → Files & reviews → drag the MP4 in. Progress moves in steps of up to 6 MB, then
   "Verifying upload…", then "Uploaded". A card appears with a thumbnail, duration and `v1`.
2. **Pause, resume and retry.**
   - Pause a large upload, wait, then resume. It continues from where it stopped.
   - Turn off Wi-Fi mid-upload. It shows "connection was lost"; turn Wi-Fi back on and click Retry.
   - Close the tab mid-upload, reopen the project, click **Resume** on the unfinished card, and pick the same file.
3. **Play it.** Open the card. The video plays, the scrubber seeks, and timecode, frame step (← →) and speed all
   work. Press `F` for fullscreen.
4. **Comment with a pin.** Press `C`, type a comment, click **Add pin**, click the frame, and post. A marker appears
   on the timeline and the pin shows when paused at that time.
5. **Live update.** In the second window open the same file and post a comment. It appears in the first window
   without refreshing, and the panel header shows "Live".
6. **Threads.** Reply, edit your own comment (it shows "(edited)"), check that you can't edit the other person's
   comment, then resolve and reopen. Switch between the Open, Resolved and All filters. Add an **Internal note**.
7. **Versions.** Card menu → **Upload new version**. It becomes `v2`, the review page offers "Newer version
   available", and the version list switches between v1 and v2. Comments are per version.
8. **Other formats.**
   - An image supports pins.
   - Audio shows timeline markers.
   - A PDF shows inline, with "open in a new tab".
   - A ProRes `.mov`/`.avi` that your browser can't decode shows "This format cannot be previewed in the browser.
     Download to view." and **Download** works.
   - A `.zip` is rejected before uploading.
   - A file over your plan's limit shows the size error.
9. **Reviews & activity.** `/app/reviews` lists the file with its open-comment count. The filters (project, type,
   open comments) and sorting work. The dashboard activity shows the upload, the version, comments and resolution,
   linked.
10. **Deletion.** Delete one version from the version list, then delete the file from its card. In the Supabase
    dashboard → Storage → `project-assets`, the asset folders are gone. Delete a project that has files, and its
    `{workspace}/{project}` folder is gone too.
