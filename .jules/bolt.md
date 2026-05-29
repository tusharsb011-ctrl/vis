## 2024-05-29 - Vanilla JS DOM Insertions
**Learning:** Native Vanilla JS list rendering was repeatedly appending elements directly to the live DOM within loops (e.g., iterating through `topics` or `reps`), causing layout thrashing (multiple reflows/repaints) on large sets.
**Action:** Always wrap iterative DOM node creation in a `DocumentFragment` first, then append the fragment to the DOM in a single operation. This ensures exactly one layout reflow regardless of array size.
