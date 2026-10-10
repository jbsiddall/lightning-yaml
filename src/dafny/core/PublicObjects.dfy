module PublicObjects {
  import opened SurfaceModel
  import opened ObjectsAndErrors
  import opened ErrorTranslation

  ghost predicate TagFactory(v: map<Handle, Value>, tagName: Handle,
      kind: string, kindHandle: Handle, objectPrototype: nat,
      es: seq<Event>, out: Outcome) reads {} {
    tagName in v && kindHandle in v && v[kindHandle] == StringValue(kind) &&
    (kind == "scalar" || kind == "sequence" || kind == "mapping") &&
    TraceLinked(es) && TraceValues(v, es) && |es| == 1 &&
    var props := [Property("tagName", tagName, true, true, true),
      Property("nodeKind", kindHandle, true, true, true)];
    es[0].operation == AllocateRecord(props, objectPrototype, []) && out == es[0].outcome &&
      (out.Thrown? || RecordAllocated(v, es[0], props, objectPrototype, []))
  }
  // The ignored opts argument has no read/get/iteration event. Raw tagName is
  // retained; this contract permits non-string runtime arguments as the source does.
  ghost predicate SchemaConstructor(v: map<Handle, Value>, schemaPrototype: nat,
      es: seq<Event>, out: Outcome) reads {} {
    TraceLinked(es) && TraceValues(v, es) && |es| == 1 &&
      es[0].operation == AllocateRecord([], schemaPrototype, []) && out == es[0].outcome &&
      (out.Thrown? || RecordAllocated(v, es[0], [], schemaPrototype, []))
  }
  ghost predicate WithTags(receiver: Handle, es: seq<Event>, out: Outcome) reads {} {
    |es| == 0 && out == Returned(receiver)
  }
  ghost predicate SchemaSingletons(v: map<Handle, Value>, failsafe: Handle,
      json: Handle, core: Handle, yaml11: Handle) reads {} {
    failsafe in v && json in v && core in v && yaml11 in v &&
    v[failsafe].ReferenceValue? && v[json].ReferenceValue? &&
    v[core].ReferenceValue? && v[yaml11].ReferenceValue? &&
    var ids := [v[failsafe].identity, v[json].identity, v[core].identity, v[yaml11].identity];
    forall i, j | 0 <= i < j < 4 :: ( ids[i] != ids[j]
  ) }
  ghost function ExceptionReason(v: map<Handle, Value>, reason: Handle,
      unknownReason: Handle): Handle reads {}
    requires reason in v
  {
    if StrictNullish(v[reason]) then ( unknownReason ) else ( reason
  ) }
  ghost function ExceptionMark(v: map<Handle, Value>, mark: Handle,
      freshDefault: Handle): Handle reads {}
    requires mark in v
  {
    if StrictNullish(v[mark]) then ( freshDefault ) else ( mark
  ) }
  ghost predicate OwnData(heap: Heap, identity: nat, key: string,
      value: Handle, enumerable: bool) reads {} {
    identity in heap &&
    exists p: Property :: ( p in heap[identity].properties && p.key == key &&
      p.value == value && p.writable && p.configurable && p.enumerable == enumerable
  ) }
  // Ordinary Error-subclass profile: own name/message data fields match the
  // usual built-in prototypes. A replaced inherited name setter can intercept
  // assignment or throw; raw property-set completion correspondence is OPEN.
  // message is the actual super(Error) ToString result, which is a separately
  // observed primitive dependency (String(Symbol) is not an adequate witness).
  ghost predicate DefinedMessageErrorFields(v: map<Handle, Value>, before: Heap, after: Heap,
      instance: Handle, prototype: nat, name: Handle, message: Handle) reads {} {
    instance in v && v[instance].ReferenceValue? && name in v && message in v &&
    v[name].StringValue? && v[message].StringValue? &&
    var id := v[instance].identity;
    id !in before && id in after && after[id].prototype == prototype &&
    OwnData(after, id, "name", name, true) && OwnData(after, id, "message", message, false)
  }
  ghost predicate ErrorFields(v: map<Handle, Value>, before: Heap, after: Heap,
      instance: Handle, prototype: nat, name: Handle, rawMessage: Handle,
      convertedMessage: Handle) reads {} {
    rawMessage in v && instance in v && v[instance].ReferenceValue? &&
    name in v && v[name].StringValue? &&
    var id := v[instance].identity;
    id !in before && id in after && after[id].prototype == prototype &&
    OwnData(after, id, "name", name, true) &&
    (if v[rawMessage].UndefinedValue? then (
       forall p | p in after[id].properties :: ( p.key != "message"
     ) ) else ( convertedMessage in v && v[convertedMessage].StringValue? &&
       OwnData(after, id, "message", convertedMessage, false)) )
  }
  ghost predicate YamlExceptionFields(v: map<Handle, Value>, r: Realm,
      before: Heap, after: Heap, instance: Handle, prototype: nat,
      name: Handle, message: Handle, rawReason: Handle, rawMark: Handle,
      unknownReason: Handle, defaultMark: Handle) reads {} {
    rawReason in v && rawMark in v && unknownReason in v &&
    v[unknownReason] == StringValue("unknown reason") && name in v &&
    v[name] == StringValue("YAMLException") &&
    DefinedMessageErrorFields(v, before, after, instance, prototype, name, message) &&
    OwnData(after, v[instance].identity, "reason", ExceptionReason(v, rawReason, unknownReason), true) &&
    OwnData(after, v[instance].identity, "mark", ExceptionMark(v, rawMark, defaultMark), true) &&
    (StrictNullish(v[rawMark]) ==>
      defaultMark in v && v[defaultMark].ReferenceValue? &&
      v[defaultMark].identity !in before && v[defaultMark].identity in after &&
      after[v[defaultMark].identity].prototype == r.objectPrototype &&
      after[v[defaultMark].identity].properties ==
        [Property("buffer", r.empty, true, true, true), Property("column", r.zero, true, true, true),
         Property("line", r.zero, true, true, true), Property("name", r.empty, true, true, true),
         Property("position", r.negativeOne, true, true, true), Property("snippet", r.empty, true, true, true)])
  }
  // Default objects expose the same initial named bindings, in source order.
  // Mutating these objects later does not mutate the named binding handles.
  ghost predicate DefaultAliases(v: map<Handle, Value>, e: Event,
      names: seq<string>, bindings: seq<Handle>, objectPrototype: nat) reads {} {
    |names| == |bindings| &&
    var props := seq(|names|, i requires 0 <= i < |names| => Property(names[i], bindings[i], true, true, true));
    RecordAllocated(v, e, props, objectPrototype, [])
  }
}
