# Spec Delta

## ADDED Requirements

### Requirement: Reserve deployment capacity separately from agent resources

**Identifier:** WCFG-SERVICE-001

Work resource policy SHALL distinguish total CPU/memory from agent CPU/memory allocation. Fresh defaults SHALL allocate total 2000 CPU milliseconds and 1536 MiB memory, with agent allocation 1000 CPU milliseconds and 768 MiB memory, maxServices 4, and maxRetainedVolumes 2 for the private and shared workspace volumes. Service defaults SHALL request 250 CPU milliseconds and 128 MiB memory, enabled true, required false, restartPolicy bounded. Limits SHALL be validated before allocation; agent allocation cannot exceed Work totals. Work creation SHALL reserve agent resources, and service admission SHALL include those reservations. A stopped Work retains desired reservations. An allocation-changing Work apply SHALL reserve any increase before replacing runtime and release decreases only after actual resources are freed; failure retains/restores the previous allocation.

#### Scenario: Deploy from a fresh default Work
- **WHEN** a new installation creates a Work without resource overrides and its agent deploys the example service
- **THEN** one agent and at least one default-sized service run within declared limits without operator quota edits

#### Scenario: Reject insufficient budget
- **WHEN** total Work resources are below agent allocation plus retained service reservations
- **THEN** create/set/apply rejects the incompatible budget without disrupting current containers

#### Scenario: Preserve customized defaults
- **WHEN** an operator edits default resources or explicitly sets maxServices to zero then restarts Core
- **THEN** Core preserves those choices and does not silently reinstall fresh defaults
