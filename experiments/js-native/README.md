# Stock Dafny native JavaScript interop probe

This isolated experiment checks whether stock Dafny can compile a reusable
native JavaScript API and independent Dafny consumers. It changes no production
YAML code, adds no application route, and makes no parser performance claim.

## Run

From the repository root, with stock Dafny and Node available:

```sh
LY_DAFNY=/path/to/dafny LY_NODE=/path/to/node experiments/js-native/run.sh
```

The command verifies the Dafny source, translates it with
`--unicode-char false`, then runs raw JavaScript checks. The test runner
mutates the host adapter for array push and object reads, and mutates
`PushRead` to read index zero; each mutation must fail for its expected
behavior. A separate Dafny file must fail type checking when it tries to
inject `Array<int>` into dynamic `Value`.

Pinned probe environment: stock Dafny 4.11.0, Node 24.19.0, original rewrite
head `daf6f6e42b7eafec60d68dbeb1bb09ea0fe1dd29`.
<!-- ly:daf6f6e4 dafny:4.11.0 node:24.19.0 -->

Dafny translation verifies the source with 4 verified, 0 errors. This includes the ghost heap constructor and proof obligations in `PushRead` and
`Build`, including method preconditions. It does not verify native graph identity. The
unsupported-type fixture fails Dafny type checking as expected. Generated
output has no `_dafny` or `BigNumber` references, so this example does not need
`--include-runtime` or a Dafny runtime package.
<!-- probe-bundle-sha256:035577ac96943424ebbb77b940ca72b1f0bbe110eb458e07bc9eb4431a9d0ca7 dafny:4.11.0 -->

## What the probe establishes

- A stock module declaration
  `module {:extern "JsNative", "./js-native.cjs"} JsNative` emits a normal
  CommonJS `require("./js-native.cjs")`. Dafny's module and member emitters do
  not need rewriting.
- Extern generic `Array<A>` and `Object<A>` methods emit ordinary JavaScript
  calls with no runtime type descriptors. A `{:compile false}` ghost heap
  models mutation for Dafny proofs and disappears from generated calls.
- `Number` and `Value` are opaque external types. `NumberValue` is an identity
  operation that lets consumer code put an actual JavaScript number into a
  dynamic value. `NumberAdd` exposes native addition; the independent arithmetic
  consumer checks fractional, non-finite, and negative-zero results against JS.
  Runtime checks also cover -0, NaN, Infinity, a fraction, and a large exactly
  represented integer. The runtime calls generic `PushRead` on native number and
  string arrays and checks a later push through a returned alias.
  <!-- probe-bundle-sha256:035577ac96943424ebbb77b940ca72b1f0bbe110eb458e07bc9eb4431a9d0ca7 dafny:4.11.0 node:24.19.0 -->
- `JsString` is an opaque external type for primitive JavaScript strings. Its
  length, slice, and concat primitives use UTF-16 code units; the Dafny consumer
  composes them into a string algorithm. `Index` is a compile-erased bounded
  number type, so those operations receive JavaScript numbers.
  <!-- probe-bundle-sha256:035577ac96943424ebbb77b940ca72b1f0bbe110eb458e07bc9eb4431a9d0ca7 dafny:4.11.0 node:24.19.0 -->
- The consumer returns real nested JavaScript objects and arrays. Runtime
  checks cover shared aliases, an array and object self-cycle, and a safe own
  `__proto__` property.

## Trusted host boundary

The Dafny declarations mark these external operations as axioms: `ArrayCreate`,
`ArrayGet`, `ArrayLength`, `ArrayPush`, `ObjectCreate`, `ObjectGet`, and
`ObjectSetSafe`. The opaque `ArrayValue`/`ObjectValue` and primitive `NumberValue`,
`NumberAdd`, `BoolValue`, `SameValue` (JavaScript `Object.is`), `StringLength`,
`StringSlice`, `StringConcat`
operations are also trusted external functions; Dafny has no body with which to
prove their JavaScript behavior. Dafny verifies source code against the stated
ghost heap contracts, but does not prove that the JavaScript adapter implements
those contracts.

The adapter profile assumes synchronous host calls that complete normally, fresh
owned arrays that stay dense, and fresh ordinary objects whose properties are
own data properties. `ObjectSetSafe` uses `Object.defineProperty`; the profile
assumes no reentrant or outside mutation while Dafny code uses its ghost model.
The generic `PushRead` proof applies to handles represented in its ghost heap;
the JavaScript-only calls in the runner check runtime behavior without a proof
heap. The checks exercise selected correspondences, but JavaScript/ghost
correspondence is not proved. `NumberAdd` has a reusable host implementation and
is used by a separate Dafny sum consumer; its binary64 behavior is compared with
JavaScript at runtime only.

`Value` is currently an opaque runtime type with no ghost graph view. The ghost
heap models array and object contents by Dafny handles and values, but it does
not prove that a returned native graph has the same aliasing or cycle structure.
The runtime checks establish those facts for the tested output only. A future
ghost graph view would need explicit observation contracts for that guarantee.

## Supported boundary and consumer discipline

Dynamic injection is deliberately restricted to `Array<Value>` and
`Object<Value>`. The fixture confirms Dafny rejects `Array<int>` at the
`ArrayValue` boundary with an expected `Array<Value>, found Array<int>` type
error. Dafny `int` values compile as `BigNumber`; sequences, maps, sets, and
custom Dafny datatypes also retain Dafny representations and are outside this
native value profile. There is no recursive conversion or flattening. Use the
opaque `Number`, opaque `Value`, and `JsString` types for native JavaScript
values.

Opaque external handles have no JavaScript factory by default: a bare local
can compile as `undefined`. The API creates arrays and objects through explicit
native factories, and consumers pass or construct values explicitly.

Only `JsNative` names the host module. `Consumer`, `TextConsumer`, and
`ArithmeticConsumer` are independent Dafny modules that use the same API; adding
another consumer should not require a new host adapter. The host file contains
reusable array, object, identity, boolean, number, and string primitives with no
consumer-specific mapping.

The runner calls generic `PushRead` with JavaScript-created number and string
arrays, checks the returned primitive and mutation, then mutates the number
array after `Build` returns and observes the change through its returned alias.
A temporary `PushRead` body that reads index zero must fail the Dafny
`last == value` postcondition. This shows that the contract catches this wrong
body; it does not prove that the host adapter honors the ghost heap contract.
