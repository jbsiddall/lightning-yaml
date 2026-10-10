# Native-value tag helpers

`TagValues.dfy` converts the seven assigned helper behaviors from the source
parser into Dafny. It records failures in `lastError` and returns the native
value directly; the Engine caller checks `ErrorMessage()` immediately and
routes a nonempty message through its own `Fail` method at the current source
position. Calling `Native.Fail` inside this helper would lose the parser's line
and column. A single-value ABI also avoids a tuple array per `!!omap` or
`!!pairs` entry. This is the intended integration boundary, not a parser-wide
implementation claim.

## Ported behavior

| Dafny helper | Source behavior |
| --- | --- |
| `BASE64_INV` | The inverse-alphabet result for the ASCII base64 alphabet; `-1` otherwise |
| `IsBase64Whitespace`, `StripBase64Whitespace` | Remove only space, tab, LF, and CR, preserving the no-whitespace fast path |
| `DecodeBinary` | Check length, trailing padding, and alphabet in source order; allocate a plain `Uint8Array` and decode every group in Dafny |
| `BuildSet` | Read `Object.keys` in JS order, require each raw property value to be `null`, and build a native `Set` |
| `BuildOmap` | Walk the parsed sequence, validate one-key objects, read each value, and build the insertion-ordered native `Map` |
| `ValidatePairs` | Validate every parsed entry while returning the original array at the Engine call site |
| `SinglePairKeys` | Reject null/non-object/array entries and enforce exactly one own enumerable string key |

The inverse alphabet table is represented by `BASE64_INV`'s Dafny range
checks rather than an allocated 256-slot typed array. Padding validation retains
the source's precise behavior, including the order of length and alphabet
errors. Binary output uses `CreateUint8Array` and indexed `ByteSet`; no base64
loop or collection transformation is delegated to TypeScript.

## Trusted native operations

The helper calls `StringLength`, `CodeUnitAt`, `Slice`, and `Concat` for raw
UTF-16 access and whitespace output; `CreateUint8Array` and `ByteSet` for native
binary allocation/writes; `ObjectKeys`, `ArrayLength`, `ArrayGet`,
`StringValueOf`, `ObjectGet`, and `IsObject`/`IsNull`/`IsArray` for parsing the
native value graph; and `SetCreate`/`SetAdd`, `MapCreate`/`MapSet`,
`SetValue`/`MapValue`, and `Undefined` for native tagged values and error
outcomes. `MapValue`/`SetValue` are identity coercions at the opaque ABI
boundary: they must return the same JS Map/Set objects, without a box or graph
copy. The caller must check `ErrorMessage()` immediately after each helper call
and invoke `Engine.Fail(error)` before continuing.

These operations do not decide base64 validity, transform collection shape, or
format YAML errors. Their JS implementations remain trusted intrinsics.

## Verification status

The module was generated using Dafny 4.11.0 with `--target js
--unicode-char false --no-verify`. All seven helpers remain deferred for proof.
Later contracts should cover the base64 inverse table and error precedence,
UTF-16 indexing and whitespace filtering, exact byte output, Object.keys order,
raw getter effects, native Map/Set identity/order, and error forwarding through
the Engine's current position. Later contracts must also model `lastError` being
cleared at every public helper entry and propagated through the internal
`SinglePairKeys` calls. The isolated snapshot has no tag dispatch wiring;
this file alone is not evidence that the full parser replacement passes its
suite.
