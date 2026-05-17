#!/usr/bin/env node
// LogLine Foundation — Conformance reference verifier (Node, zero deps).
//
// Usage:
//   node verify-receipt.mjs <file>           # verify one receipt or envelope
//   node verify-receipt.mjs --fill <file>    # compute and write back hashes
//   node verify-receipt.mjs --suite [DIR]    # run conformance over vectors/

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..")

// ---------------------------------------------------------------- JCS RFC-8785
function jcs(value) {
  if (value === null) return "null"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number is not valid JSON")
    if (Object.is(value, -0)) return "0"
    return String(value)
  }
  if (typeof value === "string") return JSON.stringify(value)
  if (Array.isArray(value)) return "[" + value.map(jcs).join(",") + "]"
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([_, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + jcs(v)).join(",") + "}"
  }
  throw new Error(`cannot canonicalize value of type ${typeof value}`)
}

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex")

// ---------------------------------------------------------------- canon shape
const RECEIPT_VERSION = "logline.receipt.v0"
const JSON_CANON = "jcs-rfc8785"
const SLOTS = ["who","did","this","when","confirmed_by","if_ok","if_doubt","if_not","status"]
const RESERVED = new Set([...SLOTS, "id", "hashes", "receipt_version", "json_canonicalization"])
// Names that carried meaning in earlier drafts and MUST NOT appear in receipt v0
// (transport metadata lives only on the Envelope wrapper; result/evidence are
// upstream concerns that the receipt MUST NOT smuggle as AUX).
const FORBIDDEN_LEGACY_FIELDS = ["result", "evidence", "transport"]

function computeTupleHash(receipt) {
  const tuple = {}
  for (const k of SLOTS) tuple[k] = receipt[k]
  return sha256(jcs(tuple))
}

function computeContentHash(receipt) {
  const { id: _id, hashes: _h, ...rest } = receipt
  return sha256(jcs(rest))
}

function computeEnvelopeHash(envelope) {
  const { envelope_hash: _eh, ...rest } = envelope
  return sha256(jcs(rest))
}

// ---------------------------------------------------------------- validators
function validateSchema(receipt) {
  const errors = []
  if (typeof receipt !== "object" || receipt === null) {
    return ["receipt is not a JSON object"]
  }
  if (receipt.receipt_version !== RECEIPT_VERSION) {
    errors.push(`receipt_version must be "${RECEIPT_VERSION}", got ${JSON.stringify(receipt.receipt_version)}`)
  }
  if (receipt.json_canonicalization !== JSON_CANON) {
    errors.push(`json_canonicalization must be "${JSON_CANON}", got ${JSON.stringify(receipt.json_canonicalization)}`)
  }
  for (const k of SLOTS) {
    if (!(k in receipt)) errors.push(`missing required slot "${k}"`)
    else if (typeof receipt[k] !== "string") errors.push(`slot "${k}" must be a string`)
  }
  if (!receipt.hashes || typeof receipt.hashes !== "object") {
    errors.push(`missing or invalid "hashes" object`)
  } else {
    const h = receipt.hashes
    if (h.algorithm !== "sha256") errors.push(`hashes.algorithm must be "sha256"`)
    for (const f of ["tuple_hash", "content_hash"]) {
      if (typeof h[f] !== "string" || !/^[0-9a-f]{64}$/.test(h[f])) {
        errors.push(`hashes.${f} must be a 64-char hex sha256`)
      }
    }
    const allowed = new Set(["tuple_hash","content_hash","algorithm"])
    for (const k of Object.keys(h)) {
      if (!allowed.has(k)) errors.push(`hashes contains unexpected field "${k}" (envelope_hash MUST NOT live inside the receipt; it belongs on the Envelope wrapper)`)
    }
  }
  if (!("id" in receipt)) {
    errors.push(`missing required field "id"`)
  } else if (typeof receipt.id !== "string" || !/^[0-9a-f]{64}$/.test(receipt.id)) {
    errors.push(`id must be a 64-char lowercase hex sha256`)
  }
  for (const k of FORBIDDEN_LEGACY_FIELDS) {
    if (k in receipt) {
      errors.push(`reserved legacy field "${k}" MUST NOT appear in receipt v0 (lives on Envelope wrapper for transport; not a receipt concern for result/evidence)`)
    }
  }
  return errors
}

function verifyHashes(receipt) {
  const errors = []
  const expectedTuple = computeTupleHash(receipt)
  if (receipt.hashes?.tuple_hash !== expectedTuple) {
    errors.push(`tuple_hash mismatch: expected ${expectedTuple}, got ${receipt.hashes?.tuple_hash}`)
  }
  const expectedContent = computeContentHash(receipt)
  if (receipt.hashes?.content_hash !== expectedContent) {
    errors.push(`content_hash mismatch: expected ${expectedContent}, got ${receipt.hashes?.content_hash}`)
  }
  if (typeof receipt.id === "string" && receipt.id !== expectedContent) {
    errors.push(`id mismatch: must equal content_hash. expected ${expectedContent}, got ${receipt.id}`)
  }
  return errors
}

function isEnvelope(obj) {
  // An envelope is identified by having any of the wrapper-shaped slots present.
  // This way an envelope that is MISSING envelope_hash (or has it wrong) still
  // gets classified as envelope and produces accurate errors, instead of being
  // misclassified as a receipt with "extra fields".
  return obj && typeof obj === "object" && (
    ("content" in obj && "transport" in obj) ||
    "envelope_hash" in obj
  )
}

function verifyEnvelope(env) {
  const errors = []
  if (!("content" in env) || typeof env.content !== "object" || env.content === null) {
    errors.push(`envelope.content must be a receipt object`)
  }
  if (!env.transport || typeof env.transport !== "object") {
    errors.push(`envelope.transport must be an object`)
  } else {
    for (const k of ["sent_by", "sent_to", "sent_at"]) {
      if (typeof env.transport[k] !== "string" || env.transport[k].length === 0) {
        errors.push(`envelope.transport.${k} must be a non-empty string`)
      }
    }
  }
  if (typeof env.envelope_hash !== "string" || !/^[0-9a-f]{64}$/.test(env.envelope_hash)) {
    errors.push(`envelope_hash must be a 64-char lowercase hex sha256`)
  } else {
    const expectedEnv = computeEnvelopeHash(env)
    if (env.envelope_hash !== expectedEnv) {
      errors.push(`envelope_hash mismatch: expected ${expectedEnv}, got ${env.envelope_hash}`)
    }
  }
  if (env.content && typeof env.content === "object") {
    errors.push(...validateSchema(env.content).map((e) => `content: ${e}`))
    if (errors.filter((e) => e.startsWith("content:")).length === 0) {
      errors.push(...verifyHashes(env.content).map((e) => `content: ${e}`))
    }
  }
  return errors
}

// ---------------------------------------------------------------- modes
function verifyFile(path) {
  const data = JSON.parse(readFileSync(path, "utf8"))
  if (isEnvelope(data)) return { kind: "envelope", errors: verifyEnvelope(data) }
  const errs = validateSchema(data)
  if (errs.length > 0) return { kind: "receipt", errors: errs }
  return { kind: "receipt", errors: verifyHashes(data) }
}

function fillFile(path) {
  const data = JSON.parse(readFileSync(path, "utf8"))

  // Apply required-meta defaults BEFORE hashing — otherwise content_hash
  // would be computed on a partial receipt that the verifier then rejects.
  data.receipt_version ??= RECEIPT_VERSION
  data.json_canonicalization ??= JSON_CANON

  // Drop any stale id/hashes so they cannot pollute content_hash.
  delete data.id
  delete data.hashes

  const tuple_hash = computeTupleHash(data)
  const content_hash = computeContentHash(data)
  data.hashes = {
    tuple_hash,
    content_hash,
    algorithm: "sha256",
  }
  data.id = content_hash

  writeFileSync(path, JSON.stringify(data, null, 2) + "\n")
  return { tuple_hash, content_hash }
}

function suiteRun(root) {
  const dir = root || join(REPO, "vectors")
  const findJson = (d) => {
    const out = []
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) out.push(...findJson(p))
      else if (f.endsWith(".json")) out.push(p)
    }
    return out
  }
  const valid = findJson(join(dir, "receipt", "valid")).sort()
  const invalid = findJson(join(dir, "receipt", "invalid")).sort()

  let pass = 0, fail = 0
  for (const f of valid) {
    const r = verifyFile(f)
    if (r.errors.length === 0) { console.log(`✓ VALID   ${f.replace(REPO + "/", "")}`); pass++ }
    else { console.log(`✗ VALID   ${f.replace(REPO + "/", "")} — expected pass, got errors:`); r.errors.forEach((e) => console.log(`    - ${e}`)); fail++ }
  }
  for (const f of invalid) {
    const r = verifyFile(f)
    if (r.errors.length > 0) { console.log(`✓ INVALID ${f.replace(REPO + "/", "")} — rejected (${r.errors.length} error${r.errors.length === 1 ? "" : "s"})`); pass++ }
    else { console.log(`✗ INVALID ${f.replace(REPO + "/", "")} — expected reject, but verified OK`); fail++ }
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

// ---------------------------------------------------------------- entry
const args = process.argv.slice(2)
if (args.length === 0 || args[0] === "--help") {
  console.log(`usage:
  verify-receipt.mjs <file>            verify one receipt or envelope
  verify-receipt.mjs --fill <file>     compute hashes and write back
  verify-receipt.mjs --suite [DIR]     run conformance over vectors/`)
  process.exit(args.length === 0 ? 2 : 0)
}
if (args[0] === "--suite") {
  suiteRun(args[1])
} else if (args[0] === "--fill") {
  if (!args[1]) { console.error("--fill requires a path"); process.exit(2) }
  const out = fillFile(args[1])
  console.log(`filled ${args[1]}: tuple=${out.tuple_hash.slice(0,12)}… content=${out.content_hash.slice(0,12)}…`)
} else {
  const r = verifyFile(args[0])
  if (r.errors.length === 0) {
    console.log(`✓ ${r.kind} OK`)
    process.exit(0)
  } else {
    console.log(`✗ ${r.kind} FAILED`)
    r.errors.forEach((e) => console.log(`  - ${e}`))
    process.exit(1)
  }
}
