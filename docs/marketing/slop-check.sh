#!/bin/sh
# Flags AI-slop words and em-dash pileups in our own copy.
# Usage: sh docs/marketing/slop-check.sh FILE...
# Hits inside quoted slop (the demo paragraph, the bingo card) are expected; review each one.
WORDS='delve|delving|seamless|game.?changer|revolutioni[sz]e|fast-paced|testament|tapestry|leverage|unlock|supercharge|elevate|empower|effortless|cutting.edge|groundbreaking|landscape|realm|robust|pivotal|crucial|vibrant|foster|showcase|utilize|moreover|furthermore|it.s important to note|let.s dive|dive in|here.s the thing|honestly\?|look,|in conclusion|not just .* but|game changer|next.level|harness|navigate the|ever.evolving|boasts|nestled|transformative|unleash|journey'
status=0
for f in "$@"; do
  grep -n -i -E "$WORDS" "$f" | sed "s|^|$f:|" && status=1
  # more than one em dash on a line
  grep -n '—.*—' "$f" | sed "s|^|$f: em-dash pileup: |" && status=1
done
exit $status
