---
"lightning-yaml": patch
---

Fixed a spec-conformance bug where unquoted plain scalars inside flow collections (such as arrays and inline maps) were incorrectly allowed to start with reserved indicator characters (`%`, `@`, `` ` ``) or block scalar indicators (`|`, `>`). Under the YAML 1.2 specification, these are restricted and must be quoted to be valid.

For example, the following now correctly throws a `YAMLParseError`:

```yaml
[ %invalid, @value, |scalar ]
```
