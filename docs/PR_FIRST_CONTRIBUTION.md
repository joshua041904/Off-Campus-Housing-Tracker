# Moved: PR text is now a `.txt` for GitHub paste

The full first-PR description (including **3-teammate review breakdown**, runbook, FAQ) lives at repo root:

**`GITHUB_PR_DESCRIPTION.txt`**

1. Open that file in your editor.  
2. Select all → paste into the GitHub (or GitLab) pull request **Description** field.  
3. Use the **Preview** tab on GitHub to confirm tables and headings.

The file splits review between **Joshua** (listings + k8s + perf docs), **Franco** (k6 + suite hooks + preflight), and **Arkar** (gateway + capture + housing suite + perf scripts). Engineering narrative for **tail latency** + **cross-service suite contention**: **`docs/perf/TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md`**. **Contention evidence → files:** **`docs/perf/CLUSTER_CONTENTION_WATCH.md`** (`watch-cluster-contention.sh`, `K6_SUITE_RESOURCE_LOG`).

**Green team / onboarding (cluster, DB restore, TLS/JKS, Ollama, curl, preflight):** same **`GITHUB_PR_DESCRIPTION.txt`** — use **§4** (especially **§4.7** Ollama for full analytics parity, **§4.11** one-paste). Full runbook: **`docs/PR_SECOND_ONBOARDING.md`**. *`GITHUB_PR_DESCRIPTION_SECOND.txt` is a stub pointer only.*

Why `.txt`: one obvious, versioned artifact teammates can open without a Markdown previewer; GitHub still renders the Markdown **inside** the file when pasted.
