---
"lightning-yaml": minor
---

A byte order mark is now handled per document, not just once per stream

A stream may re-declare its encoding with a byte order mark at the start of any document ([§5.2](https://yaml.org/spec/1.2.2/#52-character-encodings)). Previously only a BOM at the very start of the input was skipped, so a later one ended up glued onto your data — even onto a key:

```js
parseAll("a: 1\n...\n﻿b: 2\n");
// before: [{ a: 1 }, { "﻿b": 2 }]   ← invisible character in the key
// now:    [{ a: 1 }, { b: 2 }]
```

A BOM is now skipped everywhere the spec allows one — before a `---`, after a `...`, and alongside comment lines at the top of the stream — and rejected where the spec forbids it, immediately *after* a `---`, which is inside the document ("A BOM must not appear inside a document", §5.2). A BOM inside a quoted string is still content, as the spec requires.

As a side effect, `parse` now runs that same document-prefix skip after reading its one document, before deciding whether anything trailing is a second document — so a comment (or another BOM) left after a closing `...` no longer trips `parse`'s single-document check:

```js
parse("a\n...\n# a trailing comment\n");
// before: throws "expected a single document in the stream, but found more"
// now:    "a"
```

`parseAll` already handled this correctly; this just brings `parse` in line with it.
