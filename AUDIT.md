# OpenEMR Audit

**Codebase:** github.com/AloofBuddha/openemr  
**Date:** 2026-04-27  
**Auditor:** AgentForge Clinical Co-Pilot project  
**Scope:** Security, Performance, Architecture, Data Quality, Compliance/HIPAA

---

## Executive Summary (~500 words)

OpenEMR is a mature, production-deployed EHR with a large, layered codebase. The core application has solid security fundamentals — modern password hashing, brute-force protection, parameterized SQL throughout, and a mature role-based ACL system. However, several gaps become critical in the context of adding an AI agent that queries and synthesizes patient data on behalf of clinicians.

**The most important finding:** Authorization is role-level, not patient-level. The REST API checks whether a user has the "patients" permission — but not whether they are authorized to access *this specific patient's* record. Any user with the right role can query any patient in the system. For a multi-provider clinic, this means a physician querying the AI agent could (by accident or design) access records outside their panel. Any Clinical Co-Pilot integration must implement patient-scoped access at the service layer, not rely on the existing ACL checks alone.

**The second critical finding:** The chart access audit trail is not being populated. The `chart_tracker` table exists and is wired into the service layer, but contains zero records despite patient records being accessed. Under HIPAA, covered entities must be able to produce an accounting of disclosures — including who accessed which patient record and when. If the AI agent queries patient data and that access is not logged, the system cannot satisfy this requirement. Audit logging for every agent-initiated data access must be a first-class design constraint, not an afterthought.

**Architecture:** OpenEMR follows a clean layered pattern — HTTP controllers → Service layer (`src/Services/`) → `QueryUtils` → parameterized SQL. The REST and FHIR APIs are well-structured and cover all data the agent needs: patient demographics, encounters, medications, problems, allergies, labs, and vitals. The module system (custom_modules + Symfony EventDispatcher) provides a natural integration point that doesn't require modifying core code. The recommended integration path is a custom module that calls service-layer methods directly, with an optional sidecar service for LLM calls.

**Performance:** The critical queries for a patient brief (demographics, recent encounters, active meds, recent labs) require 4+ round trips with no caching layer. The encounter query joins 8+ tables with nested subqueries. The prescriptions table lacks a composite index on `(patient_id, start_date)` that active-medication queries would need. For a physician walking between rooms, the 90-second window means total agent response time — including LLM inference — must stay under ~10 seconds. Database query time for a single patient brief should be <500ms; the current query structure achieves this on the 3-patient demo dataset but will require validation at clinical volume.

**Data quality:** The demo dataset is thin (3 patients, 3 encounters, 1 prescription, 0 lab results). Real clinical data will have inconsistent formatting (phone numbers, nullable fields), missing values, and duplicate records. The agent's verification system must treat every piece of retrieved data as potentially incomplete and communicate uncertainty explicitly rather than synthesizing false confidence.

**HIPAA surface:** SSN and driver's license are stored in plaintext. Foreign key constraints are absent throughout the schema, meaning orphaned records are possible. The AI agent adds a new disclosure channel for PHI — every LLM API call that includes patient data constitutes a disclosure under HIPAA. This must be governed by BAA, with PHI minimized in prompts, and every disclosure logged.

---

## 1. Security Audit

### Authentication

OpenEMR uses modern, configurable password hashing via `src/Common/Auth/AuthHash.php` — bcrypt, Argon2i, and Argon2id are all supported. Timing-safe comparison prevents username enumeration (`AuthUtils.php:94-113`). Password history is enforced, preventing reuse.

Brute-force protection is multi-layered (`AuthUtils.php:1163-1231`):
- Per-username failure counter with configurable threshold (`password_max_failed_logins`)
- Per-IP failure counter with configurable threshold (`ip_max_failed_logins`)
- Manual IP block capability (`ip_force_block`)
- Email notification on auto-block

Google Sign-In is supported but introduces a risk: if a linked Google account is compromised, the OpenEMR account is accessible without any local credential verification (`AuthUtils.php:1443-1517`). For clinical accounts, this is a meaningful attack surface.

**Session management:** Sessions use SameSite=Strict and a 4-hour timeout. `HttpOnly` is set to `false` to support multi-window sessions — this increases XSS impact. No explicit session regeneration on login was observed; session fixation risk exists if session IDs can be predicted.

### Authorization — Critical Gap

The ACL system (phpGACL) is mature and enforces role-based access at the route level:

```php
// _rest_routes_standard.inc.php:100
"GET /api/patient/:puuid" => function ($puuid, HttpRestRequest $request) {
    RestConfig::request_authorization_check($request, "patients", "demo");
```

This checks "does this user have the `patients/demo` permission" — not "does this user have access to *this specific patient*." Any user with that permission can retrieve any patient's record by UUID. In a multi-provider practice, this means cross-patient data access is possible without any ACL violation being detected.

**For the agent:** Every service-layer call made by the agent must validate that the requesting clinician has a care relationship with the requested patient. This is not currently enforced and must be added.

### OAuth2 / REST API

OAuth2 is implemented via League OAuth2 Server with SMART on FHIR scope support. Bearer tokens are validated on every request. Scopes define resource-level permissions (`patient/*.read`) but not patient-instance restrictions — a system token with broad scopes can access all patients.

Access token TTL is 5 minutes. Refresh tokens are supported via `offline_access` scope.

### SQL Injection Surface

The codebase uses parameterized queries throughout, via the ADODB abstraction in `library/sql.inc.php`. `QueryUtils.php` whitelists table names and rejects backtick injection. No direct string concatenation was found in security-critical paths.

### CSRF & XSS

CSRF tokens are enforced framework-wide via `CsrfUtils`. SameSite=Strict is set on the core session cookie. The `HttpOnly=false` setting is the primary XSS amplification risk — a successful XSS attack can steal session tokens.

---

## 2. Performance Audit

### Query Structure for Patient Brief

Building a complete patient brief requires at minimum 4 sequential queries:

| Query | Table | Index Used | Notes |
|-------|-------|------------|-------|
| Demographics | `patient_data` | PK on `pid` | Fast |
| Recent encounters | `form_encounter` | Composite `(pid, encounter)` | 8+ joins, nested subqueries — scales poorly |
| Active medications | `prescriptions` | `patient_id` only | Missing `(patient_id, start_date)` composite for date filtering |
| Lab results | `procedure_result` | Via `procedure_report_id` | Requires subquery to `procedure_order` |

**No caching layer exists.** Every agent request hits the database fresh. No Redis, APCu, or HTTP cache headers are in place. For repeated queries about the same patient within a session, results should be cached at the agent layer.

### Specific Performance Issues

1. **`EncounterService` query** (`src/Services/EncounterService.php:187-330`): Joins 8+ tables with multiple nested subqueries for facility, provider, and referrer lookups. Will degrade significantly at scale.
2. **Missing composite index** on `prescriptions(patient_id, start_date, active)` — filtering active medications by date requires a table scan on the date filter.
3. **Missing index** on `audit_master(pid)` — audit queries by patient require full table scan.

### Latency Budget

The 90-second physician workflow implies a target agent response time of ~10 seconds total. Estimated breakdown:
- DB queries (patient brief): <500ms on demo data; needs validation at scale
- LLM inference (streaming): 3–8 seconds depending on model and prompt size
- Verification pass: 500ms–1s
- Network: <200ms

The bottleneck at scale will be the encounter and medication queries, not LLM inference. Caching the last patient brief per session and streaming the response to the UI will be necessary for the latency target.

---

## 3. Architecture Audit

### Request Flow

```
HTTP Request
  → controller.php (Laminas HttpKernel)
  → Route match (_rest_routes*.inc.php)
  → Authorization check (RestConfig::request_authorization_check)
  → REST Controller (src/RestControllers/)
  → Service layer (src/Services/)
  → QueryUtils (src/Common/Database/QueryUtils.php)
  → ADODB → MariaDB
```

The REST and FHIR APIs expose all data the agent needs:

**Standard REST (`/api/`):**
- `GET /api/patient/:puuid` — demographics
- `GET /api/patient/:puuid/encounter` — encounters
- `GET /api/patient/:pid/medication` — medications
- `GET /api/patient/:puuid/allergy` — allergies
- `GET /api/patient/:puuid/medical_problem` — problems/diagnoses
- `GET /api/patient/:pid/encounter/:eid/vital` — vitals
- `GET /api/patient/:pid/encounter/:eid/soap_note` — clinical notes

**FHIR R4 (`/fhir/`):**  
Patient, Encounter, Observation, MedicationRequest, Condition, AllergyIntolerance, DiagnosticReport, Immunization, Procedure, CarePlan, Goal

### Key Data Tables

| Table | Contents | Key Fields |
|-------|----------|------------|
| `patient_data` | Demographics | `pid`, `uuid`, `fname`, `lname`, `DOB`, `sex` |
| `form_encounter` | Visits | `pid`, `encounter`, `date`, `reason`, `provider_id` |
| `lists` | Problems, meds, allergies, surgeries | `pid`, `type`, `title`, `begdate`, `enddate`, `activity` |
| `prescriptions` | Rx orders | `patient_id`, `drug`, `dosage`, `start_date`, `end_date`, `active` |
| `procedure_result` | Lab results | `result_code`, `result`, `units`, `range`, `abnormal` |

### Integration Points for the Agent

Three viable integration paths (in order of preference for this project):

1. **Custom module + direct service calls** (recommended): A module in `interface/modules/custom_modules/oe-module-clinical-copilot/` calls `PatientService`, `EncounterService`, etc. directly. No HTTP overhead, full access to the data model, cleanly isolated from core.

2. **FHIR REST API**: The agent backend calls OpenEMR's own FHIR endpoints with a service-account OAuth2 token. More overhead per request but fully standards-compliant and portable.

3. **Direct SQL via QueryUtils**: Maximum flexibility and performance, but bypasses the service layer's event system and validation. Use for specific queries not covered by the service layer.

### Module System

The Symfony EventDispatcher pattern is used throughout. New modules register listeners on events like `patient.created`, `patient.updated`, `encounter.created`. The module bootstrap pattern is documented in `interface/modules/custom_modules/oe-module-weno/src/Bootstrap.php`.

---

## 4. Data Quality Audit

### Demo Dataset

| Metric | Count | Notes |
|--------|-------|-------|
| Patients | 3 | Phil Belford, Susan Underwood, Wanda Moore |
| Encounters | 3 | 1 per patient |
| Prescriptions | 1 | Single active medication |
| Lab results | 0 | No procedure_result records |
| Medical problems | 3 | 1 per patient (via lists table) |

The demo dataset is insufficient for testing agent behavior under realistic clinical conditions. A richer dataset with multiple encounters per patient, lab results, and medication histories must be loaded before agent development and evaluation.

### Data Format Inconsistencies

- **Phone numbers:** Mixed formats (`333-444-2222` vs `4443332222`). Field is `varchar(255)` with no format constraint. The agent must handle both.
- **SSN / Driver's License:** Stored as plaintext `varchar(255)` with empty string defaults. No encryption, no format validation.
- **Address duplication:** Patient addresses exist in both `patient_data` (flat columns) and a separate `addresses` table. Sync between them is not enforced.
- **Nullable audit fields:** `created_by` and `updated_by` are NULL on all 3 demo patients — the audit trail for record creation is incomplete.

### Foreign Key Integrity

Zero foreign key constraints exist across the schema. `form_encounter.pid` does not enforce `patient_data.pid`. `prescriptions.provider_id` does not enforce `users.id`. Orphaned records are possible and cannot be detected at the database level. The agent must handle missing joins gracefully rather than assuming referential integrity.

---

## 5. Compliance & Regulatory Audit

### HIPAA — Audit Logging

OpenEMR has a multi-layer audit architecture (`src/Common/Logging/EventAuditLogger.php`) with a centralized `log` table, optional ATNA syslog support, and optional encryption. However:

**Critical gap — chart access not logged:** The `chart_tracker` table, which records who viewed which patient chart and when, contains **zero records** despite the demo patients having been accessed. Every view of a patient chart should generate a `chart_tracker` entry. This is the primary mechanism for producing the "accounting of disclosures" required under the HIPAA Privacy Rule (45 CFR §164.528). If this is disabled or misconfigured, the system cannot fulfill disclosure accounting obligations.

**No field-level audit trail:** The `log` table records event type and patient ID but not which specific fields were accessed. The system cannot answer "did user X see patient Y's SSN on date Z."

**IP address tracking is inconsistent** across event types. Full audit capability requires consistent IP capture.

### HIPAA — PHI in LLM Calls

Adding an AI agent introduces a new disclosure channel. Every LLM API call that includes patient data is a HIPAA-regulated disclosure to a Business Associate. Required mitigations:

1. **BAA required** with all LLM providers used in production (Anthropic, OpenAI, etc.)
2. **PHI minimization**: Prompts should include only the fields necessary to answer the physician's question. Avoid sending full patient records when a subset suffices.
3. **No PHI in logs**: LLM request/response logs must be sanitized or encrypted. Token-level logging (for cost tracking) must not include prompt content.
4. **Data residency**: LLM provider data processing location must comply with any applicable state regulations.
5. **Retention**: PHI transmitted to LLM providers must not be retained by those providers for training. A signed BAA addressing this is a prerequisite for production use.

For Gauntlet: demo data only is used throughout this project, acting as if a BAA is in place with all LLM providers.

### HIPAA — Data Storage

- SSN and driver's license stored in plaintext — should be encrypted at rest
- No application-level encryption detected for sensitive `patient_data` fields
- MariaDB at-rest encryption would need to be enabled at the infrastructure level for production

### HIPAA — Access Control

The per-patient authorization gap documented in the Security section is also a HIPAA issue. The Minimum Necessary standard (45 CFR §164.502(b)) requires that access to PHI be limited to the minimum necessary for the purpose. A system where any credentialed user can access any patient record does not satisfy this standard for multi-provider environments.

### Breach Notification

OpenEMR does not include automated breach detection or notification workflows. For production deployment, a SIEM or equivalent monitoring system would need to be layered on top to detect anomalous access patterns (e.g., a single user accessing hundreds of patient records in an hour).

---

## Summary of Action Items for Agent Development

| Priority | Finding | Required Action |
|----------|---------|-----------------|
| Critical | Per-patient authorization not enforced in REST API | Implement care-relationship check in agent service layer |
| Critical | chart_tracker not being populated | Investigate and fix; ensure every agent data access generates an audit entry |
| High | PHI in LLM calls | Implement PHI minimization in prompt construction; sanitize LLM logs |
| High | No patient-brief caching | Cache patient data at agent layer; don't re-query on every turn |
| Medium | Missing composite index on prescriptions | Add `(patient_id, start_date, active)` index before load testing |
| Medium | SSN/license in plaintext | Out of scope for agent but documented; encryption needed for production |
| Low | Phone number format inconsistency | Agent must normalize or tolerate mixed formats |
| Low | Thin demo dataset | Load richer synthetic data before agent eval development |
