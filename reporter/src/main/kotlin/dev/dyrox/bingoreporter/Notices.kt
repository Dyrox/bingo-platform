package dev.dyrox.bingoreporter

import net.minecraft.ChatFormatting
import net.minecraft.network.chat.ClickEvent
import net.minecraft.network.chat.Component
import net.minecraft.network.chat.MutableComponent
import net.minecraft.server.MinecraftServer
import net.minecraft.server.level.ServerPlayer
import java.net.URI
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Tells whoever runs the game about updates and upload-key problems. Only the host (the singleplayer/LAN
 * owner) and ops hear it: they're the ones who can swap the jar or edit config/bingo-reporter.json.
 */
object Notices {
    @Volatile var status: ReporterStatus? = null
    /** the website from config/bingo-reporter.json, for the links */
    @Volatile var site: String = ReporterConfig.DEFAULT_API_URL
    private val greeted = ConcurrentHashMap.newKeySet<UUID>()

    fun isHost(server: MinecraftServer, player: ServerPlayer) =
        server.isSingleplayerOwner(player.nameAndId()) || server.playerList.isOp(player.nameAndId())

    /** On join: problems every time, "key OK" once per game session. */
    fun onJoin(server: MinecraftServer, player: ServerPlayer) {
        val s = status ?: return
        if (!isHost(server, player)) return
        val first = greeted.add(player.uuid)
        for (line in lines(s, site, full = false, greet = first)) player.sendSystemMessage(line)
    }

    /** After a check: tell the hosts already in the game (in singleplayer the host joins before it finishes). */
    fun onChecked(server: MinecraftServer) {
        server.execute { server.playerList.players.forEach { onJoin(server, it) } }
    }

    /** Messages for a status; `full` (the /bingo reporter command) also says what's fine. */
    fun lines(s: ReporterStatus, site: String, full: Boolean, greet: Boolean = full): List<Component> = buildList {
        val account = "${site.trimEnd('/')}/account"
        if (full) add(text("[Bingo] Bingo Reporter ${s.version}" + (s.latest?.let { " · 最新 / latest $it" } ?: ""), ChatFormatting.GRAY))
        if (s.updateAvailable) add(text("[Bingo] Bingo Reporter 有新版本 ${s.latest}（当前 ${s.version}）/ Update available. ", ChatFormatting.GOLD)
            .append(link("点这里下载 / Download", account)))
        when (val k = s.key) {
            KeyState.Missing -> add(text("[Bingo] 还没填上传密钥，这里打的对局不会上传。在网站生成密钥后填进 config/bingo-reporter.json 的 \"key\" / No upload key: rounds here won't be uploaded. ", ChatFormatting.RED)
                .append(link("生成密钥 / Create a key", account)))
            KeyState.Invalid -> add(text("[Bingo] 上传密钥无效（输错了或已在网站上撤销），对局会先存着，换上新密钥后再上传 / Upload key rejected; rounds wait for a new one. ", ChatFormatting.RED)
                .append(link("重新生成 / New key", account)))
            is KeyState.Valid -> if (greet) add(text("[Bingo] 上传密钥有效" + (k.user?.let { " · 账号 $it" } ?: "") + " / Upload key OK", ChatFormatting.GREEN))
            is KeyState.Unknown -> if (full) add(text("[Bingo] 连不上网站，暂时没法检查密钥 / Couldn't reach the website: ${k.reason}", ChatFormatting.GRAY))
        }
    }

    private fun text(s: String, color: ChatFormatting): MutableComponent = Component.literal(s).withStyle(color)

    private fun link(label: String, url: String): MutableComponent =
        Component.literal(label).withStyle { it.withUnderlined(true).withColor(ChatFormatting.AQUA).withClickEvent(ClickEvent.OpenUrl(URI.create(url))) }
}
