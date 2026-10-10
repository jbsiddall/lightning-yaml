module ErrorTranslation {
  import opened SurfaceModel
  import opened ObjectsAndErrors

  // Mark construction uses BuildMark's standard regex-result profile. This
  // closed model is not generic all-host error translation; raw exec/result,
  // Number and Math correspondence remain OPEN.

  datatype Realm = Realm(undefined: Handle, empty: Handle, zero: Handle,
    negativeOne: Handle, coreIdentity: nat, objectPrototype: nat,
    arrayPrototype: nat, functionPrototype: nat)

  ghost predicate RealmValues(v: map<Handle, Value>, r: Realm) reads {} {
    ValuesValid(v) && r.undefined in v && v[r.undefined].UndefinedValue? &&
    r.empty in v && v[r.empty] == StringValue("") &&
    r.zero in v && v[r.zero] == NumberValue(0) &&
    r.negativeOne in v && v[r.negativeOne] == NumberValue(13830554455654793216)
  }
  ghost predicate ToError(v: map<Handle, Value>, err: Handle,
      es: seq<Event>, out: Outcome) reads {} {
    TraceLinked(es) && TraceValues(v, es) && |es| > 0 &&
    es[0].operation == InstanceOf(err, OrdinaryError) &&
    (if es[0].outcome.Thrown? then ( |es| == 1 && out == es[0].outcome
     ) else ( if ReturnedBoolean(v, es[0].outcome, true) then ( |es| == 1 && out == Returned(err)
     ) else ( ReturnedBoolean(v, es[0].outcome, false) && |es| >= 2 &&
       es[1].operation == StringConvert(err) &&
       (if es[1].outcome.Thrown? then ( |es| == 2 && out == es[1].outcome
        ) else ( |es| == 3 && es[2].operation == CreateError(OrdinaryError, es[1].outcome.value, []) &&
          out == es[2].outcome) )) ) )
  }
  ghost predicate TranslateMessage(v: map<Handle, Value>, r: Realm,
      err: Handle, filename: Handle, message: Handle, es: seq<Event>, out: Outcome) reads {} {
    |es| > 0 && es[0].operation == InstanceOf(err, ParseError) &&
    (if es[0].outcome.Thrown? then ( |es| == 1 && out == es[0].outcome
     ) else ( if ReturnedBoolean(v, es[0].outcome, false) then (
       ExactEvent(es[1..], CreateError(YamlException, message, []), out)
     ) else ( ReturnedBoolean(v, es[0].outcome, true) &&
       exists n: int, mark: Outcome :: (
         MarkSlice(v, r, message, filename, es, n, mark) &&
         (if mark.Thrown? then ( n+1 == |es| && out == mark
          ) else ( ExactEvent(es[1+n..], CreateError(YamlException, message, [mark.value]), out)) )) ) ) )
  }
  ghost predicate MarkSlice(v: map<Handle, Value>, r: Realm, message: Handle,
      filename: Handle, es: seq<Event>, count: int, mark: Outcome) reads {} {
    0 < count <= |es|-1 &&
    BuildMark(v, message, filename, r.empty, r.zero, r.negativeOne,
      r.objectPrototype, es[1..1+count], mark)
  }
  ghost predicate TranslateAfterIdentity(v: map<Handle, Value>, r: Realm,
      err: Handle, filename: Handle, es: seq<Event>, out: Outcome) reads {} {
    |es| > 0 && es[0].operation == InstanceOf(err, OrdinaryError) &&
    (if es[0].outcome.Thrown? then ( |es| == 1 && out == es[0].outcome
     ) else ( |es| >= 2 &&
       ((ReturnedBoolean(v, es[0].outcome, true) && es[1].operation == ReadProperty(err, "message")) ||
        (ReturnedBoolean(v, es[0].outcome, false) && es[1].operation == StringConvert(err))) &&
       (if es[1].outcome.Thrown? then ( |es| == 2 && out == es[1].outcome
        ) else ( TranslateMessage(v, r, err, filename, es[1].outcome.value, es[2..], out)) )) )
  }
  ghost predicate ToYamlException(v: map<Handle, Value>, r: Realm,
      err: Handle, filename: Handle, es: seq<Event>, out: Outcome) reads {} {
    TraceLinked(es) && TraceValues(v, es) && |es| > 0 &&
    es[0].operation == InstanceOf(err, YamlException) &&
    (if es[0].outcome.Thrown? then ( |es| == 1 && out == es[0].outcome
     ) else ( if ReturnedBoolean(v, es[0].outcome, true) then ( |es| == 1 && out == Returned(err)
     ) else ( ReturnedBoolean(v, es[0].outcome, false) &&
       TranslateAfterIdentity(v, r, err, filename, es[1..], out)) ) )
  }
  // Conversion returns an exception object; the caller then throws that exact object.
  ghost predicate ThrowConverted(v: map<Handle, Value>, r: Realm,
      err: Handle, filename: Handle, es: seq<Event>, out: Outcome) reads {} {
    exists converted: Outcome :: ( ToYamlException(v, r, err, filename, es, converted) &&
      out == Thrown(converted.value)
  ) }
  ghost predicate JsCaught(v: map<Handle, Value>, r: Realm,
      err: Handle, options: Handle, es: seq<Event>, out: Outcome) reads {} {
    options in v && TraceLinked(es) && TraceValues(v, es) && |es| > 0 &&
    es[0].operation == InstanceOf(err, NotImplementedError) &&
    (if es[0].outcome.Thrown? then ( |es| == 1 && out == es[0].outcome
     ) else ( if ReturnedBoolean(v, es[0].outcome, true) then ( |es| == 1 && out == Thrown(err)
     ) else ( ReturnedBoolean(v, es[0].outcome, false) &&
       (if StrictNullish(v[options]) then ( ThrowConverted(v, r, err, r.undefined, es[1..], out)
        ) else ( |es| >= 2 && es[1].operation == ReadProperty(options, "filename") &&
          (if es[1].outcome.Thrown? then ( |es| == 2 && out == es[1].outcome
           ) else ( ThrowConverted(v, r, err, es[1].outcome.value, es[2..], out)) )) )) ) )
  }
}
