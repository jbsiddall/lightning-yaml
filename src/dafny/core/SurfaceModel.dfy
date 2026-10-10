module SurfaceModel {
  import V = SurfaceValues
  import P = SurfaceOptions
  type Handle = nat
  datatype ReferenceKind = ObjectReference | ArrayReference | FunctionReference |
    HtmlDdaReference | ErrorReference | ClosureReference
  datatype Value = UndefinedValue | NullValue | BooleanValue(boolean: bool) |
    NumberValue(bits: int) | StringValue(text: string) | BigIntValue(integer: int) |
    SymbolValue(identity: nat) | ReferenceValue(identity: nat, kind: ReferenceKind)
  datatype Outcome = Returned(value: Handle) | Thrown(value: Handle)
  datatype Surface = JsLoad | JsDump | YamlRead | YamlWrite
  datatype ErrorKind = OrdinaryError | ParseError | NotImplementedError |
    YamlException | YamlCompatError | TypeError
  datatype Property = Property(key: string, value: Handle,
    writable: bool, enumerable: bool, configurable: bool)
  datatype ObjectState = ObjectState(prototype: nat, properties: seq<Property>,
    captured: seq<Handle>, closureName: string)
  type Heap = map<nat, ObjectState>
  datatype Rule = OwnRule(code: nat) | MissingRule | InheritedRule
  datatype Operation =
    ReadProperty(target: Handle, key: string) |
    OwnKeys(target: Handle, keys: seq<string>) |
    LookupRule(surface: Surface, key: string, rule: Rule) |
    InvokeRule(surface: Surface, key: string, rule: Rule, argument: Handle) |
    CreateOptionError(surface: Surface, key: string, reason: Handle) |
    MultiplyBudget(raw: Handle, useDefault: bool) |
    Reset(text: Handle, strict: bool, intern: bool, budget: Handle) |
    ParseCore(all: bool) | EndStream |
    StringifyCore(argument: Handle) | CheckArray(argument: Handle) |
    NewTypeError(typeErrorMessage: string) |
    InstanceOf(argument: Handle, errorClass: ErrorKind) |
    StringConvert(argument: Handle) | TemplateConvert(argument: Handle) |
    CreateError(errorClass: ErrorKind, reason: Handle, mark: seq<Handle>) |
    AllocateArray(elements: seq<Handle>) |
    AllocateRecord(properties: seq<Property>, prototype: nat, capturedHandles: seq<Handle>) |
    ReviverCall(callback: Handle, holder: Handle, key: string, argument: Handle) |
    IteratorCall(callback: Handle, argument: Handle) |
    InvokeCallProperty(methodValue: Handle, receiver: Handle, holder: Handle, key: string, argument: Handle) |
    ArrayIndexInRange(target: Handle, index: nat) |
    GetIterator(target: Handle) | IteratorNext(iteratorValue: Handle, done: bool, item: Handle) |
    IteratorClose(iteratorValue: Handle) |
    ReadArrayLength(target: Handle) | ReadArrayIndex(target: Handle, index: nat) |
    SetProperty(target: Handle, key: string, argument: Handle) |
    DeleteProperty(target: Handle, key: string) |
    AllocateClosure(methodName: string, closureCaptured: Handle) |
    RegexMark(regexMessage: Handle, coercedText: string, matched: bool,
      lineDigits: string, columnDigits: string) |
    NumberFromString(digits: string) | ClampMinusOne(argument: Handle) |
    NewOptionError(surface: Surface, message: string) |
    OptionReasonConvert(argument: Handle) |
    CallMethod(methodValue: Handle, receiver: Handle, arguments: seq<Handle>,
      invocations: seq<CallbackInvocation>)
  datatype Event = Event(operation: Operation, outcome: Outcome,
    before: Heap, after: Heap)
  datatype CallbackInvocation = CallbackInvocation(callback: Handle,
    arguments: seq<Handle>, events: seq<Event>, outcome: Outcome)
  datatype Normalized = Ready(strict: bool, intern: bool, budget: Handle) |
    NormalizationFailure(thrown: Handle)

  ghost function Coarse(v: Value): V.Argument reads {} {
    match v
    case UndefinedValue => V.MissingValue
    case NullValue => V.NullValue
    case BooleanValue(b) => V.BooleanValue(b)
    case NumberValue(bits) => V.NumberBits(bits)
    case StringValue(s) => V.TextValue(s)
    case BigIntValue(i) => V.BigIntValue(i)
    case SymbolValue(i) => V.SymbolValue(i)
    case ReferenceValue(i, kind) =>
      if kind == HtmlDdaReference then ( V.HtmlDdaValue(i)
      ) else ( if kind == ArrayReference then ( V.ArrayValue(i)
      ) else ( if kind == FunctionReference || kind == ClosureReference then ( V.FunctionValue(i)
      ) else ( V.ObjectValue(i)
  ) ) ) }
  ghost function CoarseSurface(s: Surface): V.OptionSurface reads {} {
    match s
    case JsLoad => V.JsLoad
    case JsDump => V.JsDump
    case YamlRead => V.YamlRead
    case YamlWrite => V.YamlWrite
  }

  ghost predicate ValidValue(v: Value) reads {} {
    V.WellFormedArgument(Coarse(v))
  }
  ghost predicate FalsyNumber(bits: int) reads {} {
    V.FalsyNumberBits(bits)
  }
  ghost predicate Truthy(v: Value) reads {} {
    V.Truthy(Coarse(v))
  }
  ghost predicate StrictNullish(v: Value) reads {} {
    V.IsNullishArgument(Coarse(v))
  }
  ghost predicate LooseNullish(v: Value) reads {} {
    V.IsLooselyNullishArgument(Coarse(v))
  }
  ghost predicate IsNonNullObject(v: Value) reads {} {
    V.IsObjectArgument(Coarse(v))
  }
  ghost predicate IsArray(v: Value) reads {} {
    V.IsArrayArgument(Coarse(v))
  }
  ghost predicate IsFunction(v: Value) reads {} {
    V.IsFunctionArgument(Coarse(v))
  }
  ghost predicate ExactlyTrue(v: Value) reads {} { V.IsTrueArgument(Coarse(v)) }
  ghost predicate Describes(values: map<Handle, Value>, h: Handle) reads {} {
    h in values && ValidValue(values[h])
  }
  ghost predicate ValuesValid(values: map<Handle, Value>) reads {} {
    forall h | h in values :: ( ValidValue(values[h])
  ) }
  ghost predicate TraceLinked(events: seq<Event>) reads {} {
    forall i | 0 <= i && i + 1 < |events| :: ( events[i].after == events[i + 1].before
  ) }
  ghost predicate TraceValues(values: map<Handle, Value>, events: seq<Event>) reads {} {
    ValuesValid(values) &&
    (forall e | e in events :: ( Describes(values, e.outcome.value)) )
  }
  ghost predicate ReturnedUndefined(values: map<Handle, Value>, out: Outcome) reads {} {
    out.Returned? && out.value in values && values[out.value].UndefinedValue?
  }
  ghost predicate ReturnedBoolean(values: map<Handle, Value>, out: Outcome, b: bool) reads {} {
    out.Returned? && out.value in values && values[out.value] == BooleanValue(b)
  }
  ghost predicate ExactEvent(events: seq<Event>, op: Operation, out: Outcome) reads {} {
    |events| == 1 && events[0].operation == op && events[0].outcome == out
  }

  ghost function OwnRuleCode(surface: Surface, key: string): int reads {} {
    P.OwnRuleCode(CoarseSurface(surface), key)
  }
  ghost predicate RuleRejects(code: nat, v: Value, coreIdentity: nat) reads {} {
    if 1 <= code <= 7 then ( P.RuleRejects(code as int, Coarse(v), coreIdentity) ) else ( true
  ) }
}
