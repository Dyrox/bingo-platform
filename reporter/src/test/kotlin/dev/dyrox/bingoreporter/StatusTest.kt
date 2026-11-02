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
}
