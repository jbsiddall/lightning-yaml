---
"lightning-yaml": minor
---

Reject two malformed `%YAML`/`%TAG` directives that were previously accepted silently.

Repeating a `%TAG` directive for the same handle in one document is now an error, per [YAML 1.2.2 §6.8.2](https://yaml.org/spec/1.2.2/#682-tag-directives):

```yaml
%TAG ! !foo
%TAG ! !foo
---
bar
```

A `%YAML` directive declaring a higher major version than 1 is now rejected too, per [§6.8.1](https://yaml.org/spec/1.2.2/#681-yaml-directives):

```yaml
%YAML 2.0
---
foo: bar
```

A higher *minor* version (`%YAML 1.3`) still parses, as the spec only calls for the major version mismatch to be rejected.
