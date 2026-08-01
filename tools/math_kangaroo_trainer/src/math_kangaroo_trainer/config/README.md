# Proposed Math Kangaroo skill ontology

`skill-ontology.v1.json` is a **Stage 0 proposal**, not a reviewed curriculum or
learner model. Its 52 candidate knowledge components separate mathematical
content, transferable reasoning moves, and explicit procedures. Representation,
cognitive demand, and nuisance load are deliberately item descriptors rather
than mastery dimensions.

Every skill and relation is `proposed`; reviewer lists and gold-set evidence are
empty. In particular, the current prerequisite edges are hypotheses, and this
file cannot satisfy the Stage 0 ontology gate. The engine must not use any of
them to gate curriculum: only an `approved` prerequisite with two independent
reviewers may become eligible. Other relation types are descriptive and can
never gate.

## Review and freeze process

1. Annotate a stratified Stage 0 sample, including positive and negative boundary
   examples for every candidate skill that appears.
2. Have two independent reviewers assess names, definitions, facet placement,
   grade range, granularity, solution-path relevance, and every proposed
   prerequisite. Resolve disagreements explicitly.
3. Split, merge, or deprecate candidates based on the gold set; do not silently
   create tags during bulk annotation. Prefer high precision and `unknown` over
   speculative skill, prerequisite, or misconception claims.
4. Revalidate unique IDs, references, allowed relation types, and acyclicity of
   the graph formed by `prerequisite` relations only. Check corpus coverage and
   flag sparse skills rather than over-interpreting them.
5. Record typed gold-set and item-boundary evidence that pins the source hash,
   deterministic sample checksum, sampled item content versions, and disjoint
   positive/negative examples for every skill. Set the ontology review to
   `approved` with two distinct reviewers and explicit review/approval
   timestamps, and mark every retained skill `approved`.
6. Publish an immutable reviewed ontology version and preserve this proposal for
   provenance. Approval of a skill does not automatically approve its relations.

An audit run binds the ontology version and file checksum. Review and publish a
new immutable ontology before building the passing run; swapping a different
ontology into an existing report is a version mismatch, not approval.

Quick syntax check:

```sh
python3 -m json.tool tools/math_kangaroo_trainer/src/math_kangaroo_trainer/config/skill-ontology.v1.json >/dev/null
```
