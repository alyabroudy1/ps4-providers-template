// Mirror of ps4-toolkit core/provider-api/src/main/kotlin/io/blueoak/ps4toolkit/provider/api/DexProvider.kt.
// Keep byte-for-byte in sync with the app repo (apart from this header); the app ships these classes at runtime.
package io.blueoak.ps4toolkit.provider.api

/** Version of this Dex provider API; independent of the JSON result shapes (API v1, section 27.2). */
const val DEX_PROVIDER_API_VERSION = 1

/**
 * A Kotlin provider loaded from a `.ps4p` bundle (IMPLEMENTATION_PLAN.md section 28). The implementation needs a
 * public no-arg constructor. All calls are blocking and are made off the main thread, one at a time.
 *
 * Results are **JSON strings in the API v1 shapes** of section 27.2 (`HomeSection[]`, `Card[]`, `Details`,
 * `DirectFile[]`); the app validates them exactly like results of JS providers.
 */
interface DexProvider {
    /** Called once after construction, before any other call. */
    fun init(host: ProviderHost)

    /** JSON `HomeSection[]`; return `"[]"` if unsupported. */
    fun getHome(page: Int): String

    /** JSON `Card[]`. */
    fun search(query: String, page: Int): String

    /** JSON `Details`. */
    fun load(url: String): String

    /** JSON `DirectFile[]`. */
    fun extract(url: String): String

    /** Regexes (Java syntax) of host links [extract] can resolve; non-empty for extractor providers. */
    fun extractorPatterns(): List<String> = emptyList()
}

/**
 * What the app offers a [DexProvider]. Network access is restricted to the manifest's `allowedHosts`
 * (enforced on these calls only: Dex code is NOT sandboxed and could open sockets itself).
 */
interface ProviderHost {
    /** User-editable values of the manifest's declared settings, merged over their defaults. */
    val settings: Map<String, String>

    /** GET; redirects are followed (each hop is checked against `allowedHosts`), cookies are kept per provider. Throws on policy/transport errors. */
    fun httpGet(url: String, headers: Map<String, String> = emptyMap()): HostResponse

    /** POST with a text [body]; same rules as [httpGet]. */
    fun httpPost(url: String, body: String, headers: Map<String, String> = emptyMap()): HostResponse

    /** Per-provider key/value storage (64 KB total cap). */
    fun storageGet(key: String): String?

    fun storageSet(key: String, value: String)

    /** [level] is `"d"`, `"w"` or `"e"`. */
    fun log(level: String, message: String)
}

class HostResponse(
    val status: Int,
    val url: String,
    val headers: Map<String, String>,
    val body: String,
)
