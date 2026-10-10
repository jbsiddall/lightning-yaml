module.exports = {
  arrayCreate() { return []; },
  arrayGet(array, index) { return array[index]; },
  arrayLength(array) { return array.length; },
  arrayPush(array, value) { array.push(value); },
  arrayValue(array) { return array; },
  objectCreate() { return {}; },
  objectGet(object, key) { return object[key]; },
  objectSetSafe(object, key, value) {
    Object.defineProperty(object, key, {
      value, writable: true, enumerable: true, configurable: true,
    });
  },
  objectValue(object) { return object; },
  numberValue(number) { return number; },
  numberAdd(left, right) { return left + right; },
  boolValue(value) { return value; },
  sameValue(left, right) { return Object.is(left, right); },
  stringLength(value) { return value.length; },
  stringSlice(value, from, to) { return value.slice(from, to); },
  stringConcat(left, right) { return left + right; },
};
