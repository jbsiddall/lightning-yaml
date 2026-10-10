module SurfaceHost {
  import opened Native
  import opened DafnyCore
  import opened Serializer
  import opened TagValues
  import M = SurfaceModel
  import NB = NativeBudgetContracts
  import W = SurfaceWitness

  // CONTRACTED NATIVE TRUST BOUNDARY:
  // Each following {:axiom} is one individually named JS operation/projection
  // whose implementation is outside Dafny. The Adapter bodies call these
  // atoms in source order and prove the control-flow trace conditionally on
  // these exact contracts; this is not a whole-adapter or YAML-semantic axiom.
  function {:extern "surfaceIsNullish"} {:axiom} IsNullish(value: Value,
      ghost world: W.World, ghost inputHandle: M.Handle): bool
    reads world
    requires world.Valid() && inputHandle in world.values && world.Bound(value,inputHandle)
    ensures IsNullish(value,world,inputHandle) == M.StrictNullish(world.values[inputHandle])
  function {:extern "surfaceIsTruthy"} {:axiom} IsTruthy(value: Value,
      ghost world: W.World, ghost inputHandle: M.Handle): bool
    reads world
    requires world.Valid() && inputHandle in world.values && world.Bound(value,inputHandle)
    ensures IsTruthy(value,world,inputHandle) == M.Truthy(world.values[inputHandle])
  function {:extern "surfaceIsExactlyTrue"} {:axiom} IsExactlyTrue(value: Value,
      ghost world: W.World, ghost inputHandle: M.Handle): bool
    reads world
    requires world.Valid() && inputHandle in world.values && world.Bound(value,inputHandle)
    ensures IsExactlyTrue(value,world,inputHandle) == M.ExactlyTrue(world.values[inputHandle])
  function {:extern "surfaceIsString"} {:axiom} IsString(value: Value,
      ghost world: W.World, ghost inputHandle: M.Handle): bool
    reads world
    requires world.Valid() && inputHandle in world.values && world.Bound(value,inputHandle)
    ensures IsString(value,world,inputHandle) == world.values[inputHandle].StringValue?
  function {:extern "surfaceCompletionIsThrown"} CompletionIsThrown(completion: Value): bool
  function {:extern "surfaceCompletionValue"} CompletionValue(completion: Value): Value

  method {:extern "surfaceReadProperty"} {:axiom} ReadProperty(target: Value, key: string,
      engine: Engine, helpers: Helpers, writer: Writer,
      ghost world: W.World, ghost targetHandle: M.Handle)
      returns (completion: Value, ghost observation: M.Event)
      requires world.Valid() && world.Bound(target,targetHandle)
      requires helpers == engine.tagHelpers
      requires world.ContextProfile(engine,helpers,writer)
      ensures W.AtomicEvent(world,old(world.bindings),old(world.values),old(world.heap),
        observation,CompletionValue(completion),CompletionIsThrown(completion))
      ensures observation.operation == M.ReadProperty(targetHandle,key)
      ensures observation.before == old(world.heap) && observation.after == world.heap
      ensures world.Bound(CompletionValue(completion),observation.outcome.value)
      ensures observation.outcome.Thrown? == CompletionIsThrown(completion)
      ensures observation.outcome.value in world.values
      ensures engine.tagHelpers == old(engine.tagHelpers)
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,helpers,writer)
      modifies world, engine, helpers, writer
  method {:extern "surfaceTemplateString"} {:axiom} TemplateString(value: Value,
      engine: Engine, helpers: Helpers, writer: Writer,
      ghost world: W.World, ghost valueHandle: M.Handle)
      returns (completion: Value, ghost observation: M.Event)
      requires world.Valid() && world.Bound(value,valueHandle)
      requires helpers == engine.tagHelpers
      requires world.ContextProfile(engine,helpers,writer)
      ensures W.AtomicEvent(world,old(world.bindings),old(world.values),old(world.heap),
        observation,CompletionValue(completion),CompletionIsThrown(completion))
      ensures observation.operation == M.TemplateConvert(valueHandle)
      ensures observation.before == old(world.heap) && observation.after == world.heap
      ensures world.Bound(CompletionValue(completion),observation.outcome.value)
      ensures observation.outcome.Thrown? == CompletionIsThrown(completion)
      ensures observation.outcome.value in world.values
      ensures !CompletionIsThrown(completion) ==>
        world.values[observation.outcome.value].StringValue?
      ensures !CompletionIsThrown(completion) ==>
        Native.StringValueOf(CompletionValue(completion)) ==
          world.values[observation.outcome.value].text
      ensures engine.tagHelpers == old(engine.tagHelpers)
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,helpers,writer)
      modifies world, engine, helpers, writer
  method {:extern "surfaceReturnedString"} {:axiom} ReturnedString(
      text: string, ghost world: W.World)
      returns (completion: Value, ghost outputHandle: M.Handle)
      requires world.Valid()
      ensures world.Valid()
      ensures !CompletionIsThrown(completion)
      ensures world.Bound(CompletionValue(completion),outputHandle)
      ensures outputHandle in world.values
      ensures world.values[outputHandle] == M.StringValue(text)
      ensures Native.StringValueOf(CompletionValue(completion)) == text
      ensures world.heap == old(world.heap)
      ensures world.contextOwner == old(world.contextOwner)
      ensures W.PreservesValues(world,old(world.values))
      ensures (forall binding | binding in old(world.bindings) :: binding in world.bindings)
      modifies world
  method {:extern "surfaceMultiplyBy1024"} {:axiom} MultiplyBy1024(value: Value,
      engine: Engine, helpers: Helpers, writer: Writer,
      ghost world: W.World, ghost rawHandle: M.Handle, ghost useDefault: bool)
      returns (completion: Value, ghost observation: M.Event)
      requires world.Valid()
      requires helpers == engine.tagHelpers
      requires world.ContextProfile(engine,helpers,writer)
      requires rawHandle in world.values
      requires useDefault || world.Bound(value,rawHandle)
      requires !useDefault || value == NumberValue(4096)
      requires useDefault == M.StrictNullish(world.values[rawHandle])
      ensures W.AtomicEvent(world,old(world.bindings),old(world.values),old(world.heap),
        observation,CompletionValue(completion),CompletionIsThrown(completion))
      ensures observation.operation == M.MultiplyBudget(rawHandle,useDefault)
      ensures observation.before == old(world.heap) && observation.after == world.heap
      ensures world.Bound(CompletionValue(completion),observation.outcome.value)
      ensures observation.outcome.Thrown? == CompletionIsThrown(completion)
      ensures observation.outcome.value in world.values
      ensures NB.BudgetOutcomeGuarantees(world.values,rawHandle,useDefault,
        observation.outcome,observation.after)
      ensures engine.tagHelpers == old(engine.tagHelpers)
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,helpers,writer)
      modifies world, engine, helpers, writer
  method {:extern "surfaceCaptureNormalizationRecord"} {:axiom} CaptureNormalizationRecord(
      strict: bool, intern: bool, budget: Value,
      ghost world: W.World, ghost budgetHandle: M.Handle)
      returns (completion: Value, ghost normalized: M.Normalized)
      requires world.Valid() && world.Bound(budget,budgetHandle)
      ensures !CompletionIsThrown(completion)
      ensures NormalizationStrict(CompletionValue(completion)) == strict
      ensures NormalizationIntern(CompletionValue(completion)) == intern
      ensures Native.SameValue(NormalizationBudget(CompletionValue(completion)),budget)
      ensures normalized == M.Ready(strict,intern,budgetHandle)
      ensures world.Bound(NormalizationBudget(CompletionValue(completion)),budgetHandle)
  function {:extern "surfaceNormalizationStrict"} NormalizationStrict(record: Value): bool
  function {:extern "surfaceNormalizationIntern"} NormalizationIntern(record: Value): bool
  function {:extern "surfaceNormalizationBudget"} NormalizationBudget(record: Value): Value

  method {:extern "surfaceCaptureReset"} {:axiom} CaptureReset(engine: Engine,
      ghost writerContext: Writer, text: string,
      strict: bool, intern: bool, budget: Value,
      ghost world: W.World, ghost textHandle: M.Handle, ghost budgetHandle: M.Handle)
      returns (completion: Value, ghost observation: M.Event)
      requires world.Valid() && world.Bound(StringValue(text),textHandle)
      requires world.Bound(budget,budgetHandle)
      requires world.ContextProfile(engine,engine.tagHelpers,writerContext)
      ensures W.AtomicEvent(world,old(world.bindings),old(world.values),old(world.heap),
        observation,CompletionValue(completion),CompletionIsThrown(completion))
      ensures observation.operation == M.Reset(textHandle,strict,intern,budgetHandle)
      ensures observation.before == old(world.heap) && observation.after == world.heap
      ensures world.Bound(CompletionValue(completion),observation.outcome.value)
      ensures observation.outcome.Thrown? == CompletionIsThrown(completion)
      ensures observation.outcome.value in world.values
      ensures engine.tagHelpers == old(engine.tagHelpers)
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,engine.tagHelpers,writerContext)
      modifies world, engine, engine.tagHelpers, writerContext
  method {:extern "surfaceCaptureParseSingle"} {:axiom} CaptureParseSingle(engine: Engine,
      ghost writerContext: Writer,
      ghost world: W.World)
      returns (completion: Value, ghost observation: M.Event)
      requires world.ContextProfile(engine,engine.tagHelpers,writerContext)
      ensures W.AtomicEvent(world,old(world.bindings),old(world.values),old(world.heap),
        observation,CompletionValue(completion),CompletionIsThrown(completion))
      ensures observation.operation == M.ParseCore(false)
      ensures observation.before == old(world.heap) && observation.after == world.heap
      ensures world.Bound(CompletionValue(completion),observation.outcome.value)
      ensures observation.outcome.Thrown? == CompletionIsThrown(completion)
      ensures observation.outcome.value in world.values
      ensures engine.tagHelpers == old(engine.tagHelpers)
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,engine.tagHelpers,writerContext)
      modifies world, engine, engine.tagHelpers, writerContext
  method {:extern "surfaceCaptureParseAll"} {:axiom} CaptureParseAll(engine: Engine,
      ghost writerContext: Writer,
      ghost world: W.World)
      returns (completion: Value, ghost observation: M.Event)
      requires world.ContextProfile(engine,engine.tagHelpers,writerContext)
      ensures W.AtomicEvent(world,old(world.bindings),old(world.values),old(world.heap),
        observation,CompletionValue(completion),CompletionIsThrown(completion))
      ensures observation.operation == M.ParseCore(true)
      ensures observation.before == old(world.heap) && observation.after == world.heap
      ensures world.Bound(CompletionValue(completion),observation.outcome.value)
      ensures observation.outcome.Thrown? == CompletionIsThrown(completion)
      ensures observation.outcome.value in world.values
      ensures engine.tagHelpers == old(engine.tagHelpers)
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,engine.tagHelpers,writerContext)
      modifies world, engine, engine.tagHelpers, writerContext
  method {:extern "surfaceCaptureEndStream"} {:axiom} CaptureEndStream(engine: Engine,
      ghost writerContext: Writer,
      ghost world: W.World)
      returns (completion: Value, ghost observation: M.Event)
      requires world.ContextProfile(engine,engine.tagHelpers,writerContext)
      ensures W.AtomicEvent(world,old(world.bindings),old(world.values),old(world.heap),
        observation,CompletionValue(completion),CompletionIsThrown(completion))
      ensures observation.operation == M.EndStream
      ensures observation.before == old(world.heap) && observation.after == world.heap
      ensures world.Bound(CompletionValue(completion),observation.outcome.value)
      ensures observation.outcome.Thrown? == CompletionIsThrown(completion)
      ensures observation.outcome.value in world.values
      ensures engine.tagHelpers == old(engine.tagHelpers)
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,engine.tagHelpers,writerContext)
      modifies world, engine, engine.tagHelpers, writerContext
  method {:extern "surfaceCaptureIsArray"} {:axiom} CaptureIsArray(value: Value,
      engine: Engine, helpers: Helpers, writer: Writer, ghost world: W.World,
      ghost valueHandle: M.Handle)
      returns (completion: Value, ghost observation: M.Event)
      requires world.Valid() && world.Bound(value,valueHandle)
      requires helpers == engine.tagHelpers
      requires world.ContextProfile(engine,helpers,writer)
      ensures W.AtomicEvent(world,old(world.bindings),old(world.values),old(world.heap),
        observation,CompletionValue(completion),CompletionIsThrown(completion))
      ensures observation.operation == M.CheckArray(valueHandle)
      ensures observation.before == old(world.heap) && observation.after == world.heap
      ensures world.Bound(CompletionValue(completion),observation.outcome.value)
      ensures observation.outcome.Thrown? == CompletionIsThrown(completion)
      ensures observation.outcome.value in world.values
      ensures engine.tagHelpers == old(engine.tagHelpers)
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,helpers,writer)
      modifies world, engine, helpers, writer
  method {:extern "surfaceCaptureTypeError"} {:axiom} CaptureTypeError(message: string,
      engine: Engine, helpers: Helpers, writer: Writer,
      ghost world: W.World)
      returns (completion: Value, ghost observation: M.Event)
      requires world.Valid()
      requires helpers == engine.tagHelpers
      requires world.ContextProfile(engine,helpers,writer)
      ensures W.AtomicEvent(world,old(world.bindings),old(world.values),old(world.heap),
        observation,CompletionValue(completion),CompletionIsThrown(completion))
      ensures observation.operation == M.NewTypeError(message)
      ensures observation.outcome.Thrown?
      ensures observation.before == old(world.heap) && observation.after == world.heap
      ensures world.Bound(CompletionValue(completion),observation.outcome.value)
      ensures observation.outcome.value in world.values
      ensures engine.tagHelpers == old(engine.tagHelpers)
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,helpers,writer)
      modifies world, engine, helpers, writer
  method {:extern "surfaceCaptureWriterStringify"} {:axiom} CaptureWriterStringify(writer: Writer,
      value: Value, engine: Engine, helpers: Helpers, ghost world: W.World,
      ghost argumentHandle: M.Handle)
      returns (completion: Value, ghost observation: M.Event)
      requires world.Valid() && world.Bound(value,argumentHandle)
      requires helpers == engine.tagHelpers
      requires world.ContextProfile(engine,helpers,writer)
      ensures W.AtomicEvent(world,old(world.bindings),old(world.values),old(world.heap),
        observation,CompletionValue(completion),CompletionIsThrown(completion))
      ensures observation.operation == M.StringifyCore(argumentHandle)
      ensures observation.before == old(world.heap) && observation.after == world.heap
      ensures world.Bound(CompletionValue(completion),observation.outcome.value)
      ensures observation.outcome.Thrown? == CompletionIsThrown(completion)
      ensures observation.outcome.value in world.values
      ensures engine.tagHelpers == old(engine.tagHelpers)
      ensures world.contextOwner == old(world.contextOwner)
      ensures world.ContextProfile(engine,helpers,writer)
      modifies world, writer, engine, helpers
}
