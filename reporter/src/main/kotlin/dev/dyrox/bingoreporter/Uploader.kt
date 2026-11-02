package dev.dyrox.bingoreporter

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory
import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Duration
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name

/**
 * Every round is written to `pending/` first and only deleted once the server accepted it,
 * so rounds survive network outages and game restarts. Uploads run on a background thread.
 * The config is re-read before every upload, so a key added mid-session is picked up right away.
 */
class Uploader(private val dir: Path, private val configFile: Path) {
    private val log = LoggerFactory.getLogger("bingo-reporter")
    private val pending = dir.resolve("pending")
    private val failed = dir.resolve("failed")
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
    private val executor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "bingo-reporter").apply { isDaemon = true }
    }

    init {
        Files.createDirectories(pending)
        // anything left over from an earlier outage gets another go every few minutes
        executor.scheduleWithFixedDelay(::flush, 5, 5, TimeUnit.MINUTES)
    }

    fun submit(match: MatchPayload) {
        val file = pending.resolve("${match.id}.json")
        Files.writeString(file, json.encodeToString(MatchPayload.serializer(), match))
        log.info("Saved round {} for upload", match.id)
        flushAsync()
    }

    fun flushAsync() {
        executor.execute(::flush)
    }

    private fun flush() {
        val cfg = ReporterConfig.load(configFile)
        if (cfg.key.isBlank()) return
        val files = runCatching { pending.listDirectoryEntries("*.json").sortedBy { Files.getLastModifiedTime(it) } }
            .getOrDefault(emptyList())
        for (file in files) {
            val status = try {
                post(cfg, Files.readString(file))
            } catch (e: IOException) {
                log.warn("Couldn't reach {} ({}); will retry {} later", cfg.apiUrl, e.message, file.name)
                return
            } catch (e: Exception) {
                log.error("Upload of {} failed", file.name, e)
                return
            }
            when {
                status in 200..299 -> {
                    Files.deleteIfExists(file)
                    log.info("Uploaded round {}", file.name.removeSuffix(".json"))
                }
                status == 401 -> {
                    log.warn("Upload key was rejected; check \"key\" in config/bingo-reporter.json. Rounds stay queued.")
                    return
                }
                status == 429 || status >= 500 -> {
                    log.warn("Server answered {}; will retry {} later", status, file.name)
                    return
                }
                else -> {
                    // the server will never accept this one (invalid data, id clash); park it for inspection
                    Files.createDirectories(failed)
                    Files.move(file, failed.resolve(file.name), StandardCopyOption.REPLACE_EXISTING)
                    log.error("Server rejected round {} with {}; moved it to {}", file.name, status, failed)
                }
            }
        }
    }

    /**
     * "/bingo link <code>": tells the website which Minecraft account typed the code.
     * Runs in the background; `reply` gets a message for the player.
     */
    fun link(code: String, uuid: String, name: String, reply: (LinkResult) -> Unit) {
        executor.execute {
            val cfg = ReporterConfig.load(configFile)
            if (cfg.key.isBlank()) return@execute reply(LinkResult.NoKey)
            val body = json.encodeToString(LinkRequest.serializer(), LinkRequest(code, uuid, name))
            val result = try {
                val res = send(cfg, "/api/link", body)
                when (res.statusCode()) {
                    200 -> LinkResult.Linked(json.parseToJsonElement(res.body()).jsonObject["user"]?.jsonPrimitive?.content ?: "?")
                    404 -> LinkResult.BadCode
                    401 -> LinkResult.NoKey
                    else -> LinkResult.Failed("HTTP ${res.statusCode()}")
                }
            } catch (e: Exception) {
                LinkResult.Failed(e.message ?: e.javaClass.simpleName)
            }
            reply(result)
        }
    }

    /** Checks for a newer release and whether the key is accepted, in the background. */
    fun check(version: String, reply: (ReporterStatus) -> Unit) {
        executor.execute {
            val cfg = ReporterConfig.load(configFile)
            val base = cfg.apiUrl.trimEnd('/')
            val latest = try {
                val res = http.send(HttpRequest.newBuilder(URI.create("$base/downloads/reporter.json")).timeout(Duration.ofSeconds(15)).GET().build(),
                    HttpResponse.BodyHandlers.ofString())
                if (res.statusCode() == 200) json.parseToJsonElement(res.body()).jsonObject["version"]?.jsonPrimitive?.content else null
            } catch (e: Exception) {
                log.debug("Couldn't check for updates: {}", e.message)
                null
            }
            val key = if (cfg.key.isBlank()) KeyState.Missing else try {
                val res = http.send(HttpRequest.newBuilder(URI.create("$base/api/key")).timeout(Duration.ofSeconds(15))
                    .header("authorization", "Bearer ${cfg.key}").GET().build(), HttpResponse.BodyHandlers.ofString())
                when (res.statusCode()) {
                    200 -> json.parseToJsonElement(res.body()).jsonObject.let { o ->
                        KeyState.Valid(o["user"]?.jsonPrimitive?.contentOrNull, o["key"]?.jsonPrimitive?.contentOrNull)
                    }
                    401 -> KeyState.Invalid
                    else -> KeyState.Unknown("HTTP ${res.statusCode()}")
                }
            } catch (e: Exception) {
                KeyState.Unknown(e.message ?: e.javaClass.simpleName)
            }
            reply(ReporterStatus(version, latest, key))
        }
    }

    private fun send(cfg: ReporterConfig, path: String, body: String): HttpResponse<String> {
        val req = HttpRequest.newBuilder(URI.create(cfg.apiUrl.trimEnd('/') + path))
            .timeout(Duration.ofSeconds(20))
            .header("content-type", "application/json")
            .header("authorization", "Bearer ${cfg.key}")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build()
        return http.send(req, HttpResponse.BodyHandlers.ofString())
    }

    private fun post(cfg: ReporterConfig, body: String): Int {
        val res = send(cfg, "/api/matches", body)
        if (res.statusCode() !in 200..299) log.debug("Server response: {}", res.body())
        return res.statusCode()
    }

    companion object {
        val json = Json { encodeDefaults = true }
    }
}

@kotlinx.serialization.Serializable
private data class LinkRequest(val code: String, val uuid: String, val name: String)

sealed interface LinkResult {
    data class Linked(val user: String) : LinkResult
    data object BadCode : LinkResult
    data object NoKey : LinkResult
    data class Failed(val reason: String) : LinkResult
}
