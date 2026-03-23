# Moved: PR text is now a `.txt` for GitHub paste

The full first-PR description (including **3-teammate review breakdown**, runbook, FAQ) lives at repo root:

**`GITHUB_PR_DESCRIPTION.txt`**

1. Open that file in your editor.  
2. Select all → paste into the GitHub (or GitLab) pull request **Description** field.  
3. Use the **Preview** tab on GitHub to confirm tables and headings.

The file splits review between **Joshua** (listings + k8s + perf docs), **Franco** (k6 + suite hooks + preflight), and **Arkar** (gateway + capture + housing suite + perf scripts).

Why `.txt`: one obvious, versioned artifact teammates can open without a Markdown previewer; GitHub still renders the Markdown **inside** the file when pasted.
