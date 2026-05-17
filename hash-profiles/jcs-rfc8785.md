# jcs-rfc8785

JSON Canonicalization Scheme as specified in [RFC 8785](https://datatracker.ietf.org/doc/html/rfc8785).

## Why we use it

Hashes must be reproducible byte-for-byte across implementations. Two engines parsing the same logical receipt MUST produce the same `tuple_hash` and `content_hash` (and matching `envelope_hash` on identical transport metadata). Naive `JSON.stringify` does not give this: key order, whitespace, number formatting, and string escaping all vary. JCS fixes all of them.

## Rules summary

1. **Object keys are sorted lexicographically** (by UTF-16 code units, as per ECMAScript `Array.prototype.sort` on strings).
2. **No insignificant whitespace** — no spaces between tokens, no trailing newline.
3. **String escaping uses the minimum form** — `"\""`, `"\\"`, `"\b"`, `"\f"`, `"\n"`, `"\r"`, `"\t"`, and `"\u00XX"` for control characters; all other characters appear unescaped.
4. **Numbers** follow ECMAScript `Number.prototype.toString` (specifically, ES6 §7.1.12.1):
   - integers in safe range: bare digits (`42`, not `42.0`)
   - non-integers: shortest decimal that round-trips
   - no `+` sign on exponent, lowercase `e`
   - no leading zeros (except `0` itself and `0.x`)
   - no trailing zeros after decimal point
5. **Booleans and null** are `true`, `false`, `null` (lowercase, unquoted).
6. **Arrays** preserve insertion order.

## Worked example

Input (any valid JSON form of the same logical object):
```json
{
  "b": 2,
  "a": [1, 0.5],
  "c": "hi"
}
```

JCS output (exact bytes):
```
{"a":[1,0.5],"b":2,"c":"hi"}
```

SHA-256 of those bytes (full, lowercase hex):
```
54927d21fad3946f67210fdacd35b9eecc06842b4a0c4fcf33e382a301f7246f
```

Any conformant JCS+SHA-256 implementation MUST produce exactly this hash for this input.

## Reference implementation note

The reference verifier in [`tools/verify-receipt.mjs`](../tools/verify-receipt.mjs) implements a **reference-lite** JCS in pure Node, sufficient for the current vector set. It is *not* a substitute for an audited JCS implementation in production code paths. Production engines should use:

- Rust: [`serde_jcs`](https://crates.io/crates/serde_jcs) (audited)
- JavaScript / TypeScript: [`@trust/jcs`](https://www.npmjs.com/package/@trust/jcs), [`canonicalize`](https://www.npmjs.com/package/canonicalize)
- Python: [`jcs`](https://pypi.org/project/jcs/)
- Go: [`gowebpki/jcs`](https://github.com/gowebpki/jcs)

The reference-lite verifier is intentionally minimal so the conformance suite stays dependency-free and auditable in a single read.

## Implementer notes

- Do **not** use `serde_json::to_string` (Rust) or `JSON.stringify` (JS) directly — neither sorts keys.
- A conformant JCS implementation can be ~30 lines in any modern language, but edge cases (Unicode normalization, negative zero, exponent boundaries) are where production-grade libraries earn their keep.

## Conformance

A receipt where `json_canonicalization = "jcs-rfc8785"` MUST have all hashes computed using JCS as defined above. Any deviation — including the popular shortcut `JSON.stringify(obj)` — is a conformance violation regardless of how "close" the output is.
