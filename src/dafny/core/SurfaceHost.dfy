module SurfaceHost {
  import opened Native
  import opened DafnyCore
  import opened Serializer
  import opened TagValues

  function {:extern "surfaceIsNullish"} IsNullish(value: Value): bool
  function {:extern "surfaceIsTruthy"} IsTruthy(value: Value): bool
  function {:extern "surfaceIsExactlyTrue"} IsExactlyTrue(value: Value): bool
  function {:extern "surfaceIsString"} IsString(value: Value): bool
  function {:extern "surfaceCompletionIsThrown"} CompletionIsThrown(completion: Value): bool
  function {:extern "surfaceCompletionValue"} CompletionValue(completion: Value): Value

  method {:extern "surfaceReadProperty"} ReadProperty(target: Value, key: string,
      engine: Engine, helpers: Helpers, writer: Writer) returns (completion: Value)
      modifies engine, helpers, writer
  method {:extern "surfaceTemplateString"} TemplateString(value: Value,
      engine: Engine, helpers: Helpers, writer: Writer) returns (completion: Value)
      modifies engine, helpers, writer
  function {:extern "surfaceReturnedString"} ReturnedString(value: string): Value
  method {:extern "surfaceMultiplyBy1024"} MultiplyBy1024(value: Value,
      engine: Engine, helpers: Helpers, writer: Writer) returns (completion: Value)
      modifies engine, helpers, writer
  method {:extern "surfaceCaptureNormalizationRecord"} CaptureNormalizationRecord(
      strict: bool, intern: bool, budget: Value) returns (completion: Value)
  function {:extern "surfaceNormalizationStrict"} NormalizationStrict(record: Value): bool
  function {:extern "surfaceNormalizationIntern"} NormalizationIntern(record: Value): bool
  function {:extern "surfaceNormalizationBudget"} NormalizationBudget(record: Value): Value

  method {:extern "surfaceCaptureReset"} CaptureReset(engine: Engine, text: string,
      strict: bool, intern: bool, budget: Value) returns (completion: Value)
      modifies engine, engine.tagHelpers
  method {:extern "surfaceCaptureParseSingle"} CaptureParseSingle(engine: Engine)
      returns (completion: Value) modifies engine, engine.tagHelpers
  method {:extern "surfaceCaptureParseAll"} CaptureParseAll(engine: Engine)
      returns (completion: Value) modifies engine, engine.tagHelpers
  method {:extern "surfaceCaptureEndStream"} CaptureEndStream(engine: Engine)
      returns (completion: Value) modifies engine, engine.tagHelpers
  method {:extern "surfaceCaptureIsArray"} CaptureIsArray(value: Value,
      engine: Engine, helpers: Helpers, writer: Writer)
      returns (completion: Value) modifies engine, helpers, writer
  method {:extern "surfaceCaptureTypeError"} CaptureTypeError(message: string,
      engine: Engine, helpers: Helpers, writer: Writer)
      returns (completion: Value) modifies engine, helpers, writer
  method {:extern "surfaceCaptureWriterStringify"} CaptureWriterStringify(writer: Writer,
      value: Value, engine: Engine, helpers: Helpers) returns (completion: Value)
      modifies writer, engine, helpers
}
