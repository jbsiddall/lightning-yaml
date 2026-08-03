---
"lightning-yaml": patch
---

Fixed an issue where JavaScript object properties with `undefined` values were serialized as `null` rather than being completely omitted from the output. In the stringifier (`stringify`), `undefined` values on object properties are now completely skipped (omitted), while sequence (array) items with `undefined` values continue to serialize as `null` to match standard JSON/YAML serialization behaviors.

Before:
```javascript
stringify({ a: undefined, b: 1 });
// → "a: null\nb: 1\n"
```

After:
```javascript
stringify({ a: undefined, b: 1 });
// → "b: 1\n"
```

Also fixed an issue in the `yaml` compatibility layer (`lightning-yaml/yaml`) where the JSON-style reviver callback (`applyReviver`) was not recursively traversing and reviving custom `Set` (!!set) and `Map` (!!omap) collections. Elements inside these collections are now correctly traversed, mutated, and deleted/updated, matching the behavior of the real `yaml` library while perfectly preserving insertion order.
