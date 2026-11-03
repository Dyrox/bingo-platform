package dev.dyrox.bingoreporter

import net.minecraft.server.level.ServerPlayer

/**
 * Messages follow each player's own game language, which the client tells the server (Options → Language):
 * Chinese for zh_cn / zh_tw / zh_hk, English for everyone else and for the server console.
 * Chosen on the server, so it works for players who don't have the mod.
 */
fun ServerPlayer?.prefersChinese(): Boolean = this?.clientInformation()?.language()?.lowercase()?.startsWith("zh") == true

/** Picks one of the two texts. */
fun tr(zh: Boolean, chinese: String, english: String) = if (zh) chinese else english
