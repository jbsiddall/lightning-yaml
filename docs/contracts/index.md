# Contracts and proof status

The native, yaml and js-yaml entries share a generated Dafny parser and
serializer. The Native adapter handles option reads, captured completions,
parse cleanup and stringify result checks. Compatibility facades add overload
selection, validation, revivers, document wrappers and error translation.

Current caller behavior is described in [native.md](native.md),
[yaml.md](yaml.md) and [js-yaml.md](js-yaml.md). The machine-readable status is
in the [contract ledger](../../scripts/public-surface-contract-manifest.json).
No complete public operation is formally proved.

## Proof scope

| Area | Verified scope | Open scope |
|---|---|---|
| Option decisions | Five routed policy bodies, conditional on supplied host observations | Raw argument/classifier and physical policy-call correspondence |
| Source scanners | Eight selected local boundary methods | Full grammar, caller preconditions, failures, graph and state effects |
| js-yaml mark model | Closed ordered `markFrom` event definition; nine declarations pass well-formedness checks | No method-correctness proof, executed helper, host correspondence, or complete error-conversion proof |
| Native adapter flow | Conditional ordered-trace contracts cover parse/cleanup, stringify, error text, and default/Number/Boolean budget outcomes; current exact-source body/dependency replay is pending | Authentic public-entry witnesses, profile refinement, raw host binding/heap correspondence, String/reference conversion, exact BigInt/Symbol TypeErrors, and parser/writer semantics |
| Compatibility facades | Shared small policy and identity helpers | Whole validation, reviver, document, error and iterator body proofs |
| Complete YAML parsing and writing | None; definitions only | Full accepted grammar, output, error and effect relations for the actual parser and writer |

The protected-context profile is HOST-OPEN. It restricts callback-controlled
access to the current adapter Engine/Writer slots and Engine helper slot while
allowing ordinary reentrant parser and writer state changes. The profile's
authenticity in a JavaScript realm is unproved. A caller-supplied structural
world does not establish it. See the detailed status in [native.md](native.md).
The Native proof runner is checked in. A combined budget-snapshot run recorded
5,916 passing selected rows after manually reusing completed CSVs to resolve a
zero-VC helper inventory mismatch. This is diagnostic evidence, not a
standalone reproducible gate. A supporting-definition run found four classifier
well-formedness issues; their `reads world` frames now pass a SurfaceHost module
check, while caller-body replay and exact-source dependency inventory remain
pending. Any selected-flow evidence is conditional on host-open atomic bindings
and the protected-context profile. The conditional budget relation covers
default, primitive Number, and Boolean outcomes. Host number encoding,
concatenation allocation errors, and full JavaScript coercion remain open. This
is not a complete public-operation guarantee and does not populate
`verifiedPublicOperations`.

## Domains, throws and effects

Typed parsing accepts string text, including malformed YAML. Wrong runtime text
types need a separate raw-entry relation. Stringify accepts unknown; dynamic
objects, getters, proxies, native collections and primitive fallbacks require
their own observation and text/error relations.

Specified failures include getter, coercion, callback and syntax throws, their
raw identity, diagnostic positions, partial effects and cleanup ordering.
Mutable globals, prototypes, reentry and the source-to-host heap relation remain
explicit open boundaries.

Iterator failure messages and raw thrown-value correspondence also remain open.
The planned generated validator's iterator helpers do not yet match every native
`for...of` failure mode for replaced iterator and `Reflect.apply` primitives;
the current compatibility validator still uses native `for...of` until that
replacement is complete.

## Existing limitations

Quoted-key cache defect
[#234](https://github.com/jbsiddall/lightning-yaml/issues/234) limits safe
model domains. Host numeric/string conversion and constructor ABI correspondence
remain open. Unknown fallback values have no universal parse/stringify
roundtrip guarantee.

The ledger separates closed definitions, declaration well-formedness, attached
headers and verified routed bodies. Functional tests and performance
acceptance are separate evidence.
