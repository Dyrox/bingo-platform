package dev.dyrox.bingoreporter

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import me.jfenn.bingo.api.card.ICardService
import me.jfenn.bingo.api.data.IBingoTeam
import me.jfenn.bingo.api.options.BingoWinCondition
import me.jfenn.bingo.api.options.EndWhen
import me.jfenn.bingo.api.options.IOptionsService
import java.time.Duration
import java.time.Instant
import java.util.UUID

/** Everything the collector reads, so it can be fed fakes in tests instead of a running server. */
class RoundSnapshot(
    val gameId: UUID,
    val teams: Iterable<IBingoTeam>,
    val cards: ICardService,
    val options: IOptionsService,
    val duration: Duration?,
    val startedAt: Instant?,
    val endedAt: Instant,
    val modVersion: String,
    val mcVersion: String,
    val nameOf: (UUID) -> String?,
    val events: List<EventPayload> = emptyList(),
)

object MatchCollector {
    // YAB cards are always 5x5 (see BingoCard.lines() in YAB's common module)
    private const val CARD_SIZE = 5

    /** Builds the upload for a finished round, or null when there is nothing worth storing. */
    fun collect(r: RoundSnapshot): MatchPayload? {
        val teams = r.teams.filter { it.players.isNotEmpty() }
        if (teams.isEmpty()) return null
        val teamIds = teams.map { it.id }.toSet()

        // Teams normally share one card, but YAB can hand out separate ones.
        val boards = teams
            .mapNotNull { team -> r.cards.getTeamCard(team.id)?.let { it to team.id } }
            .groupBy({ it.first.id }) { it }
            .map { (cardId, entries) ->
                val card = entries.first().first
                val cells = (0 until CARD_SIZE).flatMap { y ->
                    (0 until CARD_SIZE).mapNotNull { x ->
                        val cell = card.objective(x, y) ?: return@mapNotNull null
                        CellPayload(
                            x = x, y = y,
                            objectiveId = cell.objectiveId,
                            tier = cell.objectiveTier?.name,
                            completedBy = teamIds.filter { cell.hasTeamAchieved(it) },
                        )
                    }
                }
                BoardPayload(cardId.toString(), card.seed.toString(), entries.map { it.second }, cells)
            }
            .filter { it.cells.isNotEmpty() }
        if (boards.isEmpty()) return null

        val durationMs = r.duration?.toMillis() ?: 0
        val startedAt = r.startedAt ?: r.endedAt.minusMillis(durationMs)
        return MatchPayload(
            id = r.gameId.toString(),
            modVersion = r.modVersion,
            mcVersion = r.mcVersion,
            startedAt = startedAt.toString(),
            endedAt = r.endedAt.toString(),
            durationMs = durationMs,
            options = options(r.options),
            teams = teams.map { team ->
                TeamPayload(
                    id = team.id,
                    items = team.score.items,
                    lines = team.score.lines,
                    cards = team.score.cards,
                    winner = isWinner(team, r.options),
                    players = team.players.map { PlayerPayload(it.toString(), r.nameOf(it) ?: "unknown") },
                )
            },
            boards = boards,
            // only events of teams that are in the upload
            events = r.events.filter { it.team in teamIds },
        )
    }

    /**
     * YAB marks a team as won by moving it to TeamState.Finished, which the API doesn't expose. Read it from
     * behind the API (BingoTeamImpl.getTeam().getState()); if that ever moves, fall back to the card count,
     * which misses a card won on lines (YAB doesn't count the card a team won the game with).
     */
    fun isWinner(team: IBingoTeam, options: IOptionsService): Boolean =
        finished(team) ?: when (val win = options.winCondition) {
            is BingoWinCondition.Cards -> team.score.cards >= win.cards
            else -> false
        }

    private fun finished(team: IBingoTeam): Boolean? = try {
        val inner = team.javaClass.getMethod("getTeam").invoke(team)
        val state = inner.javaClass.getMethod("getState").invoke(inner)
        state != null && state.javaClass.simpleName == "Finished"
    } catch (_: ReflectiveOperationException) {
        null
    }

    private fun options(o: IOptionsService): JsonObject = buildJsonObject {
        put("winCondition", when (val w = o.winCondition) {
            is BingoWinCondition.Cards -> JsonPrimitive("cards:${w.cards}")
            BingoWinCondition.Infinite -> JsonPrimitive("infinite")
            BingoWinCondition.ReplaceGoals -> JsonPrimitive("replace_goals")
        })
        put("endWhen", when (val e = o.endGameWhen) {
            EndWhen.Never -> "never"
            EndWhen.FirstWin -> "first_win"
            is EndWhen.TeamsWin -> "teams_win:${e.teams}"
            EndWhen.AllWin -> "all_win"
        })
        put("stalemate", o.stalemateBehavior.name.lowercase())
        o.timeLimit?.let { put("timeLimitSeconds", it.toSeconds()) }
        put("pvp", o.isPvpEnabled)
        put("elytra", o.isElytra)
        put("nightVision", o.isNightVision)
        put("keepInventory", o.isKeepInventory)
        put("unlockRecipes", o.isUnlockRecipes)
        put("playerKit", o.isPlayerKit)
        put("teamKit", o.isTeamKit)
        put("spawnDimension", o.spawnDimension)
        put("spawnDistance", o.spawnDistance)
    }
}
