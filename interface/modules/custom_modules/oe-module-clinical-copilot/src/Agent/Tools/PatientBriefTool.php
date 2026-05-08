<?php

/**
 * Gathers all data needed for a UC-1 pre-encounter brief.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\ClinicalCopilot\Agent\Tools;

use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Modules\ClinicalCopilot\Authorization\PatientAccessGuard;

/**
 * Pure data-gathering tool: assembles a structured patient snapshot for the
 * orchestrator. No side effects beyond reads. Calls the access guard up
 * front (defence-in-depth — public endpoints check too).
 */
final class PatientBriefTool
{
    private const MAX_ACTIVE_MEDS  = 25;
    private const MAX_RECENT_LABS  = 20;
    private const MAX_DOCUMENTS    = 10;
    private const APPT_HORIZON_DAYS = 60;
    private const APPT_RECENT_PAST_DAYS = 7;

    public function __construct(private readonly PatientAccessGuard $accessGuard)
    {
    }

    /**
     * Returns structured patient context for LLM consumption.
     * All fields are sourced from OpenEMR tables; no PHI is fabricated.
     *
     * @return array{
     *   demographics: array<string,mixed>,
     *   today_appointment: array<string,mixed>|null,
     *   last_encounter: array<string,mixed>|null,
     *   active_medications: list<array<string,mixed>>,
     *   recent_labs: list<array<string,mixed>>,
     *   allergies: list<array<string,mixed>>,
     *   problems: list<array<string,mixed>>,
     *   documents: list<array<string,mixed>>
     * }
     */
    public function gather(int $patientId, int $physicianId): array
    {
        $this->accessGuard->assertAccess($physicianId, $patientId);

        return [
            'demographics'       => $this->fetchDemographics($patientId),
            'today_appointment'  => $this->fetchUpcomingAppointment($patientId),
            'last_encounter'     => $this->fetchLastEncounter($patientId),
            'active_medications' => $this->fetchActiveMedications($patientId),
            'recent_labs'        => $this->fetchRecentLabs($patientId),
            'allergies'          => $this->fetchAllergies($patientId),
            'problems'           => $this->fetchProblems($patientId),
            'documents'          => $this->fetchDocuments($patientId),
        ];
    }

    /** @return array<string,mixed> */
    private function fetchDemographics(int $patientId): array
    {
        $row = QueryUtils::querySingleRow(
            'SELECT pid, fname, lname, DOB, sex, phone_cell, phone_home,
                    street, city, state
             FROM patient_data WHERE pid = ? LIMIT 1',
            [$patientId]
        );
        if (empty($row)) {
            return [];
        }
        $dob = $row['DOB'] ?? '';
        $age = '';
        if ($dob) {
            try {
                $age = (string) (new \DateTimeImmutable($dob))->diff(new \DateTimeImmutable())->y;
            } catch (\Throwable) {
                $age = '';
            }
        }
        return [
            'pid'   => (int) $row['pid'],
            'name'  => trim(($row['fname'] ?? '') . ' ' . ($row['lname'] ?? '')),
            'dob'   => $dob,
            'age'   => $age,
            'sex'   => $row['sex'] ?? '',
            'phone' => $row['phone_cell'] ?: ($row['phone_home'] ?? ''),
        ];
    }

    /**
     * Pick today's visit, the next upcoming, or — as a fallback — the most
     * recent past appointment within APPT_RECENT_PAST_DAYS.
     *
     * Named "today_appointment" in the public API for backwards-compatibility.
     * The recent-past fallback exists because demo data dates drift; without
     * it, every Margaret demo run after the seed date breaks silently. The
     * brief still flags stale visits via the >6-month rule on last_encounter,
     * so this fallback never hides clinically relevant gaps.
     *
     * @return array<string,mixed>|null
     */
    private function fetchUpcomingAppointment(int $patientId): ?array
    {
        $today   = date('Y-m-d');
        $horizon = date('Y-m-d', strtotime('+' . self::APPT_HORIZON_DAYS . ' days'));

        $row = QueryUtils::querySingleRow(
            'SELECT pc_eid, pc_eventDate, pc_startTime, pc_title, pc_hometext
             FROM openemr_postcalendar_events
             WHERE pc_pid = ? AND pc_eventDate >= ? AND pc_eventDate <= ?
             ORDER BY pc_eventDate ASC, pc_startTime ASC LIMIT 1',
            [$patientId, $today, $horizon]
        );

        if (empty($row)) {
            // Fall back to the most recent past appointment so demo data
            // with a fixed event date still surfaces as the visit reason.
            $recent = date('Y-m-d', strtotime('-' . self::APPT_RECENT_PAST_DAYS . ' days'));
            $row = QueryUtils::querySingleRow(
                'SELECT pc_eid, pc_eventDate, pc_startTime, pc_title, pc_hometext
                 FROM openemr_postcalendar_events
                 WHERE pc_pid = ? AND pc_eventDate < ? AND pc_eventDate >= ?
                 ORDER BY pc_eventDate DESC, pc_startTime DESC LIMIT 1',
                [$patientId, $today, $recent]
            );
        }

        if (empty($row)) {
            return null;
        }
        return [
            'appointment_id' => (int) $row['pc_eid'],
            'date'           => $row['pc_eventDate'] ?? '',
            'time'           => $row['pc_startTime'] ?? '',
            'reason'         => $row['pc_hometext'] ?: ($row['pc_title'] ?? ''),
        ];
    }

    /** @return array<string,mixed>|null */
    private function fetchLastEncounter(int $patientId): ?array
    {
        $row = QueryUtils::querySingleRow(
            "SELECT fe.encounter, fe.date, fe.reason,
                    fs.subjective, fs.objective, fs.assessment, fs.plan
             FROM form_encounter fe
             LEFT JOIN forms f  ON f.encounter = fe.encounter AND f.pid = fe.pid AND f.formdir = 'soap'
             LEFT JOIN form_soap fs ON fs.id = f.form_id
             WHERE fe.pid = ?
             ORDER BY fe.date DESC LIMIT 1",
            [$patientId]
        );
        if (empty($row)) {
            return null;
        }
        return [
            'encounter_id' => (int) $row['encounter'],
            'date'         => $row['date'] ?? '',
            'reason'       => $row['reason'] ?? '',
            'soap'         => [
                'subjective' => $row['subjective'] ?? '',
                'objective'  => $row['objective'] ?? '',
                'assessment' => $row['assessment'] ?? '',
                'plan'       => $row['plan'] ?? '',
            ],
        ];
    }

    /** @return list<array<string,mixed>> */
    private function fetchActiveMedications(int $patientId): array
    {
        $rows = QueryUtils::fetchRecords(
            'SELECT p.id, p.drug, p.dosage, p.quantity, p.unit, p.route, p.`interval`, p.`note`,
                    sl.source_doc_id, sl.page_num, sl.x0, sl.y0, sl.x1, sl.y1,
                    sl.page_width, sl.page_height, sl.quote
             FROM prescriptions p
             LEFT JOIN copilot_source_links sl
               ON sl.record_type = "medication" AND sl.record_id = p.id
             WHERE p.patient_id = ? AND p.active = 1
             ORDER BY p.drug ASC LIMIT ' . self::MAX_ACTIVE_MEDS,
            [$patientId]
        );
        return array_map(function (array $row): array {
            $current = trim(($row['drug'] ?? '') . ' ' . ($row['dosage'] ?? ''));
            return [
                'id'          => (int) $row['id'],
                'drug'        => $row['drug'] ?? '',
                'dosage'      => $row['dosage'] ?? '',
                'unit'        => $row['unit'] ?? '',
                'route'       => $row['route'] ?? '',
                'interval'    => $row['interval'] ?? '',
                'note'        => $row['note'] ?? '',
                'source_link' => $this->buildSourceLink($row, $current),
            ];
        }, $rows);
    }

    /** @return list<array<string,mixed>> */
    private function fetchAllergies(int $patientId): array
    {
        $rows = QueryUtils::fetchRecords(
            "SELECT l.id, l.title, l.extrainfo, l.comments,
                    sl.source_doc_id, sl.page_num, sl.x0, sl.y0, sl.x1, sl.y1,
                    sl.page_width, sl.page_height, sl.quote
             FROM lists l
             LEFT JOIN copilot_source_links sl
               ON sl.record_type = 'allergy' AND sl.record_id = l.id
             WHERE l.pid = ? AND l.type = 'allergy' AND l.activity = 1
             ORDER BY l.title ASC",
            [$patientId]
        );
        return array_map(function (array $row): array {
            return [
                'title'       => $row['title'] ?? '',
                'reaction'    => $row['extrainfo'] ?? '',
                'severity'    => $row['comments'] ?? '',
                'source_link' => $this->buildSourceLink($row, (string) ($row['title'] ?? '')),
            ];
        }, $rows);
    }

    /** @return list<array<string,mixed>> */
    private function fetchProblems(int $patientId): array
    {
        $rows = QueryUtils::fetchRecords(
            "SELECT l.id, l.title, l.diagnosis, l.begdate,
                    sl.source_doc_id, sl.page_num, sl.x0, sl.y0, sl.x1, sl.y1,
                    sl.page_width, sl.page_height, sl.quote
             FROM lists l
             LEFT JOIN copilot_source_links sl
               ON sl.record_type = 'medical_problem' AND sl.record_id = l.id
             WHERE l.pid = ? AND l.type = 'medical_problem' AND l.activity = 1
             ORDER BY l.title ASC",
            [$patientId]
        );
        return array_map(function (array $row): array {
            return [
                'title'       => $row['title'] ?? '',
                'icd10'       => $row['diagnosis'] ?? '',
                'since'       => $row['begdate'] ?? '',
                'source_link' => $this->buildSourceLink($row, (string) ($row['title'] ?? '')),
            ];
        }, $rows);
    }

    /**
     * Build a source-link sub-array from a JOINed row, dropping silently
     * when the chart's current value no longer matches the extracted quote.
     *
     * Per the demo UX contract: we only link back to a document when it
     * remains the source of truth. If a clinician has edited the value
     * since extraction, the link is hidden — "no document source on file"
     * is the honest answer once the chart has diverged.
     *
     * @param array<string,mixed> $row     JOINed row from prescriptions/lists with sl.* columns
     * @param string              $current Best-effort current chart value to compare against the stored quote
     */
    private function buildSourceLink(array $row, string $current): ?array
    {
        $docId = (int) ($row['source_doc_id'] ?? 0);
        if ($docId <= 0) {
            return null;
        }
        $quote = (string) ($row['quote'] ?? '');
        // Drop the link silently only when the chart's current value
        // diverges from the source enough that the link would mislead.
        // We anchor on the first meaningful word (drug name / allergen /
        // condition) since dosage formatting routinely differs between
        // the verbatim quote and OpenEMR's canonical fields ("Atorvastatin
        // 20 mg PO at bedtime" vs "Atorvastatin 20 mg at bedtime"), but
        // a name change ("Atorvastatin" → "Rosuvastatin") is a real edit.
        if ($quote !== '' && $current !== '') {
            $firstWord = static function (string $s): string {
                $s = strtolower(trim(preg_replace('/[^\w\s]/u', ' ', $s) ?? ''));
                $tokens = preg_split('/\s+/', $s, 2) ?: [''];
                return $tokens[0];
            };
            $a = $firstWord($current);
            $b = $firstWord($quote);
            if ($a !== '' && $b !== '' && $a !== $b
                    && !str_contains($a, $b) && !str_contains($b, $a)) {
                return null;
            }
        }
        $link = [
            'doc_id' => $docId,
            'page'   => (int) ($row['page_num'] ?? 1),
            'quote'  => $quote,
        ];
        if ($row['x0'] !== null && $row['x1'] !== null) {
            $link['bbox'] = [
                'page'        => (int) ($row['page_num'] ?? 1),
                'x0'          => (float) $row['x0'],
                'y0'          => (float) $row['y0'],
                'x1'          => (float) $row['x1'],
                'y1'          => (float) $row['y1'],
                'page_width'  => (float) $row['page_width'],
                'page_height' => (float) $row['page_height'],
            ];
        }
        return $link;
    }

    /** @return list<array<string,mixed>> */
    private function fetchDocuments(int $patientId): array
    {
        $rows = QueryUtils::fetchRecords(
            'SELECT id, name, date FROM documents
             WHERE foreign_id = ? AND deleted = 0
             ORDER BY date DESC LIMIT ' . self::MAX_DOCUMENTS,
            [$patientId]
        );
        return array_map(static fn(array $row): array => [
            'id'   => (int) $row['id'],
            'name' => $row['name'] ?? 'Untitled',
            'date' => $row['date'] ?? '',
        ], $rows);
    }

    /** @return list<array<string,mixed>> */
    private function fetchRecentLabs(int $patientId): array
    {
        $rows = QueryUtils::fetchRecords(
            'SELECT pr.result_code, pr.result_text, pr.result, pr.units,
                    pr.range, pr.abnormal, prep.date_collected
             FROM procedure_result pr
             JOIN procedure_report prep ON prep.procedure_report_id = pr.procedure_report_id
             JOIN procedure_order po ON po.procedure_order_id = prep.procedure_order_id
             WHERE po.patient_id = ? AND prep.date_collected IS NOT NULL
             ORDER BY prep.date_collected DESC LIMIT ' . self::MAX_RECENT_LABS,
            [$patientId]
        );
        return array_map(static fn(array $row): array => [
            'test'           => $row['result_text'] ?: ($row['result_code'] ?? ''),
            'value'          => $row['result'] ?? '',
            'units'          => $row['units'] ?? '',
            'range'          => $row['range'] ?? '',
            'abnormal'       => $row['abnormal'] ?? '',
            'date_collected' => $row['date_collected'] ?? '',
        ], $rows);
    }
}
