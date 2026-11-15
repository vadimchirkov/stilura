# 14-day launch calendar and metrics

Day 0 is **Monday 2026-11-16**, so Show HN lands on Wednesday. If you start later, keep the weekdays: Show HN on a Tuesday or Wednesday. Note that US Thanksgiving is Thursday 2026-11-26 (Day 10); expect a quiet US audience on Days 10-11, so nothing important is scheduled there.

Paths are relative to `docs/marketing/`. Rewrite every draft in your own words before posting (channels.md explains why). Never ask anyone for upvotes on HN or Product Hunt.

| Day | Date | Time (PT) | Channel | What to post | File |
|---|---|---|---|---|---|
| 0 | Mon 11-16 | 9:00 | X | Teaser post with the bingo card (text below) | `assets/slop-bingo.png` |
| 0 | Mon 11-16 | any | GitHub | Upload the social preview (Settings → Social preview); apply any README changes you agree with. Description and topics are already done | `readme-suggestions.md`, `assets/og-image.png` |
| 1 | Tue 11-17 | any | Awesome lists | Outreach batch 1: PRs to awesome-markdown-editors, awesome-writing-tools, awesome-note-taking | `outreach.md` #1-3 |
| 1 | Tue 11-17 | any | Product Hunt | Build the launch page and **save as draft** (schedule only when complete) | `launch/product-hunt.md` |
| 2 | Wed 11-18 | 9:00 | Hacker News | Show HN, then stay in the thread for ~6 hours | `launch/show-hn.md` |
| 2 | Wed 11-18 | 11:00 | X | Launch thread, demo GIF on post 1, pin it | `launch/x-thread.md` + `../demo.gif` |
| 3 | Thu 11-19 | 8:00 | r/ClaudeAI | Showcase post (only if built with Claude Code; karma ≥ 50, else the showcase hub) | `launch/reddit/ClaudeAI.md` |
| 4 | Fri 11-20 | 8:00 | r/ChatGPTPro | Workflow post | `launch/reddit/ChatGPTPro.md` |
| 4 | Fri 11-20 | any | Awesome lists | Outreach batch 2: awesome-claude-code (issue form), awesome-claude-skills, Awesome-AITools | `outreach.md` #4-6 |
| 5 | Sat 11-21 | 9:00 | r/SideProject | Project post with the GIF | `launch/reddit/SideProject.md` |
| 6 | Sun 11-22 | any | r/ChatGPT | One comment in the pinned weekly self-promotion megathread | `launch/reddit/ChatGPT-megathread.md` |
| 6 | Sun 11-22 | any | Product Hunt | Schedule the launch for Day 7 (12:01 AM PT) | `launch/product-hunt.md` |
| 7 | Mon 11-23 | 12:01 | Product Hunt | Launch goes live; post the maker comment, answer comments all day | `launch/product-hunt.md` |
| 7 | Mon 11-23 | 8:00 | r/selfhosted | One comment in the New Project Megathread, only if it takes local apps | `launch/reddit/selfhosted-megathread.md` |
| 7 | Mon 11-23 | 9:00 | X | "We're on Product Hunt" post with the before/after card; ask for feedback, not votes | `assets/before-after.png` |
| 7 | Mon 11-23 | any | Newsletters | Outreach batch 3: Console.dev, Changelog News, Node Weekly | `outreach.md` #7-9 |
| 8 | Tue 11-24 | 7:00 | DEV | Article (after you've done the real before/after it describes) | `launch/devto-article.md` |
| 8 | Tue 11-24 | 10:00 | X, TikTok, Reels, Shorts | Vertical cut of the demo | `video/stilura-9x16.mp4` (X: `video/stilura-4x5.mp4`) |
| 9 | Wed 11-25 | 10:00 | X + vertical | Slop in, sentence out #1: corporate blog post (record it first) | `video/scripts.md` §1 |
| 9 | Wed 11-25 | any | Newsletters | Outreach batch 4: Dense Discovery, Ness Labs | `outreach.md` #10-11 |
| 10 | Thu 11-26 | | | Thanksgiving: reply to comments only | |
| 11 | Fri 11-27 | 10:00 | X + vertical | #2: cover letter | `video/scripts.md` §2 |
| 12 | Sat 11-28 | 10:00 | X + vertical | #3: README intro, or the best reply to the Day 2 challenge | `video/scripts.md` §3 |
| 13 | Sun 11-29 | 10:00 | X + vertical | #4: product description | `video/scripts.md` §4 |
| 13 | Sun 11-29 | any | Replies | Outreach batch 5, only where a thread fits: #12-15 | `outreach.md` #12-15 |
| 14 | Mon 11-30 | 10:00 | X + vertical | #5: email, plus a short thread of numbers so far | `video/scripts.md` §5 |

The 12-second hook (`video/stilura-hook-12s.mp4`) is the spare: use it as a reply when someone asks "what does it do?", or as the X post on any day a recording isn't ready.

Comment-only channels (r/LocalLLaMA, r/ObsidianMD, r/PKMS, r/Markdown) and dropped ones (r/opensource, r/programming, Lobsters) have no slots. Answer questions there if they come up; don't post the link unprompted.

## Posting-day checklist for Reddit

The Reddit rules in channels.md come from third-party mirrors, because Reddit blocked every automated read (last tried 2026-11-15). Before each Reddit post or megathread comment, logged in as yourself:

- [ ] Open the sub's rules page (`https://www.reddit.com/r/<sub>/about/rules`) and the sidebar. Compare with the row in channels.md and with the note at the top of the draft. If anything changed (promo ratio, flair, AI-content rule, showcase rules), fix the draft first or skip the sub.
- [ ] Check the karma minimum against your account: r/ClaudeAI feed posts need total karma ≥ 50 (else use the Project Showcase hub thread); r/ChatGPT's megathread needs 5 comment karma. Look for a minimum account age too.
- [ ] For megathread-only subs (r/ChatGPT, r/selfhosted), open the sub, find this week's pinned megathread and copy its link. Don't reuse last week's thread.
- [ ] Make sure your Reddit activity stays under the ~10% self-promotion line (r/ChatGPTPro states it as a rule).
- [ ] Read the draft once more and reword it in your own voice. Several subs remove AI-written posts.
- [ ] Be free to answer comments for the next two hours.

## Day 0 teaser post for X (≤280)

```
I made an AI slop bingo card for reading launch posts. "Delve", "a testament to", "in today's fast-paced landscape", the em dash pileup.

On Wednesday I'm launching the editor I built to get these out of my own drafts.
```

(218 characters. Attach `assets/slop-bingo.png`.)

## Day 7 Product Hunt post for X (≤280)

```
Stilura is on Product Hunt today: a Markdown editor where AI edits only the text you select, and nothing lands until you press Tab.

I'd like your feedback in the comments, especially on what you'd put in your style.md.
[Product Hunt link]
```

## Metrics

Write the numbers down each evening in a simple table (date, stars, npm downloads, release downloads, HN, PH, video views, replies).

| Metric | How to read it | Baseline (2026-11-15) | 14-day target |
|---|---|---|---|
| GitHub stars | `gh api repos/vadimchirkov/stilura --jq .stargazers_count` | 2 | 300 |
| npm downloads, weekly | `curl -s https://api.npmjs.org/downloads/point/last-week/stilura` | 307 (11-08 to 11-14) | 1,000 in a week |
| npm downloads, daily | `curl -s https://api.npmjs.org/downloads/range/last-month/stilura` | 285 on 11-14 | |
| npm version check | `npm view stilura version` | 0.7.3 | |
| Desktop release downloads | `gh api repos/vadimchirkov/stilura/releases --jq '[.[].assets[].download_count]\|add'` | 10 (all releases) | |
| HN rank and points | the Show HN item page; front-page position via https://news.ycombinator.com/front | | front page for 1+ hour |
| Product Hunt rank | the launch page and the daily leaderboard | | top 10 of the day |
| Video views and replies | X analytics per post; TikTok/YouTube Studio | | 20+ challenge replies by Day 9 |
| Referrers | GitHub → Insights → Traffic (shows top referrers for 14 days) | | |

npm counts include CI and mirrors, so read them as a trend, not as people. The 300-star and 1k-download targets are from the plan; the median Show HN gets 2 points (channels.md), so treat them as a stretch, and look at which channel sent the traffic before repeating it.
