package dev.dyrox.bingoreporter

import kotlin.test.Test
import kotlin.test.assertEquals

class StatusTest {
    @Test
    fun `compares versions as numbers`() {
        assertEquals(true, isNewer("0.1.15", "0.1.9"))
        assertEquals(false, isNewer("0.1.14", "0.1.14"))
        assertEquals(false, isNewer("0.1.13", "0.1.14"))
        assertEquals(true, isNewer("0.2.0", "0.1.99"))
        assertEquals(false, isNewer("0.1.14", "0.1.14+local"))
        assertEquals(true, ReporterStatus("0.1.14", "0.1.15", KeyState.Missing).updateAvailable)
        assertEquals(false, ReporterStatus("0.1.14", null, KeyState.Missing).updateAvailable, "offline: no nagging")
    }

    @Test
    fun `messages come in the player's language`() {
        val s = ReporterStatus("0.1.15", "0.1.16", KeyState.Invalid)
        val zh = Notices.lines(s, "https://bingo.dyrox.cat", zh = true, full = false).map { it.string }
        val en = Notices.lines(s, "https://bingo.dyrox.cat", zh = false, full = false).map { it.string }
        assertEquals(listOf("[Bingo] Bingo Reporter 有新版本 0.1.16（当前 0.1.15）。点这里下载",
            "[Bingo] 上传密钥无效（输错了或已在网站上撤销），对局会先存着，换上新密钥后再上传。重新生成"), zh)
        assertEquals(listOf("[Bingo] Bingo Reporter 0.1.16 is out (you have 0.1.15). Download",
            "[Bingo] The website rejected the upload key (mistyped, or revoked). Rounds are kept until there's a new one. New key"), en)
        val ok = ReporterStatus("0.1.16", "0.1.16", KeyState.Valid("Dyrox", "pc"))
        assertEquals(listOf("[Bingo] 上传密钥有效 · 账号 Dyrox"), Notices.lines(ok, "x", zh = true, full = false, greet = true).map { it.string })
        assertEquals(emptyList(), Notices.lines(ok, "x", zh = false, full = false, greet = false), "nothing to say after the first time")
    }
}
