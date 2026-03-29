# Paste into GitHub: PR review comment

**PR:** `fix/listings-validation-response-handling`  
**Usage:** Copy everything below the `---` into the PR conversation (or “Review changes” summary). Replace `[Your Name]` with how you sign reviews.

---

## Review — fix/listings-validation-response-handling

Thanks for the cleanup and consolidation here — this is a solid structural improvement.

### Summary of what this PR achieves

- Centralizes listings validation into `validation.ts`
- Applies shared validation to both HTTP and gRPC handlers
- Prevents malformed UUIDs from reaching the database on get-by-id paths
- Adds consistent create validation logic
- Enforces `min_price <= max_price` (and integer / non-negative rules) on search filters
- Aligns error handling between transport layers

This meaningfully reduces duplication and improves correctness at the service boundary.

### Code review notes

After an **isolated checkout** of this branch and review against the **`origin/main` merge base**:

- Validation runs **before** any `pool.query` on the refactored create, get-by-id, and search paths.
- Validation failures are **returned**, not thrown (no stack-trace overhead on the happy invalid path).
- No async work inside validation; no shared mutable state in the validation module.
- HTTP and gRPC no longer duplicate ad hoc checks — same rules, same messages where it matters.

**Correctness:** good  
**Layering:** good  
**Transport consistency:** good  

### Performance considerations

Hot-path analysis shows:

- The UUID regex is currently constructed **inside** `isValidUuid` on each call; the date check uses an **inline** regex literal per call. Small **regex allocation** cost under very high churn — acceptable for merge, but a **module-level hoist** is an easy follow-up if we ever profile this hot under abuse.
- Small object allocations per validated request are **expected and bounded**.

No structural performance regression in handler flow from the refactor itself.

### Load testing and the malformed k6 run

The three questions that matter for this PR:

1. **Correctness** — improves (clearer boundaries, fewer DB errors on bad input).
2. **Hot-path cost** — minor extra work (regex + small allocations); not a red flag from review.
3. **Abuse amplification** — **this is the real win** if invalid traffic stops doing full search/DB work.

Initial **`k6-listings-malformed.js`** results showed **med ~147 ms** and **p95 ~1 s** — that pattern is **not** “validation got slow”; it is consistent with **invalid requests still hitting heavy paths** (e.g. search still executing, or cluster **not** running an image built from this branch). Healthy-path k6 in the same lab was **~70–110 ms p95**, so **invalid load should not be more expensive than valid load** once validation short-circuits to fast 400s.

**Before merge, we should verify deployment, not only code:**

1. **Prove which image is running**

   ```bash
   kubectl get deploy listings-service -n off-campus-housing-tracker -o=jsonpath='{.spec.template.spec.containers[0].image}'
   ```

   Compare the image identity / build ref to an image built from this branch (e.g. after rebuild from the PR tip). If the cluster is not on this PR’s image, **malformed k6 numbers are not a verdict on the PR**.

2. **Deploy listings from this branch** (example):

   ```bash
   SERVICES=listings-service ./scripts/rebuild-och-images-and-rollout.sh
   kubectl rollout status deployment/listings-service -n off-campus-housing-tracker
   ```

3. **Re-run only the malformed script** (not the full grid):

   ```bash
   SSL_CERT_FILE="$PWD/certs/dev-root.pem" k6 run scripts/load/k6-listings-malformed.js
   ```

   **Expected** once the PR image is live: high **400** rate on bad filters/ids, **no 5xx** from validation cases, and **malformed p95** well below the ~1 s we saw when the wrong image was likely running. If p95 stays ~1 s, we debug **route order**, **gateway behavior**, and whether **search** still runs before validation — not “add more regex.”

**Optional follow-up:** add focused unit tests for malformed filter combinations and UUID edge cases so behavior stays locked across refactors.

### Merge gate

Once a **deployed listings image from this branch** confirms:

- Fast **400** behavior under malformed k6 (and checks in the script that expect 400s go green)
- No regression on healthy-path latency vs our baseline in the same lab

I am comfortable **merging** this PR. It is a meaningful improvement in boundary hygiene and reduces amplification risk from bad input.

Great work consolidating validation across interfaces.

— Tom
