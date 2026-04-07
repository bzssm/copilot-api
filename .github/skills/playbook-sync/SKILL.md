---
name: playbook-sync
description: Generate or update modernization playbook from document sources. Use this skill when the user wants to create a playbook, sync playbook from a document or GitHub issue, extract migration policies from architecture docs, or update existing playbook files with new decisions.
---

# Playbook Sync

Analyze source documents and generate a modernization playbook — three markdown files that capture an organization's approved migration targets, standards, and guardrails.

## User Input

- **output-path** (Mandatory): The folder to save the playbook files
- **source-file-path** (Mandatory): Path to the source file containing the document content

## Output Structure

```
${output-path}/
├── targets.md       # Approved technologies and migration decisions
├── standards.md     # Naming, security, and compliance rules
└── guardrails.md    # Prohibited/required technologies and patterns
```

## Principles

- **Source Fidelity**: The playbook is loaded and enforced by automated agents at runtime — a fabricated policy causes wrong migration decisions. Only include content explicitly present in ${source-file-path}. If a category isn't mentioned in the source, omit that section entirely rather than adding placeholders.
- **Incremental Merge**: When output files already exist, merge at the **section level** — update sections with new or changed content, preserve unchanged sections verbatim. If the source explicitly removes or contradicts an existing entry, update that entry. Never drop existing content simply because the source is silent on it.
- **Direct Policy Output**: State policies as-is. Do not include rationale, explanations, or implementation guidance — those belong elsewhere.

## Classification Principles

Each file serves a distinct purpose and is consumed at different stages of the modernization workflow:

- **targets.md** — Approved framework versions, compute/data/integration services, and high-level source-to-target migration decisions. Loaded during assessment and plan creation.
- **standards.md** — Resource naming conventions, tagging, authentication, secrets management, network security, encryption, and compliance framework requirements. Loaded during assessment, plan creation, and execution.
- **guardrails.md** — Prohibited technologies and patterns (with approved alternatives), and required elements for every modernization. Loaded during assessment, plan creation, and execution.

## Workflow

### Step 1: Read and Analyze Source

1. Read ${source-file-path} (may be a GitHub issue export or markdown file)
2. Check if output files already exist in ${output-path} — read them for merge comparison
3. Classify each decision from the source into one of the three output files using the Classification Guide above

### Step 2: Generate Playbook Files

For each file, use the corresponding template as the structural reference, then fill in content extracted from the source.

#### targets.md

Use the template [targets-template](targets-template.md) for the required structure (5 sections):
- Target Frameworks, Target Compute Services, Target Data Services, Target Integration Services, Migration Decisions

#### standards.md

Use the template [standards-template](standards-template.md) for the required structure (7 sections):
- Resource Naming Conventions, Tagging Requirements, Authentication & Authorization, Secrets Management, Network Security, Encryption, Compliance Frameworks

#### guardrails.md

Use the template [guardrails-template](guardrails-template.md) for the required structure (3 sections):
- Prohibited Technologies, Prohibited Patterns, Required Elements

For each file: if it already exists, merge new content; if not, create it fresh.

### Step 3: Validate

Verify the output before finishing:
- [ ] All three files exist in ${output-path}
- [ ] targets.md has all 5 required sections
- [ ] standards.md has all 7 required sections
- [ ] guardrails.md has all 3 required sections
- [ ] Every decision in the source document is reflected in at least one output file
- [ ] No content was invented beyond what the source provides

### Step 4: Present Summary

Report to the user:
- Number of target technologies defined
- Number of migration decisions captured
- Number of prohibited technologies/patterns
- Number of required elements
- Sections left empty (no corresponding source content) — flag these as gaps for architect review
