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
        for (line in lines(s, site, player.prefersChinese(), full = false, greet = first)) player.sendSystemMessage(line)
    }

    /** After a check: tell the hosts already in the game (in singleplayer the host joins before it finishes). */
    fun onChecked(server: MinecraftServer) {
        server.execute { server.playerList.players.forEach { onJoin(server, it) } }
    }

    /** Messages for a status; `full` (the /bingo reporter command) also says what's fine. */
    /** Messages for a status, in Chinese or English (`zh`); `full` (the /bingo reporter command) also says what's fine. */
    fun lines(s: ReporterStatus, site: String, zh: Boolean, full: Boolean, greet: Boolean = full): List<Component> = buildList {
        val account = "${site.trimEnd('/')}/account"
        if (full) add(text("[Bingo] Bingo Reporter ${s.version}" + (s.latest?.let { tr(zh, " · 最新 $it", " · latest $it") } ?: ""), ChatFormatting.GRAY))
        if (s.updateAvailable) add(text(tr(zh, "[Bingo] Bingo Reporter 有新版本 ${s.latest}（当前 ${s.version}）。", "[Bingo] Bingo Reporter ${s.latest} is out (you have ${s.version}). "), ChatFormatting.GOLD)
            .append(link(tr(zh, "点这里下载", "Download"), account)))
        when (val k = s.key) {
            KeyState.Missing -> add(text(tr(zh, "[Bingo] 还没填上传密钥，这里打的对局不会上传。在网站生成密钥后填进 config/bingo-reporter.json 的 \"key\"。",
                "[Bingo] No upload key, so rounds played here won't be uploaded. Create one on the website and put it in \"key\" in config/bingo-reporter.json. "), ChatFormatting.RED)
                .append(link(tr(zh, "生成密钥", "Create a key"), account)))
            KeyState.Invalid -> add(text(tr(zh, "[Bingo] 上传密钥无效（输错了或已在网站上撤销），对局会先存着，换上新密钥后再上传。",
                "[Bingo] The website rejected the upload key (mistyped, or revoked). Rounds are kept until there's a new one. "), ChatFormatting.RED)
                .append(link(tr(zh, "重新生成", "New key"), account)))
            is KeyState.Valid -> if (greet) add(text(tr(zh, "[Bingo] 上传密钥有效" + (k.user?.let { " · 账号 $it" } ?: ""),
                "[Bingo] Upload key OK" + (k.user?.let { " · account $it" } ?: "")), ChatFormatting.GREEN))
            is KeyState.Unknown -> if (full) add(text(tr(zh, "[Bingo] 连不上网站，暂时没法检查密钥：${k.reason}", "[Bingo] Couldn't reach the website to check the key: ${k.reason}"), ChatFormatting.GRAY))
        }
    }

    private fun text(s: String, color: ChatFormatting): MutableComponent = Component.literal(s).withStyle(color)

    private fun link(label: String, url: String): MutableComponent =
        Component.literal(label).withStyle { it.withUnderlined(true).withColor(ChatFormatting.AQUA).withClickEvent(ClickEvent.OpenUrl(URI.create(url))) }
}
