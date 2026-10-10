module NativeErrorTextContracts {
  import opened SurfaceModel
  import O = ObjectsAndErrors

  ghost function NotImplementedText(name: string): string reads {} {
    "lightning-yaml " + name +
      "() is not implemented yet — this is the stub the benchmark + test harness is built against. See src/index.ts."
  }
  ghost predicate NotImplementedMessage(values: map<Handle, Value>,
      functionName: Handle, events: seq<Event>, output: Outcome) reads {} {
    TraceLinked(events) && TraceValues(values, events) && |events| == 1 &&
    events[0].operation == TemplateConvert(functionName) &&
    (if events[0].outcome.Thrown? then (
      output == events[0].outcome
    ) else (
      events[0].outcome.value in values &&
      values[events[0].outcome.value].StringValue? &&
      output.Returned? && output.value in values &&
      values[output.value] == StringValue(
        NotImplementedText(values[events[0].outcome.value].text))
    ))
  }
  ghost predicate ExceptionToString(values: map<Handle, Value>,
      receiver: Handle, events: seq<Event>, output: Outcome) reads {} {
    O.ExceptionToString(values, receiver, events, output)
  }
}
