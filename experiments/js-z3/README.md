# JavaScript source proof of concept

This experiment checks a small, explicit subset of ordinary JavaScript source. It parses `.mjs` files with the TypeScript compiler API, follows the actual static import graph, translates supported functions into SMT obligations, and asks Z3 to prove them. It does not execute the modules. It is a conditional proof tool for these examples, not a proof of lightning-yaml or a general JavaScript verifier.

## Run it

Requirements are Node.js, the `typescript` package resolvable from this directory or the repository root, and Z3 4.16 or a compatible command-line build on `PATH`.

```sh
node experiments/js-z3/verify.mjs experiments/js-z3/contracts.json
```

Use `--typescript <module-or-path>` when TypeScript is not available through normal Node module resolution, and `--z3 <path>` when Z3 is not on `PATH`. `--timeout-ms <milliseconds>` sets the per-query timeout. `--out <directory>` chooses where the numbered SMT-LIB queries and `report.json` are written; without it, a temporary directory is created.

Exit code `0` means every claim, source arithmetic check, and loop proof passed. Exit code `1` means a claim or proof obligation was refuted, or its precondition was vacuous; proof obligations include source arithmetic-safety and loop-induction checks. Exit code `2` means the source was unsupported or malformed, or Z3 timed out, returned `unknown`, failed, or produced an invalid response. The JSON report includes source and transitive import SHA-256 hashes, the stated admissibility conditions, each obligation's status, and solver models for refuted obligations. Models for loop obligations describe arbitrary admitted loop-header states; they are not necessarily concrete source inputs.

## Proof profile

Each numeric argument is assumed to be a JavaScript safe integer in `[-9007199254740991, 9007199254740991]`; Boolean arguments range over `true` and `false`. A sidecar `requires` condition narrows that domain and is displayed in the report. The verifier checks that the resulting precondition is satisfiable before accepting a proof. A concrete claim also pins every argument to its stated value. Type annotations do not create assumptions.

Source arithmetic is translated with mathematical integers, and a separate obligation checks that every evaluated arithmetic result stays within the safe-integer range on that path. This establishes exact JavaScript arithmetic for the supported operations under the stated input domain. The contract DSL's arithmetic is mathematical integer arithmetic. `Number.isSafeInteger` is recognized only as the pristine global intrinsic; within this input profile it returns true after evaluating an expression whose arithmetic safety is separately proved.

Numeric equality follows the supported `===` profile. The model identifies positive and negative zero, so these claims do not establish full contextual equivalence for code that can observe signed zero. The subset rejects `Object.is`, division, coercions, strings, property reads other than the recognized intrinsic, and other observations outside the profile.

## Supported source

The module graph permits relative explicit `.mjs` named imports, function declarations, and inert numeric or Boolean module constants. Every imported file is resolved within the configured example root, syntax checked, and hashed. The implementation inlines acyclic direct calls from their source bodies; it does not trust handwritten callee summaries. Functions containing loops must be verified as entry targets and cannot be called by another function in this first iteration. Code in uncalled function bodies is validated as well.

Supported function constructs are required identifier parameters; numeric and Boolean literals; parentheses; `+`, `-`, and multiplication with an integer literal operand; integer comparisons and strict equality; Boolean `!`, `&&`, and `||`; initialized block-scoped `let` and `const`; assignment to local `let`; `if`/`else`; `return`; direct resolved calls; and one annotated `while` loop per function. The verifier tracks lexical bindings, catches temporal-dead-zone reads, and models branch and short-circuit paths. Any other syntax or unsupported value operation fails closed with an error.

The JSON sidecar is a small expression language, never JavaScript. It supports constants, parameter/result variables, arithmetic, comparisons, and Boolean operators. A claim supplies concrete `args` plus `expected`, a universal `ensures`, or `equivalentTo`. Equivalence runs both source functions with the same symbolic inputs and checks their returned numeric or Boolean values over the admitted domain.

Loop annotations use `functionName:0` keys under `loops`. Each supplies an invariant and a mathematical-integer `decreases` expression. The tool checks initialization, preservation through the actual body, safe arithmetic, rank nonnegativity, strict rank decrease, then the return condition after the loop. The cursor example uses this to prove `advanceToEnd` without unrolling a fixed number of iterations.

## Limits

This trusted checker is new, and the admitted source language is intentionally narrow. It has no exception, object, string, coercion, async, recursion, or general heap semantics. It does not verify the full parser, establish behavior outside the listed domains, or claim that two implementations are interchangeable in every JavaScript context. Extending the subset requires new source semantics and negative tests for the added constructs.

Run the focused real-solver suite with:

```sh
node experiments/js-z3/test.mjs
```
