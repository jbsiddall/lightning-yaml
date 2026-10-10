# Serializer conversion and trust boundary

`Serializer.dfy` ports the complete `src/core.ts` serializer section (the original
lines 4555–5122). YAML decisions and traversal loops remain in Dafny. This first
functional conversion was generated with Dafny 4.11.0 for JavaScript using
`--unicode-char false`; it was built with `--no-verify`. No serializer method has
a semantic equivalence proof yet. The executable source currently has only the
contracts needed to compile the conversion, so the whole method list below is
deferred for the later proof phase.

## Converted methods

| Dafny method or function | Source behavior |
| --- | --- |
| `IndentSpaces` | Cached indentation strings |
| `DumpScanRefs`, `DumpNeedsAnchor`, `DumpAssignAnchor` | Reference counting, cycle-safe pre-scan, and anchor names |
| `IsPlainLeadingIndicator`, `LooksLikeTypedScalar`, `TryNumberGeneric`, `HexDigits`, `OctalDigits`, `IsInfWord`, `IsNanWord` | Plain-scalar safety and the core-schema number grammar used to avoid changing string types |
| `IsPlainScalarSafe`, `NeedsDoubleQuoting`, `EncodeSingleQuoted`, `HexEscape`, `EncodeDoubleQuoted`, `WriteStringScalar`, `WriteRootStringScalar` | Scalar quoting and control-character escapes |
| `FormatCounter`, `FormatNumberValue`, `WriteScalar` | YAML spellings for JS numbers and other scalar-shaped values |
| `EncodeBase64`, `WriteBinaryScalar` | `Uint8Array` to `!!binary` |
| `IsEmptyContainer`, `WriteCollectionBody`, `WriteEntryValue`, `WriteDocumentValue` | Block collections, aliases, and output order |
| `DumpFinish`, `Stringify` | Output flattening, per-call state setup, and cleanup |

These methods preserve the source's traversal order, repeated property reads,
string quote choices, base64 padding, anchor assignment points, depth limit,
and error text. The standalone differential run recorded exact text equality
against the old serializer for the full existing stringify test corpus and
additional edge cases. That is runtime evidence, not a proof.

## Native JavaScript operations used

The following calls are the serializer's trusted boundary. They are primitive
value access or construction operations; none performs YAML scanning,
classification, recursion, base64 encoding, quote selection, or output layout.

| Native operation | Use here | Assumption to specify in the proof phase |
| --- | --- | --- |
| `IsObject`, `IsNull`, `IsArray`, `IsUint8Array`, `IsBoolean`, `IsNumber`, `IsString`, `BooleanValue` | JS value classification and primitive extraction | Match JS `typeof`, `Array.isArray`, and `instanceof Uint8Array` on arbitrary caller values |
| `StringValue`, `StringValueOf`, `StringFallback`, `NumberValue`, `NumberAsCounter`, `FormatNumber`, `NumberIsNaN`, `NumberIsPositiveInfinity`, `NumberIsNegativeInfinity`, `NumberIsNegativeZero` | Preserve primitive identity/formatting and special-number behavior | Match JS `String`, `Number::toString`, and `Object.is` for negative zero; counters stay within the bounded native range |
| `StringLength`, `CodeUnitAt`, `Slice`, `Concat`, `Join` | UTF-16 access, source slices, and appending/joining already-decided YAML fragments | Match native JS string operations, including UTF-16 units and lone surrogates |
| `CreateArray`, `ArrayPush`, `ArrayLength`, `ArrayGet`, `ObjectKeys`, `ObjectGet` | Local part arrays, key snapshots, and caller graph reads | Preserve key order and raw `arr[i]`/`obj[key]` behavior, including holes, inherited indices, getters, and proxies |
| `ByteLength`, `ByteGet` | Read typed-array byte data | Preserve `Uint8Array` identity checks and indexed reads |
| `MapCreate`, `MapHas`, `MapGet`, `MapSet`, `MapSize` | Reference counts, anchor names, and the capped raw-key cache | Match JS `Map` equality and mutation behavior; identity is used for object graph nodes |
| `Fail` | Throw the existing YAML parse error for excessive nesting | Preserve public error constructor identity, name, and message when the facade is wired |

`IndexOf`, `Repeat`, `ObjectSet`, `ObjectSetSafe`, and `Set` operations are part
of the shared native ABI but are not called by this serializer.

## Verification status

All methods in this conversion are **deferred** for semantic verification.
Planned contracts cover value classification; exact UTF-16 string operations;
JS number formatting and special values; identity maps; property-key ordering
and getter effects; depth termination; reference-count/anchor placement; scalar
round-trip safety; base64 equivalence; output text; and normal/error cleanup.
No axiom or host function contract is presented as a proof of its JavaScript
implementation. Generated-code inspection and differential tests must continue
to check the reachable output after integration. End-to-end performance and
memory acceptance are also pending; the serializer-only checks make no speed
claim.
