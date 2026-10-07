package io.blueoak.ps4providers.kotlindemo

import io.blueoak.ps4toolkit.provider.api.DexProvider
import io.blueoak.ps4toolkit.provider.api.ProviderHost
import java.net.URLDecoder
import java.net.URLEncoder

private typealias Obj = Map<String, Any?>

/**
 * Kotlin (Dex) equivalent of the TypeScript `demo-catalog` provider: browses demo/catalog.json from this repository.
 * Results are JSON strings in the API v1 shapes (IMPLEMENTATION_PLAN.md section 27.2).
 */
class KotlinDemoProvider : DexProvider {
    private lateinit var host: ProviderHost

    override fun init(host: ProviderHost) {
        this.host = host
    }

    override fun getHome(page: Int): String {
        if (page > 1) return "[]"
        val base = catalogBase()
        val byCategory = LinkedHashMap<String, MutableList<Obj>>()
        for (item in fetchCatalog(base)) {
            val category = item.string("category")?.takeIf { it.isNotEmpty() } ?: "Demo"
            byCategory.getOrPut(category) { ArrayList() }.add(card(base, item))
        }
        return MiniJson.write(byCategory.map { (name, cards) -> mapOf("name" to name, "cards" to cards, "hasMore" to false) })
    }

    override fun search(query: String, page: Int): String {
        if (page > 1) return "[]"
        val base = catalogBase()
        val q = query.trim().lowercase()
        val cards = fetchCatalog(base)
            .filter {
                q.isEmpty() ||
                    it.string("title").orEmpty().lowercase().contains(q) ||
                    it.string("titleId").orEmpty().lowercase().contains(q)
            }
            .map { card(base, it) }
        return MiniJson.write(cards)
    }

    override fun load(url: String): String {
        val hash = url.indexOf('#')
        require(hash >= 0) { "not a kotlin-demo URL (missing #id): $url" }
        val base = url.substring(0, hash)
        val id = URLDecoder.decode(url.substring(hash + 1), "UTF-8")
        val item = fetchCatalog(base).firstOrNull { it.string("id") == id } ?: error("no catalog entry with id '$id'")
        val rawReleases = item.objects("releases")
        val releases = rawReleases.map { r ->
            val parts = r.strings("parts")
            mapOf(
                "label" to r.string("label"),
                "kind" to r.string("kind"),
                "version" to r.string("version"),
                "sources" to listOf(
                    mapOf(
                        "host" to (r.string("host")?.takeIf { it.isNotEmpty() } ?: "github.com"),
                        "label" to if (parts.size > 1) "GitHub Releases (${parts.size} parts)" else "GitHub Releases",
                        "parts" to parts,
                        "sizeBytes" to r.number("sizeBytes"),
                    ),
                ),
            )
        }
        return MiniJson.write(
            mapOf(
                "url" to url,
                "title" to item.string("title"),
                "titleId" to item.string("titleId"),
                "coverUrl" to item.string("coverUrl"),
                "description" to item.string("description"),
                "region" to item.string("region"),
                "minFirmware" to item.string("minFirmware"),
                "sizeBytes" to rawReleases.firstOrNull()?.number("sizeBytes"),
                "releases" to releases,
            ),
        )
    }

    override fun extract(url: String): String = "[]"

    private fun catalogBase(): String =
        (host.settings["catalogUrl"]?.takeIf { it.isNotBlank() } ?: DEFAULT_CATALOG_URL).substringBefore('#')

    /** Card URLs are "<catalog url>#<item id>", so load() needs no state. */
    private fun card(base: String, item: Obj): Obj = mapOf(
        "url" to base + "#" + URLEncoder.encode(item.string("id").orEmpty(), "UTF-8"),
        "title" to item.string("title"),
        "coverUrl" to item.string("coverUrl"),
        "titleId" to item.string("titleId"),
        "region" to item.string("region"),
        "badges" to listOf("demo"),
    )

    private fun fetchCatalog(url: String): List<Obj> {
        val res = host.httpGet(url)
        check(res.status == 200) { "catalog returned HTTP ${res.status} for $url" }
        val data = try {
            MiniJson.parse(res.body)
        } catch (e: IllegalArgumentException) {
            throw IllegalStateException("catalog is not valid JSON: ${e.message}", e)
        }
        val items = (data as? Map<*, *>)?.get("items") as? List<*> ?: error("catalog has no items[]")
        return items.map { asObj(it) ?: error("catalog item is not an object") }
    }

    @Suppress("UNCHECKED_CAST")
    private fun asObj(v: Any?): Obj? = v as? Map<String, Any?>

    private fun Obj.string(key: String): String? = this[key] as? String

    private fun Obj.number(key: String): Long? = (this[key] as? Number)?.toLong()

    private fun Obj.objects(key: String): List<Obj> =
        (this[key] as? List<*>)?.mapNotNull { asObj(it) } ?: emptyList()

    private fun Obj.strings(key: String): List<String> =
        (this[key] as? List<*>)?.filterIsInstance<String>() ?: emptyList()

    companion object {
        const val DEFAULT_CATALOG_URL =
            "https://raw.githubusercontent.com/alyabroudy1/ps4-providers-template/main/demo/catalog.json"
    }
}
