package dev.dyrox.bingoreporter

import me.jfenn.bingo.api.card.ICardService
import me.jfenn.bingo.api.data.IBingoTeam

/**
 * Builds a round's timeline. YAB's public API only says who has a goal *now*, not when they got it,
 * so the reporter polls the cards and scores about once a second and records every change,
 * stamped with the in-game clock (the same time YAB shows in chat, e.g. "[7:35]").
 */
class EventTracker {
    private val teamHas = HashMap<Pair<String, String>, Boolean>()   // (team, objective) → achieved
    private val playerHas = HashSet<Pair<String, String>>()          // (player, objective) already achieved
    private val teamSeen = HashSet<Pair<String, String>>()           // (team, objective) revealed (Hidden Items)
    private val lines = HashMap<String, Int>()
    private val cards = HashMap<String, Int>()
    private val _events = mutableListOf<EventPayload>()
    val events: List<EventPayload> get() = _events.toList()

    /** `trackSeen`: in Hidden Items mode, also record when each team first sees each tile ("seen"). */
    fun poll(timeMs: Long, teams: List<IBingoTeam>, cardService: ICardService, trackSeen: Boolean = false) {
        for (team in teams.filter { it.players.isNotEmpty() }) {
            val card = cardService.getTeamCard(team.id) ?: continue
            for (y in 0 until 5) for (x in 0 until 5) {
                val cell = card.objective(x, y) ?: continue
                val key = team.id to cell.objectiveId
                if (trackSeen && key !in teamSeen && MatchCollector.seenBy(cell)?.contains(team.id) == true) {
                    teamSeen += key
                    _events += EventPayload(timeMs, "seen", team.id, objectiveId = cell.objectiveId)
                }
                val now = cell.hasTeamAchieved(team.id)
                val before = teamHas[key] ?: false
                // credit whichever teammate got it this time; YAB marks the player as well as the team
                val newcomers = team.players.filter { cell.hasPlayerAchieved(it) && playerHas.add(it.toString() to cell.objectiveId) }
                if (now && !before) {
                    _events += EventPayload(timeMs, "goal", team.id, newcomers.firstOrNull()?.toString(), cell.objectiveId)
                } else if (!now && before) {
                    // e.g. a "never get X" goal that was broken, or an item that was lost again
                    _events += EventPayload(timeMs, "lost", team.id, objectiveId = cell.objectiveId)
                }
                teamHas[key] = now
            }
            val score = team.score
            if (score.lines > (lines[team.id] ?: 0)) _events += EventPayload(timeMs, "line", team.id, value = score.lines)
            if (score.cards > (cards[team.id] ?: 0)) _events += EventPayload(timeMs, "card", team.id, value = score.cards)
            lines[team.id] = score.lines
            cards[team.id] = score.cards
        }
    }
}
