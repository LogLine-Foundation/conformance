# Legacy Fixtures (Superseded)

These receipt files use the **LIP-0003** format which has been **superseded by LIP-0007**.

They are kept for historical reference and audit trail only. Do NOT use them as templates for new implementations.

Key differences from the current `logline.receipt.v0` format:

- Used `logline-receipt-v0` (dashes) instead of `logline.receipt.v0` (dots)
- Contained `result`, `evidence`, and `transport` fields (now forbidden)
- Used `result_hash` / `receipt_hash` instead of `content_hash`
- Used length-prefixed tuple hashing instead of JCS

For current receipt examples, see `vectors/receipt/valid/`.
