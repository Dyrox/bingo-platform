package dev.dyrox.bingoreporter

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory
import java.nio.file.Files
import java.nio.file.Path

/** config/bingo-reporter.json. A blank key turns uploading off. */
@Serializable
data class ReporterConfig(
    @SerialName("api_url") val apiUrl: String = DEFAULT_API_URL,
    val key: String = "",
) {
    companion object {
        // TODO: point at the real server once the backend is deployed
        const val DEFAULT_API_URL = "http://localhost:3000"

        private val log = LoggerFactory.getLogger("bingo-reporter")
        private val json = Json { prettyPrint = true; ignoreUnknownKeys = true; encodeDefaults = true }

        /** Reads the config, writing a template on first run so there's something to fill in. */
        fun load(file: Path): ReporterConfig {
            if (Files.notExists(file)) {
                Files.createDirectories(file.parent)
                Files.writeString(file, json.encodeToString(serializer(), ReporterConfig()))
                log.info("Created {}; add your upload key there to start reporting rounds", file)
                return ReporterConfig()
            }
            return try {
                json.decodeFromString(serializer(), Files.readString(file))
            } catch (e: Exception) {
                log.error("Couldn't read {}, uploads are off until it's fixed: {}", file, e.message)
                ReporterConfig(key = "")
            }
        }
    }
}
