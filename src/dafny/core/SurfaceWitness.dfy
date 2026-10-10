// Ghost-only witness definition; host correspondence remains an explicit
// trusted boundary in HostObservation. Structural validity alone is not
// authenticity.
module SurfaceWitness {
  import N = Native
  import M = SurfaceModel
  import V = SurfaceValues
  import H = HostObservation
  import E = DafnyCore
  import T = TagValues
  import S = Serializer

  // HOST-OPEN: current host access capabilities protect the owner's engine
  // and writer slots and the engine's tagHelpers slot. This declaration
  // does not establish JavaScript encapsulation or heap authenticity.
  ghost predicate {:extern} ProtectedContextAccess(
      heap: M.Heap, owner: object,
      engine: E.Engine, helpers: T.Helpers, writer: S.Writer)
    reads owner, engine, helpers, writer

  datatype Binding = Binding(raw: N.Value, handle: M.Handle)
  ghost function PolicyBits(bits: int): int reads {} {
    if V.FalsyNumberBits(bits) && bits != 0 && bits != 9223372036854775808
    then 9221120237041090560 else bits
  }
  class World {
    ghost var bindings: seq<Binding>
    ghost var values: map<M.Handle,M.Value>
    ghost var heap: M.Heap
    ghost var contextOwner: object
    constructor(ghost owner: object) {
      bindings := [];
      values := map[];
      heap := map[];
      contextOwner := owner;
    }
    ghost predicate ContextProfile(
        engine: E.Engine, helpers: T.Helpers, writer: S.Writer)
      reads this, contextOwner, engine, helpers, writer
    {
      helpers == engine.tagHelpers &&
      ProtectedContextAccess(heap, contextOwner, engine, helpers, writer)
    }
    ghost predicate Valid() reads this {
      M.ValuesValid(values) &&
      (forall h | h in values ::
        values[h].NumberValue? ==> PolicyBits(values[h].bits) == values[h].bits) &&
      (forall b | b in bindings :: b.handle in values &&
        H.RawDescription(b.raw,values[b.handle])) &&
      (forall a,b | a in bindings && b in bindings ::
        (a.handle == b.handle <==> H.RawSameValue(a.raw,b.raw)))
    }
    ghost predicate Bound(raw: N.Value, handle: M.Handle) reads this {
      exists b | b in bindings :: H.RawSameValue(b.raw,raw) && b.handle == handle
    }
  }

  ghost predicate PreservesValues(world: World,
      previous: map<M.Handle,M.Value>) reads world {
    forall h | h in previous.Keys ::
      h in world.values && world.values[h] == previous[h]
  }

  ghost predicate AtomicEvent(world: World,
      previousBindings: seq<Binding>, previousValues: map<M.Handle,M.Value>,
      previousHeap: M.Heap, observation: M.Event,
      rawOutcome: N.Value, threw: bool) reads world {
    world.Valid() &&
    (forall binding | binding in previousBindings :: binding in world.bindings) &&
    PreservesValues(world, previousValues) &&
    observation.before == previousHeap && observation.after == world.heap &&
    world.Bound(rawOutcome, observation.outcome.value) &&
    observation.outcome.Thrown? == threw && observation.outcome.value in world.values
  }

  ghost predicate ParseEntry(world: World, text: string, textRaw: N.Value,
      textHandle: M.Handle, optionsRaw: N.Value, optionsHandle: M.Handle,
      undefinedHandle: M.Handle) reads world {
    world.Valid() &&
    world.Bound(textRaw,textHandle) &&
    world.values[textHandle] == M.StringValue(text) &&
    world.Bound(optionsRaw,optionsHandle) &&
    world.Bound(N.Undefined,undefinedHandle) &&
    world.values[undefinedHandle].UndefinedValue?
  }

}
