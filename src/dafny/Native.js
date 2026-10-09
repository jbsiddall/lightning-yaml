// Dafny program the_program compiled into JavaScript
// Copyright by the contributors to the Dafny Project
// SPDX-License-Identifier: MIT

const BigNumber = require('bignumber.js');
BigNumber.config({ MODULO_MODE: BigNumber.EUCLID })
let _dafny = (function() {
  let $module = {};
  $module.areEqual = function(a, b) {
    if (typeof a === 'string' && b instanceof _dafny.Seq) {
      // Seq.equals(string) works as expected,
      // and the catch-all else block handles that direction.
      // But the opposite direction doesn't work; handle it here.
      return b.equals(a);
    } else if (typeof a === 'number' && BigNumber.isBigNumber(b)) {
      // This conditional would be correct even without the `typeof a` part,
      // but in most cases it's probably faster to short-circuit on a `typeof`
      // than to call `isBigNumber`. (But it remains to properly test this.)
      return b.isEqualTo(a);
    } else if (typeof a !== 'object' || a === null || b === null) {
      return a === b;
    } else if (BigNumber.isBigNumber(a)) {
      return a.isEqualTo(b);
    } else if (a._tname !== undefined || (Array.isArray(a) && a.constructor.name == "Array")) {
      return a === b;  // pointer equality
    } else {
      return a.equals(b);  // value-type equality
    }
  }
  $module.toString = function(a) {
    if (a === null) {
      return "null";
    } else if (typeof a === "number") {
      return a.toFixed();
    } else if (BigNumber.isBigNumber(a)) {
      return a.toFixed();
    } else if (a._tname !== undefined) {
      return a._tname;
    } else {
      return a.toString();
    }
  }
  $module.escapeCharacter = function(cp) {
    let s = String.fromCodePoint(cp.value)
    switch (s) {
      case '\n': return "\\n";
      case '\r': return "\\r";
      case '\t': return "\\t";
      case '\0': return "\\0";
      case '\'': return "\\'";
      case '\"': return "\\\"";
      case '\\': return "\\\\";
      default: return s;
    };
  }
  $module.NewObject = function() {
    return { _tname: "object" };
  }
  $module.InstanceOfTrait = function(obj, trait) {
    return obj._parentTraits !== undefined && obj._parentTraits().includes(trait);
  }
  $module.Rtd_bool = class {
    static get Default() { return false; }
  }
  $module.Rtd_char = class {
    static get Default() { return 'D'; }  // See CharType.DefaultValue in Dafny source code
  }
  $module.Rtd_codepoint = class {
    static get Default() { return new _dafny.CodePoint('D'.codePointAt(0)); }
  }
  $module.Rtd_int = class {
    static get Default() { return BigNumber(0); }
  }
  $module.Rtd_number = class {
    static get Default() { return 0; }
  }
  $module.Rtd_ref = class {
    static get Default() { return null; }
  }
  $module.Rtd_array = class {
    static get Default() { return []; }
  }
  $module.ZERO = new BigNumber(0);
  $module.ONE = new BigNumber(1);
  $module.NUMBER_LIMIT = new BigNumber(0x20).multipliedBy(0x1000000000000);  // 2^53
  $module.Tuple = class Tuple extends Array {
    constructor(...elems) {
      super(...elems);
    }
    toString() {
      return "(" + arrayElementsToString(this) + ")";
    }
    equals(other) {
      if (this === other) {
        return true;
      }
      for (let i = 0; i < this.length; i++) {
        if (!_dafny.areEqual(this[i], other[i])) {
          return false;
        }
      }
      return true;
    }
    static Default(...values) {
      return Tuple.of(...values);
    }
    static Rtd(...rtdArgs) {
      return {
        Default: Tuple.from(rtdArgs, rtd => rtd.Default)
      };
    }
  }
  $module.Set = class Set extends Array {
    constructor() {
      super();
    }
    static get Default() {
      return Set.Empty;
    }
    toString() {
      return "{" + arrayElementsToString(this) + "}";
    }
    static get Empty() {
      if (this._empty === undefined) {
        this._empty = new Set();
      }
      return this._empty;
    }
    static fromElements(...elmts) {
      let s = new Set();
      for (let k of elmts) {
        s.add(k);
      }
      return s;
    }
    contains(k) {
      for (let i = 0; i < this.length; i++) {
        if (_dafny.areEqual(this[i], k)) {
          return true;
        }
      }
      return false;
    }
    add(k) {  // mutates the Set; use only during construction
      if (!this.contains(k)) {
        this.push(k);
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.length !== other.length) {
        return false;
      }
      for (let e of this) {
        if (!other.contains(e)) {
          return false;
        }
      }
      return true;
    }
    get Elements() {
      return this;
    }
    Union(that) {
      if (this.length === 0) {
        return that;
      } else if (that.length === 0) {
        return this;
      } else {
        let s = Set.of(...this);
        for (let k of that) {
          s.add(k);
        }
        return s;
      }
    }
    Intersect(that) {
      if (this.length === 0) {
        return this;
      } else if (that.length === 0) {
        return that;
      } else {
        let s = new Set();
        for (let k of this) {
          if (that.contains(k)) {
            s.push(k);
          }
        }
        return s;
      }
    }
    Difference(that) {
      if (this.length == 0 || that.length == 0) {
        return this;
      } else {
        let s = new Set();
        for (let k of this) {
          if (!that.contains(k)) {
            s.push(k);
          }
        }
        return s;
      }
    }
    IsDisjointFrom(that) {
      for (let k of this) {
        if (that.contains(k)) {
          return false;
        }
      }
      return true;
    }
    IsSubsetOf(that) {
      if (that.length < this.length) {
        return false;
      }
      for (let k of this) {
        if (!that.contains(k)) {
          return false;
        }
      }
      return true;
    }
    IsProperSubsetOf(that) {
      if (that.length <= this.length) {
        return false;
      }
      for (let k of this) {
        if (!that.contains(k)) {
          return false;
        }
      }
      return true;
    }
    get AllSubsets() {
      return this.AllSubsets_();
    }
    *AllSubsets_() {
      // Start by putting all set elements into a list, but don't include null
      let elmts = Array.of(...this);
      let n = elmts.length;
      let which = new Array(n);
      which.fill(false);
      let a = [];
      while (true) {
        yield Set.of(...a);
        // "add 1" to "which", as if doing a carry chain.  For every digit changed, change the membership of the corresponding element in "a".
        let i = 0;
        for (; i < n && which[i]; i++) {
          which[i] = false;
          // remove elmts[i] from a
          for (let j = 0; j < a.length; j++) {
            if (_dafny.areEqual(a[j], elmts[i])) {
              // move the last element of a into slot j
              a[j] = a[-1];
              a.pop();
              break;
            }
          }
        }
        if (i === n) {
          // we have cycled through all the subsets
          break;
        }
        which[i] = true;
        a.push(elmts[i]);
      }
    }
  }
  $module.MultiSet = class MultiSet extends Array {
    constructor() {
      super();
    }
    static get Default() {
      return MultiSet.Empty;
    }
    toString() {
      let s = "multiset{";
      let sep = "";
      for (let e of this) {
        let [k, n] = e;
        let ks = _dafny.toString(k);
        while (!n.isZero()) {
          n = n.minus(1);
          s += sep + ks;
          sep = ", ";
        }
      }
      s += "}";
      return s;
    }
    static get Empty() {
      if (this._empty === undefined) {
        this._empty = new MultiSet();
      }
      return this._empty;
    }
    static fromElements(...elmts) {
      let s = new MultiSet();
      for (let e of elmts) {
        s.add(e, _dafny.ONE);
      }
      return s;
    }
    static FromArray(arr) {
      let s = new MultiSet();
      for (let e of arr) {
        s.add(e, _dafny.ONE);
      }
      return s;
    }
    cardinality() {
      let c = _dafny.ZERO;
      for (let e of this) {
        let [k, n] = e;
        c = c.plus(n);
      }
      return c;
    }
    clone() {
      let s = new MultiSet();
      for (let e of this) {
        let [k, n] = e;
        s.push([k, n]);  // make sure to create a new array [k, n] here
      }
      return s;
    }
    findIndex(k) {
      for (let i = 0; i < this.length; i++) {
        if (_dafny.areEqual(this[i][0], k)) {
          return i;
        }
      }
      return this.length;
    }
    get(k) {
      let i = this.findIndex(k);
      if (i === this.length) {
        return _dafny.ZERO;
      } else {
        return this[i][1];
      }
    }
    contains(k) {
      return !this.get(k).isZero();
    }
    add(k, n) {
      let i = this.findIndex(k);
      if (i === this.length) {
        this.push([k, n]);
      } else {
        let m = this[i][1];
        this[i] = [k, m.plus(n)];
      }
    }
    update(k, n) {
      let i = this.findIndex(k);
      if (i < this.length && this[i][1].isEqualTo(n)) {
        return this;
      } else if (i === this.length && n.isZero()) {
        return this;
      } else if (i === this.length) {
        let m = this.slice();
        m.push([k, n]);
        return m;
      } else {
        let m = this.slice();
        m[i] = [k, n];
        return m;
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      }
      for (let e of this) {
        let [k, n] = e;
        let m = other.get(k);
        if (!n.isEqualTo(m)) {
          return false;
        }
      }
      return this.cardinality().isEqualTo(other.cardinality());
    }
    get Elements() {
      return this.Elements_();
    }
    *Elements_() {
      for (let i = 0; i < this.length; i++) {
        let [k, n] = this[i];
        while (!n.isZero()) {
          yield k;
          n = n.minus(1);
        }
      }
    }
    get UniqueElements() {
      return this.UniqueElements_();
    }
    *UniqueElements_() {
      for (let e of this) {
        let [k, n] = e;
        if (!n.isZero()) {
          yield k;
        }
      }
    }
    Union(that) {
      if (this.length === 0) {
        return that;
      } else if (that.length === 0) {
        return this;
      } else {
        let s = this.clone();
        for (let e of that) {
          let [k, n] = e;
          s.add(k, n);
        }
        return s;
      }
    }
    Intersect(that) {
      if (this.length === 0) {
        return this;
      } else if (that.length === 0) {
        return that;
      } else {
        let s = new MultiSet();
        for (let e of this) {
          let [k, n] = e;
          let m = that.get(k);
          if (!m.isZero()) {
            s.push([k, m.isLessThan(n) ? m : n]);
          }
        }
        return s;
      }
    }
    Difference(that) {
      if (this.length === 0 || that.length === 0) {
        return this;
      } else {
        let s = new MultiSet();
        for (let e of this) {
          let [k, n] = e;
          let d = n.minus(that.get(k));
          if (d.isGreaterThan(0)) {
            s.push([k, d]);
          }
        }
        return s;
      }
    }
    IsDisjointFrom(that) {
      let intersection = this.Intersect(that);
      return intersection.cardinality().isZero();
    }
    IsSubsetOf(that) {
      for (let e of this) {
        let [k, n] = e;
        let m = that.get(k);
        if (!n.isLessThanOrEqualTo(m)) {
          return false;
        }
      }
      return true;
    }
    IsProperSubsetOf(that) {
      return this.IsSubsetOf(that) && this.cardinality().isLessThan(that.cardinality());
    }
  }
  $module.CodePoint = class CodePoint {
    constructor(value) {
      this.value = value
    }
    equals(other) {
      if (this === other) {
        return true;
      }
      return this.value === other.value
    }
    isLessThan(other) {
      return this.value < other.value
    }
    isLessThanOrEqual(other) {
      return this.value <= other.value
    }
    toString() {
      return "'" + $module.escapeCharacter(this) + "'";
    }
    static isCodePoint(i) {
      return (
        (_dafny.ZERO.isLessThanOrEqualTo(i) && i.isLessThan(new BigNumber(0xD800))) ||
        (new BigNumber(0xE000).isLessThanOrEqualTo(i) && i.isLessThan(new BigNumber(0x11_0000))))
    }
  }
  $module.Seq = class Seq extends Array {
    constructor(...elems) {
      super(...elems);
    }
    static get Default() {
      return Seq.of();
    }
    static Create(n, init) {
      return Seq.from({length: n}, (_, i) => init(new BigNumber(i)));
    }
    static UnicodeFromString(s) {
      return new Seq(...([...s].map(c => new _dafny.CodePoint(c.codePointAt(0)))))
    }
    toString() {
      return "[" + arrayElementsToString(this) + "]";
    }
    toVerbatimString(asLiteral) {
      if (asLiteral) {
        return '"' + this.map(c => _dafny.escapeCharacter(c)).join("") + '"';
      } else {
        return this.map(c => String.fromCodePoint(c.value)).join("");
      }
    }
    static update(s, i, v) {
      if (typeof s === "string") {
        let p = s.slice(0, i);
        let q = s.slice(i.toNumber() + 1);
        return p.concat(v, q);
      } else {
        let t = s.slice();
        t[i] = v;
        return t;
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.length !== other.length) {
        return false;
      }
      for (let i = 0; i < this.length; i++) {
        if (!_dafny.areEqual(this[i], other[i])) {
          return false;
        }
      }
      return true;
    }
    static contains(s, k) {
      if (typeof s === "string") {
        return s.includes(k);
      } else {
        for (let x of s) {
          if (_dafny.areEqual(x, k)) {
            return true;
          }
        }
        return false;
      }
    }
    get Elements() {
      return this;
    }
    get UniqueElements() {
      return _dafny.Set.fromElements(...this);
    }
    static Concat(a, b) {
      if (typeof a === "string" || typeof b === "string") {
        // string concatenation, so make sure both operands are strings before concatenating
        if (typeof a !== "string") {
          // a must be a Seq
          a = a.join("");
        }
        if (typeof b !== "string") {
          // b must be a Seq
          b = b.join("");
        }
        return a + b;
      } else {
        // ordinary concatenation
        let r = Seq.of(...a);
        r.push(...b);
        return r;
      }
    }
    static JoinIfPossible(x) {
      try { return x.join(""); } catch(_error) { return x; }
    }
    static IsPrefixOf(a, b) {
      if (b.length < a.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (!_dafny.areEqual(a[i], b[i])) {
          return false;
        }
      }
      return true;
    }
    static IsProperPrefixOf(a, b) {
      if (b.length <= a.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (!_dafny.areEqual(a[i], b[i])) {
          return false;
        }
      }
      return true;
    }
  }
  $module.Map = class Map extends Array {
    constructor() {
      super();
    }
    static get Default() {
      return Map.of();
    }
    toString() {
      return "map[" + this.map(maplet => _dafny.toString(maplet[0]) + " := " + _dafny.toString(maplet[1])).join(", ") + "]";
    }
    static get Empty() {
      if (this._empty === undefined) {
        this._empty = new Map();
      }
      return this._empty;
    }
    findIndex(k) {
      for (let i = 0; i < this.length; i++) {
        if (_dafny.areEqual(this[i][0], k)) {
          return i;
        }
      }
      return this.length;
    }
    get(k) {
      let i = this.findIndex(k);
      if (i === this.length) {
        return undefined;
      } else {
        return this[i][1];
      }
    }
    contains(k) {
      return this.findIndex(k) < this.length;
    }
    update(k, v) {
      let m = this.slice();
      m.updateUnsafe(k, v);
      return m;
    }
    // Similar to update, but make the modification in-place.
    // Meant to be used in the map constructor.
    updateUnsafe(k, v) {
      let m = this;
      let i = m.findIndex(k);
      m[i] = [k, v];
      return m;
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.length !== other.length) {
        return false;
      }
      for (let e of this) {
        let [k, v] = e;
        let w = other.get(k);
        if (w === undefined || !_dafny.areEqual(v, w)) {
          return false;
        }
      }
      return true;
    }
    get Keys() {
      let s = new _dafny.Set();
      for (let e of this) {
        let [k, v] = e;
        s.push(k);
      }
      return s;
    }
    get Values() {
      let s = new _dafny.Set();
      for (let e of this) {
        let [k, v] = e;
        s.add(v);
      }
      return s;
    }
    get Items() {
      let s = new _dafny.Set();
      for (let e of this) {
        let [k, v] = e;
        s.push(_dafny.Tuple.of(k, v));
      }
      return s;
    }
    Merge(that) {
      let m = that.slice();
      for (let e of this) {
        let [k, v] = e;
        let i = m.findIndex(k);
        if (i == m.length) {
          m[i] = [k, v];
        }
      }
      return m;
    }
    Subtract(keys) {
      if (this.length === 0 || keys.length === 0) {
        return this;
      }
      let m = new Map();
      for (let e of this) {
        let [k, v] = e;
        if (!keys.contains(k)) {
          m[m.length] = e;
        }
      }
      return m;
    }
  }
  $module.newArray = function(initValue, ...dims) {
    return { dims: dims, elmts: buildArray(initValue, ...dims) };
  }
  $module.BigOrdinal = class BigOrdinal {
    static get Default() {
      return _dafny.ZERO;
    }
    static IsLimit(ord) {
      return ord.isZero();
    }
    static IsSucc(ord) {
      return ord.isGreaterThan(0);
    }
    static Offset(ord) {
      return ord;
    }
    static IsNat(ord) {
      return true;  // at run time, every ORDINAL is a natural number
    }
  }
  $module.BigRational = class BigRational {
    static get ZERO() {
      if (this._zero === undefined) {
        this._zero = new BigRational(_dafny.ZERO);
      }
      return this._zero;
    }
    constructor (n, d) {
      // requires d === undefined || 1 <= d
      this.num = n;
      this.den = d === undefined ? _dafny.ONE : d;
      // invariant 1 <= den || (num == 0 && den == 0)
    }
    static get Default() {
      return _dafny.BigRational.ZERO;
    }
    // We need to deal with the special case `num == 0 && den == 0`, because
    // that's what C#'s default struct constructor will produce for BigRational. :(
    // To deal with it, we ignore `den` when `num` is 0.
    toString() {
      if (this.num.isZero() || this.den.isEqualTo(1)) {
        return this.num.toFixed() + ".0";
      }
      let answer = this.dividesAPowerOf10(this.den);
      if (answer !== undefined) {
        let n = this.num.multipliedBy(answer[0]);
        let log10 = answer[1];
        let sign, digits;
        if (this.num.isLessThan(0)) {
          sign = "-"; digits = n.negated().toFixed();
        } else {
          sign = ""; digits = n.toFixed();
        }
        if (log10 < digits.length) {
          let digitCount = digits.length - log10;
          return sign + digits.slice(0, digitCount) + "." + digits.slice(digitCount);
        } else {
          return sign + "0." + "0".repeat(log10 - digits.length) + digits;
        }
      } else {
        return "(" + this.num.toFixed() + ".0 / " + this.den.toFixed() + ".0)";
      }
    }
    isPowerOf10(x) {
      if (x.isZero()) {
        return undefined;
      }
      let log10 = 0;
      while (true) {  // invariant: x != 0 && x * 10^log10 == old(x)
        if (x.isEqualTo(1)) {
          return log10;
        } else if (x.mod(10).isZero()) {
          log10++;
          x = x.dividedToIntegerBy(10);
        } else {
          return undefined;
        }
      }
    }
    dividesAPowerOf10(i) {
      let factor = _dafny.ONE;
      let log10 = 0;
      if (i.isLessThanOrEqualTo(_dafny.ZERO)) {
        return undefined;
      }

      // invariant: 1 <= i && i * 10^log10 == factor * old(i)
      while (i.mod(10).isZero()) {
        i = i.dividedToIntegerBy(10);
       log10++;
      }

      while (i.mod(5).isZero()) {
        i = i.dividedToIntegerBy(5);
        factor = factor.multipliedBy(2);
        log10++;
      }
      while (i.mod(2).isZero()) {
        i = i.dividedToIntegerBy(2);
        factor = factor.multipliedBy(5);
        log10++;
      }

      if (i.isEqualTo(_dafny.ONE)) {
        return [factor, log10];
      } else {
        return undefined;
      }
    }
    toBigNumber() {
      if (this.num.isZero() || this.den.isEqualTo(1)) {
        return this.num;
      } else if (this.num.isGreaterThan(0)) {
        return this.num.dividedToIntegerBy(this.den);
      } else {
        return this.num.minus(this.den).plus(1).dividedToIntegerBy(this.den);
      }
    }
    isInteger() {
      return this.equals(new _dafny.BigRational(this.toBigNumber(), _dafny.ONE));
    }
    // Returns values such that aa/dd == a and bb/dd == b.
    normalize(b) {
      let a = this;
      let aa, bb, dd;
      if (a.num.isZero()) {
        aa = a.num;
        bb = b.num;
        dd = b.den;
      } else if (b.num.isZero()) {
        aa = a.num;
        dd = a.den;
        bb = b.num;
      } else {
        let gcd = BigNumberGcd(a.den, b.den);
        let xx = a.den.dividedToIntegerBy(gcd);
        let yy = b.den.dividedToIntegerBy(gcd);
        // We now have a == a.num / (xx * gcd) and b == b.num / (yy * gcd).
        aa = a.num.multipliedBy(yy);
        bb = b.num.multipliedBy(xx);
        dd = a.den.multipliedBy(yy);
      }
      return [aa, bb, dd];
    }
    compareTo(that) {
      // simple things first
      let asign = this.num.isZero() ? 0 : this.num.isLessThan(0) ? -1 : 1;
      let bsign = that.num.isZero() ? 0 : that.num.isLessThan(0) ? -1 : 1;
      if (asign < 0 && 0 <= bsign) {
        return -1;
      } else if (asign <= 0 && 0 < bsign) {
        return -1;
      } else if (bsign < 0 && 0 <= asign) {
        return 1;
      } else if (bsign <= 0 && 0 < asign) {
        return 1;
      }
      let [aa, bb, dd] = this.normalize(that);
      if (aa.isLessThan(bb)) {
        return -1;
      } else if (aa.isEqualTo(bb)){
        return 0;
      } else {
        return 1;
      }
    }
    equals(that) {
      return this.compareTo(that) === 0;
    }
    isLessThan(that) {
      return this.compareTo(that) < 0;
    }
    isAtMost(that) {
      return this.compareTo(that) <= 0;
    }
    plus(b) {
      let [aa, bb, dd] = this.normalize(b);
      return new BigRational(aa.plus(bb), dd);
    }
    minus(b) {
      let [aa, bb, dd] = this.normalize(b);
      return new BigRational(aa.minus(bb), dd);
    }
    negated() {
      return new BigRational(this.num.negated(), this.den);
    }
    multipliedBy(b) {
      return new BigRational(this.num.multipliedBy(b.num), this.den.multipliedBy(b.den));
    }
    dividedBy(b) {
      let a = this;
      // Compute the reciprocal of b
      let bReciprocal;
      if (b.num.isGreaterThan(0)) {
        bReciprocal = new BigRational(b.den, b.num);
      } else {
        // this is the case b.num < 0
        bReciprocal = new BigRational(b.den.negated(), b.num.negated());
      }
      return a.multipliedBy(bReciprocal);
    }
  }
  $module.EuclideanDivisionNumber = function(a, b) {
    if (0 <= a) {
      if (0 <= b) {
        // +a +b: a/b
        return Math.floor(a / b);
      } else {
        // +a -b: -(a/(-b))
        return -Math.floor(a / -b);
      }
    } else {
      if (0 <= b) {
        // -a +b: -((-a-1)/b) - 1
        return -Math.floor((-a-1) / b) - 1;
      } else {
        // -a -b: ((-a-1)/(-b)) + 1
        return Math.floor((-a-1) / -b) + 1;
      }
    }
  }
  $module.EuclideanDivision = function(a, b) {
    if (a.isGreaterThanOrEqualTo(0)) {
      if (b.isGreaterThanOrEqualTo(0)) {
        // +a +b: a/b
        return a.dividedToIntegerBy(b);
      } else {
        // +a -b: -(a/(-b))
        return a.dividedToIntegerBy(b.negated()).negated();
      }
    } else {
      if (b.isGreaterThanOrEqualTo(0)) {
        // -a +b: -((-a-1)/b) - 1
        return a.negated().minus(1).dividedToIntegerBy(b).negated().minus(1);
      } else {
        // -a -b: ((-a-1)/(-b)) + 1
        return a.negated().minus(1).dividedToIntegerBy(b.negated()).plus(1);
      }
    }
  }
  $module.EuclideanModuloNumber = function(a, b) {
    let bp = Math.abs(b);
    if (0 <= a) {
      // +a: a % bp
      return a % bp;
    } else {
      // c = ((-a) % bp)
      // -a: bp - c if c > 0
      // -a: 0 if c == 0
      let c = (-a) % bp;
      return c === 0 ? c : bp - c;
    }
  }
  $module.ShiftLeft = function(b, n) {
    return b.multipliedBy(new BigNumber(2).exponentiatedBy(n));
  }
  $module.ShiftRight = function(b, n) {
    return b.dividedToIntegerBy(new BigNumber(2).exponentiatedBy(n));
  }
  $module.RotateLeft = function(b, n, w) {  // truncate(b << n) | (b >> (w - n))
    let x = _dafny.ShiftLeft(b, n).mod(new BigNumber(2).exponentiatedBy(w));
    let y = _dafny.ShiftRight(b, w - n);
    return x.plus(y);
  }
  $module.RotateRight = function(b, n, w) {  // (b >> n) | truncate(b << (w - n))
    let x = _dafny.ShiftRight(b, n);
    let y = _dafny.ShiftLeft(b, w - n).mod(new BigNumber(2).exponentiatedBy(w));;
    return x.plus(y);
  }
  $module.BitwiseAnd = function(a, b) {
    let r = _dafny.ZERO;
    const m = _dafny.NUMBER_LIMIT;  // 2^53
    let h = _dafny.ONE;
    while (!a.isZero() && !b.isZero()) {
      let a0 = a.mod(m);
      let b0 = b.mod(m);
      r = r.plus(h.multipliedBy(a0 & b0));
      a = a.dividedToIntegerBy(m);
      b = b.dividedToIntegerBy(m);
      h = h.multipliedBy(m);
    }
    return r;
  }
  $module.BitwiseOr = function(a, b) {
    let r = _dafny.ZERO;
    const m = _dafny.NUMBER_LIMIT;  // 2^53
    let h = _dafny.ONE;
    while (!a.isZero() && !b.isZero()) {
      let a0 = a.mod(m);
      let b0 = b.mod(m);
      r = r.plus(h.multipliedBy(a0 | b0));
      a = a.dividedToIntegerBy(m);
      b = b.dividedToIntegerBy(m);
      h = h.multipliedBy(m);
    }
    r = r.plus(h.multipliedBy(a | b));
    return r;
  }
  $module.BitwiseXor = function(a, b) {
    let r = _dafny.ZERO;
    const m = _dafny.NUMBER_LIMIT;  // 2^53
    let h = _dafny.ONE;
    while (!a.isZero() && !b.isZero()) {
      let a0 = a.mod(m);
      let b0 = b.mod(m);
      r = r.plus(h.multipliedBy(a0 ^ b0));
      a = a.dividedToIntegerBy(m);
      b = b.dividedToIntegerBy(m);
      h = h.multipliedBy(m);
    }
    r = r.plus(h.multipliedBy(a | b));
    return r;
  }
  $module.BitwiseNot = function(a, bits) {
    let r = _dafny.ZERO;
    let h = _dafny.ONE;
    for (let i = 0; i < bits; i++) {
      let bit = a.mod(2);
      if (bit.isZero()) {
        r = r.plus(h);
      }
      a = a.dividedToIntegerBy(2);
      h = h.multipliedBy(2);
    }
    return r;
  }
  $module.Quantifier = function(vals, frall, pred) {
    for (let u of vals) {
      if (pred(u) !== frall) { return !frall; }
    }
    return frall;
  }
  $module.PlusChar = function(a, b) {
    return String.fromCharCode(a.charCodeAt(0) + b.charCodeAt(0));
  }
  $module.UnicodePlusChar = function(a, b) {
    return new _dafny.CodePoint(a.value + b.value);
  }
  $module.MinusChar = function(a, b) {
    return String.fromCharCode(a.charCodeAt(0) - b.charCodeAt(0));
  }
  $module.UnicodeMinusChar = function(a, b) {
    return new _dafny.CodePoint(a.value - b.value);
  }
  $module.AllBooleans = function*() {
    yield false;
    yield true;
  }
  $module.AllChars = function*() {
    for (let i = 0; i < 0x10000; i++) {
      yield String.fromCharCode(i);
    }
  }
  $module.AllUnicodeChars = function*() {
    for (let i = 0; i < 0xD800; i++) {
      yield new _dafny.CodePoint(i);
    }
    for (let i = 0xE0000; i < 0x110000; i++) {
      yield new _dafny.CodePoint(i);
    }
  }
  $module.AllIntegers = function*() {
    yield _dafny.ZERO;
    for (let j = _dafny.ONE;; j = j.plus(1)) {
      yield j;
      yield j.negated();
    }
  }
  $module.IntegerRange = function*(lo, hi) {
    if (lo === null) {
      while (true) {
        hi = hi.minus(1);
        yield hi;
      }
    } else if (hi === null) {
      while (true) {
        yield lo;
        lo = lo.plus(1);
      }
    } else {
      while (lo.isLessThan(hi)) {
        yield lo;
        lo = lo.plus(1);
      }
    }
  }
  $module.SingleValue = function*(v) {
    yield v;
  }
  $module.HaltException = class HaltException extends Error {
    constructor(message) {
      super(message)
    }
  }
  $module.HandleHaltExceptions = function(f) {
    try {
      f()
    } catch (e) {
      if (e instanceof _dafny.HaltException) {
        process.stdout.write("[Program halted] " + e.message + "\n")
        process.exitCode = 1
      } else {
        throw e
      }
    }
  }
  $module.FromMainArguments = function(args) {
    var a = [...args];
    a.splice(0, 2, args[0] + " " + args[1]);
    return a;
  }
  $module.UnicodeFromMainArguments = function(args) {
    return $module.FromMainArguments(args).map(_dafny.Seq.UnicodeFromString);
  }
  return $module;

  // What follows are routines private to the Dafny runtime
  function buildArray(initValue, ...dims) {
    if (dims.length === 0) {
      return initValue;
    } else {
      let a = Array(dims[0].toNumber());
      let b = Array.from(a, (x) => buildArray(initValue, ...dims.slice(1)));
      return b;
    }
  }
  function arrayElementsToString(a) {
    // like `a.join(", ")`, but calling _dafny.toString(x) on every element x instead of x.toString()
    let s = "";
    let sep = "";
    for (let x of a) {
      s += sep + _dafny.toString(x);
      sep = ", ";
    }
    return s;
  }
  function BigNumberGcd(a, b){  // gcd of two non-negative BigNumber's
    while (true) {
      if (a.isZero()) {
        return b;
      } else if (b.isZero()) {
        return a;
      }
      if (a.isLessThan(b)) {
        b = b.modulo(a);
      } else {
        a = a.modulo(b);
      }
    }
  }
})();
// Dafny program systemModulePopulator.dfy compiled into JavaScript
let _System = (function() {
  let $module = {};

  $module.nat = class nat {
    constructor () {
    }
    static get Default() {
      return _dafny.ZERO;
    }
    static _Is(__source) {
      let _0_x = (__source);
      return (_dafny.ZERO).isLessThanOrEqualTo(_0_x);
    }
  };

  return $module;
})(); // end of module _System
let Native = (function() {
  let $module = {};


  $module.Index = class Index {
    constructor () {
    }
    _parentTraits() {
      return [];
    }
    static *IntegerRange(lo, hi) {
      while (lo.isLessThan(hi)) {
        yield lo.toNumber();
        lo = lo.plus(1);
      }
    }
    static get Default() {
      return 0;
    }
    static _Is(__source) {
      let _0_x = new BigNumber(__source);
      return ((_dafny.ZERO).isLessThanOrEqualTo(_0_x)) && ((_0_x).isLessThan(new BigNumber(9007199254740000)));
    }
  };

  $module.Counter = class Counter {
    constructor () {
    }
    _parentTraits() {
      return [];
    }
    static *IntegerRange(lo, hi) {
      while (lo.isLessThan(hi)) {
        yield lo.toNumber();
        lo = lo.plus(1);
      }
    }
    static get Default() {
      return 0;
    }
    static _Is(__source) {
      let _1_x = new BigNumber(__source);
      return ((new BigNumber(-9007199254740000)).isLessThan(_1_x)) && ((_1_x).isLessThan(new BigNumber(9007199254740000)));
    }
  };

  $module.Unit = class Unit {
    constructor () {
    }
    _parentTraits() {
      return [];
    }
    static *IntegerRange(lo, hi) {
      while (lo.isLessThan(hi)) {
        yield lo.toNumber();
        lo = lo.plus(1);
      }
    }
    static get Default() {
      return 0;
    }
    static _Is(__source) {
      let _2_x = new BigNumber(__source);
      return ((_dafny.ZERO).isLessThanOrEqualTo(_2_x)) && ((_2_x).isLessThan(new BigNumber(65536)));
    }
  };



  return $module;
})(); // end of module Native
let TagValues = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "TagValues._default";
    }
    _parentTraits() {
      return [];
    }
    static get SPACE() {
      return 32;
    };
    static get TAB() {
      return 9;
    };
    static get LF() {
      return 10;
    };
    static get CR() {
      return 13;
    };
    static get BASE64__PADDING() {
      return 61;
    };
  };

  $module.Helpers = class Helpers {
    constructor () {
      this._tname = "TagValues.Helpers";
      this.lastError = "";
    }
    _parentTraits() {
      return [];
    }
    __ctor() {
      let _this = this;
      (_this).lastError = "";
      return;
    }
    ErrorMessage() {
      let _this = this;
      let error = "";
      error = _this.lastError;
      return error;
    }
    BASE64__INV(code) {
      let _this = this;
      let digit = 0;
      if (((65) <= (code)) && ((code) <= (90))) {
        digit = (code) - (65);
        return digit;
      }
      if (((97) <= (code)) && ((code) <= (122))) {
        digit = (code) - (71);
        return digit;
      }
      if (((48) <= (code)) && ((code) <= (57))) {
        digit = (code) + (4);
        return digit;
      }
      if ((code) === (43)) {
        digit = 62;
        return digit;
      }
      if ((code) === (47)) {
        digit = 63;
        return digit;
      }
      digit = -1;
      return digit;
    }
    IsBase64Whitespace(code) {
      let _this = this;
      let yes = false;
      yes = ((((code) === (TagValues.__default.SPACE)) || ((code) === (TagValues.__default.TAB))) || ((code) === (TagValues.__default.LF))) || ((code) === (TagValues.__default.CR));
      return yes;
    }
    StripBase64Whitespace(raw) {
      let _this = this;
      let clean = "";
      let _0_n;
      _0_n = Native.__default.stringLength(raw);
      let _1_hasWs;
      _1_hasWs = false;
      let _2_i;
      _2_i = 0;
      L0: {
        while ((_2_i) < (_0_n)) {
          C0: {
            let _3_c;
            _3_c = Native.__default.codeUnitAt(raw, _2_i);
            let _4_isWs;
            let _out0;
            _out0 = (_this).IsBase64Whitespace(_3_c);
            _4_isWs = _out0;
            if (_4_isWs) {
              _1_hasWs = true;
              break L0;
            }
            _2_i = (_2_i) + (1);
          }
        }
      }
      if (!(_1_hasWs)) {
        clean = raw;
        return clean;
      }
      clean = "";
      let _5_seg;
      _5_seg = 0;
      _2_i = 0;
      while ((_2_i) <= (_0_n)) {
        let _6_c;
        _6_c = -1;
        if ((_2_i) < (_0_n)) {
          _6_c = Native.__default.codeUnitAt(raw, _2_i);
        }
        let _7_isWs;
        let _out1;
        _out1 = (_this).IsBase64Whitespace(_6_c);
        _7_isWs = _out1;
        if ((_7_isWs) || ((_6_c) === (-1))) {
          if ((_2_i) > (_5_seg)) {
            clean = Native.__default.concat(clean, Native.__default.slice(raw, _5_seg, _2_i));
          }
          _5_seg = (_2_i) + (1);
        }
        _2_i = (_2_i) + (1);
      }
      return clean;
    }
    DecodeBinary(raw) {
      let _this = this;
      let bytes = undefined;
      bytes = Native.__default.undefinedValue;
      (_this).lastError = "";
      let _0_clean;
      let _out0;
      _out0 = (_this).StripBase64Whitespace(raw);
      _0_clean = _out0;
      let _1_n;
      _1_n = Native.__default.stringLength(_0_clean);
      if ((_1_n) === (0)) {
        bytes = Native.__default.createUint8Array(0);
        return bytes;
      }
      if ((_dafny.EuclideanModuloNumber(_1_n, 4)) !== (0)) {
        (_this).lastError = "malformed !!binary content: base64 length must be a multiple of 4 after stripping whitespace";
        return bytes;
      }
      let _2_padding;
      _2_padding = 0;
      let _3_last;
      _3_last = Native.__default.codeUnitAt(_0_clean, (_1_n) - (1));
      if ((_3_last) === (TagValues.__default.BASE64__PADDING)) {
        _2_padding = 1;
        let _4_previous;
        _4_previous = Native.__default.codeUnitAt(_0_clean, (_1_n) - (2));
        if ((_4_previous) === (TagValues.__default.BASE64__PADDING)) {
          _2_padding = 2;
        }
      }
      let _5_validEnd;
      _5_validEnd = (_1_n) - (_2_padding);
      let _6_i;
      _6_i = 0;
      while ((_6_i) < (_5_validEnd)) {
        let _7_code;
        _7_code = Native.__default.codeUnitAt(_0_clean, _6_i);
        let _8_digit;
        let _out1;
        _out1 = (_this).BASE64__INV(_7_code);
        _8_digit = _out1;
        if (((_7_code) >= (256)) || ((_8_digit) === (-1))) {
          (_this).lastError = "malformed !!binary content: invalid base64 character";
          return bytes;
        }
        _6_i = (_6_i) + (1);
      }
      let _9_outLen;
      _9_outLen = ((_dafny.EuclideanDivisionNumber(_1_n, 4)) * (3)) - (_2_padding);
      bytes = Native.__default.createUint8Array(_9_outLen);
      let _10_o;
      _10_o = 0;
      _6_i = 0;
      while ((_6_i) < (_1_n)) {
        let _11_c0Code;
        _11_c0Code = Native.__default.codeUnitAt(_0_clean, _6_i);
        let _12_c1Code;
        _12_c1Code = Native.__default.codeUnitAt(_0_clean, (_6_i) + (1));
        let _13_c2Code;
        _13_c2Code = Native.__default.codeUnitAt(_0_clean, (_6_i) + (2));
        let _14_c3Code;
        _14_c3Code = Native.__default.codeUnitAt(_0_clean, (_6_i) + (3));
        let _15_c0;
        let _out2;
        _out2 = (_this).BASE64__INV(_11_c0Code);
        _15_c0 = _out2;
        let _16_c1;
        let _out3;
        _out3 = (_this).BASE64__INV(_12_c1Code);
        _16_c1 = _out3;
        let _17_c2;
        _17_c2 = 0;
        if ((_13_c2Code) !== (TagValues.__default.BASE64__PADDING)) {
          let _out4;
          _out4 = (_this).BASE64__INV(_13_c2Code);
          _17_c2 = _out4;
        }
        let _18_c3;
        _18_c3 = 0;
        if ((_14_c3Code) !== (TagValues.__default.BASE64__PADDING)) {
          let _out5;
          _out5 = (_this).BASE64__INV(_14_c3Code);
          _18_c3 = _out5;
        }
        let _19_triple;
        _19_triple = ((((_15_c0) * (262144)) + ((_16_c1) * (4096))) + ((_17_c2) * (64))) + (_18_c3);
        let _20_isLastGroup;
        _20_isLastGroup = ((_6_i) + (4)) === (_1_n);
        let _21_firstByte;
        _21_firstByte = _dafny.EuclideanDivisionNumber(_19_triple, 65536);
        Native.__default.byteSet(bytes, _10_o, _21_firstByte);
        _10_o = (_10_o) + (1);
        if (!((_20_isLastGroup) && ((_2_padding) >= (2)))) {
          let _22_secondByte;
          _22_secondByte = _dafny.EuclideanModuloNumber(_dafny.EuclideanDivisionNumber(_19_triple, 256), 256);
          Native.__default.byteSet(bytes, _10_o, _22_secondByte);
          _10_o = (_10_o) + (1);
        }
        if (!((_20_isLastGroup) && ((_2_padding) >= (1)))) {
          let _23_thirdByte;
          _23_thirdByte = _dafny.EuclideanModuloNumber(_19_triple, 256);
          Native.__default.byteSet(bytes, _10_o, _23_thirdByte);
          _10_o = (_10_o) + (1);
        }
        _6_i = (_6_i) + (4);
      }
      return bytes;
    }
    BuildSet(mapValue) {
      let _this = this;
      let setValue = undefined;
      setValue = Native.__default.undefinedValue;
      (_this).lastError = "";
      let _0_nativeSet;
      let _out0;
      _out0 = Native.__default.setCreate();
      _0_nativeSet = _out0;
      let _1_keys;
      let _out1;
      _out1 = Native.__default.objectKeys(mapValue);
      _1_keys = _out1;
      let _2_n;
      let _out2;
      _out2 = Native.__default.arrayLength(_1_keys);
      _2_n = _out2;
      let _3_i;
      _3_i = 0;
      while ((_3_i) < (_2_n)) {
        let _4_keyValue;
        let _out3;
        _out3 = Native.__default.arrayGet(_1_keys, _3_i);
        _4_keyValue = _out3;
        let _5_key;
        _5_key = Native.__default.stringValueOf(_4_keyValue);
        let _6_value;
        let _out4;
        _out4 = Native.__default.objectGet(mapValue, _5_key);
        _6_value = _out4;
        if (!(Native.__default.isNull(_6_value))) {
          (_this).lastError = "!!set: every key must have a null value";
          return setValue;
        }
        Native.__default.setAdd(_0_nativeSet, _4_keyValue);
        _3_i = (_3_i) + (1);
      }
      setValue = Native.__default.setValue(_0_nativeSet);
      return setValue;
    }
    BuildOmap(sequence) {
      let _this = this;
      let mapValue = undefined;
      mapValue = Native.__default.undefinedValue;
      (_this).lastError = "";
      let _0_nativeMap;
      let _out0;
      _out0 = Native.__default.mapCreate();
      _0_nativeMap = _out0;
      let _1_n;
      let _out1;
      _out1 = Native.__default.arrayLength(sequence);
      _1_n = _out1;
      let _2_i;
      _2_i = 0;
      while ((_2_i) < (_1_n)) {
        let _3_entry;
        let _out2;
        _out2 = Native.__default.arrayGet(sequence, _2_i);
        _3_entry = _out2;
        let _4_keys;
        let _out3;
        _out3 = (_this).SinglePairKeys(_3_entry);
        _4_keys = _out3;
        if (!_dafny.areEqual(_this.lastError, "")) {
          return mapValue;
        }
        let _5_keyValue;
        let _out4;
        _out4 = Native.__default.arrayGet(_4_keys, 0);
        _5_keyValue = _out4;
        let _6_key;
        _6_key = Native.__default.stringValueOf(_5_keyValue);
        let _7_value;
        let _out5;
        _out5 = Native.__default.objectGet(_3_entry, _6_key);
        _7_value = _out5;
        Native.__default.mapSet(_0_nativeMap, _5_keyValue, _7_value);
        _2_i = (_2_i) + (1);
        let _out6;
        _out6 = Native.__default.arrayLength(sequence);
        _1_n = _out6;
      }
      mapValue = Native.__default.mapValue(_0_nativeMap);
      return mapValue;
    }
    ValidatePairs(sequence) {
      let _this = this;
      (_this).lastError = "";
      let _0_n;
      let _out0;
      _out0 = Native.__default.arrayLength(sequence);
      _0_n = _out0;
      let _1_i;
      _1_i = 0;
      while ((_1_i) < (_0_n)) {
        let _2_entry;
        let _out1;
        _out1 = Native.__default.arrayGet(sequence, _1_i);
        _2_entry = _out1;
        let _3_keys;
        let _out2;
        _out2 = (_this).SinglePairKeys(_2_entry);
        _3_keys = _out2;
        if (!_dafny.areEqual(_this.lastError, "")) {
          return;
        }
        _1_i = (_1_i) + (1);
        let _out3;
        _out3 = Native.__default.arrayLength(sequence);
        _0_n = _out3;
      }
      return;
    }
    SinglePairKeys(entry) {
      let _this = this;
      let keys = undefined;
      keys = Native.__default.undefinedValue;
      (_this).lastError = "";
      if (((!(Native.__default.isObject(entry))) || (Native.__default.isNull(entry))) || (Native.__default.isArray(entry))) {
        (_this).lastError = "each entry must be a single-key mapping ('- key: value')";
        return keys;
      }
      let _out0;
      _out0 = Native.__default.objectKeys(entry);
      keys = _out0;
      let _0_n;
      let _out1;
      _out1 = Native.__default.arrayLength(keys);
      _0_n = _out1;
      if ((_0_n) !== (1)) {
        (_this).lastError = "each entry must have exactly one key (one sequence indicator per pair)";
        keys = Native.__default.undefinedValue;
        return keys;
      }
      return keys;
    }
  };
  return $module;
})(); // end of module TagValues
let DafnyCore = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "DafnyCore._default";
    }
    _parentTraits() {
      return [];
    }
    static Parse(text, isStrict) {
      let value = undefined;
      let _0_engine;
      let _nw0 = new DafnyCore.Engine();
      _nw0.__ctor();
      _0_engine = _nw0;
      (_0_engine).Reset(text, isStrict, false, Native.__default.numberValue(4194304));
      let _out0;
      _out0 = (_0_engine).ParseSingle();
      value = _out0;
      return value;
    }
    static ParseAll(text, isStrict) {
      let documents = undefined;
      let _0_engine;
      let _nw0 = new DafnyCore.Engine();
      _nw0.__ctor();
      _0_engine = _nw0;
      (_0_engine).Reset(text, isStrict, false, Native.__default.numberValue(4194304));
      let _out0;
      _out0 = (_0_engine).ParseAll();
      documents = _out0;
      return documents;
    }
  };

  $module.Engine = class Engine {
    constructor () {
      this._tname = "DafnyCore.Engine";
      this.src = "";
      this.pos = 0;
      this.len = 0;
      this.lineStart = 0;
      this.depth = 0;
      this.strict = false;
      this.plainStoppedAtColon = false;
      this.plainStoppedAtComment = false;
      this.quotedMultiline = false;
      this.flowFolded = "";
      this.hasFlowFolded = false;
      this.flowWsCrossedLine = false;
      this.flowSpanned = false;
      this.flowIndentFloor = 0;
      this.nextBackslash = 0;
      this.nextNewline = 0;
      this.keyCache = undefined;
      this.keyCacheBytes = undefined;
      this.keyCacheMaxBytes = undefined;
      this.valueCache = undefined;
      this.hasValueCache = false;
      this.valueCacheEnabled = false;
      this.lastRecordKeys = undefined;
      this.hasLastRecordKeys = false;
      this.tagHandles = undefined;
      this.hasTagHandles = false;
      this.anchorMap = undefined;
      this.hasAnchorMap = false;
      this.pendingAnchorName = "";
      this.hasPendingAnchorName = false;
      this.afterInlineProperty = false;
      this.inlineMapValue = false;
      this.colOverride = 0;
      this.bareDocAllowed = false;
      this.foldedBreaks = 0;
      this.tagHelpers = undefined;
      this.lastNumberIsFloat = false;
    }
    _parentTraits() {
      return [];
    }
    __ctor() {
      let _this = this;
      let _nw0 = new TagValues.Helpers();
      _nw0.__ctor();
      (_this).tagHelpers = _nw0;
      (_this).lastNumberIsFloat = false;
      (_this).Reset("", true, false, Native.__default.numberValue(4194304));
      return;
    }
    Reset(text, isStrict, internValues, keyCacheBudget) {
      let _this = this;
      (_this).src = text;
      (_this).pos = 0;
      (_this).len = (text).length;
      (_this).lineStart = 0;
      (_this).depth = 0;
      (_this).strict = isStrict;
      (_this).plainStoppedAtColon = false;
      (_this).plainStoppedAtComment = false;
      (_this).quotedMultiline = false;
      (_this).flowFolded = "";
      (_this).hasFlowFolded = false;
      (_this).flowWsCrossedLine = false;
      (_this).flowSpanned = false;
      (_this).flowIndentFloor = -1;
      (_this).nextBackslash = -1;
      (_this).nextNewline = -1;
      let _out0;
      _out0 = Native.__default.mapCreate();
      (_this).keyCache = _out0;
      (_this).keyCacheBytes = Native.__default.numberValue(0);
      (_this).keyCacheMaxBytes = keyCacheBudget;
      (_this).valueCache = Native.__default.undefinedValue;
      (_this).hasValueCache = false;
      (_this).valueCacheEnabled = internValues;
      (_this).lastRecordKeys = Native.__default.undefinedValue;
      (_this).hasLastRecordKeys = false;
      (_this).tagHandles = Native.__default.undefinedValue;
      (_this).hasTagHandles = false;
      (_this).anchorMap = Native.__default.undefinedValue;
      (_this).hasAnchorMap = false;
      (_this).pendingAnchorName = "";
      (_this).hasPendingAnchorName = false;
      (_this).afterInlineProperty = false;
      (_this).inlineMapValue = false;
      (_this).colOverride = -1;
      (_this).bareDocAllowed = true;
      (_this).foldedBreaks = 0;
      if (((_this.len) > (0)) && ((((_this.src)[_dafny.ZERO]).charCodeAt(0)) === (65279))) {
        (_this).pos = 1;
        (_this).lineStart = 1;
      }
      return;
    }
    FlowIndicator(c) {
      let _this = this;
      return (((((c) === (44)) || ((c) === (91))) || ((c) === (93))) || ((c) === (123))) || ((c) === (125));
    };
    IsDigit(c) {
      let _this = this;
      return ((48) <= (c)) && ((c) < (58));
    };
    FlowSeparatorAt(i) {
      let _this = this;
      let yes = false;
      if ((i) === (_this.len)) {
        yes = true;
        return yes;
      }
      let _0_c;
      _0_c = ((_this.src)[i]).charCodeAt(0);
      yes = (((((_0_c) === (32)) || ((_0_c) === (9))) || ((_0_c) === (10))) || ((_0_c) === (13))) || ((_this).FlowIndicator(_0_c));
      return yes;
    }
    ScanFlowPlainLine(from) {
      let _this = this;
      let p = 0;
      p = from;
      L1: {
        while ((p) < (_this.len)) {
          C1: {
            let _0_c;
            _0_c = ((_this.src)[p]).charCodeAt(0);
            if ((((_this).FlowIndicator(_0_c)) || ((_0_c) === (10))) || ((_0_c) === (13))) {
              break L1;
            }
            if ((_0_c) === (58)) {
              if (((p) + (1)) === (_this.len)) {
                break L1;
              }
              let _1_next;
              _1_next = ((_this.src)[(p) + (1)]).charCodeAt(0);
              if ((((((_1_next) === (32)) || ((_1_next) === (9))) || ((_1_next) === (10))) || ((_1_next) === (13))) || ((_this).FlowIndicator(_1_next))) {
                break L1;
              }
            } else if (((_0_c) === (35)) && ((p) > (from))) {
              let _2_prev;
              _2_prev = ((_this.src)[(p) - (1)]).charCodeAt(0);
              if (((_2_prev) === (32)) || ((_2_prev) === (9))) {
                break L1;
              }
            }
            p = (p) + (1);
          }
        }
      }
      return p;
    }
    TrimTrailingWs(from, end) {
      let _this = this;
      let p = 0;
      p = end;
      L2: {
        while ((p) > (from)) {
          C2: {
            let _0_c;
            _0_c = ((_this.src)[(p) - (1)]).charCodeAt(0);
            if (((_0_c) !== (32)) && ((_0_c) !== (9))) {
              break L2;
            }
            p = (p) - (1);
          }
        }
      }
      return p;
    }
    IsNullWord(s) {
      let _this = this;
      let yes = false;
      yes = ((((_dafny.areEqual(s, "")) || (_dafny.areEqual(s, "~"))) || (_dafny.areEqual(s, "null"))) || (_dafny.areEqual(s, "Null"))) || (_dafny.areEqual(s, "NULL"));
      return yes;
    }
    IsBoolWord(s) {
      let _this = this;
      let value = undefined;
      if (((_dafny.areEqual(s, "true")) || (_dafny.areEqual(s, "True"))) || (_dafny.areEqual(s, "TRUE"))) {
        value = Native.__default.boolValue(true);
        return value;
      }
      if (((_dafny.areEqual(s, "false")) || (_dafny.areEqual(s, "False"))) || (_dafny.areEqual(s, "FALSE"))) {
        value = Native.__default.boolValue(false);
        return value;
      }
      value = Native.__default.notNumericValue;
      return value;
    }
    HexValueGeneric(s, from, to) {
      let _this = this;
      let value = undefined;
      value = Native.__default.notNumericValue;
      if ((from) >= (to)) {
        return value;
      }
      let _0_p;
      _0_p = from;
      let _1_accumulator;
      _1_accumulator = Native.__default.numberValue(0);
      while ((_0_p) < (to)) {
        let _2_digit;
        let _out0;
        _out0 = (_this).HexDigit(((s)[_0_p]).charCodeAt(0));
        _2_digit = _out0;
        if ((_2_digit) < (0)) {
          return value;
        }
        _1_accumulator = Native.__default.numberMulAdd(_1_accumulator, 16, _2_digit);
        _0_p = (_0_p) + (1);
      }
      value = _1_accumulator;
      return value;
    }
    OctalValueGeneric(s, from, to) {
      let _this = this;
      let value = undefined;
      value = Native.__default.notNumericValue;
      if ((from) >= (to)) {
        return value;
      }
      let _0_p;
      _0_p = from;
      let _1_accumulator;
      _1_accumulator = Native.__default.numberValue(0);
      while ((_0_p) < (to)) {
        let _2_c;
        _2_c = ((s)[_0_p]).charCodeAt(0);
        if (((_2_c) < (48)) || ((_2_c) > (55))) {
          return value;
        }
        _1_accumulator = Native.__default.numberMulAdd(_1_accumulator, 8, (_2_c) - (48));
        _0_p = (_0_p) + (1);
      }
      value = _1_accumulator;
      return value;
    }
    HexValue(from, to) {
      let _this = this;
      let value = undefined;
      value = Native.__default.notNumericValue;
      if ((from) >= (to)) {
        return value;
      }
      let _0_p;
      _0_p = from;
      let _1_accumulator;
      _1_accumulator = Native.__default.numberValue(0);
      while ((_0_p) < (to)) {
        let _2_digit;
        let _out0;
        _out0 = (_this).HexDigit(((_this.src)[_0_p]).charCodeAt(0));
        _2_digit = _out0;
        if ((_2_digit) < (0)) {
          return value;
        }
        _1_accumulator = Native.__default.numberMulAdd(_1_accumulator, 16, _2_digit);
        _0_p = (_0_p) + (1);
      }
      value = _1_accumulator;
      return value;
    }
    OctalValue(from, to) {
      let _this = this;
      let value = undefined;
      value = Native.__default.notNumericValue;
      if ((from) >= (to)) {
        return value;
      }
      let _0_p;
      _0_p = from;
      let _1_accumulator;
      _1_accumulator = Native.__default.numberValue(0);
      while ((_0_p) < (to)) {
        let _2_c;
        _2_c = ((_this.src)[_0_p]).charCodeAt(0);
        if (((_2_c) < (48)) || ((_2_c) > (55))) {
          return value;
        }
        _1_accumulator = Native.__default.numberMulAdd(_1_accumulator, 8, (_2_c) - (48));
        _0_p = (_0_p) + (1);
      }
      value = _1_accumulator;
      return value;
    }
    TryNumber(from, to) {
      let _this = this;
      let value = undefined;
      value = Native.__default.notNumericValue;
      if ((from) === (to)) {
        return value;
      }
      let _0_p;
      _0_p = from;
      let _1_c;
      _1_c = ((_this.src)[_0_p]).charCodeAt(0);
      let _2_negative;
      _2_negative = (_1_c) === (45);
      let _3_signed;
      _3_signed = (_2_negative) || ((_1_c) === (43));
      if (_3_signed) {
        _0_p = (_0_p) + (1);
        if ((_0_p) === (to)) {
          return value;
        }
        _1_c = ((_this.src)[_0_p]).charCodeAt(0);
      }
      if (((!(_3_signed)) && ((_1_c) === (48))) && (((_0_p) + (1)) < (to))) {
        let _4_base;
        _4_base = ((_this.src)[(_0_p) + (1)]).charCodeAt(0);
        if (((_4_base) === (120)) || ((_4_base) === (111))) {
          if ((_4_base) === (120)) {
            let _out0;
            _out0 = (_this).HexValue((_0_p) + (2), to);
            value = _out0;
          } else {
            let _out1;
            _out1 = (_this).OctalValue((_0_p) + (2), to);
            value = _out1;
          }
          return value;
        }
      }
      if (((_1_c) === (46)) && (((to) - (_0_p)) === (4))) {
        let _5_w1;
        _5_w1 = ((_this.src)[(_0_p) + (1)]).charCodeAt(0);
        let _6_w2;
        _6_w2 = ((_this.src)[(_0_p) + (2)]).charCodeAt(0);
        let _7_w3;
        _7_w3 = ((_this.src)[(_0_p) + (3)]).charCodeAt(0);
        let _8_inf;
        _8_inf = (((((_5_w1) === (105)) && ((_6_w2) === (110))) && ((_7_w3) === (102))) || ((((_5_w1) === (73)) && ((_6_w2) === (110))) && ((_7_w3) === (102)))) || ((((_5_w1) === (73)) && ((_6_w2) === (78))) && ((_7_w3) === (70)));
        let _9_nan;
        _9_nan = (((((_5_w1) === (110)) && ((_6_w2) === (97))) && ((_7_w3) === (110))) || ((((_5_w1) === (78)) && ((_6_w2) === (97))) && ((_7_w3) === (78)))) || ((((_5_w1) === (78)) && ((_6_w2) === (65))) && ((_7_w3) === (78)));
        if (_8_inf) {
          value = Native.__default.parseSpecialNumber(((_2_negative) ? ("-Infinity") : ("Infinity")));
          return value;
        }
        if ((!(_3_signed)) && (_9_nan)) {
          value = Native.__default.parseSpecialNumber("NaN");
          return value;
        }
      }
      let _10_digitsSeen;
      _10_digitsSeen = 0;
      let _11_accumulator;
      _11_accumulator = Native.__default.numberValue(0);
      while (((_0_p) < (to)) && ((_this).IsDigit(((_this.src)[_0_p]).charCodeAt(0)))) {
        _11_accumulator = Native.__default.numberMulAdd(_11_accumulator, 10, (((_this.src)[_0_p]).charCodeAt(0)) - (48));
        _10_digitsSeen = (_10_digitsSeen) + (1);
        _0_p = (_0_p) + (1);
      }
      let _12_isFloat;
      _12_isFloat = false;
      if (((_0_p) < (to)) && ((((_this.src)[_0_p]).charCodeAt(0)) === (46))) {
        _12_isFloat = true;
        _0_p = (_0_p) + (1);
        while (((_0_p) < (to)) && ((_this).IsDigit(((_this.src)[_0_p]).charCodeAt(0)))) {
          _10_digitsSeen = (_10_digitsSeen) + (1);
          _0_p = (_0_p) + (1);
        }
      }
      if ((_10_digitsSeen) === (0)) {
        return value;
      }
      if (((_0_p) < (to)) && (((((_this.src)[_0_p]).charCodeAt(0)) === (101)) || ((((_this.src)[_0_p]).charCodeAt(0)) === (69)))) {
        _12_isFloat = true;
        _0_p = (_0_p) + (1);
        if (((_0_p) < (to)) && (((((_this.src)[_0_p]).charCodeAt(0)) === (43)) || ((((_this.src)[_0_p]).charCodeAt(0)) === (45)))) {
          _0_p = (_0_p) + (1);
        }
        let _13_exponentStart;
        _13_exponentStart = _0_p;
        while (((_0_p) < (to)) && ((_this).IsDigit(((_this.src)[_0_p]).charCodeAt(0)))) {
          _0_p = (_0_p) + (1);
        }
        if ((_0_p) === (_13_exponentStart)) {
          return value;
        }
      }
      if ((_0_p) !== (to)) {
        return value;
      }
      if ((!(_12_isFloat)) && ((_10_digitsSeen) <= (15))) {
        if (_2_negative) {
          value = Native.__default.numberNegate(_11_accumulator);
        } else {
          value = _11_accumulator;
        }
      } else {
        value = Native.__default.parseNumber(Native.__default.slice(_this.src, from, to));
      }
      return value;
    }
    TryNumberGeneric(s) {
      let _this = this;
      let value = undefined;
      value = Native.__default.notNumericValue;
      (_this).lastNumberIsFloat = false;
      let _0_n;
      _0_n = Native.__default.stringLength(s);
      if ((_0_n) === (0)) {
        return value;
      }
      let _1_p;
      _1_p = 0;
      let _2_c;
      _2_c = ((s)[_1_p]).charCodeAt(0);
      let _3_negative;
      _3_negative = (_2_c) === (45);
      let _4_signed;
      _4_signed = (_3_negative) || ((_2_c) === (43));
      if (_4_signed) {
        _1_p = (_1_p) + (1);
        if ((_1_p) >= (_0_n)) {
          return value;
        }
        _2_c = ((s)[_1_p]).charCodeAt(0);
      }
      if (((!(_4_signed)) && ((_2_c) === (48))) && (((_1_p) + (1)) < (_0_n))) {
        let _5_base;
        _5_base = ((s)[(_1_p) + (1)]).charCodeAt(0);
        if (((_5_base) === (120)) || ((_5_base) === (111))) {
          if ((_5_base) === (120)) {
            let _out0;
            _out0 = (_this).HexValueGeneric(s, (_1_p) + (2), _0_n);
            value = _out0;
          } else {
            let _out1;
            _out1 = (_this).OctalValueGeneric(s, (_1_p) + (2), _0_n);
            value = _out1;
          }
          return value;
        }
      }
      if (((_2_c) === (46)) && (((_0_n) - (_1_p)) === (4))) {
        let _6_a;
        _6_a = ((s)[(_1_p) + (1)]).charCodeAt(0);
        let _7_b;
        _7_b = ((s)[(_1_p) + (2)]).charCodeAt(0);
        let _8_d;
        _8_d = ((s)[(_1_p) + (3)]).charCodeAt(0);
        let _9_inf;
        _9_inf = (((((_6_a) === (105)) && ((_7_b) === (110))) && ((_8_d) === (102))) || ((((_6_a) === (73)) && ((_7_b) === (110))) && ((_8_d) === (102)))) || ((((_6_a) === (73)) && ((_7_b) === (78))) && ((_8_d) === (70)));
        let _10_nan;
        _10_nan = (((((_6_a) === (110)) && ((_7_b) === (97))) && ((_8_d) === (110))) || ((((_6_a) === (78)) && ((_7_b) === (97))) && ((_8_d) === (78)))) || ((((_6_a) === (78)) && ((_7_b) === (65))) && ((_8_d) === (78)));
        if (_9_inf) {
          (_this).lastNumberIsFloat = true;
          value = Native.__default.parseSpecialNumber(((_3_negative) ? ("-Infinity") : ("Infinity")));
          return value;
        }
        if ((!(_4_signed)) && (_10_nan)) {
          (_this).lastNumberIsFloat = true;
          value = Native.__default.parseSpecialNumber("NaN");
          return value;
        }
      }
      let _11_digitsSeen;
      _11_digitsSeen = 0;
      let _12_accumulator;
      _12_accumulator = Native.__default.numberValue(0);
      while (((_1_p) < (_0_n)) && ((_this).IsDigit(((s)[_1_p]).charCodeAt(0)))) {
        _12_accumulator = Native.__default.numberMulAdd(_12_accumulator, 10, (((s)[_1_p]).charCodeAt(0)) - (48));
        _11_digitsSeen = (_11_digitsSeen) + (1);
        _1_p = (_1_p) + (1);
      }
      let _13_isFloat;
      _13_isFloat = false;
      if (((_1_p) < (_0_n)) && ((((s)[_1_p]).charCodeAt(0)) === (46))) {
        _13_isFloat = true;
        _1_p = (_1_p) + (1);
        while (((_1_p) < (_0_n)) && ((_this).IsDigit(((s)[_1_p]).charCodeAt(0)))) {
          _11_digitsSeen = (_11_digitsSeen) + (1);
          _1_p = (_1_p) + (1);
        }
      }
      if ((_11_digitsSeen) === (0)) {
        return value;
      }
      if (((_1_p) < (_0_n)) && (((((s)[_1_p]).charCodeAt(0)) === (101)) || ((((s)[_1_p]).charCodeAt(0)) === (69)))) {
        _13_isFloat = true;
        _1_p = (_1_p) + (1);
        if (((_1_p) < (_0_n)) && (((((s)[_1_p]).charCodeAt(0)) === (43)) || ((((s)[_1_p]).charCodeAt(0)) === (45)))) {
          _1_p = (_1_p) + (1);
        }
        let _14_exponentStart;
        _14_exponentStart = _1_p;
        while (((_1_p) < (_0_n)) && ((_this).IsDigit(((s)[_1_p]).charCodeAt(0)))) {
          _1_p = (_1_p) + (1);
        }
        if ((_1_p) === (_14_exponentStart)) {
          return value;
        }
      }
      if ((_1_p) === (_0_n)) {
        (_this).lastNumberIsFloat = _13_isFloat;
        if ((!(_13_isFloat)) && ((_11_digitsSeen) <= (15))) {
          if (_3_negative) {
            value = Native.__default.numberNegate(_12_accumulator);
          } else {
            value = _12_accumulator;
          }
        } else {
          value = Native.__default.parseNumber(s);
        }
      }
      return value;
    }
    ResolvePlain(from, to) {
      let _this = this;
      let value = undefined;
      if ((from) === (to)) {
        value = Native.__default.nullValue;
        return value;
      }
      let _0_c;
      _0_c = ((_this.src)[from]).charCodeAt(0);
      if (((((_this).IsDigit(_0_c)) || ((_0_c) === (45))) || ((_0_c) === (43))) || ((_0_c) === (46))) {
        let _1_number = undefined;
        let _out0;
        _out0 = (_this).TryNumber(from, to);
        _1_number = _out0;
        if (!(Native.__default.sameValue(_1_number, Native.__default.notNumericValue))) {
          value = _1_number;
          return value;
        }
      }
      let _2_text;
      _2_text = Native.__default.slice(_this.src, from, to);
      let _3_isNull = false;
      let _out1;
      _out1 = (_this).IsNullWord(_2_text);
      _3_isNull = _out1;
      if (_3_isNull) {
        value = Native.__default.nullValue;
        return value;
      }
      let _4_boolValue = undefined;
      let _out2;
      _out2 = (_this).IsBoolWord(_2_text);
      _4_boolValue = _out2;
      if (!(Native.__default.sameValue(_4_boolValue, Native.__default.notNumericValue))) {
        value = _4_boolValue;
        return value;
      }
      value = Native.__default.stringValue(_2_text);
      return value;
    }
    ResolvePlainText(text) {
      let _this = this;
      let value = undefined;
      if (_dafny.areEqual(text, "")) {
        value = Native.__default.nullValue;
        return value;
      }
      let _0_n;
      _0_n = Native.__default.stringLength(text);
      let _1_c;
      _1_c = ((text)[_dafny.ZERO]).charCodeAt(0);
      if (((((_this).IsDigit(_1_c)) || ((_1_c) === (45))) || ((_1_c) === (43))) || ((_1_c) === (46))) {
        let _2_number = undefined;
        let _out0;
        _out0 = (_this).TryNumberGeneric(text);
        _2_number = _out0;
        if (!(Native.__default.sameValue(_2_number, Native.__default.notNumericValue))) {
          value = _2_number;
          return value;
        }
      }
      let _3_isNull = false;
      let _out1;
      _out1 = (_this).IsNullWord(text);
      _3_isNull = _out1;
      if (_3_isNull) {
        value = Native.__default.nullValue;
        return value;
      }
      let _4_boolValue = undefined;
      let _out2;
      _out2 = (_this).IsBoolWord(text);
      _4_boolValue = _out2;
      if (!(Native.__default.sameValue(_4_boolValue, Native.__default.notNumericValue))) {
        value = _4_boolValue;
        return value;
      }
      value = Native.__default.stringValue(text);
      return value;
    }
    SkipInlineSpaces() {
      let _this = this;
      while (((_this.pos) < (_this.len)) && (((((_this.src)[_this.pos]).charCodeAt(0)) === (32)) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (9)))) {
        (_this).pos = (_this.pos) + (1);
      }
      return;
    }
    Fail(message) {
      let _this = this;
      if ((_this.pos) >= (_this.len)) {
        Native.__default.fail(Native.__default.concat(message, ": unexpected end of input"));
      }
      let _0_line;
      _0_line = 1;
      let _1_column;
      _1_column = 1;
      let _2_i;
      _2_i = 0;
      while ((_2_i) < (_this.pos)) {
        if ((((_this.src)[_2_i]).charCodeAt(0)) === (10)) {
          _0_line = (_0_line) + (1);
          _1_column = 1;
        } else {
          _1_column = (_1_column) + (1);
        }
        _2_i = (_2_i) + (1);
      }
      let _3_msg;
      _3_msg = Native.__default.concat(message, Native.__default.concat(" (line ", Native.__default._$$_toString(Native.__default.numberValue(_0_line))));
      _3_msg = Native.__default.concat(_3_msg, Native.__default.concat(", column ", Native.__default._$$_toString(Native.__default.numberValue(_1_column))));
      Native.__default.fail(Native.__default.concat(_3_msg, ")"));
      return;
    }
    SkipFlowWs() {
      let _this = this;
      (_this).flowWsCrossedLine = false;
      if ((_this.pos) >= (_this.len)) {
        return;
      }
      let _0_first;
      _0_first = ((_this.src)[_this.pos]).charCodeAt(0);
      if ((((((((_0_first) !== (32)) && ((_0_first) !== (9))) && ((_0_first) !== (10))) && ((_0_first) !== (13))) && ((_0_first) !== (35))) && ((_0_first) !== (45))) && ((_0_first) !== (46))) {
        return;
      }
      let _1_p;
      _1_p = _this.pos;
      let _2_lineHead;
      _2_lineHead = -1;
      let _3_badTab;
      _3_badTab = false;
      L3: {
        while ((_1_p) < (_this.len)) {
          C3: {
            let _4_c;
            _4_c = ((_this.src)[_1_p]).charCodeAt(0);
            if (((((_4_c) === (32)) || ((_4_c) === (9))) || ((_4_c) === (10))) || ((_4_c) === (13))) {
              if (((_4_c) === (10)) || ((_4_c) === (13))) {
                (_this).flowWsCrossedLine = true;
                (_this).flowSpanned = true;
                _2_lineHead = (_1_p) + (1);
                _3_badTab = false;
              } else if (((((_4_c) === (9)) && ((_2_lineHead) >= (0))) && ((_this.flowIndentFloor) >= (0))) && (((_1_p) - (_2_lineHead)) <= (_this.flowIndentFloor))) {
                _3_badTab = true;
              }
              _1_p = (_1_p) + (1);
              break C3;
            }
            if ((_4_c) === (35)) {
              if ((_1_p) > (0)) {
                let _5_prev;
                _5_prev = ((_this.src)[(_1_p) - (1)]).charCodeAt(0);
                if (((((_5_prev) !== (32)) && ((_5_prev) !== (9))) && ((_5_prev) !== (10))) && ((_5_prev) !== (13))) {
                  (_this).pos = _1_p;
                  (_this).Fail("a comment must be separated from other tokens by whitespace");
                }
              }
              let _6_nl;
              _6_nl = Native.__default.indexOf(_this.src, "\n", _1_p);
              if ((_6_nl) >= (0)) {
                (_this).flowWsCrossedLine = true;
                (_this).flowSpanned = true;
              }
              if ((_6_nl) < (0)) {
                _1_p = _this.len;
              } else {
                _1_p = (_6_nl) + (1);
              }
              _2_lineHead = _1_p;
              _3_badTab = false;
              break C3;
            }
            if ((((_4_c) === (45)) || ((_4_c) === (46))) && ((((_1_p) === (0)) || ((((_this.src)[(_1_p) - (1)]).charCodeAt(0)) === (10))) || ((((_this.src)[(_1_p) - (1)]).charCodeAt(0)) === (13)))) {
              let _7_marker = false;
              let _out0;
              _out0 = (_this).LooksLikeDocMarkerAt(_1_p);
              _7_marker = _out0;
              if (_7_marker) {
                (_this).pos = _1_p;
                (_this).Fail("a document marker is not allowed inside a flow collection");
              }
            }
            if ((((_2_lineHead) >= (0)) && ((_this.flowIndentFloor) >= (0))) && ((_3_badTab) || (((_1_p) - (_2_lineHead)) <= (_this.flowIndentFloor)))) {
              (_this).pos = _1_p;
              (_this).Fail("insufficient indentation for a multi-line flow collection");
            }
            break L3;
          }
        }
      }
      (_this).pos = _1_p;
      return;
    }
    ScanFlowPlainEnd() {
      let _this = this;
      let end = 0;
      if ((_this.pos) < (_this.len)) {
        let _0_initial;
        _0_initial = ((_this.src)[_this.pos]).charCodeAt(0);
        if ((((((_0_initial) === (37)) || ((_0_initial) === (64))) || ((_0_initial) === (96))) || ((_0_initial) === (124))) || ((_0_initial) === (62))) {
          (_this).Fail("a plain scalar cannot start with '%', '@', '`', '|', or '>'");
        }
      }
      (_this).hasFlowFolded = false;
      (_this).flowFolded = "";
      let _1_start;
      _1_start = _this.pos;
      let _2_firstStop = 0;
      let _out0;
      _out0 = (_this).ScanFlowPlainLine(_1_start);
      _2_firstStop = _out0;
      let _3_firstEnd = 0;
      let _out1;
      _out1 = (_this).TrimTrailingWs(_1_start, _2_firstStop);
      _3_firstEnd = _out1;
      if (((_2_firstStop) < (_this.len)) && (((((_this.src)[_2_firstStop]).charCodeAt(0)) === (10)) || ((((_this.src)[_2_firstStop]).charCodeAt(0)) === (13)))) {
        let _out2;
        _out2 = (_this).FoldFlowPlain(_1_start, _3_firstEnd, _2_firstStop);
        end = _out2;
      } else {
        (_this).pos = _2_firstStop;
        end = _3_firstEnd;
      }
      return end;
    }
    FoldFlowPlain(start, firstEnd, breakPos) {
      let _this = this;
      let lastEnd = 0;
      let _0_result;
      _0_result = "";
      let _1_folded;
      _1_folded = false;
      lastEnd = firstEnd;
      let _2_p;
      _2_p = breakPos;
      L4: {
        while (true) {
          C4: {
            let _3_breaks;
            _3_breaks = 0;
            let _4_q;
            _4_q = _2_p;
            L5: {
              while ((_4_q) < (_this.len)) {
                C5: {
                  let _5_c;
                  _5_c = ((_this.src)[_4_q]).charCodeAt(0);
                  if ((_5_c) === (10)) {
                    _4_q = (_4_q) + (1);
                    _3_breaks = (_3_breaks) + (1);
                  } else if ((_5_c) === (13)) {
                    _4_q = (_4_q) + (1);
                    if (((_4_q) < (_this.len)) && ((((_this.src)[_4_q]).charCodeAt(0)) === (10))) {
                      _4_q = (_4_q) + (1);
                    }
                    _3_breaks = (_3_breaks) + (1);
                  } else if (((_5_c) === (32)) || ((_5_c) === (9))) {
                    _4_q = (_4_q) + (1);
                  } else {
                    break L5;
                  }
                }
              }
            }
            let _6_continues;
            _6_continues = (_4_q) < (_this.len);
            if (_6_continues) {
              let _7_c;
              _7_c = ((_this.src)[_4_q]).charCodeAt(0);
              if (((((_7_c) === (44)) || ((_7_c) === (93))) || ((_7_c) === (125))) || ((_7_c) === (35))) {
                _6_continues = false;
              } else if ((_7_c) === (58)) {
                if (((_4_q) + (1)) === (_this.len)) {
                  _6_continues = false;
                } else {
                  let _8_next;
                  _8_next = ((_this.src)[(_4_q) + (1)]).charCodeAt(0);
                  if ((((((_8_next) === (32)) || ((_8_next) === (9))) || ((_8_next) === (10))) || ((_8_next) === (13))) || ((_this).FlowIndicator(_8_next))) {
                    _6_continues = false;
                  }
                }
              } else if (((_7_c) === (45)) || ((_7_c) === (46))) {
                let _9_marker;
                _9_marker = false;
                if (((_4_q) > (0)) && (((((_this.src)[(_4_q) - (1)]).charCodeAt(0)) === (10)) || ((((_this.src)[(_4_q) - (1)]).charCodeAt(0)) === (13)))) {
                  let _out0;
                  _out0 = (_this).LooksLikeDocMarkerAt(_4_q);
                  _9_marker = _out0;
                }
                if (_9_marker) {
                  _6_continues = false;
                }
              }
            }
            if (!(_6_continues)) {
              (_this).pos = _2_p;
              break L4;
            }
            if (!(_1_folded)) {
              _0_result = Native.__default.slice(_this.src, start, firstEnd);
              _1_folded = true;
              (_this).flowSpanned = true;
            }
            if ((_3_breaks) > (1)) {
              _0_result = Native.__default.concat(_0_result, Native.__default.repeat("\n", (_3_breaks) - (1)));
            } else {
              _0_result = Native.__default.concat(_0_result, " ");
            }
            let _10_segmentStop = 0;
            let _out1;
            _out1 = (_this).ScanFlowPlainLine(_4_q);
            _10_segmentStop = _out1;
            let _11_segmentEnd = 0;
            let _out2;
            _out2 = (_this).TrimTrailingWs(_4_q, _10_segmentStop);
            _11_segmentEnd = _out2;
            _0_result = Native.__default.concat(_0_result, Native.__default.slice(_this.src, _4_q, _11_segmentEnd));
            lastEnd = _11_segmentEnd;
            if (((_10_segmentStop) < (_this.len)) && (((((_this.src)[_10_segmentStop]).charCodeAt(0)) === (10)) || ((((_this.src)[_10_segmentStop]).charCodeAt(0)) === (13)))) {
              _2_p = _10_segmentStop;
              break C4;
            }
            (_this).pos = _10_segmentStop;
            (_this).flowFolded = _0_result;
            (_this).hasFlowFolded = true;
            return lastEnd;
          }
        }
      }
      if (_1_folded) {
        (_this).flowFolded = _0_result;
        (_this).hasFlowFolded = true;
      } else {
        lastEnd = firstEnd;
      }
      return lastEnd;
    }
    ParseFlowPlain() {
      let _this = this;
      let value = undefined;
      let _0_start;
      _0_start = _this.pos;
      let _1_end = 0;
      let _out0;
      _out0 = (_this).ScanFlowPlainEnd();
      _1_end = _out0;
      if ((_1_end) === (_0_start)) {
        (_this).Fail("expected a flow node");
      }
      if (_this.hasFlowFolded) {
        value = Native.__default.stringValue(_this.flowFolded);
      } else {
        let _out1;
        _out1 = (_this).ResolvePlain(_0_start, _1_end);
        value = _out1;
      }
      return value;
    }
    StringifyKeyScalar(text) {
      let _this = this;
      let rendered = "";
      let _0_n;
      _0_n = Native.__default.stringLength(text);
      if ((_0_n) === (0)) {
        rendered = Native.__default.jsonQuote(text);
        return rendered;
      }
      let _1_first;
      _1_first = ((text)[_dafny.ZERO]).charCodeAt(0);
      let _2_leading;
      _2_leading = (((((((((((((((((((_1_first) === (45)) || ((_1_first) === (63))) || ((_1_first) === (58))) || ((_1_first) === (44))) || ((_1_first) === (91))) || ((_1_first) === (93))) || ((_1_first) === (123))) || ((_1_first) === (125))) || ((_1_first) === (35))) || ((_1_first) === (38))) || ((_1_first) === (42))) || ((_1_first) === (33))) || ((_1_first) === (124))) || ((_1_first) === (62))) || ((_1_first) === (39))) || ((_1_first) === (34))) || ((_1_first) === (37))) || ((_1_first) === (64))) || ((_1_first) === (96));
      let _3_structural;
      _3_structural = ((((Native.__default.indexOf(text, ": ", 0)) >= (0)) || ((Native.__default.indexOf(text, " #", 0)) >= (0))) || ((Native.__default.indexOf(text, "\n", 0)) >= (0))) || (((text)[(_0_n) - (1)]) === (':'));
      let _4_nullWord = false;
      let _out0;
      _out0 = (_this).IsNullWord(text);
      _4_nullWord = _out0;
      let _5_boolWord = undefined;
      let _out1;
      _out1 = (_this).IsBoolWord(text);
      _5_boolWord = _out1;
      let _6_number = undefined;
      let _out2;
      _out2 = (_this).TryNumberGeneric(text);
      _6_number = _out2;
      let _7_retyped;
      _7_retyped = ((_4_nullWord) || (!(Native.__default.sameValue(_5_boolWord, Native.__default.notNumericValue)))) || (!(Native.__default.sameValue(_6_number, Native.__default.notNumericValue)));
      if (((_2_leading) || (_3_structural)) || (_7_retyped)) {
        rendered = Native.__default.jsonQuote(text);
      } else {
        rendered = text;
      }
      return rendered;
    }
    StringifyKeyValue(value) {
      let _this = this;
      let rendered = "";
      if (Native.__default.isNull(value)) {
        rendered = "null";
        return rendered;
      }
      if (Native.__default.isBoolean(value)) {
        let _0_boolean;
        _0_boolean = Native.__default.booleanValue(value);
        if (_0_boolean) {
          rendered = "true";
        } else {
          rendered = "false";
        }
        return rendered;
      }
      if (Native.__default.isNumber(value)) {
        rendered = Native.__default.formatNumber(value);
        return rendered;
      }
      if (Native.__default.isString(value)) {
        let _1_s;
        _1_s = Native.__default.stringValueOf(value);
        let _out0;
        _out0 = (_this).StringifyKeyScalar(_1_s);
        rendered = _out0;
        return rendered;
      }
      if (Native.__default.isObject(value)) {
        let _out1;
        _out1 = (_this).StringifyKeyNode(value);
        rendered = _out1;
        return rendered;
      }
      rendered = Native.__default.stringFallback(value);
      return rendered;
    }
    StringifyKeyArray(items, open, close) {
      let _this = this;
      let rendered = "";
      let _0_n = 0;
      let _out0;
      _out0 = Native.__default.arrayLength(items);
      _0_n = _out0;
      if ((_0_n) === (0)) {
        rendered = Native.__default.concat(open, close);
        return rendered;
      }
      rendered = Native.__default.concat(open, " ");
      let _1_i;
      _1_i = 0;
      while ((_1_i) < (_0_n)) {
        if ((_1_i) > (0)) {
          rendered = Native.__default.concat(rendered, ", ");
        }
        let _2_item = undefined;
        let _out1;
        _out1 = Native.__default.arrayGet(items, _1_i);
        _2_item = _out1;
        let _3_itemText = "";
        let _out2;
        _out2 = (_this).StringifyKeyValue(_2_item);
        _3_itemText = _out2;
        rendered = Native.__default.concat(rendered, _3_itemText);
        _1_i = (_1_i) + (1);
      }
      rendered = Native.__default.concat(rendered, Native.__default.concat(" ", close));
      return rendered;
    }
    StringifyKeyMapping(value, keys, nativeMap) {
      let _this = this;
      let rendered = "";
      let _0_n = 0;
      let _out0;
      _out0 = Native.__default.arrayLength(keys);
      _0_n = _out0;
      if ((_0_n) === (0)) {
        rendered = "{}";
        return rendered;
      }
      rendered = "{ ";
      let _1_i;
      _1_i = 0;
      while ((_1_i) < (_0_n)) {
        if ((_1_i) > (0)) {
          rendered = Native.__default.concat(rendered, ", ");
        }
        let _2_keyValue = undefined;
        let _out1;
        _out1 = Native.__default.arrayGet(keys, _1_i);
        _2_keyValue = _out1;
        let _3_keyText = "";
        if (Native.__default.isString(_2_keyValue)) {
          _3_keyText = Native.__default.stringValueOf(_2_keyValue);
        } else {
          let _out2;
          _out2 = (_this).KeyToString(_2_keyValue);
          _3_keyText = _out2;
        }
        let _4_safeKey;
        let _out3;
        _out3 = (_this).StringifyKeyScalar(_3_keyText);
        _4_safeKey = _out3;
        rendered = Native.__default.concat(rendered, Native.__default.concat(_4_safeKey, ": "));
        let _5_child = undefined;
        if (nativeMap) {
          let _6_nativeMapValue;
          _6_nativeMapValue = Native.__default.mapFromValue(value);
          let _out4;
          _out4 = Native.__default.mapGet(_6_nativeMapValue, _2_keyValue);
          _5_child = _out4;
        } else {
          if (Native.__default.isString(_2_keyValue)) {
            let _out5;
            _out5 = Native.__default.objectGet(value, Native.__default.stringValueOf(_2_keyValue));
            _5_child = _out5;
          } else {
            let _out6;
            _out6 = Native.__default.objectGet(value, _3_keyText);
            _5_child = _out6;
          }
        }
        let _7_childText = "";
        let _out7;
        _out7 = (_this).StringifyKeyValue(_5_child);
        _7_childText = _out7;
        rendered = Native.__default.concat(rendered, _7_childText);
        _1_i = (_1_i) + (1);
      }
      rendered = Native.__default.concat(rendered, " }");
      return rendered;
    }
    StringifyKeyNode(value) {
      let _this = this;
      let rendered = "";
      if (Native.__default.isArray(value)) {
        let _out0;
        _out0 = (_this).StringifyKeyArray(value, "[", "]");
        rendered = _out0;
        return rendered;
      }
      if (Native.__default.isUint8Array(value)) {
        let _0_bytes;
        let _out1;
        _out1 = Native.__default.createArray();
        _0_bytes = _out1;
        let _1_n = 0;
        _1_n = Native.__default.byteLength(value);
        let _2_i;
        _2_i = 0;
        while ((_2_i) < (_1_n)) {
          Native.__default.arrayPush(_0_bytes, Native.__default.numberValue(Native.__default.byteGet(value, _2_i)));
          _2_i = (_2_i) + (1);
        }
        let _out2;
        _out2 = (_this).StringifyKeyArray(_0_bytes, "[", "]");
        rendered = _out2;
        return rendered;
      }
      if (Native.__default.isSet(value)) {
        let _3_values = undefined;
        let _out3;
        _out3 = Native.__default.setValues(value);
        _3_values = _out3;
        let _out4;
        _out4 = (_this).StringifyKeyArray(_3_values, "[", "]");
        rendered = _out4;
        return rendered;
      }
      if (Native.__default.isMap(value)) {
        let _4_mapKeys = undefined;
        let _out5;
        _out5 = Native.__default.mapKeys(value);
        _4_mapKeys = _out5;
        let _out6;
        _out6 = (_this).StringifyKeyMapping(value, _4_mapKeys, true);
        rendered = _out6;
        return rendered;
      }
      let _5_keys = undefined;
      let _out7;
      _out7 = Native.__default.objectKeys(value);
      _5_keys = _out7;
      let _out8;
      _out8 = (_this).StringifyKeyMapping(value, _5_keys, false);
      rendered = _out8;
      return rendered;
    }
    FastMatchBlockKey(expected) {
      let _this = this;
      let matchedKey = false;
      matchedKey = false;
      if ((_this.pos) >= (_this.len)) {
        return matchedKey;
      }
      let _0_c;
      _0_c = ((_this.src)[_this.pos]).charCodeAt(0);
      if ((((((((_0_c) === (91)) || ((_0_c) === (123))) || ((_0_c) === (34))) || ((_0_c) === (39))) || ((_0_c) === (38))) || ((_0_c) === (42))) || ((_0_c) === (33))) {
        return matchedKey;
      }
      let _1_n;
      _1_n = Native.__default.stringLength(expected);
      if (((_this.pos) + (_1_n)) >= (_this.len)) {
        return matchedKey;
      }
      let _2_i;
      _2_i = 0;
      while ((_2_i) < (_1_n)) {
        if ((((_this.src)[(_this.pos) + (_2_i)]).charCodeAt(0)) !== (((expected)[_2_i]).charCodeAt(0))) {
          return matchedKey;
        }
        _2_i = (_2_i) + (1);
      }
      if ((((_this.src)[(_this.pos) + (_1_n)]).charCodeAt(0)) !== (58)) {
        return matchedKey;
      }
      let _3_separator = false;
      let _out0;
      _out0 = (_this).IsSpaceOrEolAt(((_this.pos) + (_1_n)) + (1));
      _3_separator = _out0;
      if (!(_3_separator)) {
        return matchedKey;
      }
      (_this).pos = (_this.pos) + (_1_n);
      matchedKey = true;
      return matchedKey;
    }
    KeyToString(value) {
      let _this = this;
      let key = "";
      if (Native.__default.isString(value)) {
        key = Native.__default.stringValueOf(value);
        return key;
      }
      if (Native.__default.isNull(value)) {
        key = "";
        return key;
      }
      if (Native.__default.isObject(value)) {
        let _out0;
        _out0 = (_this).StringifyKeyNode(value);
        key = _out0;
        return key;
      }
      key = Native.__default.stringFallback(value);
      return key;
    }
    InternNodeKey(value) {
      let _this = this;
      let key = "";
      let _out0;
      _out0 = (_this).KeyToString(value);
      key = _out0;
      let _out1;
      _out1 = (_this).InternKey(key);
      key = _out1;
      return key;
    }
    InternKey(text) {
      let _this = this;
      let key = "";
      let _0_value;
      _0_value = Native.__default.stringValue(text);
      let _1_present = false;
      let _out0;
      _out0 = Native.__default.mapHas(_this.keyCache, _0_value);
      _1_present = _out0;
      if (_1_present) {
        let _2_cached = undefined;
        let _out1;
        _out1 = Native.__default.mapGet(_this.keyCache, _0_value);
        _2_cached = _out1;
        key = Native.__default.stringValueOf(_2_cached);
        return key;
      }
      let _3_bytes;
      _3_bytes = Native.__default.numberMulAdd(Native.__default.numberValue(Native.__default.stringLength(text)), 2, 0);
      let _4_total;
      _4_total = Native.__default.numberAdd(_this.keyCacheBytes, _3_bytes);
      let _5_withinBudget = false;
      _5_withinBudget = Native.__default.numberLessEqual(_4_total, _this.keyCacheMaxBytes);
      if (_5_withinBudget) {
        Native.__default.mapSet(_this.keyCache, _0_value, _0_value);
        (_this).keyCacheBytes = _4_total;
      }
      key = text;
      return key;
    }
    StoreKey(target, key, value) {
      let _this = this;
      Native.__default.objectSetSafe(target, key, value);
      return;
    }
    NumberBoundary(at) {
      let _this = this;
      let yes = false;
      if ((at) >= (_this.len)) {
        yes = true;
        return yes;
      }
      let _0_c;
      _0_c = ((_this.src)[at]).charCodeAt(0);
      if ((((((_0_c) === (44)) || ((_0_c) === (93))) || ((_0_c) === (125))) || ((_0_c) === (10))) || ((_0_c) === (13))) {
        yes = true;
        return yes;
      }
      if (((_0_c) === (32)) || ((_0_c) === (9))) {
        let _1_q;
        _1_q = (at) + (1);
        while (((_1_q) < (_this.len)) && (((((_this.src)[_1_q]).charCodeAt(0)) === (32)) || ((((_this.src)[_1_q]).charCodeAt(0)) === (9)))) {
          _1_q = (_1_q) + (1);
        }
        if ((_1_q) >= (_this.len)) {
          yes = true;
          return yes;
        }
        let _2_next;
        _2_next = ((_this.src)[_1_q]).charCodeAt(0);
        yes = (((((((_2_next) === (44)) || ((_2_next) === (93))) || ((_2_next) === (125))) || ((_2_next) === (10))) || ((_2_next) === (13))) || ((_2_next) === (35))) || ((_2_next) === (58));
        return yes;
      }
      if ((_0_c) === (58)) {
        if (((at) + (1)) >= (_this.len)) {
          yes = true;
          return yes;
        }
        let _3_next;
        _3_next = ((_this.src)[(at) + (1)]).charCodeAt(0);
        yes = (((((_3_next) === (32)) || ((_3_next) === (9))) || ((_3_next) === (10))) || ((_3_next) === (13))) || ((_this).FlowIndicator(_3_next));
        return yes;
      }
      yes = false;
      return yes;
    }
    TryFlowNumber() {
      let _this = this;
      let value = undefined;
      value = Native.__default.notNumericValue;
      let _0_start;
      _0_start = _this.pos;
      let _1_p;
      _1_p = _0_start;
      let _2_c;
      _2_c = ((_this.src)[_1_p]).charCodeAt(0);
      let _3_negative;
      _3_negative = (_2_c) === (45);
      let _4_signed;
      _4_signed = (_3_negative) || ((_2_c) === (43));
      if (_4_signed) {
        _1_p = (_1_p) + (1);
        if ((_1_p) >= (_this.len)) {
          return value;
        }
        _2_c = ((_this.src)[_1_p]).charCodeAt(0);
      }
      if ((!(_4_signed)) && ((_2_c) === (48))) {
        let _5_base;
        if (((_1_p) + (1)) < (_this.len)) {
          _5_base = ((_this.src)[(_1_p) + (1)]).charCodeAt(0);
        } else {
          _5_base = -1;
        }
        if (((_5_base) === (120)) || ((_5_base) === (111))) {
          _1_p = (_1_p) + (2);
          let _6_digits;
          _6_digits = _1_p;
          let _7_accumulator;
          _7_accumulator = Native.__default.numberValue(0);
          let _8_radix;
          if ((_5_base) === (120)) {
            _8_radix = 16;
          } else {
            _8_radix = 8;
          }
          L6: {
            while ((_1_p) < (_this.len)) {
              C6: {
                let _9_ch;
                _9_ch = ((_this.src)[_1_p]).charCodeAt(0);
                let _10_digit = 0;
                if ((_5_base) === (120)) {
                  if ((_this).IsDigit(_9_ch)) {
                    _10_digit = (_9_ch) - (48);
                  } else if (((65) <= (_9_ch)) && ((_9_ch) < (71))) {
                    _10_digit = (_9_ch) - (55);
                  } else if (((97) <= (_9_ch)) && ((_9_ch) < (103))) {
                    _10_digit = (_9_ch) - (87);
                  } else {
                    _10_digit = -1;
                  }
                } else if (((48) <= (_9_ch)) && ((_9_ch) < (56))) {
                  _10_digit = (_9_ch) - (48);
                } else {
                  _10_digit = -1;
                }
                if ((_10_digit) < (0)) {
                  break L6;
                }
                _7_accumulator = Native.__default.numberMulAdd(_7_accumulator, _8_radix, _10_digit);
                _1_p = (_1_p) + (1);
              }
            }
          }
          let _11_boundary = false;
          let _out0;
          _out0 = (_this).NumberBoundary(_1_p);
          _11_boundary = _out0;
          if (((_1_p) > (_6_digits)) && (_11_boundary)) {
            (_this).pos = _1_p;
            value = _7_accumulator;
          }
          return value;
        }
      }
      if (((_2_c) === (46)) && (((_1_p) + (3)) < (_this.len))) {
        let _12_a;
        _12_a = ((_this.src)[(_1_p) + (1)]).charCodeAt(0);
        let _13_b;
        _13_b = ((_this.src)[(_1_p) + (2)]).charCodeAt(0);
        let _14_d;
        _14_d = ((_this.src)[(_1_p) + (3)]).charCodeAt(0);
        let _15_inf;
        _15_inf = (((((_12_a) === (105)) && ((_13_b) === (110))) && ((_14_d) === (102))) || ((((_12_a) === (73)) && ((_13_b) === (110))) && ((_14_d) === (102)))) || ((((_12_a) === (73)) && ((_13_b) === (78))) && ((_14_d) === (70)));
        let _16_nan;
        _16_nan = (((((_12_a) === (110)) && ((_13_b) === (97))) && ((_14_d) === (110))) || ((((_12_a) === (78)) && ((_13_b) === (97))) && ((_14_d) === (78)))) || ((((_12_a) === (78)) && ((_13_b) === (65))) && ((_14_d) === (78)));
        let _17_boundary = false;
        let _out1;
        _out1 = (_this).NumberBoundary((_1_p) + (4));
        _17_boundary = _out1;
        if ((_15_inf) && (_17_boundary)) {
          (_this).pos = (_1_p) + (4);
          value = Native.__default.parseSpecialNumber(((_3_negative) ? ("-Infinity") : ("Infinity")));
          return value;
        }
        if (((!(_4_signed)) && (_16_nan)) && (_17_boundary)) {
          (_this).pos = (_1_p) + (4);
          value = Native.__default.parseSpecialNumber("NaN");
          return value;
        }
      }
      let _18_digitsSeen;
      _18_digitsSeen = 0;
      let _19_accumulator;
      _19_accumulator = Native.__default.numberValue(0);
      while (((_1_p) < (_this.len)) && ((_this).IsDigit(((_this.src)[_1_p]).charCodeAt(0)))) {
        _19_accumulator = Native.__default.numberMulAdd(_19_accumulator, 10, (((_this.src)[_1_p]).charCodeAt(0)) - (48));
        _18_digitsSeen = (_18_digitsSeen) + (1);
        _1_p = (_1_p) + (1);
      }
      let _20_isFloat;
      _20_isFloat = false;
      if (((_1_p) < (_this.len)) && ((((_this.src)[_1_p]).charCodeAt(0)) === (46))) {
        _20_isFloat = true;
        _1_p = (_1_p) + (1);
        while (((_1_p) < (_this.len)) && ((_this).IsDigit(((_this.src)[_1_p]).charCodeAt(0)))) {
          _18_digitsSeen = (_18_digitsSeen) + (1);
          _1_p = (_1_p) + (1);
        }
      }
      if ((_18_digitsSeen) === (0)) {
        return value;
      }
      if (((_1_p) < (_this.len)) && (((((_this.src)[_1_p]).charCodeAt(0)) === (101)) || ((((_this.src)[_1_p]).charCodeAt(0)) === (69)))) {
        _20_isFloat = true;
        _1_p = (_1_p) + (1);
        if (((_1_p) < (_this.len)) && (((((_this.src)[_1_p]).charCodeAt(0)) === (43)) || ((((_this.src)[_1_p]).charCodeAt(0)) === (45)))) {
          _1_p = (_1_p) + (1);
        }
        let _21_exponentStart;
        _21_exponentStart = _1_p;
        while (((_1_p) < (_this.len)) && ((_this).IsDigit(((_this.src)[_1_p]).charCodeAt(0)))) {
          _1_p = (_1_p) + (1);
        }
        if ((_1_p) === (_21_exponentStart)) {
          return value;
        }
      }
      let _22_boundary = false;
      let _out2;
      _out2 = (_this).NumberBoundary(_1_p);
      _22_boundary = _out2;
      if (!(_22_boundary)) {
        return value;
      }
      (_this).pos = _1_p;
      if ((!(_20_isFloat)) && ((_18_digitsSeen) <= (15))) {
        if (_3_negative) {
          value = Native.__default.numberNegate(_19_accumulator);
        } else {
          value = _19_accumulator;
        }
      } else {
        value = Native.__default.parseNumber(Native.__default.slice(_this.src, _0_start, _1_p));
      }
      return value;
    }
    ParseFlowValue() {
      let _this = this;
      let value = undefined;
      if ((_this.pos) >= (_this.len)) {
        (_this).Fail("expected a flow node");
      }
      let _0_c;
      _0_c = ((_this.src)[_this.pos]).charCodeAt(0);
      if ((_0_c) === (123)) {
        let _out0;
        _out0 = (_this).ParseFlowMap();
        value = _out0;
        return value;
      }
      if ((_0_c) === (91)) {
        let _out1;
        _out1 = (_this).ParseFlowSeq();
        value = _out1;
        return value;
      }
      if ((_0_c) === (34)) {
        let _out2;
        _out2 = (_this).ParseDoubleQuoted();
        value = _out2;
        return value;
      }
      if ((_0_c) === (39)) {
        let _out3;
        _out3 = (_this).ParseSingleQuoted();
        value = _out3;
        return value;
      }
      if ((_0_c) === (38)) {
        let _out4;
        _out4 = (_this).ParseAnchoredFlowValue();
        value = _out4;
        return value;
      }
      if ((_0_c) === (33)) {
        let _out5;
        _out5 = (_this).ParseTaggedFlowValue();
        value = _out5;
        return value;
      }
      if ((_0_c) === (42)) {
        let _out6;
        _out6 = (_this).ParseAlias();
        value = _out6;
        return value;
      }
      if (((((_this).IsDigit(_0_c)) || ((_0_c) === (45))) || ((_0_c) === (43))) || ((_0_c) === (46))) {
        let _1_numericStart;
        _1_numericStart = _this.pos;
        let _2_number;
        let _out7;
        _out7 = (_this).TryFlowNumber();
        _2_number = _out7;
        if (!(Native.__default.sameValue(_2_number, Native.__default.notNumericValue))) {
          value = _2_number;
          return value;
        }
        if ((_0_c) === (45)) {
          let _3_dashSeparator = false;
          let _out8;
          _out8 = (_this).FlowSeparatorAt((_this.pos) + (1));
          _3_dashSeparator = _out8;
          if (_3_dashSeparator) {
            (_this).Fail("a block sequence '-' indicator is not allowed in a flow collection");
          }
        }
        (_this).pos = _1_numericStart;
      }
      let _out9;
      _out9 = (_this).ParseFlowPlain();
      value = _out9;
      return value;
    }
    ParseFlowKey() {
      let _this = this;
      let key = "";
      if ((_this.pos) >= (_this.len)) {
        (_this).Fail("expected a mapping key");
      }
      let _0_c;
      _0_c = ((_this.src)[_this.pos]).charCodeAt(0);
      if ((_0_c) === (38)) {
        let _out0;
        _out0 = (_this).ParseFlowKeyAnchored();
        key = _out0;
        return key;
      }
      if ((_0_c) === (33)) {
        let _out1;
        _out1 = (_this).ParseFlowKeyTagged();
        key = _out1;
        return key;
      }
      if ((_0_c) === (42)) {
        let _1_alias = undefined;
        let _out2;
        _out2 = (_this).ParseAlias();
        _1_alias = _out2;
        let _2_aliasKey = "";
        let _out3;
        _out3 = (_this).KeyToString(_1_alias);
        _2_aliasKey = _out3;
        let _out4;
        _out4 = (_this).InternKey(_2_aliasKey);
        key = _out4;
        return key;
      }
      if ((_0_c) === (34)) {
        let _3_quoted = undefined;
        let _out5;
        _out5 = (_this).ParseDoubleQuoted();
        _3_quoted = _out5;
        let _out6;
        _out6 = (_this).InternKey(Native.__default.stringValueOf(_3_quoted));
        key = _out6;
        return key;
      }
      if ((_0_c) === (39)) {
        let _4_quoted = undefined;
        let _out7;
        _out7 = (_this).ParseSingleQuoted();
        _4_quoted = _out7;
        let _out8;
        _out8 = (_this).InternKey(Native.__default.stringValueOf(_4_quoted));
        key = _out8;
        return key;
      }
      let _5_start;
      _5_start = _this.pos;
      let _6_end = 0;
      let _out9;
      _out9 = (_this).ScanFlowPlainEnd();
      _6_end = _out9;
      if (_this.hasFlowFolded) {
        let _out10;
        _out10 = (_this).InternKey(_this.flowFolded);
        key = _out10;
        return key;
      }
      if ((_6_end) === (_5_start)) {
        (_this).Fail("expected a mapping key");
      }
      let _7_plainKey;
      let _out11;
      _out11 = (_this).ResolvePlain(_5_start, _6_end);
      _7_plainKey = _out11;
      (_this).RegisterPendingAnchor(_7_plainKey);
      let _8_resolvedKey = "";
      let _out12;
      _out12 = (_this).KeyToString(_7_plainKey);
      _8_resolvedKey = _out12;
      let _out13;
      _out13 = (_this).InternKey(_8_resolvedKey);
      key = _out13;
      return key;
    }
    ParseFlowKeyAnchored() {
      let _this = this;
      let key = "";
      (_this).pos = (_this.pos) + (1);
      let _0_name = "";
      let _out0;
      _out0 = (_this).ScanAnchorOrAliasName();
      _0_name = _out0;
      (_this).SkipFlowWs();
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (38))) {
        (_this).Fail("a node may carry at most one anchor");
      }
      let _1_tag;
      _1_tag = "";
      let _2_hasTag;
      _2_hasTag = false;
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (33))) {
        let _out1;
        _out1 = (_this).ScanTag();
        _1_tag = _out1;
        (_this).CheckTagSeparator(true);
        _2_hasTag = true;
        (_this).SkipFlowWs();
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (33))) {
          (_this).Fail("a node may carry at most one tag");
        }
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (38))) {
          (_this).Fail("a node may carry at most one anchor");
        }
      }
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (42))) {
        (_this).Fail("an alias node cannot carry an anchor property");
      }
      let _3_savedName;
      _3_savedName = _this.pendingAnchorName;
      let _4_savedHasName;
      _4_savedHasName = _this.hasPendingAnchorName;
      (_this).pendingAnchorName = _0_name;
      (_this).hasPendingAnchorName = true;
      let _5_raw = undefined;
      if (_2_hasTag) {
        let _out2;
        _out2 = (_this).ParseTaggedFlowKeyRaw(_1_tag);
        _5_raw = _out2;
        (_this).RegisterPendingAnchor(_5_raw);
        let _6_taggedKey = "";
        let _out3;
        _out3 = (_this).KeyToString(_5_raw);
        _6_taggedKey = _out3;
        let _out4;
        _out4 = (_this).InternKey(_6_taggedKey);
        key = _out4;
      } else if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (34))) {
        let _out5;
        _out5 = (_this).ParseDoubleQuoted();
        _5_raw = _out5;
        (_this).RegisterPendingAnchor(_5_raw);
        let _7_quotedKey = "";
        let _out6;
        _out6 = (_this).KeyToString(_5_raw);
        _7_quotedKey = _out6;
        let _out7;
        _out7 = (_this).InternKey(_7_quotedKey);
        key = _out7;
      } else if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (39))) {
        let _out8;
        _out8 = (_this).ParseSingleQuoted();
        _5_raw = _out8;
        (_this).RegisterPendingAnchor(_5_raw);
        let _8_singleQuotedKey = "";
        let _out9;
        _out9 = (_this).KeyToString(_5_raw);
        _8_singleQuotedKey = _out9;
        let _out10;
        _out10 = (_this).InternKey(_8_singleQuotedKey);
        key = _out10;
      } else {
        let _9_start;
        _9_start = _this.pos;
        let _10_end = 0;
        let _out11;
        _out11 = (_this).ScanFlowPlainEnd();
        _10_end = _out11;
        if (_this.hasFlowFolded) {
          _5_raw = Native.__default.stringValue(_this.flowFolded);
          (_this).RegisterPendingAnchor(_5_raw);
          let _11_foldedKey = "";
          let _out12;
          _out12 = (_this).KeyToString(_5_raw);
          _11_foldedKey = _out12;
          let _out13;
          _out13 = (_this).InternKey(_11_foldedKey);
          key = _out13;
        } else {
          if ((_10_end) === (_9_start)) {
            (_this).Fail("expected a mapping key");
          }
          let _out14;
          _out14 = (_this).ResolvePlain(_9_start, _10_end);
          _5_raw = _out14;
          (_this).RegisterPendingAnchor(_5_raw);
          let _12_resolvedKey = "";
          let _out15;
          _out15 = (_this).KeyToString(_5_raw);
          _12_resolvedKey = _out15;
          let _out16;
          _out16 = (_this).InternKey(_12_resolvedKey);
          key = _out16;
        }
      }
      (_this).pendingAnchorName = _3_savedName;
      (_this).hasPendingAnchorName = _4_savedHasName;
      return key;
    }
    ParseFlowKeyTagged() {
      let _this = this;
      let key = "";
      let _0_tag = "";
      let _out0;
      _out0 = (_this).ScanTag();
      _0_tag = _out0;
      (_this).CheckTagSeparator(true);
      (_this).SkipFlowWs();
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (33))) {
        (_this).Fail("a node may carry at most one tag");
      }
      let _1_anchorName;
      _1_anchorName = "";
      let _2_touched;
      _2_touched = false;
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (38))) {
        (_this).pos = (_this.pos) + (1);
        let _out1;
        _out1 = (_this).ScanAnchorOrAliasName();
        _1_anchorName = _out1;
        _2_touched = true;
        (_this).SkipFlowWs();
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (38))) {
          (_this).Fail("a node may carry at most one anchor");
        }
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (33))) {
          (_this).Fail("a node may carry at most one tag");
        }
      }
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (42))) {
        (_this).Fail("an alias node cannot carry a tag/anchor property");
      }
      let _3_savedName;
      _3_savedName = _this.pendingAnchorName;
      let _4_savedHasName;
      _4_savedHasName = _this.hasPendingAnchorName;
      if (_2_touched) {
        (_this).pendingAnchorName = _1_anchorName;
        (_this).hasPendingAnchorName = true;
      }
      let _5_raw = undefined;
      let _out2;
      _out2 = (_this).ParseTaggedFlowKeyRaw(_0_tag);
      _5_raw = _out2;
      if (_2_touched) {
        (_this).RegisterPendingAnchor(_5_raw);
        (_this).pendingAnchorName = _3_savedName;
        (_this).hasPendingAnchorName = _4_savedHasName;
      }
      let _6_taggedKey = "";
      let _out3;
      _out3 = (_this).KeyToString(_5_raw);
      _6_taggedKey = _out3;
      let _out4;
      _out4 = (_this).InternKey(_6_taggedKey);
      key = _out4;
      return key;
    }
    ParseTaggedFlowKeyRaw(tag) {
      let _this = this;
      let value = undefined;
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (34))) {
        let _0_quoted = undefined;
        let _out0;
        _out0 = (_this).ParseDoubleQuoted();
        _0_quoted = _out0;
        let _out1;
        _out1 = (_this).ApplyScalarTag(tag, Native.__default.stringValueOf(_0_quoted));
        value = _out1;
        return value;
      }
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (39))) {
        let _1_quoted = undefined;
        let _out2;
        _out2 = (_this).ParseSingleQuoted();
        _1_quoted = _out2;
        let _out3;
        _out3 = (_this).ApplyScalarTag(tag, Native.__default.stringValueOf(_1_quoted));
        value = _out3;
        return value;
      }
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (123))) {
        let _2_mapping = undefined;
        let _out4;
        _out4 = (_this).ParseFlowMap();
        _2_mapping = _out4;
        let _out5;
        _out5 = (_this).ApplyCollectionTag(tag, _2_mapping, "map");
        value = _out5;
        return value;
      }
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (91))) {
        let _3_sequence = undefined;
        let _out6;
        _out6 = (_this).ParseFlowSeq();
        _3_sequence = _out6;
        let _out7;
        _out7 = (_this).ApplyCollectionTag(tag, _3_sequence, "seq");
        value = _out7;
        return value;
      }
      let _4_separator;
      _4_separator = (_this.pos) >= (_this.len);
      if ((_this.pos) < (_this.len)) {
        let _out8;
        _out8 = (_this).FlowSeparatorAt(_this.pos);
        _4_separator = _out8;
      }
      if (_4_separator) {
        let _out9;
        _out9 = (_this).ApplyScalarTag(tag, "");
        value = _out9;
        return value;
      }
      let _5_start;
      _5_start = _this.pos;
      let _6_end = 0;
      let _out10;
      _out10 = (_this).ScanFlowPlainEnd();
      _6_end = _out10;
      let _7_raw;
      if (_this.hasFlowFolded) {
        _7_raw = _this.flowFolded;
      } else {
        _7_raw = Native.__default.slice(_this.src, _5_start, _6_end);
      }
      if (!(_this.hasFlowFolded)) {
        (_this).pos = _6_end;
      }
      let _out11;
      _out11 = (_this).ApplyScalarTag(tag, _7_raw);
      value = _out11;
      return value;
    }
    ScanAnchorOrAliasName() {
      let _this = this;
      let name = "";
      let _0_start;
      _0_start = _this.pos;
      L7: {
        while ((_this.pos) < (_this.len)) {
          C7: {
            let _1_c;
            _1_c = ((_this.src)[_this.pos]).charCodeAt(0);
            if ((((((_1_c) === (32)) || ((_1_c) === (9))) || ((_1_c) === (10))) || ((_1_c) === (13))) || ((_this).FlowIndicator(_1_c))) {
              break L7;
            }
            (_this).pos = (_this.pos) + (1);
          }
        }
      }
      if ((_this.pos) === (_0_start)) {
        (_this).Fail("anchor or alias name cannot be empty");
      }
      name = Native.__default.slice(_this.src, _0_start, _this.pos);
      return name;
    }
    RegisterPendingAnchor(value) {
      let _this = this;
      if (_this.hasPendingAnchorName) {
        if (!(_this.hasAnchorMap)) {
          let _0_newAnchors;
          let _out0;
          _out0 = Native.__default.mapCreate();
          _0_newAnchors = _out0;
          (_this).anchorMap = Native.__default.mapValue(_0_newAnchors);
          (_this).hasAnchorMap = true;
        }
        let _1_name;
        _1_name = Native.__default.stringValue(_this.pendingAnchorName);
        let _2_anchors;
        _2_anchors = Native.__default.mapFromValue(_this.anchorMap);
        Native.__default.mapSet(_2_anchors, _1_name, value);
        (_this).hasPendingAnchorName = false;
      }
      return;
    }
    ParseAlias() {
      let _this = this;
      let value = undefined;
      (_this).pos = (_this.pos) + (1);
      let _0_name = "";
      let _out0;
      _out0 = (_this).ScanAnchorOrAliasName();
      _0_name = _out0;
      (_this).SkipInlineSpaces();
      if (!(_this.hasAnchorMap)) {
        (_this).Fail(Native.__default.concat("unresolved alias '*", Native.__default.concat(_0_name, "' (no matching anchor)")));
      }
      let _1_key;
      _1_key = Native.__default.stringValue(_0_name);
      let _2_anchors;
      _2_anchors = Native.__default.mapFromValue(_this.anchorMap);
      let _3_found = false;
      let _out1;
      _out1 = Native.__default.mapHas(_2_anchors, _1_key);
      _3_found = _out1;
      if (!(_3_found)) {
        (_this).Fail(Native.__default.concat("unresolved alias '*", Native.__default.concat(_0_name, "' (no matching anchor)")));
      }
      let _out2;
      _out2 = Native.__default.mapGet(_2_anchors, _1_key);
      value = _out2;
      return value;
    }
    IsTagWordChar(c) {
      let _this = this;
      let yes = false;
      yes = ((((_this).IsDigit(c)) || (((65) <= (c)) && ((c) < (91)))) || (((97) <= (c)) && ((c) < (123)))) || ((c) === (45));
      return yes;
    }
    IsTagSuffixChar(c) {
      let _this = this;
      let yes = false;
      yes = (((((((c) !== (32)) && ((c) !== (9))) && ((c) !== (10))) && ((c) !== (13))) && ((c) >= (32))) && ((c) !== (33))) && (!((_this).FlowIndicator(c)));
      return yes;
    }
    ScanTagSuffixRaw() {
      let _this = this;
      let suffix = "";
      let _0_start;
      _0_start = _this.pos;
      L8: {
        while ((_this.pos) < (_this.len)) {
          C8: {
            let _1_c;
            _1_c = ((_this.src)[_this.pos]).charCodeAt(0);
            let _2_valid = false;
            let _out0;
            _out0 = (_this).IsTagSuffixChar(_1_c);
            _2_valid = _out0;
            if (!(_2_valid)) {
              break L8;
            }
            (_this).pos = (_this.pos) + (1);
          }
        }
      }
      suffix = Native.__default.slice(_this.src, _0_start, _this.pos);
      return suffix;
    }
    HexDigit(c) {
      let _this = this;
      let value = 0;
      if (((48) <= (c)) && ((c) < (58))) {
        value = (c) - (48);
        return value;
      }
      if (((97) <= (c)) && ((c) < (103))) {
        value = (c) - (87);
        return value;
      }
      if (((65) <= (c)) && ((c) < (71))) {
        value = (c) - (55);
        return value;
      }
      value = -1;
      return value;
    }
    DecodeTagPercent(s) {
      let _this = this;
      let decoded = "";
      let _0_lenS;
      _0_lenS = Native.__default.stringLength(s);
      let _1_percent = 0;
      _1_percent = Native.__default.indexOf(s, "%", 0);
      if ((_1_percent) < (0)) {
        decoded = s;
        return decoded;
      }
      decoded = "";
      let _2_seg;
      _2_seg = 0;
      let _3_i;
      _3_i = 0;
      while ((_3_i) < (_0_lenS)) {
        if ((((s)[_3_i]).charCodeAt(0)) === (37)) {
          if (((_3_i) + (2)) >= (_0_lenS)) {
            (_this).Fail("malformed '%' escape in a tag");
          }
          let _4_hi = 0;
          let _5_lo = 0;
          let _out0;
          _out0 = (_this).HexDigit(((s)[(_3_i) + (1)]).charCodeAt(0));
          _4_hi = _out0;
          let _out1;
          _out1 = (_this).HexDigit(((s)[(_3_i) + (2)]).charCodeAt(0));
          _5_lo = _out1;
          if (((_4_hi) < (0)) || ((_5_lo) < (0))) {
            (_this).Fail("malformed '%' escape in a tag");
          }
          decoded = Native.__default.concat(decoded, Native.__default.slice(s, _2_seg, _3_i));
          decoded = Native.__default.concat(decoded, Native.__default.stringFromCharCode(((_4_hi) * (16)) + (_5_lo)));
          _3_i = (_3_i) + (3);
          _2_seg = _3_i;
        } else {
          _3_i = (_3_i) + (1);
        }
      }
      decoded = Native.__default.concat(decoded, Native.__default.slice(s, _2_seg, _0_lenS));
      return decoded;
    }
    ScanTag() {
      let _this = this;
      let tag = "";
      (_this).pos = (_this.pos) + (1);
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (60))) {
        (_this).pos = (_this.pos) + (1);
        let _0_start;
        _0_start = _this.pos;
        let _1_gt = 0;
        _1_gt = Native.__default.indexOf(_this.src, ">", _this.pos);
        if ((_1_gt) < (0)) {
          (_this).Fail("unterminated verbatim tag: missing '>'");
        }
        if ((_1_gt) === (_this.pos)) {
          (_this).Fail("a verbatim tag ('!<...>') must not be empty");
        }
        let _2_end;
        _2_end = _1_gt;
        tag = Native.__default.slice(_this.src, _0_start, _2_end);
        (_this).pos = (_2_end) + (1);
        return tag;
      }
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (33))) {
        (_this).pos = (_this.pos) + (1);
        let _3_suffix = "";
        let _out0;
        _out0 = (_this).ScanTagSuffixRaw();
        _3_suffix = _out0;
        let _4_key;
        _4_key = Native.__default.stringValue("!!");
        let _5_custom;
        _5_custom = false;
        let _6_tags;
        _6_tags = Native.__default.mapFromValue(_this.tagHandles);
        if (_this.hasTagHandles) {
          let _out1;
          _out1 = Native.__default.mapHas(_6_tags, _4_key);
          _5_custom = _out1;
        }
        let _7_prefix;
        _7_prefix = "tag:yaml.org,2002:";
        if (_5_custom) {
          let _8_prefixValue = undefined;
          let _out2;
          _out2 = Native.__default.mapGet(_6_tags, _4_key);
          _8_prefixValue = _out2;
          _7_prefix = Native.__default.stringValueOf(_8_prefixValue);
        }
        let _9_decoded;
        let _out3;
        _out3 = (_this).DecodeTagPercent(_3_suffix);
        _9_decoded = _out3;
        tag = Native.__default.concat(_7_prefix, _9_decoded);
        return tag;
      }
      let _10_wordStart;
      _10_wordStart = _this.pos;
      L9: {
        while ((_this.pos) < (_this.len)) {
          C9: {
            let _11_c;
            _11_c = ((_this.src)[_this.pos]).charCodeAt(0);
            let _12_word = false;
            let _out4;
            _out4 = (_this).IsTagWordChar(_11_c);
            _12_word = _out4;
            if (!(_12_word)) {
              break L9;
            }
            (_this).pos = (_this.pos) + (1);
          }
        }
      }
      if ((((_this.pos) > (_10_wordStart)) && ((_this.pos) < (_this.len))) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (33))) {
        let _13_handle;
        _13_handle = Native.__default.concat("!", Native.__default.concat(Native.__default.slice(_this.src, _10_wordStart, _this.pos), "!"));
        (_this).pos = (_this.pos) + (1);
        let _14_suffix = "";
        let _out5;
        _out5 = (_this).ScanTagSuffixRaw();
        _14_suffix = _out5;
        let _15_key;
        _15_key = Native.__default.stringValue(_13_handle);
        let _16_found;
        _16_found = false;
        let _17_tags;
        _17_tags = Native.__default.mapFromValue(_this.tagHandles);
        if (_this.hasTagHandles) {
          let _out6;
          _out6 = Native.__default.mapHas(_17_tags, _15_key);
          _16_found = _out6;
        }
        if (!(_16_found)) {
          (_this).Fail(Native.__default.concat("undefined tag handle '", Native.__default.concat(_13_handle, "' (no matching %TAG directive in this document)")));
        }
        let _18_prefixValue = undefined;
        let _out7;
        _out7 = Native.__default.mapGet(_17_tags, _15_key);
        _18_prefixValue = _out7;
        let _19_prefix;
        _19_prefix = Native.__default.stringValueOf(_18_prefixValue);
        let _20_decoded;
        let _out8;
        _out8 = (_this).DecodeTagPercent(_14_suffix);
        _20_decoded = _out8;
        tag = Native.__default.concat(_19_prefix, _20_decoded);
        return tag;
      }
      (_this).pos = _10_wordStart;
      let _21_primary = "";
      let _out9;
      _out9 = (_this).ScanTagSuffixRaw();
      _21_primary = _out9;
      if (_dafny.areEqual(_21_primary, "")) {
        tag = "!";
        return tag;
      }
      let _22_primaryKey;
      _22_primaryKey = Native.__default.stringValue("!");
      let _23_hasPrimary;
      _23_hasPrimary = false;
      let _24_tags;
      _24_tags = Native.__default.mapFromValue(_this.tagHandles);
      if (_this.hasTagHandles) {
        let _out10;
        _out10 = Native.__default.mapHas(_24_tags, _22_primaryKey);
        _23_hasPrimary = _out10;
      }
      let _25_primaryPrefix;
      _25_primaryPrefix = "!";
      if (_23_hasPrimary) {
        let _26_prefixValue = undefined;
        let _out11;
        _out11 = Native.__default.mapGet(_24_tags, _22_primaryKey);
        _26_prefixValue = _out11;
        _25_primaryPrefix = Native.__default.stringValueOf(_26_prefixValue);
      }
      let _27_decoded;
      let _out12;
      _out12 = (_this).DecodeTagPercent(_21_primary);
      _27_decoded = _out12;
      tag = Native.__default.concat(_25_primaryPrefix, _27_decoded);
      return tag;
    }
    CheckTagSeparator(inFlow) {
      let _this = this;
      if ((_this.pos) >= (_this.len)) {
        return;
      }
      let _0_c;
      _0_c = ((_this.src)[_this.pos]).charCodeAt(0);
      if (((((_0_c) === (32)) || ((_0_c) === (9))) || ((_0_c) === (10))) || ((_0_c) === (13))) {
        return;
      }
      if ((inFlow) && ((_this).FlowIndicator(_0_c))) {
        return;
      }
      (_this).Fail("a tag must be separated from the following content by whitespace");
      return;
    }
    ApplyScalarTag(tag, raw) {
      let _this = this;
      let value = undefined;
      if ((_dafny.areEqual(tag, "tag:yaml.org,2002:str")) || (_dafny.areEqual(tag, "!"))) {
        value = Native.__default.stringValue(raw);
        return value;
      }
      if (_dafny.areEqual(tag, "tag:yaml.org,2002:null")) {
        if (((((_dafny.areEqual(raw, "")) || (_dafny.areEqual(raw, "~"))) || (_dafny.areEqual(raw, "null"))) || (_dafny.areEqual(raw, "Null"))) || (_dafny.areEqual(raw, "NULL"))) {
          value = Native.__default.nullValue;
          return value;
        }
        (_this).Fail(Native.__default.concat("!!null: '", Native.__default.concat(raw, "' is not a valid core-schema null")));
      }
      if (_dafny.areEqual(tag, "tag:yaml.org,2002:bool")) {
        let _out0;
        _out0 = (_this).IsBoolWord(raw);
        value = _out0;
        if (Native.__default.sameValue(value, Native.__default.notNumericValue)) {
          (_this).Fail(Native.__default.concat("!!bool: '", Native.__default.concat(raw, "' is not a valid core-schema boolean")));
        }
        return value;
      }
      if ((_dafny.areEqual(tag, "tag:yaml.org,2002:int")) || (_dafny.areEqual(tag, "tag:yaml.org,2002:float"))) {
        let _0_number;
        let _out1;
        _out1 = (_this).TryNumberGeneric(raw);
        _0_number = _out1;
        if (Native.__default.sameValue(_0_number, Native.__default.notNumericValue)) {
          (_this).Fail(Native.__default.concat("!!", Native.__default.concat(((_dafny.areEqual(tag, "tag:yaml.org,2002:int")) ? ("int") : ("float")), Native.__default.concat(": '", Native.__default.concat(raw, "' is not a valid core-schema number")))));
        }
        if ((_dafny.areEqual(tag, "tag:yaml.org,2002:int")) && (_this.lastNumberIsFloat)) {
          (_this).Fail(Native.__default.concat("!!int: '", Native.__default.concat(raw, "' is not a valid core-schema integer")));
        }
        value = _0_number;
        return value;
      }
      if (_dafny.areEqual(tag, "tag:yaml.org,2002:binary")) {
        let _out2;
        _out2 = (_this.tagHelpers).DecodeBinary(raw);
        value = _out2;
        let _1_binaryError = "";
        let _out3;
        _out3 = (_this.tagHelpers).ErrorMessage();
        _1_binaryError = _out3;
        if (!_dafny.areEqual(_1_binaryError, "")) {
          (_this).Fail(_1_binaryError);
        }
        return value;
      }
      if (((((_dafny.areEqual(tag, "tag:yaml.org,2002:map")) || (_dafny.areEqual(tag, "tag:yaml.org,2002:seq"))) || (_dafny.areEqual(tag, "tag:yaml.org,2002:set"))) || (_dafny.areEqual(tag, "tag:yaml.org,2002:omap"))) || (_dafny.areEqual(tag, "tag:yaml.org,2002:pairs"))) {
        (_this).Fail("the collection tag requires a mapping/sequence node, not a scalar");
      }
      value = Native.__default.stringValue(raw);
      return value;
    }
    ParseTaggedFlowValue() {
      let _this = this;
      let value = undefined;
      let _0_tag = "";
      let _out0;
      _out0 = (_this).ScanTag();
      _0_tag = _out0;
      (_this).CheckTagSeparator(true);
      (_this).SkipFlowWs();
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (33))) {
        (_this).Fail("a node may carry at most one tag");
      }
      let _1_anchorName;
      _1_anchorName = "";
      let _2_touched;
      _2_touched = false;
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (38))) {
        (_this).pos = (_this.pos) + (1);
        let _out1;
        _out1 = (_this).ScanAnchorOrAliasName();
        _1_anchorName = _out1;
        _2_touched = true;
        (_this).SkipFlowWs();
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (38))) {
          (_this).Fail("a node may carry at most one anchor");
        }
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (33))) {
          (_this).Fail("a node may carry at most one tag");
        }
      }
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (42))) {
        (_this).Fail("an alias node cannot carry a tag/anchor property");
      }
      let _3_outerPending;
      _3_outerPending = _this.pendingAnchorName;
      let _4_hadOuterPending;
      _4_hadOuterPending = _this.hasPendingAnchorName;
      if (_2_touched) {
        (_this).pendingAnchorName = _1_anchorName;
        (_this).hasPendingAnchorName = true;
      }
      let _out2;
      _out2 = (_this).ParseTaggedFlowContent(_0_tag);
      value = _out2;
      if (_2_touched) {
        (_this).RegisterPendingAnchor(value);
        (_this).pendingAnchorName = _3_outerPending;
        (_this).hasPendingAnchorName = _4_hadOuterPending;
      }
      return value;
    }
    ParseTaggedFlowContent(tag) {
      let _this = this;
      let value = undefined;
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (123))) {
        let _out0;
        _out0 = (_this).ParseFlowMap();
        value = _out0;
        if ((!_dafny.areEqual(tag, "tag:yaml.org,2002:map")) && (!_dafny.areEqual(tag, "!"))) {
          (_this).Fail("tag does not match a flow mapping node");
        }
        return value;
      }
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (91))) {
        let _out1;
        _out1 = (_this).ParseFlowSeq();
        value = _out1;
        if ((!_dafny.areEqual(tag, "tag:yaml.org,2002:seq")) && (!_dafny.areEqual(tag, "!"))) {
          (_this).Fail("tag does not match a flow sequence node");
        }
        return value;
      }
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (34))) {
        let _0_quoted = undefined;
        let _out2;
        _out2 = (_this).ParseDoubleQuoted();
        _0_quoted = _out2;
        let _out3;
        _out3 = (_this).ApplyScalarTag(tag, Native.__default.stringValueOf(_0_quoted));
        value = _out3;
        return value;
      }
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (39))) {
        let _1_quoted = undefined;
        let _out4;
        _out4 = (_this).ParseSingleQuoted();
        _1_quoted = _out4;
        let _out5;
        _out5 = (_this).ApplyScalarTag(tag, Native.__default.stringValueOf(_1_quoted));
        value = _out5;
        return value;
      }
      let _2_separator;
      _2_separator = (_this.pos) >= (_this.len);
      if ((_this.pos) < (_this.len)) {
        let _out6;
        _out6 = (_this).FlowSeparatorAt(_this.pos);
        _2_separator = _out6;
      }
      if (_2_separator) {
        let _out7;
        _out7 = (_this).ApplyScalarTag(tag, "");
        value = _out7;
        return value;
      }
      let _3_start;
      _3_start = _this.pos;
      let _4_end = 0;
      let _out8;
      _out8 = (_this).ScanFlowPlainEnd();
      _4_end = _out8;
      let _5_raw;
      _5_raw = Native.__default.slice(_this.src, _3_start, _4_end);
      (_this).pos = _4_end;
      let _out9;
      _out9 = (_this).ApplyScalarTag(tag, _5_raw);
      value = _out9;
      return value;
    }
    ParseAnchoredFlowValue() {
      let _this = this;
      let value = undefined;
      (_this).pos = (_this.pos) + (1);
      let _0_name = "";
      let _out0;
      _out0 = (_this).ScanAnchorOrAliasName();
      _0_name = _out0;
      (_this).SkipInlineSpaces();
      let _1_savedPending;
      _1_savedPending = _this.pendingAnchorName;
      let _2_hadSavedPending;
      _2_hadSavedPending = _this.hasPendingAnchorName;
      (_this).pendingAnchorName = _0_name;
      (_this).hasPendingAnchorName = true;
      let _out1;
      _out1 = (_this).ParseFlowValue();
      value = _out1;
      (_this).RegisterPendingAnchor(value);
      (_this).pendingAnchorName = _1_savedPending;
      (_this).hasPendingAnchorName = _2_hadSavedPending;
      return value;
    }
    MakeSinglePair(key) {
      let _this = this;
      let pair = undefined;
      (_this).pos = (_this.pos) + (1);
      (_this).SkipFlowWs();
      let _0_value;
      _0_value = Native.__default.nullValue;
      if (((((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (44))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (93))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (125))) {
        let _out0;
        _out0 = (_this).ParseFlowValue();
        _0_value = _out0;
      }
      let _out1;
      _out1 = Native.__default.createObject();
      pair = _out1;
      (_this).StoreKey(pair, key, _0_value);
      (_this).SkipFlowWs();
      return pair;
    }
    ParseFlowExplicitEntry() {
      let _this = this;
      let pair = undefined;
      (_this).pos = (_this.pos) + (1);
      (_this).SkipFlowWs();
      let _0_key;
      _0_key = "";
      if ((((((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (58))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (44))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (93))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (125))) {
        let _1_keyValue;
        let _out0;
        _out0 = (_this).ParseFlowValue();
        _1_keyValue = _out0;
        let _out1;
        _out1 = (_this).KeyToString(_1_keyValue);
        _0_key = _out1;
      }
      (_this).SkipFlowWs();
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (58))) {
        let _out2;
        _out2 = (_this).MakeSinglePair(_0_key);
        pair = _out2;
        return pair;
      }
      let _out3;
      _out3 = Native.__default.createObject();
      pair = _out3;
      (_this).StoreKey(pair, _0_key, Native.__default.nullValue);
      return pair;
    }
    ParseFlowSeq() {
      let _this = this;
      let result = undefined;
      (_this).depth = (_this.depth) + (1);
      if ((_this.depth) > (1000)) {
        (_this).Fail("maximum nesting depth exceeded");
      }
      (_this).pos = (_this.pos) + (1);
      let _out0;
      _out0 = Native.__default.createArray();
      result = _out0;
      (_this).RegisterPendingAnchor(result);
      (_this).SkipFlowWs();
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (93))) {
        (_this).pos = (_this.pos) + (1);
        (_this).depth = (_this.depth) - (1);
        return result;
      }
      L10: {
        while (true) {
          C10: {
            if ((_this.pos) >= (_this.len)) {
              (_this).Fail("expected ',' or ']' in flow sequence");
            }
            let _0_emptyKey;
            _0_emptyKey = false;
            if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (58))) {
              let _out1;
              _out1 = (_this).FlowSeparatorAt((_this.pos) + (1));
              _0_emptyKey = _out1;
            }
            if (_0_emptyKey) {
              let _1_emptyPair;
              let _out2;
              _out2 = (_this).MakeSinglePair("");
              _1_emptyPair = _out2;
              Native.__default.arrayPush(result, _1_emptyPair);
            } else if (((((_this.src)[_this.pos]).charCodeAt(0)) === (63)) && (((_this.pos) + (1)) < (_this.len))) {
              let _2_questionSeparator = false;
              let _out3;
              _out3 = (_this).FlowSeparatorAt((_this.pos) + (1));
              _2_questionSeparator = _out3;
              if (_2_questionSeparator) {
                let _3_explicitPair;
                let _out4;
                _out4 = (_this).ParseFlowExplicitEntry();
                _3_explicitPair = _out4;
                Native.__default.arrayPush(result, _3_explicitPair);
              } else {
                let _4_item;
                let _out5;
                _out5 = (_this).ParseFlowValue();
                _4_item = _out5;
                (_this).SkipFlowWs();
                if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (58))) {
                  if (_this.flowWsCrossedLine) {
                    (_this).Fail("an implicit key in a flow sequence must be on a single line");
                  }
                  let _5_itemKey;
                  let _out6;
                  _out6 = (_this).KeyToString(_4_item);
                  _5_itemKey = _out6;
                  let _6_pair;
                  let _out7;
                  _out7 = (_this).MakeSinglePair(_5_itemKey);
                  _6_pair = _out7;
                  Native.__default.arrayPush(result, _6_pair);
                } else {
                  Native.__default.arrayPush(result, _4_item);
                }
              }
            } else {
              let _7_item;
              let _out8;
              _out8 = (_this).ParseFlowValue();
              _7_item = _out8;
              (_this).SkipFlowWs();
              if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (58))) {
                if (_this.flowWsCrossedLine) {
                  (_this).Fail("an implicit key in a flow sequence must be on a single line");
                }
                let _8_itemKey;
                let _out9;
                _out9 = (_this).KeyToString(_7_item);
                _8_itemKey = _out9;
                let _9_pair;
                let _out10;
                _out10 = (_this).MakeSinglePair(_8_itemKey);
                _9_pair = _out10;
                Native.__default.arrayPush(result, _9_pair);
              } else {
                Native.__default.arrayPush(result, _7_item);
              }
            }
            (_this).SkipFlowWs();
            if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (44))) {
              (_this).pos = (_this.pos) + (1);
              (_this).SkipFlowWs();
              if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (93))) {
                (_this).pos = (_this.pos) + (1);
                (_this).depth = (_this.depth) - (1);
                return result;
              }
              break C10;
            }
            if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (93))) {
              (_this).pos = (_this.pos) + (1);
              (_this).depth = (_this.depth) - (1);
              return result;
            }
            (_this).Fail("expected ',' or ']' in flow sequence");
          }
        }
      }
      return result;
    }
    ParseFlowMap() {
      let _this = this;
      let result = undefined;
      (_this).depth = (_this.depth) + (1);
      if ((_this.depth) > (1000)) {
        (_this).Fail("maximum nesting depth exceeded");
      }
      (_this).pos = (_this.pos) + (1);
      let _out0;
      _out0 = Native.__default.createObject();
      result = _out0;
      (_this).RegisterPendingAnchor(result);
      let _0_expected;
      _0_expected = _this.lastRecordKeys;
      let _1_hasExpected;
      _1_hasExpected = _this.hasLastRecordKeys;
      let _2_expectedLength;
      _2_expectedLength = 0;
      if (_1_hasExpected) {
        let _out1;
        _out1 = Native.__default.arrayLength(_0_expected);
        _2_expectedLength = _out1;
      }
      let _3_produced;
      _3_produced = _0_expected;
      let _4_matched;
      _4_matched = true;
      let _5_keyCount;
      _5_keyCount = 0;
      (_this).SkipFlowWs();
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (125))) {
        (_this).pos = (_this.pos) + (1);
        (_this).hasLastRecordKeys = false;
        (_this).lastRecordKeys = Native.__default.undefinedValue;
        (_this).depth = (_this.depth) - (1);
        return result;
      }
      L11: {
        while (true) {
          C11: {
            if ((_this.pos) >= (_this.len)) {
              (_this).Fail("expected ',' or '}' in flow mapping");
            }
            let _6_key;
            _6_key = "";
            let _7_c;
            _7_c = ((_this.src)[_this.pos]).charCodeAt(0);
            let _8_explicitKey;
            _8_explicitKey = false;
            if (((_7_c) === (63)) && (((_this.pos) + (1)) < (_this.len))) {
              let _9_questionSeparator = false;
              let _out2;
              _out2 = (_this).FlowSeparatorAt((_this.pos) + (1));
              _9_questionSeparator = _out2;
              if (_9_questionSeparator) {
                _8_explicitKey = true;
                (_this).pos = (_this.pos) + (1);
                (_this).SkipFlowWs();
                if (((((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (58))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (44))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (125))) {
                  let _10_explicitKeyValue;
                  let _out3;
                  _out3 = (_this).ParseFlowValue();
                  _10_explicitKeyValue = _out3;
                  let _out4;
                  _out4 = (_this).KeyToString(_10_explicitKeyValue);
                  _6_key = _out4;
                }
              } else {
                let _11_fast;
                _11_fast = false;
                if ((((_4_matched) && (_1_hasExpected)) && ((_5_keyCount) < (_2_expectedLength))) && (!(_this.hasPendingAnchorName))) {
                  let _12_expectedValue = undefined;
                  let _out5;
                  _out5 = Native.__default.arrayGet(_0_expected, _5_keyCount);
                  _12_expectedValue = _out5;
                  let _13_expectedKey;
                  _13_expectedKey = Native.__default.stringValueOf(_12_expectedValue);
                  let _out6;
                  _out6 = (_this).FastMatchFlowKey(_13_expectedKey);
                  _11_fast = _out6;
                  if (_11_fast) {
                    _6_key = _13_expectedKey;
                  }
                }
                if (!(_11_fast)) {
                  let _out7;
                  _out7 = (_this).ParseFlowKey();
                  _6_key = _out7;
                }
              }
            } else {
              let _14_fast;
              _14_fast = false;
              if ((((_4_matched) && (_1_hasExpected)) && ((_5_keyCount) < (_2_expectedLength))) && (!(_this.hasPendingAnchorName))) {
                let _15_expectedValue = undefined;
                let _out8;
                _out8 = Native.__default.arrayGet(_0_expected, _5_keyCount);
                _15_expectedValue = _out8;
                let _16_expectedKey;
                _16_expectedKey = Native.__default.stringValueOf(_15_expectedValue);
                let _out9;
                _out9 = (_this).FastMatchFlowKey(_16_expectedKey);
                _14_fast = _out9;
                if (_14_fast) {
                  _6_key = _16_expectedKey;
                }
              }
              if (!(_14_fast)) {
                let _out10;
                _out10 = (_this).ParseFlowKey();
                _6_key = _out10;
              }
            }
            if (((_4_matched) && (_1_hasExpected)) && ((_5_keyCount) < (_2_expectedLength))) {
              let _17_expectedValue = undefined;
              let _out11;
              _out11 = Native.__default.arrayGet(_0_expected, _5_keyCount);
              _17_expectedValue = _out11;
              let _18_expectedKey;
              _18_expectedKey = Native.__default.stringValueOf(_17_expectedValue);
              if (!_dafny.areEqual(_18_expectedKey, _6_key)) {
                let _out12;
                _out12 = Native.__default.createArray();
                _3_produced = _out12;
                let _19_copyIndex;
                _19_copyIndex = 0;
                while ((_19_copyIndex) < (_5_keyCount)) {
                  let _20_oldKey = undefined;
                  let _out13;
                  _out13 = Native.__default.arrayGet(_0_expected, _19_copyIndex);
                  _20_oldKey = _out13;
                  Native.__default.arrayPush(_3_produced, _20_oldKey);
                  _19_copyIndex = (_19_copyIndex) + (1);
                }
                Native.__default.arrayPush(_3_produced, Native.__default.stringValue(_6_key));
                _4_matched = false;
              }
            } else if (_4_matched) {
              let _out14;
              _out14 = Native.__default.createArray();
              _3_produced = _out14;
              if (_1_hasExpected) {
                let _21_copyIndex;
                _21_copyIndex = 0;
                while ((_21_copyIndex) < (_5_keyCount)) {
                  let _22_oldKey = undefined;
                  let _out15;
                  _out15 = Native.__default.arrayGet(_0_expected, _21_copyIndex);
                  _22_oldKey = _out15;
                  Native.__default.arrayPush(_3_produced, _22_oldKey);
                  _21_copyIndex = (_21_copyIndex) + (1);
                }
              }
              Native.__default.arrayPush(_3_produced, Native.__default.stringValue(_6_key));
              _4_matched = false;
            } else {
              Native.__default.arrayPush(_3_produced, Native.__default.stringValue(_6_key));
            }
            _5_keyCount = (_5_keyCount) + (1);
            (_this).SkipFlowWs();
            let _23_value;
            _23_value = Native.__default.nullValue;
            if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (58))) {
              (_this).pos = (_this.pos) + (1);
              (_this).SkipFlowWs();
              if ((((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (44))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (125))) {
                let _out16;
                _out16 = (_this).ParseFlowValue();
                _23_value = _out16;
              }
            }
            let _out17;
            _out17 = (_this).InternKey(_6_key);
            _6_key = _out17;
            (_this).StoreKey(result, _6_key, _23_value);
            (_this).SkipFlowWs();
            if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (44))) {
              (_this).pos = (_this.pos) + (1);
              (_this).SkipFlowWs();
              if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (125))) {
                (_this).pos = (_this.pos) + (1);
                (_this).PublishRecordKeys(_0_expected, _1_hasExpected, _3_produced, _4_matched, _5_keyCount, _2_expectedLength);
                (_this).depth = (_this.depth) - (1);
                return result;
              }
              break C11;
            }
            if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (125))) {
              (_this).pos = (_this.pos) + (1);
              (_this).PublishRecordKeys(_0_expected, _1_hasExpected, _3_produced, _4_matched, _5_keyCount, _2_expectedLength);
              (_this).depth = (_this.depth) - (1);
              return result;
            }
            (_this).Fail("expected ',' or '}' in flow mapping");
          }
        }
      }
      (_this).PublishRecordKeys(_0_expected, _1_hasExpected, _3_produced, _4_matched, _5_keyCount, _2_expectedLength);
      return result;
    }
    FastMatchFlowKey(expected) {
      let _this = this;
      let matchedKey = false;
      matchedKey = false;
      if (((_this.pos) >= (_this.len)) || ((((_this.src)[_this.pos]).charCodeAt(0)) !== (34))) {
        return matchedKey;
      }
      let _0_n;
      _0_n = Native.__default.stringLength(expected);
      if ((((_this.pos) + (_0_n)) + (1)) >= (_this.len)) {
        return matchedKey;
      }
      let _1_i;
      _1_i = 0;
      while ((_1_i) < (_0_n)) {
        if ((((_this.src)[((_this.pos) + (1)) + (_1_i)]).charCodeAt(0)) !== (((expected)[_1_i]).charCodeAt(0))) {
          return matchedKey;
        }
        _1_i = (_1_i) + (1);
      }
      if ((((_this.src)[((_this.pos) + (1)) + (_0_n)]).charCodeAt(0)) !== (34)) {
        return matchedKey;
      }
      (_this).pos = ((_this.pos) + (_0_n)) + (2);
      matchedKey = true;
      return matchedKey;
    }
    PublishRecordKeys(expected, hasExpected, produced, matched, count, expectedLength) {
      let _this = this;
      if (!(matched)) {
        (_this).lastRecordKeys = produced;
        (_this).hasLastRecordKeys = true;
        return;
      }
      if ((count) === (0)) {
        (_this).lastRecordKeys = Native.__default.undefinedValue;
        (_this).hasLastRecordKeys = false;
        return;
      }
      if ((hasExpected) && ((count) === (expectedLength))) {
        (_this).lastRecordKeys = expected;
        (_this).hasLastRecordKeys = true;
        return;
      }
      let _0_result;
      let _out0;
      _out0 = Native.__default.createArray();
      _0_result = _out0;
      let _1_i;
      _1_i = 0;
      while ((_1_i) < (count)) {
        let _2_key = undefined;
        let _out1;
        _out1 = Native.__default.arrayGet(expected, _1_i);
        _2_key = _out1;
        Native.__default.arrayPush(_0_result, _2_key);
        _1_i = (_1_i) + (1);
      }
      (_this).lastRecordKeys = _0_result;
      (_this).hasLastRecordKeys = true;
      return;
    }
    IsSpaceOrEol(c) {
      let _this = this;
      let yes = false;
      yes = ((((c) === (32)) || ((c) === (9))) || ((c) === (10))) || ((c) === (13));
      return yes;
    }
    LooksLikeDocMarkerAt(i) {
      let _this = this;
      let yes = false;
      yes = false;
      if (((i) + (2)) >= (_this.len)) {
        return yes;
      }
      let _0_c;
      _0_c = ((_this.src)[i]).charCodeAt(0);
      if (((_0_c) !== (45)) && ((_0_c) !== (46))) {
        return yes;
      }
      if (((((_this.src)[(i) + (1)]).charCodeAt(0)) !== (_0_c)) || ((((_this.src)[(i) + (2)]).charCodeAt(0)) !== (_0_c))) {
        return yes;
      }
      if (((i) + (3)) >= (_this.len)) {
        yes = true;
        return yes;
      }
      let _out0;
      _out0 = (_this).IsSpaceOrEol(((_this.src)[(i) + (3)]).charCodeAt(0));
      yes = _out0;
      return yes;
    }
    InternValue(s) {
      let _this = this;
      let value = undefined;
      value = Native.__default.stringValue(s);
      if (!(_this.valueCacheEnabled)) {
        return value;
      }
      if (!(_this.hasValueCache)) {
        let _0_newValues;
        let _out0;
        _out0 = Native.__default.mapCreate();
        _0_newValues = _out0;
        (_this).valueCache = Native.__default.mapValue(_0_newValues);
        (_this).hasValueCache = true;
      }
      let _1_values;
      _1_values = Native.__default.mapFromValue(_this.valueCache);
      let _2_present = false;
      let _out1;
      _out1 = Native.__default.mapHas(_1_values, value);
      _2_present = _out1;
      if (_2_present) {
        let _out2;
        _out2 = Native.__default.mapGet(_1_values, value);
        value = _out2;
        return value;
      }
      let _3_cacheSize = 0;
      let _out3;
      _out3 = Native.__default.mapSize(_1_values);
      _3_cacheSize = _out3;
      if ((_3_cacheSize) < (1000000)) {
        Native.__default.mapSet(_1_values, value, value);
      }
      return value;
    }
    FoldFlowBreak(at) {
      let _this = this;
      let next = 0;
      let _0_i;
      _0_i = at;
      let _1_breaks;
      _1_breaks = 0;
      L12: {
        while (true) {
          C12: {
            if ((((_this.src)[_0_i]).charCodeAt(0)) === (13)) {
              _0_i = (_0_i) + (1);
              if (((_0_i) < (_this.len)) && ((((_this.src)[_0_i]).charCodeAt(0)) === (10))) {
                _0_i = (_0_i) + (1);
              }
            } else {
              _0_i = (_0_i) + (1);
            }
            _1_breaks = (_1_breaks) + (1);
            let _2_isMarker = false;
            let _out0;
            _out0 = (_this).LooksLikeDocMarkerAt(_0_i);
            _2_isMarker = _out0;
            if (_2_isMarker) {
              (_this).Fail("unterminated quoted string: a document marker interrupts it");
            }
            let _3_ls;
            _3_ls = _0_i;
            while (((_0_i) < (_this.len)) && (((((_this.src)[_0_i]).charCodeAt(0)) === (32)) || ((((_this.src)[_0_i]).charCodeAt(0)) === (9)))) {
              _0_i = (_0_i) + (1);
            }
            if ((_0_i) >= (_this.len)) {
              (_this).Fail("unterminated quoted string");
            }
            let _4_cc;
            _4_cc = ((_this.src)[_0_i]).charCodeAt(0);
            if (((_4_cc) !== (10)) && ((_4_cc) !== (13))) {
              if (((_this.flowIndentFloor) >= (0)) && (((_0_i) - (_3_ls)) <= (_this.flowIndentFloor))) {
                (_this).pos = _0_i;
                (_this).Fail("insufficient indentation for a multi-line quoted scalar");
              }
              break L12;
            }
          }
        }
      }
      (_this).foldedBreaks = _1_breaks;
      (_this).quotedMultiline = true;
      next = _0_i;
      return next;
    }
    ParseDoubleQuoted() {
      let _this = this;
      let value = undefined;
      (_this).quotedMultiline = false;
      let _0_start;
      _0_start = (_this.pos) + (1);
      let _1_e;
      _1_e = Native.__default.indexOf(_this.src, "\"", _0_start);
      if ((_1_e) === (-1)) {
        (_this).Fail("unterminated double-quoted string");
      }
      if ((_this.nextBackslash) < (_0_start)) {
        let _2_b;
        _2_b = Native.__default.indexOf(_this.src, "\\", _0_start);
        if ((_2_b) === (-1)) {
          (_this).nextBackslash = _this.len;
        } else {
          (_this).nextBackslash = _2_b;
        }
      }
      if ((_this.nextBackslash) > (_1_e)) {
        if ((_this.nextNewline) < (_0_start)) {
          let _3_n;
          _3_n = Native.__default.indexOf(_this.src, "\n", _0_start);
          if ((_3_n) === (-1)) {
            (_this).nextNewline = _this.len;
          } else {
            (_this).nextNewline = _3_n;
          }
        }
        if ((_this.nextNewline) > (_1_e)) {
          (_this).pos = (_1_e) + (1);
          let _out0;
          _out0 = (_this).InternValue(Native.__default.slice(_this.src, _0_start, _1_e));
          value = _out0;
          return value;
        }
      }
      let _out1;
      _out1 = (_this).ParseDoubleQuotedSlow(_0_start);
      value = _out1;
      return value;
    }
    ParseDoubleQuotedSlow(start) {
      let _this = this;
      let value = undefined;
      let _0_result;
      _0_result = "";
      let _1_seg;
      _1_seg = start;
      let _2_i;
      _2_i = start;
      L13: {
        while (true) {
          C13: {
            if ((_2_i) >= (_this.len)) {
              (_this).Fail("unterminated double-quoted string");
            }
            let _3_c;
            _3_c = ((_this.src)[_2_i]).charCodeAt(0);
            if ((_3_c) === (34)) {
              _0_result = Native.__default.concat(_0_result, Native.__default.slice(_this.src, _1_seg, _2_i));
              (_this).pos = (_2_i) + (1);
              value = Native.__default.stringValue(_0_result);
              return value;
            }
            if ((_3_c) === (92)) {
              if ((_2_i) > (_1_seg)) {
                _0_result = Native.__default.concat(_0_result, Native.__default.slice(_this.src, _1_seg, _2_i));
              }
              _2_i = (_2_i) + (1);
              if ((_2_i) >= (_this.len)) {
                (_this).Fail("unterminated escape sequence");
              }
              let _4_ec;
              _4_ec = ((_this.src)[_2_i]).charCodeAt(0);
              if ((_4_ec) === (34)) {
                _0_result = Native.__default.concat(_0_result, "\"");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (92)) {
                _0_result = Native.__default.concat(_0_result, "\\");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (47)) {
                _0_result = Native.__default.concat(_0_result, "/");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (48)) {
                _0_result = Native.__default.concat(_0_result, "\u0000");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (97)) {
                _0_result = Native.__default.concat(_0_result, "\u0007");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (98)) {
                _0_result = Native.__default.concat(_0_result, "\u0008");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (101)) {
                _0_result = Native.__default.concat(_0_result, "\u001b");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (102)) {
                _0_result = Native.__default.concat(_0_result, "\u000c");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (110)) {
                _0_result = Native.__default.concat(_0_result, "\n");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (114)) {
                _0_result = Native.__default.concat(_0_result, "\r");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (116)) {
                _0_result = Native.__default.concat(_0_result, "\t");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (118)) {
                _0_result = Native.__default.concat(_0_result, "\u000b");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (32)) {
                _0_result = Native.__default.concat(_0_result, " ");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (9)) {
                _0_result = Native.__default.concat(_0_result, "\t");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (78)) {
                _0_result = Native.__default.concat(_0_result, "\u0085");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (95)) {
                _0_result = Native.__default.concat(_0_result, "\u00a0");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (76)) {
                _0_result = Native.__default.concat(_0_result, "\u2028");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (80)) {
                _0_result = Native.__default.concat(_0_result, "\u2029");
                _2_i = (_2_i) + (1);
              } else if ((_4_ec) === (120)) {
                let _5_hex;
                let _out0;
                _out0 = (_this).ReadHex((_2_i) + (1), 2);
                _5_hex = _out0;
                _0_result = Native.__default.concat(_0_result, Native.__default.stringFromCharCode(_5_hex));
                _2_i = (_2_i) + (3);
              } else if ((_4_ec) === (117)) {
                let _6_hex;
                let _out1;
                _out1 = (_this).ReadHex((_2_i) + (1), 4);
                _6_hex = _out1;
                _0_result = Native.__default.concat(_0_result, Native.__default.stringFromCharCode(_6_hex));
                _2_i = (_2_i) + (5);
              } else if ((_4_ec) === (85)) {
                let _7_cp;
                let _out2;
                _out2 = (_this).ReadHex((_2_i) + (1), 8);
                _7_cp = _out2;
                _0_result = Native.__default.concat(_0_result, Native.__default.stringFromCodePoint(_7_cp));
                _2_i = (_2_i) + (9);
              } else if ((_4_ec) === (10)) {
                _2_i = (_2_i) + (1);
                while (((_2_i) < (_this.len)) && (((((_this.src)[_2_i]).charCodeAt(0)) === (32)) || ((((_this.src)[_2_i]).charCodeAt(0)) === (9)))) {
                  _2_i = (_2_i) + (1);
                }
              } else if ((_4_ec) === (13)) {
                _2_i = (_2_i) + (1);
                if (((_2_i) < (_this.len)) && ((((_this.src)[_2_i]).charCodeAt(0)) === (10))) {
                  _2_i = (_2_i) + (1);
                }
                while (((_2_i) < (_this.len)) && (((((_this.src)[_2_i]).charCodeAt(0)) === (32)) || ((((_this.src)[_2_i]).charCodeAt(0)) === (9)))) {
                  _2_i = (_2_i) + (1);
                }
              } else {
                (_this).Fail("invalid escape sequence in double-quoted string");
              }
              _1_seg = _2_i;
              break C13;
            }
            if (((_3_c) === (10)) || ((_3_c) === (13))) {
              let _8_j;
              _8_j = _2_i;
              while (((_8_j) > (_1_seg)) && (((((_this.src)[(_8_j) - (1)]).charCodeAt(0)) === (32)) || ((((_this.src)[(_8_j) - (1)]).charCodeAt(0)) === (9)))) {
                _8_j = (_8_j) - (1);
              }
              _0_result = Native.__default.concat(_0_result, Native.__default.slice(_this.src, _1_seg, _8_j));
              let _out3;
              _out3 = (_this).FoldFlowBreak(_2_i);
              _2_i = _out3;
              if ((_this.foldedBreaks) === (1)) {
                _0_result = Native.__default.concat(_0_result, " ");
              } else {
                _0_result = Native.__default.concat(_0_result, Native.__default.repeat("\n", (_this.foldedBreaks) - (1)));
              }
              _1_seg = _2_i;
              break C13;
            }
            _2_i = (_2_i) + (1);
          }
        }
      }
      return value;
    }
    ReadHex(start, width) {
      let _this = this;
      let value = 0;
      if (((start) + (width)) > (_this.len)) {
        (_this).Fail("truncated \\x/\\u/\\U escape");
      }
      value = 0;
      let _0_k;
      _0_k = 0;
      while ((_0_k) < (width)) {
        let _1_d = 0;
        let _out0;
        _out0 = (_this).HexVal(((_this.src)[(start) + (_0_k)]).charCodeAt(0));
        _1_d = _out0;
        value = ((value) * (16)) + (_1_d);
        _0_k = (_0_k) + (1);
      }
      return value;
    }
    HexVal(c) {
      let _this = this;
      let value = 0;
      if (((48) <= (c)) && ((c) <= (57))) {
        value = (c) - (48);
        return value;
      }
      if (((97) <= (c)) && ((c) <= (102))) {
        value = (c) - (87);
        return value;
      }
      if (((65) <= (c)) && ((c) <= (70))) {
        value = (c) - (55);
        return value;
      }
      (_this).Fail("invalid hex digit in \\u escape");
      value = 0;
      return value;
    }
    ParseSingleQuoted() {
      let _this = this;
      let value = undefined;
      (_this).quotedMultiline = false;
      let _0_start;
      _0_start = (_this.pos) + (1);
      let _1_e;
      _1_e = Native.__default.indexOf(_this.src, "'", _0_start);
      if ((_1_e) === (-1)) {
        (_this).Fail("unterminated single-quoted string");
      }
      if ((((_1_e) + (1)) < (_this.len)) && ((((_this.src)[(_1_e) + (1)]).charCodeAt(0)) === (39))) {
        let _out0;
        _out0 = (_this).ParseSingleQuotedSlow(_0_start);
        value = _out0;
        return value;
      }
      if ((_this.nextNewline) < (_0_start)) {
        let _2_n;
        _2_n = Native.__default.indexOf(_this.src, "\n", _0_start);
        if ((_2_n) === (-1)) {
          (_this).nextNewline = _this.len;
        } else {
          (_this).nextNewline = _2_n;
        }
      }
      if ((_this.nextNewline) < (_1_e)) {
        let _out1;
        _out1 = (_this).ParseSingleQuotedSlow(_0_start);
        value = _out1;
        return value;
      }
      (_this).pos = (_1_e) + (1);
      let _out2;
      _out2 = (_this).InternValue(Native.__default.slice(_this.src, _0_start, _1_e));
      value = _out2;
      return value;
    }
    ParseSingleQuotedSlow(start) {
      let _this = this;
      let value = undefined;
      let _0_result;
      _0_result = "";
      let _1_seg;
      _1_seg = start;
      let _2_i;
      _2_i = start;
      L14: {
        while (true) {
          C14: {
            if ((_2_i) >= (_this.len)) {
              (_this).Fail("unterminated single-quoted string");
            }
            let _3_c;
            _3_c = ((_this.src)[_2_i]).charCodeAt(0);
            if ((_3_c) === (39)) {
              if ((((_2_i) + (1)) < (_this.len)) && ((((_this.src)[(_2_i) + (1)]).charCodeAt(0)) === (39))) {
                _0_result = Native.__default.concat(Native.__default.concat(_0_result, Native.__default.slice(_this.src, _1_seg, _2_i)), "'");
                _2_i = (_2_i) + (2);
                _1_seg = _2_i;
                break C14;
              }
              _0_result = Native.__default.concat(_0_result, Native.__default.slice(_this.src, _1_seg, _2_i));
              (_this).pos = (_2_i) + (1);
              value = Native.__default.stringValue(_0_result);
              return value;
            }
            if (((_3_c) === (10)) || ((_3_c) === (13))) {
              let _4_j;
              _4_j = _2_i;
              while (((_4_j) > (_1_seg)) && (((((_this.src)[(_4_j) - (1)]).charCodeAt(0)) === (32)) || ((((_this.src)[(_4_j) - (1)]).charCodeAt(0)) === (9)))) {
                _4_j = (_4_j) - (1);
              }
              _0_result = Native.__default.concat(_0_result, Native.__default.slice(_this.src, _1_seg, _4_j));
              let _out0;
              _out0 = (_this).FoldFlowBreak(_2_i);
              _2_i = _out0;
              if ((_this.foldedBreaks) === (1)) {
                _0_result = Native.__default.concat(_0_result, " ");
              } else {
                _0_result = Native.__default.concat(_0_result, Native.__default.repeat("\n", (_this.foldedBreaks) - (1)));
              }
              _1_seg = _2_i;
              break C14;
            }
            _2_i = (_2_i) + (1);
          }
        }
      }
      return value;
    }
    DetectBlockScalarIndent(effParentCol) {
      let _this = this;
      let indent = 0;
      let _0_p;
      _0_p = _this.pos;
      let _1_maxBlankIndent;
      _1_maxBlankIndent = -1;
      L15: {
        while (true) {
          C15: {
            let _2_marker = false;
            let _out0;
            _out0 = (_this).LooksLikeDocMarkerAt(_0_p);
            _2_marker = _out0;
            if (((_0_p) >= (_this.len)) || (_2_marker)) {
              if ((_1_maxBlankIndent) > (effParentCol)) {
                indent = _1_maxBlankIndent;
              } else {
                indent = (effParentCol) + (1);
              }
              return indent;
            }
            let _3_spaces;
            _3_spaces = 0;
            let _4_q;
            _4_q = _0_p;
            while (((_4_q) < (_this.len)) && ((((_this.src)[_4_q]).charCodeAt(0)) === (32))) {
              _3_spaces = (_3_spaces) + (1);
              _4_q = (_4_q) + (1);
            }
            let _5_r;
            _5_r = _4_q;
            L16: {
              while ((_5_r) < (_this.len)) {
                C16: {
                  let _6_rc;
                  _6_rc = ((_this.src)[_5_r]).charCodeAt(0);
                  if (((_6_rc) === (10)) || ((_6_rc) === (13))) {
                    break L16;
                  }
                  if (((_6_rc) !== (32)) && ((_6_rc) !== (9))) {
                    break L16;
                  }
                  _5_r = (_5_r) + (1);
                }
              }
            }
            let _7_stop;
            _7_stop = -1;
            if ((_5_r) < (_this.len)) {
              _7_stop = ((_this.src)[_5_r]).charCodeAt(0);
            }
            if ((((_7_stop) === (-1)) || ((_7_stop) === (10))) || ((_7_stop) === (13))) {
              if ((_3_spaces) > (_1_maxBlankIndent)) {
                _1_maxBlankIndent = _3_spaces;
              }
              if ((_7_stop) === (10)) {
                _0_p = (_5_r) + (1);
              } else if ((_7_stop) === (13)) {
                if ((((_5_r) + (1)) < (_this.len)) && ((((_this.src)[(_5_r) + (1)]).charCodeAt(0)) === (10))) {
                  _0_p = (_5_r) + (2);
                } else {
                  _0_p = (_5_r) + (1);
                }
              } else {
                _0_p = _this.len;
              }
              break C15;
            }
            if ((_3_spaces) <= (effParentCol)) {
              if ((_1_maxBlankIndent) > (effParentCol)) {
                indent = _1_maxBlankIndent;
              } else {
                indent = (effParentCol) + (1);
              }
              return indent;
            }
            if ((_1_maxBlankIndent) > (_3_spaces)) {
              (_this).Fail("a block scalar's leading empty lines must not be more indented than its first line of content");
            }
            indent = _3_spaces;
            return indent;
          }
        }
      }
      return indent;
    }
    SkipBlockScalarBlankLines() {
      let _this = this;
      L17: {
        while ((_this.pos) < (_this.len)) {
          C17: {
            while (((_this.pos) < (_this.len)) && (((((_this.src)[_this.pos]).charCodeAt(0)) === (32)) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (9)))) {
              (_this).pos = (_this.pos) + (1);
            }
            if ((_this.pos) >= (_this.len)) {
              return;
            }
            let _0_c;
            _0_c = ((_this.src)[_this.pos]).charCodeAt(0);
            if ((_0_c) === (10)) {
              (_this).pos = (_this.pos) + (1);
              (_this).lineStart = _this.pos;
              break C17;
            }
            if ((_0_c) === (13)) {
              (_this).pos = (_this.pos) + (1);
              if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (10))) {
                (_this).pos = (_this.pos) + (1);
              }
              (_this).lineStart = _this.pos;
              break C17;
            }
            if ((_0_c) === (35)) {
              let _1_nl;
              _1_nl = Native.__default.indexOf(_this.src, "\n", _this.pos);
              if ((_1_nl) === (-1)) {
                (_this).pos = _this.len;
              } else {
                (_this).pos = (_1_nl) + (1);
              }
              (_this).lineStart = _this.pos;
              break C17;
            }
            return;
          }
        }
      }
      return;
    }
    ParseBlockScalar(parentCol) {
      let _this = this;
      let value = undefined;
      let _0_folded;
      _0_folded = (((_this.src)[_this.pos]).charCodeAt(0)) === (62);
      (_this).pos = (_this.pos) + (1);
      let _1_indentIndicator;
      _1_indentIndicator = 0;
      let _2_chomp;
      _2_chomp = 0;
      let _3_headerCount;
      _3_headerCount = 0;
      L18: {
        while ((_3_headerCount) < (2)) {
          C18: {
            let _4_c;
            _4_c = -1;
            if ((_this.pos) < (_this.len)) {
              _4_c = ((_this.src)[_this.pos]).charCodeAt(0);
            }
            if ((((49) <= (_4_c)) && ((_4_c) <= (57))) && ((_1_indentIndicator) === (0))) {
              _1_indentIndicator = (_4_c) - (48);
              (_this).pos = (_this.pos) + (1);
            } else if (((_4_c) === (45)) && ((_2_chomp) === (0))) {
              _2_chomp = -1;
              (_this).pos = (_this.pos) + (1);
            } else if (((_4_c) === (43)) && ((_2_chomp) === (0))) {
              _2_chomp = 1;
              (_this).pos = (_this.pos) + (1);
            } else {
              break L18;
            }
            _3_headerCount = (_3_headerCount) + (1);
          }
        }
      }
      let _5_sawSpace;
      _5_sawSpace = false;
      while (((_this.pos) < (_this.len)) && (((((_this.src)[_this.pos]).charCodeAt(0)) === (32)) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (9)))) {
        (_this).pos = (_this.pos) + (1);
        _5_sawSpace = true;
      }
      let _6_afterHeader;
      _6_afterHeader = -1;
      if ((_this.pos) < (_this.len)) {
        _6_afterHeader = ((_this.src)[_this.pos]).charCodeAt(0);
      }
      if ((_6_afterHeader) === (35)) {
        if (!(_5_sawSpace)) {
          (_this).Fail("a comment after a block scalar header must be preceded by whitespace");
        }
        let _7_commentEnd;
        _7_commentEnd = Native.__default.indexOf(_this.src, "\n", _this.pos);
        if ((_7_commentEnd) === (-1)) {
          (_this).pos = _this.len;
        } else {
          (_this).pos = _7_commentEnd;
        }
      } else if ((((_6_afterHeader) !== (-1)) && ((_6_afterHeader) !== (10))) && ((_6_afterHeader) !== (13))) {
        (_this).Fail("invalid block scalar header (expected an indentation indicator, chomping indicator, comment, or end of line)");
      }
      if ((_this.pos) < (_this.len)) {
        let _8_c;
        _8_c = ((_this.src)[_this.pos]).charCodeAt(0);
        if ((_8_c) === (10)) {
          (_this).pos = (_this.pos) + (1);
        } else if ((_8_c) === (13)) {
          (_this).pos = (_this.pos) + (1);
          if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (10))) {
            (_this).pos = (_this.pos) + (1);
          }
        }
      }
      (_this).lineStart = _this.pos;
      let _9_effParentCol;
      _9_effParentCol = parentCol;
      if ((parentCol) === (-2)) {
        _9_effParentCol = -1;
      }
      let _10_contentIndent = 0;
      if ((_1_indentIndicator) > (0)) {
        _10_contentIndent = (_9_effParentCol) + (_1_indentIndicator);
      } else {
        let _out0;
        _out0 = (_this).DetectBlockScalarIndent(_9_effParentCol);
        _10_contentIndent = _out0;
      }
      let _11_result;
      _11_result = "";
      let _12_sawContent;
      _12_sawContent = false;
      let _13_prevMoreIndented;
      _13_prevMoreIndented = false;
      let _14_pendingBreaks;
      _14_pendingBreaks = 0;
      L19: {
        while (true) {
          C19: {
            if ((_this.pos) >= (_this.len)) {
              break L19;
            }
            let _15_docMarker = false;
            let _out1;
            _out1 = (_this).IsDocMarkerAt(_this.pos);
            _15_docMarker = _out1;
            if (_15_docMarker) {
              break L19;
            }
            let _16_count;
            _16_count = 0;
            let _17_p;
            _17_p = _this.pos;
            L20: {
              while ((_16_count) < (_10_contentIndent)) {
                C20: {
                  let _18_c;
                  _18_c = -1;
                  if ((_17_p) < (_this.len)) {
                    _18_c = ((_this.src)[_17_p]).charCodeAt(0);
                  }
                  if ((_18_c) === (32)) {
                    _16_count = (_16_count) + (1);
                    _17_p = (_17_p) + (1);
                    break C20;
                  }
                  if ((_18_c) === (9)) {
                    (_this).Fail("tab characters are not allowed in block scalar indentation");
                  }
                  break L20;
                }
              }
            }
            if ((_16_count) < (_10_contentIndent)) {
              let _19_c;
              _19_c = -1;
              if ((_17_p) < (_this.len)) {
                _19_c = ((_this.src)[_17_p]).charCodeAt(0);
              }
              if ((((_19_c) === (-1)) || ((_19_c) === (10))) || ((_19_c) === (13))) {
                _14_pendingBreaks = (_14_pendingBreaks) + (1);
                if ((_19_c) === (10)) {
                  (_this).pos = (_17_p) + (1);
                } else if ((_19_c) === (13)) {
                  if ((((_17_p) + (1)) < (_this.len)) && ((((_this.src)[(_17_p) + (1)]).charCodeAt(0)) === (10))) {
                    (_this).pos = (_17_p) + (2);
                  } else {
                    (_this).pos = (_17_p) + (1);
                  }
                } else {
                  (_this).pos = _this.len;
                }
                (_this).lineStart = _this.pos;
                break C19;
              }
              (_this).pos = _17_p;
              break L19;
            }
            let _20_nl;
            _20_nl = Native.__default.indexOf(_this.src, "\n", _17_p);
            let _21_lineEnd = 0;
            if ((_20_nl) === (-1)) {
              _21_lineEnd = _this.len;
            } else {
              _21_lineEnd = _20_nl;
            }
            let _22_textEnd;
            _22_textEnd = _21_lineEnd;
            if (((_22_textEnd) > (_17_p)) && ((((_this.src)[(_22_textEnd) - (1)]).charCodeAt(0)) === (13))) {
              _22_textEnd = (_22_textEnd) - (1);
            }
            let _23_text;
            _23_text = Native.__default.slice(_this.src, _17_p, _22_textEnd);
            if (_dafny.areEqual(_23_text, "")) {
              _14_pendingBreaks = (_14_pendingBreaks) + (1);
            } else {
              let _24_moreIndented;
              _24_moreIndented = false;
              let _25_firstUnit;
              _25_firstUnit = Native.__default.codeUnitAt(_23_text, 0);
              if (((_25_firstUnit) === (32)) || ((_25_firstUnit) === (9))) {
                _24_moreIndented = true;
              }
              if (!(_12_sawContent)) {
                if ((_14_pendingBreaks) > (0)) {
                  _11_result = Native.__default.concat(_11_result, Native.__default.repeat("\n", _14_pendingBreaks));
                }
                _11_result = Native.__default.concat(_11_result, _23_text);
              } else if (!(_0_folded)) {
                let _26_breakCount = 0;
                if ((_14_pendingBreaks) === (0)) {
                  _26_breakCount = 1;
                } else {
                  _26_breakCount = (_14_pendingBreaks) + (1);
                }
                _11_result = Native.__default.concat(_11_result, Native.__default.repeat("\n", _26_breakCount));
                _11_result = Native.__default.concat(_11_result, _23_text);
              } else {
                let _27_moreInvolved;
                _27_moreInvolved = (_13_prevMoreIndented) || (_24_moreIndented);
                if (((_14_pendingBreaks) === (0)) && (!(_27_moreInvolved))) {
                  _11_result = Native.__default.concat(_11_result, " ");
                  _11_result = Native.__default.concat(_11_result, _23_text);
                } else if (_27_moreInvolved) {
                  let _28_breakCount = 0;
                  if ((_14_pendingBreaks) === (0)) {
                    _28_breakCount = 1;
                  } else {
                    _28_breakCount = (_14_pendingBreaks) + (1);
                  }
                  _11_result = Native.__default.concat(_11_result, Native.__default.repeat("\n", _28_breakCount));
                  _11_result = Native.__default.concat(_11_result, _23_text);
                } else {
                  _11_result = Native.__default.concat(_11_result, Native.__default.repeat("\n", _14_pendingBreaks));
                  _11_result = Native.__default.concat(_11_result, _23_text);
                }
              }
              _12_sawContent = true;
              _13_prevMoreIndented = _24_moreIndented;
              _14_pendingBreaks = 0;
            }
            if ((_20_nl) === (-1)) {
              (_this).pos = _this.len;
            } else {
              (_this).pos = (_20_nl) + (1);
            }
            (_this).lineStart = _this.pos;
          }
        }
      }
      (_this).SkipBlockScalarBlankLines();
      if (!(_12_sawContent)) {
        if ((_2_chomp) === (1)) {
          value = Native.__default.stringValue(Native.__default.repeat("\n", _14_pendingBreaks));
        } else {
          value = Native.__default.stringValue("");
        }
        return value;
      }
      if ((_2_chomp) === (-1)) {
        value = Native.__default.stringValue(_11_result);
        return value;
      }
      if ((_2_chomp) === (1)) {
        value = Native.__default.stringValue(Native.__default.concat(_11_result, Native.__default.repeat("\n", (_14_pendingBreaks) + (1))));
        return value;
      }
      value = Native.__default.stringValue(Native.__default.concat(_11_result, "\n"));
      return value;
    }
    SkipBlankLines() {
      let _this = this;
      L21: {
        while ((_this.pos) < (_this.len)) {
          C21: {
            while (((_this.pos) < (_this.len)) && (((((_this.src)[_this.pos]).charCodeAt(0)) === (32)) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (9)))) {
              (_this).pos = (_this.pos) + (1);
            }
            if ((_this.pos) >= (_this.len)) {
              return;
            }
            let _0_c;
            _0_c = ((_this.src)[_this.pos]).charCodeAt(0);
            if ((_0_c) === (10)) {
              (_this).pos = (_this.pos) + (1);
              (_this).lineStart = _this.pos;
              break C21;
            }
            if ((_0_c) === (13)) {
              (_this).pos = (_this.pos) + (1);
              if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (10))) {
                (_this).pos = (_this.pos) + (1);
              }
              (_this).lineStart = _this.pos;
              break C21;
            }
            if ((_0_c) === (35)) {
              while ((((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (10))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (13))) {
                (_this).pos = (_this.pos) + (1);
              }
              if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (13))) {
                (_this).pos = (_this.pos) + (1);
              }
              if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (10))) {
                (_this).pos = (_this.pos) + (1);
              }
              (_this).lineStart = _this.pos;
              break C21;
            }
            return;
          }
        }
      }
      return;
    }
    EndLine() {
      let _this = this;
      (_this).SkipInlineSpaces();
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (35))) {
        if ((_this.pos) > (_this.lineStart)) {
          let _0_prev;
          _0_prev = ((_this.src)[(_this.pos) - (1)]).charCodeAt(0);
          if (((_0_prev) !== (32)) && ((_0_prev) !== (9))) {
            (_this).Fail("a comment must be separated from other tokens by whitespace");
          }
        }
        while ((((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (10))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (13))) {
          (_this).pos = (_this.pos) + (1);
        }
      }
      if ((_this.pos) >= (_this.len)) {
        return;
      }
      if ((((_this.src)[_this.pos]).charCodeAt(0)) === (13)) {
        (_this).pos = (_this.pos) + (1);
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (10))) {
          (_this).pos = (_this.pos) + (1);
        }
        (_this).lineStart = _this.pos;
        return;
      }
      if ((((_this.src)[_this.pos]).charCodeAt(0)) === (10)) {
        (_this).pos = (_this.pos) + (1);
        (_this).lineStart = _this.pos;
        return;
      }
      (_this).Fail("unexpected content at end of line");
      return;
    }
    NextLine() {
      let _this = this;
      (_this).EndLine();
      (_this).SkipBlankLines();
      return;
    }
    FinishDirectiveLine() {
      let _this = this;
      let _0_nl = 0;
      _0_nl = Native.__default.indexOf(_this.src, "\n", _this.pos);
      if ((_0_nl) < (0)) {
        (_this).pos = _this.len;
      } else {
        (_this).pos = (_0_nl) + (1);
      }
      (_this).lineStart = _this.pos;
      return;
    }
    ReadDirectiveToken() {
      let _this = this;
      let token = "";
      let _0_start;
      _0_start = _this.pos;
      L22: {
        while ((_this.pos) < (_this.len)) {
          C22: {
            let _1_c;
            _1_c = ((_this.src)[_this.pos]).charCodeAt(0);
            let _2_space = false;
            let _out0;
            _out0 = (_this).IsSpaceOrEol(_1_c);
            _2_space = _out0;
            if (_2_space) {
              break L22;
            }
            (_this).pos = (_this.pos) + (1);
          }
        }
      }
      token = Native.__default.slice(_this.src, _0_start, _this.pos);
      return token;
    }
    IsYamlVersionToken(s) {
      let _this = this;
      let yes = false;
      yes = false;
      let _0_n;
      _0_n = Native.__default.stringLength(s);
      let _1_i;
      _1_i = 0;
      let _2_digits;
      _2_digits = 0;
      while (((_1_i) < (_0_n)) && ((_this).IsDigit(((s)[_1_i]).charCodeAt(0)))) {
        _1_i = (_1_i) + (1);
        _2_digits = (_2_digits) + (1);
      }
      if ((((_2_digits) === (0)) || ((_1_i) >= (_0_n))) || ((((s)[_1_i]).charCodeAt(0)) !== (46))) {
        return yes;
      }
      _1_i = (_1_i) + (1);
      _2_digits = 0;
      while (((_1_i) < (_0_n)) && ((_this).IsDigit(((s)[_1_i]).charCodeAt(0)))) {
        _1_i = (_1_i) + (1);
        _2_digits = (_2_digits) + (1);
      }
      yes = ((_2_digits) > (0)) && ((_1_i) === (_0_n));
      return yes;
    }
    ParseYamlDirectiveArgs() {
      let _this = this;
      (_this).SkipInlineSpaces();
      let _0_token = "";
      let _out0;
      _out0 = (_this).ReadDirectiveToken();
      _0_token = _out0;
      let _1_validVersion = false;
      let _out1;
      _out1 = (_this).IsYamlVersionToken(_0_token);
      _1_validVersion = _out1;
      if (!(_1_validVersion)) {
        (_this).Fail("malformed %YAML directive: expected a MAJOR.MINOR version");
      }
      let _2_dot = 0;
      _2_dot = Native.__default.indexOf(_0_token, ".", 0);
      let _3_majorText;
      _3_majorText = Native.__default.slice(_0_token, 0, _2_dot);
      let _4_major;
      _4_major = Native.__default.numberAsCounter(Native.__default.parseNumber(_3_majorText));
      if ((_4_major) !== (1)) {
        (_this).Fail(Native.__default.concat("unsupported YAML major version: ", Native.__default._$$_toString(Native.__default.numberValue(_4_major))));
      }
      (_this).SkipInlineSpaces();
      if ((_this.pos) < (_this.len)) {
        let _5_c;
        _5_c = ((_this.src)[_this.pos]).charCodeAt(0);
        if ((((_5_c) !== (10)) && ((_5_c) !== (13))) && ((_5_c) !== (35))) {
          (_this).Fail("%YAML directive should contain exactly one part");
        }
      }
      return;
    }
    ParseTagDirectiveArgs() {
      let _this = this;
      (_this).SkipInlineSpaces();
      let _0_handle = "";
      let _out0;
      _out0 = (_this).ReadDirectiveToken();
      _0_handle = _out0;
      (_this).SkipInlineSpaces();
      let _1_prefix = "";
      let _out1;
      _out1 = (_this).ReadDirectiveToken();
      _1_prefix = _out1;
      if (((_dafny.areEqual(_0_handle, "")) || ((((_0_handle)[_dafny.ZERO]).charCodeAt(0)) !== (33))) || (_dafny.areEqual(_1_prefix, ""))) {
        (_this).Fail("malformed %TAG directive: expected a handle and a prefix");
      }
      if (!(_this.hasTagHandles)) {
        let _2_newTags;
        let _out2;
        _out2 = Native.__default.mapCreate();
        _2_newTags = _out2;
        (_this).tagHandles = Native.__default.mapValue(_2_newTags);
        (_this).hasTagHandles = true;
      }
      let _3_key;
      _3_key = Native.__default.stringValue(_0_handle);
      let _4_tags;
      _4_tags = Native.__default.mapFromValue(_this.tagHandles);
      let _5_duplicate = false;
      let _out3;
      _out3 = Native.__default.mapHas(_4_tags, _3_key);
      _5_duplicate = _out3;
      if (_5_duplicate) {
        (_this).Fail(Native.__default.concat("duplicate %TAG directive for handle '", Native.__default.concat(_0_handle, "'")));
      }
      Native.__default.mapSet(_4_tags, _3_key, Native.__default.stringValue(_1_prefix));
      return;
    }
    ParseDirectives() {
      let _this = this;
      let sawAny = false;
      (_this).tagHandles = Native.__default.undefinedValue;
      (_this).hasTagHandles = false;
      (_this).anchorMap = Native.__default.undefinedValue;
      (_this).hasAnchorMap = false;
      let _0_sawYaml;
      _0_sawYaml = false;
      sawAny = false;
      while ((((_this.pos) < (_this.len)) && ((_this.pos) === (_this.lineStart))) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (37))) {
        sawAny = true;
        (_this).pos = (_this.pos) + (1);
        let _1_name;
        let _out0;
        _out0 = (_this).ReadDirectiveToken();
        _1_name = _out0;
        if (_dafny.areEqual(_1_name, "YAML")) {
          if (_0_sawYaml) {
            (_this).Fail("a document must not contain more than one %YAML directive");
          }
          _0_sawYaml = true;
          (_this).ParseYamlDirectiveArgs();
        } else if (_dafny.areEqual(_1_name, "TAG")) {
          (_this).ParseTagDirectiveArgs();
        }
        (_this).FinishDirectiveLine();
        (_this).SkipBlankLines();
      }
      return sawAny;
    }
    IsSpaceOrEolAt(i) {
      let _this = this;
      let yes = false;
      if ((i) === (_this.len)) {
        yes = true;
        return yes;
      }
      let _0_c;
      _0_c = ((_this.src)[i]).charCodeAt(0);
      yes = ((((_0_c) === (32)) || ((_0_c) === (9))) || ((_0_c) === (10))) || ((_0_c) === (13));
      return yes;
    }
    ScanBlockPlainEnd() {
      let _this = this;
      let end = 0;
      let _0_start;
      _0_start = _this.pos;
      let _1_p;
      _1_p = _this.pos;
      (_this).plainStoppedAtColon = false;
      (_this).plainStoppedAtComment = false;
      L23: {
        while ((_1_p) < (_this.len)) {
          C23: {
            let _2_c;
            _2_c = ((_this.src)[_1_p]).charCodeAt(0);
            if (((_2_c) === (10)) || ((_2_c) === (13))) {
              break L23;
            }
            if ((_2_c) === (58)) {
              if (((_1_p) + (1)) === (_this.len)) {
                (_this).plainStoppedAtColon = true;
                break L23;
              }
              let _3_next;
              _3_next = ((_this.src)[(_1_p) + (1)]).charCodeAt(0);
              if (((((_3_next) === (32)) || ((_3_next) === (9))) || ((_3_next) === (10))) || ((_3_next) === (13))) {
                (_this).plainStoppedAtColon = true;
                break L23;
              }
            } else if (((_2_c) === (35)) && ((_1_p) > (_0_start))) {
              let _4_prev;
              _4_prev = ((_this.src)[(_1_p) - (1)]).charCodeAt(0);
              if (((_4_prev) === (32)) || ((_4_prev) === (9))) {
                (_this).plainStoppedAtComment = true;
                break L23;
              }
            }
            _1_p = (_1_p) + (1);
          }
        }
      }
      (_this).pos = _1_p;
      end = _1_p;
      while (((end) > (_0_start)) && (((((_this.src)[(end) - (1)]).charCodeAt(0)) === (32)) || ((((_this.src)[(end) - (1)]).charCodeAt(0)) === (9)))) {
        end = (end) - (1);
      }
      return end;
    }
    AdvanceCountingBreaks() {
      let _this = this;
      let breaks = 0;
      (_this).plainStoppedAtComment = false;
      (_this).SkipInlineSpaces();
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (35))) {
        (_this).plainStoppedAtComment = true;
        let _0_commentEnd = 0;
        _0_commentEnd = Native.__default.indexOf(_this.src, "\n", _this.pos);
        if ((_0_commentEnd) < (0)) {
          (_this).pos = _this.len;
        } else {
          (_this).pos = _0_commentEnd;
        }
      }
      breaks = 0;
      L24: {
        while (true) {
          C24: {
            if ((_this.pos) >= (_this.len)) {
              return breaks;
            }
            let _1_c;
            _1_c = ((_this.src)[_this.pos]).charCodeAt(0);
            if ((_1_c) === (10)) {
              (_this).pos = (_this.pos) + (1);
              (_this).lineStart = _this.pos;
              breaks = (breaks) + (1);
              break C24;
            }
            if ((_1_c) === (13)) {
              (_this).pos = (_this.pos) + (1);
              if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (10))) {
                (_this).pos = (_this.pos) + (1);
              }
              (_this).lineStart = _this.pos;
              breaks = (breaks) + (1);
              break C24;
            }
            let _2_p;
            _2_p = _this.pos;
            while (((_2_p) < (_this.len)) && (((((_this.src)[_2_p]).charCodeAt(0)) === (32)) || ((((_this.src)[_2_p]).charCodeAt(0)) === (9)))) {
              _2_p = (_2_p) + (1);
            }
            if ((_2_p) >= (_this.len)) {
              (_this).pos = _2_p;
              return breaks;
            }
            let _3_next;
            _3_next = ((_this.src)[_2_p]).charCodeAt(0);
            if (((_3_next) === (10)) || ((_3_next) === (13))) {
              (_this).pos = _2_p;
              break C24;
            }
            if ((_3_next) === (35)) {
              (_this).plainStoppedAtComment = true;
              let _4_nl = 0;
              _4_nl = Native.__default.indexOf(_this.src, "\n", _2_p);
              if ((_4_nl) < (0)) {
                (_this).pos = _this.len;
              } else {
                (_this).pos = (_4_nl) + (1);
                (_this).lineStart = _this.pos;
              }
              break C24;
            }
            (_this).pos = _2_p;
            return breaks;
          }
        }
      }
      return breaks;
    }
    ResolveBlockPlain(start, end, parentCol) {
      let _this = this;
      let value = undefined;
      let _0_breaks = 0;
      let _out0;
      _out0 = (_this).AdvanceCountingBreaks();
      _0_breaks = _out0;
      let _1_marker;
      _1_marker = false;
      if (((_this.pos) < (_this.len)) && ((_this.pos) === (_this.lineStart))) {
        let _out1;
        _out1 = (_this).IsDocMarkerAt(_this.pos);
        _1_marker = _out1;
      }
      if ((((_this.plainStoppedAtComment) || ((_this.pos) >= (_this.len))) || (((_this.pos) - (_this.lineStart)) <= (parentCol))) || (_1_marker)) {
        let _out2;
        _out2 = (_this).ResolvePlain(start, end);
        value = _out2;
        return value;
      }
      let _2_result;
      _2_result = Native.__default.slice(_this.src, start, end);
      L25: {
        while (true) {
          C25: {
            if ((_0_breaks) > (1)) {
              _2_result = Native.__default.concat(_2_result, Native.__default.repeat("\n", (_0_breaks) - (1)));
            } else {
              _2_result = Native.__default.concat(_2_result, " ");
            }
            let _3_segmentStart;
            _3_segmentStart = _this.pos;
            let _4_segmentEnd = 0;
            let _out3;
            _out3 = (_this).ScanBlockPlainEnd();
            _4_segmentEnd = _out3;
            _2_result = Native.__default.concat(_2_result, Native.__default.slice(_this.src, _3_segmentStart, _4_segmentEnd));
            if (_this.plainStoppedAtColon) {
              (_this).Fail("mapping value not allowed in a multi-line plain scalar");
            }
            let _out4;
            _out4 = (_this).AdvanceCountingBreaks();
            _0_breaks = _out4;
            _1_marker = false;
            if (((_this.pos) < (_this.len)) && ((_this.pos) === (_this.lineStart))) {
              let _out5;
              _out5 = (_this).IsDocMarkerAt(_this.pos);
              _1_marker = _out5;
            }
            if ((((_this.plainStoppedAtComment) || ((_this.pos) >= (_this.len))) || (((_this.pos) - (_this.lineStart)) <= (parentCol))) || (_1_marker)) {
              break L25;
            }
          }
        }
      }
      value = Native.__default.stringValue(_2_result);
      return value;
    }
    ResolveBlockPlainRaw(start, end, parentCol) {
      let _this = this;
      let text = "";
      let _0_breaks = 0;
      let _out0;
      _out0 = (_this).AdvanceCountingBreaks();
      _0_breaks = _out0;
      let _1_marker;
      _1_marker = false;
      if (((_this.pos) < (_this.len)) && ((_this.pos) === (_this.lineStart))) {
        let _out1;
        _out1 = (_this).IsDocMarkerAt(_this.pos);
        _1_marker = _out1;
      }
      if ((((_this.plainStoppedAtComment) || ((_this.pos) >= (_this.len))) || (((_this.pos) - (_this.lineStart)) <= (parentCol))) || (_1_marker)) {
        text = Native.__default.slice(_this.src, start, end);
        return text;
      }
      text = Native.__default.slice(_this.src, start, end);
      L26: {
        while (true) {
          C26: {
            if ((_0_breaks) > (1)) {
              text = Native.__default.concat(text, Native.__default.repeat("\n", (_0_breaks) - (1)));
            } else {
              text = Native.__default.concat(text, " ");
            }
            let _2_segmentStart;
            _2_segmentStart = _this.pos;
            let _3_segmentEnd = 0;
            let _out2;
            _out2 = (_this).ScanBlockPlainEnd();
            _3_segmentEnd = _out2;
            text = Native.__default.concat(text, Native.__default.slice(_this.src, _2_segmentStart, _3_segmentEnd));
            if (_this.plainStoppedAtColon) {
              (_this).Fail("mapping value not allowed in a multi-line plain scalar");
            }
            let _out3;
            _out3 = (_this).AdvanceCountingBreaks();
            _0_breaks = _out3;
            _1_marker = false;
            if (((_this.pos) < (_this.len)) && ((_this.pos) === (_this.lineStart))) {
              let _out4;
              _out4 = (_this).IsDocMarkerAt(_this.pos);
              _1_marker = _out4;
            }
            if ((((_this.plainStoppedAtComment) || ((_this.pos) >= (_this.len))) || (((_this.pos) - (_this.lineStart)) <= (parentCol))) || (_1_marker)) {
              break L26;
            }
          }
        }
      }
      return text;
    }
    ParseBlockValue(parentCol, isMapValue) {
      let _this = this;
      let value = undefined;
      (_this).SkipBlankLines();
      if ((_this.pos) >= (_this.len)) {
        value = Native.__default.nullValue;
        return value;
      }
      let _0_nextCol;
      _0_nextCol = (_this.pos) - (_this.lineStart);
      if ((_0_nextCol) > (parentCol)) {
        let _1_wsStart;
        _1_wsStart = _this.lineStart;
        let _2_contentPos;
        _2_contentPos = _this.pos;
        let _3_firstChar;
        _3_firstChar = ((_this.src)[_this.pos]).charCodeAt(0);
        if ((parentCol) >= (0)) {
          (_this).CheckNoTabIndent(parentCol);
        }
        let _out0;
        _out0 = (_this).ParseBlockNode(parentCol, isMapValue);
        value = _out0;
        if (_this.strict) {
          (_this).RejectBlockCollectionTabIndent(_1_wsStart, _2_contentPos, _3_firstChar, value, parentCol);
        }
        return value;
      }
      if (((isMapValue) && ((_0_nextCol) === (parentCol))) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (45))) {
        let _4_separator = false;
        let _out1;
        _out1 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
        _4_separator = _out1;
        if (_4_separator) {
          let _out2;
          _out2 = (_this).ParseBlockSeq(_0_nextCol);
          value = _out2;
          return value;
        }
      }
      value = Native.__default.nullValue;
      return value;
    }
    IsTabRestrictedCollection(value) {
      let _this = this;
      let yes = false;
      yes = false;
      if (Native.__default.isArray(value)) {
        yes = true;
        return yes;
      }
      if ((((Native.__default.isObject(value)) && (!(Native.__default.isUint8Array(value)))) && (!(Native.__default.isMap(value)))) && (!(Native.__default.isSet(value)))) {
        yes = true;
      }
      return yes;
    }
    IsPlainMapping(value) {
      let _this = this;
      let yes = false;
      yes = ((((Native.__default.isObject(value)) && (!(Native.__default.isArray(value)))) && (!(Native.__default.isUint8Array(value)))) && (!(Native.__default.isMap(value)))) && (!(Native.__default.isSet(value)));
      return yes;
    }
    CheckNoTabIndent(parentCol) {
      let _this = this;
      if ((parentCol) < (0)) {
        return;
      }
      let _0_i;
      _0_i = _this.lineStart;
      let _1_limit;
      _1_limit = ((_this.lineStart) + (parentCol)) + (1);
      while (((_0_i) < (_1_limit)) && ((_0_i) < (_this.pos))) {
        if ((((_this.src)[_0_i]).charCodeAt(0)) === (9)) {
          (_this).pos = _0_i;
          (_this).Fail("a tab character cannot be used as indentation");
        }
        _0_i = (_0_i) + (1);
      }
      return;
    }
    RejectBlockCollectionTabIndent(wsStart, contentPos, firstChar, value, parentCol) {
      let _this = this;
      let _0_restricted = false;
      let _out0;
      _out0 = (_this).IsTabRestrictedCollection(value);
      _0_restricted = _out0;
      if (!(_0_restricted)) {
        return;
      }
      if ((((((firstChar) === (91)) || ((firstChar) === (123))) || ((firstChar) === (34))) || ((firstChar) === (39))) || ((firstChar) === (42))) {
        return;
      }
      let _1_i;
      if ((parentCol) >= (0)) {
        _1_i = ((wsStart) + (parentCol)) + (1);
      } else {
        _1_i = wsStart;
      }
      while ((_1_i) < (contentPos)) {
        if ((((_this.src)[_1_i]).charCodeAt(0)) === (9)) {
          (_this).pos = _1_i;
          (_this).Fail("a tab character cannot be used as indentation");
        }
        _1_i = (_1_i) + (1);
      }
      return;
    }
    ParseRootBlockNode(parentCol) {
      let _this = this;
      let value = undefined;
      let _0_wsStart;
      _0_wsStart = _this.lineStart;
      let _1_contentPos;
      _1_contentPos = _this.pos;
      let _2_firstChar;
      _2_firstChar = ((_this.src)[_this.pos]).charCodeAt(0);
      let _out0;
      _out0 = (_this).ParseBlockNode(parentCol, false);
      value = _out0;
      if ((_this.strict) && ((parentCol) !== (-2))) {
        (_this).RejectBlockCollectionTabIndent(_0_wsStart, _1_contentPos, _2_firstChar, value, parentCol);
      }
      return value;
    }
    ParseBlockNode(parentCol, isMapValue) {
      let _this = this;
      let value = undefined;
      let _0_inlineProperty;
      _0_inlineProperty = _this.afterInlineProperty;
      (_this).afterInlineProperty = false;
      let _1_noBlockCollection;
      _1_noBlockCollection = _this.inlineMapValue;
      (_this).inlineMapValue = false;
      let _2_col;
      if ((_this.colOverride) >= (0)) {
        _2_col = _this.colOverride;
      } else {
        _2_col = (_this.pos) - (_this.lineStart);
      }
      (_this).colOverride = -1;
      let _3_c;
      _3_c = ((_this.src)[_this.pos]).charCodeAt(0);
      if ((_3_c) === (38)) {
        let _4_anchorCol;
        _4_anchorCol = _2_col;
        (_this).pos = (_this.pos) + (1);
        let _5_name = "";
        let _out0;
        _out0 = (_this).ScanAnchorOrAliasName();
        _5_name = _out0;
        let _6_savedPending;
        _6_savedPending = _this.pendingAnchorName;
        let _7_hadSavedPending;
        _7_hadSavedPending = _this.hasPendingAnchorName;
        (_this).pendingAnchorName = _5_name;
        (_this).hasPendingAnchorName = true;
        (_this).SkipInlineSpaces();
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (42))) {
          (_this).Fail("an alias node cannot carry an anchor property");
        }
        if (((((_this.pos) >= (_this.len)) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (10))) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (13))) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (35))) {
          let _8_innerAnchor;
          _8_innerAnchor = (_this.pos) < (_this.len);
          (_this).NextLine();
          _8_innerAnchor = ((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (38));
          let _out1;
          _out1 = (_this).ParseBlockValue(parentCol, isMapValue);
          value = _out1;
          let _9_plainMapping = false;
          let _out2;
          _out2 = (_this).IsPlainMapping(value);
          _9_plainMapping = _out2;
          if ((((_8_innerAnchor) && (_this.hasPendingAnchorName)) && (_dafny.areEqual(_this.pendingAnchorName, _5_name))) && (!(_9_plainMapping))) {
            (_this).Fail("a node can have at most one anchor");
          }
        } else {
          (_this).afterInlineProperty = true;
          (_this).colOverride = _4_anchorCol;
          let _out3;
          _out3 = (_this).ParseBlockNode(parentCol, isMapValue);
          value = _out3;
        }
        if ((_this.hasPendingAnchorName) && (_dafny.areEqual(_this.pendingAnchorName, _5_name))) {
          (_this).RegisterPendingAnchor(value);
        }
        (_this).pendingAnchorName = _6_savedPending;
        (_this).hasPendingAnchorName = _7_hadSavedPending;
        return value;
      }
      if ((((((_3_c) === (42)) || ((_3_c) === (91))) || ((_3_c) === (123))) || ((_3_c) === (34))) || ((_3_c) === (39))) {
        (_this).flowSpanned = false;
        let _10_savedFloor;
        _10_savedFloor = _this.flowIndentFloor;
        if (((((_3_c) === (91)) || ((_3_c) === (123))) || ((_3_c) === (34))) || ((_3_c) === (39))) {
          (_this).flowIndentFloor = parentCol;
        }
        let _11_node = undefined;
        if ((_3_c) === (34)) {
          (_this).quotedMultiline = false;
          let _out4;
          _out4 = (_this).ParseDoubleQuoted();
          _11_node = _out4;
        } else if ((_3_c) === (39)) {
          (_this).quotedMultiline = false;
          let _out5;
          _out5 = (_this).ParseSingleQuoted();
          _11_node = _out5;
        } else if ((_3_c) === (42)) {
          let _out6;
          _out6 = (_this).ParseAlias();
          _11_node = _out6;
        } else {
          let _out7;
          _out7 = (_this).ParseFlowValue();
          _11_node = _out7;
        }
        (_this).flowIndentFloor = _10_savedFloor;
        let _12_afterNode;
        _12_afterNode = _this.pos;
        (_this).SkipInlineSpaces();
        let _13_keySeparator;
        _13_keySeparator = false;
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (58))) {
          let _out8;
          _out8 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
          _13_keySeparator = _out8;
        }
        if (_13_keySeparator) {
          if ((parentCol) === (-2)) {
            (_this).Fail("a block mapping cannot start on the same line as a '---' document start");
          }
          if (_1_noBlockCollection) {
            (_this).Fail("a nested block mapping cannot start on the same line as a mapping key");
          }
          if ((((_3_c) === (34)) || ((_3_c) === (39))) && (_this.quotedMultiline)) {
            (_this).Fail("a multi-line quoted scalar cannot be a block mapping key");
          }
          if ((((_3_c) === (91)) || ((_3_c) === (123))) && (_this.flowSpanned)) {
            (_this).Fail("a multi-line flow collection cannot be a block mapping key");
          }
          if (_0_inlineProperty) {
            (_this).RegisterPendingAnchor(_11_node);
          }
          let _14_key;
          let _out9;
          _out9 = (_this).KeyToString(_11_node);
          _14_key = _out9;
          let _out10;
          _out10 = (_this).ParseBlockMap(_2_col, _14_key, true, false);
          value = _out10;
          return value;
        }
        (_this).pos = _12_afterNode;
        (_this).NextLine();
        value = _11_node;
        (_this).RegisterPendingAnchor(value);
        return value;
      }
      if (((_3_c) === (124)) || ((_3_c) === (62))) {
        let _out11;
        _out11 = (_this).ParseBlockScalar(parentCol);
        value = _out11;
        (_this).RegisterPendingAnchor(value);
        return value;
      }
      let _15_separator = false;
      let _out12;
      _out12 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
      _15_separator = _out12;
      if (((_3_c) === (45)) && (_15_separator)) {
        if ((parentCol) === (-2)) {
          (_this).Fail("a block sequence cannot start on the same line as a '---' document start");
        }
        if (_0_inlineProperty) {
          (_this).Fail("a block sequence cannot start on the same line as a node property (anchor)");
        }
        if (_1_noBlockCollection) {
          (_this).Fail("a block sequence cannot start on the same line as a mapping key");
        }
        let _out13;
        _out13 = (_this).ParseBlockSeq(_2_col);
        value = _out13;
        return value;
      }
      if (((_3_c) === (63)) && (_15_separator)) {
        if ((parentCol) === (-2)) {
          (_this).Fail("a block mapping cannot start on the same line as a '---' document start");
        }
        if (_0_inlineProperty) {
          (_this).Fail("a block mapping cannot start on the same line as a node property (anchor)");
        }
        if (_1_noBlockCollection) {
          (_this).Fail("a nested block mapping cannot start on the same line as a mapping key");
        }
        let _out14;
        _out14 = (_this).ParseBlockMapExplicit(_2_col);
        value = _out14;
        return value;
      }
      if ((_3_c) === (33)) {
        let _out15;
        _out15 = (_this).ParseTaggedBlockNode(parentCol, _2_col, isMapValue);
        value = _out15;
        return value;
      }
      if ((((_3_c) === (37)) || ((_3_c) === (64))) || ((_3_c) === (96))) {
        (_this).Fail("a plain scalar cannot start with a reserved indicator ('%', '@', or '`')");
      }
      let _16_start;
      _16_start = _this.pos;
      let _17_end = 0;
      let _out16;
      _out16 = (_this).ScanBlockPlainEnd();
      _17_end = _out16;
      if (_this.plainStoppedAtColon) {
        if ((parentCol) === (-2)) {
          (_this).Fail("a block mapping cannot start on the same line as a '---' document start");
        }
        if (_1_noBlockCollection) {
          (_this).Fail("a nested block mapping cannot start on the same line as a mapping key");
        }
        let _18_keyNode;
        let _out17;
        _out17 = (_this).ResolvePlain(_16_start, _17_end);
        _18_keyNode = _out17;
        if (_0_inlineProperty) {
          (_this).RegisterPendingAnchor(_18_keyNode);
        }
        let _19_key;
        let _out18;
        _out18 = (_this).KeyToString(_18_keyNode);
        _19_key = _out18;
        let _out19;
        _out19 = (_this).ParseBlockMap(_2_col, _19_key, true, false);
        value = _out19;
        return value;
      }
      let _out20;
      _out20 = (_this).ResolveBlockPlain(_16_start, _17_end, parentCol);
      value = _out20;
      (_this).RegisterPendingAnchor(value);
      return value;
    }
    ApplyCollectionTag(tag, value, kind) {
      let _this = this;
      let result = undefined;
      if ((_dafny.areEqual(tag, "!")) || (_dafny.areEqual(tag, "tag:yaml.org,2002:"))) {
        result = value;
        return result;
      }
      if ((_dafny.areEqual(tag, "tag:yaml.org,2002:map")) && (_dafny.areEqual(kind, "map"))) {
        result = value;
        return result;
      }
      if ((_dafny.areEqual(tag, "tag:yaml.org,2002:seq")) && (_dafny.areEqual(kind, "seq"))) {
        result = value;
        return result;
      }
      if (_dafny.areEqual(tag, "tag:yaml.org,2002:set")) {
        if (!_dafny.areEqual(kind, "map")) {
          (_this).Fail("the !!set tag requires a mapping node");
        }
        let _out0;
        _out0 = (_this.tagHelpers).BuildSet(value);
        result = _out0;
        let _0_setError = "";
        let _out1;
        _out1 = (_this.tagHelpers).ErrorMessage();
        _0_setError = _out1;
        if (!_dafny.areEqual(_0_setError, "")) {
          (_this).Fail(_0_setError);
        }
        return result;
      }
      if (_dafny.areEqual(tag, "tag:yaml.org,2002:omap")) {
        if (!_dafny.areEqual(kind, "seq")) {
          (_this).Fail("the !!omap tag requires a sequence node");
        }
        let _out2;
        _out2 = (_this.tagHelpers).BuildOmap(value);
        result = _out2;
        let _1_omapError = "";
        let _out3;
        _out3 = (_this.tagHelpers).ErrorMessage();
        _1_omapError = _out3;
        if (!_dafny.areEqual(_1_omapError, "")) {
          (_this).Fail(_1_omapError);
        }
        return result;
      }
      if (_dafny.areEqual(tag, "tag:yaml.org,2002:pairs")) {
        if (!_dafny.areEqual(kind, "seq")) {
          (_this).Fail("the !!pairs tag requires a sequence node");
        }
        (_this.tagHelpers).ValidatePairs(value);
        let _2_pairsError = "";
        let _out4;
        _out4 = (_this.tagHelpers).ErrorMessage();
        _2_pairsError = _out4;
        if (!_dafny.areEqual(_2_pairsError, "")) {
          (_this).Fail(_2_pairsError);
        }
        result = value;
        return result;
      }
      if (_dafny.areEqual(tag, "tag:yaml.org,2002:map")) {
        (_this).Fail("the !!map tag requires a mapping node");
      }
      if (_dafny.areEqual(tag, "tag:yaml.org,2002:seq")) {
        (_this).Fail("the !!seq tag requires a sequence node");
      }
      if ((((((_dafny.areEqual(tag, "tag:yaml.org,2002:int")) || (_dafny.areEqual(tag, "tag:yaml.org,2002:float"))) || (_dafny.areEqual(tag, "tag:yaml.org,2002:bool"))) || (_dafny.areEqual(tag, "tag:yaml.org,2002:null"))) || (_dafny.areEqual(tag, "tag:yaml.org,2002:binary"))) || (_dafny.areEqual(tag, "tag:yaml.org,2002:str"))) {
        let _3_tagName;
        _3_tagName = Native.__default.slice(tag, 18, Native.__default.stringLength(tag));
        let _4_kindName;
        if (_dafny.areEqual(kind, "map")) {
          _4_kindName = "mapping";
        } else {
          _4_kindName = "sequence";
        }
        (_this).Fail(Native.__default.concat("the !!", Native.__default.concat(_3_tagName, Native.__default.concat(" tag requires a scalar node, not a ", _4_kindName))));
      }
      result = value;
      return result;
    }
    ParseTaggedBlockNode(parentCol, col, isMapValue) {
      let _this = this;
      let value = undefined;
      let _0_savedPending;
      _0_savedPending = _this.pendingAnchorName;
      let _1_hadSavedPending;
      _1_hadSavedPending = _this.hasPendingAnchorName;
      let _2_tag = "";
      let _out0;
      _out0 = (_this).ScanTag();
      _2_tag = _out0;
      (_this).CheckTagSeparator(false);
      (_this).SkipInlineSpaces();
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (33))) {
        (_this).Fail("a node may carry at most one tag");
      }
      let _3_hasAnchor;
      _3_hasAnchor = false;
      let _4_anchorName;
      _4_anchorName = "";
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (38))) {
        (_this).pos = (_this.pos) + (1);
        let _out1;
        _out1 = (_this).ScanAnchorOrAliasName();
        _4_anchorName = _out1;
        _3_hasAnchor = true;
        (_this).pendingAnchorName = _4_anchorName;
        (_this).hasPendingAnchorName = true;
        (_this).SkipInlineSpaces();
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (38))) {
          (_this).Fail("a node may carry at most one anchor");
        }
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (33))) {
          (_this).Fail("a node may carry at most one tag");
        }
      }
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (42))) {
        (_this).Fail("an alias node cannot carry a tag/anchor property");
      }
      let _5_taggedDash;
      _5_taggedDash = false;
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (45))) {
        let _out2;
        _out2 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
        _5_taggedDash = _out2;
      }
      let _6_taggedQuestion;
      _6_taggedQuestion = false;
      if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (63))) {
        let _out3;
        _out3 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
        _6_taggedQuestion = _out3;
      }
      if (((((_this.pos) >= (_this.len)) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (10))) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (13))) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (35))) {
        (_this).NextLine();
        if (((_this.pos) >= (_this.len)) || (((_this.pos) - (_this.lineStart)) <= (parentCol))) {
          let _out4;
          _out4 = (_this).ApplyScalarTag(_2_tag, "");
          value = _out4;
        } else {
          let _7_effectiveParentCol;
          if ((parentCol) === (-2)) {
            _7_effectiveParentCol = -1;
          } else {
            _7_effectiveParentCol = parentCol;
          }
          let _8_child;
          let _out5;
          _out5 = (_this).ParseBlockNode(_7_effectiveParentCol, isMapValue);
          _8_child = _out5;
          if (Native.__default.isArray(_8_child)) {
            let _out6;
            _out6 = (_this).ApplyCollectionTag(_2_tag, _8_child, "seq");
            value = _out6;
          } else if (Native.__default.isObject(_8_child)) {
            let _out7;
            _out7 = (_this).ApplyCollectionTag(_2_tag, _8_child, "map");
            value = _out7;
          } else if (Native.__default.isString(_8_child)) {
            let _out8;
            _out8 = (_this).ApplyScalarTag(_2_tag, Native.__default.stringValueOf(_8_child));
            value = _out8;
          } else if ((((_dafny.areEqual(_2_tag, "!")) || (_dafny.areEqual(_2_tag, "tag:yaml.org,2002:"))) || (_dafny.areEqual(_2_tag, "tag:yaml.org,2002:map"))) || (_dafny.areEqual(_2_tag, "tag:yaml.org,2002:seq"))) {
            value = _8_child;
          } else {
            (_this).Fail("a tag cannot apply to an already-resolved nested scalar");
          }
        }
      } else if (_5_taggedDash) {
        if ((parentCol) === (-2)) {
          (_this).Fail("a block sequence cannot start on the same line as a '---' document start");
        }
        (_this).Fail("a block sequence cannot start on the same line as a node property (tag)");
      } else if (_6_taggedQuestion) {
        if ((parentCol) === (-2)) {
          (_this).Fail("a block mapping cannot start on the same line as a '---' document start");
        }
        (_this).Fail("a block mapping cannot start on the same line as a node property (tag)");
      } else if (((((_this.src)[_this.pos]).charCodeAt(0)) === (124)) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (62))) {
        let _9_scalar;
        let _out9;
        _out9 = (_this).ParseBlockScalar(parentCol);
        _9_scalar = _out9;
        let _out10;
        _out10 = (_this).ApplyScalarTag(_2_tag, Native.__default.stringValueOf(_9_scalar));
        value = _out10;
      } else if ((((_this.src)[_this.pos]).charCodeAt(0)) === (45)) {
        let _10_dashSeparator = false;
        let _out11;
        _out11 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
        _10_dashSeparator = _out11;
        if (!(_10_dashSeparator)) {
          let _11_start;
          _11_start = _this.pos;
          let _12_end = 0;
          let _out12;
          _out12 = (_this).ScanBlockPlainEnd();
          _12_end = _out12;
          let _13_raw;
          let _out13;
          _out13 = (_this).ResolveBlockPlainRaw(_11_start, _12_end, parentCol);
          _13_raw = _out13;
          let _out14;
          _out14 = (_this).ApplyScalarTag(_2_tag, _13_raw);
          value = _out14;
          return value;
        }
        let _14_sequenceValue;
        let _out15;
        _out15 = (_this).ParseBlockSeq(col);
        _14_sequenceValue = _out15;
        let _out16;
        _out16 = (_this).ApplyCollectionTag(_2_tag, _14_sequenceValue, "seq");
        value = _out16;
      } else if (((((((_this.src)[_this.pos]).charCodeAt(0)) === (91)) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (123))) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (34))) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (39))) {
        let _15_c;
        _15_c = ((_this.src)[_this.pos]).charCodeAt(0);
        let _16_kind;
        if ((_15_c) === (91)) {
          _16_kind = "seq";
        } else if ((_15_c) === (123)) {
          _16_kind = "map";
        } else {
          _16_kind = "scalar";
        }
        let _17_raw = undefined;
        if ((_15_c) === (91)) {
          let _out17;
          _out17 = (_this).ParseFlowSeq();
          _17_raw = _out17;
        } else if ((_15_c) === (123)) {
          let _out18;
          _out18 = (_this).ParseFlowMap();
          _17_raw = _out18;
        } else if ((_15_c) === (34)) {
          let _18_quoted;
          let _out19;
          _out19 = (_this).ParseDoubleQuoted();
          _18_quoted = _out19;
          _17_raw = Native.__default.stringValue(Native.__default.stringValueOf(_18_quoted));
        } else {
          let _19_quoted;
          let _out20;
          _out20 = (_this).ParseSingleQuoted();
          _19_quoted = _out20;
          _17_raw = Native.__default.stringValue(Native.__default.stringValueOf(_19_quoted));
        }
        (_this).SkipInlineSpaces();
        let _20_keySeparator;
        _20_keySeparator = false;
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (58))) {
          let _out21;
          _out21 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
          _20_keySeparator = _out21;
        }
        if (_20_keySeparator) {
          if ((parentCol) === (-2)) {
            (_this).Fail("a block mapping cannot start on the same line as a '---' document start");
          }
          let _21_keyNode = undefined;
          if (_dafny.areEqual(_16_kind, "scalar")) {
            let _out22;
            _out22 = (_this).ApplyScalarTag(_2_tag, Native.__default.stringValueOf(_17_raw));
            _21_keyNode = _out22;
          } else {
            let _out23;
            _out23 = (_this).ApplyCollectionTag(_2_tag, _17_raw, _16_kind);
            _21_keyNode = _out23;
          }
          (_this).RegisterPendingAnchor(_21_keyNode);
          let _22_key = "";
          let _out24;
          _out24 = (_this).KeyToString(_21_keyNode);
          _22_key = _out24;
          let _out25;
          _out25 = (_this).ParseBlockMap(col, _22_key, true, false);
          value = _out25;
        } else {
          (_this).NextLine();
          if (_dafny.areEqual(_16_kind, "scalar")) {
            let _out26;
            _out26 = (_this).ApplyScalarTag(_2_tag, Native.__default.stringValueOf(_17_raw));
            value = _out26;
          } else {
            let _out27;
            _out27 = (_this).ApplyCollectionTag(_2_tag, _17_raw, _16_kind);
            value = _out27;
          }
        }
      } else {
        let _23_start;
        _23_start = _this.pos;
        let _24_end = 0;
        let _out28;
        _out28 = (_this).ScanBlockPlainEnd();
        _24_end = _out28;
        if (_this.plainStoppedAtColon) {
          if ((parentCol) === (-2)) {
            (_this).Fail("a block mapping cannot start on the same line as a '---' document start");
          }
          let _25_keyNode;
          let _out29;
          _out29 = (_this).ApplyScalarTag(_2_tag, Native.__default.slice(_this.src, _23_start, _24_end));
          _25_keyNode = _out29;
          (_this).RegisterPendingAnchor(_25_keyNode);
          let _26_keyText;
          let _out30;
          _out30 = (_this).KeyToString(_25_keyNode);
          _26_keyText = _out30;
          let _out31;
          _out31 = (_this).ParseBlockMap(col, _26_keyText, true, false);
          value = _out31;
        } else {
          let _27_raw;
          let _out32;
          _out32 = (_this).ResolveBlockPlainRaw(_23_start, _24_end, parentCol);
          _27_raw = _out32;
          let _out33;
          _out33 = (_this).ApplyScalarTag(_2_tag, _27_raw);
          value = _out33;
        }
      }
      if (((_3_hasAnchor) && (_this.hasPendingAnchorName)) && (_dafny.areEqual(_this.pendingAnchorName, _4_anchorName))) {
        (_this).RegisterPendingAnchor(value);
      }
      (_this).pendingAnchorName = _0_savedPending;
      (_this).hasPendingAnchorName = _1_hadSavedPending;
      return value;
    }
    ParseBlockSeq(col) {
      let _this = this;
      let result = undefined;
      (_this).depth = (_this.depth) + (1);
      if ((_this.depth) > (1000)) {
        (_this).Fail("maximum nesting depth exceeded");
      }
      let _out0;
      _out0 = (_this).ParseBlockSeqBody(col);
      result = _out0;
      (_this).depth = (_this.depth) - (1);
      return result;
    }
    ParseBlockSeqBody(col) {
      let _this = this;
      let result = undefined;
      let _out0;
      _out0 = Native.__default.createArray();
      result = _out0;
      (_this).RegisterPendingAnchor(result);
      while (true) {
        if (((_this.pos) >= (_this.len)) || ((((_this.src)[_this.pos]).charCodeAt(0)) !== (45))) {
          return result;
        }
        let _0_separator = false;
        let _out1;
        _out1 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
        _0_separator = _out1;
        if (!(_0_separator)) {
          return result;
        }
        (_this).pos = (_this.pos) + (1);
        let _1_sawTab;
        _1_sawTab = false;
        while (((_this.pos) < (_this.len)) && (((((_this.src)[_this.pos]).charCodeAt(0)) === (32)) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (9)))) {
          if ((((_this.src)[_this.pos]).charCodeAt(0)) === (9)) {
            _1_sawTab = true;
          }
          (_this).pos = (_this.pos) + (1);
        }
        let _2_inlineTab;
        _2_inlineTab = ((((_1_sawTab) && ((_this.pos) < (_this.len))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (10))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (13))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (35));
        if (((((_this.pos) >= (_this.len)) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (10))) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (13))) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (35))) {
          (_this).NextLine();
          if (((_this.pos) >= (_this.len)) || (((_this.pos) - (_this.lineStart)) <= (col))) {
            Native.__default.arrayPush(result, Native.__default.nullValue);
          } else {
            let _3_nested = undefined;
            let _out2;
            _out2 = (_this).ParseBlockValue(col, false);
            _3_nested = _out2;
            Native.__default.arrayPush(result, _3_nested);
          }
        } else {
          let _4_child = undefined;
          let _out3;
          _out3 = (_this).ParseBlockNode(col, false);
          _4_child = _out3;
          let _5_restricted = false;
          let _out4;
          _out4 = (_this).IsTabRestrictedCollection(_4_child);
          _5_restricted = _out4;
          if ((_2_inlineTab) && (_5_restricted)) {
            (_this).Fail("a tab cannot indent a block sequence entry that opens a new collection");
          }
          Native.__default.arrayPush(result, _4_child);
        }
        if (((_this.pos) >= (_this.len)) || (((_this.pos) - (_this.lineStart)) !== (col))) {
          return result;
        }
        if ((((_this.src)[_this.pos]).charCodeAt(0)) !== (45)) {
          return result;
        }
        let _out5;
        _out5 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
        _0_separator = _out5;
        if (!(_0_separator)) {
          return result;
        }
        if (_this.strict) {
          (_this).CheckNoTabIndent((col) - (1));
        }
      }
      return result;
    }
    ParseExplicitKey(col) {
      let _this = this;
      let keyNode = undefined;
      let _0_p;
      _0_p = _this.pos;
      let _1_sawTab;
      _1_sawTab = false;
      while (((_0_p) < (_this.len)) && (((((_this.src)[_0_p]).charCodeAt(0)) === (32)) || ((((_this.src)[_0_p]).charCodeAt(0)) === (9)))) {
        if ((((_this.src)[_0_p]).charCodeAt(0)) === (9)) {
          _1_sawTab = true;
        }
        _0_p = (_0_p) + (1);
      }
      let _2_inlineContent;
      _2_inlineContent = ((((_0_p) < (_this.len)) && ((((_this.src)[_0_p]).charCodeAt(0)) !== (10))) && ((((_this.src)[_0_p]).charCodeAt(0)) !== (13))) && ((((_this.src)[_0_p]).charCodeAt(0)) !== (35));
      let _out0;
      _out0 = (_this).ParseExplicitKeyBody(col);
      keyNode = _out0;
      if ((_1_sawTab) && (_2_inlineContent)) {
        let _3_restricted = false;
        let _out1;
        _out1 = (_this).IsTabRestrictedCollection(keyNode);
        _3_restricted = _out1;
        if (_3_restricted) {
          (_this).Fail("a tab cannot separate '?' from a key that opens a new collection");
        }
      }
      return keyNode;
    }
    ParseExplicitKeyBody(col) {
      let _this = this;
      let keyNode = undefined;
      (_this).SkipInlineSpaces();
      if (((((_this.pos) >= (_this.len)) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (10))) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (13))) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (35))) {
        (_this).NextLine();
        let _out0;
        _out0 = (_this).ParseBlockValue(col, true);
        keyNode = _out0;
        return keyNode;
      }
      let _out1;
      _out1 = (_this).ParseBlockNode(col, false);
      keyNode = _out1;
      return keyNode;
    }
    ParseExplicitValue(col) {
      let _this = this;
      let value = undefined;
      let _0_p;
      _0_p = _this.pos;
      let _1_sawTab;
      _1_sawTab = false;
      while (((_0_p) < (_this.len)) && (((((_this.src)[_0_p]).charCodeAt(0)) === (32)) || ((((_this.src)[_0_p]).charCodeAt(0)) === (9)))) {
        if ((((_this.src)[_0_p]).charCodeAt(0)) === (9)) {
          _1_sawTab = true;
        }
        _0_p = (_0_p) + (1);
      }
      let _2_inlineContent;
      _2_inlineContent = ((((_0_p) < (_this.len)) && ((((_this.src)[_0_p]).charCodeAt(0)) !== (10))) && ((((_this.src)[_0_p]).charCodeAt(0)) !== (13))) && ((((_this.src)[_0_p]).charCodeAt(0)) !== (35));
      let _out0;
      _out0 = (_this).ParseExplicitValueBody(col);
      value = _out0;
      if ((_1_sawTab) && (_2_inlineContent)) {
        let _3_restricted = false;
        let _out1;
        _out1 = (_this).IsTabRestrictedCollection(value);
        _3_restricted = _out1;
        if (_3_restricted) {
          (_this).Fail("a tab cannot separate ':' from a value that opens a new collection");
        }
      }
      return value;
    }
    ParseExplicitValueBody(col) {
      let _this = this;
      let value = undefined;
      (_this).SkipInlineSpaces();
      if (((((_this.pos) >= (_this.len)) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (10))) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (13))) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (35))) {
        (_this).NextLine();
        let _out0;
        _out0 = (_this).ParseBlockValue(col, true);
        value = _out0;
        return value;
      }
      let _out1;
      _out1 = (_this).ParseBlockNode(col, false);
      value = _out1;
      return value;
    }
    ExplicitPairHasValue(col) {
      let _this = this;
      let hasValue = false;
      hasValue = false;
      if ((((_this.pos) < (_this.len)) && (((_this.pos) - (_this.lineStart)) === (col))) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (58))) {
        hasValue = true;
      }
      return hasValue;
    }
    ParseBlockMapExplicit(col) {
      let _this = this;
      let result = undefined;
      let _out0;
      _out0 = (_this).ParseBlockMapExplicitBody(col);
      result = _out0;
      return result;
    }
    ParseBlockMapExplicitBody(col) {
      let _this = this;
      let result = undefined;
      (_this).pos = (_this.pos) + (1);
      let _0_keyNode;
      let _out0;
      _out0 = (_this).ParseExplicitKey(col);
      _0_keyNode = _out0;
      let _1_keyText = "";
      let _out1;
      _out1 = (_this).KeyToString(_0_keyNode);
      _1_keyText = _out1;
      let _2_key;
      let _out2;
      _out2 = (_this).InternKey(_1_keyText);
      _2_key = _out2;
      let _3_hasValue;
      let _out3;
      _out3 = (_this).ExplicitPairHasValue(col);
      _3_hasValue = _out3;
      let _out4;
      _out4 = (_this).ParseBlockMap(col, _2_key, _3_hasValue, true);
      result = _out4;
      return result;
    }
    ParseBlockMap(col, firstKey, firstHasValue, firstIsExplicit) {
      let _this = this;
      let result = undefined;
      (_this).depth = (_this.depth) + (1);
      if ((_this.depth) > (1000)) {
        (_this).Fail("maximum nesting depth exceeded");
      }
      let _out0;
      _out0 = (_this).ParseBlockMapBody(col, firstKey, firstHasValue, firstIsExplicit);
      result = _out0;
      (_this).depth = (_this.depth) - (1);
      return result;
    }
    ParseBlockMapKey() {
      let _this = this;
      let key = "";
      let _0_c;
      _0_c = ((_this.src)[_this.pos]).charCodeAt(0);
      if ((_0_c) === (38)) {
        let _out0;
        _out0 = (_this).ParseBlockMapKeyAnchored();
        key = _out0;
        return key;
      }
      if ((_0_c) === (33)) {
        let _out1;
        _out1 = (_this).ParseBlockMapKeyTagged();
        key = _out1;
        return key;
      }
      if ((_0_c) === (42)) {
        let _1_node;
        let _out2;
        _out2 = (_this).ParseAlias();
        _1_node = _out2;
        let _2_sep;
        _2_sep = false;
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (58))) {
          let _out3;
          _out3 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
          _2_sep = _out3;
        }
        if (!(_2_sep)) {
          (_this).Fail("expected ':' after mapping key");
        }
        let _out4;
        _out4 = (_this).InternNodeKey(_1_node);
        key = _out4;
        return key;
      }
      if (((((_0_c) === (34)) || ((_0_c) === (39))) || ((_0_c) === (91))) || ((_0_c) === (123))) {
        let _3_node = undefined;
        if ((_0_c) === (34)) {
          (_this).quotedMultiline = false;
          let _out5;
          _out5 = (_this).ParseDoubleQuoted();
          _3_node = _out5;
        } else if ((_0_c) === (39)) {
          (_this).quotedMultiline = false;
          let _out6;
          _out6 = (_this).ParseSingleQuoted();
          _3_node = _out6;
        } else {
          let _out7;
          _out7 = (_this).ParseFlowValue();
          _3_node = _out7;
        }
        (_this).RegisterPendingAnchor(_3_node);
        if ((((_0_c) === (34)) || ((_0_c) === (39))) && (_this.quotedMultiline)) {
          (_this).Fail("a multi-line quoted scalar cannot be a block mapping key");
        }
        (_this).SkipInlineSpaces();
        let _4_sep;
        _4_sep = false;
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (58))) {
          let _out8;
          _out8 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
          _4_sep = _out8;
        }
        if (!(_4_sep)) {
          (_this).Fail("expected ':' after mapping key");
        }
        let _out9;
        _out9 = (_this).InternNodeKey(_3_node);
        key = _out9;
        return key;
      }
      let _5_start;
      _5_start = _this.pos;
      let _6_end = 0;
      let _out10;
      _out10 = (_this).ScanBlockPlainEnd();
      _6_end = _out10;
      if (!(_this.plainStoppedAtColon)) {
        (_this).Fail("expected ':' after mapping key");
      }
      let _7_node;
      let _out11;
      _out11 = (_this).ResolvePlain(_5_start, _6_end);
      _7_node = _out11;
      (_this).RegisterPendingAnchor(_7_node);
      let _out12;
      _out12 = (_this).InternNodeKey(_7_node);
      key = _out12;
      return key;
    }
    ParseBlockMapKeyAnchored() {
      let _this = this;
      let key = "";
      (_this).pos = (_this.pos) + (1);
      let _0_name = "";
      let _out0;
      _out0 = (_this).ScanAnchorOrAliasName();
      _0_name = _out0;
      (_this).SkipInlineSpaces();
      let _1_c;
      _1_c = -1;
      if ((_this.pos) < (_this.len)) {
        _1_c = ((_this.src)[_this.pos]).charCodeAt(0);
      }
      if ((_1_c) === (38)) {
        (_this).Fail("a node may carry at most one anchor");
      }
      let _2_tag;
      _2_tag = "";
      let _3_hasTag;
      _3_hasTag = false;
      if ((_1_c) === (33)) {
        let _out1;
        _out1 = (_this).ScanTag();
        _2_tag = _out1;
        (_this).CheckTagSeparator(false);
        (_this).SkipInlineSpaces();
        _1_c = -1;
        if ((_this.pos) < (_this.len)) {
          _1_c = ((_this.src)[_this.pos]).charCodeAt(0);
        }
        if ((_1_c) === (33)) {
          (_this).Fail("a node may carry at most one tag");
        }
        if ((_1_c) === (38)) {
          (_this).Fail("a node may carry at most one anchor");
        }
        _3_hasTag = true;
      }
      if ((_1_c) === (42)) {
        (_this).Fail("an alias node cannot carry an anchor property");
      }
      let _4_savedPending;
      _4_savedPending = _this.pendingAnchorName;
      let _5_hadSavedPending;
      _5_hadSavedPending = _this.hasPendingAnchorName;
      (_this).pendingAnchorName = _0_name;
      (_this).hasPendingAnchorName = true;
      if (_3_hasTag) {
        let _6_node;
        let _out2;
        _out2 = (_this).ParseTaggedBlockMapKeyRaw(_2_tag, _1_c);
        _6_node = _out2;
        (_this).RegisterPendingAnchor(_6_node);
        let _out3;
        _out3 = (_this).InternNodeKey(_6_node);
        key = _out3;
      } else {
        let _out4;
        _out4 = (_this).ParseBlockMapKey();
        key = _out4;
      }
      (_this).pendingAnchorName = _4_savedPending;
      (_this).hasPendingAnchorName = _5_hadSavedPending;
      return key;
    }
    ParseBlockMapKeyTagged() {
      let _this = this;
      let key = "";
      let _0_tag = "";
      let _out0;
      _out0 = (_this).ScanTag();
      _0_tag = _out0;
      (_this).CheckTagSeparator(false);
      (_this).SkipInlineSpaces();
      let _1_c;
      _1_c = -1;
      if ((_this.pos) < (_this.len)) {
        _1_c = ((_this.src)[_this.pos]).charCodeAt(0);
      }
      if ((_1_c) === (33)) {
        (_this).Fail("a node may carry at most one tag");
      }
      let _2_anchorName;
      _2_anchorName = "";
      let _3_hasAnchor;
      _3_hasAnchor = false;
      if ((_1_c) === (38)) {
        (_this).pos = (_this.pos) + (1);
        let _out1;
        _out1 = (_this).ScanAnchorOrAliasName();
        _2_anchorName = _out1;
        (_this).SkipInlineSpaces();
        _1_c = -1;
        if ((_this.pos) < (_this.len)) {
          _1_c = ((_this.src)[_this.pos]).charCodeAt(0);
        }
        if ((_1_c) === (38)) {
          (_this).Fail("a node may carry at most one anchor");
        }
        if ((_1_c) === (33)) {
          (_this).Fail("a node may carry at most one tag");
        }
        _3_hasAnchor = true;
      }
      if ((_1_c) === (42)) {
        (_this).Fail("an alias node cannot carry a tag/anchor property");
      }
      let _4_savedPending;
      _4_savedPending = _this.pendingAnchorName;
      let _5_hadSavedPending;
      _5_hadSavedPending = _this.hasPendingAnchorName;
      if (_3_hasAnchor) {
        (_this).pendingAnchorName = _2_anchorName;
        (_this).hasPendingAnchorName = true;
      }
      let _6_node;
      let _out2;
      _out2 = (_this).ParseTaggedBlockMapKeyRaw(_0_tag, _1_c);
      _6_node = _out2;
      if (_3_hasAnchor) {
        (_this).RegisterPendingAnchor(_6_node);
      }
      (_this).pendingAnchorName = _4_savedPending;
      (_this).hasPendingAnchorName = _5_hadSavedPending;
      let _out3;
      _out3 = (_this).InternNodeKey(_6_node);
      key = _out3;
      return key;
    }
    ParseTaggedBlockMapKeyRaw(tag, c) {
      let _this = this;
      let node = undefined;
      if (((((c) === (34)) || ((c) === (39))) || ((c) === (91))) || ((c) === (123))) {
        if ((c) === (34)) {
          let _0_quoted;
          let _out0;
          _out0 = (_this).ParseDoubleQuoted();
          _0_quoted = _out0;
          let _out1;
          _out1 = (_this).ApplyScalarTag(tag, Native.__default.stringValueOf(_0_quoted));
          node = _out1;
        } else if ((c) === (39)) {
          let _1_quoted;
          let _out2;
          _out2 = (_this).ParseSingleQuoted();
          _1_quoted = _out2;
          let _out3;
          _out3 = (_this).ApplyScalarTag(tag, Native.__default.stringValueOf(_1_quoted));
          node = _out3;
        } else if ((c) === (91)) {
          let _2_sequence;
          let _out4;
          _out4 = (_this).ParseFlowSeq();
          _2_sequence = _out4;
          let _out5;
          _out5 = (_this).ApplyCollectionTag(tag, _2_sequence, "seq");
          node = _out5;
        } else {
          let _3_mapping;
          let _out6;
          _out6 = (_this).ParseFlowMap();
          _3_mapping = _out6;
          let _out7;
          _out7 = (_this).ApplyCollectionTag(tag, _3_mapping, "map");
          node = _out7;
        }
        (_this).SkipInlineSpaces();
        let _4_sep;
        _4_sep = false;
        if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (58))) {
          let _out8;
          _out8 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
          _4_sep = _out8;
        }
        if (!(_4_sep)) {
          (_this).Fail("expected ':' after mapping key");
        }
        return node;
      }
      let _5_start;
      _5_start = _this.pos;
      let _6_end = 0;
      let _out9;
      _out9 = (_this).ScanBlockPlainEnd();
      _6_end = _out9;
      if (!(_this.plainStoppedAtColon)) {
        (_this).Fail("expected ':' after mapping key");
      }
      let _out10;
      _out10 = (_this).ApplyScalarTag(tag, Native.__default.slice(_this.src, _5_start, _6_end));
      node = _out10;
      return node;
    }
    ParseBlockMapBody(col, firstKey, firstHasValue, firstIsExplicit) {
      let _this = this;
      let result = undefined;
      let _out0;
      _out0 = Native.__default.createObject();
      result = _out0;
      (_this).RegisterPendingAnchor(result);
      let _0_key;
      let _out1;
      _out1 = (_this).InternKey(firstKey);
      _0_key = _out1;
      let _1_hasValue;
      _1_hasValue = firstHasValue;
      let _2_isExplicit;
      _2_isExplicit = firstIsExplicit;
      let _3_expected;
      _3_expected = _this.lastRecordKeys;
      let _4_hasExpected;
      _4_hasExpected = _this.hasLastRecordKeys;
      let _5_expectedLength;
      _5_expectedLength = 0;
      if (_4_hasExpected) {
        let _out2;
        _out2 = Native.__default.arrayLength(_3_expected);
        _5_expectedLength = _out2;
      }
      let _6_produced;
      _6_produced = _3_expected;
      let _7_matched;
      _7_matched = true;
      let _8_keyCount;
      _8_keyCount = 0;
      while (true) {
        if (((_7_matched) && (_4_hasExpected)) && ((_8_keyCount) < (_5_expectedLength))) {
          let _9_expectedValue = undefined;
          let _out3;
          _out3 = Native.__default.arrayGet(_3_expected, _8_keyCount);
          _9_expectedValue = _out3;
          if (!_dafny.areEqual(Native.__default.stringValueOf(_9_expectedValue), _0_key)) {
            let _out4;
            _out4 = Native.__default.createArray();
            _6_produced = _out4;
            let _10_copyIndex;
            _10_copyIndex = 0;
            while ((_10_copyIndex) < (_8_keyCount)) {
              let _11_previous = undefined;
              let _out5;
              _out5 = Native.__default.arrayGet(_3_expected, _10_copyIndex);
              _11_previous = _out5;
              Native.__default.arrayPush(_6_produced, _11_previous);
              _10_copyIndex = (_10_copyIndex) + (1);
            }
            Native.__default.arrayPush(_6_produced, Native.__default.stringValue(_0_key));
            _7_matched = false;
          }
        } else if (_7_matched) {
          let _out6;
          _out6 = Native.__default.createArray();
          _6_produced = _out6;
          if (_4_hasExpected) {
            let _12_copyIndex;
            _12_copyIndex = 0;
            while ((_12_copyIndex) < (_8_keyCount)) {
              let _13_previous = undefined;
              let _out7;
              _out7 = Native.__default.arrayGet(_3_expected, _12_copyIndex);
              _13_previous = _out7;
              Native.__default.arrayPush(_6_produced, _13_previous);
              _12_copyIndex = (_12_copyIndex) + (1);
            }
          }
          Native.__default.arrayPush(_6_produced, Native.__default.stringValue(_0_key));
          _7_matched = false;
        } else {
          Native.__default.arrayPush(_6_produced, Native.__default.stringValue(_0_key));
        }
        _8_keyCount = (_8_keyCount) + (1);
        let _14_value;
        _14_value = Native.__default.nullValue;
        if (_1_hasValue) {
          if (((_this.pos) >= (_this.len)) || ((((_this.src)[_this.pos]).charCodeAt(0)) !== (58))) {
            (_this).Fail("expected ':' after a block mapping key");
          }
          (_this).pos = (_this.pos) + (1);
          if (_2_isExplicit) {
            let _out8;
            _out8 = (_this).ParseExplicitValue(col);
            _14_value = _out8;
          } else {
            (_this).SkipInlineSpaces();
            if (((((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (10))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (13))) && ((((_this.src)[_this.pos]).charCodeAt(0)) !== (35))) {
              (_this).inlineMapValue = true;
              let _out9;
              _out9 = (_this).ParseBlockNode(col, true);
              _14_value = _out9;
            } else {
              (_this).NextLine();
              if (((_this.pos) < (_this.len)) && ((((_this.pos) - (_this.lineStart)) > (col)) || ((((_this.pos) - (_this.lineStart)) === (col)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (45))))) {
                let _out10;
                _out10 = (_this).ParseBlockValue(col, true);
                _14_value = _out10;
              }
            }
          }
        }
        (_this).StoreKey(result, _0_key, _14_value);
        _1_hasValue = true;
        _2_isExplicit = false;
        let _15_atDocumentMarker;
        _15_atDocumentMarker = false;
        if (((_this.pos) < (_this.len)) && (((_this.pos) - (_this.lineStart)) === (0))) {
          let _out11;
          _out11 = (_this).IsDocMarkerAt(_this.pos);
          _15_atDocumentMarker = _out11;
        }
        if (_15_atDocumentMarker) {
          (_this).PublishRecordKeys(_3_expected, _4_hasExpected, _6_produced, _7_matched, _8_keyCount, _5_expectedLength);
          return result;
        }
        if (((_this.pos) >= (_this.len)) || (((_this.pos) - (_this.lineStart)) !== (col))) {
          (_this).PublishRecordKeys(_3_expected, _4_hasExpected, _6_produced, _7_matched, _8_keyCount, _5_expectedLength);
          return result;
        }
        if ((((_this.src)[_this.pos]).charCodeAt(0)) === (45)) {
          let _16_dashSeparator = false;
          let _out12;
          _out12 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
          _16_dashSeparator = _out12;
          if (_16_dashSeparator) {
            (_this).PublishRecordKeys(_3_expected, _4_hasExpected, _6_produced, _7_matched, _8_keyCount, _5_expectedLength);
            return result;
          }
        }
        if (_this.strict) {
          (_this).CheckNoTabIndent((col) - (1));
        }
        let _17_fast;
        _17_fast = false;
        if ((((_7_matched) && (_4_hasExpected)) && ((_8_keyCount) < (_5_expectedLength))) && (!(_this.hasPendingAnchorName))) {
          let _18_expectedValue = undefined;
          let _out13;
          _out13 = Native.__default.arrayGet(_3_expected, _8_keyCount);
          _18_expectedValue = _out13;
          let _19_expectedKey;
          _19_expectedKey = Native.__default.stringValueOf(_18_expectedValue);
          let _out14;
          _out14 = (_this).FastMatchBlockKey(_19_expectedKey);
          _17_fast = _out14;
          if (_17_fast) {
            _0_key = _19_expectedKey;
          }
        }
        if (!(_17_fast)) {
          let _20_explicitIndicator;
          _20_explicitIndicator = false;
          let _21_emptyIndicator;
          _21_emptyIndicator = false;
          if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (63))) {
            let _out15;
            _out15 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
            _20_explicitIndicator = _out15;
          }
          if (((_this.pos) < (_this.len)) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (58))) {
            let _out16;
            _out16 = (_this).IsSpaceOrEolAt((_this.pos) + (1));
            _21_emptyIndicator = _out16;
          }
          if (_20_explicitIndicator) {
            (_this).pos = (_this.pos) + (1);
            let _22_explicitKey;
            let _out17;
            _out17 = (_this).ParseExplicitKey(col);
            _22_explicitKey = _out17;
            let _23_explicitKeyText = "";
            let _out18;
            _out18 = (_this).KeyToString(_22_explicitKey);
            _23_explicitKeyText = _out18;
            let _out19;
            _out19 = (_this).InternKey(_23_explicitKeyText);
            _0_key = _out19;
            let _out20;
            _out20 = (_this).ExplicitPairHasValue(col);
            _1_hasValue = _out20;
            _2_isExplicit = true;
          } else if (_21_emptyIndicator) {
            let _out21;
            _out21 = (_this).InternKey("");
            _0_key = _out21;
            _1_hasValue = true;
            _2_isExplicit = false;
          } else {
            let _out22;
            _out22 = (_this).ParseBlockMapKey();
            _0_key = _out22;
            _1_hasValue = true;
            _2_isExplicit = false;
          }
        }
      }
      return result;
    }
    ParseSingle() {
      let _this = this;
      let value = undefined;
      let _0_present = false;
      let _out0;
      let _out1;
      let _outcollector0 = (_this).ParseNextDocument();
      _out0 = _outcollector0[0];
      _out1 = _outcollector0[1];
      _0_present = _out0;
      value = _out1;
      if (!(_0_present)) {
        value = Native.__default.nullValue;
        return value;
      }
      let _1_another = false;
      let _2_ignored = undefined;
      let _out2;
      let _out3;
      let _outcollector1 = (_this).ParseNextDocument();
      _out2 = _outcollector1[0];
      _out3 = _outcollector1[1];
      _1_another = _out2;
      _2_ignored = _out3;
      if (_1_another) {
        (_this).Fail("expected a single document in the stream, but found more (use parseAll for multi-document streams)");
      }
      return value;
    }
    ParseAll() {
      let _this = this;
      let documents = undefined;
      let _out0;
      _out0 = Native.__default.createArray();
      documents = _out0;
      let _0_present = false;
      let _1_value = undefined;
      let _out1;
      let _out2;
      let _outcollector0 = (_this).ParseNextDocument();
      _out1 = _outcollector0[0];
      _out2 = _outcollector0[1];
      _0_present = _out1;
      _1_value = _out2;
      while (_0_present) {
        Native.__default.arrayPush(documents, _1_value);
        let _out3;
        let _out4;
        let _outcollector1 = (_this).ParseNextDocument();
        _out3 = _outcollector1[0];
        _out4 = _outcollector1[1];
        _0_present = _out3;
        _1_value = _out4;
      }
      return documents;
    }
    EndStream() {
      let _this = this;
      (_this).valueCache = Native.__default.undefinedValue;
      (_this).hasValueCache = false;
      (_this).valueCacheEnabled = false;
      (_this).strict = false;
      (_this).keyCacheMaxBytes = Native.__default.numberValue(4194304);
      return;
    }
    IsDocMarkerAt(i) {
      let _this = this;
      let yes = false;
      yes = false;
      if (((i) !== (_this.lineStart)) || (((i) + (2)) >= (_this.len))) {
        return yes;
      }
      let _0_c;
      _0_c = ((_this.src)[i]).charCodeAt(0);
      if (((_0_c) !== (45)) && ((_0_c) !== (46))) {
        return yes;
      }
      if (((((_this.src)[(i) + (1)]).charCodeAt(0)) !== (_0_c)) || ((((_this.src)[(i) + (2)]).charCodeAt(0)) !== (_0_c))) {
        return yes;
      }
      let _1_sep = false;
      let _out0;
      _out0 = (_this).IsSpaceOrEolAt((i) + (3));
      _1_sep = _out0;
      yes = _1_sep;
      return yes;
    }
    ConsumeDocStartMarker() {
      let _this = this;
      let inline = false;
      (_this).pos = (_this.pos) + (3);
      (_this).SkipInlineSpaces();
      if (((((_this.pos) >= (_this.len)) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (10))) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (13))) || ((((_this.src)[_this.pos]).charCodeAt(0)) === (35))) {
        (_this).NextLine();
        inline = false;
        return inline;
      }
      inline = true;
      return inline;
    }
    ConsumeDocEndMarker() {
      let _this = this;
      (_this).pos = (_this.pos) + (3);
      (_this).NextLine();
      return;
    }
    ParseNextDocument() {
      let _this = this;
      let present = false;
      let value = undefined;
      (_this).SkipBlankLines();
      if ((_this.pos) >= (_this.len)) {
        present = false;
        value = Native.__default.noDocumentValue;
        return [present, value];
      }
      let _0_sawDirectives = false;
      let _out0;
      _out0 = (_this).ParseDirectives();
      _0_sawDirectives = _out0;
      if ((_0_sawDirectives) && (!(_this.bareDocAllowed))) {
        (_this).Fail("a directives block must be preceded by an explicit '...' document end marker");
      }
      (_this).SkipBlankLines();
      if ((_this.pos) >= (_this.len)) {
        if (_0_sawDirectives) {
          (_this).Fail("a directives block must be terminated by an explicit '---' document start");
        }
        present = false;
        value = Native.__default.noDocumentValue;
        return [present, value];
      }
      let _1_marker = false;
      let _out1;
      _out1 = (_this).IsDocMarkerAt(_this.pos);
      _1_marker = _out1;
      let _2_isDash;
      _2_isDash = (_1_marker) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (45));
      if ((_0_sawDirectives) && (!(_2_isDash))) {
        (_this).Fail("a directives block must be terminated by an explicit '---' document start");
      }
      if (_1_marker) {
        if ((((_this.src)[_this.pos]).charCodeAt(0)) === (46)) {
          value = Native.__default.nullValue;
          (_this).ConsumeDocEndMarker();
          (_this).bareDocAllowed = true;
          present = true;
          return [present, value];
        }
        let _3_inline = false;
        let _out2;
        _out2 = (_this).ConsumeDocStartMarker();
        _3_inline = _out2;
        if ((_this.pos) >= (_this.len)) {
          value = Native.__default.nullValue;
        } else {
          let _4_nextMarker = false;
          let _out3;
          _out3 = (_this).IsDocMarkerAt(_this.pos);
          _4_nextMarker = _out3;
          if (_4_nextMarker) {
            value = Native.__default.nullValue;
          } else if (_3_inline) {
            let _out4;
            _out4 = (_this).ParseRootBlockNode(-2);
            value = _out4;
          } else {
            let _out5;
            _out5 = (_this).ParseRootBlockNode(-1);
            value = _out5;
          }
        }
      } else {
        if (!(_this.bareDocAllowed)) {
          (_this).Fail("expected a '---' before the next document (a bare document may only follow an explicit '...')");
        }
        let _out6;
        _out6 = (_this).ParseRootBlockNode(-1);
        value = _out6;
      }
      let _out7;
      _out7 = (_this).IsDocMarkerAt(_this.pos);
      _1_marker = _out7;
      if ((_1_marker) && ((((_this.src)[_this.pos]).charCodeAt(0)) === (46))) {
        (_this).ConsumeDocEndMarker();
        (_this).bareDocAllowed = true;
      } else {
        (_this).bareDocAllowed = false;
      }
      present = true;
      return [present, value];
    }
  };
  return $module;
})(); // end of module DafnyCore
let Serializer = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "Serializer._default";
    }
    _parentTraits() {
      return [];
    }
    static Stringify(value) {
      let text = "";
      let _0_writer;
      let _nw0 = new Serializer.Writer();
      _nw0.__ctor();
      _0_writer = _nw0;
      let _out0;
      _out0 = (_0_writer).Stringify(value);
      text = _out0;
      return text;
    }
    static get MAX__DEPTH() {
      return 1000;
    };
    static get BACKSLASH() {
      return 92;
    };
    static get DQUOTE() {
      return 34;
    };
    static get HEX() {
      return "0123456789ABCDEF";
    };
    static get SQUOTE() {
      return 39;
    };
    static get SPACE() {
      return 32;
    };
    static get MINUS() {
      return 45;
    };
    static get QUESTION() {
      return 63;
    };
    static get COLON() {
      return 58;
    };
    static get COMMA() {
      return 44;
    };
    static get LBRACKET() {
      return 91;
    };
    static get RBRACKET() {
      return 93;
    };
    static get LBRACE() {
      return 123;
    };
    static get RBRACE() {
      return 125;
    };
    static get HASH() {
      return 35;
    };
    static get AMP() {
      return 38;
    };
    static get STAR() {
      return 42;
    };
    static get EXCLAIM() {
      return 33;
    };
    static get PIPE() {
      return 124;
    };
    static get GT() {
      return 62;
    };
    static get PERCENT() {
      return 37;
    };
    static get AT() {
      return 64;
    };
    static get BACKTICK() {
      return 96;
    };
    static get PLUS() {
      return 43;
    };
    static get ZERO() {
      return 48;
    };
    static get DOT() {
      return 46;
    };
    static get LOWER__E() {
      return 101;
    };
    static get UPPER__E() {
      return 69;
    };
    static get ALPHABET() {
      return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    };
    static get INDENT__STEP() {
      return 2;
    };
    static get MAX__DUMP__KEY__CACHE() {
      return 10000;
    };
    static get TAB() {
      return 9;
    };
    static get LF() {
      return 10;
    };
    static get CR() {
      return 13;
    };
  };

  $module.Writer = class Writer {
    constructor () {
      this._tname = "Serializer.Writer";
      this.indentCache = undefined;
      this.dumpRefCounts = undefined;
      this.dumpAnchors = undefined;
      this.dumpAnchorSeq = 0;
      this.dumpDepth = 0;
      this.dumpKeyCache = undefined;
      this.dumpHasShared = false;
      this.out = "";
      this.dumpFlattenSink = 0;
    }
    _parentTraits() {
      return [];
    }
    __ctor() {
      let _this = this;
      let _out0;
      _out0 = Native.__default.createArray();
      (_this).indentCache = _out0;
      let _out1;
      _out1 = Native.__default.mapCreate();
      (_this).dumpRefCounts = _out1;
      let _out2;
      _out2 = Native.__default.mapCreate();
      (_this).dumpAnchors = _out2;
      let _out3;
      _out3 = Native.__default.mapCreate();
      (_this).dumpKeyCache = _out3;
      (_this).dumpAnchorSeq = 0;
      (_this).dumpDepth = 0;
      (_this).dumpHasShared = false;
      (_this).out = "";
      (_this).dumpFlattenSink = 0;
      Native.__default.arrayPush(_this.indentCache, Native.__default.stringValue(""));
      return;
    }
    IndentSpaces(n) {
      let _this = this;
      let spaces = "";
      let _0_length;
      let _out0;
      _out0 = Native.__default.arrayLength(_this.indentCache);
      _0_length = _out0;
      while ((_0_length) <= (n)) {
        let _1_last;
        _1_last = (_0_length) - (1);
        let _2_previousValue;
        let _out1;
        _out1 = Native.__default.arrayGet(_this.indentCache, _1_last);
        _2_previousValue = _out1;
        let _3_previous;
        _3_previous = Native.__default.stringValueOf(_2_previousValue);
        let _4_next;
        _4_next = Native.__default.concat(_3_previous, " ");
        Native.__default.arrayPush(_this.indentCache, Native.__default.stringValue(_4_next));
        _0_length = (_0_length) + (1);
      }
      let _5_result;
      let _out2;
      _out2 = Native.__default.arrayGet(_this.indentCache, n);
      _5_result = _out2;
      spaces = Native.__default.stringValueOf(_5_result);
      return spaces;
    }
    DumpScanRefs(value) {
      let _this = this;
      if ((!(Native.__default.isObject(value))) || (Native.__default.isNull(value))) {
        return;
      }
      let _0_present;
      let _out0;
      _out0 = Native.__default.mapHas(_this.dumpRefCounts, value);
      _0_present = _out0;
      if (_0_present) {
        let _1_oldValue;
        let _out1;
        _out1 = Native.__default.mapGet(_this.dumpRefCounts, value);
        _1_oldValue = _out1;
        let _2_oldCount;
        _2_oldCount = Native.__default.numberAsCounter(_1_oldValue);
        Native.__default.mapSet(_this.dumpRefCounts, value, Native.__default.numberValue((_2_oldCount) + (1)));
        (_this).dumpHasShared = true;
        return;
      }
      Native.__default.mapSet(_this.dumpRefCounts, value, Native.__default.numberValue(1));
      if (Native.__default.isUint8Array(value)) {
        return;
      }
      (_this).dumpDepth = (_this.dumpDepth) + (1);
      if ((_this.dumpDepth) > (Serializer.__default.MAX__DEPTH)) {
        Native.__default.fail("stringify: maximum nesting depth exceeded");
      }
      if (Native.__default.isArray(value)) {
        let _3_i;
        _3_i = 0;
        let _4_n;
        let _out2;
        _out2 = Native.__default.arrayLength(value);
        _4_n = _out2;
        while ((_3_i) < (_4_n)) {
          let _5_child;
          let _out3;
          _out3 = Native.__default.arrayGet(value, _3_i);
          _5_child = _out3;
          (_this).DumpScanRefs(_5_child);
          _3_i = (_3_i) + (1);
        }
      } else {
        let _6_keys;
        let _out4;
        _out4 = Native.__default.objectKeys(value);
        _6_keys = _out4;
        let _7_i;
        _7_i = 0;
        let _8_n;
        let _out5;
        _out5 = Native.__default.arrayLength(_6_keys);
        _8_n = _out5;
        while ((_7_i) < (_8_n)) {
          let _9_keyValue;
          let _out6;
          _out6 = Native.__default.arrayGet(_6_keys, _7_i);
          _9_keyValue = _out6;
          let _10_key;
          _10_key = Native.__default.stringValueOf(_9_keyValue);
          let _11_child;
          let _out7;
          _out7 = Native.__default.objectGet(value, _10_key);
          _11_child = _out7;
          (_this).DumpScanRefs(_11_child);
          _7_i = (_7_i) + (1);
        }
      }
      (_this).dumpDepth = (_this.dumpDepth) - (1);
      return;
    }
    DumpNeedsAnchor(obj) {
      let _this = this;
      let needs = false;
      let _0_refCount;
      let _out0;
      _out0 = Native.__default.mapGet(_this.dumpRefCounts, obj);
      _0_refCount = _out0;
      needs = (Native.__default.numberAsCounter(_0_refCount)) > (1);
      return needs;
    }
    DumpAssignAnchor(obj) {
      let _this = this;
      let name = "";
      (_this).dumpAnchorSeq = (_this.dumpAnchorSeq) + (1);
      let _0_sequence;
      let _out0;
      _out0 = (_this).FormatCounter(_this.dumpAnchorSeq);
      _0_sequence = _out0;
      name = Native.__default.concat("a", _0_sequence);
      Native.__default.mapSet(_this.dumpAnchors, obj, Native.__default.stringValue(name));
      return name;
    }
    IsPlainLeadingIndicator(c) {
      let _this = this;
      return (((((((((((((((((((c) === (Serializer.__default.MINUS)) || ((c) === (Serializer.__default.QUESTION))) || ((c) === (Serializer.__default.COLON))) || ((c) === (Serializer.__default.COMMA))) || ((c) === (Serializer.__default.LBRACKET))) || ((c) === (Serializer.__default.RBRACKET))) || ((c) === (Serializer.__default.LBRACE))) || ((c) === (Serializer.__default.RBRACE))) || ((c) === (Serializer.__default.HASH))) || ((c) === (Serializer.__default.AMP))) || ((c) === (Serializer.__default.STAR))) || ((c) === (Serializer.__default.EXCLAIM))) || ((c) === (Serializer.__default.PIPE))) || ((c) === (Serializer.__default.GT))) || ((c) === (Serializer.__default.SQUOTE))) || ((c) === (Serializer.__default.DQUOTE))) || ((c) === (Serializer.__default.PERCENT))) || ((c) === (Serializer.__default.AT))) || ((c) === (Serializer.__default.BACKTICK));
    };
    LooksLikeTypedScalar(s) {
      let _this = this;
      let typed = false;
      typed = (((((((((_dafny.areEqual(s, "~")) || (_dafny.areEqual(s, "null"))) || (_dafny.areEqual(s, "Null"))) || (_dafny.areEqual(s, "NULL"))) || (_dafny.areEqual(s, "true"))) || (_dafny.areEqual(s, "True"))) || (_dafny.areEqual(s, "TRUE"))) || (_dafny.areEqual(s, "false"))) || (_dafny.areEqual(s, "False"))) || (_dafny.areEqual(s, "FALSE"));
      if (typed) {
        return typed;
      }
      let _out0;
      _out0 = (_this).TryNumberGeneric(s);
      typed = _out0;
      return typed;
    }
    TryNumberGeneric(s) {
      let _this = this;
      let valid = false;
      let _0_end;
      _0_end = Native.__default.stringLength(s);
      let _1_p;
      _1_p = 0;
      let _2_c;
      _2_c = -1;
      if ((_0_end) > (0)) {
        _2_c = Native.__default.codeUnitAt(s, 0);
      }
      let _3_neg;
      _3_neg = (_2_c) === (Serializer.__default.MINUS);
      let _4_signed;
      _4_signed = (_3_neg) || ((_2_c) === (Serializer.__default.PLUS));
      if (_4_signed) {
        _1_p = 1;
        if ((_1_p) >= (_0_end)) {
          valid = false;
          return valid;
        }
        _2_c = Native.__default.codeUnitAt(s, _1_p);
      }
      if (((!(_4_signed)) && ((_2_c) === (Serializer.__default.ZERO))) && (((_1_p) + (1)) < (_0_end))) {
        let _5_n2;
        _5_n2 = Native.__default.codeUnitAt(s, (_1_p) + (1));
        if ((_5_n2) === (120)) {
          let _out0;
          _out0 = (_this).HexDigits(s, (_1_p) + (2), _0_end);
          valid = _out0;
          return valid;
        }
        if ((_5_n2) === (111)) {
          let _out1;
          _out1 = (_this).OctalDigits(s, (_1_p) + (2), _0_end);
          valid = _out1;
          return valid;
        }
      }
      if (((_2_c) === (Serializer.__default.DOT)) && (((_0_end) - (_1_p)) === (4))) {
        let _6_a;
        _6_a = Native.__default.codeUnitAt(s, (_1_p) + (1));
        let _7_b;
        _7_b = Native.__default.codeUnitAt(s, (_1_p) + (2));
        let _8_d;
        _8_d = Native.__default.codeUnitAt(s, (_1_p) + (3));
        if ((_this).IsInfWord(_6_a, _7_b, _8_d)) {
          valid = true;
          return valid;
        }
        if ((!(_4_signed)) && ((_this).IsNanWord(_6_a, _7_b, _8_d))) {
          valid = true;
          return valid;
        }
      }
      let _9_nd;
      _9_nd = 0;
      L27: {
        while ((_1_p) < (_0_end)) {
          C27: {
            let _10_d;
            _10_d = (Native.__default.codeUnitAt(s, _1_p)) - (Serializer.__default.ZERO);
            if (((_10_d) < (0)) || ((_10_d) > (9))) {
              break L27;
            }
            _9_nd = (_9_nd) + (1);
            _1_p = (_1_p) + (1);
          }
        }
      }
      if (((_1_p) < (_0_end)) && ((Native.__default.codeUnitAt(s, _1_p)) === (Serializer.__default.DOT))) {
        _1_p = (_1_p) + (1);
        L28: {
          while ((_1_p) < (_0_end)) {
            C28: {
              let _11_d;
              _11_d = (Native.__default.codeUnitAt(s, _1_p)) - (Serializer.__default.ZERO);
              if (((_11_d) < (0)) || ((_11_d) > (9))) {
                break L28;
              }
              _9_nd = (_9_nd) + (1);
              _1_p = (_1_p) + (1);
            }
          }
        }
      }
      if ((_9_nd) === (0)) {
        valid = false;
        return valid;
      }
      if (((_1_p) < (_0_end)) && (((Native.__default.codeUnitAt(s, _1_p)) === (Serializer.__default.LOWER__E)) || ((Native.__default.codeUnitAt(s, _1_p)) === (Serializer.__default.UPPER__E)))) {
        _1_p = (_1_p) + (1);
        if (((_1_p) < (_0_end)) && (((Native.__default.codeUnitAt(s, _1_p)) === (Serializer.__default.PLUS)) || ((Native.__default.codeUnitAt(s, _1_p)) === (Serializer.__default.MINUS)))) {
          _1_p = (_1_p) + (1);
        }
        let _12_expStart;
        _12_expStart = _1_p;
        L29: {
          while ((_1_p) < (_0_end)) {
            C29: {
              let _13_d;
              _13_d = (Native.__default.codeUnitAt(s, _1_p)) - (Serializer.__default.ZERO);
              if (((_13_d) < (0)) || ((_13_d) > (9))) {
                break L29;
              }
              _1_p = (_1_p) + (1);
            }
          }
        }
        if ((_1_p) === (_12_expStart)) {
          valid = false;
          return valid;
        }
      }
      valid = (_1_p) === (_0_end);
      return valid;
    }
    HexDigits(s, from, end) {
      let _this = this;
      let valid = false;
      if ((from) >= (end)) {
        valid = false;
        return valid;
      }
      let _0_p;
      _0_p = from;
      while ((_0_p) < (end)) {
        let _1_c;
        _1_c = Native.__default.codeUnitAt(s, _0_p);
        if (!(((((_1_c) >= (Serializer.__default.ZERO)) && ((_1_c) <= ((Serializer.__default.ZERO) + (9)))) || (((_1_c) >= (97)) && ((_1_c) <= (102)))) || (((_1_c) >= (65)) && ((_1_c) <= (70))))) {
          valid = false;
          return valid;
        }
        _0_p = (_0_p) + (1);
      }
      valid = true;
      return valid;
    }
    OctalDigits(s, from, end) {
      let _this = this;
      let valid = false;
      if ((from) >= (end)) {
        valid = false;
        return valid;
      }
      let _0_p;
      _0_p = from;
      while ((_0_p) < (end)) {
        let _1_c;
        _1_c = Native.__default.codeUnitAt(s, _0_p);
        if (((_1_c) < (Serializer.__default.ZERO)) || ((_1_c) > (55))) {
          valid = false;
          return valid;
        }
        _0_p = (_0_p) + (1);
      }
      valid = true;
      return valid;
    }
    IsInfWord(a, b, c) {
      let _this = this;
      return (((((a) === (105)) && ((b) === (110))) && ((c) === (102))) || ((((a) === (73)) && ((b) === (110))) && ((c) === (102)))) || ((((a) === (73)) && ((b) === (78))) && ((c) === (70)));
    };
    IsNanWord(a, b, c) {
      let _this = this;
      return (((((a) === (110)) && ((b) === (97))) && ((c) === (110))) || ((((a) === (78)) && ((b) === (97))) && ((c) === (78)))) || ((((a) === (78)) && ((b) === (65))) && ((c) === (78)));
    };
    IsPlainScalarSafe(s) {
      let _this = this;
      let safe = false;
      let _0_n;
      _0_n = Native.__default.stringLength(s);
      if ((_0_n) === (0)) {
        safe = false;
        return safe;
      }
      let _1_c0;
      _1_c0 = Native.__default.codeUnitAt(s, 0);
      if (((_1_c0) === (Serializer.__default.SPACE)) || ((_this).IsPlainLeadingIndicator(_1_c0))) {
        safe = false;
        return safe;
      }
      let _2_cLast;
      _2_cLast = Native.__default.codeUnitAt(s, (_0_n) - (1));
      if (((_2_cLast) === (Serializer.__default.SPACE)) || ((_2_cLast) === (Serializer.__default.COLON))) {
        safe = false;
        return safe;
      }
      let _3_i;
      _3_i = 0;
      while ((_3_i) < (_0_n)) {
        let _4_c;
        _4_c = Native.__default.codeUnitAt(s, _3_i);
        if (((_4_c) < (32)) || ((_4_c) === (127))) {
          safe = false;
          return safe;
        }
        if ((((_4_c) === (Serializer.__default.COLON)) && (((_3_i) + (1)) < (_0_n))) && ((Native.__default.codeUnitAt(s, (_3_i) + (1))) === (Serializer.__default.SPACE))) {
          safe = false;
          return safe;
        }
        if ((((_4_c) === (Serializer.__default.SPACE)) && (((_3_i) + (1)) < (_0_n))) && ((Native.__default.codeUnitAt(s, (_3_i) + (1))) === (Serializer.__default.HASH))) {
          safe = false;
          return safe;
        }
        _3_i = (_3_i) + (1);
      }
      let _5_typed;
      let _out0;
      _out0 = (_this).LooksLikeTypedScalar(s);
      _5_typed = _out0;
      safe = !(_5_typed);
      return safe;
    }
    NeedsDoubleQuoting(s) {
      let _this = this;
      let needs = false;
      let _0_i;
      _0_i = 0;
      let _1_n;
      _1_n = Native.__default.stringLength(s);
      while ((_0_i) < (_1_n)) {
        let _2_c;
        _2_c = Native.__default.codeUnitAt(s, _0_i);
        if (((_2_c) < (32)) || ((_2_c) === (127))) {
          needs = true;
          return needs;
        }
        _0_i = (_0_i) + (1);
      }
      needs = false;
      return needs;
    }
    EncodeSingleQuoted(s) {
      let _this = this;
      let encoded = "";
      let _0_parts;
      let _out0;
      _out0 = Native.__default.createArray();
      _0_parts = _out0;
      Native.__default.arrayPush(_0_parts, Native.__default.stringValue("'"));
      let _1_seg;
      _1_seg = 0;
      let _2_i;
      _2_i = 0;
      let _3_n;
      _3_n = Native.__default.stringLength(s);
      while ((_2_i) < (_3_n)) {
        if ((Native.__default.codeUnitAt(s, _2_i)) === (Serializer.__default.SQUOTE)) {
          Native.__default.arrayPush(_0_parts, Native.__default.stringValue(Native.__default.slice(s, _1_seg, _2_i)));
          Native.__default.arrayPush(_0_parts, Native.__default.stringValue("''"));
          _1_seg = (_2_i) + (1);
        }
        _2_i = (_2_i) + (1);
      }
      Native.__default.arrayPush(_0_parts, Native.__default.stringValue(Native.__default.slice(s, _1_seg, _3_n)));
      Native.__default.arrayPush(_0_parts, Native.__default.stringValue("'"));
      encoded = Native.__default.join(_0_parts, "");
      return encoded;
    }
    HexEscape(c) {
      let _this = this;
      let escaped = "";
      let _0_hi;
      _0_hi = _dafny.EuclideanDivisionNumber(c, 16);
      let _1_lo;
      _1_lo = _dafny.EuclideanModuloNumber(c, 16);
      let _2_digit;
      _2_digit = Native.__default.slice(Serializer.__default.HEX, _0_hi, (_0_hi) + (1));
      let _3_last;
      _3_last = Native.__default.slice(Serializer.__default.HEX, _1_lo, (_1_lo) + (1));
      if ((c) < (16)) {
        escaped = Native.__default.concat("\\x0", _3_last);
      } else {
        escaped = Native.__default.concat("\\x", Native.__default.concat(_2_digit, _3_last));
      }
      return escaped;
    }
    EncodeDoubleQuoted(s) {
      let _this = this;
      let encoded = "";
      let _0_parts;
      let _out0;
      _out0 = Native.__default.createArray();
      _0_parts = _out0;
      Native.__default.arrayPush(_0_parts, Native.__default.stringValue("\""));
      let _1_seg;
      _1_seg = 0;
      let _2_i;
      _2_i = 0;
      let _3_n;
      _3_n = Native.__default.stringLength(s);
      while ((_2_i) < (_3_n)) {
        let _4_c;
        _4_c = Native.__default.codeUnitAt(s, _2_i);
        let _5_esc;
        _5_esc = "";
        let _6_found;
        _6_found = true;
        if ((_4_c) === (Serializer.__default.BACKSLASH)) {
          _5_esc = "\\\\";
        } else if ((_4_c) === (Serializer.__default.DQUOTE)) {
          _5_esc = "\\\"";
        } else if ((_4_c) === (0)) {
          _5_esc = "\\0";
        } else if ((_4_c) === (7)) {
          _5_esc = "\\a";
        } else if ((_4_c) === (8)) {
          _5_esc = "\\b";
        } else if ((_4_c) === (9)) {
          _5_esc = "\\t";
        } else if ((_4_c) === (10)) {
          _5_esc = "\\n";
        } else if ((_4_c) === (11)) {
          _5_esc = "\\v";
        } else if ((_4_c) === (12)) {
          _5_esc = "\\f";
        } else if ((_4_c) === (13)) {
          _5_esc = "\\r";
        } else if ((_4_c) === (27)) {
          _5_esc = "\\e";
        } else if (((_4_c) < (32)) || ((_4_c) === (127))) {
          let _out1;
          _out1 = (_this).HexEscape(_4_c);
          _5_esc = _out1;
        } else {
          _6_found = false;
        }
        if (_6_found) {
          if ((_2_i) > (_1_seg)) {
            Native.__default.arrayPush(_0_parts, Native.__default.stringValue(Native.__default.slice(s, _1_seg, _2_i)));
          }
          Native.__default.arrayPush(_0_parts, Native.__default.stringValue(_5_esc));
          _1_seg = (_2_i) + (1);
        }
        _2_i = (_2_i) + (1);
      }
      Native.__default.arrayPush(_0_parts, Native.__default.stringValue(Native.__default.slice(s, _1_seg, _3_n)));
      Native.__default.arrayPush(_0_parts, Native.__default.stringValue("\""));
      encoded = Native.__default.join(_0_parts, "");
      return encoded;
    }
    WriteStringScalar(s) {
      let _this = this;
      let rendered = "";
      let _0_safe;
      let _out0;
      _out0 = (_this).IsPlainScalarSafe(s);
      _0_safe = _out0;
      if (_0_safe) {
        rendered = s;
        return rendered;
      }
      let _1_needsDouble;
      let _out1;
      _out1 = (_this).NeedsDoubleQuoting(s);
      _1_needsDouble = _out1;
      if (_1_needsDouble) {
        let _out2;
        _out2 = (_this).EncodeDoubleQuoted(s);
        rendered = _out2;
      } else {
        let _out3;
        _out3 = (_this).EncodeSingleQuoted(s);
        rendered = _out3;
      }
      return rendered;
    }
    WriteRootStringScalar(s) {
      let _this = this;
      let rendered = "";
      if ((_dafny.areEqual(s, "...")) || (((Native.__default.stringLength(s)) >= (4)) && (_dafny.areEqual(Native.__default.slice(s, 0, 4), "... ")))) {
        let _0_needsDouble;
        let _out0;
        _out0 = (_this).NeedsDoubleQuoting(s);
        _0_needsDouble = _out0;
        if (_0_needsDouble) {
          let _out1;
          _out1 = (_this).EncodeDoubleQuoted(s);
          rendered = _out1;
        } else {
          let _out2;
          _out2 = (_this).EncodeSingleQuoted(s);
          rendered = _out2;
        }
        return rendered;
      }
      let _out3;
      _out3 = (_this).WriteStringScalar(s);
      rendered = _out3;
      return rendered;
    }
    FormatCounter(n) {
      let _this = this;
      let text = "";
      text = Native.__default.formatNumber(Native.__default.numberValue(n));
      return text;
    }
    FormatNumberValue(v) {
      let _this = this;
      let text = "";
      if (Native.__default.numberIsNaN(v)) {
        text = ".nan";
        return text;
      }
      if (Native.__default.numberIsPositiveInfinity(v)) {
        text = ".inf";
        return text;
      }
      if (Native.__default.numberIsNegativeInfinity(v)) {
        text = "-.inf";
        return text;
      }
      if (Native.__default.numberIsNegativeZero(v)) {
        text = "-0";
        return text;
      }
      text = Native.__default.formatNumber(v);
      return text;
    }
    WriteScalar(value) {
      let _this = this;
      let text = "";
      if ((Native.__default.isNull(value)) || (Native.__default.isUndefined(value))) {
        text = "null";
        return text;
      }
      if (Native.__default.isBoolean(value)) {
        if (Native.__default.booleanValue(value)) {
          text = "true";
        } else {
          text = "false";
        }
        return text;
      }
      if (Native.__default.isNumber(value)) {
        let _out0;
        _out0 = (_this).FormatNumberValue(value);
        text = _out0;
        return text;
      }
      if (Native.__default.isString(value)) {
        let _out1;
        _out1 = (_this).WriteStringScalar(Native.__default.stringValueOf(value));
        text = _out1;
        return text;
      }
      let _0_fallback;
      _0_fallback = Native.__default.stringFallback(value);
      let _out2;
      _out2 = (_this).WriteStringScalar(_0_fallback);
      text = _out2;
      return text;
    }
    EncodeBase64(bytes) {
      let _this = this;
      let encoded = "";
      let _0_n;
      _0_n = Native.__default.byteLength(bytes);
      if ((_0_n) === (0)) {
        encoded = "";
        return encoded;
      }
      let _1_parts;
      let _out0;
      _out0 = Native.__default.createArray();
      _1_parts = _out0;
      let _2_i;
      _2_i = 0;
      while (((_2_i) + (3)) <= (_0_n)) {
        let _3_b0;
        _3_b0 = Native.__default.byteGet(bytes, _2_i);
        let _4_b1;
        _4_b1 = Native.__default.byteGet(bytes, (_2_i) + (1));
        let _5_b2;
        _5_b2 = Native.__default.byteGet(bytes, (_2_i) + (2));
        let _6_triple;
        _6_triple = (((_3_b0) * (65536)) + ((_4_b1) * (256))) + (_5_b2);
        let _7_a;
        _7_a = _dafny.EuclideanDivisionNumber(_6_triple, 262144);
        let _8_b;
        _8_b = _dafny.EuclideanModuloNumber(_dafny.EuclideanDivisionNumber(_6_triple, 4096), 64);
        let _9_c;
        _9_c = _dafny.EuclideanModuloNumber(_dafny.EuclideanDivisionNumber(_6_triple, 64), 64);
        let _10_d;
        _10_d = _dafny.EuclideanModuloNumber(_6_triple, 64);
        Native.__default.arrayPush(_1_parts, Native.__default.stringValue(Native.__default.slice(Serializer.__default.ALPHABET, _7_a, (_7_a) + (1))));
        Native.__default.arrayPush(_1_parts, Native.__default.stringValue(Native.__default.slice(Serializer.__default.ALPHABET, _8_b, (_8_b) + (1))));
        Native.__default.arrayPush(_1_parts, Native.__default.stringValue(Native.__default.slice(Serializer.__default.ALPHABET, _9_c, (_9_c) + (1))));
        Native.__default.arrayPush(_1_parts, Native.__default.stringValue(Native.__default.slice(Serializer.__default.ALPHABET, _10_d, (_10_d) + (1))));
        _2_i = (_2_i) + (3);
      }
      let _11_rem;
      _11_rem = (_0_n) - (_2_i);
      if ((_11_rem) === (1)) {
        let _12_triple;
        _12_triple = (Native.__default.byteGet(bytes, _2_i)) * (65536);
        let _13_a;
        _13_a = _dafny.EuclideanDivisionNumber(_12_triple, 262144);
        let _14_b;
        _14_b = _dafny.EuclideanModuloNumber(_dafny.EuclideanDivisionNumber(_12_triple, 4096), 64);
        Native.__default.arrayPush(_1_parts, Native.__default.stringValue(Native.__default.slice(Serializer.__default.ALPHABET, _13_a, (_13_a) + (1))));
        Native.__default.arrayPush(_1_parts, Native.__default.stringValue(Native.__default.slice(Serializer.__default.ALPHABET, _14_b, (_14_b) + (1))));
        Native.__default.arrayPush(_1_parts, Native.__default.stringValue("="));
        Native.__default.arrayPush(_1_parts, Native.__default.stringValue("="));
      } else if ((_11_rem) === (2)) {
        let _15_triple;
        _15_triple = ((Native.__default.byteGet(bytes, _2_i)) * (65536)) + ((Native.__default.byteGet(bytes, (_2_i) + (1))) * (256));
        let _16_a;
        _16_a = _dafny.EuclideanDivisionNumber(_15_triple, 262144);
        let _17_b;
        _17_b = _dafny.EuclideanModuloNumber(_dafny.EuclideanDivisionNumber(_15_triple, 4096), 64);
        let _18_c;
        _18_c = _dafny.EuclideanModuloNumber(_dafny.EuclideanDivisionNumber(_15_triple, 64), 64);
        Native.__default.arrayPush(_1_parts, Native.__default.stringValue(Native.__default.slice(Serializer.__default.ALPHABET, _16_a, (_16_a) + (1))));
        Native.__default.arrayPush(_1_parts, Native.__default.stringValue(Native.__default.slice(Serializer.__default.ALPHABET, _17_b, (_17_b) + (1))));
        Native.__default.arrayPush(_1_parts, Native.__default.stringValue(Native.__default.slice(Serializer.__default.ALPHABET, _18_c, (_18_c) + (1))));
        Native.__default.arrayPush(_1_parts, Native.__default.stringValue("="));
      }
      encoded = Native.__default.join(_1_parts, "");
      return encoded;
    }
    WriteBinaryScalar(bytes) {
      let _this = this;
      let text = "";
      let _0_b64;
      let _out0;
      _out0 = (_this).EncodeBase64(bytes);
      _0_b64 = _out0;
      if (_dafny.areEqual(_0_b64, "")) {
        text = "!!binary \"\"";
      } else {
        text = Native.__default.concat("!!binary ", _0_b64);
      }
      return text;
    }
    IsEmptyContainer(obj, isArr) {
      let _this = this;
      let empty = false;
      if (isArr) {
        let _0_count;
        let _out0;
        _out0 = Native.__default.arrayLength(obj);
        _0_count = _out0;
        empty = (_0_count) === (0);
      } else {
        let _1_keys;
        let _out1;
        _out1 = Native.__default.objectKeys(obj);
        _1_keys = _out1;
        let _2_count;
        let _out2;
        _out2 = Native.__default.arrayLength(_1_keys);
        _2_count = _out2;
        empty = (_2_count) === (0);
      }
      return empty;
    }
    WriteCollectionBody(obj, isArr, indent) {
      let _this = this;
      (_this).dumpDepth = (_this.dumpDepth) + (1);
      if ((_this.dumpDepth) > (Serializer.__default.MAX__DEPTH)) {
        Native.__default.fail("stringify: maximum nesting depth exceeded");
      }
      let _0_ind;
      let _out0;
      _out0 = (_this).IndentSpaces(indent);
      _0_ind = _out0;
      if (isArr) {
        let _1_i;
        _1_i = 0;
        let _2_n;
        let _out1;
        _out1 = Native.__default.arrayLength(obj);
        _2_n = _out1;
        while ((_1_i) < (_2_n)) {
          (_this).out = Native.__default.concat(_this.out, Native.__default.concat(_0_ind, "-"));
          let _3_value;
          let _out2;
          _out2 = Native.__default.arrayGet(obj, _1_i);
          _3_value = _out2;
          (_this).WriteEntryValue(_3_value, indent);
          _1_i = (_1_i) + (1);
        }
      } else {
        let _4_keys;
        let _out3;
        _out3 = Native.__default.objectKeys(obj);
        _4_keys = _out3;
        let _5_i;
        _5_i = 0;
        let _6_n;
        let _out4;
        _out4 = Native.__default.arrayLength(_4_keys);
        _6_n = _out4;
        while ((_5_i) < (_6_n)) {
          let _7_keyValue;
          let _out5;
          _out5 = Native.__default.arrayGet(_4_keys, _5_i);
          _7_keyValue = _out5;
          let _8_k;
          _8_k = Native.__default.stringValueOf(_7_keyValue);
          _7_keyValue = Native.__default.stringValue(_8_k);
          let _9_keyColon;
          _9_keyColon = "";
          let _10_cached;
          let _out6;
          _out6 = Native.__default.mapHas(_this.dumpKeyCache, _7_keyValue);
          _10_cached = _out6;
          if (_10_cached) {
            let _11_cacheValue;
            let _out7;
            _out7 = Native.__default.mapGet(_this.dumpKeyCache, _7_keyValue);
            _11_cacheValue = _out7;
            _9_keyColon = Native.__default.stringValueOf(_11_cacheValue);
          } else {
            let _12_rendered;
            let _out8;
            _out8 = (_this).WriteStringScalar(_8_k);
            _12_rendered = _out8;
            _9_keyColon = Native.__default.concat(_12_rendered, ":");
            let _13_cacheSize;
            let _out9;
            _out9 = Native.__default.mapSize(_this.dumpKeyCache);
            _13_cacheSize = _out9;
            if ((_13_cacheSize) < (Serializer.__default.MAX__DUMP__KEY__CACHE)) {
              Native.__default.mapSet(_this.dumpKeyCache, _7_keyValue, Native.__default.stringValue(_9_keyColon));
            }
          }
          (_this).out = Native.__default.concat(_this.out, Native.__default.concat(_0_ind, _9_keyColon));
          let _14_value;
          let _out10;
          _out10 = Native.__default.objectGet(obj, _8_k);
          _14_value = _out10;
          (_this).WriteEntryValue(_14_value, indent);
          _5_i = (_5_i) + (1);
        }
      }
      (_this).dumpDepth = (_this.dumpDepth) - (1);
      return;
    }
    WriteEntryValue(value, indent) {
      let _this = this;
      if ((!(Native.__default.isObject(value))) || (Native.__default.isNull(value))) {
        let _0_scalar;
        let _out0;
        _out0 = (_this).WriteScalar(value);
        _0_scalar = _out0;
        (_this).out = Native.__default.concat(_this.out, Native.__default.concat(" ", Native.__default.concat(_0_scalar, "\n")));
        return;
      }
      let _1_hasExistingAnchor;
      _1_hasExistingAnchor = false;
      if (_this.dumpHasShared) {
        let _out1;
        _out1 = Native.__default.mapHas(_this.dumpAnchors, value);
        _1_hasExistingAnchor = _out1;
      }
      if (_1_hasExistingAnchor) {
        let _2_anchorValue;
        let _out2;
        _out2 = Native.__default.mapGet(_this.dumpAnchors, value);
        _2_anchorValue = _out2;
        let _3_already;
        _3_already = Native.__default.stringValueOf(_2_anchorValue);
        (_this).out = Native.__default.concat(_this.out, Native.__default.concat(" *", Native.__default.concat(_3_already, "\n")));
        return;
      }
      if (Native.__default.isUint8Array(value)) {
        let _4_hasName;
        _4_hasName = false;
        if (_this.dumpHasShared) {
          let _out3;
          _out3 = (_this).DumpNeedsAnchor(value);
          _4_hasName = _out3;
        }
        let _5_name;
        _5_name = "";
        if (_4_hasName) {
          let _out4;
          _out4 = (_this).DumpAssignAnchor(value);
          _5_name = _out4;
        }
        let _6_binary;
        let _out5;
        _out5 = (_this).WriteBinaryScalar(value);
        _6_binary = _out5;
        if (_4_hasName) {
          _6_binary = Native.__default.concat("&", Native.__default.concat(_5_name, Native.__default.concat(" ", _6_binary)));
        }
        (_this).out = Native.__default.concat(_this.out, Native.__default.concat(" ", Native.__default.concat(_6_binary, "\n")));
        return;
      }
      let _7_isArr;
      _7_isArr = Native.__default.isArray(value);
      let _8_hasName;
      _8_hasName = false;
      if (_this.dumpHasShared) {
        let _out6;
        _out6 = (_this).DumpNeedsAnchor(value);
        _8_hasName = _out6;
      }
      let _9_name;
      _9_name = "";
      if (_8_hasName) {
        let _out7;
        _out7 = (_this).DumpAssignAnchor(value);
        _9_name = _out7;
      }
      let _10_empty;
      let _out8;
      _out8 = (_this).IsEmptyContainer(value, _7_isArr);
      _10_empty = _out8;
      if (_10_empty) {
        let _11_literal;
        if (_7_isArr) {
          _11_literal = "[]";
        } else {
          _11_literal = "{}";
        }
        if (_8_hasName) {
          _11_literal = Native.__default.concat("&", Native.__default.concat(_9_name, Native.__default.concat(" ", _11_literal)));
        }
        (_this).out = Native.__default.concat(_this.out, Native.__default.concat(" ", Native.__default.concat(_11_literal, "\n")));
        return;
      }
      if (_8_hasName) {
        (_this).out = Native.__default.concat(_this.out, Native.__default.concat(" &", Native.__default.concat(_9_name, "\n")));
      } else {
        (_this).out = Native.__default.concat(_this.out, "\n");
      }
      (_this).WriteCollectionBody(value, _7_isArr, (indent) + (Serializer.__default.INDENT__STEP));
      return;
    }
    WriteDocumentValue(value) {
      let _this = this;
      if ((!(Native.__default.isObject(value))) || (Native.__default.isNull(value))) {
        let _0_scalar;
        _0_scalar = "";
        if (Native.__default.isString(value)) {
          let _1_stringValue;
          _1_stringValue = Native.__default.stringValueOf(value);
          let _out0;
          _out0 = (_this).WriteRootStringScalar(_1_stringValue);
          _0_scalar = _out0;
        } else {
          let _out1;
          _out1 = (_this).WriteScalar(value);
          _0_scalar = _out1;
        }
        (_this).out = Native.__default.concat(_this.out, Native.__default.concat(_0_scalar, "\n"));
        return;
      }
      if (Native.__default.isUint8Array(value)) {
        let _2_hasName;
        _2_hasName = false;
        if (_this.dumpHasShared) {
          let _out2;
          _out2 = (_this).DumpNeedsAnchor(value);
          _2_hasName = _out2;
        }
        let _3_name;
        _3_name = "";
        if (_2_hasName) {
          let _out3;
          _out3 = (_this).DumpAssignAnchor(value);
          _3_name = _out3;
        }
        let _4_binary;
        let _out4;
        _out4 = (_this).WriteBinaryScalar(value);
        _4_binary = _out4;
        if (_2_hasName) {
          _4_binary = Native.__default.concat("&", Native.__default.concat(_3_name, Native.__default.concat(" ", _4_binary)));
        }
        (_this).out = Native.__default.concat(_this.out, Native.__default.concat(_4_binary, "\n"));
        return;
      }
      let _5_isArr;
      _5_isArr = Native.__default.isArray(value);
      let _6_hasName;
      _6_hasName = false;
      if (_this.dumpHasShared) {
        let _out5;
        _out5 = (_this).DumpNeedsAnchor(value);
        _6_hasName = _out5;
      }
      let _7_name;
      _7_name = "";
      if (_6_hasName) {
        let _out6;
        _out6 = (_this).DumpAssignAnchor(value);
        _7_name = _out6;
      }
      let _8_empty;
      let _out7;
      _out7 = (_this).IsEmptyContainer(value, _5_isArr);
      _8_empty = _out7;
      if (_8_empty) {
        let _9_literal;
        if (_5_isArr) {
          _9_literal = "[]";
        } else {
          _9_literal = "{}";
        }
        if (_6_hasName) {
          _9_literal = Native.__default.concat("&", Native.__default.concat(_7_name, Native.__default.concat(" ", _9_literal)));
        }
        (_this).out = Native.__default.concat(_this.out, Native.__default.concat(_9_literal, "\n"));
        return;
      }
      if (_6_hasName) {
        (_this).out = Native.__default.concat(_this.out, Native.__default.concat("&", Native.__default.concat(_7_name, "\n")));
      }
      (_this).WriteCollectionBody(value, _5_isArr, 0);
      return;
    }
    DumpFinish() {
      let _this = this;
      let result = "";
      result = _this.out;
      (_this).out = "";
      if ((Native.__default.stringLength(result)) !== (0)) {
        (_this).dumpFlattenSink = (_this.dumpFlattenSink) + (Native.__default.codeUnitAt(result, 0));
      }
      let _out0;
      _out0 = Native.__default.mapCreate();
      (_this).dumpRefCounts = _out0;
      let _out1;
      _out1 = Native.__default.mapCreate();
      (_this).dumpAnchors = _out1;
      let _out2;
      _out2 = Native.__default.mapCreate();
      (_this).dumpKeyCache = _out2;
      return result;
    }
    Stringify(value) {
      let _this = this;
      let text = "";
      let _out0;
      _out0 = Native.__default.mapCreate();
      (_this).dumpKeyCache = _out0;
      let _out1;
      _out1 = Native.__default.mapCreate();
      (_this).dumpRefCounts = _out1;
      (_this).dumpDepth = 0;
      (_this).dumpHasShared = false;
      (_this).DumpScanRefs(value);
      if (!(_this.dumpHasShared)) {
        let _out2;
        _out2 = Native.__default.mapCreate();
        (_this).dumpRefCounts = _out2;
      }
      let _out3;
      _out3 = Native.__default.mapCreate();
      (_this).dumpAnchors = _out3;
      (_this).dumpAnchorSeq = 0;
      (_this).out = "";
      (_this).dumpDepth = 0;
      (_this).WriteDocumentValue(value);
      let _out4;
      _out4 = (_this).DumpFinish();
      text = _out4;
      return text;
    }
  };
  return $module;
})(); // end of module Serializer
let _module = (function() {
  let $module = {};

  return $module;
})(); // end of module _module
