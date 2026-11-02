package dev.dyrox.bingoreporter

import com.mojang.brigadier.arguments.StringArgumentType
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback
import net.minecraft.ChatFormatting
import net.minecraft.commands.Commands
import net.minecraft.network.chat.Component

/**
 * "/bingo link <code>" links the Minecraft account that types it to the website account that showed the code.
 * It hangs off YAB's own /bingo command: Brigadier merges both "bingo" literals into one tree.
 */
object LinkCommand {
    fun register(uploader: () -> Uploader?) {
        CommandRegistrationCallback.EVENT.register { dispatcher, _, _ ->
            dispatcher.register(
                Commands.literal("bingo").then(Commands.literal("link").then(
                    Commands.argument("code", StringArgumentType.word()).executes { ctx ->
                        val player = ctx.source.playerOrException
                        val server = ctx.source.server
                        val up = uploader() ?: run {
                            ctx.source.sendFailure(Component.literal("Bingo Reporter isn't ready yet"))
                            return@executes 0
                        }
                        ctx.source.sendSystemMessage(Component.literal("[Bingo] 正在绑定… / Linking…").withStyle(ChatFormatting.GRAY))
                        up.link(StringArgumentType.getString(ctx, "code"), player.uuid.toString(), player.gameProfile.name) { result ->
                            val msg = when (result) {
                                is LinkResult.Linked -> Component.literal("[Bingo] 已绑定到网站账号 ${result.user} / Linked to ${result.user}").withStyle(ChatFormatting.GREEN)
                                LinkResult.BadCode -> Component.literal("[Bingo] 绑定码无效或已过期，请在网站上重新生成 / Code is wrong or expired").withStyle(ChatFormatting.RED)
                                LinkResult.NoKey -> Component.literal("[Bingo] 这台电脑的上传密钥没填或无效（config/bingo-reporter.json）/ Upload key missing or invalid").withStyle(ChatFormatting.RED)
                                is LinkResult.Failed -> Component.literal("[Bingo] 连接网站失败 / Couldn't reach the website: ${result.reason}").withStyle(ChatFormatting.RED)
                            }
                            // back on the server thread to talk to the player
                            server.execute { player.sendSystemMessage(msg) }
                        }
                        1
                    }
                ))
            )
        }
    }
}
