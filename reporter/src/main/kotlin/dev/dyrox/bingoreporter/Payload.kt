package dev.dyrox.bingoreporter

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

// Wire format of POST /api/matches. Must stay in step with backend/src/payload.ts.

@Serializable
data class MatchPayload(
    val id: String,
    val modVersion: String,
    val mcVersion: String,
    val startedAt: String,
    val endedAt: String,
    val durationMs: Long,
    val options: JsonObject,
    val teams: List<TeamPayload>,
    val boards: List<BoardPayload>,
    val events: List<EventPayload> = emptyList(),
)

@Serializable
data class TeamPayload(
    val id: String,
    val items: Int,
    val lines: Int,
    val cards: Int,
    val winner: Boolean,
    val players: List<PlayerPayload>,
)

@Serializable
data class PlayerPayload(val uuid: String, val name: String)

@Serializable
data class BoardPayload(
    val id: String,
    val seed: String,
    val teams: List<String>,
    val cells: List<CellPayload>,
)

/** One timeline entry. `t` is in-game time in ms; type is goal / lost / line / card / seen (Hidden Items). */
@Serializable
data class EventPayload(
    val t: Long,
    val type: String,
    val team: String,
    val player: String? = null,
    val objectiveId: String? = null,
    val value: Int? = null,
)

@Serializable
data class CellPayload(
    val x: Int,
    val y: Int,
    val objectiveId: String,
    val tier: String?,
    val completedBy: List<String>,
    /** How many the goal asks for on this card ("collect 4–32 rotten flesh" rolls one), when more than 1. */
    val count: Int? = null,
)
