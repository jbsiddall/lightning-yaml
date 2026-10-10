module FacadeFlow {
  import opened SurfaceModel

  ghost function OptionMessage(surface: Surface, key: string, reason: string): string reads {} {
    (if surface == JsLoad || surface == JsDump then ( "lightning-yaml js-yaml compat: "
     ) else ( "lightning-yaml yaml compat: ") ) + "option \"" + key + "\" " + reason
  }
  ghost function RuleReason(surface: Surface, key: string, converted: string): string reads {} {
    if key == "schema" && (surface == JsLoad || surface == JsDump) then (
      "must be the default CORE schema — other schemas change scalar typing, which is not implemented yet"
    ) else ( if key == "schema" then (
      "\"" + converted + "\" changes scalar typing — only the default \"core\" schema is supported"
    ) else ( if key == "version" then (
      "\"" + converted + "\" is not supported — lightning-yaml targets YAML 1.2 core only"
    ) else ( if surface == JsLoad && key == "json" then (
      "= false (throw on duplicate keys) is not supported yet — lightning-yaml keeps last-wins for JSON.parse parity"
    ) else ( if surface == JsLoad && key == "maxTotalMergeKeys" then (
      "is not supported — merge keys (`<<`) are outside YAML 1.2 core"
    ) else ( if key == "sortKeys" then ( "would sort map keys on output — not supported yet"
    ) else ( if key == "noRefs" then ( "would expand shared refs instead of using `&`/`*` — not supported yet"
    ) else ( if key == "forceQuotes" then ( "would always quote strings — not supported yet"
    ) else ( if key == "seqNoIndent" then ( "would stop indenting block sequences — not supported yet"
    ) else ( if key == "seqInlineFirst" then ( "would inline a sequence's first item — not supported yet"
    ) else ( if key == "flowBracketPadding" then ( "would pad flow-collection brackets — not supported yet"
    ) else ( if key == "flowSkipCommaSpace" then ( "would drop the space after flow commas — not supported yet"
    ) else ( if key == "flowSkipColonSpace" then ( "would drop the space after flow colons — not supported yet"
    ) else ( if key == "quoteFlowKeys" then ( "would quote flow-collection keys — not supported yet"
    ) else ( if key == "tagBeforeAnchor" then ( "would emit the tag before the anchor — not supported yet"
    ) else ( if key == "mapAsMap" then ( "would return mappings as `Map` rather than plain objects — not supported yet"
    ) else ( if key == "intAsBigInt" then ( "would return large integers as exact `BigInt` — not supported yet"
    ) else ( if key == "uniqueKeys" then ( "would throw on duplicate keys — not supported yet (lightning-yaml keeps last-wins)"
    ) else ( if key == "stringKeys" then ( "would require scalar string keys — not supported yet"
    ) else ( if key == "merge" then ( "would enable `<<` merge keys, which are outside YAML 1.2 core"
    ) else ( if key == "sortMapEntries" then ( "would sort map entries on output — not supported yet"
    ) else ( "is not supported yet"
  ) ) ) ) ) ) ) ) ) ) ) ) ) ) ) ) ) ) ) ) ) }
  ghost predicate RuleEvaluation(values: map<Handle, Value>, surface: Surface,
      key: string, rule: Rule, argument: Handle, coreIdentity: nat,
      events: seq<Event>, output: Outcome) reads {} {
    argument in values &&
    (if rule.InheritedRule? then (
      ExactEvent(events, InvokeRule(surface, key, rule, argument), output)
     ) else ( rule.OwnRule? && rule.code == OwnRuleCode(surface, key) && rule.code != 0 &&
      (if !RuleRejects(rule.code, values[argument], coreIdentity) then (
        |events| == 0 && output.Returned? && output.value in values && values[output.value].NullValue?
       ) else ( if rule.code == 6 || rule.code == 7 then (
        |events| == 1 && events[0].operation == StringConvert(argument) &&
        (if events[0].outcome.Thrown? then ( output == events[0].outcome
         ) else ( events[0].outcome.value in values && values[events[0].outcome.value].StringValue? &&
          output.Returned? && output.value in values &&
          values[output.value] == StringValue(RuleReason(surface, key, values[events[0].outcome.value].text))) )
       ) else ( |events| == 0 && output.Returned? && output.value in values &&
        values[output.value] == StringValue(RuleReason(surface, key, ""))) ) )) )
  }
  ghost predicate OptionFailure(surface: Surface, key: string, reason: string,
      events: seq<Event>, output: Outcome) reads {} {
    ExactEvent(events, NewOptionError(surface, OptionMessage(surface, key, reason)), output) && output.Thrown?
  }
  ghost predicate RuleFailure(values: map<Handle, Value>, surface: Surface,
      key: string, reason: Handle, events: seq<Event>, output: Outcome) reads {} {
    reason in values &&
    (if values[reason].StringValue? then ( OptionFailure(surface, key, values[reason].text, events, output)
     ) else ( |events| > 0 && events[0].operation == OptionReasonConvert(reason) &&
      (if events[0].outcome.Thrown? then ( |events| == 1 && output == events[0].outcome
       ) else ( events[0].outcome.value in values && values[events[0].outcome.value].StringValue? &&
        OptionFailure(surface, key, values[events[0].outcome.value].text, events[1..], output)) )) )
  }
  ghost predicate ValidationSteps(values: map<Handle, Value>, surface: Surface,
      bag: Handle, keys: seq<string>, index: nat, coreIdentity: nat,
      undefined: Handle, events: seq<Event>, output: Outcome) reads {}
    requires index <= |keys|
    decreases |events|, |keys| - index
  {
    if index == |keys| then ( |events| == 0 && output == Returned(undefined)
    ) else ( |events| > 0 && events[0].operation == ReadProperty(bag, keys[index]) &&
      events[0].outcome.value in values &&
      (if events[0].outcome.Thrown? then ( |events| == 1 && output == events[0].outcome
       ) else ( var argument := events[0].outcome.value;
        (if values[argument].UndefinedValue? then (
          ValidationSteps(values, surface, bag, keys, index + 1, coreIdentity, undefined, events[1..], output)
         ) else ( |events| >= 2 && events[1].operation.LookupRule? &&
          events[1].operation.surface == surface && events[1].operation.key == keys[index] &&
          (if events[1].outcome.Thrown? then ( |events| == 2 && output == events[1].outcome
           ) else ( var rule := events[1].operation.rule;
            (if rule.MissingRule? then ( OwnRuleCode(surface, keys[index]) == 0 &&
              OptionFailure(surface, keys[index], "is not supported", events[2..], output)
             ) else ( exists n: int, evaluated: Outcome :: (
              RuleEvaluationSlice(values, surface, keys[index], rule, argument, coreIdentity, events, n, evaluated) &&
              (if evaluated.Thrown? then ( n + 2 == |events| && output == evaluated
               ) else ( evaluated.value in values &&
                (if values[evaluated.value].NullValue? then (
                  ValidationSteps(values, surface, bag, keys, index + 1, coreIdentity, undefined, events[2+n..], output)
                 ) else ( RuleFailure(values, surface, keys[index], evaluated.value, events[2+n..], output)) )) )) ) )) )) )) )
  ) }
  ghost predicate ValidateOptions(values: map<Handle, Value>, surface: Surface,
      bag: Handle, coreIdentity: nat, undefined: Handle,
      events: seq<Event>, output: Outcome) reads {} {
    TraceLinked(events) && TraceValues(values, events) && bag in values && undefined in values &&
    values[undefined].UndefinedValue? &&
    (if LooseNullish(values[bag]) || !IsNonNullObject(values[bag]) then (
      |events| == 0 && output == Returned(undefined)
     ) else ( |events| > 0 && events[0].operation == CheckArray(bag) &&
      (if events[0].outcome.Thrown? then ( |events| == 1 && output == events[0].outcome
       ) else ( if events[0].outcome.value in values && Truthy(values[events[0].outcome.value]) then (
         |events| == 1 && output == Returned(undefined)
       ) else ( events[0].outcome.value in values && !Truthy(values[events[0].outcome.value]) && |events| >= 2 &&
         events[1].operation.OwnKeys? && events[1].operation.target == bag &&
         (if events[1].outcome.Thrown? then ( |events| == 2 && output == events[1].outcome
          ) else ( ValidationSteps(values, surface, bag, events[1].operation.keys, 0, coreIdentity, undefined, events[2..], output)) )) ) )) )
  }

  ghost function IndexText(index: nat): string reads {} decreases index {
    if index < 10 then ( [((('0' as int) + index) as char)]
    ) else ( IndexText(index / 10) + [((('0' as int) + index % 10) as char)]
  ) }
  ghost predicate CallReviver(callback: Handle, holder: Handle, key: string,
      argument: Handle, events: seq<Event>, output: Outcome) reads {} {
    |events| > 0 && events[0].operation == ReadProperty(callback, "call") &&
    (if events[0].outcome.Thrown? then ( |events| == 1 && output == events[0].outcome
     ) else ( |events| == 2 && events[1].operation == InvokeCallProperty(events[0].outcome.value,
       callback, holder, key, argument) && output == events[1].outcome) )
  }
  ghost predicate WriteRevived(values: map<Handle, Value>, holder: Handle,
      key: string, revived: Handle, events: seq<Event>, output: Outcome) reads {} {
    revived in values && |events| == 1 &&
    events[0].operation == (if values[revived].UndefinedValue? then ( DeleteProperty(holder, key)
      ) else ( SetProperty(holder, key, revived)) ) && output == events[0].outcome
  }
  ghost predicate WalkObject(values: map<Handle, Value>, target: Handle,
      callback: Handle, keys: seq<string>, index: nat, undefined: Handle,
      events: seq<Event>, output: Outcome) reads {}
    requires index <= |keys|
    decreases |events|, 5, |keys| - index
  {
    if index == |keys| then ( |events| == 0 && output == Returned(undefined)
    ) else ( exists n: int, revived: Outcome :: ( 0 < n <= |events| &&
      ReviveProperty(values, target, keys[index], callback, undefined, events[..n], revived) &&
      (if revived.Thrown? then ( n == |events| && output == revived
       ) else ( n < |events| && WriteRevived(values, target, keys[index], revived.value, events[n..n+1], events[n].outcome) &&
        (if events[n].outcome.Thrown? then ( n + 1 == |events| && output == events[n].outcome
         ) else ( WalkObject(values, target, callback, keys, index + 1, undefined, events[n+1..], output)) )) )
  ) ) }
  ghost predicate WalkArray(values: map<Handle, Value>, target: Handle,
      callback: Handle, index: nat, undefined: Handle,
      events: seq<Event>, output: Outcome) reads {}
    decreases |events|, 2, 0
  {
    |events| > 0 && events[0].operation == ArrayIndexInRange(target, index) &&
    (if events[0].outcome.Thrown? then ( |events| == 1 && output == events[0].outcome
     ) else ( if ReturnedBoolean(values, events[0].outcome, false) then ( |events| == 1 && output == Returned(undefined)
     ) else ( ReturnedBoolean(values, events[0].outcome, true) &&
      exists n: int, revived: Outcome :: (
       ArrayChildSlice(values, target, index, callback, undefined, events, n, revived) &&
       (if revived.Thrown? then ( n + 1 == |events| && output == revived
        ) else ( n + 1 < |events| && WriteRevived(values, target, IndexText(index), revived.value,
          events[n+1..n+2], events[n+1].outcome) &&
          (if events[n+1].outcome.Thrown? then ( n + 2 == |events| && output == events[n+1].outcome
           ) else ( WalkArray(values, target, callback, index + 1, undefined, events[n+2..], output)) )) )) ) ) )
  }
  ghost predicate WalkCapturedObject(values: map<Handle, Value>, target: Handle,
      callback: Handle, undefined: Handle, events: seq<Event>, output: Outcome) reads {}
    decreases |events|, 3, 0
  {
    |events| > 0 && events[0].operation == CheckArray(target) &&
    (if events[0].outcome.Thrown? then ( |events| == 1 && output == events[0].outcome
     ) else ( if events[0].outcome.value in values && Truthy(values[events[0].outcome.value]) then (
      WalkArray(values, target, callback, 0, undefined, events[1..], output)
     ) else ( events[0].outcome.value in values && !Truthy(values[events[0].outcome.value]) && |events| >= 2 &&
      events[1].operation.OwnKeys? && events[1].operation.target == target &&
      (if events[1].outcome.Thrown? then ( |events| == 2 && output == events[1].outcome
       ) else ( WalkObject(values, target, callback, events[1].operation.keys, 0, undefined, events[2..], output)) )) ) )
  }
  ghost predicate ReviveProperty(values: map<Handle, Value>, holder: Handle,
      key: string, callback: Handle, undefined: Handle,
      events: seq<Event>, output: Outcome) reads {}
    decreases |events|, 4, 0
  {
    |events| > 0 && events[0].operation == ReadProperty(holder, key) && events[0].outcome.value in values &&
    (if events[0].outcome.Thrown? then ( |events| == 1 && output == events[0].outcome
     ) else ( var captured := events[0].outcome.value;
      (if !IsNonNullObject(values[captured]) then ( CallReviver(callback, holder, key, captured, events[1..], output)
       ) else ( exists n: int, walked: Outcome :: (
        ObjectChildrenSlice(values, captured, callback, undefined, events, n, walked) &&
        (if walked.Thrown? then ( n + 1 == |events| && output == walked
         ) else ( CallReviver(callback, holder, key, captured, events[1+n..], output)) )) ) )) )
  }

  ghost predicate RuleEvaluationSlice(values: map<Handle, Value>, surface: Surface,
      key: string, rule: Rule, argument: Handle, coreIdentity: nat,
      events: seq<Event>, count: int, evaluated: Outcome) reads {} {
    0 <= count <= |events|-2 &&
    RuleEvaluation(values, surface, key, rule, argument, coreIdentity, events[2..2+count], evaluated)
  }
  ghost predicate ArrayChildSlice(values: map<Handle, Value>, target: Handle,
      index: nat, callback: Handle, undefined: Handle, events: seq<Event>,
      count: int, revived: Outcome) reads {}
    decreases |events|, 1, 0
  {
    0 < count < |events| &&
    ReviveProperty(values, target, IndexText(index), callback, undefined, events[1..1+count], revived)
  }
  ghost predicate ObjectChildrenSlice(values: map<Handle, Value>, captured: Handle,
      callback: Handle, undefined: Handle, events: seq<Event>, count: int,
      walked: Outcome) reads {}
    decreases |events|, 3, 0
  {
    0 < count < |events| &&
    WalkCapturedObject(values, captured, callback, undefined, events[1..1+count], walked)
  }
  ghost predicate IterateSteps(values: map<Handle, Value>, iteratorValue: Handle,
      callback: Handle, undefined: Handle, events: seq<Event>, output: Outcome) reads {}
    decreases |events|
  {
    |events| > 0 && events[0].operation.IteratorNext? && events[0].operation.iteratorValue == iteratorValue &&
    (if events[0].outcome.Thrown? then ( |events| == 1 && output == events[0].outcome
     ) else ( if events[0].operation.done then ( |events| == 1 && output == Returned(undefined)
     ) else ( |events| >= 2 && events[1].operation == IteratorCall(callback, events[0].operation.item) &&
      (if events[1].outcome.Thrown? then ( |events| == 3 &&
        events[2].operation == IteratorClose(iteratorValue) && output == events[1].outcome
       ) else ( IterateSteps(values, iteratorValue, callback, undefined, events[2..], output)) )) ) )
  }
  ghost predicate IterateDocuments(values: map<Handle, Value>, documents: Handle,
      callback: Handle, undefined: Handle, events: seq<Event>, output: Outcome) reads {} {
    TraceLinked(events) && TraceValues(values, events) && |events| > 0 &&
    events[0].operation == GetIterator(documents) &&
    (if events[0].outcome.Thrown? then ( |events| == 1 && output == events[0].outcome
     ) else ( IterateSteps(values, events[0].outcome.value, callback, undefined, events[1..], output)) )
  }
}
