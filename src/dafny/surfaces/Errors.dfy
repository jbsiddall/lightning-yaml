module SurfaceErrors {
  import opened Native

  method ParseErrorName() returns (name: string)
    ensures name == "YAMLParseError"
  {
    name := "YAMLParseError";
  }

  method NotImplementedErrorName() returns (name: string)
    ensures name == "NotImplementedError"
  {
    name := "NotImplementedError";
  }

  method YamlExceptionName() returns (name: string)
    ensures name == "YAMLException"
  {
    name := "YAMLException";
  }

  method ChooseExceptionReason(reason: Value, nullish: bool, fallback: Value)
      returns (chosen: Value)
    ensures chosen == (if nullish then fallback else reason)
  {
    if nullish { chosen := fallback; }
    else { chosen := reason; }
  }

  method ChooseExceptionMark(mark: Value, nullish: bool, freshDefault: Value)
      returns (chosen: Value)
    ensures chosen == (if nullish then freshDefault else mark)
  {
    if nullish { chosen := freshDefault; }
    else { chosen := mark; }
  }
}
