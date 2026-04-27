# Users & Use Cases

## Practice Context

**Cedar Family Medicine** — independent primary care and internal medicine practice, 4801 Burnet Road Suite 200, Austin TX 78756. Two attending physicians sharing a patient panel of approximately 20 active patients in this demo environment (representing a subset of a typical 300–500 patient panel per physician in a real practice).

- **Dr. Sarah Chen, DO** — Family Medicine. Primary care for 13 patients. Typical day: 10 scheduled appointments, 9-hour clinic. Login: `sarah.chen` / `Sarah1234!`
- **Dr. Marcus Rivera, MD** — Internal Medicine. Primary care for 5 patients with more complex chronic disease profiles. Typical day: 5 scheduled appointments. Login: `marcus.rivera` / `Marcus1234!`

Both physicians use OpenEMR for charting, scheduling, and prescriptions. Each sees only their own patients in the agent; the authorization boundary between their panels is a core demo scenario.

---

## Target User

**Dr. Sarah Chen — Family Medicine Physician, Cedar Family Medicine, 18–22 scheduled patients per day.**

Sarah runs a 9-hour clinic day with appointments every 20–30 minutes. Her patient panel is longitudinal — she's seen most of them multiple times across years. She uses OpenEMR for charting, scheduling, and prescriptions.

Her workflow between rooms:
1. Finish documenting the previous encounter (or flag it to finish later)
2. Walk to the next exam room — 30–90 seconds
3. Knock, enter, greet the patient, and immediately try to recall: who is this person, why are they here, and what do I need to know right now?

Step 3 is where she currently fails. The EHR is open on the wall-mounted screen but she needs to click through 4–6 screens — demographics, problem list, medications, last encounter notes, recent labs — to reconstruct context. By the time she's done, the patient has been watching her stare at a screen for 90 seconds instead of making eye contact.

**What she needs:** A single, conversational interface she can glance at before entering the room that tells her the relevant story about this patient, in plain language, right now. Not everything — what matters today.

**What she does NOT need:** Another dashboard, a sorted list of problems, or a better chart view. She has all of those. The problem is not access to data — it's synthesis under time pressure.

---

## Why a Conversational Agent, Not a Dashboard

A dashboard shows everything equally. It doesn't know which visit is today's, which medication changed last month, or that the patient's chief complaint is the same thing they came in for three visits ago without resolution. A dashboard requires Sarah to know what to look for before she looks.

A conversational agent inverts this. Sarah asks what she needs — or the agent proactively surfaces the one thing that changed since the last visit. When she has a follow-up question, she asks it without navigating to a new screen. When she's not sure what she's looking for, the agent can surface patterns she wouldn't have thought to search for.

The 90-second window is the constraint that makes the agent shape correct. There isn't time to navigate, filter, and synthesize. There is time to read two paragraphs and ask one follow-up question.

---

## Interaction Model

### 90 Seconds Is a Hard Constraint

The time between finishing one encounter note and knocking on the next door is 30–90 seconds. The agent interaction must fit entirely within that window — including opening the panel, triggering a query, waiting for the response, reading it, and optionally asking one follow-up. This is not a soft performance target. It is the constraint that determines every design decision: response length, streaming behavior, UI affordances, and follow-up handling.

A rough budget assuming the worst case (90 seconds total):

| Step | Budget |
|------|--------|
| Open panel, tap prompt | 5s |
| Server: tool calls + LLM response (streaming starts) | 3–5s to first token |
| Physician reads response | 20–30s |
| Tap follow-up suggestion | 3s |
| Server: follow-up response (streaming) | 3–5s to first token |
| Physician reads follow-up | 20–30s |
| **Total** | **~90s** |

There is no time left for the physician to type. The model assumes: **one default prompt, one optional follow-up selected from suggestions, done.**

### Prompt Affordances — No Typing Required

When the physician opens the co-pilot panel, a set of pre-built prompt buttons are immediately visible — no cursor, no keyboard. The default for between-room use is always:

> **"Brief me on my next patient"**

Other available defaults at panel open:
- "What do I need to know about today's schedule?"
- "Who is my next patient?" *(lighter-weight version of the brief)*

These cover UC-1 and UC-5 without any typing. Tapping one fires the query immediately.

### Typeahead — Complete the Clinical Question, Not the Sentence

For mid-encounter queries where the physician has a specific subject in mind (a drug, a lab test, a symptom), the input field supports typeahead. The physician types the noun; the UI suggests the clinical question around it.

Examples:
- Type `aspirin` → suggest **"Is aspirin compatible with [patient]'s current medications?"**
- Type `A1C` → suggest **"Show me [patient]'s A1C trend"**
- Type `metformin` → suggest **"What is [patient]'s current metformin dosage?"**
- Type `last visit` → suggest **"When was [patient]'s last visit and why did they come in?"**

The `[patient]` slot is filled automatically from whoever is currently in context (the patient whose chart is open, or the next scheduled patient). The physician never types the patient's name.

This covers UC-2 and similar mid-encounter queries without requiring the physician to formulate a full sentence under time pressure. Typing two to five characters and tapping a suggestion is faster and less error-prone than composing a question from scratch.

### Contextual Follow-Up Suggestions

After the initial response renders, the agent surfaces 2–3 follow-up prompts based on what it just said. These are generated as part of the same server response — they are ready the moment the physician finishes reading, not generated on demand.

Examples of contextual follow-ups after a patient brief:
- "Show me Phil's full A1C trend" *(if A1C was mentioned)*
- "What medications is he currently on?" *(if meds were referenced)*
- "When was his last visit?" *(if the visit gap was flagged)*

The physician taps one. There is no expectation of a third turn within the 90-second window.

### What This Means for Architecture

- Follow-up suggestions must be generated concurrently with the primary response, not after it — the agent includes them in the streamed payload.
- Response length is constrained to what a physician can read in 20–30 seconds: 3–5 sentences for a patient brief, 1–2 sentences for a follow-up answer.
- The panel must be openable and interactive within 1–2 seconds of invocation — no loading states that eat into the window.

---

## Use Cases

### UC-1: Pre-Encounter Brief

**Scenario:** Sarah has 90 seconds before entering the next room. She opens the agent and asks: "Brief me on my next patient."

**What the agent does:**
- Identifies the next scheduled appointment from OpenEMR's calendar
- Retrieves the patient's active problems, current medications, most recent encounter note and vitals, and any recent lab results
- Synthesizes a 3–5 sentence brief: who they are, why they're here today, what changed since the last visit, and anything flagged as needing attention

**Example output:**
> "Phil Belford, 54M, here for a follow-up on hypertension management. At his last visit 6 weeks ago, his BP was 148/92 — he was started on lisinopril 10mg. He's also due for an A1C check; his last result 4 months ago was 7.4. No new medications or allergy records since last visit."

**Why agent > dashboard:** A dashboard shows Phil's full chart. The agent answers "what matters for this specific visit" — the delta since last time, today's reason for the visit, and what's pending. This requires synthesizing across encounter history, lab dates, and medication start dates simultaneously. A dashboard cannot do this without the physician doing the synthesis themselves.

**Data sources:** `form_encounter` (last visit notes), `prescriptions` (current meds, start dates), `procedure_result` (recent labs), `lists` (problems), `openemr_postcalendar_events` (today's appointment + reason)

---

### UC-2: Medication Question

**Scenario:** Mid-conversation with a patient, Sarah needs to prescribe something and wants to check for interactions with what the patient is already taking.

Sarah: "Susan is on metformin and lisinopril. Is there anything I should know before adding a low-dose aspirin?"

**What the agent does:**
- Pulls Susan's current medication list
- Identifies relevant interaction flags or clinical considerations for the proposed addition
- Responds with grounded, source-attributed information — either confirming what the record shows or flagging uncertainty

**Example output:**
> "Susan's current active medications are metformin 500mg BID and lisinopril 10mg QD, both recorded in her prescription history. Low-dose aspirin with this combination is generally well-tolerated — no interaction flags in her record. Note that her last renal function panel was 8 months ago; if you're concerned about NSAID risk, a recent eGFR would inform that."

**Why agent > dashboard:** This is a multi-source synthesis question asked mid-encounter, without navigating away from the patient. The physician needs the answer in the room, in 10 seconds, with attribution. A dashboard requires leaving the conversation, opening the medications tab, then separately checking interaction references. The agent collapses those steps and keeps the physician present with the patient.

**Data sources:** `prescriptions` (active medications), `procedure_result` (renal function labs), `lists` (allergies)

---

### UC-3: Returning Patient With a Long Gap

**Scenario:** A patient Sarah hasn't seen in 14 months is in the waiting room. Sarah has no memory of why they last came in.

Sarah: "What's the history with Wanda Moore? I haven't seen her in a while."

**What the agent does:**
- Retrieves all encounters sorted by date
- Summarizes the clinical trajectory: what issues have been addressed over time, what was unresolved, what medications have changed
- Highlights anything that was flagged for follow-up that hasn't happened

**Example output:**
> "Wanda Moore, 19F, last seen 14 months ago for anxiety and irregular periods. At that visit, she was referred to OB/GYN — no follow-up encounter recorded. She was prescribed sertraline 50mg; that prescription has no recorded end date. No labs on file in the past 18 months. Today's appointment reason is listed as 'medication check.'"

**Why agent > dashboard:** The problem is not finding the data — it's determining what the story is. Sarah doesn't know whether the OB/GYN referral was completed, whether the sertraline is still active, or why Wanda is here today. The agent reads the history and surfaces the thread: here's what was started, here's what was left unresolved. A dashboard shows the data; the agent tells the story.

**Data sources:** `form_encounter` (full encounter history + notes), `prescriptions` (medication history), `lists` (referrals, problems), `openemr_postcalendar_events` (today's reason for visit)

---

### UC-4: Lab Result in Context

**Scenario:** A lab result just came back. Sarah wants to know if it's an improvement or a cause for concern relative to this patient's history.

Sarah: "Phil's A1C just came back at 8.2. How does that compare to his trend?"

**What the agent does:**
- Retrieves all A1C results from Phil's lab history with dates
- Computes and states the trend: better, worse, or flat compared to previous values
- Notes the clinical context: what medications are active, when they were started

**Example output:**
> "Phil's A1C history: 7.4 (4 months ago), 7.8 (10 months ago), 8.1 (18 months ago). The new result of 8.2 continues an upward trend. He was started on metformin 500mg 6 months ago. The A1C at his next check post-metformin start was 7.4, which was an improvement — but the trend has been climbing since. No other diabetes medications are recorded."

**Why agent > dashboard:** A lab dashboard shows the latest result and maybe a graph. It doesn't tell you whether this value is meaningful given what medications were started and when. The agent answers the question the physician is actually asking: "is this patient getting better or worse, and what context matters?"

**Data sources:** `procedure_result` (lab history with dates), `prescriptions` (medication timeline), `lists` (diabetes problem entry)

---

### UC-5: Schedule Overview at Day Start

**Scenario:** Sarah arrives at 8:45 AM and has 10 minutes before her first patient. She wants a scan of her day — not a full brief on each patient, but flags for anything that needs attention.

Sarah: "What do I need to know about today's schedule?"

**What the agent does:**
- Loads all appointments for the day from the calendar
- For each patient, performs a lightweight scan: any overdue labs, any unresolved follow-ups, any medications that may need renewal
- Surfaces only the patients with something actionable — skips routine follow-ups with nothing flagged

**Example output:**
> "You have 19 patients today. Three need your attention before the visit:
> - Phil Belford (9:00 AM): A1C trending up; no medication adjustment in last 6 months
> - Susan Underwood (10:30 AM): Annual wellness — last mammogram referral 14 months ago, no follow-up recorded
> - New patient at 2:15 PM: No prior records in system"

**Why agent > dashboard:** The schedule view in OpenEMR shows appointments. It does not scan each patient's record and surface actionable gaps. This use case requires querying across 19 patient records in parallel, applying clinical heuristics, and surfacing only the ones that matter. A dashboard cannot do this without the physician clicking into each record. The agent does it in one query and one response.

**Data sources:** `openemr_postcalendar_events` (today's schedule), `procedure_result` (overdue labs), `prescriptions` (renewal dates), `form_encounter` (last visit dates, unresolved follow-ups)

---

## What the Agent Must Refuse to Do

Every capability boundary is as important as every capability. The agent must refuse to:

- **Answer generic clinical questions** ("What is the first-line treatment for hypertension?") — it is not a medical reference. It answers questions about *this patient's* data.
- **Make diagnostic conclusions** — it surfaces data; it does not diagnose. "His A1C is trending up" is within scope. "He has uncontrolled diabetes" is not.
- **Access records for patients not on today's schedule or not explicitly requested** — the agent does not browse the patient population.
- **Operate without an authenticated session** — every query is scoped to the logged-in physician and subject to their authorization level.
- **Produce responses it cannot source** — if the data doesn't exist in the record, the agent says so rather than inferring.
