# Posting runbook (for the scheduled posting tasks)

Vadim approved posting the drafts in this folder on the days in `calendar.md`. Each scheduled task names one slot. Do only that slot.

Repo: `/Users/vadim/Desktop/writing-assistant`. All files below are relative to `docs/marketing/`.

## How to post

1. Read `calendar.md` (the slot's row and the Reddit posting-day checklist), the slot's file and `POSTED.md`. If `POSTED.md` already lists the slot, stop: never post twice.
2. Use Claude in Chrome (Vadim's own Chrome, where he is signed in). Open a new tab for each site.
3. Post the text from the named file exactly. Leave out notes meant for Vadim: headings like "Rules", "Timing", "Notes", anything in `>` quote blocks above the post, and anything in brackets. Attach the media named in the calendar row (use the file upload tool with the absolute path). For `../demo.gif`, use `/Users/vadim/Desktop/writing-assistant/docs/demo.gif`.
4. After posting, open the live post and check that the text and media look right. If something is broken (formatting, missing image), edit the post if the site allows it.
5. Append a line to `POSTED.md`: date, slot, channel, URL, and anything odd.

## Hard stops (skip the item, log why in POSTED.md, carry on with the rest of the slot)

- Not signed in, a login page, 2FA prompt or CAPTCHA: never type a password or code, never sign in, never create an account, never solve a CAPTCHA.
- Reddit: the sub's current rules forbid the post, the account is under the karma minimum, or the megathread can't be found.
- The site shows an error, a ban or rate-limit message.
- A "Slop in, sentence out" day whose recording isn't in `video/recordings/` (`1.mp4` … `5.mp4`): post nothing for it.

## Never

- Reply to comments, vote, follow, like, or send DMs or emails. Newsletter outreach (`outreach.md` #7-11) is messages to people, so it isn't part of posting: leave it for Vadim.
- Change text beyond trimming notes, or add claims.
- Touch app code, commit, or push. The only git writes allowed are the awesome-list PRs below, made from forks with `gh`.

## Slot notes

- **Awesome-list PRs** (`outreach.md` #1-6): use `gh repo fork` and add one line in the list's own format, following its CONTRIBUTING rules. Open the PR with the drafted message as the body. If a list asks for an issue form instead, open the issue with the same text. Skip any list whose rules the project doesn't meet (stars, age).
- **Product Hunt**: Day 1 build the launch page from `launch/product-hunt.md` and save it as a draft. Day 6 schedule it for Mon 2026-11-23 12:01 AM PT. Day 7 post the maker comment on the live page.
- **Hacker News**: submit the title and URL. Then post the first comment from `launch/show-hn.md` as a reply to your own submission (that is the only comment allowed).
- **X thread**: post 1 with the GIF, then each post as a reply to the previous one. Pin post 1.
- **TikTok / Reels / Shorts**: upload `video/stilura-9x16.mp4` with the caption from the calendar row or the first hook in `messaging.md`.
- **DEV**: if the editor asks about AI assistance, mark the article as AI-assisted. Never pick "Hand Written".
