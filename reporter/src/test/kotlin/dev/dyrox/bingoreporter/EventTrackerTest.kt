package dev.dyrox.bingoreporter

import me.jfenn.bingo.api.card.ICard
import me.jfenn.bingo.api.card.ICardEntryAccess
import me.jfenn.bingo.api.card.ICardService
import me.jfenn.bingo.api.card.ObjectiveTier
import me.jfenn.bingo.api.data.BingoTeamScore
import me.jfenn.bingo.api.data.IBingoTeam
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals

private class LiveTeam(override val id: String, override val players: List<UUID>) : IBingoTeam {
    var lines = 0
    override val score get() = BingoTeamScore(items = 0, lines = lines, cards = 0)
}

// teamsSeen sits behind the API, on YAB's BingoObjective (see MatchCollector.seenBy)
class SeenObjective { val teamsSeen = mutableSetOf<String>() }

private class LiveCell(override val objectiveId: String) : ICardEntryAccess {
    val objective = SeenObjective()
    val teams = mutableSetOf<String>()
    val players = mutableSetOf<UUID>()
    override val objectiveTier: ObjectiveTier? = null
    override fun hasPlayerAchieved(playerId: UUID) = playerId in players
    override fun hasTeamAchieved(teamName: String) = teamName in teams
}

private class LiveCard(val cells: Map<Pair<Int, Int>, LiveCell>) : ICard {
    override val id: UUID = UUID.randomUUID()
    override val seed = 1L
    override fun objective(x: Int, y: Int) = cells[x to y]
}

private class SharedCard(val card: LiveCard) : ICardService {
    override fun getActiveCard(): ICard = card
    override fun getTeamCard(teamName: String) = card
    override fun shuffleCard(card: ICard) = error("not used")
    override fun replaceEntry(card: ICard, x: Int, y: Int, objectiveId: String) = error("not used")
}

class EventTrackerTest {
    private val a = UUID.fromString("0f3c2d9e-7a51-4b8e-9c33-1d2e4f5a6b70")
    private val b = UUID.fromString("8a4b6c2d-1e3f-4a5b-8c7d-9e0f1a2b3c4d")

    @Test
    fun `records each goal once, who got it, lines and losses`() {
        val stick = LiveCell("minecraft:stick")
        val cod = LiveCell("minecraft:cod")
        val never = LiveCell("yet-another-minecraft-bingo:inverse/never_dirt")
        val card = LiveCard(mapOf((0 to 0) to stick, (1 to 0) to cod, (2 to 0) to never))
        val red = LiveTeam("bingo_red", listOf(a))
        val blue = LiveTeam("bingo_blue", listOf(b))
        val teams = listOf(red, blue)
        val tracker = EventTracker()

        // start: "never get dirt" is held by both teams from the beginning
        never.teams += listOf("bingo_red", "bingo_blue")
        tracker.poll(0, teams, SharedCard(card))

        stick.teams += "bingo_red"; stick.players += a
        tracker.poll(5_000, teams, SharedCard(card))
        tracker.poll(6_000, teams, SharedCard(card)) // nothing new: no duplicate

        cod.teams += "bingo_blue"; cod.players += b
        never.teams -= "bingo_blue" // blue picked up dirt
        red.lines = 1
        tracker.poll(455_000, teams, SharedCard(card))

        val got = tracker.events.map { listOf(it.t, it.type, it.team, it.player, it.objectiveId, it.value) }
        // teams are read in order, each team's cells then its score
        assertEquals(listOf(
            listOf(0L, "goal", "bingo_red", null, never.objectiveId, null),
            listOf(0L, "goal", "bingo_blue", null, never.objectiveId, null),
            listOf(5_000L, "goal", "bingo_red", a.toString(), "minecraft:stick", null),
            listOf(455_000L, "line", "bingo_red", null, null, 1),
            listOf(455_000L, "goal", "bingo_blue", b.toString(), "minecraft:cod", null),
            listOf(455_000L, "lost", "bingo_blue", null, never.objectiveId, null),
        ), got)
    }

    @Test
    fun `in Hidden Items mode, records when each team first sees a tile`() {
        val stick = LiveCell("minecraft:stick")
        val card = LiveCard(mapOf((0 to 0) to stick))
        val teams = listOf(LiveTeam("bingo_red", listOf(a)), LiveTeam("bingo_blue", listOf(b)))
        val tracker = EventTracker()
        tracker.poll(0, teams, SharedCard(card), trackSeen = true)
        stick.objective.teamsSeen += "bingo_red"
        tracker.poll(3_000, teams, SharedCard(card), trackSeen = true)
        tracker.poll(4_000, teams, SharedCard(card), trackSeen = true)
        stick.objective.teamsSeen += "bingo_blue"
        tracker.poll(9_000, teams, SharedCard(card), trackSeen = true)
        assertEquals(listOf(3_000L to "bingo_red", 9_000L to "bingo_blue"), tracker.events.filter { it.type == "seen" }.map { it.t to it.team })

        val plain = EventTracker()
        plain.poll(0, teams, SharedCard(card))
        assertEquals(emptyList(), plain.events, "other modes: no seen events")
    }
}
