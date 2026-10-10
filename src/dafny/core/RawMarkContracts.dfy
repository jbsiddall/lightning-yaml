// Source-order protocol for js-yaml-compat's markFrom, without regex or
// numeric-global authenticity restrictions on the raw entry domain.
module RawMarkContracts {
  import opened SurfaceModel
  import O = ObjectsAndErrors

  datatype MarkRealm = MarkRealm(regex: Handle, undefined: Handle, empty: Handle,
    zero: Handle, negativeOne: Handle, objectPrototype: nat)

  datatype MarkPhase = ReadExec | InvokeExec |
    ReadLineNumber | ReadLineCapture | ConvertLine |
    ReadColumnNumber | ReadColumnCapture | ConvertColumn |
    AllocateLiteral | DefineBuffer |
    ReadColumnMath | ReadColumnMax | SubtractColumn | ClampColumn | DefineColumn |
    ReadLineMath | ReadLineMax | SubtractLine | ClampLine | DefineLine |
    DefineName | DefinePosition | DefineSnippet | Complete

  datatype MarkState = MarkState(phase: MarkPhase,
    execMethod: Handle, matchResult: Handle, numberMethod: Handle,
    line1: Handle, column1: Handle, mathReceiver: Handle, maxMethod: Handle,
    difference: Handle, literal: Handle, column: Handle, line: Handle)

  ghost predicate Inputs(values: map<Handle, Value>, realm: MarkRealm,
      message: Handle, filename: Handle) reads {} {
    ValuesValid(values) && message in values && filename in values &&
    realm.regex in values && realm.undefined in values && realm.empty in values &&
    realm.zero in values && realm.negativeOne in values &&
    values[realm.undefined].UndefinedValue? && values[realm.empty] == StringValue("") &&
    values[realm.zero] == NumberValue(0) &&
    values[realm.negativeOne] == NumberValue(13830554455654793216)
  }

  ghost predicate StateValues(values: map<Handle, Value>, state: MarkState) reads {} {
    state.execMethod in values && state.matchResult in values &&
    state.numberMethod in values && state.line1 in values && state.column1 in values &&
    state.mathReceiver in values && state.maxMethod in values &&
    state.difference in values && state.literal in values &&
    state.column in values && state.line in values
  }

  ghost function PhaseIndex(phase: MarkPhase): nat reads {} {
    match phase
    case ReadExec => 0 case InvokeExec => 1
    case ReadLineNumber => 2 case ReadLineCapture => 3 case ConvertLine => 4
    case ReadColumnNumber => 5 case ReadColumnCapture => 6 case ConvertColumn => 7
    case AllocateLiteral => 8 case DefineBuffer => 9
    case ReadColumnMath => 10 case ReadColumnMax => 11 case SubtractColumn => 12
    case ClampColumn => 13 case DefineColumn => 14
    case ReadLineMath => 15 case ReadLineMax => 16 case SubtractLine => 17
    case ClampLine => 18 case DefineLine => 19
    case DefineName => 20 case DefinePosition => 21 case DefineSnippet => 22
    case Complete => 23
  }

  ghost predicate CallMatches(operation: Operation, callee: Handle,
      receiver: Handle, arguments: seq<Handle>) reads {} {
    operation.CallMethod? && operation.methodValue == callee &&
    operation.receiver == receiver && operation.arguments == arguments
  }

  ghost predicate ExpectedOperation(values: map<Handle, Value>, realm: MarkRealm,
      message: Handle, filename: Handle, state: MarkState, operation: Operation) reads {}
    requires filename in values
  {
    match state.phase
    case ReadExec => operation == ReadProperty(realm.regex, "exec")
    case InvokeExec => CallMatches(operation, state.execMethod, realm.regex, [message])
    case ReadLineNumber => operation == ReadGlobal("Number")
    case ReadLineCapture => operation == ReadProperty(state.matchResult, "1")
    case ConvertLine => CallMatches(operation, state.numberMethod, realm.undefined, [state.difference])
    case ReadColumnNumber => operation == ReadGlobal("Number")
    case ReadColumnCapture => operation == ReadProperty(state.matchResult, "2")
    case ConvertColumn => CallMatches(operation, state.numberMethod, realm.undefined, [state.difference])
    case AllocateLiteral => operation == AllocateRecord([], realm.objectPrototype, [])
    case DefineBuffer => operation == DefineLiteralData(state.literal, "buffer", realm.empty)
    case ReadColumnMath => operation == ReadGlobal("Math")
    case ReadColumnMax => operation == ReadProperty(state.mathReceiver, "max")
    case SubtractColumn => operation == SubtractOne(state.column1)
    case ClampColumn => CallMatches(operation, state.maxMethod, state.mathReceiver, [realm.zero, state.difference])
    case DefineColumn => operation == DefineLiteralData(state.literal, "column", state.column)
    case ReadLineMath => operation == ReadGlobal("Math")
    case ReadLineMax => operation == ReadProperty(state.mathReceiver, "max")
    case SubtractLine => operation == SubtractOne(state.line1)
    case ClampLine => CallMatches(operation, state.maxMethod, state.mathReceiver, [realm.zero, state.difference])
    case DefineLine => operation == DefineLiteralData(state.literal, "line", state.line)
    case DefineName => operation == DefineLiteralData(state.literal, "name",
      if StrictNullish(values[filename]) then realm.empty else filename)
    case DefinePosition => operation == DefineLiteralData(state.literal, "position", realm.negativeOne)
    case DefineSnippet => operation == DefineLiteralData(state.literal, "snippet", realm.empty)
    case Complete => false
  }

  ghost function Advance(state: MarkState, value: Handle): MarkState reads {} {
    match state.phase
    case ReadExec => state.(phase := InvokeExec, execMethod := value)
    case InvokeExec => state.(phase := ReadLineNumber, matchResult := value)
    case ReadLineNumber => state.(phase := ReadLineCapture, numberMethod := value)
    case ReadLineCapture => state.(phase := ConvertLine, difference := value)
    case ConvertLine => state.(phase := ReadColumnNumber, line1 := value)
    case ReadColumnNumber => state.(phase := ReadColumnCapture, numberMethod := value)
    case ReadColumnCapture => state.(phase := ConvertColumn, difference := value)
    case ConvertColumn => state.(phase := AllocateLiteral, column1 := value)
    case AllocateLiteral => state.(phase := DefineBuffer, literal := value)
    case DefineBuffer => state.(phase := ReadColumnMath)
    case ReadColumnMath => state.(phase := ReadColumnMax, mathReceiver := value)
    case ReadColumnMax => state.(phase := SubtractColumn, maxMethod := value)
    case SubtractColumn => state.(phase := ClampColumn, difference := value)
    case ClampColumn => state.(phase := DefineColumn, column := value)
    case DefineColumn => state.(phase := ReadLineMath)
    case ReadLineMath => state.(phase := ReadLineMax, mathReceiver := value)
    case ReadLineMax => state.(phase := SubtractLine, maxMethod := value)
    case SubtractLine => state.(phase := ClampLine, difference := value)
    case ClampLine => state.(phase := DefineLine, line := value)
    case DefineLine => state.(phase := DefineName)
    case DefineName => state.(phase := DefinePosition)
    case DefinePosition => state.(phase := DefineSnippet)
    case DefineSnippet => state.(phase := Complete)
    case Complete => state
  }

  ghost predicate LiteralField(values: map<Handle, Value>, realm: MarkRealm,
      event: Event) reads {} {
    event.operation.DefineLiteralData? && event.outcome == Returned(realm.undefined) &&
    event.operation.literal in values && values[event.operation.literal].ReferenceValue? &&
    values[event.operation.literal].kind == ObjectReference &&
    var identity := values[event.operation.literal].identity;
    identity in event.before &&
    var previous := event.before[identity];
    (forall property | property in previous.properties :: property.key != event.operation.literalKey) &&
    event.after == event.before[identity := ObjectState(previous.prototype,
      previous.properties + [Property(event.operation.literalKey, event.operation.literalValue, true, true, true)],
      previous.captured, previous.closureName)]
  }

  ghost predicate NormalStep(values: map<Handle, Value>, realm: MarkRealm,
      state: MarkState, event: Event) reads {} {
    event.outcome.Returned? && event.outcome.value in values &&
    (if state.phase == AllocateLiteral then
       O.RecordAllocated(values, event, [], realm.objectPrototype, [])
     else if event.operation.DefineLiteralData? then LiteralField(values, realm, event)
     else if state.phase == SubtractColumn || state.phase == SubtractLine then
       values[event.outcome.value].NumberValue?
     else true)
  }

  ghost predicate MayThrow(phase: MarkPhase) reads {} {
    phase != AllocateLiteral && phase != DefineBuffer && phase != DefineColumn &&
    phase != DefineLine && phase != DefineName && phase != DefinePosition &&
    phase != DefineSnippet && phase != Complete
  }

  ghost predicate CompletedLiteral(values: map<Handle, Value>, realm: MarkRealm,
      filename: Handle, state: MarkState, heap: Heap) reads {}
    requires filename in values
  {
    state.literal in values && values[state.literal].ReferenceValue? &&
    values[state.literal].kind == ObjectReference &&
    var identity := values[state.literal].identity;
    identity in heap &&
    heap[identity] == ObjectState(realm.objectPrototype,
      [Property("buffer", realm.empty, true, true, true),
       Property("column", state.column, true, true, true),
       Property("line", state.line, true, true, true),
       Property("name", if StrictNullish(values[filename]) then realm.empty else filename, true, true, true),
       Property("position", realm.negativeOne, true, true, true),
       Property("snippet", realm.empty, true, true, true)], [], "")
  }

  // Each coordinate branch performs its own pure raw truthiness test.
  // No test converts the match result or requires regex-shaped captures.
  ghost predicate MarkAt(values: map<Handle, Value>, realm: MarkRealm,
      message: Handle, filename: Handle, state: MarkState, heap: Heap,
      events: seq<Event>, output: Outcome) reads {}
    requires Inputs(values, realm, message, filename) && StateValues(values, state)
    requires TraceValues(values, events)
    decreases |events|, 23 - PhaseIndex(state.phase)
  {
    if state.phase == Complete then (
      |events| == 0 && output == Returned(state.literal) &&
      CompletedLiteral(values, realm, filename, state, heap)
    ) else if state.phase == ReadLineNumber && !Truthy(values[state.matchResult]) then (
      MarkAt(values, realm, message, filename,
        state.(phase := ReadColumnNumber, line1 := realm.zero), heap, events, output)
    ) else if state.phase == ReadColumnNumber && !Truthy(values[state.matchResult]) then (
      MarkAt(values, realm, message, filename,
        state.(phase := AllocateLiteral, column1 := realm.zero), heap, events, output)
    ) else (
      |events| > 0 && events[0].before == heap &&
      ExpectedOperation(values, realm, message, filename, state, events[0].operation) &&
      (if events[0].outcome.Thrown? then
        MayThrow(state.phase) && |events| == 1 && output == events[0].outcome
      else
        NormalStep(values, realm, state, events[0]) &&
        MarkAt(values, realm, message, filename,
          Advance(state, events[0].outcome.value), events[0].after, events[1..], output)
      )
    )
  }

  ghost predicate BuildRawMark(values: map<Handle, Value>, realm: MarkRealm,
      message: Handle, filename: Handle, before: Heap,
      events: seq<Event>, output: Outcome) reads {} {
    Inputs(values, realm, message, filename) && TraceValues(values, events) &&
    var initial := MarkState(ReadExec, realm.undefined, realm.undefined,
      realm.undefined, realm.zero, realm.zero, realm.undefined, realm.undefined,
      realm.undefined, realm.undefined, realm.undefined, realm.undefined);
    MarkAt(values, realm, message, filename, initial, before, events, output)
  }
}
