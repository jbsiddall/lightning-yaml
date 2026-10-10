// Independent integer model for multiplying a binary64 Number by 1024.
module Binary64Scale {
  const FractionUnit: int := 4503599627370496
  const SignBit: int := 9223372036854775808
  const PositiveInfinityBits: int := 9218868437227405312
  const CanonicalNaNBits: int := 9221120237041090560
  const OneBits: int := 4607182418800017408
  const MultiplierBits: int := 4652218415073722368
  const DefaultKiBBits: int := 4661225614328463360
  const DefaultByteBits: int := 4706261610602168320

  ghost predicate ValidBits(bits: int) reads {} {
    0 <= bits < 2 * SignBit
  }

  ghost function ScaleSubnormalFraction(fraction: int, shift: nat): int
    requires 0 <= fraction < FractionUnit
    requires shift <= 10
    reads {}
    decreases shift
  {
    if shift == 0 then fraction
    else if 2 * fraction < FractionUnit then
      ScaleSubnormalFraction(2 * fraction, shift - 1)
    else 2 * fraction + ((shift - 1) as int) * FractionUnit
  }

  lemma ScaleSubnormalFractionBound(fraction: int, shift: nat)
    requires 0 <= fraction < FractionUnit
    requires shift <= 10
    ensures 0 <= ScaleSubnormalFraction(fraction,shift) < ((shift + 1) as int) * FractionUnit
    decreases shift
  {
    if shift > 0 && 2 * fraction < FractionUnit {
      ScaleSubnormalFractionBound(2 * fraction,shift - 1);
    }
  }

  ghost function ScaleNumberBy1024(bits: int): int
    requires ValidBits(bits)
    reads {}
  {
    var sign := if bits >= SignBit then SignBit else 0;
    var magnitude := bits % SignBit;
    var exponent := magnitude / FractionUnit;
    if magnitude > PositiveInfinityBits then CanonicalNaNBits
    else if exponent == 2047 then sign + PositiveInfinityBits
    else if exponent == 0 then sign + ScaleSubnormalFraction(magnitude, 10)
    else if exponent >= 2037 then sign + PositiveInfinityBits
    else bits + 10 * FractionUnit
  }

  lemma ScaleNumberBy1024ProducesValidBits(bits: int)
    requires ValidBits(bits)
    ensures ValidBits(ScaleNumberBy1024(bits))
  {
    var sign := if bits >= SignBit then SignBit else 0;
    var magnitude := bits % SignBit;
    var exponent := magnitude / FractionUnit;
    if magnitude > PositiveInfinityBits {
      assert ScaleNumberBy1024(bits) == CanonicalNaNBits;
    } else if exponent == 2047 {
      assert ScaleNumberBy1024(bits) == sign + PositiveInfinityBits;
    } else if exponent == 0 {
      assert 0 <= magnitude < FractionUnit;
      ScaleSubnormalFractionBound(magnitude,10);
      assert ScaleSubnormalFraction(magnitude,10) < 11 * FractionUnit;
      assert 11 * FractionUnit < SignBit;
      assert ScaleNumberBy1024(bits) == sign + ScaleSubnormalFraction(magnitude,10);
    } else if exponent >= 2037 {
      assert ScaleNumberBy1024(bits) == sign + PositiveInfinityBits;
    } else {
      assert ScaleNumberBy1024(bits) == bits + 10 * FractionUnit;
    }
  }

  lemma DefaultBudgetEncoding()
    ensures DefaultKiBBits == (1023 + 12) * FractionUnit
    ensures MultiplierBits == (1023 + 10) * FractionUnit
    ensures DefaultByteBits == (1023 + 22) * FractionUnit
    ensures ScaleNumberBy1024(DefaultKiBBits) == DefaultByteBits
  {
  }
}
