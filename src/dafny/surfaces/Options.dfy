module SurfaceOptions {
  import opened Native
  import V = SurfaceValues

  ghost function YamlParseSlot(second: V.Argument, third: V.Argument): int reads {} {
    if V.IsUndefinedArgument(third) && !V.IsFunctionArgument(second) && V.Truthy(second)
    then 2 else 3
  }
  ghost function YamlStringifySlot(second: V.Argument, third: V.Argument): int reads {} {
    if V.IsUndefinedArgument(third) &&
       !(V.IsFunctionArgument(second) || V.IsArrayArgument(second)) && V.Truthy(second)
    then 2 else 3
  }
  ghost function JsYamlLoadAllSlot(second: V.Argument): int reads {} {
    if V.IsObjectArgument(second) then 2 else 3
  }

  method SelectYamlParseOptions(secondFunction: bool, secondTruthy: bool,
      thirdUndefined: bool, ghost second: V.Argument, ghost third: V.Argument)
      returns (useSecond: bool)
    requires V.WellFormedArgument(second) && V.WellFormedArgument(third)
    requires secondFunction == V.IsFunctionArgument(second)
    requires secondTruthy == V.Truthy(second)
    requires thirdUndefined == V.IsUndefinedArgument(third)
    ensures useSecond == (YamlParseSlot(second, third) == 2)
  {
    useSecond := thirdUndefined && !secondFunction && secondTruthy;
  }

  method SelectYamlStringifyOptions(secondFunction: bool, secondArray: bool,
      secondTruthy: bool, thirdUndefined: bool,
      ghost second: V.Argument, ghost third: V.Argument)
      returns (useSecond: bool)
    requires V.WellFormedArgument(second) && V.WellFormedArgument(third)
    requires secondFunction == V.IsFunctionArgument(second)
    requires secondArray == V.IsArrayArgument(second)
    requires secondTruthy == V.Truthy(second)
    requires thirdUndefined == V.IsUndefinedArgument(third)
    ensures useSecond == (YamlStringifySlot(second, third) == 2)
  {
    useSecond := thirdUndefined && !(secondFunction || secondArray) && secondTruthy;
  }

  method SelectJsYamlLoadAllOptions(secondObject: bool,
      ghost second: V.Argument) returns (useSecond: bool)
    requires V.WellFormedArgument(second)
    requires secondObject == V.IsObjectArgument(second)
    ensures useSecond == (JsYamlLoadAllSlot(second) == 2)
  {
    useSecond := secondObject;
  }

  ghost predicate YamlOptionsPrimitiveRejected(v: V.Argument) reads {} {
    !V.IsLooselyNullishArgument(v) && !(V.IsObjectArgument(v))
  }

  method RejectYamlOptionsPrimitive(looselyNullish: bool, objectType: bool,
      ghost value: V.Argument) returns (reject: bool)
    requires V.WellFormedArgument(value)
    requires looselyNullish == V.IsLooselyNullishArgument(value)
    requires objectType == V.IsObjectArgument(value)
    ensures reject == YamlOptionsPrimitiveRejected(value)
  {
    reject := !looselyNullish && !objectType;
  }

  ghost predicate RuleRejects(code: int, value: V.Argument, coreIdentity: nat) reads {}
    requires 1 <= code <= 7
  {
    !V.IsUndefinedArgument(value) &&
    (if code == 1 then false
     else if code == 2 then !V.IsCoreSchema(value, coreIdentity)
     else if code == 3 then !V.IsTrueArgument(value)
     else if code == 4 then true
     else if code == 5 then V.Truthy(value)
     else if code == 6 then !V.IsCoreText(value)
     else !V.IsVersion12Text(value))
  }

  method RejectRecognizedOption(code: Index, undefinedValue: bool,
      truthyValue: bool, coreSchemaIdentity: bool, exactlyTrue: bool,
      coreText: bool, version12Text: bool,
      ghost value: V.Argument, ghost coreIdentity: nat) returns (reject: bool)
    requires 1 <= code <= 7
    requires V.WellFormedArgument(value)
    requires undefinedValue == V.IsUndefinedArgument(value)
    requires truthyValue == V.Truthy(value)
    requires coreSchemaIdentity == V.IsCoreSchema(value, coreIdentity)
    requires exactlyTrue == V.IsTrueArgument(value)
    requires coreText == V.IsCoreText(value)
    requires version12Text == V.IsVersion12Text(value)
    ensures reject == RuleRejects(code as int, value, coreIdentity)
  {
    if undefinedValue { reject := false; return; }
    if code == 1 { reject := false; }
    else if code == 2 { reject := !coreSchemaIdentity; }
    else if code == 3 { reject := !exactlyTrue; }
    else if code == 4 { reject := true; }
    else if code == 5 { reject := truthyValue; }
    else if code == 6 { reject := !coreText; }
    else { reject := !version12Text; }
  }

  ghost function OwnRuleCode(surface: V.OptionSurface, key: string): int reads {} {
    if surface == V.JsLoad then
      (if key == "filename" then 1 else if key == "schema" then 2
       else if key == "json" then 3
       else if key == "maxAliases" || key == "maxDepth" || key == "maxTotalMergeKeys" then 4
       else 0)
    else if surface == V.JsDump then
      (if key == "schema" then 2
       else if key == "skipInvalid" || key == "indent" || key == "flowLevel" ||
         key == "lineWidth" || key == "quoteStyle" || key == "transform" then 4
       else if key == "sortKeys" || key == "noRefs" || key == "forceQuotes" ||
         key == "seqNoIndent" || key == "seqInlineFirst" || key == "flowBracketPadding" ||
         key == "flowSkipCommaSpace" || key == "flowSkipColonSpace" ||
         key == "quoteFlowKeys" || key == "tagBeforeAnchor" then 5 else 0)
    else if surface == V.YamlRead then
      (if key == "schema" then 6 else if key == "version" then 7
       else if key == "prettyErrors" then 1
       else if key == "maxAliasCount" || key == "customTags" ||
         key == "resolveKnownTags" || key == "keepSourceTokens" ||
         key == "lineCounter" || key == "onAnchor" then 4
       else if key == "mapAsMap" || key == "intAsBigInt" || key == "uniqueKeys" ||
         key == "stringKeys" || key == "merge" then 5 else 0)
    else
      (if key == "schema" then 6 else if key == "version" then 7
       else if key == "sortMapEntries" then 5
       else if key == "singleQuote" || key == "indent" || key == "nullStr" ||
         key == "trueStr" || key == "falseStr" || key == "indentSeq" ||
         key == "directives" || key == "lineWidth" || key == "minContentWidth" ||
         key == "blockQuote" || key == "collectionStyle" || key == "flowCollectionPadding" ||
         key == "aliasDuplicateObjects" || key == "anchorPrefix" || key == "customTags"
         then 4 else 0)
  }
}
