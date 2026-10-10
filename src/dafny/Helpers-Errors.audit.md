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
