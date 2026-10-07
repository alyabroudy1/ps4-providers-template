@file:Suppress("UNCHECKED_CAST")

package io.blueoak.ps4providers.kotlindemo

import io.blueoak.ps4toolkit.provider.api.HostResponse
import io.blueoak.ps4toolkit.provider.api.ProviderHost
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

private const val CATALOG_URL = "https://example.test/catalog.json"

private class FakeHost(
    override val settings: Map<String, String> = mapOf("catalogUrl" to CATALOG_URL),
    private val status: Int = 200,
) : ProviderHost {
    val requested = mutableListOf<String>()
    private val body = FakeHost::class.java.getResource("/catalog.json")!!.readText()

    override fun httpGet(url: String, headers: Map<String, String>): HostResponse {
        requested += url
        return HostResponse(status, url, emptyMap(), body)
    }

    override fun httpPost(url: String, body: String, headers: Map<String, String>): HostResponse = error("unused")
    override fun storageGet(key: String): String? = null
    override fun storageSet(key: String, value: String) {}
    override fun log(level: String, message: String) {}
}

@Suppress("UNCHECKED_CAST")
private fun parseList(json: String) = MiniJson.parse(json) as List<Map<String, Any?>>

@Suppress("UNCHECKED_CAST")
private fun parseObj(json: String) = MiniJson.parse(json) as Map<String, Any?>

class KotlinDemoProviderTest {
    private fun provider(host: ProviderHost = FakeHost()) = KotlinDemoProvider().also { it.init(host) }

    @Test
    fun homeGroupsByCategoryWithValidCards() {
        val host = FakeHost()
        val sections = parseList(provider(host).getHome(1))
        assertEquals(listOf(CATALOG_URL), host.requested)
        assertTrue(sections.isNotEmpty())
        for (s in sections) {
            assertTrue((s["name"] as String).isNotBlank())
            assertEquals(false, s["hasMore"])
            val cards = s["cards"] as List<Map<String, Any?>>
            assertTrue(cards.isNotEmpty())
            for (c in cards) {
                assertTrue((c["url"] as String).startsWith("$CATALOG_URL#"))
                assertTrue((c["title"] as String).isNotBlank())
                assertEquals(listOf("demo"), c["badges"])
            }
        }
        assertTrue(sections.any { it["name"] == "Featured" })
    }

    @Test
    fun homeIsEmptyAfterPageOne() {
        assertEquals("[]", provider().getHome(2))
        assertEquals("[]", provider().search("demo", 2))
    }

    @Test
    fun searchFiltersByTitleAndTitleId() {
        val p = provider()
        val byTitle = parseList(p.search("HELLO", 1))
        assertEquals(1, byTitle.size)
        assertEquals("Demo Homebrew Hello", byTitle[0]["title"])
        assertEquals("DEMO00002", parseList(p.search("demo00002", 1)).single()["titleId"])
        assertEquals(0, parseList(p.search("no-such-thing", 1)).size)
        assertTrue(parseList(p.search("", 1)).size >= 2)
    }

    @Test
    fun loadReturnsDetailsMatchingApiV1() {
        val p = provider()
        val card = parseList(p.search("hello", 1)).single()
        val d = parseObj(p.load(card["url"] as String))
        assertEquals(card["url"], d["url"])
        assertEquals("Demo Homebrew Hello", d["title"])
        assertEquals("DEMO00001", d["titleId"])
        assertEquals(1048576L, d["sizeBytes"])
        val releases = d["releases"] as List<Map<String, Any?>>
        assertEquals(2, releases.size)
        assertEquals("game", releases[0]["kind"])
        assertEquals("update", releases[1]["kind"])
        val source = (releases[0]["sources"] as List<Map<String, Any?>>).single()
        assertEquals("github.com", source["host"])
        assertEquals("GitHub Releases", source["label"])
        assertEquals(1, (source["parts"] as List<*>).size)
    }

    @Test
    fun multiPartReleaseLabelCountsParts() {
        val p = provider()
        val card = parseList(p.search("tools", 1)).single()
        val d = parseObj(p.load(card["url"] as String))
        val source = ((d["releases"] as List<Map<String, Any?>>)[0]["sources"] as List<Map<String, Any?>>).single()
        assertEquals(2, (source["parts"] as List<*>).size)
        assertEquals("GitHub Releases (2 parts)", source["label"])
    }

    @Test
    fun loadErrors() {
        val p = provider()
        assertFailsWith<IllegalArgumentException> { p.load("$CATALOG_URL-without-hash") }
        assertFailsWith<IllegalStateException> { p.load("$CATALOG_URL#missing") }
    }

    @Test
    fun httpErrorPropagates() {
        assertFailsWith<IllegalStateException> { provider(FakeHost(status = 404)).getHome(1) }
    }

    @Test
    fun defaultUrlWhenSettingMissing() {
        val host = FakeHost(settings = emptyMap())
        provider(host).search("x", 1)
        assertEquals(KotlinDemoProvider.DEFAULT_CATALOG_URL, host.requested.single())
    }

    @Test
    fun extractIsEmptyAndNoPatterns() {
        val p = provider()
        assertEquals("[]", p.extract("https://example.test/x"))
        assertTrue(p.extractorPatterns().isEmpty())
    }

    @Test
    fun miniJsonRoundTripsEscapes() {
        val text = "a\"b\\c\n\t\u0001é😀"
        val back = MiniJson.parse(MiniJson.write(mapOf("k" to listOf(text, 1L, null, true))))
        assertNotNull(back)
        assertEquals(mapOf("k" to listOf(text, 1L, null, true)), back)
        assertEquals("é", MiniJson.parse("\"\\u00e9\""))
        assertFailsWith<IllegalArgumentException> { MiniJson.parse("{\"a\":}") }
    }
}
