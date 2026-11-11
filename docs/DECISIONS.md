# Decisions

Newest first: date, decision, why, what was rejected.

## 2026-11-11: Align with hyperbeam's shared rules

**Decision.** CLAUDE.md imports `@.hyperbeam/RULES.md`. New design decisions go in this file. Decisions D1 to D12 live in
`docs/product-model.md` and stay there. The one exception to the rules (version bumps for `docs/page-format.md`) is listed in
CLAUDE.md under "Exceptions to hyperbeam rules".

**Why.** One set of rules for every project. `product-model.md` is also the target design and `product-map.md` refers to its
decision numbers, so splitting it would be a large rewrite.

**Rejected.** Moving D1 to D12 into this file.
