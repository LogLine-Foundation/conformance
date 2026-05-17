# LogLine Foundation — Conformance

Tests and machinery that prove implementations obey [`LogLine-Foundation/canon`](https://github.com/LogLine-Foundation/canon).

```
canon       = canonical minimal form
conformance = proof that engines obey
engine      = implementation / runtime
registry    = publication / versioning
docs        = human explanation
```

This repo is **conformance**. It is allowed — required, even — to have schemas, vectors, fixtures, verifiers, generators, and tests. None of these belong in `canon`. `canon` stays one file, dry, importable.

## What lives here

| path | role |
|---|---|
| `schemas/` | Machine-readable specs (JSON Schema 2020-12). Each canon file gets a `.schema.json`. |
| `vectors/receipt/valid/` (and other layers) | Receipts that MUST pass conformance. Hashes computed correctly. |
| `vectors/receipt/invalid/` (and other layers) | Receipts that MUST fail conformance. Each filename names the violation. |
| `hash-profiles/` | Specifications of canonicalization + hash algorithms referenced from the schema. |
| `fixtures/` | Convenience: one canonical valid + one canonical invalid for fast-dev import. |
| `tools/` | Reference verifier (`verify-receipt.mjs`, Node, zero deps). Implements the schema rules manually — *not* a JSON-Schema-validator-based implementation. See note below. |

## Current canon coverage

| canon | schema | vectors | verifier |
|---|---|---|---|
| `logline.receipt.v0` | `schemas/logline.receipt.v0.schema.json` | ✅ valid (9) + invalid (12) | `tools/verify-receipt.mjs` |

> The reference verifier in `tools/verify-receipt.mjs` is intentionally zero-dependency and implements the schema policy by hand. This keeps the conformance suite auditable in one read. The JSON Schema is the **specification of the rules**; the verifier is **one implementation** of them. Production engines should validate against `schemas/logline.receipt.v0.schema.json` using an audited JSON Schema validator (`ajv` in JS, `jsonschema` in Rust, etc.) AND run the conformance suite.

## Quickstart

```bash
# verify a single receipt
node tools/verify-receipt.mjs vectors/receipt/valid/dan-rested.json

# run full conformance (all valid pass, all invalid fail)
node tools/verify-receipt.mjs --suite

# fill in hashes for a receipt draft (writes back to the file)
node tools/verify-receipt.mjs --fill drafts/my-receipt.json
```

## Hash layering — the rule conformance enforces

```
tuple_hash    = sha256(jcs(pick: 9 slots))                          → pure act, identity of the action
content_hash  = sha256(jcs(all_except: [id, hashes]))               → interpreted act:
                                                                       receipt_version + 9 slots + json_canonicalization + AUX
envelope_hash = sha256(jcs({content, transport}))                   → transported package, lives ONLY on the Envelope wrapper
```

Three independent hashes, three independent purposes. Two receipts with the **same** `tuple_hash` but **different** `content_hash` are the **same act, different interpretations** — useful signal for audit and for diffing AI decompositions of the same natural-language input.

`envelope_hash` deliberately does **not** live inside the receipt. It is a property of transport. A receipt at rest has no envelope; a receipt in transit is wrapped by exactly one envelope at a time, computed by the sender, verified by the receiver.

## Forbidden legacy fields

Three top-level field names are **explicitly forbidden** in v0 receipts, even though `additionalProperties: true` permits free-form AUX:

| field | reason |
|---|---|
| `result` | Earlier drafts placed execution results inside the receipt. v0 keeps the receipt narrow: a receipt records an act, not its outcome. Outcomes are separate records that content-address back via this receipt's `id`. |
| `evidence` | Same rationale. Evidence is attached, not embedded — it lives in its own evidence store, content-addressed by `id`. |
| `transport` | Transport metadata lives ONLY on the Envelope wrapper. A receipt at rest has no transport. |

The schema enforces this with `"propertyName": {"not": {}}` for each forbidden name. The verifier rejects with a named error. Three invalid vectors (`legacy-{result,evidence,transport}-field.json`) prove the rule.

Any other top-level field is fair AUX and is included in `content_hash`.

## Canon mold vs emitted receipt

The `LogLine-Foundation/canon` repository contains the unresolved **canon mold** — a JSON shape that documents the canonical form, not a valid receipt.

In the canon mold:
- `id` is the literal pointer string `"hashes.content_hash"`
- all hash fields may be empty strings
- the file is **importable as a canonical mold**, not valid as an emitted receipt

In an **emitted receipt** (what conformance validates):
- `id` is REQUIRED and MUST be the resolved 64-char lowercase hex `content_hash`
- `hashes.tuple_hash` and `hashes.content_hash` MUST be resolved 64-char lowercase hex
- the file is **consumable as an instance**: passes the JSON Schema, verifies under the reference verifier

The canon mold therefore does **not** pass `vectors/receipt/valid/` (and other layers). It documents shape; conformance proves engines obey that shape. Both are consumable — the canon as a mold, the receipt as an instance. They live in different repos.

## How implementations consume this

1. Pin a SHA of this repo (or of `canon` + `conformance` jointly).
2. Build-time: download `schemas/logline.receipt.v0.schema.json` and `vectors/`, verify SHA, cache.
3. Generate types from schema (`typify` → Rust, `json-schema-to-typescript` → TS, etc).
4. Run the test suite against your engine — every vector in `vectors/receipt/valid/` (and other layers) must verify, every vector in `vectors/receipt/invalid/` (and other layers) must be rejected with the violation named in its filename.

If your engine passes, you may declare conformance with `logline.receipt.v0`. Otherwise you do not.

## Aggressive JCS vectors

The `vectors/valid/aux-*.json` set stress-tests the canonicalization step independently of the act semantics:

| vector | exercises |
|---|---|
| `aux-nested.json` | nested objects, mixed arrays inside AUX |
| `aux-unicode.json` | em-dash, accented characters, emoji above BMP (`🌙` = surrogate pair), control characters (`\t`, `\n`) |
| `aux-key-order.json` | mixed-case keys, underscore-prefixed keys, reverse-alphabetic insertion order — JCS MUST sort |
| `aux-number-decimal.json` | integer, decimal, negative decimal, `Number.MAX_SAFE_INTEGER`, zero, small decimal — JCS number formatting per ES6 §7.1.12.1 |
| `aux-array-order.json` | arrays preserve insertion order (JCS does NOT sort arrays), nested arrays, mixed-type arrays |

A `JSON.stringify`-based "verifier" will fail every one of these. Any engine that passes the full suite has at minimum a serious JCS implementation.

## What is NOT yet here

- `tools/verify-receipt.rs` — Rust port of the reference verifier (planned)
- `compatibility/` — third-party engine results against this suite (planned)
- `.github/workflows/conformance.yml` — CI runner (planned)
- `package.json` with `npm test` mapping to `--suite` (planned)
- Further edge-case vectors: exponent boundaries, negative zero, deeply-nested structures, NFC/NFD Unicode normalization (planned)

These are roadmap, not promises. Nothing in this repo claims to be present unless it is in the table above.
