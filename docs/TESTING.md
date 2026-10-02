# Testing

| Command                            | What it covers                                                                                                    | Needs Supabase |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------- |
| `npm run test:unit`                | Validation, permissions, media helpers, upload state machine, threads; TUS client against a real local TUS server | No             |
| `npm run test:db`                  | Every migration plus RLS, trigger and storage-policy tests in PGlite, run with and without default grants         | No             |
| `npm run test:browser`             | Review viewers and the comment workflow in Chromium, with generated media (run `npm run build` first)             | No             |
| `npm run verify:supabase`          | Configuration, auth settings, migrations, buckets, upload limits (read-only)                                      | Yes            |
| `npm run verify:supabase -- --e2e` | Real flows against your project with throwaway users, cleaned up afterwards                                       | Yes            |

## Phase 3 manual browser checklist (real Supabase)

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
