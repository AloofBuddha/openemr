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

class PatientBriefTool
{
    // Frozen for demo — keeps "today's appointments" stable regardless of calendar date
    private const DEMO_DATE = '2026-04-29';

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
     *   data_hash: string
     * }
     */
    public function gather(int $patientId, int $physicianId): array
    {
        $demographics = $this->fetchDemographics($patientId);
        $appointment  = $this->fetchTodayAppointment($patientId, $physicianId);
        $encounter    = $this->fetchLastEncounter($patientId);
        $medications  = $this->fetchActiveMedications($patientId);
        $labs         = $this->fetchRecentLabs($patientId);

        $data = compact('demographics', 'appointment', 'encounter', 'medications', 'labs');
        $dataHash = hash('sha256', json_encode($data) ?: '');

        return [
            'demographics'       => $demographics,
            'today_appointment'  => $appointment,
            'last_encounter'     => $encounter,
            'active_medications' => $medications,
            'recent_labs'        => $labs,
            'data_hash'          => $dataHash,
        ];
    }

    private function fetchDemographics(int $patientId): array
    {
        $row = sqlQuery(
            "SELECT pid, fname, lname, DOB, sex, phone_cell, phone_home,
                    street, city, state
             FROM patient_data WHERE pid = ? LIMIT 1",
            [$patientId]
        );
        if (empty($row)) {
            return [];
        }
        $dob = $row['DOB'] ?? '';
        $age = '';
        if ($dob) {
            try {
                $dobDate  = new \DateTimeImmutable($dob);
                $now      = new \DateTimeImmutable();
                $age      = (string) $dobDate->diff($now)->y;
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

    private function fetchTodayAppointment(int $patientId, int $physicianId): ?array
    {
        $row = sqlQuery(
            "SELECT pc_eid, pc_eventDate, pc_startTime, pc_title, pc_hometext
             FROM openemr_postcalendar_events
             WHERE pc_pid = ? AND pc_aid = ? AND pc_eventDate = ?
             ORDER BY pc_startTime ASC LIMIT 1",
            [$patientId, $physicianId, self::DEMO_DATE]
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

    private function fetchLastEncounter(int $patientId): ?array
    {
        $row = sqlQuery(
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
                'subjective'  => $row['subjective'] ?? '',
                'objective'   => $row['objective'] ?? '',
                'assessment'  => $row['assessment'] ?? '',
                'plan'        => $row['plan'] ?? '',
            ],
        ];
    }

    private function fetchActiveMedications(int $patientId): array
    {
        $results = sqlStatement(
            "SELECT id, drug, dosage, quantity, unit, route, `interval`, `note`
             FROM prescriptions
             WHERE patient_id = ? AND active = 1
             ORDER BY drug ASC",
            [$patientId]
        );
        $meds = [];
        while ($row = sqlFetchArray($results)) {
            $meds[] = [
                'id'       => (int) $row['id'],
                'drug'     => $row['drug'] ?? '',
                'dosage'   => $row['dosage'] ?? '',
                'unit'     => $row['unit'] ?? '',
                'route'    => $row['route'] ?? '',
                'interval' => $row['interval'] ?? '',
                'note'     => $row['note'] ?? '',
            ];
        }
        return $meds;
    }

    private function fetchRecentLabs(int $patientId): array
    {
        $results = sqlStatement(
            "SELECT pr.result_code, pr.result_text, pr.result, pr.units,
                    pr.range, pr.abnormal, prep.date_collected
             FROM procedure_result pr
             JOIN procedure_report prep ON prep.procedure_report_id = pr.procedure_report_id
             JOIN procedure_order po ON po.procedure_order_id = prep.procedure_order_id
             WHERE po.patient_id = ? AND prep.date_collected IS NOT NULL
             ORDER BY prep.date_collected DESC LIMIT 20",
            [$patientId]
        );
        $labs = [];
        while ($row = sqlFetchArray($results)) {
            $labs[] = [
                'test'          => $row['result_text'] ?: ($row['result_code'] ?? ''),
                'value'         => $row['result'] ?? '',
                'units'         => $row['units'] ?? '',
                'range'         => $row['range'] ?? '',
                'abnormal'      => $row['abnormal'] ?? '',
                'date_collected' => $row['date_collected'] ?? '',
            ];
        }
        return $labs;
    }
}
