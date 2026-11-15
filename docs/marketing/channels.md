# Channels: rules, timing, comparables

Researched 2026-11-15. Rules change; open the official page again on the day you post.

How sources were checked: reddit.com blocks automated readers, so subreddit rules were read from third-party mirrors that quote the rules page verbatim and date their snapshot. Each row gives the official rules URL (open it yourself before posting) and the mirror the quote came from. reddit.com, help.x.com and indiehackers.com refuse scripted requests but open in a normal browser. Second attempt on 2026-11-15 also failed for all five subs we post in: `www.reddit.com/r/<sub>/about/rules.json` returned 403, old.reddit.com returned a 403 "Blocked" page, the exa fetch tool returned SOURCE_NOT_AVAILABLE, and the built-in browser refuses reddit.com. So none of the Reddit rows below are first-hand; read the rules yourself on posting day (calendar.md has the checklist).

## The rule that applies everywhere: write it yourself

Several channels now remove AI-written posts:

- Hacker News: "Don't post generated text or AI-edited text. HN is for conversation between humans." ([newsguidelines](https://news.ycombinator.com/newsguidelines.html))
- r/LocalLLaMA rule 3: "Completely/primarily LLM generated copy, code is not allowed." ([mirror](https://www.subredditmarketing.com/subreddits/localllama))
- DEV: articles must carry an AI disclosure tier, and AI-assisted articles "should not promote any business, program, or course (including your own)." ([guidelines](https://dev.to/guidelines-for-ai-assisted-articles-on-dev), [disclosure tiers](https://dev.to/devteam/introducing-ai-disclosure-on-dev-tools-for-nuance-clarity-and-better-feeds-34mk))

The drafts in `launch/` are outlines with the facts checked. Rewrite each one in your own words before posting, especially the Show HN comment and the dev.to article. For a product about not sounding like AI, getting caught posting AI copy would end the launch.

## Status of every channel

| Channel | Status | Rule (quoted or summarized) | Source |
|---|---|---|---|
| Hacker News, Show HN | **Post** | "Show HN is for something you've made that other people can play with." Must be tryable without signup; title starts with "Show HN"; no asking for upvotes; be around to answer. | https://news.ycombinator.com/showhn.html |
| Hacker News, general | (rules) | "Please don't use HN primarily for promotion. It's ok to post your own stuff part of the time." "Don't solicit upvotes, comments, or submissions." No uppercase or exclamation points in titles. | https://news.ycombinator.com/newsguidelines.html |
| Product Hunt | **Post** | Launch goes live 12:01 AM PT on the scheduled date; schedule up to 30 days ahead. Tagline up to 60 characters, name up to 40, description up to 500 (another PH page says 260; stay under 260). Gallery 1270x760 recommended. "Never ask for upvotes." Personal account only. | https://help.producthunt.com/en/articles/17734646-8-launch-faq-and-myths , https://help.producthunt.com/en/articles/17834537-4-build-your-product-page , https://help.producthunt.com/en/articles/17734384-5-how-to-promote-your-launch-and-what-to-avoid |
| X | **Post** | No self-promotion limit. Platform rules ban spam behavior such as bulk unsolicited replies and mentions. | https://help.x.com/en/rules-and-policies/authenticity |
| DEV (dev.to) | **Post, human-written** | AI-assisted articles need a disclosure tier and should not promote your own product. Write this one yourself and mark it "Hand Written" or "AI-Assisted" honestly. | https://dev.to/guidelines-for-ai-assisted-articles-on-dev |
| Lobsters | **Skip for now** | Invite-only. "Self-promo should be less than a quarter of one's stories and comments in the last year." New users (first 70 days) can't post self-promo or use the `show` tag. | https://lobste.rs/about |
| Indie Hackers | **Post (milestone)** | No published self-promotion rule. Founder's advice: lead with the lesson, link at the end. Product Hunt's own guide warns against dropping links on IH on launch day if you haven't posted there before. | https://launchloop.dev/blog/how-to-launch-on-indie-hackers (summary of IH founder posts), https://www.indiehackers.com/terms |
| r/ClaudeAI | **Post** (if you built it with Claude Code) | Rule 7: showcase allowed if "built with Claude/Claude Code or specifically for Claude BY YOU", clear description of what was built and how Claude helped, "free to try and say so", "promotional language minimal", no referral links. Feed posts need total karma ≥ 50 (as of 2026-11-14); otherwise use the Project Showcase hub. | https://www.reddit.com/r/ClaudeAI/about/rules ; mirrors: https://reddifier.com/free-subreddit-analysis-tool/r/ClaudeAI , https://readmex.ai/story/claude-project-showcase-discussion-hub-updated-on-14-november-2026-sor-cfb30b73 |
| r/ChatGPTPro | **Post** | Rule 3: "Made something useful? Explain it, disclose your involvement… Keep self-promotion within 10% of your contributions here." Chrome extension posts must link complete source on GitHub. No selling. Titles: no clickbait or URLs. | https://www.reddit.com/r/ChatGPTPro/about/rules ; mirror: https://rankhog.com/subreddits/chatgptpro |
| r/SideProject | **Post** | No subreddit-specific promo rule; the sub exists to share projects. Reddit's ~10% guideline applies. | https://www.reddit.com/r/SideProject/about/rules ; mirror: https://oneup.today/assets/datasets/reddit-selfpromo-rules-2026.csv |
| r/ChatGPT | **Megathread only** | "They may not be solely focused on advertising a single other LLM service (these posts should directly go to weekly self-promotional mega thread, which is pinned)." Needs 5 comment karma. | https://www.reddit.com/r/ChatGPT/about/rules ; mirror: https://spacestationlabs.ai/subreddits/chatgpt |
| r/selfhosted | **Megathread only** | Rule 6: projects younger than 3 months only in the "New Project Megathread". Stilura's first public commit is 2026-09-01, so it qualifies only for the megathread until 2026-12-01. Rule 2: "Promoted apps must be production ready and have docs." | https://www.reddit.com/r/selfhosted/about/rules ; mirrors: https://leadsrover.io/subreddits/r/selfhosted , https://launchit.fast/blog/where-to-promote-your-startup-on-reddit-2026 |
| r/LocalLLaMA | **Comment-only** | Self-promo allowed at ≤10% with disclosure, but posts must be about LLMs and the audience wants local models. The README documents no local-model setup, so a launch post would be off-topic. Answer threads about writing tools instead. | https://www.reddit.com/r/LocalLLaMA/about/rules ; mirror: https://www.subredditmarketing.com/subreddits/localllama |
| r/ObsidianMD | **Comment-only** | "Don't shill: If you are just here to advertise your product, don't." Promotional content "must also be relevant to Obsidian." Stilura doesn't integrate with Obsidian. | https://obsidian.md/help/community-code-of-conduct ; mirror: https://prowlo.com/tools/subreddit-stats/obsidianmd |
| r/PKMS | **Comment-only** | Self-promotion restricted (snapshot 2026-09-08). | https://www.reddit.com/r/PKMS/about/rules ; mirror: https://www.replyhey.com/subreddits/pkms |
| r/Markdown | **Comment-only** | Self-promotion restricted (snapshot 2026-09-12). | https://www.reddit.com/r/Markdown/about/rules ; mirror: https://www.replyhey.com/subreddits/markdown |
| r/opensource | **Dropped** | New rules (Oct 2026): advertised projects must be 1 year old, actively maintained and have 3+ contributors, plus an anti-AI rule. Stilura is 2.5 months old with one contributor. | https://danb.me/blog/opensource-sub-rules/ ; https://www.reddit.com/r/opensource/about/rules |
| r/programming | **Dropped** | "r/programming is not the place to post a project to get feedback… just a link to a GitHub page or a list of features is not [allowed]." A technical write-up could work later. | https://www.reddit.com/r/programming/about/rules ; mirror: https://oneup.today/assets/datasets/reddit-selfpromo-rules-2026.csv |
| Substack Notes | **Optional** | No promo rule; only worth it if you already have a Substack audience. | (no rule page; skip) |

## Timing

- **Show HN.** Data on 48,808 Show HN posts (365 days to 2026-11-12): posts at 12 PM ET (9 AM PT) reached 50 points most often, 4.4% against a 2.9% average. Tuesday-Wednesday at 12 PM ET is 4.0-4.3%. Weekends are slightly better overall (3.2% vs 2.8%) with fewer competing posts. The median Show HN gets 2 points, so plan for that. Source: https://www.thegrowthlist.co/launch/best-time-to-post-on-hacker-news . A second study agrees on 15:00-18:00 UTC: https://codetrendy.com/blog/show-hn-data-study .
  Recommendation: Tuesday or Wednesday, 9:00 AM PT, on a day you can answer comments for 6 hours. The plan said ~8 AM PT; 9 AM PT has the better numbers.
- **Product Hunt.** Goes live 12:01 AM PT regardless; pick a day you can be present. The leaderboard weighs comments and account quality, not upvotes alone.
- **r/selfhosted** (for the megathread): most-discussed posts went up 20:00 UTC (12 PM PT). Source: https://reddiscout.com/subreddits/selfhosted/
- **Reddit generally**: US morning to noon on weekdays. Post when you can reply for the first 2 hours.
- **X**: post the video when you can reply for an hour; pin the thread.

## Comparable launches

Numbers from the HN Algolia API, read 2026-11-15.

| Launch | Result | Why it worked or didn't |
|---|---|---|
| [Show HN: OpenKnowledge, open source AI-first alternative to Obsidian/Notion](https://news.ycombinator.com/item?id=48675435) (2026-06-25) | 381 points, 173 comments | Named a familiar comparison (Obsidian, Notion), "fully free/local and OSS", integrations with Claude and Codex. Top comments: "macOS only? shame", "can't integrate with any local LLM?", migration path. Lesson: people ask about platform coverage and local models first. We have Win/Linux builds; we should say plainly that local models aren't documented. |
| [Show HN: Ephe, a minimalist open-source Markdown paper](https://news.ycombinator.com/item?id=44175557) (2025-06-03) | 143 points, 54 comments | Short, personal "why I made this", stack named (CodeMirror 6, React, Vite), "No sign-up, no ads, no subscriptions." Comments compared it to Logseq and Joplin. Lesson: state the stack and what it isn't. |
| [Show HN: Allein, Markdown editor with AI autocompletion, completely offline](https://news.ycombinator.com/item?id=45983632) (2025-11-19) | 6 points, 4 comments | Closest feature match to Stilura. Feature list in the post, no demo moment, generic "Copilot for Markdown" framing. Lesson: a feature list doesn't stand out; a concrete before/after does. |
| [Show HN: AISlop, a CLI for catching AI generated code smells](https://news.ycombinator.com/item?id=48322956) (2026-05-29) | 73 points, 65 comments | "slop" framing got people talking and `npx aislop scan` made it a one-command try. One commenter: "credibility is lost by using 'slop' words." Lesson: the joke draws people in, but the post itself has to be sober. |
| [Show HN: Lexicon, a free Grammarly alternative, local writing assistant](https://news.ycombinator.com/item?id=49062897) (2026-07-26) | 1 point, 2 comments | "Grammarly alternative" is a crowded, tired frame. Avoid it. |

Takeaways for us: lead with the before/after moment, one command to try, name the stack, say what it doesn't do (no detector, no local-model docs, model requests go to your provider), and keep "slop" in the demo, not in the claims.
