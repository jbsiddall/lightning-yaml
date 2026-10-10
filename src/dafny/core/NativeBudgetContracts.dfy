// Exact primitive/default budget arithmetic, with String and reference
// conversion domains kept explicit and incomplete.
module NativeBudgetContracts {
  import opened SurfaceModel
  import M = SurfaceModel
  import B = Binary64Scale

  // HOST-OPEN classification of an intrinsic language-created TypeError.
  ghost predicate {:extern} LanguageTypeError(heap: M.Heap,
      described: M.Value) reads {}

  ghost predicate KnownPrimitiveNumberBits(input: M.Value, bits: int) reads {} {
    B.ValidBits(bits) &&
    (match input
     case UndefinedValue => bits == B.CanonicalNaNBits
     case NullValue => bits == 0
     case BooleanValue(boolean) => bits == (if boolean then B.OneBits else 0)
     case NumberValue(numberBits) => bits == numberBits
     case _ => false)
  }

  ghost predicate PrimitiveProductBits(input: M.Value, resultBits: int) reads {} {
    exists numericBits: int :: KnownPrimitiveNumberBits(input, numericBits) &&
      resultBits == B.ScaleNumberBy1024(numericBits)
  }

  ghost predicate BudgetOutcomeGuarantees(values: map<M.Handle, M.Value>,
      rawHandle: M.Handle, useDefault: bool, outcome: M.Outcome,
      afterHeap: M.Heap) reads {}
  {
    M.ValuesValid(values) && rawHandle in values && outcome.value in values &&
    useDefault == M.StrictNullish(values[rawHandle]) &&
    (if useDefault then
       outcome.Returned? && values[outcome.value] == M.NumberValue(B.DefaultByteBits)
     else match values[rawHandle]
       case NumberValue(bits) =>
         B.ValidBits(bits) && outcome.Returned? &&
         values[outcome.value] == M.NumberValue(B.ScaleNumberBy1024(bits))
       case BooleanValue(boolean) =>
         outcome.Returned? && values[outcome.value] ==
           M.NumberValue(if boolean then B.MultiplierBits else 0)
       case StringValue(_) => outcome.Returned? && values[outcome.value].NumberValue?
       case BigIntValue(_) => outcome.Thrown? && values[outcome.value].ReferenceValue? &&
         LanguageTypeError(afterHeap, values[outcome.value])
       case SymbolValue(_) => outcome.Thrown? && values[outcome.value].ReferenceValue? &&
         LanguageTypeError(afterHeap, values[outcome.value])
       case ReferenceValue(_, _) => outcome.Returned? ==> values[outcome.value].NumberValue?
       case _ => false)
  }
}
