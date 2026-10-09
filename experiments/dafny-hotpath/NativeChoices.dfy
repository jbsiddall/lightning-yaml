module NativeChoices {
  // The exact unannotated range shown in the screenshot.
  newtype int32 = x | -0x8000_0000 <= x < 0x8000_0000
  newtype {:nativeType "number"} Unit = x: int | 0 <= x < 65536

  method Increment(x: int32) returns (y: int32)
    requires x < 0x7fff_ffff
    ensures y == x + 1
  {
    y := x + 1;
  }

  method Code(c: char) returns (u: Unit)
    ensures u as int == c as int
  {
    u := c as Unit;
  }
}
