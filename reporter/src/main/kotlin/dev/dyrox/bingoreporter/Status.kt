package dev.dyrox.bingoreporter

/** What the reporter knows about itself: is there a newer release, and does the website accept its key. */
data class ReporterStatus(
    val version: String,
    /** the newest release the website offers (downloads/reporter.json); null if it couldn't be reached */
    val latest: String?,
    val key: KeyState,
) {
    val updateAvailable get() = latest != null && isNewer(latest, version)
}

sealed interface KeyState {
    data object Missing : KeyState
    data class Valid(val user: String?, val keyName: String?) : KeyState
    /** the website said no: mistyped, or revoked on the account page */
    data object Invalid : KeyState
    data class Unknown(val reason: String) : KeyState
}

/** "0.1.15" > "0.1.9": compares the dotted numbers one by one (anything after a "+" or "-" is ignored). */
fun isNewer(candidate: String, current: String): Boolean {
    fun parts(v: String) = v.substringBefore('+').substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
    val a = parts(candidate); val b = parts(current)
    for (i in 0 until maxOf(a.size, b.size)) {
        val x = a.getOrElse(i) { 0 }; val y = b.getOrElse(i) { 0 }
        if (x != y) return x > y
    }
    return false
}
