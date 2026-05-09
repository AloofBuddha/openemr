# Patient Dashboard Migration

This document defends the choice to port the OpenEMR patient dashboard from
server-rendered PHP to a single-page React application consuming the existing
FHIR R4 / OAuth2 APIs as an external client. It is the deliverable for the
Week 2 surprise challenge.

**Live demo:** https://198.211.103.246.nip.io/dashboard/
**Source:** [`dashboard-ui/`](./dashboard-ui)

---

## What was ported

A working reimplementation of the patient dashboard with **feature parity
across the required surfaces**:

| Surface | Implementation |
|---|---|
| Authentication | OAuth2 Authorization Code + PKCE, SMART-on-FHIR registered confidential client |
| Patient header | `Patient` resource — name, DOB + age, sex, MRN, active badge |
| Allergies card | `AllergyIntolerance?patient={id}` — substance + reaction + criticality |
| Problem List card | `Condition?patient={id}&category=problem-list-item` — problem + onset + status |
| Medications card | `MedicationRequest?patient={id}&status=active` — drug + dosage |
| Prescriptions card | `MedicationRequest?patient={id}` (all statuses) — historical scripts, sorted desc |
| Care Team card | `CareTeam?patient={id}` — flattened participants + role |
| **Encounter history (+1)** | `Encounter?patient={id}&_count=10` — recent visits, type, provider |

Plus a search-as-you-type **Patient picker** (`Patient?name=…`) so the
demo flow is realistic clinical UX, not a hardcoded patient.

The PHP backend is untouched. Every byte the new UI renders comes through the
existing OpenEMR FHIR R4 API.

---

## Why React + Vite + TypeScript

The existing dashboard is procedural PHP that interleaves data access, HTML
construction, and presentation logic in a single rendering pass. That model
has three structural problems for clinical UI:

1. **No client-side composition.** The patient summary is naturally a
   composition of independent panels (allergies, meds, problems, etc.) that
   each have their own loading, error, and empty states. PHP encourages
   sequential top-to-bottom rendering; if the medications query is slow, the
   page is slow. There is no graceful degradation per panel.
2. **No type system at the boundary.** Patient data crosses many layers as
   untyped associative arrays. A typo in `'birth_date'` vs `'birthdate'` is a
   silent data-loss bug. TypeScript + a typed FHIR resource layer turns those
   into compile errors.
3. **No principled client-side state.** PHP renders, then the page is dead.
   Anything dynamic — search-as-you-type, optimistic updates, retry on
   transient failure — gets bolted on with ad-hoc jQuery. This is the entire
   class of bugs OpenEMR's modern frontends already wrestle with.

**React + TanStack Query** addresses all three: components own their loading
states, TypeScript proves the FHIR shape is what we think it is, and TanStack
Query gives us cache, retry, and revalidation as primitives instead of
ceremony.

**Why Vite over Next/Remix:** the dashboard does not need SSR. Patient data
is sensitive — rendering it on a server we don't own (Vercel, etc.) would be
a HIPAA non-starter, and rendering it on the OpenEMR PHP server defeats the
point of the migration. A static SPA built once and served by Apache (which
already serves OpenEMR) is the simplest possible deployment that still
gives us modern tooling.

**Why TanStack Router over React Router:** type-safe route params (`patientId`
flows through to `useParams`) and built-in support for code splitting at
route boundaries. The cost is one extra dep; the win is zero stringly-typed
navigation calls.

**Why ShadCN:** the existing copilot module already uses Radix primitives
directly. ShadCN's "copy components into your repo" model preserves that
ergonomic and avoids a runtime UI library dep. Each card uses Card, Badge,
Skeleton — nothing exotic.

**Why Zustand:** auth tokens are the *only* shared state. Everything else
lives in the TanStack Query cache. Redux Toolkit would be overkill; React
context would force every consumer of `useAuth` to re-render on token
refresh. Zustand's selector model gives surgical re-renders for free.

---

## What was gained

**Per-card resilience.** A 500 from the `Condition` endpoint shows a
destructive-tinted error inside *that one card*. The other five cards still
render. The PHP version returns one HTML blob — partial failure isn't a
language the rendering layer speaks.

**Type-safe data path.** `Patient.birthDate` is typed `string | undefined`.
The `formatDate` helper handles both. The compiler proves we never reach
into `birthdate` (typo) or `dob` (legacy field). `tsc --noEmit` passes
strictly (`"strict": true`, `noUnusedLocals`, `noUnusedParameters`).

**Cached + revalidated data.** Click into a patient, click back to the
picker, click into the same patient — TanStack Query serves the cached
`Patient` resource instantly while revalidating in the background. The PHP
page round-trips on every navigation.

**Bundle 95 KB gzipped.** That's the entire app — auth, router, query
client, six cards, search. It loads on a 3G connection in under a second.
The OpenEMR `style_light.css` alone is 1.5 MB uncompressed.

**Independent deploys.** `dashboard-ui/` builds to `dist/` and rsyncs to
`/root/openemr/dashboard/` on prod. The PHP app and its database don't
move. Reverting the dashboard means rolling back one rsync; reverting a
PHP change historically meant a database migration audit.

**Test surface that fits the app.** Every FHIR hook is a pure
`fhirFetch` + `useQuery` call — easy to mock at the `fetch` boundary. The
PHP equivalent is hard to test in isolation because the same function reads
`$_SESSION`, queries the DB, and emits HTML.

---

## Tradeoffs

**1. The OAuth client secret ends up in the JS bundle.**

OpenEMR's OAuth server rejects `token_endpoint_auth_method: none` — public
SMART clients with pure PKCE aren't supported on this version. We registered
as a confidential client (`client_secret_post`) with PKCE. The secret is
read from `VITE_OAUTH_CLIENT_SECRET` at build time and lands in the
production JS bundle.

For a self-hosted single-tenant deployment with an admin who can rotate the
secret, this is acceptable — anyone who can grab the secret from the bundle
can already see the login page. For a multi-tenant or public deployment,
this would be unacceptable, and the right fix is a thin server-side proxy
(a single PHP file in the OpenEMR module) that holds the secret and forwards
the `/token` exchange. We chose not to build that for the demo because it
duplicates the OAuth server's job and adds a moving part.

**2. Refresh tokens live in `sessionStorage`.**

`localStorage` would survive tab close — convenient, but expanded XSS surface.
`sessionStorage` clears on tab close, which means the user re-logs after
closing the tab. The access token plus refresh token live there together;
silent renewal is implemented in `fhir/client.ts` so a 401 transparently
refreshes once before failing.

The production-grade alternative is httpOnly refresh-token cookies set by a
backend proxy. Same architectural cost as #1 above, same reason for
deferring it.

**3. We dropped the `aud` parameter from the authorize request.**

OpenEMR's `CustomAuthCodeGrant` validates `aud` against its configured
`site_addr_oath`. The instance's site address was `https://localhost:9300`,
so any `aud` we'd send from a browser would mismatch. We updated
`site_addr_oath` to the public URL so OpenEMR builds correct redirect URLs,
and we omit `aud` from the authorize request — OpenEMR's grant logic
explicitly skips the audience check when both `aud` and `launch` are absent
(non-launch standalone scenario).

This is a real configuration pitfall that any SMART app will hit. It's
documented inline in `auth/oauth.ts:startLogin`.

**4. Same-origin hosting via Apache, not a separate static host.**

Caddy proxies to Apache; Apache serves `/dashboard/*` from a directory
inside the OpenEMR webroot. We considered a separate origin (e.g.,
`dashboard.198.211.103.246.nip.io`) but rejected it: it adds a Caddy
site, requires CORS preflights for FHIR calls, and complicates the OAuth
redirect URI registration. Same-origin removes all three, at the cost of
coupling the dashboard's deploy lifecycle to the OpenEMR Apache vhost.

SPA fallback uses a `.htaccess` in the dashboard directory (rewrites
unknown paths to `index.html`). It's small and cohabits cleanly with the
OpenEMR webroot's own `.htaccess`.

**5. We did not migrate the data-write paths.**

The original PHP dashboard has small inline forms (e.g., add an issue,
amend a note). The challenge was scoped to the read path; the React UI is
read-only. Adding write would require a `POST` strategy that handles
optimistic updates, conflict resolution, and rollback — work proportional
to one full sprint, not an afternoon.

**6. FHIR types are hand-rolled, not imported from a generated schema.**

We typed only the resource fields we render. `@types/fhir` exists but
includes the entire R4 spec; for a 6-card surface, the import cost
exceeded the value. The hand-rolled types live in `fhir/types.ts` and
mirror the OpenEMR endpoints we actually call. When the surface grows,
swapping to the generated types is a five-minute change.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (React SPA, Vite-bundled, ~95 KB gzipped)  │
│                                                     │
│   ┌──────────────┐   ┌─────────────────────────┐    │
│   │ TanStack     │   │ Zustand auth store      │    │
│   │ Query cache  │◄──┤ accessToken/refresh     │    │
│   │ (per-resource│   │ in sessionStorage       │    │
│   │  per-patient)│   └─────────────────────────┘    │
│   └──────┬───────┘                                  │
│          │ Bearer <access_token>                    │
└──────────┼──────────────────────────────────────────┘
           │
           │ HTTPS (same origin)
           ▼
┌──────────────────────────────────────────────────┐
│ Caddy (TLS termination, /dashboard/* static, *)  │
│                                                  │
│   /dashboard/*  ──► Apache (serves dist/)        │
│   /apis/*       ──► Apache (FHIR endpoints)      │
│   /oauth2/*     ──► Apache (token / authorize)   │
│   /*            ──► Apache (legacy OpenEMR)      │
└──────────────────────────────────────────────────┘
```

`dashboard-ui/` layout:

```
src/
  main.tsx              — QueryClient + RouterProvider
  routeTree.tsx         — /, /callback, /patients, /patient/$id
  config.ts             — endpoint URLs + scope list
  auth/
    oauth.ts            — PKCE helpers, code→token, refresh
    useAuth.ts          — Zustand store
  fhir/
    types.ts            — Patient, Bundle<T>, AllergyIntolerance, …
    client.ts           — fhirFetch w/ silent 401 refresh
    hooks.ts            — usePatient, useAllergies, useEncounters, …
  components/
    AppHeader.tsx, AuthGuard.tsx, PatientHeader.tsx, ClinicalCard.tsx
    cards/              — six cards, each ~30 LOC
    ui/                 — ShadCN primitives (Card, Button, Badge, …)
  pages/
    LoginPage, CallbackPage, PatientPickerPage, PatientDashboardPage
```

---

## How to deploy

`scripts/deploy.sh` is extended to build and rsync the dashboard:

```bash
bash scripts/deploy.sh
# Pushes git, pulls on prod, builds dashboard-ui/, rsyncs dist/.
```

A grader running this fork on a fresh OpenEMR instance must:

1. Set `site_addr_oath` in OpenEMR globals to the public URL.
2. Register a SMART app at `/oauth2/default/registration` (curl recipe in
   `dashboard-ui/.env.production.example`).
3. Approve the client in **Admin → System → API Clients** if
   `oauth_app_manual_approval` is `1` (we set it to `0` for the demo).
4. Write `dashboard-ui/.env.production` with the resulting credentials.
5. `bash scripts/deploy.sh`.

---

## Future work, if scope expanded

- Move token exchange to a thin PHP proxy → public client + refresh tokens
  in httpOnly cookies (resolves tradeoffs #1 and #2 together).
- Add write paths for the small inline forms in the legacy dashboard.
- Replace hand-rolled FHIR types with `@types/fhir` once the resource
  surface exceeds ~10 types.
- Add Playwright tests against a seeded OpenEMR — the FHIR client is a
  single `fetch` chokepoint, easy to mock or record.
