# Whistle → RelayCraft migration research

Status: research notes (2026-10). Evaluates whistle as a candidate source for
the import-source adapter gated in `sharing-migration-templates-plan.md` §2.
No adapter is committed until real fixtures exist — this document records the
format landscape so fixture collection and mapping decisions are cheap later.

## What whistle exports

- Rules UI has per-group rule sets, each a named text document. Groups carry
  an ON/OFF switch.
- Rules UI **Export** produces `.txt` files (the rules DSL), one per selected
  group. The Rules CGI also supports import/export endpoints; CLI accepts
  `--shadowRules <jsonString>` for programmatic rule loading.
- **Values** (the `{key}` indirection store) is exported separately — a
  migration input that references `{key}` needs the Values export too, or the
  reference must be reported as unresolved.
- Session export (HAR/SAZ/native JSON) is traffic interchange, not rule
  migration — out of scope per the plan.

So the practical migration input is most likely **a `.txt` rules DSL export,
one group at a time**, optionally accompanied by a Values export. The adapter
should probably accept pasted text as well as files — whistle users commonly
share rule text directly.

## Rule grammar

```txt
pattern operation [lineProps...] [filters...]
```

- `pattern`: domain / URL fragment / `$`-prefixed exact / `^`-prefixed
  wildcard-in-path / `/re/i` regex / `ws[s]://` / `tunnel://`. Wildcard
  semantics are position-sensitive: `*` in the domain segment ≠ `*` in path
  (different regex expansions), and `**`/`***` widen further.
- `operation`: `protocol://value`. Value indirections: `{key}` → Values,
  `/path` → local file, `remote-url` → fetch at runtime; `(value)` = inline
  literal.
- One rule can carry **multiple operations**; `lineProps://important` boosts
  priority; `includeFilter`/`excludeFilter` refine matching (incl. method,
  body, header conditions).

## Mapping sketch to RelayCraft rules

| whistle construct | RelayCraft target | Fidelity |
| --- | --- | --- |
| `file:///path` / `rawfile://` | `map_local` file mode | exact, but path is machine-local → external-resource flag |
| `file://(inline)` / inline body protocols | `map_local` manual content | exact |
| `statusCode://403` (+ empty body) | `block_request` or `map_local` w/ statusCode | exact for bare status; combos need care |
| `reqHeaders://` / `resHeaders://` (set ops) | `rewrite_header` | exact for set; remove/other ops need review |
| `reqReplace` / `resReplace` / `resMerge` / `reqBody` / `resBody` | `rewrite_body` | partial — whistle value syntax (kv merge, JSON pointer-ish paths) has no direct equivalent |
| `host://` / `proxy://` / `https://` retarget | `map_remote` | partial — whistle proxy vs. upstream-host semantics differ; `proxy` is upstream-proxy chaining, not mapping |
| `reqDelay` / `resDelay` / `reqSpeed` / `resSpeed` | `throttle` | near-exact |
| `$`-exact, regex patterns | `match.type: url` + `exact`/`regex` | exact |
| domain/path wildcards | `url` wildcard atoms | **attention**: whistle's `*`/`**`/`***` position rules don't equal RelayCraft `*` semantics; translator must emit regex where wildcard can't express it |
| `includeFilter`/`excludeFilter` (`m:`, `reqH.`, body) | extra `match` atoms (method/header) | partial — rich filter sub-language; anything unmappable → "manual adjustment" result |
| `lineProps://important` | `execution.priority` bump | heuristic |
| multiple operations per rule | `actions[]` (multi-action rule) or split | needs case-by-case; a rule mixing `reqHeaders` + `file://` maps to one multi-action rule |
| `enable`/`disable` setting protocols, group ON/OFF | `execution.enabled` | group ON/OFF → group enable state; per-line `disable` → disabled rule |
| Values `{key}` refs | resolve at import from Values export, else flag | adapter responsibility |
| template strings `${url.x}` `${now}` etc. | none — RelayCraft has no template engine | unsupported → flagged |
| `ws`/`tunnel` patterns, `pac`, `weinre`, `log`, `pipe`, `plugin://`, `reqWrite/resWrite` streams, `jsAppend` executable content | none | unsupported → flagged with reason |

Per the plan: **never** convert a file-serving `file://` Map Local into a
response-body rewrite — file mode stays file mode, and an unresolvable
local path is a flagged external resource, not inlined content.

## Assessment

- **Coverage**: the high-frequency whistle workflows (file mock, status
  block, header rewrite, host retarget, delay) all have RelayCraft
  equivalents. The long tail (~80 protocols) is mostly unsupported and must
  be reported per-line, not silently dropped.
- **Effort**: the DSL is line-based and whitespace-tokenized — a parser is
  straightforward; the hard part is pattern/wildcard semantic fidelity and
  the value-indirection layer (Values, local paths, remote URLs).
- **User overlap**: strong in the Chinese frontend community — directly
  serves the 1.6 goal of lowering migration friction for likely RelayCraft
  adopters.

## What's needed next (deferred to the fixture-collection slice)

1. Real `.txt` exports covering: each pattern type, each mappable protocol,
   multi-op rules, filters, groups with ON/OFF, `{key}` Values refs.
2. A Values export fixture to decide whether refs get inlined or flagged.
3. Decide adapter surface: file-based only, or also "paste whistle rules
   text" in the import modal (cheap to add to the importSource seam).
