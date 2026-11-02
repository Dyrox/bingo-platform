package dev.dyrox.bingoreporter

import me.jfenn.bingo.api.card.ICard
import me.jfenn.bingo.api.card.ICardEntryAccess
import me.jfenn.bingo.api.card.ICardService
import me.jfenn.bingo.api.card.ObjectiveTier
import me.jfenn.bingo.api.data.BingoTeamScore
import me.jfenn.bingo.api.data.IBingoTeam
import me.jfenn.bingo.api.options.BingoGoal
import me.jfenn.bingo.api.options.BingoWinCondition
import me.jfenn.bingo.api.options.EndWhen
import me.jfenn.bingo.api.options.IOptionsService
import me.jfenn.bingo.api.options.StalemateBehavior
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private class Team(override val id: String, override val players: List<UUID>, override val score: BingoTeamScore) : IBingoTeam

// shaped like YAB's BingoTeamImpl → BingoTeam → TeamState.Finished, which isWinner reads behind the API
class Finished
class Playing
class InnerTeam(val state: Any)
// and BingoCardEntryAccess → BingoObjective → ObjectiveDisplay.Resolved → IItemStack, for a tile's count
class Stack(val count: Int)
class Display(val item: Stack)
class Objective(val display: Display)
class YabCell(n: Int) { val objective = Objective(Display(Stack(n))) }
class ItemObjective(val itemCount: Int)
class YabItemCell(n: Int) { val objective = ItemObjective(n) }
// and OptionsService.options (private) → BingoOptions.cards → BingoCardOptions.goal
class CardOptions(val goal: BingoGoal, val isLockoutMode: Boolean = false, val isInventoryMode: Boolean = false,
                  val isHiddenItemsMode: Boolean = false, val isConsumeItemsMode: Boolean = false)
class InnerOptions(val cards: List<CardOptions>, val showHiddenTiers: Boolean = false)
class YabOptions(cards: List<CardOptions>, showHiddenTiers: Boolean = false) {
    constructor(goals: List<BingoGoal>) : this(goals.map { CardOptions(it) })
    private val options = InnerOptions(cards, showHiddenTiers)
}
class YabTeam(override val id: String, override val players: List<UUID>, override val score: BingoTeamScore, state: Any) : IBingoTeam {
    val team = InnerTeam(state)
}

private class Cell(
    override val objectiveId: String,
    override val objectiveTier: ObjectiveTier?,
    private val doneBy: Set<String>,
) : ICardEntryAccess {
    override fun hasPlayerAchieved(playerId: UUID) = false
    override fun hasTeamAchieved(teamName: String) = teamName in doneBy
}

private class Card(override val id: UUID, override val seed: Long, val cells: Map<Pair<Int, Int>, Cell>) : ICard {
    override fun objective(x: Int, y: Int) = cells[x to y]
}

private class Cards(val byTeam: Map<String, Card>) : ICardService {
    override fun getActiveCard(): ICard = byTeam.values.first()
    override fun getTeamCard(teamName: String) = byTeam[teamName]
    override fun shuffleCard(card: ICard) = error("not used")
    override fun replaceEntry(card: ICard, x: Int, y: Int, objectiveId: String) = error("not used")
}

private class Options(override var winCondition: BingoWinCondition = BingoWinCondition.Cards(1)) : IOptionsService {
    override var stalemateBehavior = StalemateBehavior.END_GAME
    override var endGameWhen: EndWhen = EndWhen.FirstWin
    override var timeLimit: Duration? = Duration.ofMinutes(45)
    override var isElytra = false
    override var isNightVision = true
    override var isUnlockRecipes = true
    override var isPvpEnabled = false
    override var isKeepInventory = true
    override var spawnDimension = "minecraft:overworld"
    override var spawnDistance = 0
    override var showPreviewCard = true
    override var isPlayerKit = false
    override var isTeamKit = false
}

class MatchCollectorTest {
    private val dyrox = UUID.fromString("0f3c2d9e-7a51-4b8e-9c33-1d2e4f5a6b70")
    private val friend = UUID.fromString("8a4b6c2d-1e3f-4a5b-8c7d-9e0f1a2b3c4d")
    private val names = mapOf(dyrox to "dyrox", friend to "FriendMC")

    private val goals = listOf("minecraft:diamond", "minecraft:golden_apple", "yet-another-minecraft-bingo:simplified/one_of_stained_glass", "minecraft:cake", "minecraft:ender_pearl")
    private fun card(doneBy: (Int, Int) -> Set<String>) = Card(
        UUID.fromString("c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f"), -4172144997902289642,
        (0..4).flatMap { y -> (0..4).map { x -> (x to y) to Cell(goals[(x + y) % 5], ObjectiveTier.entries[x], doneBy(x, y)) } }.toMap(),
    )

    private fun snapshot(teams: List<IBingoTeam>, cards: ICardService, options: IOptionsService = Options()) = RoundSnapshot(
        gameId = UUID.fromString("5b0e3a52-2f7d-4c47-9d0a-6a1f2b8c9e11"),
        teams = teams, cards = cards, options = options,
        duration = Duration.ofMillis(2_537_000),
        startedAt = Instant.parse("2026-11-02T13:00:00Z"),
        endedAt = Instant.parse("2026-11-02T13:42:17Z"),
        modVersion = "2.15.1+mc26.3", mcVersion = "26.3",
        nameOf = names::get,
    )

    @Test
    fun `builds the backend payload for a two-team round on a shared card`() {
        // red owns the top row, so it completed the card; blue got two cells
        val shared = card { x, y -> buildSet { if (y == 0) add("red"); if (y == 1 && x < 2) add("blue") } }
        val teams = listOf(
            Team("red", listOf(dyrox), BingoTeamScore(items = 5, lines = 1, cards = 1)),
            Team("blue", listOf(friend), BingoTeamScore(items = 2, lines = 0, cards = 0)),
            Team("green", emptyList(), BingoTeamScore(0, 0, 0)),
        )
        val m = MatchCollector.collect(snapshot(teams, Cards(mapOf("red" to shared, "blue" to shared))))!!

        assertEquals(listOf("red", "blue"), m.teams.map { it.id }, "empty teams are left out")
        assertEquals(listOf(true, false), m.teams.map { it.winner })
        assertEquals("FriendMC", m.teams[1].players.single().name)
        assertEquals(1, m.boards.size, "a shared card is one board")
        val board = m.boards.single()
        assertEquals(listOf("red", "blue"), board.teams)
        assertEquals("-4172144997902289642", board.seed)
        assertEquals(25, board.cells.size)
        assertEquals(listOf("red"), board.cells.first { it.x == 3 && it.y == 0 }.completedBy)
        assertEquals("2026-11-02T13:00:00Z", m.startedAt)
        assertEquals(2_537_000, m.durationMs)
        assertEquals("cards:1", m.options["winCondition"].toString().trim('"'))

        // hand the JSON to the backend check in README ("Test against the backend")
        val out = Path.of("build/test-payload.json")
        Files.writeString(out, Uploader.json.encodeToString(MatchPayload.serializer(), m))
    }

    @Test
    fun `separate cards become separate boards`() {
        val teams = listOf(
            Team("red", listOf(dyrox), BingoTeamScore(1, 0, 0)),
            Team("blue", listOf(friend), BingoTeamScore(0, 0, 0)),
        )
        val other = card { _, _ -> emptySet() }.let { Card(UUID.randomUUID(), 42, it.cells) }
        val m = MatchCollector.collect(snapshot(teams, Cards(mapOf("red" to card { _, _ -> emptySet() }, "blue" to other))))!!
        assertEquals(listOf(listOf("red"), listOf("blue")), m.boards.map { it.teams })
    }

    @Test
    fun `YAB's own team state decides the winner, also for a card won on lines`() {
        // the round ended on red's 8th line: YAB marked red Finished but counted no finished card
        val teams = listOf(
            YabTeam("red", listOf(dyrox), BingoTeamScore(items = 23, lines = 8, cards = 0), Finished()),
            YabTeam("blue", listOf(friend), BingoTeamScore(items = 21, lines = 4, cards = 0), Playing()),
        )
        val shared = card { _, _ -> setOf("red", "blue") }
        val m = MatchCollector.collect(snapshot(teams, Cards(mapOf("red" to shared, "blue" to shared))))!!
        assertEquals(listOf(true, false), m.teams.map { it.winner })
    }

    @Test
    fun `reads the count YAB rolled for a tile`() {
        assertEquals(17, MatchCollector.count(YabCell(17)))
        assertNull(MatchCollector.count(YabCell(1)), "a single item shows no number in game")
        assertNull(MatchCollector.count(Any()), "anything else: no count")
        assertEquals(23, MatchCollector.count(YabItemCell(23)), "item goals: the rolled itemCount")
    }

    @Test
    fun `reads each card's goal`() {
        assertEquals(listOf("lines:8", "items:20"), MatchCollector.cardGoals(YabOptions(listOf(BingoGoal.Lines(8), BingoGoal.Items(20)))))
        assertNull(MatchCollector.cardGoals(Options()), "not YAB's options: unknown")
    }

    @Test
    fun `reads each card's modes`() {
        val o = YabOptions(listOf(CardOptions(BingoGoal.Lines(1), isLockoutMode = true, isHiddenItemsMode = true),
            CardOptions(BingoGoal.Lines(1), isInventoryMode = true, isConsumeItemsMode = true)), showHiddenTiers = true)
        assertEquals(listOf(listOf("lockout", "hidden_items"), listOf("inventory", "consume_items")), MatchCollector.cardModes(o))
        assertEquals(true, MatchCollector.showHiddenTiers(o))
        assertNull(MatchCollector.cardModes(Options()))
    }

    @Test
    fun `nobody wins an infinite round`() {
        val teams = listOf(Team("red", listOf(dyrox), BingoTeamScore(25, 12, 3)))
        val m = MatchCollector.collect(snapshot(teams, Cards(mapOf("red" to card { _, _ -> setOf("red") })), Options(BingoWinCondition.Infinite)))!!
        assertEquals(false, m.teams.single().winner)
    }

    @Test
    fun `rounds without players are skipped`() {
        assertNull(MatchCollector.collect(snapshot(listOf(Team("red", emptyList(), BingoTeamScore(0, 0, 0))), Cards(emptyMap()))))
    }
}
