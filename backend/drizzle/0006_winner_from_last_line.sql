-- Reporter uploads before 0.1.9 guessed the winner from finished cards, which YAB doesn't count for a
-- card won on lines. A "first win" round that ended the moment a team scored its last line/card was won
-- by that team (same rule as inferWinner() in src/matches.ts).
UPDATE "match_teams" AS mt SET "winner" = true
FROM "matches" AS m
WHERE mt."match_id" = m."id"
  AND m."source" = 'reporter'
  AND m."options"->>'endWhen' = 'first_win'
  AND m."options"->>'winCondition' LIKE 'cards:%'
  AND NOT EXISTS (SELECT 1 FROM "match_teams" w WHERE w."match_id" = m."id" AND w."winner")
  AND mt."team_id" = (
    SELECT e."team_id" FROM "match_events" e
    WHERE e."match_id" = m."id" AND e."type" IN ('line', 'card') AND e."t_ms" >= m."duration_ms" - 2000
    ORDER BY e."t_ms" DESC, e."seq" DESC LIMIT 1
  );
