# Local helper proofs: Helpers and Errors

The direct Dafny 4.11.0 verification command selected `SurfaceHelpers` and
`SurfaceErrors` under the JavaScript target with UTF-16 characters. Dafny
reported **9 verified obligations, 0 errors** for **8 declared methods**:

- `SurfaceHelpers.TagKindName`, `ReturnSchemaIdentity`, and
  `ReturnCapturedContents`;
- `SurfaceErrors.ParseErrorName`, `NotImplementedErrorName`,
  `YamlExceptionName`, `ChooseExceptionReason`, and `ChooseExceptionMark`.

The methods establish local return-value choices only. The exception reason
and mark methods branch on a supplied Boolean; their result corresponds to
JavaScript `??` only when the caller has correctly classified strict
nullishness. The bodies do not establish that host classification.

Generated-runtime sentinel tests and public unit tests verify that the tag
factories, schema identity method, captured document closures, and error
constructors call these named generated methods. This route evidence does not
prove the surrounding TypeScript constructor or allocation behavior.

In particular, these proofs do not establish Error message coercion or class
prototypes, tag/document object freshness or property descriptors, fresh mark
allocation, or complete operation behavior. The corresponding TypeScript
shells retain those responsibilities and remain open to host-level proof.

`RawMarkContracts.BuildRawMark` states a closed ordered-event model for
`js-yaml`'s `markFrom`: it accepts arbitrary raw `exec`, `Number`, and `Math.max`
outcomes, models truthiness branches and strict nullish filename selection, and
records the six ordinary literal data properties plus partial allocation on a
later throw. Its nine declarations have fresh well-formedness evidence only;
there are no method-correctness rows and no executed `JsYamlSurface` helper or
host correspondence proof attached.

The checkpoint 23 declaration check used Dafny 4.11.0 and Z3 4.16.0 with
UTF-16 characters and the repository Native numeric projection. The exact
modern CLI selection was `verify <Native.verify.dfy> SurfaceValues.dfy
SurfaceOptions.dfy SurfaceModel.dfy ObjectsAndErrors.dfy RawMarkContracts.dfy
--unicode-char false --allow-deprecation --filter-symbol RawMarkContracts
--verification-time-limit 60 --solver-path <pinned-z3> --log-format
csv;LogFileName=<output>/raw-mark.csv`. It reported 9 verified, 0 errors, no
source warnings. The captured CSV and invocation are in
`/tmp/ly-dafny-raw-mark-checkpoint23/` for this run. RawMarkContracts,
SurfaceModel, SurfaceValues, SurfaceOptions, ObjectsAndErrors, original Native,
and projected Native input hashes are recorded there and matched at start/end.

This evidence does not prove runtime routing or model correctness. Regex
authenticity, host coercion/subtraction behavior, literal allocation and
callback heap framing remain open. The model does not change public routing or
establish the complete error-conversion path.
