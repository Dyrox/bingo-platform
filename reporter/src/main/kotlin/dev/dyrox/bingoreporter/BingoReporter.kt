package dev.dyrox.bingoreporter

import me.jfenn.bingo.api.BingoApi
import me.jfenn.bingo.api.BingoEvents
import me.jfenn.bingo.api.IBingoApi
import me.jfenn.bingo.api.data.BingoGameStatus
import net.fabricmc.api.ModInitializer
import net.fabricmc.loader.api.FabricLoader
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Runs wherever the bingo game runs: a dedicated server, or the computer that opened the world to LAN.
 * On a computer that only joins someone else's game, YAB's server-side events never fire, so it stays idle.
 */
object BingoReporter : ModInitializer {
    private val log = LoggerFactory.getLogger("bingo-reporter")
    private val startedAt = ConcurrentHashMap<UUID, Instant>()
    private var uploader: Uploader? = null
    // one timeline per round id; kept after the round ends so a resumed round carries on where it was
    private val trackers = ConcurrentHashMap<UUID, EventTracker>()
    private val ticker = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "bingo-reporter-ticker").apply { isDaemon = true } }

    override fun onInitialize() {
        val loader = FabricLoader.getInstance()
        val configFile = loader.configDir.resolve("bingo-reporter.json")
        LinkCommand.register { uploader }

        BingoEvents.INIT.register { _ ->
            // also writes the config template on first run
            if (ReporterConfig.load(configFile).key.isBlank()) {
                log.info("No upload key in {}; finished rounds are queued and sent once a key is added", configFile)
            }
            val up = uploader ?: Uploader(loader.configDir.resolve("bingo-reporter"), configFile).also { uploader = it }
            up.flushAsync()
        }

        // YAB fires GAME_STARTED again when a finished round is resumed; keep the original start
        BingoEvents.GAME_STARTED.register { e ->
            startedAt.putIfAbsent(e.id, Instant.now())
            trackers.keys.removeIf { it != e.id }
            trackers.computeIfAbsent(e.id) { EventTracker() }
        }

        // about once a second, hop onto the server thread and note what changed on the cards
        ticker.scheduleWithFixedDelay({
            val api = BingoApi.INSTANCE ?: return@scheduleWithFixedDelay
            if (api.game.status != BingoGameStatus.PLAYING) return@scheduleWithFixedDelay
            api.server.execute { poll(api) }
        }, 1, 1, TimeUnit.SECONDS)

        BingoEvents.GAME_ENDED.register { e ->
            val api = BingoApi.INSTANCE ?: return@register
            val up = uploader ?: return@register
            poll(api) // catch whatever happened since the last tick, including the winning goal
            // read everything now, on the server thread; only the upload itself happens in the background
            val match = MatchCollector.collect(RoundSnapshot(
                gameId = e.id,
                teams = api.teams.toList(),
                cards = api.cards,
                options = api.options,
                duration = api.game.time,
                startedAt = startedAt[e.id], // kept, since a resumed round ends again with the same id
                endedAt = Instant.now(),
                modVersion = version(loader, "yet-another-minecraft-bingo"),
                mcVersion = version(loader, "minecraft"),
                nameOf = { playerName(api, it) },
                events = trackers[e.id]?.events ?: emptyList(),
            ))
            if (match == null) log.info("Round {} had no players or card; not reporting it", e.id)
            else up.submit(match)
        }
    }

    private fun poll(api: IBingoApi) {
        val tracker = trackers[api.game.id] ?: return
        try {
            val hidden = MatchCollector.cardModes(api.options)?.firstOrNull()?.contains("hidden_items") == true
            tracker.poll(api.game.time?.toMillis() ?: 0, api.teams.toList(), api.cards, trackSeen = hidden)
        } catch (e: Exception) {
            log.warn("Couldn't read the cards for the timeline: {}", e.message)
        }
    }

    private fun version(loader: FabricLoader, modId: String) =
        loader.getModContainer(modId).map { it.metadata.version.friendlyString }.orElse("unknown")

    private fun playerName(api: IBingoApi, id: UUID): String? =
        api.server.services().nameToIdCache().get(id).map { it.name() }.orElse(null)
            ?: api.server.playerList.getPlayer(id)?.name?.string
}
