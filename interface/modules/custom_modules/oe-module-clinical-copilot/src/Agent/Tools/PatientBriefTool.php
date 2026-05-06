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
     * Today first; otherwise the next appointment within the horizon.
     *
     * Named "today_appointment" in the public API for backwards-compatibility,
     * but the lookup window is wider — useful when the physician opens a chart
     * a few days before the visit.
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
            'SELECT id, drug, dosage, quantity, unit, route, `interval`, `note`
             FROM prescriptions
             WHERE patient_id = ? AND active = 1
             ORDER BY drug ASC LIMIT ' . self::MAX_ACTIVE_MEDS,
            [$patientId]
        );
        return array_map(static fn(array $row): array => [
            'id'       => (int) $row['id'],
            'drug'     => $row['drug'] ?? '',
            'dosage'   => $row['dosage'] ?? '',
            'unit'     => $row['unit'] ?? '',
            'route'    => $row['route'] ?? '',
            'interval' => $row['interval'] ?? '',
            'note'     => $row['note'] ?? '',
        ], $rows);
    }

    /** @return list<array<string,mixed>> */
    private function fetchAllergies(int $patientId): array
    {
        $rows = QueryUtils::fetchRecords(
            "SELECT title, extrainfo, comments
             FROM lists
             WHERE pid = ? AND type = 'allergy' AND activity = 1
             ORDER BY title ASC",
            [$patientId]
        );
        return array_map(static fn(array $row): array => [
            'title'    => $row['title'] ?? '',
            'reaction' => $row['extrainfo'] ?? '',
            'severity' => $row['comments'] ?? '',
        ], $rows);
    }

    /** @return list<array<string,mixed>> */
    private function fetchProblems(int $patientId): array
    {
        $rows = QueryUtils::fetchRecords(
            "SELECT title, diagnosis, begdate
             FROM lists
             WHERE pid = ? AND type = 'medical_problem' AND activity = 1
             ORDER BY title ASC",
            [$patientId]
        );
        return array_map(static fn(array $row): array => [
            'title' => $row['title'] ?? '',
            'icd10' => $row['diagnosis'] ?? '',
            'since' => $row['begdate'] ?? '',
        ], $rows);
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
