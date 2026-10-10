module SurfaceValues {
  datatype OptionSurface = JsLoad | JsDump | YamlRead | YamlWrite
  datatype Argument = MissingValue | NullValue | BooleanValue(boolean: bool) |
    NumberBits(bits: int) | TextValue(text: string) | BigIntValue(value: int) |
    SymbolValue(identity: nat) | ObjectValue(identity: nat) | HtmlDdaValue(identity: nat) |
    ArrayValue(identity: nat) | FunctionValue(identity: nat)

  ghost predicate WellFormedArgument(v: Argument) reads {} {
    match v
    case NumberBits(bits) => 0 <= bits < 18446744073709551616
    case _ => true
  }

  ghost predicate IsUndefinedArgument(v: Argument) reads {} { v.MissingValue? }
  ghost predicate IsNullishArgument(v: Argument) reads {} {
    v.MissingValue? || v.NullValue?
  }
  ghost predicate IsLooselyNullishArgument(v: Argument) reads {} {
    v.MissingValue? || v.NullValue? || v.HtmlDdaValue?
  }
  ghost predicate IsFunctionArgument(v: Argument) reads {} { v.FunctionValue? }
  ghost predicate IsArrayArgument(v: Argument) reads {} { v.ArrayValue? }
  ghost predicate IsObjectArgument(v: Argument) reads {} {
    v.ObjectValue? || v.ArrayValue?
  }
  ghost predicate IsTrueArgument(v: Argument) reads {} {
    v.BooleanValue? && v.boolean
  }
  ghost predicate IsCoreText(v: Argument) reads {} {
    v.TextValue? && v.text == "core"
  }
  ghost predicate IsVersion12Text(v: Argument) reads {} {
    v.TextValue? && v.text == "1.2"
  }
  ghost predicate IsCoreSchema(v: Argument, coreIdentity: nat) reads {} {
    v.ObjectValue? && v.identity == coreIdentity
  }
  ghost predicate FalsyNumberBits(bits: int) reads {} {
    bits == 0 || bits == 9223372036854775808 ||
    ((bits / 4503599627370496) % 2048 == 2047 &&
      bits % 4503599627370496 != 0)
  }
  ghost predicate Truthy(v: Argument) reads {} {
    match v
    case MissingValue => false
    case NullValue => false
    case HtmlDdaValue(_) => false
    case BooleanValue(value) => value
    case NumberBits(bits) => !FalsyNumberBits(bits)
    case TextValue(text) => |text| != 0
    case BigIntValue(value) => value != 0
    case _ => true
  }
}
