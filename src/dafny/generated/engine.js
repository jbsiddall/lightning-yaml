// Dafny program compiled into JavaScript by Dafny 4.11.0.
// Copyright by the contributors to the Dafny Project.
// SPDX-License-Identifier: MIT
// Sources sha256 c7caab84ea010f2093f12a7a182614c44ceb52b94b6b11499778e0cf85dcbc07; extraction and guarded output-shape lowering are audited in scripts/build-dafny.cjs.
import { Native } from '../native.ts';

let TagValues = (function () {
    let $module = {};
    $module.__default = class __default {
        constructor() {
        }
        static get SPACE() {
            return 32;
        }
        ;
        static get TAB() {
            return 9;
        }
        ;
        static get LF() {
            return 10;
        }
        ;
        static get CR() {
            return 13;
        }
        ;
        static get BASE64__PADDING() {
            return 61;
        }
        ;
    };
    $module.Helpers = class Helpers {
        constructor() {
            this.lastError = "";
            this.base64Inv = undefined;
        }
        __ctor() {
            let _this = this;
            (_this).lastError = "";
            (_this).base64Inv = Native.__default.createUint8Array(256);
            let _0_i;
            _0_i = 0;
            while ((_0_i) < (256)) {
                Native.__default.byteSet(_this.base64Inv, _0_i, (255));
                _0_i = (_0_i) + (1);
            }
            _0_i = 0;
            while ((_0_i) < (26)) {
                Native.__default.byteSet(_this.base64Inv, (_0_i) + (65), _0_i);
                Native.__default.byteSet(_this.base64Inv, (_0_i) + (97), (_0_i) + (26));
                _0_i = (_0_i) + (1);
            }
            _0_i = 0;
            while ((_0_i) < (10)) {
                Native.__default.byteSet(_this.base64Inv, (_0_i) + (48), (_0_i) + (52));
                _0_i = (_0_i) + (1);
            }
            Native.__default.byteSet(_this.base64Inv, 43, (62));
            Native.__default.byteSet(_this.base64Inv, 47, (63));
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
            digit = -1;
            if (((code) < (0)) || ((code) >= (256))) {
                return digit;
            }
            let _0_value;
            _0_value = Native.__default.byteGet(_this.base64Inv, code);
            if ((_0_value) !== (255)) {
                digit = _0_value;
            }
            return digit;
        }
        IsBase64Whitespace(code) {
            let _this = this;
            let yes = false;
            yes = ((((code) === (32)) || ((code) === (9))) || ((code) === (10))) || ((code) === (13));
            return yes;
        }
        StripBase64Whitespace(raw) {
            let _this = this;
            let clean = "";
            let _0_n;
            _0_n = raw.length;
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
                        _4_isWs =
                            (_this).IsBase64Whitespace(_3_c);
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
                _7_isWs =
                    (_this).IsBase64Whitespace(_6_c);
                if ((_7_isWs) || ((_6_c) === (-1))) {
                    if ((_2_i) > (_5_seg)) {
                        clean = Native.__default.concat(clean, raw.slice(_5_seg, _2_i));
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
            _0_clean =
                (_this).StripBase64Whitespace(raw);
            let _1_n;
            _1_n = _0_clean.length;
            if ((_1_n) === (0)) {
                bytes = Native.__default.createUint8Array(0);
                return bytes;
            }
            if ((Native.__default.euclideanModuloNumber(_1_n, 4)) !== (0)) {
                (_this).lastError = "malformed !!binary content: base64 length must be a multiple of 4 after stripping whitespace";
                return bytes;
            }
            let _2_padding;
            _2_padding = 0;
            let _3_last;
            _3_last = Native.__default.codeUnitAt(_0_clean, (_1_n) - (1));
            if ((_3_last) === (61)) {
                _2_padding = 1;
                let _4_previous;
                _4_previous = Native.__default.codeUnitAt(_0_clean, (_1_n) - (2));
                if ((_4_previous) === (61)) {
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
                _8_digit =
                    (_this).BASE64__INV(_7_code);
                if (((_7_code) >= (256)) || ((_8_digit) === (-1))) {
                    (_this).lastError = "malformed !!binary content: invalid base64 character";
                    return bytes;
                }
                _6_i = (_6_i) + (1);
            }
            let _9_outLen;
            _9_outLen = ((Native.__default.euclideanDivisionNumber(_1_n, 4)) * (3)) - (_2_padding);
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
                _15_c0 =
                    (_this).BASE64__INV(_11_c0Code);
                let _16_c1;
                let _out3;
                _16_c1 =
                    (_this).BASE64__INV(_12_c1Code);
                let _17_c2;
                _17_c2 = 0;
                if ((_13_c2Code) !== (61)) {
                    let _out4;
                    _17_c2 =
                        (_this).BASE64__INV(_13_c2Code);
                }
                let _18_c3;
                _18_c3 = 0;
                if ((_14_c3Code) !== (61)) {
                    let _out5;
                    _18_c3 =
                        (_this).BASE64__INV(_14_c3Code);
                }
                let _19_triple;
                _19_triple = ((((_15_c0) * (262144)) + ((_16_c1) * (4096))) + ((_17_c2) * (64))) + (_18_c3);
                let _20_isLastGroup;
                _20_isLastGroup = ((_6_i) + (4)) === (_1_n);
                let _21_firstByte;
                _21_firstByte = Native.__default.euclideanDivisionNumber(_19_triple, 65536);
                Native.__default.byteSet(bytes, _10_o, _21_firstByte);
                _10_o = (_10_o) + (1);
                if (!((_20_isLastGroup) && ((_2_padding) >= (2)))) {
                    let _22_secondByte;
                    _22_secondByte = Native.__default.euclideanModuloNumber(Native.__default.euclideanDivisionNumber(_19_triple, 256), 256);
                    Native.__default.byteSet(bytes, _10_o, _22_secondByte);
                    _10_o = (_10_o) + (1);
                }
                if (!((_20_isLastGroup) && ((_2_padding) >= (1)))) {
                    let _23_thirdByte;
                    _23_thirdByte = Native.__default.euclideanModuloNumber(_19_triple, 256);
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
            _0_nativeSet =
                Native.__default.setCreate();
            let _1_keys;
            let _out1;
            _1_keys =
                Native.__default.objectKeys(mapValue);
            let _2_n;
            let _out2;
            _2_n = _1_keys.length;
            let _3_i;
            _3_i = 0;
            while ((_3_i) < (_2_n)) {
                let _4_keyValue;
                let _out3;
                _4_keyValue = _1_keys[_3_i];
                let _5_key;
                _5_key = _4_keyValue;
                let _6_value;
                let _out4;
                _6_value = mapValue[_5_key];
                if (!(_6_value === null)) {
                    (_this).lastError = "!!set: every key must have a null value";
                    return setValue;
                }
                _0_nativeSet.add(_4_keyValue);
                _3_i = (_3_i) + (1);
            }
            setValue = _0_nativeSet;
            return setValue;
        }
        BuildOmap(sequence) {
            let _this = this;
            let mapValue = undefined;
            mapValue = Native.__default.undefinedValue;
            (_this).lastError = "";
            let _0_nativeMap;
            let _out0;
            _0_nativeMap =
                Native.__default.mapCreate();
            let _1_n;
            let _out1;
            _1_n = sequence.length;
            let _2_i;
            _2_i = 0;
            while ((_2_i) < (_1_n)) {
                let _3_entry;
                let _out2;
                _3_entry = sequence[_2_i];
                let _4_keys;
                let _out3;
                _4_keys =
                    (_this).SinglePairKeys(_3_entry);
                if (!Native.__default.jsEqual(_this.lastError, "")) {
                    return mapValue;
                }
                let _5_keyValue;
                let _out4;
                _5_keyValue = _4_keys[0];
                let _6_key;
                _6_key = _5_keyValue;
                let _7_value;
                let _out5;
                _7_value = _3_entry[_6_key];
                _0_nativeMap.set(_5_keyValue, _7_value);
                _2_i = (_2_i) + (1);
                let _out6;
                _1_n = sequence.length;
            }
            mapValue = _0_nativeMap;
            return mapValue;
        }
        ValidatePairs(sequence) {
            let _this = this;
            (_this).lastError = "";
            let _0_n;
            let _out0;
            _0_n = sequence.length;
            let _1_i;
            _1_i = 0;
            while ((_1_i) < (_0_n)) {
                let _2_entry;
                let _out1;
                _2_entry = sequence[_1_i];
                let _3_keys;
                let _out2;
                _3_keys =
                    (_this).SinglePairKeys(_2_entry);
                if (!Native.__default.jsEqual(_this.lastError, "")) {
                    return;
                }
                _1_i = (_1_i) + (1);
                let _out3;
                _0_n = sequence.length;
            }
            return;
        }
        SinglePairKeys(entry) {
            let _this = this;
            let keys = undefined;
            keys = Native.__default.undefinedValue;
            (_this).lastError = "";
            if (((!(typeof entry === "object" && entry !== null)) || (entry === null)) || (Array.isArray(entry))) {
                (_this).lastError = "each entry must be a single-key mapping ('- key: value')";
                return keys;
            }
            let _out0;
            keys =
                Native.__default.objectKeys(entry);
            let _0_n;
            let _out1;
            _0_n = keys.length;
            if ((_0_n) !== (1)) {
                (_this).lastError = "each entry must have exactly one key (one sequence indicator per pair)";
                keys = Native.__default.undefinedValue;
                return keys;
            }
            return keys;
        }
    };
    return $module;
})();
let DafnyCore = (function () {
    let $module = {};
    $module.__default = class __default {
        constructor() {
        }
        static Parse(text, isStrict) {
            let value = undefined;
            let _0_engine;
            let _nw0 = new DafnyCore.Engine();
            _nw0.__ctor();
            _0_engine = _nw0;
            (_0_engine).Reset(text, isStrict, false, 4194304);
            let _out0;
            value =
                (_0_engine).ParseSingle();
            return value;
        }
        static ParseAll(text, isStrict) {
            let documents = undefined;
            let _0_engine;
            let _nw0 = new DafnyCore.Engine();
            _nw0.__ctor();
            _0_engine = _nw0;
            (_0_engine).Reset(text, isStrict, false, 4194304);
            let _out0;
            documents =
                (_0_engine).ParseAll();
            return documents;
        }
    };
    $module.Engine = class Engine {
        constructor() {
            this.src = "";
            this.pos = 0;
            this.len = 0;
            this.lineStart = 0;
            this._f4 = 0;
            this._fs = false;
            this._fp = false;
            this._fq = false;
            this._fr = false;
            this._f5 = "";
            this._fb = false;
            this._f8 = false;
            this._f7 = false;
            this._f6 = 0;
            this._fm = 0;
            this._fn = 0;
            this._fh = undefined;
            this._fi = undefined;
            this._fj = undefined;
            this._fv = undefined;
            this._ff = false;
            this._fw = false;
            this._fl = undefined;
            this._fc = false;
            this._ft = undefined;
            this._fe = false;
            this._f1 = undefined;
            this._fa = false;
            this._fo = "";
            this._fd = false;
            this._f0 = false;
            this._fg = false;
            this._f3 = 0;
            this._f2 = false;
            this._f9 = 0;
            this._fu = undefined;
            this._fk = false;
        }
        __ctor() {
            let _this = this;
            let _nw0 = new TagValues.Helpers();
            _nw0.__ctor();
            (_this)._fu = _nw0;
            (_this)._fk = false;
            (_this).Reset("", true, false, 4194304);
            return;
        }
        Reset(text, isStrict, internValues, keyCacheBudget) {
            let _this = this;
            (_this).src = text;
            (_this).pos = 0;
            (_this).len = (text).length;
            (_this).lineStart = 0;
            (_this)._f4 = 0;
            (_this)._fs = isStrict;
            (_this)._fp = false;
            (_this)._fq = false;
            (_this)._fr = false;
            (_this)._f5 = "";
            (_this)._fb = false;
            (_this)._f8 = false;
            (_this)._f7 = false;
            (_this)._f6 = -1;
            (_this)._fm = -1;
            (_this)._fn = -1;
            let _out0;
            (_this)._fh =
                Native.__default.mapCreate();
            (_this)._fi = 0;
            (_this)._fj = keyCacheBudget;
            (_this)._fv = Native.__default.undefinedValue;
            (_this)._ff = false;
            (_this)._fw = internValues;
            (_this)._fl = Native.__default.undefinedValue;
            (_this)._fc = false;
            (_this)._ft = Native.__default.undefinedValue;
            (_this)._fe = false;
            (_this)._f1 = Native.__default.undefinedValue;
            (_this)._fa = false;
            (_this)._fo = "";
            (_this)._fd = false;
            (_this)._f0 = false;
            (_this)._fg = false;
            (_this)._f3 = -1;
            (_this)._f2 = true;
            (_this)._f9 = 0;
            if (((_this.len) > (0)) && ((_this.src.charCodeAt(0)) === (65279))) {
                (_this).pos = 1;
                (_this).lineStart = 1;
            }
            return;
        }
        m0(c) {
            let _this = this;
            return (((((c) === (44)) || ((c) === (91))) || ((c) === (93))) || ((c) === (123))) || ((c) === (125));
        }
        ;
        m1(c) {
            let _this = this;
            return ((48) <= (c)) && ((c) < (58));
        }
        ;
        m2(i) {
            let _this = this;
            let yes = false;
            if ((i) === (_this.len)) {
                yes = true;
                return yes;
            }
            let _0_c;
            _0_c = _this.src.charCodeAt(i);
            yes = (((((_0_c) === (32)) || ((_0_c) === (9))) || ((_0_c) === (10))) || ((_0_c) === (13))) || ((_this).m0(_0_c));
            return yes;
        }
        m3(from) {
            let _this = this;
            let p = 0;
            p = from;
            L1: {
                while ((p) < (_this.len)) {
                    C1: {
                        let _0_c;
                        _0_c = _this.src.charCodeAt(p);
                        if ((((_this).m0(_0_c)) || ((_0_c) === (10))) || ((_0_c) === (13))) {
                            break L1;
                        }
                        if ((_0_c) === (58)) {
                            if (((p) + (1)) === (_this.len)) {
                                break L1;
                            }
                            let _1_next;
                            _1_next = _this.src.charCodeAt((p) + (1));
                            if ((((((_1_next) === (32)) || ((_1_next) === (9))) || ((_1_next) === (10))) || ((_1_next) === (13))) || ((_this).m0(_1_next))) {
                                break L1;
                            }
                        }
                        else if (((_0_c) === (35)) && ((p) > (from))) {
                            let _2_prev;
                            _2_prev = _this.src.charCodeAt((p) - (1));
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
        m4(from, end) {
            let _this = this;
            let p = 0;
            p = end;
            L2: {
                while ((p) > (from)) {
                    C2: {
                        let _0_c;
                        _0_c = _this.src.charCodeAt((p) - (1));
                        if (((_0_c) !== (32)) && ((_0_c) !== (9))) {
                            break L2;
                        }
                        p = (p) - (1);
                    }
                }
            }
            return p;
        }
        m5(s) {
            let _this = this;
            let yes = false;
            yes = ((((s === "") || (s === "~")) || (s === "null")) || (s === "Null")) || (s === "NULL");
            return yes;
        }
        m6(s) {
            let _this = this;
            let value = undefined;
            if (((s === "true") || (s === "True")) || (s === "TRUE")) {
                value = true;
                return value;
            }
            if (((s === "false") || (s === "False")) || (s === "FALSE")) {
                value = false;
                return value;
            }
            value = Native.__default.notNumericValue;
            return value;
        }
        m7(s, from, to) {
            let _this = this;
            let value = undefined;
            value = Native.__default.notNumericValue;
            if ((from) >= (to)) {
                return value;
            }
            let _0_p;
            _0_p = from;
            let _1_accumulator;
            _1_accumulator = 0;
            while ((_0_p) < (to)) {
                let _2_digit;
                let _out0;
                _2_digit =
                    (_this).m19(s.charCodeAt(_0_p));
                if ((_2_digit) < (0)) {
                    return value;
                }
                _1_accumulator = _1_accumulator * 16 + _2_digit;
                _0_p = (_0_p) + (1);
            }
            value = _1_accumulator;
            return value;
        }
        m8(s, from, to) {
            let _this = this;
            let value = undefined;
            value = Native.__default.notNumericValue;
            if ((from) >= (to)) {
                return value;
            }
            let _0_p;
            _0_p = from;
            let _1_accumulator;
            _1_accumulator = 0;
            while ((_0_p) < (to)) {
                let _2_c;
                _2_c = s.charCodeAt(_0_p);
                if (((_2_c) < (48)) || ((_2_c) > (55))) {
                    return value;
                }
                _1_accumulator = Native.__default.numberMulAdd(_1_accumulator, 8, (_2_c) - (48));
                _0_p = (_0_p) + (1);
            }
            value = _1_accumulator;
            return value;
        }
        m9(from, to) {
            let _this = this;
            let value = undefined;
            value = Native.__default.notNumericValue;
            if ((from) >= (to)) {
                return value;
            }
            let _0_p;
            _0_p = from;
            let _1_accumulator;
            _1_accumulator = 0;
            while ((_0_p) < (to)) {
                let _2_digit;
                let _out0;
                _2_digit =
                    (_this).m19(_this.src.charCodeAt(_0_p));
                if ((_2_digit) < (0)) {
                    return value;
                }
                _1_accumulator = _1_accumulator * 16 + _2_digit;
                _0_p = (_0_p) + (1);
            }
            value = _1_accumulator;
            return value;
        }
        ma(from, to) {
            let _this = this;
            let value = undefined;
            value = Native.__default.notNumericValue;
            if ((from) >= (to)) {
                return value;
            }
            let _0_p;
            _0_p = from;
            let _1_accumulator;
            _1_accumulator = 0;
            while ((_0_p) < (to)) {
                let _2_c;
                _2_c = _this.src.charCodeAt(_0_p);
                if (((_2_c) < (48)) || ((_2_c) > (55))) {
                    return value;
                }
                _1_accumulator = Native.__default.numberMulAdd(_1_accumulator, 8, (_2_c) - (48));
                _0_p = (_0_p) + (1);
            }
            value = _1_accumulator;
            return value;
        }
        mb(from, to) {
            let _this = this;
            let value = undefined;
            value = Native.__default.notNumericValue;
            if ((from) === (to)) {
                return value;
            }
            let _0_p;
            _0_p = from;
            let _1_c;
            _1_c = _this.src.charCodeAt(_0_p);
            let _2_negative;
            _2_negative = (_1_c) === (45);
            let _3_signed;
            _3_signed = (_2_negative) || ((_1_c) === (43));
            if (_3_signed) {
                _0_p = (_0_p) + (1);
                if ((_0_p) === (to)) {
                    return value;
                }
                _1_c = _this.src.charCodeAt(_0_p);
            }
            if (((!(_3_signed)) && ((_1_c) === (48))) && (((_0_p) + (1)) < (to))) {
                let _4_base;
                _4_base = _this.src.charCodeAt((_0_p) + (1));
                if (((_4_base) === (120)) || ((_4_base) === (111))) {
                    if ((_4_base) === (120)) {
                        let _out0;
                        value =
                            (_this).m9((_0_p) + (2), to);
                    }
                    else {
                        let _out1;
                        value =
                            (_this).ma((_0_p) + (2), to);
                    }
                    return value;
                }
            }
            if (((_1_c) === (46)) && (((to) - (_0_p)) === (4))) {
                let _5_w1;
                _5_w1 = _this.src.charCodeAt((_0_p) + (1));
                let _6_w2;
                _6_w2 = _this.src.charCodeAt((_0_p) + (2));
                let _7_w3;
                _7_w3 = _this.src.charCodeAt((_0_p) + (3));
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
            _11_accumulator = 0;
            L3: {
                while ((_0_p) < (to)) {
                    C3: {
                        let _12_code;
                        _12_code = _this.src.charCodeAt(_0_p);
                        let _13_digit;
                        _13_digit = (_12_code) - (48);
                        if (((_13_digit) < (0)) || ((_13_digit) > (9))) {
                            break L3;
                        }
                        _11_accumulator = _11_accumulator * 10 + _13_digit;
                        _10_digitsSeen = (_10_digitsSeen) + (1);
                        _0_p = (_0_p) + (1);
                    }
                }
            }
            let _14_isFloat;
            _14_isFloat = false;
            if (((_0_p) < (to)) && ((_this.src.charCodeAt(_0_p)) === (46))) {
                _14_isFloat = true;
                _0_p = (_0_p) + (1);
                while (((_0_p) < (to)) && ((_this).m1(_this.src.charCodeAt(_0_p)))) {
                    _10_digitsSeen = (_10_digitsSeen) + (1);
                    _0_p = (_0_p) + (1);
                }
            }
            if ((_10_digitsSeen) === (0)) {
                return value;
            }
            if (((_0_p) < (to)) && (((_this.src.charCodeAt(_0_p)) === (101)) || ((_this.src.charCodeAt(_0_p)) === (69)))) {
                _14_isFloat = true;
                _0_p = (_0_p) + (1);
                if (((_0_p) < (to)) && (((_this.src.charCodeAt(_0_p)) === (43)) || ((_this.src.charCodeAt(_0_p)) === (45)))) {
                    _0_p = (_0_p) + (1);
                }
                let _15_exponentStart;
                _15_exponentStart = _0_p;
                while (((_0_p) < (to)) && ((_this).m1(_this.src.charCodeAt(_0_p)))) {
                    _0_p = (_0_p) + (1);
                }
                if ((_0_p) === (_15_exponentStart)) {
                    return value;
                }
            }
            if ((_0_p) !== (to)) {
                return value;
            }
            if ((!(_14_isFloat)) && ((_10_digitsSeen) <= (15))) {
                if (_2_negative) {
                    value = -_11_accumulator;
                }
                else {
                    value = _11_accumulator;
                }
            }
            else {
                value = Native.__default.parseNumber(Native.__default.slice(_this.src, from, to));
            }
            return value;
        }
        mc(s) {
            let _this = this;
            let value = undefined;
            value = Native.__default.notNumericValue;
            (_this)._fk = false;
            let _0_n;
            _0_n = s.length;
            if ((_0_n) === (0)) {
                return value;
            }
            let _1_p;
            _1_p = 0;
            let _2_c;
            _2_c = s.charCodeAt(_1_p);
            let _3_negative;
            _3_negative = (_2_c) === (45);
            let _4_signed;
            _4_signed = (_3_negative) || ((_2_c) === (43));
            if (_4_signed) {
                _1_p = (_1_p) + (1);
                if ((_1_p) >= (_0_n)) {
                    return value;
                }
                _2_c = s.charCodeAt(_1_p);
            }
            if (((!(_4_signed)) && ((_2_c) === (48))) && (((_1_p) + (1)) < (_0_n))) {
                let _5_base;
                _5_base = s.charCodeAt((_1_p) + (1));
                if (((_5_base) === (120)) || ((_5_base) === (111))) {
                    if ((_5_base) === (120)) {
                        let _out0;
                        value =
                            (_this).m7(s, (_1_p) + (2), _0_n);
                    }
                    else {
                        let _out1;
                        value =
                            (_this).m8(s, (_1_p) + (2), _0_n);
                    }
                    return value;
                }
            }
            if (((_2_c) === (46)) && (((_0_n) - (_1_p)) === (4))) {
                let _6_a;
                _6_a = s.charCodeAt((_1_p) + (1));
                let _7_b;
                _7_b = s.charCodeAt((_1_p) + (2));
                let _8_d;
                _8_d = s.charCodeAt((_1_p) + (3));
                let _9_inf;
                _9_inf = (((((_6_a) === (105)) && ((_7_b) === (110))) && ((_8_d) === (102))) || ((((_6_a) === (73)) && ((_7_b) === (110))) && ((_8_d) === (102)))) || ((((_6_a) === (73)) && ((_7_b) === (78))) && ((_8_d) === (70)));
                let _10_nan;
                _10_nan = (((((_6_a) === (110)) && ((_7_b) === (97))) && ((_8_d) === (110))) || ((((_6_a) === (78)) && ((_7_b) === (97))) && ((_8_d) === (78)))) || ((((_6_a) === (78)) && ((_7_b) === (65))) && ((_8_d) === (78)));
                if (_9_inf) {
                    (_this)._fk = true;
                    value = Native.__default.parseSpecialNumber(((_3_negative) ? ("-Infinity") : ("Infinity")));
                    return value;
                }
                if ((!(_4_signed)) && (_10_nan)) {
                    (_this)._fk = true;
                    value = Native.__default.parseSpecialNumber("NaN");
                    return value;
                }
            }
            let _11_digitsSeen;
            _11_digitsSeen = 0;
            let _12_accumulator;
            _12_accumulator = 0;
            L4: {
                while ((_1_p) < (_0_n)) {
                    C4: {
                        let _13_code;
                        _13_code = s.charCodeAt(_1_p);
                        let _14_digit;
                        _14_digit = (_13_code) - (48);
                        if (((_14_digit) < (0)) || ((_14_digit) > (9))) {
                            break L4;
                        }
                        _12_accumulator = _12_accumulator * 10 + _14_digit;
                        _11_digitsSeen = (_11_digitsSeen) + (1);
                        _1_p = (_1_p) + (1);
                    }
                }
            }
            let _15_isFloat;
            _15_isFloat = false;
            if (((_1_p) < (_0_n)) && ((s.charCodeAt(_1_p)) === (46))) {
                _15_isFloat = true;
                _1_p = (_1_p) + (1);
                while (((_1_p) < (_0_n)) && ((_this).m1(s.charCodeAt(_1_p)))) {
                    _11_digitsSeen = (_11_digitsSeen) + (1);
                    _1_p = (_1_p) + (1);
                }
            }
            if ((_11_digitsSeen) === (0)) {
                return value;
            }
            if (((_1_p) < (_0_n)) && (((s.charCodeAt(_1_p)) === (101)) || ((s.charCodeAt(_1_p)) === (69)))) {
                _15_isFloat = true;
                _1_p = (_1_p) + (1);
                if (((_1_p) < (_0_n)) && (((s.charCodeAt(_1_p)) === (43)) || ((s.charCodeAt(_1_p)) === (45)))) {
                    _1_p = (_1_p) + (1);
                }
                let _16_exponentStart;
                _16_exponentStart = _1_p;
                while (((_1_p) < (_0_n)) && ((_this).m1(s.charCodeAt(_1_p)))) {
                    _1_p = (_1_p) + (1);
                }
                if ((_1_p) === (_16_exponentStart)) {
                    return value;
                }
            }
            if ((_1_p) === (_0_n)) {
                (_this)._fk = _15_isFloat;
                if ((!(_15_isFloat)) && ((_11_digitsSeen) <= (15))) {
                    if (_3_negative) {
                        value = -_12_accumulator;
                    }
                    else {
                        value = _12_accumulator;
                    }
                }
                else {
                    value = Native.__default.parseNumber(s);
                }
            }
            return value;
        }
        md(from, to) {
            let _this = this;
            let value = undefined;
            if ((from) === (to)) {
                value = Native.__default.nullValue;
                return value;
            }
            let _0_c;
            _0_c = _this.src.charCodeAt(from);
            if (((((_this).m1(_0_c)) || ((_0_c) === (45))) || ((_0_c) === (43))) || ((_0_c) === (46))) {
                let _1_number = undefined;
                let _out0;
                _1_number =
                    (_this).mb(from, to);
                if (!(Native.__default.sameValue(_1_number, Native.__default.notNumericValue))) {
                    value = _1_number;
                    return value;
                }
            }
            let _2_text;
            _2_text = Native.__default.slice(_this.src, from, to);
            let _3_isNull = false;
            let _out1;
            _3_isNull =
                (_this).m5(_2_text);
            if (_3_isNull) {
                value = Native.__default.nullValue;
                return value;
            }
            let _4_boolValue = undefined;
            let _out2;
            _4_boolValue =
                (_this).m6(_2_text);
            if (!(Native.__default.sameValue(_4_boolValue, Native.__default.notNumericValue))) {
                value = _4_boolValue;
                return value;
            }
            value = _2_text;
            return value;
        }
        me(text) {
            let _this = this;
            let value = undefined;
            if (text === "") {
                value = Native.__default.nullValue;
                return value;
            }
            let _0_n;
            _0_n = text.length;
            let _1_c;
            _1_c = text.charCodeAt(0);
            if (((((_this).m1(_1_c)) || ((_1_c) === (45))) || ((_1_c) === (43))) || ((_1_c) === (46))) {
                let _2_number = undefined;
                let _out0;
                _2_number =
                    (_this).mc(text);
                if (!(Native.__default.sameValue(_2_number, Native.__default.notNumericValue))) {
                    value = _2_number;
                    return value;
                }
            }
            let _3_isNull = false;
            let _out1;
            _3_isNull =
                (_this).m5(text);
            if (_3_isNull) {
                value = Native.__default.nullValue;
                return value;
            }
            let _4_boolValue = undefined;
            let _out2;
            _4_boolValue =
                (_this).m6(text);
            if (!(Native.__default.sameValue(_4_boolValue, Native.__default.notNumericValue))) {
                value = _4_boolValue;
                return value;
            }
            value = text;
            return value;
        }
        mf() {
            let _this = this;
            while (((_this.pos) < (_this.len)) && (((_this.src.charCodeAt(_this.pos)) === (32)) || ((_this.src.charCodeAt(_this.pos)) === (9)))) {
                (_this).pos = (_this.pos) + (1);
            }
            return;
        }
        mg(message) {
            let _this = this;
            if ((_this.pos) >= (_this.len)) {
                Native.__default.fail(message + ": unexpected end of input");
            }
            let _0_line;
            _0_line = 1;
            let _1_column;
            _1_column = 1;
            let _2_i;
            _2_i = 0;
            while ((_2_i) < (_this.pos)) {
                if ((_this.src.charCodeAt(_2_i)) === (10)) {
                    _0_line = (_0_line) + (1);
                    _1_column = 1;
                }
                else {
                    _1_column = (_1_column) + (1);
                }
                _2_i = (_2_i) + (1);
            }
            let _3_msg;
            _3_msg = Native.__default.concat(message, Native.__default.concat(" (line ", Native.__default._$$_toString(_0_line)));
            _3_msg = Native.__default.concat(_3_msg, Native.__default.concat(", column ", Native.__default._$$_toString(_1_column)));
            Native.__default.fail(_3_msg + ")");
            return;
        }
        mh() {
            let _this = this;
            if ((_this.pos) >= (_this.len)) {
                (_this)._f8 = false;
                return;
            }
            let _0_first;
            _0_first = _this.src.charCodeAt(_this.pos);
            if ((((((((_0_first) !== (32)) && ((_0_first) !== (9))) && ((_0_first) !== (10))) && ((_0_first) !== (13))) && ((_0_first) !== (35))) && ((_0_first) !== (45))) && ((_0_first) !== (46))) {
                (_this)._f8 = false;
                return;
            }
            (_this).mi();
            return;
        }
        mi() {
            let _this = this;
            (_this)._f8 = false;
            let _0_p;
            _0_p = _this.pos;
            let _1_lineHead;
            _1_lineHead = -1;
            let _2_badTab;
            _2_badTab = false;
            L5: {
                while ((_0_p) < (_this.len)) {
                    C5: {
                        let _3_c;
                        _3_c = _this.src.charCodeAt(_0_p);
                        if (((((_3_c) === (32)) || ((_3_c) === (9))) || ((_3_c) === (10))) || ((_3_c) === (13))) {
                            if (((_3_c) === (10)) || ((_3_c) === (13))) {
                                (_this)._f8 = true;
                                (_this)._f7 = true;
                                _1_lineHead = (_0_p) + (1);
                                _2_badTab = false;
                            }
                            else if (((((_3_c) === (9)) && ((_1_lineHead) >= (0))) && ((_this._f6) >= (0))) && (((_0_p) - (_1_lineHead)) <= (_this._f6))) {
                                _2_badTab = true;
                            }
                            _0_p = (_0_p) + (1);
                            break C5;
                        }
                        if ((_3_c) === (35)) {
                            if ((_0_p) > (0)) {
                                let _4_prev;
                                _4_prev = _this.src.charCodeAt((_0_p) - (1));
                                if (((((_4_prev) !== (32)) && ((_4_prev) !== (9))) && ((_4_prev) !== (10))) && ((_4_prev) !== (13))) {
                                    (_this).pos = _0_p;
                                    (_this).mg("a comment must be separated from other tokens by whitespace");
                                }
                            }
                            let _5_nl;
                            _5_nl = Native.__default.indexOf(_this.src, "\n", _0_p);
                            if ((_5_nl) >= (0)) {
                                (_this)._f8 = true;
                                (_this)._f7 = true;
                            }
                            if ((_5_nl) < (0)) {
                                _0_p = _this.len;
                            }
                            else {
                                _0_p = (_5_nl) + (1);
                            }
                            _1_lineHead = _0_p;
                            _2_badTab = false;
                            break C5;
                        }
                        if ((((_3_c) === (45)) || ((_3_c) === (46))) && ((((_0_p) === (0)) || ((_this.src.charCodeAt((_0_p) - (1))) === (10))) || ((_this.src.charCodeAt((_0_p) - (1))) === (13)))) {
                            let _6_marker = false;
                            let _out0;
                            _6_marker =
                                (_this).m1o(_0_p);
                            if (_6_marker) {
                                (_this).pos = _0_p;
                                (_this).mg("a document marker is not allowed inside a flow collection");
                            }
                        }
                        if ((((_1_lineHead) >= (0)) && ((_this._f6) >= (0))) && ((_2_badTab) || (((_0_p) - (_1_lineHead)) <= (_this._f6)))) {
                            (_this).pos = _0_p;
                            (_this).mg("insufficient indentation for a multi-line flow collection");
                        }
                        break L5;
                    }
                }
            }
            (_this).pos = _0_p;
            return;
        }
        mj() {
            let _this = this;
            let end = 0;
            if ((_this.pos) < (_this.len)) {
                let _0_initial;
                _0_initial = _this.src.charCodeAt(_this.pos);
                if ((((((_0_initial) === (37)) || ((_0_initial) === (64))) || ((_0_initial) === (96))) || ((_0_initial) === (124))) || ((_0_initial) === (62))) {
                    (_this).mg("a plain scalar cannot start with '%', '@', '`', '|', or '>'");
                }
            }
            (_this)._fb = false;
            (_this)._f5 = "";
            let _1_start;
            _1_start = _this.pos;
            let _2_firstStop = 0;
            let _out0;
            _2_firstStop =
                (_this).m3(_1_start);
            let _3_firstEnd = 0;
            let _out1;
            _3_firstEnd =
                (_this).m4(_1_start, _2_firstStop);
            if (((_2_firstStop) < (_this.len)) && (((_this.src.charCodeAt(_2_firstStop)) === (10)) || ((_this.src.charCodeAt(_2_firstStop)) === (13)))) {
                let _out2;
                end =
                    (_this).mk(_1_start, _3_firstEnd, _2_firstStop);
            }
            else {
                (_this).pos = _2_firstStop;
                end = _3_firstEnd;
            }
            return end;
        }
        mk(start, firstEnd, breakPos) {
            let _this = this;
            let lastEnd = 0;
            let _0_result;
            _0_result = "";
            let _1_folded;
            _1_folded = false;
            lastEnd = firstEnd;
            let _2_p;
            _2_p = breakPos;
            L6: {
                while (true) {
                    C6: {
                        let _3_breaks;
                        _3_breaks = 0;
                        let _4_q;
                        _4_q = _2_p;
                        L7: {
                            while ((_4_q) < (_this.len)) {
                                C7: {
                                    let _5_c;
                                    _5_c = _this.src.charCodeAt(_4_q);
                                    if ((_5_c) === (10)) {
                                        _4_q = (_4_q) + (1);
                                        _3_breaks = (_3_breaks) + (1);
                                    }
                                    else if ((_5_c) === (13)) {
                                        _4_q = (_4_q) + (1);
                                        if (((_4_q) < (_this.len)) && ((_this.src.charCodeAt(_4_q)) === (10))) {
                                            _4_q = (_4_q) + (1);
                                        }
                                        _3_breaks = (_3_breaks) + (1);
                                    }
                                    else if (((_5_c) === (32)) || ((_5_c) === (9))) {
                                        _4_q = (_4_q) + (1);
                                    }
                                    else {
                                        break L7;
                                    }
                                }
                            }
                        }
                        let _6_continues;
                        _6_continues = (_4_q) < (_this.len);
                        if (_6_continues) {
                            let _7_c;
                            _7_c = _this.src.charCodeAt(_4_q);
                            if (((((_7_c) === (44)) || ((_7_c) === (93))) || ((_7_c) === (125))) || ((_7_c) === (35))) {
                                _6_continues = false;
                            }
                            else if ((_7_c) === (58)) {
                                if (((_4_q) + (1)) === (_this.len)) {
                                    _6_continues = false;
                                }
                                else {
                                    let _8_next;
                                    _8_next = _this.src.charCodeAt((_4_q) + (1));
                                    if ((((((_8_next) === (32)) || ((_8_next) === (9))) || ((_8_next) === (10))) || ((_8_next) === (13))) || ((_this).m0(_8_next))) {
                                        _6_continues = false;
                                    }
                                }
                            }
                            else if (((_7_c) === (45)) || ((_7_c) === (46))) {
                                let _9_marker;
                                _9_marker = false;
                                if (((_4_q) > (0)) && (((_this.src.charCodeAt((_4_q) - (1))) === (10)) || ((_this.src.charCodeAt((_4_q) - (1))) === (13)))) {
                                    let _out0;
                                    _9_marker =
                                        (_this).m1o(_4_q);
                                }
                                if (_9_marker) {
                                    _6_continues = false;
                                }
                            }
                        }
                        if (!(_6_continues)) {
                            (_this).pos = _2_p;
                            break L6;
                        }
                        if (!(_1_folded)) {
                            _0_result = Native.__default.slice(_this.src, start, firstEnd);
                            _1_folded = true;
                            (_this)._f7 = true;
                        }
                        if ((_3_breaks) > (1)) {
                            _0_result = Native.__default.concat(_0_result, Native.__default.repeat("\n", (_3_breaks) - (1)));
                        }
                        else {
                            _0_result = _0_result + " ";
                        }
                        let _10_segmentStop = 0;
                        let _out1;
                        _10_segmentStop =
                            (_this).m3(_4_q);
                        let _11_segmentEnd = 0;
                        let _out2;
                        _11_segmentEnd =
                            (_this).m4(_4_q, _10_segmentStop);
                        _0_result = Native.__default.concat(_0_result, Native.__default.slice(_this.src, _4_q, _11_segmentEnd));
                        lastEnd = _11_segmentEnd;
                        if (((_10_segmentStop) < (_this.len)) && (((_this.src.charCodeAt(_10_segmentStop)) === (10)) || ((_this.src.charCodeAt(_10_segmentStop)) === (13)))) {
                            _2_p = _10_segmentStop;
                            break C6;
                        }
                        (_this).pos = _10_segmentStop;
                        (_this)._f5 = _0_result;
                        (_this)._fb = true;
                        return lastEnd;
                    }
                }
            }
            if (_1_folded) {
                (_this)._f5 = _0_result;
                (_this)._fb = true;
            }
            else {
                lastEnd = firstEnd;
            }
            return lastEnd;
        }
        ml() {
            let _this = this;
            let value = undefined;
            let _0_start;
            _0_start = _this.pos;
            let _1_end = 0;
            let _out0;
            _1_end =
                (_this).mj();
            if ((_1_end) === (_0_start)) {
                (_this).mg("expected a flow node");
            }
            if (_this._fb) {
                value = _this._f5;
            }
            else {
                let _out1;
                value =
                    (_this).md(_0_start, _1_end);
            }
            return value;
        }
        mm(text) {
            let _this = this;
            let rendered = "";
            let _0_n;
            _0_n = text.length;
            if ((_0_n) === (0)) {
                rendered = Native.__default.jsonQuote(text);
                return rendered;
            }
            let _1_first;
            _1_first = text.charCodeAt(0);
            let _2_leading;
            _2_leading = (((((((((((((((((((_1_first) === (45)) || ((_1_first) === (63))) || ((_1_first) === (58))) || ((_1_first) === (44))) || ((_1_first) === (91))) || ((_1_first) === (93))) || ((_1_first) === (123))) || ((_1_first) === (125))) || ((_1_first) === (35))) || ((_1_first) === (38))) || ((_1_first) === (42))) || ((_1_first) === (33))) || ((_1_first) === (124))) || ((_1_first) === (62))) || ((_1_first) === (39))) || ((_1_first) === (34))) || ((_1_first) === (37))) || ((_1_first) === (64))) || ((_1_first) === (96));
            let _3_structural;
            _3_structural = ((((Native.__default.indexOf(text, ": ", 0)) >= (0)) || ((Native.__default.indexOf(text, " #", 0)) >= (0))) || ((Native.__default.indexOf(text, "\n", 0)) >= (0))) || (((text)[(_0_n) - (1)]) === (':'));
            let _4_nullWord = false;
            let _out0;
            _4_nullWord =
                (_this).m5(text);
            let _5_boolWord = undefined;
            let _out1;
            _5_boolWord =
                (_this).m6(text);
            let _6_number = undefined;
            let _out2;
            _6_number =
                (_this).mc(text);
            let _7_retyped;
            _7_retyped = ((_4_nullWord) || (!(Native.__default.sameValue(_5_boolWord, Native.__default.notNumericValue)))) || (!(Native.__default.sameValue(_6_number, Native.__default.notNumericValue)));
            if (((_2_leading) || (_3_structural)) || (_7_retyped)) {
                rendered = Native.__default.jsonQuote(text);
            }
            else {
                rendered = text;
            }
            return rendered;
        }
        mn(value) {
            let _this = this;
            let rendered = "";
            if (value === null) {
                rendered = "null";
                return rendered;
            }
            if (typeof value === "boolean") {
                let _0_boolean;
                _0_boolean = value;
                if (_0_boolean) {
                    rendered = "true";
                }
                else {
                    rendered = "false";
                }
                return rendered;
            }
            if (typeof value === "number") {
                rendered = Native.__default.formatNumber(value);
                return rendered;
            }
            if (typeof value === "string") {
                let _1_s;
                _1_s = value;
                let _out0;
                rendered =
                    (_this).mm(_1_s);
                return rendered;
            }
            if (typeof value === "object" && value !== null) {
                let _out1;
                rendered =
                    (_this).mq(value);
                return rendered;
            }
            rendered = Native.__default.stringFallback(value);
            return rendered;
        }
        mo(items, open, close) {
            let _this = this;
            let rendered = "";
            let _0_n = 0;
            let _out0;
            _0_n = items.length;
            if ((_0_n) === (0)) {
                rendered = open + close;
                return rendered;
            }
            rendered = open + " ";
            let _1_i;
            _1_i = 0;
            while ((_1_i) < (_0_n)) {
                if ((_1_i) > (0)) {
                    rendered = rendered + ", ";
                }
                let _2_item = undefined;
                let _out1;
                _2_item = items[_1_i];
                let _3_itemText = "";
                let _out2;
                _3_itemText =
                    (_this).mn(_2_item);
                rendered = rendered + _3_itemText;
                _1_i = (_1_i) + (1);
            }
            rendered = Native.__default.concat(rendered, " " + close);
            return rendered;
        }
        mp(value, keys, nativeMap) {
            let _this = this;
            let rendered = "";
            let _0_n = 0;
            let _out0;
            _0_n = keys.length;
            if ((_0_n) === (0)) {
                rendered = "{}";
                return rendered;
            }
            rendered = "{ ";
            let _1_i;
            _1_i = 0;
            while ((_1_i) < (_0_n)) {
                if ((_1_i) > (0)) {
                    rendered = rendered + ", ";
                }
                let _2_keyValue = undefined;
                let _out1;
                _2_keyValue = keys[_1_i];
                let _3_keyText = "";
                if (typeof _2_keyValue === "string") {
                    _3_keyText = _2_keyValue;
                }
                else {
                    let _out2;
                    _3_keyText =
                        (_this).ms(_2_keyValue);
                }
                let _4_safeKey;
                let _out3;
                _4_safeKey =
                    (_this).mm(_3_keyText);
                rendered = Native.__default.concat(rendered, _4_safeKey + ": ");
                let _5_child = undefined;
                if (nativeMap) {
                    let _6_nativeMapValue;
                    _6_nativeMapValue = value;
                    let _out4;
                    _5_child = _6_nativeMapValue.get(_2_keyValue);
                }
                else {
                    if (typeof _2_keyValue === "string") {
                        let _out5;
                        _5_child = value[_2_keyValue];
                    }
                    else {
                        let _out6;
                        _5_child = value[_3_keyText];
                    }
                }
                let _7_childText = "";
                let _out7;
                _7_childText =
                    (_this).mn(_5_child);
                rendered = rendered + _7_childText;
                _1_i = (_1_i) + (1);
            }
            rendered = rendered + " }";
            return rendered;
        }
        mq(value) {
            let _this = this;
            let rendered = "";
            if (Array.isArray(value)) {
                let _out0;
                rendered =
                    (_this).mo(value, "[", "]");
                return rendered;
            }
            if (Native.__default.isUint8Array(value)) {
                let _0_bytes;
                let _out1;
                _0_bytes =
                    Native.__default.createArray();
                let _1_n = 0;
                _1_n = Native.__default.byteLength(value);
                let _2_i;
                _2_i = 0;
                while ((_2_i) < (_1_n)) {
                    Native.__default.arrayPush(_0_bytes, Native.__default.byteGet(value, _2_i));
                    _2_i = (_2_i) + (1);
                }
                let _out2;
                rendered =
                    (_this).mo(_0_bytes, "[", "]");
                return rendered;
            }
            if (Native.__default.isSet(value)) {
                let _3_values = undefined;
                let _out3;
                _3_values =
                    Native.__default.setValues(value);
                let _out4;
                rendered =
                    (_this).mo(_3_values, "[", "]");
                return rendered;
            }
            if (Native.__default.isMap(value)) {
                let _4_mapKeys = undefined;
                let _out5;
                _4_mapKeys =
                    Native.__default.mapKeys(value);
                let _out6;
                rendered =
                    (_this).mp(value, _4_mapKeys, true);
                return rendered;
            }
            let _5_keys = undefined;
            let _out7;
            _5_keys =
                Native.__default.objectKeys(value);
            let _out8;
            rendered =
                (_this).mp(value, _5_keys, false);
            return rendered;
        }
        mr(expected) {
            let _this = this;
            let matchedKey = false;
            matchedKey = false;
            if ((_this.pos) >= (_this.len)) {
                return matchedKey;
            }
            let _0_c;
            _0_c = _this.src.charCodeAt(_this.pos);
            if ((((((((_0_c) === (91)) || ((_0_c) === (123))) || ((_0_c) === (34))) || ((_0_c) === (39))) || ((_0_c) === (38))) || ((_0_c) === (42))) || ((_0_c) === (33))) {
                return matchedKey;
            }
            let _1_n;
            _1_n = expected.length;
            if (((_this.pos) + (_1_n)) >= (_this.len)) {
                return matchedKey;
            }
            let _2_i;
            _2_i = 0;
            while ((_2_i) < (_1_n)) {
                if ((_this.src.charCodeAt((_this.pos) + (_2_i))) !== (expected.charCodeAt(_2_i))) {
                    return matchedKey;
                }
                _2_i = (_2_i) + (1);
            }
            if ((_this.src.charCodeAt((_this.pos) + (_1_n))) !== (58)) {
                return matchedKey;
            }
            let _3_separator = false;
            let _out0;
            _3_separator =
                (_this).m29(((_this.pos) + (_1_n)) + (1));
            if (!(_3_separator)) {
                return matchedKey;
            }
            (_this).pos = (_this.pos) + (_1_n);
            matchedKey = true;
            return matchedKey;
        }
        ms(value) {
            let _this = this;
            let key = "";
            if (typeof value === "string") {
                key = value;
                return key;
            }
            if (value === null) {
                key = "";
                return key;
            }
            if (typeof value === "object" && value !== null) {
                let _out0;
                key =
                    (_this).mq(value);
                return key;
            }
            key = Native.__default.stringFallback(value);
            return key;
        }
        mt(value) {
            let _this = this;
            let key = "";
            let _out0;
            key =
                (_this).ms(value);
            let _out1;
            key =
                (_this).mu(key);
            return key;
        }
        mu(text) {
            let _this = this;
            let key = "";
            let _0_value;
            _0_value = text;
            let _1_cached;
            let _out0;
            _1_cached =
                Native.__default.mapGet(_this._fh, _0_value);
            if (!(_1_cached === undefined)) {
                key = _1_cached;
                return key;
            }
            let _2_bytes;
            _2_bytes = Native.__default.numberMulAdd(text.length, 2, 0);
            let _3_total;
            _3_total = Native.__default.numberAdd(_this._fi, _2_bytes);
            let _4_withinBudget = false;
            _4_withinBudget = Native.__default.numberLessEqual(_3_total, _this._fj);
            if (_4_withinBudget) {
                Native.__default.mapSet(_this._fh, _0_value, _0_value);
                (_this)._fi = _3_total;
            }
            key = text;
            return key;
        }
        mv(target, key, value) {
            let _this = this;
            Native.__default.objectSetSafe(target, key, value);
            return;
        }
        mw(at) {
            let _this = this;
            let yes = false;
            if ((at) >= (_this.len)) {
                yes = true;
                return yes;
            }
            let _0_c;
            _0_c = _this.src.charCodeAt(at);
            if ((((((_0_c) === (44)) || ((_0_c) === (93))) || ((_0_c) === (125))) || ((_0_c) === (10))) || ((_0_c) === (13))) {
                yes = true;
                return yes;
            }
            if (((_0_c) === (32)) || ((_0_c) === (9))) {
                let _1_q;
                _1_q = (at) + (1);
                while (((_1_q) < (_this.len)) && (((_this.src.charCodeAt(_1_q)) === (32)) || ((_this.src.charCodeAt(_1_q)) === (9)))) {
                    _1_q = (_1_q) + (1);
                }
                if ((_1_q) >= (_this.len)) {
                    yes = true;
                    return yes;
                }
                let _2_next;
                _2_next = _this.src.charCodeAt(_1_q);
                yes = (((((((_2_next) === (44)) || ((_2_next) === (93))) || ((_2_next) === (125))) || ((_2_next) === (10))) || ((_2_next) === (13))) || ((_2_next) === (35))) || ((_2_next) === (58));
                return yes;
            }
            if ((_0_c) === (58)) {
                if (((at) + (1)) >= (_this.len)) {
                    yes = true;
                    return yes;
                }
                let _3_next;
                _3_next = _this.src.charCodeAt((at) + (1));
                yes = (((((_3_next) === (32)) || ((_3_next) === (9))) || ((_3_next) === (10))) || ((_3_next) === (13))) || ((_this).m0(_3_next));
                return yes;
            }
            yes = false;
            return yes;
        }
        mx() {
            let _this = this;
            let value = undefined;
            value = Native.__default.notNumericValue;
            let _0_start;
            _0_start = _this.pos;
            let _1_p;
            _1_p = _0_start;
            let _2_c;
            _2_c = _this.src.charCodeAt(_1_p);
            let _3_negative;
            _3_negative = (_2_c) === (45);
            let _4_signed;
            _4_signed = (_3_negative) || ((_2_c) === (43));
            if (_4_signed) {
                _1_p = (_1_p) + (1);
                if ((_1_p) >= (_this.len)) {
                    return value;
                }
                _2_c = _this.src.charCodeAt(_1_p);
            }
            if ((!(_4_signed)) && ((_2_c) === (48))) {
                let _5_base;
                if (((_1_p) + (1)) < (_this.len)) {
                    _5_base = _this.src.charCodeAt((_1_p) + (1));
                }
                else {
                    _5_base = -1;
                }
                if (((_5_base) === (120)) || ((_5_base) === (111))) {
                    _1_p = (_1_p) + (2);
                    let _6_digits;
                    _6_digits = _1_p;
                    let _7_accumulator;
                    _7_accumulator = 0;
                    let _8_radix;
                    if ((_5_base) === (120)) {
                        _8_radix = 16;
                    }
                    else {
                        _8_radix = 8;
                    }
                    L8: {
                        while ((_1_p) < (_this.len)) {
                            C8: {
                                let _9_ch;
                                _9_ch = _this.src.charCodeAt(_1_p);
                                let _10_digit = 0;
                                if ((_5_base) === (120)) {
                                    if ((_this).m1(_9_ch)) {
                                        _10_digit = (_9_ch) - (48);
                                    }
                                    else if (((65) <= (_9_ch)) && ((_9_ch) < (71))) {
                                        _10_digit = (_9_ch) - (55);
                                    }
                                    else if (((97) <= (_9_ch)) && ((_9_ch) < (103))) {
                                        _10_digit = (_9_ch) - (87);
                                    }
                                    else {
                                        _10_digit = -1;
                                    }
                                }
                                else if (((48) <= (_9_ch)) && ((_9_ch) < (56))) {
                                    _10_digit = (_9_ch) - (48);
                                }
                                else {
                                    _10_digit = -1;
                                }
                                if ((_10_digit) < (0)) {
                                    break L8;
                                }
                                _7_accumulator = _7_accumulator * _8_radix + _10_digit;
                                _1_p = (_1_p) + (1);
                            }
                        }
                    }
                    let _11_boundary = false;
                    let _out0;
                    _11_boundary =
                        (_this).mw(_1_p);
                    if (((_1_p) > (_6_digits)) && (_11_boundary)) {
                        (_this).pos = _1_p;
                        value = _7_accumulator;
                    }
                    return value;
                }
            }
            if (((_2_c) === (46)) && (((_1_p) + (3)) < (_this.len))) {
                let _12_a;
                _12_a = _this.src.charCodeAt((_1_p) + (1));
                let _13_b;
                _13_b = _this.src.charCodeAt((_1_p) + (2));
                let _14_d;
                _14_d = _this.src.charCodeAt((_1_p) + (3));
                let _15_inf;
                _15_inf = (((((_12_a) === (105)) && ((_13_b) === (110))) && ((_14_d) === (102))) || ((((_12_a) === (73)) && ((_13_b) === (110))) && ((_14_d) === (102)))) || ((((_12_a) === (73)) && ((_13_b) === (78))) && ((_14_d) === (70)));
                let _16_nan;
                _16_nan = (((((_12_a) === (110)) && ((_13_b) === (97))) && ((_14_d) === (110))) || ((((_12_a) === (78)) && ((_13_b) === (97))) && ((_14_d) === (78)))) || ((((_12_a) === (78)) && ((_13_b) === (65))) && ((_14_d) === (78)));
                let _17_boundary = false;
                let _out1;
                _17_boundary =
                    (_this).mw((_1_p) + (4));
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
            _19_accumulator = 0;
            L9: {
                while ((_1_p) < (_this.len)) {
                    C9: {
                        let _20_code;
                        _20_code = _this.src.charCodeAt(_1_p);
                        let _21_digit;
                        _21_digit = (_20_code) - (48);
                        if (((_21_digit) < (0)) || ((_21_digit) > (9))) {
                            break L9;
                        }
                        _19_accumulator = _19_accumulator * 10 + _21_digit;
                        _18_digitsSeen = (_18_digitsSeen) + (1);
                        _1_p = (_1_p) + (1);
                    }
                }
            }
            let _22_isFloat;
            _22_isFloat = false;
            if (((_1_p) < (_this.len)) && ((_this.src.charCodeAt(_1_p)) === (46))) {
                _22_isFloat = true;
                _1_p = (_1_p) + (1);
                while (((_1_p) < (_this.len)) && ((_this).m1(_this.src.charCodeAt(_1_p)))) {
                    _18_digitsSeen = (_18_digitsSeen) + (1);
                    _1_p = (_1_p) + (1);
                }
            }
            if ((_18_digitsSeen) === (0)) {
                return value;
            }
            if (((_1_p) < (_this.len)) && (((_this.src.charCodeAt(_1_p)) === (101)) || ((_this.src.charCodeAt(_1_p)) === (69)))) {
                _22_isFloat = true;
                _1_p = (_1_p) + (1);
                if (((_1_p) < (_this.len)) && (((_this.src.charCodeAt(_1_p)) === (43)) || ((_this.src.charCodeAt(_1_p)) === (45)))) {
                    _1_p = (_1_p) + (1);
                }
                let _23_exponentStart;
                _23_exponentStart = _1_p;
                while (((_1_p) < (_this.len)) && ((_this).m1(_this.src.charCodeAt(_1_p)))) {
                    _1_p = (_1_p) + (1);
                }
                if ((_1_p) === (_23_exponentStart)) {
                    return value;
                }
            }
            let _24_boundary = false;
            let _out2;
            _24_boundary =
                (_this).mw(_1_p);
            if (!(_24_boundary)) {
                return value;
            }
            (_this).pos = _1_p;
            if ((!(_22_isFloat)) && ((_18_digitsSeen) <= (15))) {
                if (_3_negative) {
                    value = -_19_accumulator;
                }
                else {
                    value = _19_accumulator;
                }
            }
            else {
                value = Native.__default.parseNumber(Native.__default.slice(_this.src, _0_start, _1_p));
            }
            return value;
        }
        my() {
            let _this = this;
            let value = undefined;
            if ((_this.pos) >= (_this.len)) {
                (_this).mg("expected a flow node");
            }
            let _0_c;
            _0_c = _this.src.charCodeAt(_this.pos);
            if ((_0_c) === (123)) {
                let _out0;
                value =
                    (_this).m1k();
                return value;
            }
            if ((_0_c) === (91)) {
                let _out1;
                value =
                    (_this).m1j();
                return value;
            }
            if ((_0_c) === (34)) {
                let _out2;
                value =
                    (_this).m1r();
                return value;
            }
            if ((_0_c) === (39)) {
                let _out3;
                value =
                    (_this).m1v();
                return value;
            }
            if ((_0_c) === (38)) {
                let _out4;
                value =
                    (_this).m1g();
                return value;
            }
            if ((_0_c) === (33)) {
                let _out5;
                value =
                    (_this).m1e();
                return value;
            }
            if ((_0_c) === (42)) {
                let _out6;
                value =
                    (_this).m15();
                return value;
            }
            if (((((_this).m1(_0_c)) || ((_0_c) === (45))) || ((_0_c) === (43))) || ((_0_c) === (46))) {
                let _1_numericStart;
                _1_numericStart = _this.pos;
                let _2_number;
                let _out7;
                _2_number =
                    (_this).mx();
                if (!(Native.__default.sameValue(_2_number, Native.__default.notNumericValue))) {
                    value = _2_number;
                    return value;
                }
                if ((_0_c) === (45)) {
                    let _3_dashSeparator = false;
                    let _out8;
                    _3_dashSeparator =
                        (_this).m2((_this.pos) + (1));
                    if (_3_dashSeparator) {
                        (_this).mg("a block sequence '-' indicator is not allowed in a flow collection");
                    }
                }
                (_this).pos = _1_numericStart;
            }
            let _out9;
            value =
                (_this).ml();
            return value;
        }
        mz() {
            let _this = this;
            let key = "";
            if ((_this.pos) >= (_this.len)) {
                (_this).mg("expected a mapping key");
            }
            let _0_c;
            _0_c = _this.src.charCodeAt(_this.pos);
            if ((_0_c) === (38)) {
                let _out0;
                key =
                    (_this).m10();
                return key;
            }
            if ((_0_c) === (33)) {
                let _out1;
                key =
                    (_this).m11();
                return key;
            }
            if ((_0_c) === (42)) {
                let _1_alias = undefined;
                let _out2;
                _1_alias =
                    (_this).m15();
                let _2_aliasKey = "";
                let _out3;
                _2_aliasKey =
                    (_this).ms(_1_alias);
                let _out4;
                key =
                    (_this).mu(_2_aliasKey);
                return key;
            }
            if ((_0_c) === (34)) {
                let _3_quoted = undefined;
                let _out5;
                _3_quoted =
                    (_this).m1r();
                let _out6;
                key =
                    (_this).mu(_3_quoted);
                return key;
            }
            if ((_0_c) === (39)) {
                let _4_quoted = undefined;
                let _out7;
                _4_quoted =
                    (_this).m1v();
                let _out8;
                key =
                    (_this).mu(_4_quoted);
                return key;
            }
            let _5_start;
            _5_start = _this.pos;
            let _6_end = 0;
            let _out9;
            _6_end =
                (_this).mj();
            if (_this._fb) {
                let _out10;
                key =
                    (_this).mu(_this._f5);
                return key;
            }
            if ((_6_end) === (_5_start)) {
                (_this).mg("expected a mapping key");
            }
            let _7_plainKey;
            let _out11;
            _7_plainKey =
                (_this).md(_5_start, _6_end);
            (_this).m14(_7_plainKey);
            let _8_resolvedKey = "";
            let _out12;
            _8_resolvedKey =
                (_this).ms(_7_plainKey);
            let _out13;
            key =
                (_this).mu(_8_resolvedKey);
            return key;
        }
        m10() {
            let _this = this;
            let key = "";
            (_this).pos = (_this.pos) + (1);
            let _0_name = "";
            let _out0;
            _0_name =
                (_this).m13();
            (_this).mh();
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (38))) {
                (_this).mg("a node may carry at most one anchor");
            }
            let _1_tag;
            _1_tag = "";
            let _2_hasTag;
            _2_hasTag = false;
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (33))) {
                let _out1;
                _1_tag =
                    (_this).m1b();
                (_this).m1c(true);
                _2_hasTag = true;
                (_this).mh();
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (33))) {
                    (_this).mg("a node may carry at most one tag");
                }
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (38))) {
                    (_this).mg("a node may carry at most one anchor");
                }
            }
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (42))) {
                (_this).mg("an alias node cannot carry an anchor property");
            }
            let _3_savedName;
            _3_savedName = _this._fo;
            let _4_savedHasName;
            _4_savedHasName = _this._fd;
            (_this)._fo = _0_name;
            (_this)._fd = true;
            let _5_raw = undefined;
            if (_2_hasTag) {
                let _out2;
                _5_raw =
                    (_this).m12(_1_tag);
                (_this).m14(_5_raw);
                let _6_taggedKey = "";
                let _out3;
                _6_taggedKey =
                    (_this).ms(_5_raw);
                let _out4;
                key =
                    (_this).mu(_6_taggedKey);
            }
            else if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (34))) {
                let _out5;
                _5_raw =
                    (_this).m1r();
                (_this).m14(_5_raw);
                let _7_quotedKey = "";
                let _out6;
                _7_quotedKey =
                    (_this).ms(_5_raw);
                let _out7;
                key =
                    (_this).mu(_7_quotedKey);
            }
            else if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (39))) {
                let _out8;
                _5_raw =
                    (_this).m1v();
                (_this).m14(_5_raw);
                let _8_singleQuotedKey = "";
                let _out9;
                _8_singleQuotedKey =
                    (_this).ms(_5_raw);
                let _out10;
                key =
                    (_this).mu(_8_singleQuotedKey);
            }
            else {
                let _9_start;
                _9_start = _this.pos;
                let _10_end = 0;
                let _out11;
                _10_end =
                    (_this).mj();
                if (_this._fb) {
                    _5_raw = _this._f5;
                    (_this).m14(_5_raw);
                    let _11_foldedKey = "";
                    let _out12;
                    _11_foldedKey =
                        (_this).ms(_5_raw);
                    let _out13;
                    key =
                        (_this).mu(_11_foldedKey);
                }
                else {
                    if ((_10_end) === (_9_start)) {
                        (_this).mg("expected a mapping key");
                    }
                    let _out14;
                    _5_raw =
                        (_this).md(_9_start, _10_end);
                    (_this).m14(_5_raw);
                    let _12_resolvedKey = "";
                    let _out15;
                    _12_resolvedKey =
                        (_this).ms(_5_raw);
                    let _out16;
                    key =
                        (_this).mu(_12_resolvedKey);
                }
            }
            (_this)._fo = _3_savedName;
            (_this)._fd = _4_savedHasName;
            return key;
        }
        m11() {
            let _this = this;
            let key = "";
            let _0_tag = "";
            let _out0;
            _0_tag =
                (_this).m1b();
            (_this).m1c(true);
            (_this).mh();
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (33))) {
                (_this).mg("a node may carry at most one tag");
            }
            let _1_anchorName;
            _1_anchorName = "";
            let _2_touched;
            _2_touched = false;
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (38))) {
                (_this).pos = (_this.pos) + (1);
                let _out1;
                _1_anchorName =
                    (_this).m13();
                _2_touched = true;
                (_this).mh();
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (38))) {
                    (_this).mg("a node may carry at most one anchor");
                }
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (33))) {
                    (_this).mg("a node may carry at most one tag");
                }
            }
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (42))) {
                (_this).mg("an alias node cannot carry a tag/anchor property");
            }
            let _3_savedName;
            _3_savedName = _this._fo;
            let _4_savedHasName;
            _4_savedHasName = _this._fd;
            if (_2_touched) {
                (_this)._fo = _1_anchorName;
                (_this)._fd = true;
            }
            let _5_raw = undefined;
            let _out2;
            _5_raw =
                (_this).m12(_0_tag);
            if (_2_touched) {
                (_this).m14(_5_raw);
                (_this)._fo = _3_savedName;
                (_this)._fd = _4_savedHasName;
            }
            let _6_taggedKey = "";
            let _out3;
            _6_taggedKey =
                (_this).ms(_5_raw);
            let _out4;
            key =
                (_this).mu(_6_taggedKey);
            return key;
        }
        m12(tag) {
            let _this = this;
            let value = undefined;
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (34))) {
                let _0_quoted = undefined;
                let _out0;
                _0_quoted =
                    (_this).m1r();
                let _out1;
                value =
                    (_this).m1d(tag, _0_quoted);
                return value;
            }
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (39))) {
                let _1_quoted = undefined;
                let _out2;
                _1_quoted =
                    (_this).m1v();
                let _out3;
                value =
                    (_this).m1d(tag, _1_quoted);
                return value;
            }
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (123))) {
                let _2_mapping = undefined;
                let _out4;
                _2_mapping =
                    (_this).m1k();
                let _out5;
                value =
                    (_this).m2l(tag, _2_mapping, "map");
                return value;
            }
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (91))) {
                let _3_sequence = undefined;
                let _out6;
                _3_sequence =
                    (_this).m1j();
                let _out7;
                value =
                    (_this).m2l(tag, _3_sequence, "seq");
                return value;
            }
            let _4_separator;
            _4_separator = (_this.pos) >= (_this.len);
            if ((_this.pos) < (_this.len)) {
                let _out8;
                _4_separator =
                    (_this).m2(_this.pos);
            }
            if (_4_separator) {
                let _out9;
                value =
                    (_this).m1d(tag, "");
                return value;
            }
            let _5_start;
            _5_start = _this.pos;
            let _6_end = 0;
            let _out10;
            _6_end =
                (_this).mj();
            let _7_raw;
            if (_this._fb) {
                _7_raw = _this._f5;
            }
            else {
                _7_raw = Native.__default.slice(_this.src, _5_start, _6_end);
            }
            if (!(_this._fb)) {
                (_this).pos = _6_end;
            }
            let _out11;
            value =
                (_this).m1d(tag, _7_raw);
            return value;
        }
        m13() {
            let _this = this;
            let name = "";
            let _0_start;
            _0_start = _this.pos;
            L10: {
                while ((_this.pos) < (_this.len)) {
                    C10: {
                        let _1_c;
                        _1_c = _this.src.charCodeAt(_this.pos);
                        if ((((((_1_c) === (32)) || ((_1_c) === (9))) || ((_1_c) === (10))) || ((_1_c) === (13))) || ((_this).m0(_1_c))) {
                            break L10;
                        }
                        (_this).pos = (_this.pos) + (1);
                    }
                }
            }
            if ((_this.pos) === (_0_start)) {
                (_this).mg("anchor or alias name cannot be empty");
            }
            name = Native.__default.slice(_this.src, _0_start, _this.pos);
            return name;
        }
        m14(value) {
            let _this = this;
            if (_this._fd) {
                if (!(_this._fa)) {
                    let _0_newAnchors;
                    let _out0;
                    _0_newAnchors =
                        Native.__default.mapCreate();
                    (_this)._f1 = _0_newAnchors;
                    (_this)._fa = true;
                }
                let _1_name;
                _1_name = _this._fo;
                let _2_anchors;
                _2_anchors = _this._f1;
                _2_anchors.set(_1_name, value);
                (_this)._fd = false;
            }
            return;
        }
        m15() {
            let _this = this;
            let value = undefined;
            (_this).pos = (_this.pos) + (1);
            let _0_name = "";
            let _out0;
            _0_name =
                (_this).m13();
            (_this).mf();
            if (!(_this._fa)) {
                (_this).mg(Native.__default.concat("unresolved alias '*", _0_name + "' (no matching anchor)"));
            }
            let _1_key;
            _1_key = _0_name;
            let _2_anchors;
            _2_anchors = _this._f1;
            let _out1;
            value = _2_anchors.get(_1_key);
            if (value === undefined) {
                (_this).mg(Native.__default.concat("unresolved alias '*", _0_name + "' (no matching anchor)"));
            }
            return value;
        }
        m16(c) {
            let _this = this;
            let yes = false;
            yes = ((((_this).m1(c)) || (((65) <= (c)) && ((c) < (91)))) || (((97) <= (c)) && ((c) < (123)))) || ((c) === (45));
            return yes;
        }
        m17(c) {
            let _this = this;
            let yes = false;
            yes = (((((((c) !== (32)) && ((c) !== (9))) && ((c) !== (10))) && ((c) !== (13))) && ((c) >= (32))) && ((c) !== (33))) && (!((_this).m0(c)));
            return yes;
        }
        m18() {
            let _this = this;
            let suffix = "";
            let _0_start;
            _0_start = _this.pos;
            L11: {
                while ((_this.pos) < (_this.len)) {
                    C11: {
                        let _1_c;
                        _1_c = _this.src.charCodeAt(_this.pos);
                        let _2_valid = false;
                        let _out0;
                        _2_valid =
                            (_this).m17(_1_c);
                        if (!(_2_valid)) {
                            break L11;
                        }
                        (_this).pos = (_this.pos) + (1);
                    }
                }
            }
            suffix = Native.__default.slice(_this.src, _0_start, _this.pos);
            return suffix;
        }
        m19(c) {
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
        m1a(s) {
            let _this = this;
            let decoded = "";
            let _0_lenS;
            _0_lenS = s.length;
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
                if ((s.charCodeAt(_3_i)) === (37)) {
                    if (((_3_i) + (2)) >= (_0_lenS)) {
                        (_this).mg("malformed '%' escape in a tag");
                    }
                    let _4_hi = 0;
                    let _5_lo = 0;
                    let _out0;
                    _4_hi =
                        (_this).m19(s.charCodeAt((_3_i) + (1)));
                    let _out1;
                    _5_lo =
                        (_this).m19(s.charCodeAt((_3_i) + (2)));
                    if (((_4_hi) < (0)) || ((_5_lo) < (0))) {
                        (_this).mg("malformed '%' escape in a tag");
                    }
                    decoded = Native.__default.concat(decoded, s.slice(_2_seg, _3_i));
                    decoded = Native.__default.concat(decoded, Native.__default.stringFromCharCode(((_4_hi) * (16)) + (_5_lo)));
                    _3_i = (_3_i) + (3);
                    _2_seg = _3_i;
                }
                else {
                    _3_i = (_3_i) + (1);
                }
            }
            decoded = Native.__default.concat(decoded, s.slice(_2_seg, _0_lenS));
            return decoded;
        }
        m1b() {
            let _this = this;
            let tag = "";
            (_this).pos = (_this.pos) + (1);
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (60))) {
                (_this).pos = (_this.pos) + (1);
                let _0_start;
                _0_start = _this.pos;
                let _1_gt = 0;
                _1_gt = Native.__default.indexOf(_this.src, ">", _this.pos);
                if ((_1_gt) < (0)) {
                    (_this).mg("unterminated verbatim tag: missing '>'");
                }
                if ((_1_gt) === (_this.pos)) {
                    (_this).mg("a verbatim tag ('!<...>') must not be empty");
                }
                let _2_end;
                _2_end = _1_gt;
                tag = Native.__default.slice(_this.src, _0_start, _2_end);
                (_this).pos = (_2_end) + (1);
                return tag;
            }
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (33))) {
                (_this).pos = (_this.pos) + (1);
                let _3_suffix = "";
                let _out0;
                _3_suffix =
                    (_this).m18();
                let _4_key;
                _4_key = "!!";
                let _5_tags;
                _5_tags = _this._ft;
                let _6_prefixValue;
                _6_prefixValue = Native.__default.undefinedValue;
                if (_this._fe) {
                    let _out1;
                    _6_prefixValue = _5_tags.get(_4_key);
                }
                let _7_custom;
                _7_custom = !(_6_prefixValue === undefined);
                let _8_prefix;
                _8_prefix = "tag:yaml.org,2002:";
                if (_7_custom) {
                    _8_prefix = _6_prefixValue;
                }
                let _9_decoded;
                let _out2;
                _9_decoded =
                    (_this).m1a(_3_suffix);
                tag = _8_prefix + _9_decoded;
                return tag;
            }
            let _10_wordStart;
            _10_wordStart = _this.pos;
            L12: {
                while ((_this.pos) < (_this.len)) {
                    C12: {
                        let _11_c;
                        _11_c = _this.src.charCodeAt(_this.pos);
                        let _12_word = false;
                        let _out3;
                        _12_word =
                            (_this).m16(_11_c);
                        if (!(_12_word)) {
                            break L12;
                        }
                        (_this).pos = (_this.pos) + (1);
                    }
                }
            }
            if ((((_this.pos) > (_10_wordStart)) && ((_this.pos) < (_this.len))) && ((_this.src.charCodeAt(_this.pos)) === (33))) {
                let _13_handle;
                _13_handle = Native.__default.concat("!", Native.__default.concat(Native.__default.slice(_this.src, _10_wordStart, _this.pos), "!"));
                (_this).pos = (_this.pos) + (1);
                let _14_suffix = "";
                let _out4;
                _14_suffix =
                    (_this).m18();
                let _15_key;
                _15_key = _13_handle;
                let _16_tags;
                _16_tags = _this._ft;
                let _17_prefixValue;
                _17_prefixValue = Native.__default.undefinedValue;
                if (_this._fe) {
                    let _out5;
                    _17_prefixValue = _16_tags.get(_15_key);
                }
                if (_17_prefixValue === undefined) {
                    (_this).mg(Native.__default.concat("undefined tag handle '", _13_handle + "' (no matching %TAG directive in this document)"));
                }
                let _18_prefix;
                _18_prefix = _17_prefixValue;
                let _19_decoded;
                let _out6;
                _19_decoded =
                    (_this).m1a(_14_suffix);
                tag = _18_prefix + _19_decoded;
                return tag;
            }
            (_this).pos = _10_wordStart;
            let _20_primary = "";
            let _out7;
            _20_primary =
                (_this).m18();
            if (_20_primary === "") {
                tag = "!";
                return tag;
            }
            let _21_primaryKey;
            _21_primaryKey = "!";
            let _22_tags;
            _22_tags = _this._ft;
            let _23_primaryValue;
            _23_primaryValue = Native.__default.undefinedValue;
            if (_this._fe) {
                let _out8;
                _23_primaryValue = _22_tags.get(_21_primaryKey);
            }
            let _24_primaryPrefix;
            _24_primaryPrefix = "!";
            if (!(_23_primaryValue === undefined)) {
                _24_primaryPrefix = _23_primaryValue;
            }
            let _25_decoded;
            let _out9;
            _25_decoded =
                (_this).m1a(_20_primary);
            tag = _24_primaryPrefix + _25_decoded;
            return tag;
        }
        m1c(inFlow) {
            let _this = this;
            if ((_this.pos) >= (_this.len)) {
                return;
            }
            let _0_c;
            _0_c = _this.src.charCodeAt(_this.pos);
            if (((((_0_c) === (32)) || ((_0_c) === (9))) || ((_0_c) === (10))) || ((_0_c) === (13))) {
                return;
            }
            if ((inFlow) && ((_this).m0(_0_c))) {
                return;
            }
            (_this).mg("a tag must be separated from the following content by whitespace");
            return;
        }
        m1d(tag, raw) {
            let _this = this;
            let value = undefined;
            if ((tag === "tag:yaml.org,2002:str") || (tag === "!")) {
                value = raw;
                return value;
            }
            if (tag === "tag:yaml.org,2002:null") {
                if (((((raw === "") || (raw === "~")) || (raw === "null")) || (raw === "Null")) || (raw === "NULL")) {
                    value = Native.__default.nullValue;
                    return value;
                }
                (_this).mg(Native.__default.concat("!!null: '", raw + "' is not a valid core-schema null"));
            }
            if (tag === "tag:yaml.org,2002:bool") {
                let _out0;
                value =
                    (_this).m6(raw);
                if (Native.__default.sameValue(value, Native.__default.notNumericValue)) {
                    (_this).mg(Native.__default.concat("!!bool: '", raw + "' is not a valid core-schema boolean"));
                }
                return value;
            }
            if ((tag === "tag:yaml.org,2002:int") || (tag === "tag:yaml.org,2002:float")) {
                let _0_number;
                let _out1;
                _0_number =
                    (_this).mc(raw);
                if (Native.__default.sameValue(_0_number, Native.__default.notNumericValue)) {
                    (_this).mg(Native.__default.concat("!!", Native.__default.concat(((tag === "tag:yaml.org,2002:int") ? ("int") : ("float")), Native.__default.concat(": '", raw + "' is not a valid core-schema number"))));
                }
                if ((tag === "tag:yaml.org,2002:int") && (_this._fk)) {
                    (_this).mg(Native.__default.concat("!!int: '", raw + "' is not a valid core-schema integer"));
                }
                value = _0_number;
                return value;
            }
            if (tag === "tag:yaml.org,2002:binary") {
                let _out2;
                value =
                    (_this._fu).DecodeBinary(raw);
                let _1_binaryError = "";
                let _out3;
                _1_binaryError =
                    (_this._fu).ErrorMessage();
                if (!(_1_binaryError === "")) {
                    (_this).mg(_1_binaryError);
                }
                return value;
            }
            if (((((tag === "tag:yaml.org,2002:map") || (tag === "tag:yaml.org,2002:seq")) || (tag === "tag:yaml.org,2002:set")) || (tag === "tag:yaml.org,2002:omap")) || (tag === "tag:yaml.org,2002:pairs")) {
                (_this).mg("the collection tag requires a mapping/sequence node, not a scalar");
            }
            value = raw;
            return value;
        }
        m1e() {
            let _this = this;
            let value = undefined;
            let _0_tag = "";
            let _out0;
            _0_tag =
                (_this).m1b();
            (_this).m1c(true);
            (_this).mh();
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (33))) {
                (_this).mg("a node may carry at most one tag");
            }
            let _1_anchorName;
            _1_anchorName = "";
            let _2_touched;
            _2_touched = false;
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (38))) {
                (_this).pos = (_this.pos) + (1);
                let _out1;
                _1_anchorName =
                    (_this).m13();
                _2_touched = true;
                (_this).mh();
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (38))) {
                    (_this).mg("a node may carry at most one anchor");
                }
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (33))) {
                    (_this).mg("a node may carry at most one tag");
                }
            }
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (42))) {
                (_this).mg("an alias node cannot carry a tag/anchor property");
            }
            let _3_outerPending;
            _3_outerPending = _this._fo;
            let _4_hadOuterPending;
            _4_hadOuterPending = _this._fd;
            if (_2_touched) {
                (_this)._fo = _1_anchorName;
                (_this)._fd = true;
            }
            let _out2;
            value =
                (_this).m1f(_0_tag);
            if (_2_touched) {
                (_this).m14(value);
                (_this)._fo = _3_outerPending;
                (_this)._fd = _4_hadOuterPending;
            }
            return value;
        }
        m1f(tag) {
            let _this = this;
            let value = undefined;
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (123))) {
                let _out0;
                value =
                    (_this).m1k();
                if ((!(tag === "tag:yaml.org,2002:map")) && (!(tag === "!"))) {
                    (_this).mg("tag does not match a flow mapping node");
                }
                return value;
            }
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (91))) {
                let _out1;
                value =
                    (_this).m1j();
                if ((!(tag === "tag:yaml.org,2002:seq")) && (!(tag === "!"))) {
                    (_this).mg("tag does not match a flow sequence node");
                }
                return value;
            }
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (34))) {
                let _0_quoted = undefined;
                let _out2;
                _0_quoted =
                    (_this).m1r();
                let _out3;
                value =
                    (_this).m1d(tag, _0_quoted);
                return value;
            }
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (39))) {
                let _1_quoted = undefined;
                let _out4;
                _1_quoted =
                    (_this).m1v();
                let _out5;
                value =
                    (_this).m1d(tag, _1_quoted);
                return value;
            }
            let _2_separator;
            _2_separator = (_this.pos) >= (_this.len);
            if ((_this.pos) < (_this.len)) {
                let _out6;
                _2_separator =
                    (_this).m2(_this.pos);
            }
            if (_2_separator) {
                let _out7;
                value =
                    (_this).m1d(tag, "");
                return value;
            }
            let _3_start;
            _3_start = _this.pos;
            let _4_end = 0;
            let _out8;
            _4_end =
                (_this).mj();
            let _5_raw;
            _5_raw = Native.__default.slice(_this.src, _3_start, _4_end);
            (_this).pos = _4_end;
            let _out9;
            value =
                (_this).m1d(tag, _5_raw);
            return value;
        }
        m1g() {
            let _this = this;
            let value = undefined;
            (_this).pos = (_this.pos) + (1);
            let _0_name = "";
            let _out0;
            _0_name =
                (_this).m13();
            (_this).mf();
            let _1_savedPending;
            _1_savedPending = _this._fo;
            let _2_hadSavedPending;
            _2_hadSavedPending = _this._fd;
            (_this)._fo = _0_name;
            (_this)._fd = true;
            let _out1;
            value =
                (_this).my();
            (_this).m14(value);
            (_this)._fo = _1_savedPending;
            (_this)._fd = _2_hadSavedPending;
            return value;
        }
        m1h(key) {
            let _this = this;
            let pair = undefined;
            (_this).pos = (_this.pos) + (1);
            (_this).mh();
            let _0_value;
            _0_value = Native.__default.nullValue;
            if (((((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) !== (44))) && ((_this.src.charCodeAt(_this.pos)) !== (93))) && ((_this.src.charCodeAt(_this.pos)) !== (125))) {
                let _out0;
                _0_value =
                    (_this).my();
            }
            let _out1;
            pair =
                Native.__default.createObject();
            (_this).mv(pair, key, _0_value);
            (_this).mh();
            return pair;
        }
        m1i() {
            let _this = this;
            let pair = undefined;
            (_this).pos = (_this.pos) + (1);
            (_this).mh();
            let _0_key;
            _0_key = "";
            if ((((((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) !== (58))) && ((_this.src.charCodeAt(_this.pos)) !== (44))) && ((_this.src.charCodeAt(_this.pos)) !== (93))) && ((_this.src.charCodeAt(_this.pos)) !== (125))) {
                let _1_keyValue;
                let _out0;
                _1_keyValue =
                    (_this).my();
                let _out1;
                _0_key =
                    (_this).ms(_1_keyValue);
            }
            (_this).mh();
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (58))) {
                let _out2;
                pair =
                    (_this).m1h(_0_key);
                return pair;
            }
            let _out3;
            pair =
                Native.__default.createObject();
            (_this).mv(pair, _0_key, Native.__default.nullValue);
            return pair;
        }
        m1j() {
            let _this = this;
            let result = undefined;
            (_this)._f4 = (_this._f4) + (1);
            if ((_this._f4) > (1000)) {
                (_this).mg("maximum nesting depth exceeded");
            }
            (_this).pos = (_this.pos) + (1);
            let _out0;
            result =
                Native.__default.createArray();
            (_this).m14(result);
            (_this).mh();
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (93))) {
                (_this).pos = (_this.pos) + (1);
                (_this)._f4 = (_this._f4) - (1);
                return result;
            }
            L13: {
                while (true) {
                    C13: {
                        if ((_this.pos) >= (_this.len)) {
                            (_this).mg("expected ',' or ']' in flow sequence");
                        }
                        let _0_emptyKey;
                        _0_emptyKey = false;
                        if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (58))) {
                            let _out1;
                            _0_emptyKey =
                                (_this).m2((_this.pos) + (1));
                        }
                        if (_0_emptyKey) {
                            let _1_emptyPair;
                            let _out2;
                            _1_emptyPair =
                                (_this).m1h("");
                            result.push(_1_emptyPair);
                        }
                        else if (((_this.src.charCodeAt(_this.pos)) === (63)) && (((_this.pos) + (1)) < (_this.len))) {
                            let _2_questionSeparator = false;
                            let _out3;
                            _2_questionSeparator =
                                (_this).m2((_this.pos) + (1));
                            if (_2_questionSeparator) {
                                let _3_explicitPair;
                                let _out4;
                                _3_explicitPair =
                                    (_this).m1i();
                                result.push(_3_explicitPair);
                            }
                            else {
                                let _4_item;
                                let _out5;
                                _4_item =
                                    (_this).my();
                                (_this).mh();
                                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (58))) {
                                    if (_this._f8) {
                                        (_this).mg("an implicit key in a flow sequence must be on a single line");
                                    }
                                    let _5_itemKey;
                                    let _out6;
                                    _5_itemKey =
                                        (_this).ms(_4_item);
                                    let _6_pair;
                                    let _out7;
                                    _6_pair =
                                        (_this).m1h(_5_itemKey);
                                    result.push(_6_pair);
                                }
                                else {
                                    result.push(_4_item);
                                }
                            }
                        }
                        else {
                            let _7_item;
                            let _out8;
                            _7_item =
                                (_this).my();
                            (_this).mh();
                            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (58))) {
                                if (_this._f8) {
                                    (_this).mg("an implicit key in a flow sequence must be on a single line");
                                }
                                let _8_itemKey;
                                let _out9;
                                _8_itemKey =
                                    (_this).ms(_7_item);
                                let _9_pair;
                                let _out10;
                                _9_pair =
                                    (_this).m1h(_8_itemKey);
                                result.push(_9_pair);
                            }
                            else {
                                result.push(_7_item);
                            }
                        }
                        (_this).mh();
                        if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (44))) {
                            (_this).pos = (_this.pos) + (1);
                            (_this).mh();
                            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (93))) {
                                (_this).pos = (_this.pos) + (1);
                                (_this)._f4 = (_this._f4) - (1);
                                return result;
                            }
                            break C13;
                        }
                        if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (93))) {
                            (_this).pos = (_this.pos) + (1);
                            (_this)._f4 = (_this._f4) - (1);
                            return result;
                        }
                        (_this).mg("expected ',' or ']' in flow sequence");
                    }
                }
            }
            return result;
        }
        m1k() {
            let _this = this;
            let result = undefined;
            (_this)._f4 = (_this._f4) + (1);
            if ((_this._f4) > (1000)) {
                (_this).mg("maximum nesting depth exceeded");
            }
            (_this).pos = (_this.pos) + (1);
            let _out0;
            result =
                Native.__default.createObject();
            (_this).m14(result);
            let _0_expected;
            _0_expected = _this._fl;
            let _1_hasExpected;
            _1_hasExpected = _this._fc;
            let _2_expectedLength;
            _2_expectedLength = 0;
            if (_1_hasExpected) {
                let _out1;
                _2_expectedLength = _0_expected.length;
            }
            let _3_produced;
            _3_produced = _0_expected;
            let _4_matched;
            _4_matched = true;
            let _5_keyCount;
            _5_keyCount = 0;
            (_this).mh();
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (125))) {
                (_this).pos = (_this.pos) + (1);
                (_this)._fc = false;
                (_this)._fl = Native.__default.undefinedValue;
                (_this)._f4 = (_this._f4) - (1);
                return result;
            }
            L14: {
                while (true) {
                    C14: {
                        if ((_this.pos) >= (_this.len)) {
                            (_this).mg("expected ',' or '}' in flow mapping");
                        }
                        let _6_key;
                        _6_key = "";
                        let _7_c;
                        _7_c = _this.src.charCodeAt(_this.pos);
                        let _8_explicitKey;
                        _8_explicitKey = false;
                        if (((_7_c) === (63)) && (((_this.pos) + (1)) < (_this.len))) {
                            let _9_questionSeparator = false;
                            let _out2;
                            _9_questionSeparator =
                                (_this).m2((_this.pos) + (1));
                            if (_9_questionSeparator) {
                                _8_explicitKey = true;
                                (_this).pos = (_this.pos) + (1);
                                (_this).mh();
                                if (((((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) !== (58))) && ((_this.src.charCodeAt(_this.pos)) !== (44))) && ((_this.src.charCodeAt(_this.pos)) !== (125))) {
                                    let _10_explicitKeyValue;
                                    let _out3;
                                    _10_explicitKeyValue =
                                        (_this).my();
                                    let _out4;
                                    _6_key =
                                        (_this).ms(_10_explicitKeyValue);
                                }
                            }
                            else {
                                let _11_fast;
                                _11_fast = false;
                                if ((((_4_matched) && (_1_hasExpected)) && ((_5_keyCount) < (_2_expectedLength))) && (!(_this._fd))) {
                                    let _12_expectedValue = undefined;
                                    let _out5;
                                    _12_expectedValue = _0_expected[_5_keyCount];
                                    let _13_expectedKey;
                                    _13_expectedKey = _12_expectedValue;
                                    let _out6;
                                    _11_fast =
                                        (_this).m1l(_13_expectedKey);
                                    if (_11_fast) {
                                        _6_key = _13_expectedKey;
                                    }
                                }
                                if (!(_11_fast)) {
                                    let _out7;
                                    _6_key =
                                        (_this).mz();
                                }
                            }
                        }
                        else {
                            let _14_fast;
                            _14_fast = false;
                            if ((((_4_matched) && (_1_hasExpected)) && ((_5_keyCount) < (_2_expectedLength))) && (!(_this._fd))) {
                                let _15_expectedValue = undefined;
                                let _out8;
                                _15_expectedValue = _0_expected[_5_keyCount];
                                let _16_expectedKey;
                                _16_expectedKey = _15_expectedValue;
                                let _out9;
                                _14_fast =
                                    (_this).m1l(_16_expectedKey);
                                if (_14_fast) {
                                    _6_key = _16_expectedKey;
                                }
                            }
                            if (!(_14_fast)) {
                                let _out10;
                                _6_key =
                                    (_this).mz();
                            }
                        }
                        if (((_4_matched) && (_1_hasExpected)) && ((_5_keyCount) < (_2_expectedLength))) {
                            let _17_expectedValue = undefined;
                            let _out11;
                            _17_expectedValue = _0_expected[_5_keyCount];
                            let _18_expectedKey;
                            _18_expectedKey = _17_expectedValue;
                            if (!(_18_expectedKey === _6_key)) {
                                let _out12;
                                _3_produced =
                                    Native.__default.createArray();
                                let _19_copyIndex;
                                _19_copyIndex = 0;
                                while ((_19_copyIndex) < (_5_keyCount)) {
                                    let _20_oldKey = undefined;
                                    let _out13;
                                    _20_oldKey = _0_expected[_19_copyIndex];
                                    _3_produced.push(_20_oldKey);
                                    _19_copyIndex = (_19_copyIndex) + (1);
                                }
                                _3_produced.push(_6_key);
                                _4_matched = false;
                            }
                        }
                        else if (_4_matched) {
                            let _out14;
                            _3_produced =
                                Native.__default.createArray();
                            if (_1_hasExpected) {
                                let _21_copyIndex;
                                _21_copyIndex = 0;
                                while ((_21_copyIndex) < (_5_keyCount)) {
                                    let _22_oldKey = undefined;
                                    let _out15;
                                    _22_oldKey = _0_expected[_21_copyIndex];
                                    _3_produced.push(_22_oldKey);
                                    _21_copyIndex = (_21_copyIndex) + (1);
                                }
                            }
                            _3_produced.push(_6_key);
                            _4_matched = false;
                        }
                        else {
                            _3_produced.push(_6_key);
                        }
                        _5_keyCount = (_5_keyCount) + (1);
                        (_this).mh();
                        let _23_value;
                        _23_value = Native.__default.nullValue;
                        if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (58))) {
                            (_this).pos = (_this.pos) + (1);
                            (_this).mh();
                            if ((((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) !== (44))) && ((_this.src.charCodeAt(_this.pos)) !== (125))) {
                                let _out16;
                                _23_value =
                                    (_this).my();
                            }
                        }
                        (_this).mv(result, _6_key, _23_value);
                        (_this).mh();
                        if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (44))) {
                            (_this).pos = (_this.pos) + (1);
                            (_this).mh();
                            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (125))) {
                                (_this).pos = (_this.pos) + (1);
                                (_this).m1m(_0_expected, _1_hasExpected, _3_produced, _4_matched, _5_keyCount, _2_expectedLength);
                                (_this)._f4 = (_this._f4) - (1);
                                return result;
                            }
                            break C14;
                        }
                        if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (125))) {
                            (_this).pos = (_this.pos) + (1);
                            (_this).m1m(_0_expected, _1_hasExpected, _3_produced, _4_matched, _5_keyCount, _2_expectedLength);
                            (_this)._f4 = (_this._f4) - (1);
                            return result;
                        }
                        (_this).mg("expected ',' or '}' in flow mapping");
                    }
                }
            }
            (_this).m1m(_0_expected, _1_hasExpected, _3_produced, _4_matched, _5_keyCount, _2_expectedLength);
            return result;
        }
        m1l(expected) {
            let _this = this;
            let matchedKey = false;
            matchedKey = false;
            if (((_this.pos) >= (_this.len)) || ((_this.src.charCodeAt(_this.pos)) !== (34))) {
                return matchedKey;
            }
            let _0_n;
            _0_n = expected.length;
            if ((((_this.pos) + (_0_n)) + (1)) >= (_this.len)) {
                return matchedKey;
            }
            let _1_i;
            _1_i = 0;
            while ((_1_i) < (_0_n)) {
                if ((_this.src.charCodeAt(((_this.pos) + (1)) + (_1_i))) !== (expected.charCodeAt(_1_i))) {
                    return matchedKey;
                }
                _1_i = (_1_i) + (1);
            }
            if ((_this.src.charCodeAt(((_this.pos) + (1)) + (_0_n))) !== (34)) {
                return matchedKey;
            }
            (_this).pos = ((_this.pos) + (_0_n)) + (2);
            matchedKey = true;
            return matchedKey;
        }
        m1m(expected, hasExpected, produced, matched, count, expectedLength) {
            let _this = this;
            if (!(matched)) {
                (_this)._fl = produced;
                (_this)._fc = true;
                return;
            }
            if ((count) === (0)) {
                (_this)._fl = Native.__default.undefinedValue;
                (_this)._fc = false;
                return;
            }
            if ((hasExpected) && ((count) === (expectedLength))) {
                (_this)._fl = expected;
                (_this)._fc = true;
                return;
            }
            let _0_result;
            let _out0;
            _0_result =
                Native.__default.createArray();
            let _1_i;
            _1_i = 0;
            while ((_1_i) < (count)) {
                let _2_key = undefined;
                let _out1;
                _2_key = expected[_1_i];
                _0_result.push(_2_key);
                _1_i = (_1_i) + (1);
            }
            (_this)._fl = _0_result;
            (_this)._fc = true;
            return;
        }
        m1n(c) {
            let _this = this;
            let yes = false;
            yes = ((((c) === (32)) || ((c) === (9))) || ((c) === (10))) || ((c) === (13));
            return yes;
        }
        m1o(i) {
            let _this = this;
            let yes = false;
            yes = false;
            if (((i) + (2)) >= (_this.len)) {
                return yes;
            }
            let _0_c;
            _0_c = _this.src.charCodeAt(i);
            if (((_0_c) !== (45)) && ((_0_c) !== (46))) {
                return yes;
            }
            if (((_this.src.charCodeAt((i) + (1))) !== (_0_c)) || ((_this.src.charCodeAt((i) + (2))) !== (_0_c))) {
                return yes;
            }
            if (((i) + (3)) >= (_this.len)) {
                yes = true;
                return yes;
            }
            let _out0;
            yes =
                (_this).m1n(_this.src.charCodeAt((i) + (3)));
            return yes;
        }
        m1p(s) {
            let _this = this;
            let value = undefined;
            value = s;
            if (!(_this._fw)) {
                return value;
            }
            if (!(_this._ff)) {
                let _0_newValues;
                let _out0;
                _0_newValues =
                    Native.__default.mapCreate();
                (_this)._fv = _0_newValues;
                (_this)._ff = true;
            }
            let _1_values;
            _1_values = _this._fv;
            let _2_cached;
            let _out1;
            _2_cached = _1_values.get(value);
            if (!(_2_cached === undefined)) {
                value = _2_cached;
                return value;
            }
            let _3_cacheSize = 0;
            let _out2;
            _3_cacheSize = _1_values.size;
            if ((_3_cacheSize) < (1000000)) {
                _1_values.set(value, value);
            }
            return value;
        }
        m1q(at) {
            let _this = this;
            let next = 0;
            let _0_i;
            _0_i = at;
            let _1_breaks;
            _1_breaks = 0;
            L15: {
                while (true) {
                    C15: {
                        if ((_this.src.charCodeAt(_0_i)) === (13)) {
                            _0_i = (_0_i) + (1);
                            if (((_0_i) < (_this.len)) && ((_this.src.charCodeAt(_0_i)) === (10))) {
                                _0_i = (_0_i) + (1);
                            }
                        }
                        else {
                            _0_i = (_0_i) + (1);
                        }
                        _1_breaks = (_1_breaks) + (1);
                        let _2_isMarker = false;
                        let _out0;
                        _2_isMarker =
                            (_this).m1o(_0_i);
                        if (_2_isMarker) {
                            (_this).mg("unterminated quoted string: a document marker interrupts it");
                        }
                        let _3_ls;
                        _3_ls = _0_i;
                        while (((_0_i) < (_this.len)) && (((_this.src.charCodeAt(_0_i)) === (32)) || ((_this.src.charCodeAt(_0_i)) === (9)))) {
                            _0_i = (_0_i) + (1);
                        }
                        if ((_0_i) >= (_this.len)) {
                            (_this).mg("unterminated quoted string");
                        }
                        let _4_cc;
                        _4_cc = _this.src.charCodeAt(_0_i);
                        if (((_4_cc) !== (10)) && ((_4_cc) !== (13))) {
                            if (((_this._f6) >= (0)) && (((_0_i) - (_3_ls)) <= (_this._f6))) {
                                (_this).pos = _0_i;
                                (_this).mg("insufficient indentation for a multi-line quoted scalar");
                            }
                            break L15;
                        }
                    }
                }
            }
            (_this)._f9 = _1_breaks;
            (_this)._fr = true;
            next = _0_i;
            return next;
        }
        m1r() {
            let _this = this;
            let value = undefined;
            (_this)._fr = false;
            let _0_start;
            _0_start = (_this.pos) + (1);
            let _1_e;
            _1_e = Native.__default.indexOf(_this.src, "\"", _0_start);
            if ((_1_e) === (-1)) {
                (_this).mg("unterminated double-quoted string");
            }
            if ((_this._fm) < (_0_start)) {
                let _2_b;
                _2_b = Native.__default.indexOf(_this.src, "\\", _0_start);
                if ((_2_b) === (-1)) {
                    (_this)._fm = _this.len;
                }
                else {
                    (_this)._fm = _2_b;
                }
            }
            if ((_this._fm) > (_1_e)) {
                if ((_this._fn) < (_0_start)) {
                    let _3_n;
                    _3_n = Native.__default.indexOf(_this.src, "\n", _0_start);
                    if ((_3_n) === (-1)) {
                        (_this)._fn = _this.len;
                    }
                    else {
                        (_this)._fn = _3_n;
                    }
                }
                if ((_this._fn) > (_1_e)) {
                    (_this).pos = (_1_e) + (1);
                    let _out0;
                    value =
                        (_this).m1p(Native.__default.slice(_this.src, _0_start, _1_e));
                    return value;
                }
            }
            let _out1;
            value =
                (_this).m1s(_0_start);
            return value;
        }
        m1s(start) {
            let _this = this;
            let value = undefined;
            let _0_result;
            _0_result = "";
            let _1_seg;
            _1_seg = start;
            let _2_i;
            _2_i = start;
            L16: {
                while (true) {
                    C16: {
                        if ((_2_i) >= (_this.len)) {
                            (_this).mg("unterminated double-quoted string");
                        }
                        let _3_c;
                        _3_c = _this.src.charCodeAt(_2_i);
                        if ((_3_c) === (34)) {
                            _0_result = Native.__default.concat(_0_result, Native.__default.slice(_this.src, _1_seg, _2_i));
                            (_this).pos = (_2_i) + (1);
                            value = _0_result;
                            return value;
                        }
                        if ((_3_c) === (92)) {
                            if ((_2_i) > (_1_seg)) {
                                _0_result = Native.__default.concat(_0_result, Native.__default.slice(_this.src, _1_seg, _2_i));
                            }
                            _2_i = (_2_i) + (1);
                            if ((_2_i) >= (_this.len)) {
                                (_this).mg("unterminated escape sequence");
                            }
                            let _4_ec;
                            _4_ec = _this.src.charCodeAt(_2_i);
                            if ((_4_ec) === (34)) {
                                _0_result = _0_result + "\"";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (92)) {
                                _0_result = _0_result + "\\";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (47)) {
                                _0_result = _0_result + "/";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (48)) {
                                _0_result = _0_result + "\u0000";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (97)) {
                                _0_result = _0_result + "\u0007";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (98)) {
                                _0_result = _0_result + "\u0008";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (101)) {
                                _0_result = _0_result + "\u001b";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (102)) {
                                _0_result = _0_result + "\u000c";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (110)) {
                                _0_result = _0_result + "\n";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (114)) {
                                _0_result = _0_result + "\r";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (116)) {
                                _0_result = _0_result + "\t";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (118)) {
                                _0_result = _0_result + "\u000b";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (32)) {
                                _0_result = _0_result + " ";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (9)) {
                                _0_result = _0_result + "\t";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (78)) {
                                _0_result = _0_result + "\u0085";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (95)) {
                                _0_result = _0_result + "\u00a0";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (76)) {
                                _0_result = _0_result + "\u2028";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (80)) {
                                _0_result = _0_result + "\u2029";
                                _2_i = (_2_i) + (1);
                            }
                            else if ((_4_ec) === (120)) {
                                let _5_hex;
                                let _out0;
                                _5_hex =
                                    (_this).m1t((_2_i) + (1), 2);
                                _0_result = Native.__default.concat(_0_result, Native.__default.stringFromCharCode(_5_hex));
                                _2_i = (_2_i) + (3);
                            }
                            else if ((_4_ec) === (117)) {
                                let _6_hex;
                                let _out1;
                                _6_hex =
                                    (_this).m1t((_2_i) + (1), 4);
                                _0_result = Native.__default.concat(_0_result, Native.__default.stringFromCharCode(_6_hex));
                                _2_i = (_2_i) + (5);
                            }
                            else if ((_4_ec) === (85)) {
                                let _7_cp;
                                let _out2;
                                _7_cp =
                                    (_this).m1t((_2_i) + (1), 8);
                                _0_result = Native.__default.concat(_0_result, Native.__default.stringFromCodePoint(_7_cp));
                                _2_i = (_2_i) + (9);
                            }
                            else if ((_4_ec) === (10)) {
                                _2_i = (_2_i) + (1);
                                while (((_2_i) < (_this.len)) && (((_this.src.charCodeAt(_2_i)) === (32)) || ((_this.src.charCodeAt(_2_i)) === (9)))) {
                                    _2_i = (_2_i) + (1);
                                }
                            }
                            else if ((_4_ec) === (13)) {
                                _2_i = (_2_i) + (1);
                                if (((_2_i) < (_this.len)) && ((_this.src.charCodeAt(_2_i)) === (10))) {
                                    _2_i = (_2_i) + (1);
                                }
                                while (((_2_i) < (_this.len)) && (((_this.src.charCodeAt(_2_i)) === (32)) || ((_this.src.charCodeAt(_2_i)) === (9)))) {
                                    _2_i = (_2_i) + (1);
                                }
                            }
                            else {
                                (_this).mg("invalid escape sequence in double-quoted string");
                            }
                            _1_seg = _2_i;
                            break C16;
                        }
                        if (((_3_c) === (10)) || ((_3_c) === (13))) {
                            let _8_j;
                            _8_j = _2_i;
                            while (((_8_j) > (_1_seg)) && (((_this.src.charCodeAt((_8_j) - (1))) === (32)) || ((_this.src.charCodeAt((_8_j) - (1))) === (9)))) {
                                _8_j = (_8_j) - (1);
                            }
                            _0_result = Native.__default.concat(_0_result, Native.__default.slice(_this.src, _1_seg, _8_j));
                            let _out3;
                            _2_i =
                                (_this).m1q(_2_i);
                            if ((_this._f9) === (1)) {
                                _0_result = _0_result + " ";
                            }
                            else {
                                _0_result = Native.__default.concat(_0_result, Native.__default.repeat("\n", (_this._f9) - (1)));
                            }
                            _1_seg = _2_i;
                            break C16;
                        }
                        _2_i = (_2_i) + (1);
                    }
                }
            }
            return value;
        }
        m1t(start, width) {
            let _this = this;
            let value = 0;
            if (((start) + (width)) > (_this.len)) {
                (_this).mg("truncated \\x/\\u/\\U escape");
            }
            value = 0;
            let _0_k;
            _0_k = 0;
            while ((_0_k) < (width)) {
                let _1_d = 0;
                let _out0;
                _1_d =
                    (_this).m1u(_this.src.charCodeAt((start) + (_0_k)));
                value = ((value) * (16)) + (_1_d);
                _0_k = (_0_k) + (1);
            }
            return value;
        }
        m1u(c) {
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
            (_this).mg("invalid hex digit in \\u escape");
            value = 0;
            return value;
        }
        m1v() {
            let _this = this;
            let value = undefined;
            (_this)._fr = false;
            let _0_start;
            _0_start = (_this.pos) + (1);
            let _1_e;
            _1_e = Native.__default.indexOf(_this.src, "'", _0_start);
            if ((_1_e) === (-1)) {
                (_this).mg("unterminated single-quoted string");
            }
            if ((((_1_e) + (1)) < (_this.len)) && ((_this.src.charCodeAt((_1_e) + (1))) === (39))) {
                let _out0;
                value =
                    (_this).m1w(_0_start);
                return value;
            }
            if ((_this._fn) < (_0_start)) {
                let _2_n;
                _2_n = Native.__default.indexOf(_this.src, "\n", _0_start);
                if ((_2_n) === (-1)) {
                    (_this)._fn = _this.len;
                }
                else {
                    (_this)._fn = _2_n;
                }
            }
            if ((_this._fn) < (_1_e)) {
                let _out1;
                value =
                    (_this).m1w(_0_start);
                return value;
            }
            (_this).pos = (_1_e) + (1);
            let _out2;
            value =
                (_this).m1p(Native.__default.slice(_this.src, _0_start, _1_e));
            return value;
        }
        m1w(start) {
            let _this = this;
            let value = undefined;
            let _0_result;
            _0_result = "";
            let _1_seg;
            _1_seg = start;
            let _2_i;
            _2_i = start;
            L17: {
                while (true) {
                    C17: {
                        if ((_2_i) >= (_this.len)) {
                            (_this).mg("unterminated single-quoted string");
                        }
                        let _3_c;
                        _3_c = _this.src.charCodeAt(_2_i);
                        if ((_3_c) === (39)) {
                            if ((((_2_i) + (1)) < (_this.len)) && ((_this.src.charCodeAt((_2_i) + (1))) === (39))) {
                                _0_result = Native.__default.concat(Native.__default.concat(_0_result, Native.__default.slice(_this.src, _1_seg, _2_i)), "'");
                                _2_i = (_2_i) + (2);
                                _1_seg = _2_i;
                                break C17;
                            }
                            _0_result = Native.__default.concat(_0_result, Native.__default.slice(_this.src, _1_seg, _2_i));
                            (_this).pos = (_2_i) + (1);
                            value = _0_result;
                            return value;
                        }
                        if (((_3_c) === (10)) || ((_3_c) === (13))) {
                            let _4_j;
                            _4_j = _2_i;
                            while (((_4_j) > (_1_seg)) && (((_this.src.charCodeAt((_4_j) - (1))) === (32)) || ((_this.src.charCodeAt((_4_j) - (1))) === (9)))) {
                                _4_j = (_4_j) - (1);
                            }
                            _0_result = Native.__default.concat(_0_result, Native.__default.slice(_this.src, _1_seg, _4_j));
                            let _out0;
                            _2_i =
                                (_this).m1q(_2_i);
                            if ((_this._f9) === (1)) {
                                _0_result = _0_result + " ";
                            }
                            else {
                                _0_result = Native.__default.concat(_0_result, Native.__default.repeat("\n", (_this._f9) - (1)));
                            }
                            _1_seg = _2_i;
                            break C17;
                        }
                        _2_i = (_2_i) + (1);
                    }
                }
            }
            return value;
        }
        m1x(effParentCol) {
            let _this = this;
            let indent = 0;
            let _0_p;
            _0_p = _this.pos;
            let _1_maxBlankIndent;
            _1_maxBlankIndent = -1;
            L18: {
                while (true) {
                    C18: {
                        let _2_marker = false;
                        let _out0;
                        _2_marker =
                            (_this).m1o(_0_p);
                        if (((_0_p) >= (_this.len)) || (_2_marker)) {
                            if ((_1_maxBlankIndent) > (effParentCol)) {
                                indent = _1_maxBlankIndent;
                            }
                            else {
                                indent = (effParentCol) + (1);
                            }
                            return indent;
                        }
                        let _3_spaces;
                        _3_spaces = 0;
                        let _4_q;
                        _4_q = _0_p;
                        while (((_4_q) < (_this.len)) && ((_this.src.charCodeAt(_4_q)) === (32))) {
                            _3_spaces = (_3_spaces) + (1);
                            _4_q = (_4_q) + (1);
                        }
                        let _5_r;
                        _5_r = _4_q;
                        L19: {
                            while ((_5_r) < (_this.len)) {
                                C19: {
                                    let _6_rc;
                                    _6_rc = _this.src.charCodeAt(_5_r);
                                    if (((_6_rc) === (10)) || ((_6_rc) === (13))) {
                                        break L19;
                                    }
                                    if (((_6_rc) !== (32)) && ((_6_rc) !== (9))) {
                                        break L19;
                                    }
                                    _5_r = (_5_r) + (1);
                                }
                            }
                        }
                        let _7_stop;
                        _7_stop = -1;
                        if ((_5_r) < (_this.len)) {
                            _7_stop = _this.src.charCodeAt(_5_r);
                        }
                        if ((((_7_stop) === (-1)) || ((_7_stop) === (10))) || ((_7_stop) === (13))) {
                            if ((_3_spaces) > (_1_maxBlankIndent)) {
                                _1_maxBlankIndent = _3_spaces;
                            }
                            if ((_7_stop) === (10)) {
                                _0_p = (_5_r) + (1);
                            }
                            else if ((_7_stop) === (13)) {
                                if ((((_5_r) + (1)) < (_this.len)) && ((_this.src.charCodeAt((_5_r) + (1))) === (10))) {
                                    _0_p = (_5_r) + (2);
                                }
                                else {
                                    _0_p = (_5_r) + (1);
                                }
                            }
                            else {
                                _0_p = _this.len;
                            }
                            break C18;
                        }
                        if ((_3_spaces) <= (effParentCol)) {
                            if ((_1_maxBlankIndent) > (effParentCol)) {
                                indent = _1_maxBlankIndent;
                            }
                            else {
                                indent = (effParentCol) + (1);
                            }
                            return indent;
                        }
                        if ((_1_maxBlankIndent) > (_3_spaces)) {
                            (_this).mg("a block scalar's leading empty lines must not be more indented than its first line of content");
                        }
                        indent = _3_spaces;
                        return indent;
                    }
                }
            }
            return indent;
        }
        m1y() {
            let _this = this;
            L20: {
                while ((_this.pos) < (_this.len)) {
                    C20: {
                        while (((_this.pos) < (_this.len)) && (((_this.src.charCodeAt(_this.pos)) === (32)) || ((_this.src.charCodeAt(_this.pos)) === (9)))) {
                            (_this).pos = (_this.pos) + (1);
                        }
                        if ((_this.pos) >= (_this.len)) {
                            return;
                        }
                        let _0_c;
                        _0_c = _this.src.charCodeAt(_this.pos);
                        if ((_0_c) === (10)) {
                            (_this).pos = (_this.pos) + (1);
                            (_this).lineStart = _this.pos;
                            break C20;
                        }
                        if ((_0_c) === (13)) {
                            (_this).pos = (_this.pos) + (1);
                            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (10))) {
                                (_this).pos = (_this.pos) + (1);
                            }
                            (_this).lineStart = _this.pos;
                            break C20;
                        }
                        if ((_0_c) === (35)) {
                            let _1_nl;
                            _1_nl = Native.__default.indexOf(_this.src, "\n", _this.pos);
                            if ((_1_nl) === (-1)) {
                                (_this).pos = _this.len;
                            }
                            else {
                                (_this).pos = (_1_nl) + (1);
                            }
                            (_this).lineStart = _this.pos;
                            break C20;
                        }
                        return;
                    }
                }
            }
            return;
        }
        m1z(parentCol) {
            let _this = this;
            let value = undefined;
            let _0_folded;
            _0_folded = (_this.src.charCodeAt(_this.pos)) === (62);
            (_this).pos = (_this.pos) + (1);
            let _1_indentIndicator;
            _1_indentIndicator = 0;
            let _2_chomp;
            _2_chomp = 0;
            let _3_headerCount;
            _3_headerCount = 0;
            L21: {
                while ((_3_headerCount) < (2)) {
                    C21: {
                        let _4_c;
                        _4_c = -1;
                        if ((_this.pos) < (_this.len)) {
                            _4_c = _this.src.charCodeAt(_this.pos);
                        }
                        if ((((49) <= (_4_c)) && ((_4_c) <= (57))) && ((_1_indentIndicator) === (0))) {
                            _1_indentIndicator = (_4_c) - (48);
                            (_this).pos = (_this.pos) + (1);
                        }
                        else if (((_4_c) === (45)) && ((_2_chomp) === (0))) {
                            _2_chomp = -1;
                            (_this).pos = (_this.pos) + (1);
                        }
                        else if (((_4_c) === (43)) && ((_2_chomp) === (0))) {
                            _2_chomp = 1;
                            (_this).pos = (_this.pos) + (1);
                        }
                        else {
                            break L21;
                        }
                        _3_headerCount = (_3_headerCount) + (1);
                    }
                }
            }
            let _5_sawSpace;
            _5_sawSpace = false;
            while (((_this.pos) < (_this.len)) && (((_this.src.charCodeAt(_this.pos)) === (32)) || ((_this.src.charCodeAt(_this.pos)) === (9)))) {
                (_this).pos = (_this.pos) + (1);
                _5_sawSpace = true;
            }
            let _6_afterHeader;
            _6_afterHeader = -1;
            if ((_this.pos) < (_this.len)) {
                _6_afterHeader = _this.src.charCodeAt(_this.pos);
            }
            if ((_6_afterHeader) === (35)) {
                if (!(_5_sawSpace)) {
                    (_this).mg("a comment after a block scalar header must be preceded by whitespace");
                }
                let _7_commentEnd;
                _7_commentEnd = Native.__default.indexOf(_this.src, "\n", _this.pos);
                if ((_7_commentEnd) === (-1)) {
                    (_this).pos = _this.len;
                }
                else {
                    (_this).pos = _7_commentEnd;
                }
            }
            else if ((((_6_afterHeader) !== (-1)) && ((_6_afterHeader) !== (10))) && ((_6_afterHeader) !== (13))) {
                (_this).mg("invalid block scalar header (expected an indentation indicator, chomping indicator, comment, or end of line)");
            }
            if ((_this.pos) < (_this.len)) {
                let _8_c;
                _8_c = _this.src.charCodeAt(_this.pos);
                if ((_8_c) === (10)) {
                    (_this).pos = (_this.pos) + (1);
                }
                else if ((_8_c) === (13)) {
                    (_this).pos = (_this.pos) + (1);
                    if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (10))) {
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
            }
            else {
                let _out0;
                _10_contentIndent =
                    (_this).m1x(_9_effParentCol);
            }
            let _11_result;
            _11_result = "";
            let _12_sawContent;
            _12_sawContent = false;
            let _13_prevMoreIndented;
            _13_prevMoreIndented = false;
            let _14_pendingBreaks;
            _14_pendingBreaks = 0;
            L22: {
                while (true) {
                    C22: {
                        if ((_this.pos) >= (_this.len)) {
                            break L22;
                        }
                        let _15_docMarker = false;
                        let _out1;
                        _15_docMarker =
                            (_this).IsDocMarkerAt(_this.pos);
                        if (_15_docMarker) {
                            break L22;
                        }
                        let _16_count;
                        _16_count = 0;
                        let _17_p;
                        _17_p = _this.pos;
                        L23: {
                            while ((_16_count) < (_10_contentIndent)) {
                                C23: {
                                    let _18_c;
                                    _18_c = -1;
                                    if ((_17_p) < (_this.len)) {
                                        _18_c = _this.src.charCodeAt(_17_p);
                                    }
                                    if ((_18_c) === (32)) {
                                        _16_count = (_16_count) + (1);
                                        _17_p = (_17_p) + (1);
                                        break C23;
                                    }
                                    if ((_18_c) === (9)) {
                                        (_this).mg("tab characters are not allowed in block scalar indentation");
                                    }
                                    break L23;
                                }
                            }
                        }
                        if ((_16_count) < (_10_contentIndent)) {
                            let _19_c;
                            _19_c = -1;
                            if ((_17_p) < (_this.len)) {
                                _19_c = _this.src.charCodeAt(_17_p);
                            }
                            if ((((_19_c) === (-1)) || ((_19_c) === (10))) || ((_19_c) === (13))) {
                                _14_pendingBreaks = (_14_pendingBreaks) + (1);
                                if ((_19_c) === (10)) {
                                    (_this).pos = (_17_p) + (1);
                                }
                                else if ((_19_c) === (13)) {
                                    if ((((_17_p) + (1)) < (_this.len)) && ((_this.src.charCodeAt((_17_p) + (1))) === (10))) {
                                        (_this).pos = (_17_p) + (2);
                                    }
                                    else {
                                        (_this).pos = (_17_p) + (1);
                                    }
                                }
                                else {
                                    (_this).pos = _this.len;
                                }
                                (_this).lineStart = _this.pos;
                                break C22;
                            }
                            (_this).pos = _17_p;
                            break L22;
                        }
                        let _20_nl;
                        _20_nl = Native.__default.indexOf(_this.src, "\n", _17_p);
                        let _21_lineEnd = 0;
                        if ((_20_nl) === (-1)) {
                            _21_lineEnd = _this.len;
                        }
                        else {
                            _21_lineEnd = _20_nl;
                        }
                        let _22_textEnd;
                        _22_textEnd = _21_lineEnd;
                        if (((_22_textEnd) > (_17_p)) && ((_this.src.charCodeAt((_22_textEnd) - (1))) === (13))) {
                            _22_textEnd = (_22_textEnd) - (1);
                        }
                        let _23_text;
                        _23_text = Native.__default.slice(_this.src, _17_p, _22_textEnd);
                        if (_23_text === "") {
                            _14_pendingBreaks = (_14_pendingBreaks) + (1);
                        }
                        else {
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
                                _11_result = _11_result + _23_text;
                            }
                            else if (!(_0_folded)) {
                                let _26_breakCount = 0;
                                if ((_14_pendingBreaks) === (0)) {
                                    _26_breakCount = 1;
                                }
                                else {
                                    _26_breakCount = (_14_pendingBreaks) + (1);
                                }
                                _11_result = Native.__default.concat(_11_result, Native.__default.repeat("\n", _26_breakCount));
                                _11_result = _11_result + _23_text;
                            }
                            else {
                                let _27_moreInvolved;
                                _27_moreInvolved = (_13_prevMoreIndented) || (_24_moreIndented);
                                if (((_14_pendingBreaks) === (0)) && (!(_27_moreInvolved))) {
                                    _11_result = _11_result + " ";
                                    _11_result = _11_result + _23_text;
                                }
                                else if (_27_moreInvolved) {
                                    let _28_breakCount = 0;
                                    if ((_14_pendingBreaks) === (0)) {
                                        _28_breakCount = 1;
                                    }
                                    else {
                                        _28_breakCount = (_14_pendingBreaks) + (1);
                                    }
                                    _11_result = Native.__default.concat(_11_result, Native.__default.repeat("\n", _28_breakCount));
                                    _11_result = _11_result + _23_text;
                                }
                                else {
                                    _11_result = Native.__default.concat(_11_result, Native.__default.repeat("\n", _14_pendingBreaks));
                                    _11_result = _11_result + _23_text;
                                }
                            }
                            _12_sawContent = true;
                            _13_prevMoreIndented = _24_moreIndented;
                            _14_pendingBreaks = 0;
                        }
                        if ((_20_nl) === (-1)) {
                            (_this).pos = _this.len;
                        }
                        else {
                            (_this).pos = (_20_nl) + (1);
                        }
                        (_this).lineStart = _this.pos;
                    }
                }
            }
            (_this).m1y();
            if (!(_12_sawContent)) {
                if ((_2_chomp) === (1)) {
                    value = Native.__default.repeat("\n", _14_pendingBreaks);
                }
                else {
                    value = "";
                }
                return value;
            }
            if ((_2_chomp) === (-1)) {
                value = _11_result;
                return value;
            }
            if ((_2_chomp) === (1)) {
                value = Native.__default.concat(_11_result, Native.__default.repeat("\n", (_14_pendingBreaks) + (1)));
                return value;
            }
            value = _11_result + "\n";
            return value;
        }
        m20() {
            let _this = this;
            L24: {
                while ((_this.pos) < (_this.len)) {
                    C24: {
                        while (((_this.pos) < (_this.len)) && (((_this.src.charCodeAt(_this.pos)) === (32)) || ((_this.src.charCodeAt(_this.pos)) === (9)))) {
                            (_this).pos = (_this.pos) + (1);
                        }
                        if ((_this.pos) >= (_this.len)) {
                            return;
                        }
                        let _0_c;
                        _0_c = _this.src.charCodeAt(_this.pos);
                        if ((_0_c) === (10)) {
                            (_this).pos = (_this.pos) + (1);
                            (_this).lineStart = _this.pos;
                            break C24;
                        }
                        if ((_0_c) === (13)) {
                            (_this).pos = (_this.pos) + (1);
                            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (10))) {
                                (_this).pos = (_this.pos) + (1);
                            }
                            (_this).lineStart = _this.pos;
                            break C24;
                        }
                        if ((_0_c) === (35)) {
                            while ((((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) !== (10))) && ((_this.src.charCodeAt(_this.pos)) !== (13))) {
                                (_this).pos = (_this.pos) + (1);
                            }
                            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (13))) {
                                (_this).pos = (_this.pos) + (1);
                            }
                            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (10))) {
                                (_this).pos = (_this.pos) + (1);
                            }
                            (_this).lineStart = _this.pos;
                            break C24;
                        }
                        return;
                    }
                }
            }
            return;
        }
        m21() {
            let _this = this;
            (_this).mf();
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (35))) {
                if ((_this.pos) > (_this.lineStart)) {
                    let _0_prev;
                    _0_prev = _this.src.charCodeAt((_this.pos) - (1));
                    if (((_0_prev) !== (32)) && ((_0_prev) !== (9))) {
                        (_this).mg("a comment must be separated from other tokens by whitespace");
                    }
                }
                while ((((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) !== (10))) && ((_this.src.charCodeAt(_this.pos)) !== (13))) {
                    (_this).pos = (_this.pos) + (1);
                }
            }
            if ((_this.pos) >= (_this.len)) {
                return;
            }
            if ((_this.src.charCodeAt(_this.pos)) === (13)) {
                (_this).pos = (_this.pos) + (1);
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (10))) {
                    (_this).pos = (_this.pos) + (1);
                }
                (_this).lineStart = _this.pos;
                return;
            }
            if ((_this.src.charCodeAt(_this.pos)) === (10)) {
                (_this).pos = (_this.pos) + (1);
                (_this).lineStart = _this.pos;
                return;
            }
            (_this).mg("unexpected content at end of line");
            return;
        }
        m22() {
            let _this = this;
            (_this).m21();
            (_this).m20();
            return;
        }
        m23() {
            let _this = this;
            let _0_nl = 0;
            _0_nl = Native.__default.indexOf(_this.src, "\n", _this.pos);
            if ((_0_nl) < (0)) {
                (_this).pos = _this.len;
            }
            else {
                (_this).pos = (_0_nl) + (1);
            }
            (_this).lineStart = _this.pos;
            return;
        }
        m24() {
            let _this = this;
            let token = "";
            let _0_start;
            _0_start = _this.pos;
            L25: {
                while ((_this.pos) < (_this.len)) {
                    C25: {
                        let _1_c;
                        _1_c = _this.src.charCodeAt(_this.pos);
                        let _2_space = false;
                        let _out0;
                        _2_space =
                            (_this).m1n(_1_c);
                        if (_2_space) {
                            break L25;
                        }
                        (_this).pos = (_this.pos) + (1);
                    }
                }
            }
            token = Native.__default.slice(_this.src, _0_start, _this.pos);
            return token;
        }
        m25(s) {
            let _this = this;
            let yes = false;
            yes = false;
            let _0_n;
            _0_n = s.length;
            let _1_i;
            _1_i = 0;
            let _2_digits;
            _2_digits = 0;
            while (((_1_i) < (_0_n)) && ((_this).m1(s.charCodeAt(_1_i)))) {
                _1_i = (_1_i) + (1);
                _2_digits = (_2_digits) + (1);
            }
            if ((((_2_digits) === (0)) || ((_1_i) >= (_0_n))) || ((s.charCodeAt(_1_i)) !== (46))) {
                return yes;
            }
            _1_i = (_1_i) + (1);
            _2_digits = 0;
            while (((_1_i) < (_0_n)) && ((_this).m1(s.charCodeAt(_1_i)))) {
                _1_i = (_1_i) + (1);
                _2_digits = (_2_digits) + (1);
            }
            yes = ((_2_digits) > (0)) && ((_1_i) === (_0_n));
            return yes;
        }
        m26() {
            let _this = this;
            (_this).mf();
            let _0_token = "";
            let _out0;
            _0_token =
                (_this).m24();
            let _1_validVersion = false;
            let _out1;
            _1_validVersion =
                (_this).m25(_0_token);
            if (!(_1_validVersion)) {
                (_this).mg("malformed %YAML directive: expected a MAJOR.MINOR version");
            }
            let _2_dot = 0;
            _2_dot = Native.__default.indexOf(_0_token, ".", 0);
            let _3_majorText;
            _3_majorText = _0_token.slice(0, _2_dot);
            let _4_major;
            _4_major = Native.__default.parseNumber(_3_majorText);
            if ((_4_major) !== (1)) {
                (_this).mg(Native.__default.concat("unsupported YAML major version: ", Native.__default._$$_toString(_4_major)));
            }
            (_this).mf();
            if ((_this.pos) < (_this.len)) {
                let _5_c;
                _5_c = _this.src.charCodeAt(_this.pos);
                if ((((_5_c) !== (10)) && ((_5_c) !== (13))) && ((_5_c) !== (35))) {
                    (_this).mg("%YAML directive should contain exactly one part");
                }
            }
            return;
        }
        m27() {
            let _this = this;
            (_this).mf();
            let _0_handle = "";
            let _out0;
            _0_handle =
                (_this).m24();
            (_this).mf();
            let _1_prefix = "";
            let _out1;
            _1_prefix =
                (_this).m24();
            if (((_0_handle === "") || ((_0_handle.charCodeAt(0)) !== (33))) || (_1_prefix === "")) {
                (_this).mg("malformed %TAG directive: expected a handle and a prefix");
            }
            if (!(_this._fe)) {
                let _2_newTags;
                let _out2;
                _2_newTags =
                    Native.__default.mapCreate();
                (_this)._ft = _2_newTags;
                (_this)._fe = true;
            }
            let _3_key;
            _3_key = _0_handle;
            let _4_tags;
            _4_tags = _this._ft;
            let _5_duplicate = false;
            let _out3;
            _5_duplicate = _4_tags.has(_3_key);
            if (_5_duplicate) {
                (_this).mg(Native.__default.concat("duplicate %TAG directive for handle '", _0_handle + "'"));
            }
            _4_tags.set(_3_key, _1_prefix);
            return;
        }
        m28() {
            let _this = this;
            let sawAny = false;
            (_this)._ft = Native.__default.undefinedValue;
            (_this)._fe = false;
            (_this)._f1 = Native.__default.undefinedValue;
            (_this)._fa = false;
            let _0_sawYaml;
            _0_sawYaml = false;
            sawAny = false;
            while ((((_this.pos) < (_this.len)) && ((_this.pos) === (_this.lineStart))) && ((_this.src.charCodeAt(_this.pos)) === (37))) {
                sawAny = true;
                (_this).pos = (_this.pos) + (1);
                let _1_name;
                let _out0;
                _1_name =
                    (_this).m24();
                if (_1_name === "YAML") {
                    if (_0_sawYaml) {
                        (_this).mg("a document must not contain more than one %YAML directive");
                    }
                    _0_sawYaml = true;
                    (_this).m26();
                }
                else if (_1_name === "TAG") {
                    (_this).m27();
                }
                (_this).m23();
                (_this).m20();
            }
            return sawAny;
        }
        m29(i) {
            let _this = this;
            let yes = false;
            if ((i) === (_this.len)) {
                yes = true;
                return yes;
            }
            let _0_c;
            _0_c = _this.src.charCodeAt(i);
            yes = ((((_0_c) === (32)) || ((_0_c) === (9))) || ((_0_c) === (10))) || ((_0_c) === (13));
            return yes;
        }
        m2a() {
            let _this = this;
            let end = 0;
            let _0_start;
            _0_start = _this.pos;
            let _1_p;
            _1_p = _this.pos;
            (_this)._fp = false;
            (_this)._fq = false;
            L26: {
                while ((_1_p) < (_this.len)) {
                    C26: {
                        let _2_c;
                        _2_c = _this.src.charCodeAt(_1_p);
                        if (((_2_c) === (10)) || ((_2_c) === (13))) {
                            break L26;
                        }
                        if ((_2_c) === (58)) {
                            if (((_1_p) + (1)) === (_this.len)) {
                                (_this)._fp = true;
                                break L26;
                            }
                            let _3_next;
                            _3_next = _this.src.charCodeAt((_1_p) + (1));
                            if (((((_3_next) === (32)) || ((_3_next) === (9))) || ((_3_next) === (10))) || ((_3_next) === (13))) {
                                (_this)._fp = true;
                                break L26;
                            }
                        }
                        else if (((_2_c) === (35)) && ((_1_p) > (_0_start))) {
                            let _4_prev;
                            _4_prev = _this.src.charCodeAt((_1_p) - (1));
                            if (((_4_prev) === (32)) || ((_4_prev) === (9))) {
                                (_this)._fq = true;
                                break L26;
                            }
                        }
                        _1_p = (_1_p) + (1);
                    }
                }
            }
            (_this).pos = _1_p;
            end = _1_p;
            while (((end) > (_0_start)) && (((_this.src.charCodeAt((end) - (1))) === (32)) || ((_this.src.charCodeAt((end) - (1))) === (9)))) {
                end = (end) - (1);
            }
            return end;
        }
        m2b() {
            let _this = this;
            let breaks = 0;
            (_this)._fq = false;
            (_this).mf();
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (35))) {
                (_this)._fq = true;
                let _0_commentEnd = 0;
                _0_commentEnd = Native.__default.indexOf(_this.src, "\n", _this.pos);
                if ((_0_commentEnd) < (0)) {
                    (_this).pos = _this.len;
                }
                else {
                    (_this).pos = _0_commentEnd;
                }
            }
            breaks = 0;
            L27: {
                while (true) {
                    C27: {
                        if ((_this.pos) >= (_this.len)) {
                            return breaks;
                        }
                        let _1_c;
                        _1_c = _this.src.charCodeAt(_this.pos);
                        if ((_1_c) === (10)) {
                            (_this).pos = (_this.pos) + (1);
                            (_this).lineStart = _this.pos;
                            breaks = (breaks) + (1);
                            break C27;
                        }
                        if ((_1_c) === (13)) {
                            (_this).pos = (_this.pos) + (1);
                            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (10))) {
                                (_this).pos = (_this.pos) + (1);
                            }
                            (_this).lineStart = _this.pos;
                            breaks = (breaks) + (1);
                            break C27;
                        }
                        let _2_p;
                        _2_p = _this.pos;
                        while (((_2_p) < (_this.len)) && (((_this.src.charCodeAt(_2_p)) === (32)) || ((_this.src.charCodeAt(_2_p)) === (9)))) {
                            _2_p = (_2_p) + (1);
                        }
                        if ((_2_p) >= (_this.len)) {
                            (_this).pos = _2_p;
                            return breaks;
                        }
                        let _3_next;
                        _3_next = _this.src.charCodeAt(_2_p);
                        if (((_3_next) === (10)) || ((_3_next) === (13))) {
                            (_this).pos = _2_p;
                            break C27;
                        }
                        if ((_3_next) === (35)) {
                            (_this)._fq = true;
                            let _4_nl = 0;
                            _4_nl = Native.__default.indexOf(_this.src, "\n", _2_p);
                            if ((_4_nl) < (0)) {
                                (_this).pos = _this.len;
                            }
                            else {
                                (_this).pos = (_4_nl) + (1);
                                (_this).lineStart = _this.pos;
                            }
                            break C27;
                        }
                        (_this).pos = _2_p;
                        return breaks;
                    }
                }
            }
            return breaks;
        }
        m2c(start, end, parentCol) {
            let _this = this;
            let value = undefined;
            let _0_breaks = 0;
            let _out0;
            _0_breaks =
                (_this).m2b();
            let _1_marker;
            _1_marker = false;
            if (((_this.pos) < (_this.len)) && ((_this.pos) === (_this.lineStart))) {
                let _out1;
                _1_marker =
                    (_this).IsDocMarkerAt(_this.pos);
            }
            if ((((_this._fq) || ((_this.pos) >= (_this.len))) || (((_this.pos) - (_this.lineStart)) <= (parentCol))) || (_1_marker)) {
                let _out2;
                value =
                    (_this).md(start, end);
                return value;
            }
            let _2_result;
            _2_result = Native.__default.slice(_this.src, start, end);
            L28: {
                while (true) {
                    C28: {
                        if ((_0_breaks) > (1)) {
                            _2_result = Native.__default.concat(_2_result, Native.__default.repeat("\n", (_0_breaks) - (1)));
                        }
                        else {
                            _2_result = _2_result + " ";
                        }
                        let _3_segmentStart;
                        _3_segmentStart = _this.pos;
                        let _4_segmentEnd = 0;
                        let _out3;
                        _4_segmentEnd =
                            (_this).m2a();
                        _2_result = Native.__default.concat(_2_result, Native.__default.slice(_this.src, _3_segmentStart, _4_segmentEnd));
                        if (_this._fp) {
                            (_this).mg("mapping value not allowed in a multi-line plain scalar");
                        }
                        let _out4;
                        _0_breaks =
                            (_this).m2b();
                        _1_marker = false;
                        if (((_this.pos) < (_this.len)) && ((_this.pos) === (_this.lineStart))) {
                            let _out5;
                            _1_marker =
                                (_this).IsDocMarkerAt(_this.pos);
                        }
                        if ((((_this._fq) || ((_this.pos) >= (_this.len))) || (((_this.pos) - (_this.lineStart)) <= (parentCol))) || (_1_marker)) {
                            break L28;
                        }
                    }
                }
            }
            value = _2_result;
            return value;
        }
        m2d(start, end, parentCol) {
            let _this = this;
            let text = "";
            let _0_breaks = 0;
            let _out0;
            _0_breaks =
                (_this).m2b();
            let _1_marker;
            _1_marker = false;
            if (((_this.pos) < (_this.len)) && ((_this.pos) === (_this.lineStart))) {
                let _out1;
                _1_marker =
                    (_this).IsDocMarkerAt(_this.pos);
            }
            if ((((_this._fq) || ((_this.pos) >= (_this.len))) || (((_this.pos) - (_this.lineStart)) <= (parentCol))) || (_1_marker)) {
                text = Native.__default.slice(_this.src, start, end);
                return text;
            }
            text = Native.__default.slice(_this.src, start, end);
            L29: {
                while (true) {
                    C29: {
                        if ((_0_breaks) > (1)) {
                            text = Native.__default.concat(text, Native.__default.repeat("\n", (_0_breaks) - (1)));
                        }
                        else {
                            text = text + " ";
                        }
                        let _2_segmentStart;
                        _2_segmentStart = _this.pos;
                        let _3_segmentEnd = 0;
                        let _out2;
                        _3_segmentEnd =
                            (_this).m2a();
                        text = Native.__default.concat(text, Native.__default.slice(_this.src, _2_segmentStart, _3_segmentEnd));
                        if (_this._fp) {
                            (_this).mg("mapping value not allowed in a multi-line plain scalar");
                        }
                        let _out3;
                        _0_breaks =
                            (_this).m2b();
                        _1_marker = false;
                        if (((_this.pos) < (_this.len)) && ((_this.pos) === (_this.lineStart))) {
                            let _out4;
                            _1_marker =
                                (_this).IsDocMarkerAt(_this.pos);
                        }
                        if ((((_this._fq) || ((_this.pos) >= (_this.len))) || (((_this.pos) - (_this.lineStart)) <= (parentCol))) || (_1_marker)) {
                            break L29;
                        }
                    }
                }
            }
            return text;
        }
        m2e(parentCol, isMapValue) {
            let _this = this;
            let value = undefined;
            (_this).m20();
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
                _3_firstChar = _this.src.charCodeAt(_this.pos);
                if ((parentCol) >= (0)) {
                    (_this).m2h(parentCol);
                }
                let _out0;
                value =
                    (_this).m2k(parentCol, isMapValue);
                if (_this._fs) {
                    (_this).m2i(_1_wsStart, _2_contentPos, _3_firstChar, value, parentCol);
                }
                return value;
            }
            if (((isMapValue) && ((_0_nextCol) === (parentCol))) && ((_this.src.charCodeAt(_this.pos)) === (45))) {
                let _4_separator = false;
                let _out1;
                _4_separator =
                    (_this).m29((_this.pos) + (1));
                if (_4_separator) {
                    let _out2;
                    value =
                        (_this).m2n(_0_nextCol);
                    return value;
                }
            }
            value = Native.__default.nullValue;
            return value;
        }
        m2f(value) {
            let _this = this;
            let yes = false;
            yes = false;
            if (Array.isArray(value)) {
                yes = true;
                return yes;
            }
            if ((((typeof value === "object" && value !== null) && (!(Native.__default.isUint8Array(value)))) && (!(Native.__default.isMap(value)))) && (!(Native.__default.isSet(value)))) {
                yes = true;
            }
            return yes;
        }
        m2g(value) {
            let _this = this;
            let yes = false;
            yes = ((((typeof value === "object" && value !== null) && (!(Array.isArray(value)))) && (!(Native.__default.isUint8Array(value)))) && (!(Native.__default.isMap(value)))) && (!(Native.__default.isSet(value)));
            return yes;
        }
        m2h(parentCol) {
            let _this = this;
            if ((parentCol) < (0)) {
                return;
            }
            let _0_i;
            _0_i = _this.lineStart;
            let _1_limit;
            _1_limit = ((_this.lineStart) + (parentCol)) + (1);
            while (((_0_i) < (_1_limit)) && ((_0_i) < (_this.pos))) {
                if ((_this.src.charCodeAt(_0_i)) === (9)) {
                    (_this).pos = _0_i;
                    (_this).mg("a tab character cannot be used as indentation");
                }
                _0_i = (_0_i) + (1);
            }
            return;
        }
        m2i(wsStart, contentPos, firstChar, value, parentCol) {
            let _this = this;
            let _0_restricted = false;
            let _out0;
            _0_restricted =
                (_this).m2f(value);
            if (!(_0_restricted)) {
                return;
            }
            if ((((((firstChar) === (91)) || ((firstChar) === (123))) || ((firstChar) === (34))) || ((firstChar) === (39))) || ((firstChar) === (42))) {
                return;
            }
            let _1_i;
            if ((parentCol) >= (0)) {
                _1_i = ((wsStart) + (parentCol)) + (1);
            }
            else {
                _1_i = wsStart;
            }
            while ((_1_i) < (contentPos)) {
                if ((_this.src.charCodeAt(_1_i)) === (9)) {
                    (_this).pos = _1_i;
                    (_this).mg("a tab character cannot be used as indentation");
                }
                _1_i = (_1_i) + (1);
            }
            return;
        }
        m2j(parentCol) {
            let _this = this;
            let value = undefined;
            let _0_wsStart;
            _0_wsStart = _this.lineStart;
            let _1_contentPos;
            _1_contentPos = _this.pos;
            let _2_firstChar;
            _2_firstChar = _this.src.charCodeAt(_this.pos);
            let _out0;
            value =
                (_this).m2k(parentCol, false);
            if ((_this._fs) && ((parentCol) !== (-2))) {
                (_this).m2i(_0_wsStart, _1_contentPos, _2_firstChar, value, parentCol);
            }
            return value;
        }
        m2k(parentCol, isMapValue) {
            let _this = this;
            let value = undefined;
            let _0_inlineProperty;
            _0_inlineProperty = _this._f0;
            (_this)._f0 = false;
            let _1_noBlockCollection;
            _1_noBlockCollection = _this._fg;
            (_this)._fg = false;
            let _2_col;
            if ((_this._f3) >= (0)) {
                _2_col = _this._f3;
            }
            else {
                _2_col = (_this.pos) - (_this.lineStart);
            }
            (_this)._f3 = -1;
            let _3_c;
            _3_c = _this.src.charCodeAt(_this.pos);
            if ((_3_c) === (38)) {
                let _4_anchorCol;
                _4_anchorCol = _2_col;
                (_this).pos = (_this.pos) + (1);
                let _5_name = "";
                let _out0;
                _5_name =
                    (_this).m13();
                let _6_savedPending;
                _6_savedPending = _this._fo;
                let _7_hadSavedPending;
                _7_hadSavedPending = _this._fd;
                (_this)._fo = _5_name;
                (_this)._fd = true;
                (_this).mf();
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (42))) {
                    (_this).mg("an alias node cannot carry an anchor property");
                }
                if (((((_this.pos) >= (_this.len)) || ((_this.src.charCodeAt(_this.pos)) === (10))) || ((_this.src.charCodeAt(_this.pos)) === (13))) || ((_this.src.charCodeAt(_this.pos)) === (35))) {
                    let _8_innerAnchor;
                    _8_innerAnchor = (_this.pos) < (_this.len);
                    (_this).m22();
                    _8_innerAnchor = ((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (38));
                    let _9_effectiveParentCol;
                    if ((parentCol) === (-2)) {
                        _9_effectiveParentCol = -1;
                    }
                    else {
                        _9_effectiveParentCol = parentCol;
                    }
                    let _out1;
                    value =
                        (_this).m2e(_9_effectiveParentCol, isMapValue);
                    let _10_plainMapping = false;
                    let _out2;
                    _10_plainMapping =
                        (_this).m2g(value);
                    if ((((_8_innerAnchor) && (_this._fd)) && (Native.__default.jsEqual(_this._fo, _5_name))) && (!(_10_plainMapping))) {
                        (_this).mg("a node can have at most one anchor");
                    }
                }
                else {
                    (_this)._f0 = true;
                    (_this)._f3 = _4_anchorCol;
                    let _out3;
                    value =
                        (_this).m2k(parentCol, isMapValue);
                }
                if ((_this._fd) && (Native.__default.jsEqual(_this._fo, _5_name))) {
                    (_this).m14(value);
                }
                (_this)._fo = _6_savedPending;
                (_this)._fd = _7_hadSavedPending;
                return value;
            }
            if ((((((_3_c) === (42)) || ((_3_c) === (91))) || ((_3_c) === (123))) || ((_3_c) === (34))) || ((_3_c) === (39))) {
                (_this)._f7 = false;
                let _11_savedFloor;
                _11_savedFloor = _this._f6;
                if (((((_3_c) === (91)) || ((_3_c) === (123))) || ((_3_c) === (34))) || ((_3_c) === (39))) {
                    (_this)._f6 = parentCol;
                }
                let _12_node = undefined;
                if ((_3_c) === (34)) {
                    (_this)._fr = false;
                    let _out4;
                    _12_node =
                        (_this).m1r();
                }
                else if ((_3_c) === (39)) {
                    (_this)._fr = false;
                    let _out5;
                    _12_node =
                        (_this).m1v();
                }
                else if ((_3_c) === (42)) {
                    let _out6;
                    _12_node =
                        (_this).m15();
                }
                else {
                    let _out7;
                    _12_node =
                        (_this).my();
                }
                (_this)._f6 = _11_savedFloor;
                let _13_afterNode;
                _13_afterNode = _this.pos;
                (_this).mf();
                let _14_keySeparator;
                _14_keySeparator = false;
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (58))) {
                    let _out8;
                    _14_keySeparator =
                        (_this).m29((_this.pos) + (1));
                }
                if (_14_keySeparator) {
                    if ((parentCol) === (-2)) {
                        (_this).mg("a block mapping cannot start on the same line as a '---' document start");
                    }
                    if (_1_noBlockCollection) {
                        (_this).mg("a nested block mapping cannot start on the same line as a mapping key");
                    }
                    if ((((_3_c) === (34)) || ((_3_c) === (39))) && (_this._fr)) {
                        (_this).mg("a multi-line quoted scalar cannot be a block mapping key");
                    }
                    if ((((_3_c) === (91)) || ((_3_c) === (123))) && (_this._f7)) {
                        (_this).mg("a multi-line flow collection cannot be a block mapping key");
                    }
                    if (_0_inlineProperty) {
                        (_this).m14(_12_node);
                    }
                    let _15_key;
                    let _out9;
                    _15_key =
                        (_this).ms(_12_node);
                    let _out10;
                    value =
                        (_this).m2w(_2_col, _15_key, true, false);
                    return value;
                }
                (_this).pos = _13_afterNode;
                (_this).m22();
                value = _12_node;
                (_this).m14(value);
                return value;
            }
            if (((_3_c) === (124)) || ((_3_c) === (62))) {
                let _out11;
                value =
                    (_this).m1z(parentCol);
                (_this).m14(value);
                return value;
            }
            let _16_separator = false;
            let _out12;
            _16_separator =
                (_this).m29((_this.pos) + (1));
            if (((_3_c) === (45)) && (_16_separator)) {
                if ((parentCol) === (-2)) {
                    (_this).mg("a block sequence cannot start on the same line as a '---' document start");
                }
                if (_0_inlineProperty) {
                    (_this).mg("a block sequence cannot start on the same line as a node property (anchor)");
                }
                if (_1_noBlockCollection) {
                    (_this).mg("a block sequence cannot start on the same line as a mapping key");
                }
                let _out13;
                value =
                    (_this).m2n(_2_col);
                return value;
            }
            if (((_3_c) === (63)) && (_16_separator)) {
                if ((parentCol) === (-2)) {
                    (_this).mg("a block mapping cannot start on the same line as a '---' document start");
                }
                if (_0_inlineProperty) {
                    (_this).mg("a block mapping cannot start on the same line as a node property (anchor)");
                }
                if (_1_noBlockCollection) {
                    (_this).mg("a nested block mapping cannot start on the same line as a mapping key");
                }
                let _out14;
                value =
                    (_this).m2u(_2_col);
                return value;
            }
            if ((_3_c) === (33)) {
                let _out15;
                value =
                    (_this).m2m(parentCol, _2_col, isMapValue);
                return value;
            }
            if ((((_3_c) === (37)) || ((_3_c) === (64))) || ((_3_c) === (96))) {
                (_this).mg("a plain scalar cannot start with a reserved indicator ('%', '@', or '`')");
            }
            let _17_start;
            _17_start = _this.pos;
            let _18_end = 0;
            let _out16;
            _18_end =
                (_this).m2a();
            if (_this._fp) {
                if ((parentCol) === (-2)) {
                    (_this).mg("a block mapping cannot start on the same line as a '---' document start");
                }
                if (_1_noBlockCollection) {
                    (_this).mg("a nested block mapping cannot start on the same line as a mapping key");
                }
                let _19_keyNode;
                let _out17;
                _19_keyNode =
                    (_this).md(_17_start, _18_end);
                if (_0_inlineProperty) {
                    (_this).m14(_19_keyNode);
                }
                let _20_key;
                let _out18;
                _20_key =
                    (_this).ms(_19_keyNode);
                let _out19;
                value =
                    (_this).m2w(_2_col, _20_key, true, false);
                return value;
            }
            let _out20;
            value =
                (_this).m2c(_17_start, _18_end, parentCol);
            (_this).m14(value);
            return value;
        }
        m2l(tag, value, kind) {
            let _this = this;
            let result = undefined;
            if ((tag === "!") || (tag === "tag:yaml.org,2002:")) {
                result = value;
                return result;
            }
            if ((tag === "tag:yaml.org,2002:map") && (kind === "map")) {
                result = value;
                return result;
            }
            if ((tag === "tag:yaml.org,2002:seq") && (kind === "seq")) {
                result = value;
                return result;
            }
            if (tag === "tag:yaml.org,2002:set") {
                if (!(kind === "map")) {
                    (_this).mg("the !!set tag requires a mapping node");
                }
                let _out0;
                result =
                    (_this._fu).BuildSet(value);
                let _0_setError = "";
                let _out1;
                _0_setError =
                    (_this._fu).ErrorMessage();
                if (!(_0_setError === "")) {
                    (_this).mg(_0_setError);
                }
                return result;
            }
            if (tag === "tag:yaml.org,2002:omap") {
                if (!(kind === "seq")) {
                    (_this).mg("the !!omap tag requires a sequence node");
                }
                let _out2;
                result =
                    (_this._fu).BuildOmap(value);
                let _1_omapError = "";
                let _out3;
                _1_omapError =
                    (_this._fu).ErrorMessage();
                if (!(_1_omapError === "")) {
                    (_this).mg(_1_omapError);
                }
                return result;
            }
            if (tag === "tag:yaml.org,2002:pairs") {
                if (!(kind === "seq")) {
                    (_this).mg("the !!pairs tag requires a sequence node");
                }
                (_this._fu).ValidatePairs(value);
                let _2_pairsError = "";
                let _out4;
                _2_pairsError =
                    (_this._fu).ErrorMessage();
                if (!(_2_pairsError === "")) {
                    (_this).mg(_2_pairsError);
                }
                result = value;
                return result;
            }
            if (tag === "tag:yaml.org,2002:map") {
                (_this).mg("the !!map tag requires a mapping node");
            }
            if (tag === "tag:yaml.org,2002:seq") {
                (_this).mg("the !!seq tag requires a sequence node");
            }
            if ((((((tag === "tag:yaml.org,2002:int") || (tag === "tag:yaml.org,2002:float")) || (tag === "tag:yaml.org,2002:bool")) || (tag === "tag:yaml.org,2002:null")) || (tag === "tag:yaml.org,2002:binary")) || (tag === "tag:yaml.org,2002:str")) {
                let _3_tagName;
                _3_tagName = Native.__default.slice(tag, 18, tag.length);
                let _4_kindName;
                if (kind === "map") {
                    _4_kindName = "mapping";
                }
                else {
                    _4_kindName = "sequence";
                }
                (_this).mg(Native.__default.concat("the !!", Native.__default.concat(_3_tagName, " tag requires a scalar node, not a " + _4_kindName)));
            }
            result = value;
            return result;
        }
        m2m(parentCol, col, isMapValue) {
            let _this = this;
            let value = undefined;
            let _0_savedPending;
            _0_savedPending = _this._fo;
            let _1_hadSavedPending;
            _1_hadSavedPending = _this._fd;
            let _2_tag = "";
            let _out0;
            _2_tag =
                (_this).m1b();
            (_this).m1c(false);
            (_this).mf();
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (33))) {
                (_this).mg("a node may carry at most one tag");
            }
            let _3_hasAnchor;
            _3_hasAnchor = false;
            let _4_anchorName;
            _4_anchorName = "";
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (38))) {
                (_this).pos = (_this.pos) + (1);
                let _out1;
                _4_anchorName =
                    (_this).m13();
                _3_hasAnchor = true;
                (_this)._fo = _4_anchorName;
                (_this)._fd = true;
                (_this).mf();
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (38))) {
                    (_this).mg("a node may carry at most one anchor");
                }
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (33))) {
                    (_this).mg("a node may carry at most one tag");
                }
            }
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (42))) {
                (_this).mg("an alias node cannot carry a tag/anchor property");
            }
            let _5_taggedDash;
            _5_taggedDash = false;
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (45))) {
                let _out2;
                _5_taggedDash =
                    (_this).m29((_this.pos) + (1));
            }
            let _6_taggedQuestion;
            _6_taggedQuestion = false;
            if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (63))) {
                let _out3;
                _6_taggedQuestion =
                    (_this).m29((_this.pos) + (1));
            }
            if (((((_this.pos) >= (_this.len)) || ((_this.src.charCodeAt(_this.pos)) === (10))) || ((_this.src.charCodeAt(_this.pos)) === (13))) || ((_this.src.charCodeAt(_this.pos)) === (35))) {
                (_this).m22();
                let _7_compactSequence;
                _7_compactSequence = false;
                if (((((_this.pos) < (_this.len)) && (isMapValue)) && (((_this.pos) - (_this.lineStart)) === (parentCol))) && ((_this.src.charCodeAt(_this.pos)) === (45))) {
                    let _out4;
                    _7_compactSequence =
                        (_this).m29((_this.pos) + (1));
                }
                if (((_this.pos) >= (_this.len)) || ((((_this.pos) - (_this.lineStart)) <= (parentCol)) && (!(_7_compactSequence)))) {
                    let _out5;
                    value =
                        (_this).m1d(_2_tag, "");
                }
                else {
                    let _8_effectiveParentCol;
                    if ((parentCol) === (-2)) {
                        _8_effectiveParentCol = -1;
                    }
                    else {
                        _8_effectiveParentCol = parentCol;
                    }
                    let _9_child;
                    let _out6;
                    _9_child =
                        (_this).m2k(_8_effectiveParentCol, isMapValue);
                    if (Array.isArray(_9_child)) {
                        let _out7;
                        value =
                            (_this).m2l(_2_tag, _9_child, "seq");
                    }
                    else if (typeof _9_child === "object" && _9_child !== null) {
                        let _out8;
                        value =
                            (_this).m2l(_2_tag, _9_child, "map");
                    }
                    else if (typeof _9_child === "string") {
                        let _out9;
                        value =
                            (_this).m1d(_2_tag, _9_child);
                    }
                    else if ((((_2_tag === "!") || (_2_tag === "tag:yaml.org,2002:")) || (_2_tag === "tag:yaml.org,2002:map")) || (_2_tag === "tag:yaml.org,2002:seq")) {
                        value = _9_child;
                    }
                    else {
                        (_this).mg("a tag cannot apply to an already-resolved nested scalar");
                    }
                }
            }
            else if (_5_taggedDash) {
                if ((parentCol) === (-2)) {
                    (_this).mg("a block sequence cannot start on the same line as a '---' document start");
                }
                (_this).mg("a block sequence cannot start on the same line as a node property (tag)");
            }
            else if (_6_taggedQuestion) {
                if ((parentCol) === (-2)) {
                    (_this).mg("a block mapping cannot start on the same line as a '---' document start");
                }
                (_this).mg("a block mapping cannot start on the same line as a node property (tag)");
            }
            else if (((_this.src.charCodeAt(_this.pos)) === (124)) || ((_this.src.charCodeAt(_this.pos)) === (62))) {
                let _10_scalar;
                let _out10;
                _10_scalar =
                    (_this).m1z(parentCol);
                let _out11;
                value =
                    (_this).m1d(_2_tag, _10_scalar);
            }
            else if ((_this.src.charCodeAt(_this.pos)) === (45)) {
                let _11_dashSeparator = false;
                let _out12;
                _11_dashSeparator =
                    (_this).m29((_this.pos) + (1));
                if (!(_11_dashSeparator)) {
                    let _12_start;
                    _12_start = _this.pos;
                    let _13_end = 0;
                    let _out13;
                    _13_end =
                        (_this).m2a();
                    let _14_raw;
                    let _out14;
                    _14_raw =
                        (_this).m2d(_12_start, _13_end, parentCol);
                    let _out15;
                    value =
                        (_this).m1d(_2_tag, _14_raw);
                    return value;
                }
                let _15_sequenceValue;
                let _out16;
                _15_sequenceValue =
                    (_this).m2n(col);
                let _out17;
                value =
                    (_this).m2l(_2_tag, _15_sequenceValue, "seq");
            }
            else if (((((_this.src.charCodeAt(_this.pos)) === (91)) || ((_this.src.charCodeAt(_this.pos)) === (123))) || ((_this.src.charCodeAt(_this.pos)) === (34))) || ((_this.src.charCodeAt(_this.pos)) === (39))) {
                let _16_c;
                _16_c = _this.src.charCodeAt(_this.pos);
                let _17_kind;
                if ((_16_c) === (91)) {
                    _17_kind = "seq";
                }
                else if ((_16_c) === (123)) {
                    _17_kind = "map";
                }
                else {
                    _17_kind = "scalar";
                }
                let _18_raw = undefined;
                if ((_16_c) === (91)) {
                    let _out18;
                    _18_raw =
                        (_this).m1j();
                }
                else if ((_16_c) === (123)) {
                    let _out19;
                    _18_raw =
                        (_this).m1k();
                }
                else if ((_16_c) === (34)) {
                    let _19_quoted;
                    let _out20;
                    _19_quoted =
                        (_this).m1r();
                    _18_raw = _19_quoted;
                }
                else {
                    let _20_quoted;
                    let _out21;
                    _20_quoted =
                        (_this).m1v();
                    _18_raw = _20_quoted;
                }
                (_this).mf();
                let _21_keySeparator;
                _21_keySeparator = false;
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (58))) {
                    let _out22;
                    _21_keySeparator =
                        (_this).m29((_this.pos) + (1));
                }
                if (_21_keySeparator) {
                    if ((parentCol) === (-2)) {
                        (_this).mg("a block mapping cannot start on the same line as a '---' document start");
                    }
                    let _22_keyNode = undefined;
                    if (_17_kind === "scalar") {
                        let _out23;
                        _22_keyNode =
                            (_this).m1d(_2_tag, _18_raw);
                    }
                    else {
                        let _out24;
                        _22_keyNode =
                            (_this).m2l(_2_tag, _18_raw, _17_kind);
                    }
                    (_this).m14(_22_keyNode);
                    let _23_key = "";
                    let _out25;
                    _23_key =
                        (_this).ms(_22_keyNode);
                    let _out26;
                    value =
                        (_this).m2w(col, _23_key, true, false);
                }
                else {
                    (_this).m22();
                    if (_17_kind === "scalar") {
                        let _out27;
                        value =
                            (_this).m1d(_2_tag, _18_raw);
                    }
                    else {
                        let _out28;
                        value =
                            (_this).m2l(_2_tag, _18_raw, _17_kind);
                    }
                }
            }
            else {
                let _24_start;
                _24_start = _this.pos;
                let _25_end = 0;
                let _out29;
                _25_end =
                    (_this).m2a();
                if (_this._fp) {
                    if ((parentCol) === (-2)) {
                        (_this).mg("a block mapping cannot start on the same line as a '---' document start");
                    }
                    let _26_keyNode;
                    let _out30;
                    _26_keyNode =
                        (_this).m1d(_2_tag, Native.__default.slice(_this.src, _24_start, _25_end));
                    (_this).m14(_26_keyNode);
                    let _27_keyText;
                    let _out31;
                    _27_keyText =
                        (_this).ms(_26_keyNode);
                    let _out32;
                    value =
                        (_this).m2w(col, _27_keyText, true, false);
                }
                else {
                    let _28_raw;
                    let _out33;
                    _28_raw =
                        (_this).m2d(_24_start, _25_end, parentCol);
                    let _out34;
                    value =
                        (_this).m1d(_2_tag, _28_raw);
                }
            }
            if (((_3_hasAnchor) && (_this._fd)) && (Native.__default.jsEqual(_this._fo, _4_anchorName))) {
                (_this).m14(value);
            }
            (_this)._fo = _0_savedPending;
            (_this)._fd = _1_hadSavedPending;
            return value;
        }
        m2n(col) {
            let _this = this;
            let result = undefined;
            (_this)._f4 = (_this._f4) + (1);
            if ((_this._f4) > (1000)) {
                (_this).mg("maximum nesting depth exceeded");
            }
            let _out0;
            result =
                (_this).m2o(col);
            (_this)._f4 = (_this._f4) - (1);
            return result;
        }
        m2o(col) {
            let _this = this;
            let result = undefined;
            let _out0;
            result =
                Native.__default.createArray();
            (_this).m14(result);
            while (true) {
                if (((_this.pos) >= (_this.len)) || ((_this.src.charCodeAt(_this.pos)) !== (45))) {
                    return result;
                }
                let _0_separator = false;
                let _out1;
                _0_separator =
                    (_this).m29((_this.pos) + (1));
                if (!(_0_separator)) {
                    return result;
                }
                (_this).pos = (_this.pos) + (1);
                let _1_sawTab;
                _1_sawTab = false;
                while (((_this.pos) < (_this.len)) && (((_this.src.charCodeAt(_this.pos)) === (32)) || ((_this.src.charCodeAt(_this.pos)) === (9)))) {
                    if ((_this.src.charCodeAt(_this.pos)) === (9)) {
                        _1_sawTab = true;
                    }
                    (_this).pos = (_this.pos) + (1);
                }
                let _2_inlineTab;
                _2_inlineTab = ((((_1_sawTab) && ((_this.pos) < (_this.len))) && ((_this.src.charCodeAt(_this.pos)) !== (10))) && ((_this.src.charCodeAt(_this.pos)) !== (13))) && ((_this.src.charCodeAt(_this.pos)) !== (35));
                if (((((_this.pos) >= (_this.len)) || ((_this.src.charCodeAt(_this.pos)) === (10))) || ((_this.src.charCodeAt(_this.pos)) === (13))) || ((_this.src.charCodeAt(_this.pos)) === (35))) {
                    (_this).m22();
                    if (((_this.pos) >= (_this.len)) || (((_this.pos) - (_this.lineStart)) <= (col))) {
                        Native.__default.arrayPush(result, Native.__default.nullValue);
                    }
                    else {
                        let _3_nested = undefined;
                        let _out2;
                        _3_nested =
                            (_this).m2e(col, false);
                        result.push(_3_nested);
                    }
                }
                else {
                    let _4_child = undefined;
                    let _out3;
                    _4_child =
                        (_this).m2k(col, false);
                    let _5_restricted = false;
                    let _out4;
                    _5_restricted =
                        (_this).m2f(_4_child);
                    if ((_2_inlineTab) && (_5_restricted)) {
                        (_this).mg("a tab cannot indent a block sequence entry that opens a new collection");
                    }
                    result.push(_4_child);
                }
                if (((_this.pos) >= (_this.len)) || (((_this.pos) - (_this.lineStart)) !== (col))) {
                    return result;
                }
                if ((_this.src.charCodeAt(_this.pos)) !== (45)) {
                    return result;
                }
                let _out5;
                _0_separator =
                    (_this).m29((_this.pos) + (1));
                if (!(_0_separator)) {
                    return result;
                }
                if (_this._fs) {
                    (_this).m2h((col) - (1));
                }
            }
            return result;
        }
        m2p(col) {
            let _this = this;
            let keyNode = undefined;
            let _0_p;
            _0_p = _this.pos;
            let _1_sawTab;
            _1_sawTab = false;
            while (((_0_p) < (_this.len)) && (((_this.src.charCodeAt(_0_p)) === (32)) || ((_this.src.charCodeAt(_0_p)) === (9)))) {
                if ((_this.src.charCodeAt(_0_p)) === (9)) {
                    _1_sawTab = true;
                }
                _0_p = (_0_p) + (1);
            }
            let _2_inlineContent;
            _2_inlineContent = ((((_0_p) < (_this.len)) && ((_this.src.charCodeAt(_0_p)) !== (10))) && ((_this.src.charCodeAt(_0_p)) !== (13))) && ((_this.src.charCodeAt(_0_p)) !== (35));
            let _out0;
            keyNode =
                (_this).m2q(col);
            if ((_1_sawTab) && (_2_inlineContent)) {
                let _3_restricted = false;
                let _out1;
                _3_restricted =
                    (_this).m2f(keyNode);
                if (_3_restricted) {
                    (_this).mg("a tab cannot separate '?' from a key that opens a new collection");
                }
            }
            return keyNode;
        }
        m2q(col) {
            let _this = this;
            let keyNode = undefined;
            (_this).mf();
            if (((((_this.pos) >= (_this.len)) || ((_this.src.charCodeAt(_this.pos)) === (10))) || ((_this.src.charCodeAt(_this.pos)) === (13))) || ((_this.src.charCodeAt(_this.pos)) === (35))) {
                (_this).m22();
                let _out0;
                keyNode =
                    (_this).m2e(col, true);
                return keyNode;
            }
            let _out1;
            keyNode =
                (_this).m2k(col, false);
            return keyNode;
        }
        m2r(col) {
            let _this = this;
            let value = undefined;
            let _0_p;
            _0_p = _this.pos;
            let _1_sawTab;
            _1_sawTab = false;
            while (((_0_p) < (_this.len)) && (((_this.src.charCodeAt(_0_p)) === (32)) || ((_this.src.charCodeAt(_0_p)) === (9)))) {
                if ((_this.src.charCodeAt(_0_p)) === (9)) {
                    _1_sawTab = true;
                }
                _0_p = (_0_p) + (1);
            }
            let _2_inlineContent;
            _2_inlineContent = ((((_0_p) < (_this.len)) && ((_this.src.charCodeAt(_0_p)) !== (10))) && ((_this.src.charCodeAt(_0_p)) !== (13))) && ((_this.src.charCodeAt(_0_p)) !== (35));
            let _out0;
            value =
                (_this).m2s(col);
            if ((_1_sawTab) && (_2_inlineContent)) {
                let _3_restricted = false;
                let _out1;
                _3_restricted =
                    (_this).m2f(value);
                if (_3_restricted) {
                    (_this).mg("a tab cannot separate ':' from a value that opens a new collection");
                }
            }
            return value;
        }
        m2s(col) {
            let _this = this;
            let value = undefined;
            (_this).mf();
            if (((((_this.pos) >= (_this.len)) || ((_this.src.charCodeAt(_this.pos)) === (10))) || ((_this.src.charCodeAt(_this.pos)) === (13))) || ((_this.src.charCodeAt(_this.pos)) === (35))) {
                (_this).m22();
                let _out0;
                value =
                    (_this).m2e(col, true);
                return value;
            }
            let _out1;
            value =
                (_this).m2k(col, false);
            return value;
        }
        m2t(col) {
            let _this = this;
            let hasValue = false;
            hasValue = false;
            if ((((_this.pos) < (_this.len)) && (((_this.pos) - (_this.lineStart)) === (col))) && ((_this.src.charCodeAt(_this.pos)) === (58))) {
                hasValue = true;
            }
            return hasValue;
        }
        m2u(col) {
            let _this = this;
            let result = undefined;
            let _out0;
            result =
                (_this).m2v(col);
            return result;
        }
        m2v(col) {
            let _this = this;
            let result = undefined;
            (_this).pos = (_this.pos) + (1);
            let _0_keyNode;
            let _out0;
            _0_keyNode =
                (_this).m2p(col);
            let _1_keyText = "";
            let _out1;
            _1_keyText =
                (_this).ms(_0_keyNode);
            let _2_key;
            let _out2;
            _2_key =
                (_this).mu(_1_keyText);
            let _3_hasValue;
            let _out3;
            _3_hasValue =
                (_this).m2t(col);
            let _out4;
            result =
                (_this).m2w(col, _2_key, _3_hasValue, true);
            return result;
        }
        m2w(col, firstKey, firstHasValue, firstIsExplicit) {
            let _this = this;
            let result = undefined;
            (_this)._f4 = (_this._f4) + (1);
            if ((_this._f4) > (1000)) {
                (_this).mg("maximum nesting depth exceeded");
            }
            let _out0;
            result =
                (_this).m31(col, firstKey, firstHasValue, firstIsExplicit);
            (_this)._f4 = (_this._f4) - (1);
            return result;
        }
        m2x() {
            let _this = this;
            let key = "";
            let _0_c;
            _0_c = _this.src.charCodeAt(_this.pos);
            if ((_0_c) === (38)) {
                let _out0;
                key =
                    (_this).m2y();
                return key;
            }
            if ((_0_c) === (33)) {
                let _out1;
                key =
                    (_this).m2z();
                return key;
            }
            if ((_0_c) === (42)) {
                let _1_node;
                let _out2;
                _1_node =
                    (_this).m15();
                let _2_sep;
                _2_sep = false;
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (58))) {
                    let _out3;
                    _2_sep =
                        (_this).m29((_this.pos) + (1));
                }
                if (!(_2_sep)) {
                    (_this).mg("expected ':' after mapping key");
                }
                let _out4;
                key =
                    (_this).mt(_1_node);
                return key;
            }
            if (((((_0_c) === (34)) || ((_0_c) === (39))) || ((_0_c) === (91))) || ((_0_c) === (123))) {
                let _3_node = undefined;
                if ((_0_c) === (34)) {
                    (_this)._fr = false;
                    let _out5;
                    _3_node =
                        (_this).m1r();
                }
                else if ((_0_c) === (39)) {
                    (_this)._fr = false;
                    let _out6;
                    _3_node =
                        (_this).m1v();
                }
                else {
                    let _out7;
                    _3_node =
                        (_this).my();
                }
                (_this).m14(_3_node);
                if ((((_0_c) === (34)) || ((_0_c) === (39))) && (_this._fr)) {
                    (_this).mg("a multi-line quoted scalar cannot be a block mapping key");
                }
                (_this).mf();
                let _4_sep;
                _4_sep = false;
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (58))) {
                    let _out8;
                    _4_sep =
                        (_this).m29((_this.pos) + (1));
                }
                if (!(_4_sep)) {
                    (_this).mg("expected ':' after mapping key");
                }
                let _out9;
                key =
                    (_this).mt(_3_node);
                return key;
            }
            let _5_start;
            _5_start = _this.pos;
            let _6_end = 0;
            let _out10;
            _6_end =
                (_this).m2a();
            if (!(_this._fp)) {
                (_this).mg("expected ':' after mapping key");
            }
            let _7_node;
            let _out11;
            _7_node =
                (_this).md(_5_start, _6_end);
            (_this).m14(_7_node);
            let _out12;
            key =
                (_this).mt(_7_node);
            return key;
        }
        m2y() {
            let _this = this;
            let key = "";
            (_this).pos = (_this.pos) + (1);
            let _0_name = "";
            let _out0;
            _0_name =
                (_this).m13();
            (_this).mf();
            let _1_c;
            _1_c = -1;
            if ((_this.pos) < (_this.len)) {
                _1_c = _this.src.charCodeAt(_this.pos);
            }
            if ((_1_c) === (38)) {
                (_this).mg("a node may carry at most one anchor");
            }
            let _2_tag;
            _2_tag = "";
            let _3_hasTag;
            _3_hasTag = false;
            if ((_1_c) === (33)) {
                let _out1;
                _2_tag =
                    (_this).m1b();
                (_this).m1c(false);
                (_this).mf();
                _1_c = -1;
                if ((_this.pos) < (_this.len)) {
                    _1_c = _this.src.charCodeAt(_this.pos);
                }
                if ((_1_c) === (33)) {
                    (_this).mg("a node may carry at most one tag");
                }
                if ((_1_c) === (38)) {
                    (_this).mg("a node may carry at most one anchor");
                }
                _3_hasTag = true;
            }
            if ((_1_c) === (42)) {
                (_this).mg("an alias node cannot carry an anchor property");
            }
            let _4_savedPending;
            _4_savedPending = _this._fo;
            let _5_hadSavedPending;
            _5_hadSavedPending = _this._fd;
            (_this)._fo = _0_name;
            (_this)._fd = true;
            if (_3_hasTag) {
                let _6_node;
                let _out2;
                _6_node =
                    (_this).m30(_2_tag, _1_c);
                (_this).m14(_6_node);
                let _out3;
                key =
                    (_this).mt(_6_node);
            }
            else {
                let _out4;
                key =
                    (_this).m2x();
            }
            (_this)._fo = _4_savedPending;
            (_this)._fd = _5_hadSavedPending;
            return key;
        }
        m2z() {
            let _this = this;
            let key = "";
            let _0_tag = "";
            let _out0;
            _0_tag =
                (_this).m1b();
            (_this).m1c(false);
            (_this).mf();
            let _1_c;
            _1_c = -1;
            if ((_this.pos) < (_this.len)) {
                _1_c = _this.src.charCodeAt(_this.pos);
            }
            if ((_1_c) === (33)) {
                (_this).mg("a node may carry at most one tag");
            }
            let _2_anchorName;
            _2_anchorName = "";
            let _3_hasAnchor;
            _3_hasAnchor = false;
            if ((_1_c) === (38)) {
                (_this).pos = (_this.pos) + (1);
                let _out1;
                _2_anchorName =
                    (_this).m13();
                (_this).mf();
                _1_c = -1;
                if ((_this.pos) < (_this.len)) {
                    _1_c = _this.src.charCodeAt(_this.pos);
                }
                if ((_1_c) === (38)) {
                    (_this).mg("a node may carry at most one anchor");
                }
                if ((_1_c) === (33)) {
                    (_this).mg("a node may carry at most one tag");
                }
                _3_hasAnchor = true;
            }
            if ((_1_c) === (42)) {
                (_this).mg("an alias node cannot carry a tag/anchor property");
            }
            let _4_savedPending;
            _4_savedPending = _this._fo;
            let _5_hadSavedPending;
            _5_hadSavedPending = _this._fd;
            if (_3_hasAnchor) {
                (_this)._fo = _2_anchorName;
                (_this)._fd = true;
            }
            let _6_node;
            let _out2;
            _6_node =
                (_this).m30(_0_tag, _1_c);
            if (_3_hasAnchor) {
                (_this).m14(_6_node);
            }
            (_this)._fo = _4_savedPending;
            (_this)._fd = _5_hadSavedPending;
            let _out3;
            key =
                (_this).mt(_6_node);
            return key;
        }
        m30(tag, c) {
            let _this = this;
            let node = undefined;
            if (((((c) === (34)) || ((c) === (39))) || ((c) === (91))) || ((c) === (123))) {
                if ((c) === (34)) {
                    let _0_quoted;
                    let _out0;
                    _0_quoted =
                        (_this).m1r();
                    let _out1;
                    node =
                        (_this).m1d(tag, _0_quoted);
                }
                else if ((c) === (39)) {
                    let _1_quoted;
                    let _out2;
                    _1_quoted =
                        (_this).m1v();
                    let _out3;
                    node =
                        (_this).m1d(tag, _1_quoted);
                }
                else if ((c) === (91)) {
                    let _2_sequence;
                    let _out4;
                    _2_sequence =
                        (_this).m1j();
                    let _out5;
                    node =
                        (_this).m2l(tag, _2_sequence, "seq");
                }
                else {
                    let _3_mapping;
                    let _out6;
                    _3_mapping =
                        (_this).m1k();
                    let _out7;
                    node =
                        (_this).m2l(tag, _3_mapping, "map");
                }
                (_this).mf();
                let _4_sep;
                _4_sep = false;
                if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (58))) {
                    let _out8;
                    _4_sep =
                        (_this).m29((_this.pos) + (1));
                }
                if (!(_4_sep)) {
                    (_this).mg("expected ':' after mapping key");
                }
                return node;
            }
            let _5_start;
            _5_start = _this.pos;
            let _6_end = 0;
            let _out9;
            _6_end =
                (_this).m2a();
            if (!(_this._fp)) {
                (_this).mg("expected ':' after mapping key");
            }
            let _out10;
            node =
                (_this).m1d(tag, Native.__default.slice(_this.src, _5_start, _6_end));
            return node;
        }
        m31(col, firstKey, firstHasValue, firstIsExplicit) {
            let _this = this;
            let result = undefined;
            let _out0;
            result =
                Native.__default.createObject();
            (_this).m14(result);
            let _0_key;
            _0_key = firstKey;
            if (!(firstIsExplicit)) {
                let _out1;
                _0_key =
                    (_this).mu(_0_key);
            }
            let _1_hasValue;
            _1_hasValue = firstHasValue;
            let _2_isExplicit;
            _2_isExplicit = firstIsExplicit;
            let _3_expected;
            _3_expected = _this._fl;
            let _4_hasExpected;
            _4_hasExpected = _this._fc;
            let _5_expectedLength;
            _5_expectedLength = 0;
            if (_4_hasExpected) {
                let _out2;
                _5_expectedLength = _3_expected.length;
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
                    _9_expectedValue = _3_expected[_8_keyCount];
                    if (!(_9_expectedValue === _0_key)) {
                        let _out4;
                        _6_produced =
                            Native.__default.createArray();
                        let _10_copyIndex;
                        _10_copyIndex = 0;
                        while ((_10_copyIndex) < (_8_keyCount)) {
                            let _11_previous = undefined;
                            let _out5;
                            _11_previous = _3_expected[_10_copyIndex];
                            _6_produced.push(_11_previous);
                            _10_copyIndex = (_10_copyIndex) + (1);
                        }
                        _6_produced.push(_0_key);
                        _7_matched = false;
                    }
                }
                else if (_7_matched) {
                    let _out6;
                    _6_produced =
                        Native.__default.createArray();
                    if (_4_hasExpected) {
                        let _12_copyIndex;
                        _12_copyIndex = 0;
                        while ((_12_copyIndex) < (_8_keyCount)) {
                            let _13_previous = undefined;
                            let _out7;
                            _13_previous = _3_expected[_12_copyIndex];
                            _6_produced.push(_13_previous);
                            _12_copyIndex = (_12_copyIndex) + (1);
                        }
                    }
                    _6_produced.push(_0_key);
                    _7_matched = false;
                }
                else {
                    _6_produced.push(_0_key);
                }
                _8_keyCount = (_8_keyCount) + (1);
                let _14_value;
                _14_value = Native.__default.nullValue;
                if (_1_hasValue) {
                    if (((_this.pos) >= (_this.len)) || ((_this.src.charCodeAt(_this.pos)) !== (58))) {
                        (_this).mg("expected ':' after a block mapping key");
                    }
                    (_this).pos = (_this.pos) + (1);
                    if (_2_isExplicit) {
                        let _out8;
                        _14_value =
                            (_this).m2r(col);
                    }
                    else {
                        (_this).mf();
                        if (((((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) !== (10))) && ((_this.src.charCodeAt(_this.pos)) !== (13))) && ((_this.src.charCodeAt(_this.pos)) !== (35))) {
                            (_this)._fg = true;
                            let _out9;
                            _14_value =
                                (_this).m2k(col, true);
                        }
                        else {
                            (_this).m22();
                            if (((_this.pos) < (_this.len)) && ((((_this.pos) - (_this.lineStart)) > (col)) || ((((_this.pos) - (_this.lineStart)) === (col)) && ((_this.src.charCodeAt(_this.pos)) === (45))))) {
                                let _out10;
                                _14_value =
                                    (_this).m2e(col, true);
                            }
                        }
                    }
                }
                (_this).mv(result, _0_key, _14_value);
                _1_hasValue = true;
                _2_isExplicit = false;
                let _15_atDocumentMarker;
                _15_atDocumentMarker = false;
                if (((_this.pos) < (_this.len)) && (((_this.pos) - (_this.lineStart)) === (0))) {
                    let _out11;
                    _15_atDocumentMarker =
                        (_this).IsDocMarkerAt(_this.pos);
                }
                if (_15_atDocumentMarker) {
                    (_this).m1m(_3_expected, _4_hasExpected, _6_produced, _7_matched, _8_keyCount, _5_expectedLength);
                    return result;
                }
                if (((_this.pos) >= (_this.len)) || (((_this.pos) - (_this.lineStart)) !== (col))) {
                    (_this).m1m(_3_expected, _4_hasExpected, _6_produced, _7_matched, _8_keyCount, _5_expectedLength);
                    return result;
                }
                if ((_this.src.charCodeAt(_this.pos)) === (45)) {
                    let _16_dashSeparator = false;
                    let _out12;
                    _16_dashSeparator =
                        (_this).m29((_this.pos) + (1));
                    if (_16_dashSeparator) {
                        (_this).m1m(_3_expected, _4_hasExpected, _6_produced, _7_matched, _8_keyCount, _5_expectedLength);
                        return result;
                    }
                }
                if (_this._fs) {
                    (_this).m2h((col) - (1));
                }
                let _17_fast;
                _17_fast = false;
                if ((((_7_matched) && (_4_hasExpected)) && ((_8_keyCount) < (_5_expectedLength))) && (!(_this._fd))) {
                    let _18_expectedValue = undefined;
                    let _out13;
                    _18_expectedValue = _3_expected[_8_keyCount];
                    let _19_expectedKey;
                    _19_expectedKey = _18_expectedValue;
                    let _out14;
                    _17_fast =
                        (_this).mr(_19_expectedKey);
                    if (_17_fast) {
                        _0_key = _19_expectedKey;
                    }
                }
                if (!(_17_fast)) {
                    let _20_explicitIndicator;
                    _20_explicitIndicator = false;
                    let _21_emptyIndicator;
                    _21_emptyIndicator = false;
                    if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (63))) {
                        let _out15;
                        _20_explicitIndicator =
                            (_this).m29((_this.pos) + (1));
                    }
                    if (((_this.pos) < (_this.len)) && ((_this.src.charCodeAt(_this.pos)) === (58))) {
                        let _out16;
                        _21_emptyIndicator =
                            (_this).m29((_this.pos) + (1));
                    }
                    if (_20_explicitIndicator) {
                        (_this).pos = (_this.pos) + (1);
                        let _22_explicitKey;
                        let _out17;
                        _22_explicitKey =
                            (_this).m2p(col);
                        let _23_explicitKeyText = "";
                        let _out18;
                        _23_explicitKeyText =
                            (_this).ms(_22_explicitKey);
                        let _out19;
                        _0_key =
                            (_this).mu(_23_explicitKeyText);
                        let _out20;
                        _1_hasValue =
                            (_this).m2t(col);
                        _2_isExplicit = true;
                    }
                    else if (_21_emptyIndicator) {
                        let _out21;
                        _0_key =
                            (_this).mu("");
                        _1_hasValue = true;
                        _2_isExplicit = false;
                    }
                    else {
                        let _out22;
                        _0_key =
                            (_this).m2x();
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
                (_this).mg("expected a single document in the stream, but found more (use parseAll for multi-document streams)");
            }
            return value;
        }
        ParseAll() {
            let _this = this;
            let documents = undefined;
            let _out0;
            documents =
                Native.__default.createArray();
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
                documents.push(_1_value);
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
            (_this)._fv = Native.__default.undefinedValue;
            (_this)._ff = false;
            (_this)._fw = false;
            (_this)._fs = false;
            (_this)._fj = 4194304;
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
            _0_c = _this.src.charCodeAt(i);
            if (((_0_c) !== (45)) && ((_0_c) !== (46))) {
                return yes;
            }
            if (((_this.src.charCodeAt((i) + (1))) !== (_0_c)) || ((_this.src.charCodeAt((i) + (2))) !== (_0_c))) {
                return yes;
            }
            let _1_sep = false;
            let _out0;
            _1_sep =
                (_this).m29((i) + (3));
            yes = _1_sep;
            return yes;
        }
        ConsumeDocStartMarker() {
            let _this = this;
            let inline = false;
            (_this).pos = (_this.pos) + (3);
            (_this).mf();
            if (((((_this.pos) >= (_this.len)) || ((_this.src.charCodeAt(_this.pos)) === (10))) || ((_this.src.charCodeAt(_this.pos)) === (13))) || ((_this.src.charCodeAt(_this.pos)) === (35))) {
                (_this).m22();
                inline = false;
                return inline;
            }
            inline = true;
            return inline;
        }
        ConsumeDocEndMarker() {
            let _this = this;
            (_this).pos = (_this.pos) + (3);
            (_this).m22();
            return;
        }
        ParseNextDocument() {
            let _this = this;
            let present = false;
            let value = undefined;
            (_this).m20();
            if ((_this.pos) >= (_this.len)) {
                present = false;
                value = Native.__default.noDocumentValue;
                return [present, value];
            }
            let _0_sawDirectives = false;
            let _out0;
            _0_sawDirectives =
                (_this).m28();
            if ((_0_sawDirectives) && (!(_this._f2))) {
                (_this).mg("a directives block must be preceded by an explicit '...' document end marker");
            }
            (_this).m20();
            if ((_this.pos) >= (_this.len)) {
                if (_0_sawDirectives) {
                    (_this).mg("a directives block must be terminated by an explicit '---' document start");
                }
                present = false;
                value = Native.__default.noDocumentValue;
                return [present, value];
            }
            let _1_marker = false;
            let _out1;
            _1_marker =
                (_this).IsDocMarkerAt(_this.pos);
            let _2_isDash;
            _2_isDash = (_1_marker) && ((_this.src.charCodeAt(_this.pos)) === (45));
            if ((_0_sawDirectives) && (!(_2_isDash))) {
                (_this).mg("a directives block must be terminated by an explicit '---' document start");
            }
            if (_1_marker) {
                if ((_this.src.charCodeAt(_this.pos)) === (46)) {
                    value = Native.__default.nullValue;
                    (_this).ConsumeDocEndMarker();
                    (_this)._f2 = true;
                    present = true;
                    return [present, value];
                }
                let _3_inline = false;
                let _out2;
                _3_inline =
                    (_this).ConsumeDocStartMarker();
                if ((_this.pos) >= (_this.len)) {
                    value = Native.__default.nullValue;
                }
                else {
                    let _4_nextMarker = false;
                    let _out3;
                    _4_nextMarker =
                        (_this).IsDocMarkerAt(_this.pos);
                    if (_4_nextMarker) {
                        value = Native.__default.nullValue;
                    }
                    else if (_3_inline) {
                        let _out4;
                        value =
                            (_this).m2j(-2);
                    }
                    else {
                        let _out5;
                        value =
                            (_this).m2j(-1);
                    }
                }
            }
            else {
                if (!(_this._f2)) {
                    (_this).mg("expected a '---' before the next document (a bare document may only follow an explicit '...')");
                }
                let _out6;
                value =
                    (_this).m2j(-1);
            }
            let _out7;
            _1_marker =
                (_this).IsDocMarkerAt(_this.pos);
            if ((_1_marker) && ((_this.src.charCodeAt(_this.pos)) === (46))) {
                (_this).ConsumeDocEndMarker();
                (_this)._f2 = true;
            }
            else {
                (_this)._f2 = false;
            }
            present = true;
            return [present, value];
        }
    };
    return $module;
})();
let Serializer = (function () {
    let $module = {};
    $module.__default = class __default {
        constructor() {
        }
        static Stringify(value) {
            let text = "";
            let _0_writer;
            let _nw0 = new Serializer.Writer();
            _nw0.__ctor();
            _0_writer = _nw0;
            let _out0;
            text =
                (_0_writer).Stringify(value);
            return text;
        }
        static get MAX__DEPTH() {
            return 1000;
        }
        ;
        static get BACKSLASH() {
            return 92;
        }
        ;
        static get DQUOTE() {
            return 34;
        }
        ;
        static get HEX() {
            return "0123456789ABCDEF";
        }
        ;
        static get SQUOTE() {
            return 39;
        }
        ;
        static get SPACE() {
            return 32;
        }
        ;
        static get MINUS() {
            return 45;
        }
        ;
        static get QUESTION() {
            return 63;
        }
        ;
        static get COLON() {
            return 58;
        }
        ;
        static get COMMA() {
            return 44;
        }
        ;
        static get LBRACKET() {
            return 91;
        }
        ;
        static get RBRACKET() {
            return 93;
        }
        ;
        static get LBRACE() {
            return 123;
        }
        ;
        static get RBRACE() {
            return 125;
        }
        ;
        static get HASH() {
            return 35;
        }
        ;
        static get AMP() {
            return 38;
        }
        ;
        static get STAR() {
            return 42;
        }
        ;
        static get EXCLAIM() {
            return 33;
        }
        ;
        static get PIPE() {
            return 124;
        }
        ;
        static get GT() {
            return 62;
        }
        ;
        static get PERCENT() {
            return 37;
        }
        ;
        static get AT() {
            return 64;
        }
        ;
        static get BACKTICK() {
            return 96;
        }
        ;
        static get PLUS() {
            return 43;
        }
        ;
        static get ZERO() {
            return 48;
        }
        ;
        static get DOT() {
            return 46;
        }
        ;
        static get LOWER__E() {
            return 101;
        }
        ;
        static get UPPER__E() {
            return 69;
        }
        ;
        static get ALPHABET() {
            return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        }
        ;
        static get INDENT__STEP() {
            return 2;
        }
        ;
        static get MAX__DUMP__KEY__CACHE() {
            return 10000;
        }
        ;
        static get TAB() {
            return 9;
        }
        ;
        static get LF() {
            return 10;
        }
        ;
        static get CR() {
            return 13;
        }
        ;
    };
    $module.Writer = class Writer {
        constructor() {
            this._f7 = undefined;
            this._f6 = undefined;
            this._f1 = undefined;
            this._f0 = 0;
            this._f2 = 0;
            this._f5 = undefined;
            this._f4 = false;
            this._f8 = "";
            this._f3 = 0;
        }
        __ctor() {
            let _this = this;
            let _out0;
            (_this)._f7 =
                Native.__default.createArray();
            (_this)._f6 = Native.__default.emptyMap;
            (_this)._f1 = Native.__default.emptyMap;
            (_this)._f5 = Native.__default.emptyMap;
            (_this)._f0 = 0;
            (_this)._f2 = 0;
            (_this)._f4 = false;
            (_this)._f8 = "";
            (_this)._f3 = 0;
            Native.__default.arrayPush(_this._f7, "");
            return;
        }
        m0(n) {
            let _this = this;
            let spaces = "";
            let _0_length;
            let _out0;
            _0_length =
                Native.__default.arrayLength(_this._f7);
            while ((_0_length) <= (n)) {
                let _1_last;
                _1_last = (_0_length) - (1);
                let _2_previousValue;
                let _out1;
                _2_previousValue =
                    Native.__default.arrayGet(_this._f7, _1_last);
                let _3_previous;
                _3_previous = _2_previousValue;
                let _4_next;
                _4_next = _3_previous + " ";
                Native.__default.arrayPush(_this._f7, _4_next);
                _0_length = (_0_length) + (1);
            }
            let _5_result;
            let _out2;
            _5_result =
                Native.__default.arrayGet(_this._f7, n);
            spaces = _5_result;
            return spaces;
        }
        m1(value) {
            let _this = this;
            if ((!(typeof value === "object" && value !== null)) || (value === null)) {
                return;
            }
            let _0_oldValue;
            let _out0;
            _0_oldValue =
                Native.__default.mapGet(_this._f6, value);
            if (!(_0_oldValue === undefined)) {
                let _1_oldCount;
                _1_oldCount = _0_oldValue;
                Native.__default.mapSet(_this._f6, value, (_1_oldCount) + (1));
                (_this)._f4 = true;
                return;
            }
            Native.__default.mapSet(_this._f6, value, 1);
            if (Native.__default.isUint8Array(value)) {
                return;
            }
            (_this)._f2 = (_this._f2) + (1);
            if ((_this._f2) > (1000)) {
                Native.__default.fail("stringify: maximum nesting depth exceeded");
            }
            if (Array.isArray(value)) {
                let _2_i;
                _2_i = 0;
                let _3_n;
                let _out1;
                _3_n = value.length;
                while ((_2_i) < (_3_n)) {
                    let _4_child;
                    let _out2;
                    _4_child = value[_2_i];
                    (_this).m1(_4_child);
                    _2_i = (_2_i) + (1);
                    let _out3;
                    _3_n = value.length;
                }
            }
            else {
                let _5_keys;
                let _out4;
                _5_keys =
                    Native.__default.objectKeys(value);
                let _6_i;
                _6_i = 0;
                let _7_n;
                let _out5;
                _7_n = _5_keys.length;
                while ((_6_i) < (_7_n)) {
                    let _8_keyValue;
                    let _out6;
                    _8_keyValue = _5_keys[_6_i];
                    let _9_key;
                    _9_key = _8_keyValue;
                    let _10_child;
                    let _out7;
                    _10_child = value[_9_key];
                    (_this).m1(_10_child);
                    _6_i = (_6_i) + (1);
                }
            }
            (_this)._f2 = (_this._f2) - (1);
            return;
        }
        m2(obj) {
            let _this = this;
            let needs = false;
            let _0_refCount;
            let _out0;
            _0_refCount =
                Native.__default.mapGet(_this._f6, obj);
            if (_0_refCount === undefined) {
                needs = false;
            }
            else {
                needs = (_0_refCount) > (1);
            }
            return needs;
        }
        m3(obj) {
            let _this = this;
            let name = "";
            (_this)._f0 = (_this._f0) + (1);
            let _0_sequence;
            let _out0;
            _0_sequence =
                (_this).mi(_this._f0);
            name = "a" + _0_sequence;
            Native.__default.mapSet(_this._f1, obj, name);
            return name;
        }
        m4(c) {
            let _this = this;
            return (((((((((((((((((((c) === (45)) || ((c) === (63))) || ((c) === (58))) || ((c) === (44))) || ((c) === (91))) || ((c) === (93))) || ((c) === (123))) || ((c) === (125))) || ((c) === (35))) || ((c) === (38))) || ((c) === (42))) || ((c) === (33))) || ((c) === (124))) || ((c) === (62))) || ((c) === (39))) || ((c) === (34))) || ((c) === (37))) || ((c) === (64))) || ((c) === (96));
        }
        ;
        m5(s) {
            let _this = this;
            let typed = false;
            typed = (((((((((s === "~") || (s === "null")) || (s === "Null")) || (s === "NULL")) || (s === "true")) || (s === "True")) || (s === "TRUE")) || (s === "false")) || (s === "False")) || (s === "FALSE");
            if (typed) {
                return typed;
            }
            let _out0;
            typed =
                (_this).m6(s);
            return typed;
        }
        m6(s) {
            let _this = this;
            let valid = false;
            let _0_end;
            _0_end = s.length;
            let _1_p;
            _1_p = 0;
            let _2_c;
            _2_c = -1;
            if ((_0_end) > (0)) {
                _2_c = Native.__default.codeUnitAt(s, 0);
            }
            let _3_neg;
            _3_neg = (_2_c) === (45);
            let _4_signed;
            _4_signed = (_3_neg) || ((_2_c) === (43));
            if (_4_signed) {
                _1_p = 1;
                if ((_1_p) >= (_0_end)) {
                    valid = false;
                    return valid;
                }
                _2_c = Native.__default.codeUnitAt(s, _1_p);
            }
            if (((!(_4_signed)) && ((_2_c) === (48))) && (((_1_p) + (1)) < (_0_end))) {
                let _5_n2;
                _5_n2 = Native.__default.codeUnitAt(s, (_1_p) + (1));
                if ((_5_n2) === (120)) {
                    let _out0;
                    valid =
                        (_this).m7(s, (_1_p) + (2), _0_end);
                    return valid;
                }
                if ((_5_n2) === (111)) {
                    let _out1;
                    valid =
                        (_this).m8(s, (_1_p) + (2), _0_end);
                    return valid;
                }
            }
            if (((_2_c) === (46)) && (((_0_end) - (_1_p)) === (4))) {
                let _6_a;
                _6_a = Native.__default.codeUnitAt(s, (_1_p) + (1));
                let _7_b;
                _7_b = Native.__default.codeUnitAt(s, (_1_p) + (2));
                let _8_d;
                _8_d = Native.__default.codeUnitAt(s, (_1_p) + (3));
                if ((_this).m9(_6_a, _7_b, _8_d)) {
                    valid = true;
                    return valid;
                }
                if ((!(_4_signed)) && ((_this).ma(_6_a, _7_b, _8_d))) {
                    valid = true;
                    return valid;
                }
            }
            let _9_nd;
            _9_nd = 0;
            L30: {
                while ((_1_p) < (_0_end)) {
                    C30: {
                        let _10_d;
                        _10_d = (Native.__default.codeUnitAt(s, _1_p)) - (48);
                        if (((_10_d) < (0)) || ((_10_d) > (9))) {
                            break L30;
                        }
                        _9_nd = (_9_nd) + (1);
                        _1_p = (_1_p) + (1);
                    }
                }
            }
            if (((_1_p) < (_0_end)) && ((Native.__default.codeUnitAt(s, _1_p)) === (46))) {
                _1_p = (_1_p) + (1);
                L31: {
                    while ((_1_p) < (_0_end)) {
                        C31: {
                            let _11_d;
                            _11_d = (Native.__default.codeUnitAt(s, _1_p)) - (48);
                            if (((_11_d) < (0)) || ((_11_d) > (9))) {
                                break L31;
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
            if (((_1_p) < (_0_end)) && (((Native.__default.codeUnitAt(s, _1_p)) === (101)) || ((Native.__default.codeUnitAt(s, _1_p)) === (69)))) {
                _1_p = (_1_p) + (1);
                if (((_1_p) < (_0_end)) && (((Native.__default.codeUnitAt(s, _1_p)) === (43)) || ((Native.__default.codeUnitAt(s, _1_p)) === (45)))) {
                    _1_p = (_1_p) + (1);
                }
                let _12_expStart;
                _12_expStart = _1_p;
                L32: {
                    while ((_1_p) < (_0_end)) {
                        C32: {
                            let _13_d;
                            _13_d = (Native.__default.codeUnitAt(s, _1_p)) - (48);
                            if (((_13_d) < (0)) || ((_13_d) > (9))) {
                                break L32;
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
        m7(s, from, end) {
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
                if (!(((((_1_c) >= (48)) && ((_1_c) <= ((48) + (9)))) || (((_1_c) >= (97)) && ((_1_c) <= (102)))) || (((_1_c) >= (65)) && ((_1_c) <= (70))))) {
                    valid = false;
                    return valid;
                }
                _0_p = (_0_p) + (1);
            }
            valid = true;
            return valid;
        }
        m8(s, from, end) {
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
                if (((_1_c) < (48)) || ((_1_c) > (55))) {
                    valid = false;
                    return valid;
                }
                _0_p = (_0_p) + (1);
            }
            valid = true;
            return valid;
        }
        m9(a, b, c) {
            let _this = this;
            return (((((a) === (105)) && ((b) === (110))) && ((c) === (102))) || ((((a) === (73)) && ((b) === (110))) && ((c) === (102)))) || ((((a) === (73)) && ((b) === (78))) && ((c) === (70)));
        }
        ;
        ma(a, b, c) {
            let _this = this;
            return (((((a) === (110)) && ((b) === (97))) && ((c) === (110))) || ((((a) === (78)) && ((b) === (97))) && ((c) === (78)))) || ((((a) === (78)) && ((b) === (65))) && ((c) === (78)));
        }
        ;
        mb(s) {
            let _this = this;
            let safe = false;
            let _0_n;
            _0_n = s.length;
            if ((_0_n) === (0)) {
                safe = false;
                return safe;
            }
            let _1_c0;
            _1_c0 = Native.__default.codeUnitAt(s, 0);
            if (((_1_c0) === (32)) || ((_this).m4(_1_c0))) {
                safe = false;
                return safe;
            }
            let _2_cLast;
            _2_cLast = Native.__default.codeUnitAt(s, (_0_n) - (1));
            if (((_2_cLast) === (32)) || ((_2_cLast) === (58))) {
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
                if ((((_4_c) === (58)) && (((_3_i) + (1)) < (_0_n))) && ((Native.__default.codeUnitAt(s, (_3_i) + (1))) === (32))) {
                    safe = false;
                    return safe;
                }
                if ((((_4_c) === (32)) && (((_3_i) + (1)) < (_0_n))) && ((Native.__default.codeUnitAt(s, (_3_i) + (1))) === (35))) {
                    safe = false;
                    return safe;
                }
                _3_i = (_3_i) + (1);
            }
            let _5_typed;
            let _out0;
            _5_typed =
                (_this).m5(s);
            safe = !(_5_typed);
            return safe;
        }
        mc(s) {
            let _this = this;
            let needs = false;
            let _0_i;
            _0_i = 0;
            let _1_n;
            _1_n = s.length;
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
        md(s) {
            let _this = this;
            let encoded = "";
            let _0_parts;
            let _out0;
            _0_parts =
                Native.__default.createArray();
            _0_parts.push("'");
            let _1_seg;
            _1_seg = 0;
            let _2_i;
            _2_i = 0;
            let _3_n;
            _3_n = s.length;
            while ((_2_i) < (_3_n)) {
                if ((Native.__default.codeUnitAt(s, _2_i)) === (39)) {
                    Native.__default.arrayPush(_0_parts, s.slice(_1_seg, _2_i));
                    _0_parts.push("''");
                    _1_seg = (_2_i) + (1);
                }
                _2_i = (_2_i) + (1);
            }
            Native.__default.arrayPush(_0_parts, s.slice(_1_seg, _3_n));
            _0_parts.push("'");
            encoded = Native.__default.join(_0_parts, "");
            return encoded;
        }
        me(c) {
            let _this = this;
            let escaped = "";
            let _0_hi;
            _0_hi = Native.__default.euclideanDivisionNumber(c, 16);
            let _1_lo;
            _1_lo = Native.__default.euclideanModuloNumber(c, 16);
            let _2_digit;
            _2_digit = Native.__default.slice("0123456789ABCDEF", _0_hi, (_0_hi) + (1));
            let _3_last;
            _3_last = Native.__default.slice("0123456789ABCDEF", _1_lo, (_1_lo) + (1));
            if ((c) < (16)) {
                escaped = "\\x0" + _3_last;
            }
            else {
                escaped = Native.__default.concat("\\x", _2_digit + _3_last);
            }
            return escaped;
        }
        mf(s) {
            let _this = this;
            let encoded = "";
            let _0_parts;
            let _out0;
            _0_parts =
                Native.__default.createArray();
            _0_parts.push("\"");
            let _1_seg;
            _1_seg = 0;
            let _2_i;
            _2_i = 0;
            let _3_n;
            _3_n = s.length;
            while ((_2_i) < (_3_n)) {
                let _4_c;
                _4_c = Native.__default.codeUnitAt(s, _2_i);
                let _5_esc;
                _5_esc = "";
                let _6_found;
                _6_found = true;
                if ((_4_c) === (92)) {
                    _5_esc = "\\\\";
                }
                else if ((_4_c) === (34)) {
                    _5_esc = "\\\"";
                }
                else if ((_4_c) === (0)) {
                    _5_esc = "\\0";
                }
                else if ((_4_c) === (7)) {
                    _5_esc = "\\a";
                }
                else if ((_4_c) === (8)) {
                    _5_esc = "\\b";
                }
                else if ((_4_c) === (9)) {
                    _5_esc = "\\t";
                }
                else if ((_4_c) === (10)) {
                    _5_esc = "\\n";
                }
                else if ((_4_c) === (11)) {
                    _5_esc = "\\v";
                }
                else if ((_4_c) === (12)) {
                    _5_esc = "\\f";
                }
                else if ((_4_c) === (13)) {
                    _5_esc = "\\r";
                }
                else if ((_4_c) === (27)) {
                    _5_esc = "\\e";
                }
                else if (((_4_c) < (32)) || ((_4_c) === (127))) {
                    let _out1;
                    _5_esc =
                        (_this).me(_4_c);
                }
                else {
                    _6_found = false;
                }
                if (_6_found) {
                    if ((_2_i) > (_1_seg)) {
                        Native.__default.arrayPush(_0_parts, s.slice(_1_seg, _2_i));
                    }
                    _0_parts.push(_5_esc);
                    _1_seg = (_2_i) + (1);
                }
                _2_i = (_2_i) + (1);
            }
            Native.__default.arrayPush(_0_parts, s.slice(_1_seg, _3_n));
            _0_parts.push("\"");
            encoded = Native.__default.join(_0_parts, "");
            return encoded;
        }
        mg(s) {
            let _this = this;
            let rendered = "";
            let _0_safe;
            let _out0;
            _0_safe =
                (_this).mb(s);
            if (_0_safe) {
                rendered = s;
                return rendered;
            }
            let _1_needsDouble;
            let _out1;
            _1_needsDouble =
                (_this).mc(s);
            if (_1_needsDouble) {
                let _out2;
                rendered =
                    (_this).mf(s);
            }
            else {
                let _out3;
                rendered =
                    (_this).md(s);
            }
            return rendered;
        }
        mh(s) {
            let _this = this;
            let rendered = "";
            if ((s === "...") || (((s.length) >= (4)) && (Native.__default.jsEqual(s.slice(0, 4), "... ")))) {
                let _0_needsDouble;
                let _out0;
                _0_needsDouble =
                    (_this).mc(s);
                if (_0_needsDouble) {
                    let _out1;
                    rendered =
                        (_this).mf(s);
                }
                else {
                    let _out2;
                    rendered =
                        (_this).md(s);
                }
                return rendered;
            }
            let _out3;
            rendered =
                (_this).mg(s);
            return rendered;
        }
        mi(n) {
            let _this = this;
            let text = "";
            text = Native.__default.formatNumber(n);
            return text;
        }
        mj(v) {
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
        mk(value) {
            let _this = this;
            let text = "";
            if ((value === null) || (value === undefined)) {
                text = "null";
                return text;
            }
            if (typeof value === "boolean") {
                if (value) {
                    text = "true";
                }
                else {
                    text = "false";
                }
                return text;
            }
            if (typeof value === "number") {
                let _out0;
                text =
                    (_this).mj(value);
                return text;
            }
            if (typeof value === "string") {
                let _out1;
                text =
                    (_this).mg(value);
                return text;
            }
            let _0_fallback;
            _0_fallback = Native.__default.stringFallback(value);
            let _out2;
            text =
                (_this).mg(_0_fallback);
            return text;
        }
        ml(bytes) {
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
            _1_parts =
                Native.__default.createArray();
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
                _7_a = Native.__default.euclideanDivisionNumber(_6_triple, 262144);
                let _8_b;
                _8_b = Native.__default.euclideanModuloNumber(Native.__default.euclideanDivisionNumber(_6_triple, 4096), 64);
                let _9_c;
                _9_c = Native.__default.euclideanModuloNumber(Native.__default.euclideanDivisionNumber(_6_triple, 64), 64);
                let _10_d;
                _10_d = Native.__default.euclideanModuloNumber(_6_triple, 64);
                Native.__default.arrayPush(_1_parts, Native.__default.slice("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", _7_a, (_7_a) + (1)));
                Native.__default.arrayPush(_1_parts, Native.__default.slice("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", _8_b, (_8_b) + (1)));
                Native.__default.arrayPush(_1_parts, Native.__default.slice("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", _9_c, (_9_c) + (1)));
                Native.__default.arrayPush(_1_parts, Native.__default.slice("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", _10_d, (_10_d) + (1)));
                _2_i = (_2_i) + (3);
            }
            let _11_rem;
            _11_rem = (_0_n) - (_2_i);
            if ((_11_rem) === (1)) {
                let _12_triple;
                _12_triple = (Native.__default.byteGet(bytes, _2_i)) * (65536);
                let _13_a;
                _13_a = Native.__default.euclideanDivisionNumber(_12_triple, 262144);
                let _14_b;
                _14_b = Native.__default.euclideanModuloNumber(Native.__default.euclideanDivisionNumber(_12_triple, 4096), 64);
                Native.__default.arrayPush(_1_parts, Native.__default.slice("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", _13_a, (_13_a) + (1)));
                Native.__default.arrayPush(_1_parts, Native.__default.slice("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", _14_b, (_14_b) + (1)));
                _1_parts.push("=");
                _1_parts.push("=");
            }
            else if ((_11_rem) === (2)) {
                let _15_triple;
                _15_triple = ((Native.__default.byteGet(bytes, _2_i)) * (65536)) + ((Native.__default.byteGet(bytes, (_2_i) + (1))) * (256));
                let _16_a;
                _16_a = Native.__default.euclideanDivisionNumber(_15_triple, 262144);
                let _17_b;
                _17_b = Native.__default.euclideanModuloNumber(Native.__default.euclideanDivisionNumber(_15_triple, 4096), 64);
                let _18_c;
                _18_c = Native.__default.euclideanModuloNumber(Native.__default.euclideanDivisionNumber(_15_triple, 64), 64);
                Native.__default.arrayPush(_1_parts, Native.__default.slice("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", _16_a, (_16_a) + (1)));
                Native.__default.arrayPush(_1_parts, Native.__default.slice("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", _17_b, (_17_b) + (1)));
                Native.__default.arrayPush(_1_parts, Native.__default.slice("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", _18_c, (_18_c) + (1)));
                _1_parts.push("=");
            }
            encoded = Native.__default.join(_1_parts, "");
            return encoded;
        }
        mm(bytes) {
            let _this = this;
            let text = "";
            let _0_b64;
            let _out0;
            _0_b64 =
                (_this).ml(bytes);
            if (_0_b64 === "") {
                text = "!!binary \"\"";
            }
            else {
                text = "!!binary " + _0_b64;
            }
            return text;
        }
        mn(obj, isArr) {
            let _this = this;
            let empty = false;
            if (isArr) {
                let _0_count;
                let _out0;
                _0_count = obj.length;
                empty = (_0_count) === (0);
            }
            else {
                let _1_keys;
                let _out1;
                _1_keys =
                    Native.__default.objectKeys(obj);
                let _2_count;
                let _out2;
                _2_count = _1_keys.length;
                empty = (_2_count) === (0);
            }
            return empty;
        }
        mo(obj, isArr, indent) {
            let _this = this;
            (_this)._f2 = (_this._f2) + (1);
            if ((_this._f2) > (1000)) {
                Native.__default.fail("stringify: maximum nesting depth exceeded");
            }
            let _0_ind;
            let _out0;
            _0_ind =
                (_this).m0(indent);
            if (isArr) {
                let _1_i;
                _1_i = 0;
                let _2_n;
                let _out1;
                _2_n = obj.length;
                while ((_1_i) < (_2_n)) {
                    (_this)._f8 = Native.__default.concat(_this._f8, _0_ind + "-");
                    let _3_value;
                    let _out2;
                    _3_value = obj[_1_i];
                    (_this).mp(_3_value, indent);
                    _1_i = (_1_i) + (1);
                    let _out3;
                    _2_n = obj.length;
                }
            }
            else {
                let _4_keys;
                let _out4;
                _4_keys =
                    Native.__default.objectKeys(obj);
                let _5_i;
                _5_i = 0;
                let _6_n;
                let _out5;
                _6_n = _4_keys.length;
                while ((_5_i) < (_6_n)) {
                    let _7_keyValue;
                    let _out6;
                    _7_keyValue = _4_keys[_5_i];
                    let _8_k;
                    _8_k = _7_keyValue;
                    _7_keyValue = _8_k;
                    let _9_keyColon;
                    _9_keyColon = "";
                    let _10_cacheValue;
                    let _out7;
                    _10_cacheValue =
                        Native.__default.mapGet(_this._f5, _7_keyValue);
                    if (!(_10_cacheValue === undefined)) {
                        _9_keyColon = _10_cacheValue;
                    }
                    else {
                        let _11_rendered;
                        let _out8;
                        _11_rendered =
                            (_this).mg(_8_k);
                        _9_keyColon = _11_rendered + ":";
                        let _12_cacheSize;
                        let _out9;
                        _12_cacheSize =
                            Native.__default.mapSize(_this._f5);
                        if ((_12_cacheSize) < (10000)) {
                            Native.__default.mapSet(_this._f5, _7_keyValue, _9_keyColon);
                        }
                    }
                    (_this)._f8 = Native.__default.concat(_this._f8, _0_ind + _9_keyColon);
                    let _13_value;
                    let _out10;
                    _13_value = obj[_8_k];
                    (_this).mp(_13_value, indent);
                    _5_i = (_5_i) + (1);
                }
            }
            (_this)._f2 = (_this._f2) - (1);
            return;
        }
        mp(value, indent) {
            let _this = this;
            if ((!(typeof value === "object" && value !== null)) || (value === null)) {
                let _0_scalar;
                let _out0;
                _0_scalar =
                    (_this).mk(value);
                (_this)._f8 = Native.__default.concat(_this._f8, Native.__default.concat(" ", _0_scalar + "\n"));
                return;
            }
            let _1_hasExistingAnchor;
            _1_hasExistingAnchor = false;
            let _2_anchorValue;
            _2_anchorValue = Native.__default.undefinedValue;
            if (_this._f4) {
                let _out1;
                _2_anchorValue =
                    Native.__default.mapGet(_this._f1, value);
                _1_hasExistingAnchor = !(_2_anchorValue === undefined);
            }
            if (_1_hasExistingAnchor) {
                let _3_already;
                _3_already = _2_anchorValue;
                (_this)._f8 = Native.__default.concat(_this._f8, Native.__default.concat(" *", _3_already + "\n"));
                return;
            }
            if (Native.__default.isUint8Array(value)) {
                let _4_hasName;
                _4_hasName = false;
                if (_this._f4) {
                    let _out2;
                    _4_hasName =
                        (_this).m2(value);
                }
                let _5_name;
                _5_name = "";
                if (_4_hasName) {
                    let _out3;
                    _5_name =
                        (_this).m3(value);
                }
                let _6_binary;
                let _out4;
                _6_binary =
                    (_this).mm(value);
                if (_4_hasName) {
                    _6_binary = Native.__default.concat("&", Native.__default.concat(_5_name, " " + _6_binary));
                }
                (_this)._f8 = Native.__default.concat(_this._f8, Native.__default.concat(" ", _6_binary + "\n"));
                return;
            }
            let _7_isArr;
            _7_isArr = Array.isArray(value);
            let _8_hasName;
            _8_hasName = false;
            if (_this._f4) {
                let _out5;
                _8_hasName =
                    (_this).m2(value);
            }
            let _9_name;
            _9_name = "";
            if (_8_hasName) {
                let _out6;
                _9_name =
                    (_this).m3(value);
            }
            let _10_empty;
            let _out7;
            _10_empty =
                (_this).mn(value, _7_isArr);
            if (_10_empty) {
                let _11_literal;
                if (_7_isArr) {
                    _11_literal = "[]";
                }
                else {
                    _11_literal = "{}";
                }
                if (_8_hasName) {
                    _11_literal = Native.__default.concat("&", Native.__default.concat(_9_name, " " + _11_literal));
                }
                (_this)._f8 = Native.__default.concat(_this._f8, Native.__default.concat(" ", _11_literal + "\n"));
                return;
            }
            if (_8_hasName) {
                (_this)._f8 = Native.__default.concat(_this._f8, Native.__default.concat(" &", _9_name + "\n"));
            }
            else {
                (_this)._f8 = Native.__default.concat(_this._f8, "\n");
            }
            (_this).mo(value, _7_isArr, (indent) + (2));
            return;
        }
        mq(value) {
            let _this = this;
            if ((!(typeof value === "object" && value !== null)) || (value === null)) {
                let _0_scalar;
                _0_scalar = "";
                if (typeof value === "string") {
                    let _1_stringValue;
                    _1_stringValue = value;
                    let _out0;
                    _0_scalar =
                        (_this).mh(_1_stringValue);
                }
                else {
                    let _out1;
                    _0_scalar =
                        (_this).mk(value);
                }
                (_this)._f8 = Native.__default.concat(_this._f8, _0_scalar + "\n");
                return;
            }
            if (Native.__default.isUint8Array(value)) {
                let _2_hasName;
                _2_hasName = false;
                if (_this._f4) {
                    let _out2;
                    _2_hasName =
                        (_this).m2(value);
                }
                let _3_name;
                _3_name = "";
                if (_2_hasName) {
                    let _out3;
                    _3_name =
                        (_this).m3(value);
                }
                let _4_binary;
                let _out4;
                _4_binary =
                    (_this).mm(value);
                if (_2_hasName) {
                    _4_binary = Native.__default.concat("&", Native.__default.concat(_3_name, " " + _4_binary));
                }
                (_this)._f8 = Native.__default.concat(_this._f8, _4_binary + "\n");
                return;
            }
            let _5_isArr;
            _5_isArr = Array.isArray(value);
            let _6_hasName;
            _6_hasName = false;
            if (_this._f4) {
                let _out5;
                _6_hasName =
                    (_this).m2(value);
            }
            let _7_name;
            _7_name = "";
            if (_6_hasName) {
                let _out6;
                _7_name =
                    (_this).m3(value);
            }
            let _8_empty;
            let _out7;
            _8_empty =
                (_this).mn(value, _5_isArr);
            if (_8_empty) {
                let _9_literal;
                if (_5_isArr) {
                    _9_literal = "[]";
                }
                else {
                    _9_literal = "{}";
                }
                if (_6_hasName) {
                    _9_literal = Native.__default.concat("&", Native.__default.concat(_7_name, " " + _9_literal));
                }
                (_this)._f8 = Native.__default.concat(_this._f8, _9_literal + "\n");
                return;
            }
            if (_6_hasName) {
                (_this)._f8 = Native.__default.concat(_this._f8, Native.__default.concat("&", _7_name + "\n"));
            }
            (_this).mo(value, _5_isArr, 0);
            return;
        }
        mr() {
            let _this = this;
            let result = "";
            result = _this._f8;
            (_this)._f8 = "";
            if ((result.length) !== (0)) {
                (_this)._f3 = (_this._f3) + (Native.__default.codeUnitAt(result, 0));
            }
            (_this)._f6 = Native.__default.emptyMap;
            (_this)._f1 = Native.__default.emptyMap;
            (_this)._f5 = Native.__default.emptyMap;
            return result;
        }
        Stringify(value) {
            let _this = this;
            let text = "";
            let _out0;
            (_this)._f5 =
                Native.__default.mapCreate();
            let _out1;
            (_this)._f6 =
                Native.__default.mapCreate();
            (_this)._f2 = 0;
            (_this)._f4 = false;
            (_this).m1(value);
            if (!(_this._f4)) {
                (_this)._f6 = Native.__default.emptyMap;
            }
            let _out2;
            (_this)._f1 =
                Native.__default.mapCreate();
            (_this)._f0 = 0;
            (_this)._f8 = "";
            (_this)._f2 = 0;
            (_this).mq(value);
            let _out3;
            text =
                (_this).mr();
            return text;
        }
    };
    return $module;
})();


export { DafnyCore, Serializer };
