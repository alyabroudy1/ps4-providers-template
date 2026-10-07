package io.blueoak.ps4providers.kotlindemo

/**
 * Tiny JSON support so the provider has no third-party dependency (everything in classes.dex is our own code, and
 * org.json is not available in plain JVM unit tests). Parsed values are Map / List / String / Long / Double /
 * Boolean / null.
 */
internal object MiniJson {
    fun parse(text: String): Any? {
        val p = Parser(text)
        p.skipWs()
        val v = p.value()
        p.skipWs()
        if (p.pos != text.length) p.fail("trailing data")
        return v
    }

    /** Serialises Map / List / String / Number / Boolean / null (map keys in insertion order). */
    fun write(value: Any?): String = StringBuilder().also { write(value, it) }.toString()

    private fun write(v: Any?, sb: StringBuilder) {
        when (v) {
            null -> sb.append("null")
            is String -> quote(v, sb)
            is Boolean, is Int, is Long -> sb.append(v.toString())
            is Double -> sb.append(if (v.isFinite()) v.toString() else "null")
            is Map<*, *> -> {
                sb.append('{')
                var first = true
                for ((k, x) in v) {
                    if (!first) sb.append(',')
                    first = false
                    quote(k.toString(), sb)
                    sb.append(':')
                    write(x, sb)
                }
                sb.append('}')
            }
            is Iterable<*> -> {
                sb.append('[')
                var first = true
                for (x in v) {
                    if (!first) sb.append(',')
                    first = false
                    write(x, sb)
                }
                sb.append(']')
            }
            else -> throw IllegalArgumentException("cannot serialise " + v.javaClass.name)
        }
    }

    private fun quote(s: String, sb: StringBuilder) {
        sb.append('"')
        for (c in s) {
            when {
                c == '"' -> sb.append("\\\"")
                c == '\\' -> sb.append("\\\\")
                c == '\n' -> sb.append("\\n")
                c == '\r' -> sb.append("\\r")
                c == '\t' -> sb.append("\\t")
                c < ' ' -> sb.append("\\u").append(c.code.toString(16).padStart(4, '0'))
                else -> sb.append(c)
            }
        }
        sb.append('"')
    }

    private class Parser(val s: String) {
        var pos = 0

        fun fail(msg: String): Nothing = throw IllegalArgumentException("invalid JSON at $pos: $msg")

        fun skipWs() {
            while (pos < s.length && (s[pos] == ' ' || s[pos] == '\n' || s[pos] == '\r' || s[pos] == '\t')) pos++
        }

        fun value(): Any? {
            if (pos >= s.length) fail("unexpected end")
            val c = s[pos]
            return when {
                c == '{' -> obj()
                c == '[' -> arr()
                c == '"' -> str()
                c == 't' -> lit("true", true)
                c == 'f' -> lit("false", false)
                c == 'n' -> lit("null", null)
                c == '-' || c in '0'..'9' -> num()
                else -> fail("unexpected '$c'")
            }
        }

        private fun lit(word: String, v: Any?): Any? {
            if (!s.startsWith(word, pos)) fail("expected $word")
            pos += word.length
            return v
        }

        private fun obj(): Map<String, Any?> {
            val m = LinkedHashMap<String, Any?>()
            pos++
            skipWs()
            if (pos < s.length && s[pos] == '}') {
                pos++
                return m
            }
            while (true) {
                skipWs()
                if (pos >= s.length || s[pos] != '"') fail("expected string key")
                val k = str()
                skipWs()
                if (pos >= s.length || s[pos] != ':') fail("expected ':'")
                pos++
                skipWs()
                m[k] = value()
                skipWs()
                val d = if (pos < s.length) s[pos++] else fail("unexpected end")
                if (d == '}') return m
                if (d != ',') fail("expected ',' or '}'")
            }
        }

        private fun arr(): List<Any?> {
            val l = ArrayList<Any?>()
            pos++
            skipWs()
            if (pos < s.length && s[pos] == ']') {
                pos++
                return l
            }
            while (true) {
                skipWs()
                l.add(value())
                skipWs()
                val d = if (pos < s.length) s[pos++] else fail("unexpected end")
                if (d == ']') return l
                if (d != ',') fail("expected ',' or ']'")
            }
        }

        private fun str(): String {
            pos++ // opening quote
            val sb = StringBuilder()
            while (true) {
                if (pos >= s.length) fail("unterminated string")
                val c = s[pos++]
                if (c == '"') return sb.toString()
                if (c != '\\') {
                    sb.append(c)
                    continue
                }
                if (pos >= s.length) fail("unterminated escape")
                val e = s[pos++]
                when (e) {
                    '"', '\\', '/' -> sb.append(e)
                    'b' -> sb.append('\b')
                    'f' -> sb.append('\u000C')
                    'n' -> sb.append('\n')
                    'r' -> sb.append('\r')
                    't' -> sb.append('\t')
                    'u' -> {
                        if (pos + 4 > s.length) fail("bad unicode escape")
                        val code = s.substring(pos, pos + 4).toIntOrNull(16) ?: fail("bad unicode escape")
                        sb.append(code.toChar())
                        pos += 4
                    }
                    else -> fail("bad escape")
                }
            }
        }

        private fun num(): Any {
            val start = pos
            if (s[pos] == '-') pos++
            while (pos < s.length && (s[pos] in '0'..'9' || s[pos] == '.' || s[pos] == 'e' || s[pos] == 'E' || s[pos] == '+' || s[pos] == '-')) pos++
            val t = s.substring(start, pos)
            return t.toLongOrNull() ?: t.toDoubleOrNull() ?: fail("bad number '$t'")
        }
    }
}
