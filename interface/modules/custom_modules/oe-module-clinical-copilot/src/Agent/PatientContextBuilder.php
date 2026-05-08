<?php

/**
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\ClinicalCopilot\Agent;

/**
 * Pure transformation of a PatientBriefTool result into the two shapes the
 * UI + LLM need:
 *
 *   - ``buildUserMessage`` returns the structured numbered-source registry
 *     and the user-message text that references it via ``[N]`` indexes.
 *     The LLM gets the message; PHP keeps the registry to render citations.
 *
 *   - ``buildSnapshot`` returns the patient-card payload the UI renders
 *     before any LLM tokens arrive.
 *
 * No I/O. No state. Construction is free; the class is final to keep the
 * transformations deterministic.
 */
final class PatientContextBuilder
{
    /**
     * @param array<string,mixed> $patientData
     * @return array{
     *   message: string,
     *   sources: array<string, array{
     *     type: string,
     *     label: string,
     *     fields: list<array{key: string, value: string}>,
     *     scroll_to: string
     *   }>
     * }
     */
    public function buildUserMessage(array $patientData): array
    {
        $sources = [];
        $lines   = [];
        $idx     = 1;

        $idx = $this->appendAppointment($patientData['today_appointment'] ?? null, $sources, $lines, $idx);
        $idx = $this->appendLastEncounter($patientData['last_encounter'] ?? null, $sources, $lines, $idx);
        $idx = $this->appendMedications($patientData['active_medications'] ?? [], $sources, $lines, $idx);
        $idx = $this->appendLabs($patientData['recent_labs'] ?? [], $sources, $lines, $idx);
        $idx = $this->appendProblems($patientData['problems'] ?? [], $sources, $lines, $idx);
        $idx = $this->appendAllergies($patientData['allergies'] ?? [], $sources, $lines, $idx);
        $idx = $this->appendDocuments($patientData['documents'] ?? [], $sources, $lines, $idx);

        $demo    = $patientData['demographics'];
        $name    = $demo['name'] ?? 'Unknown';
        $age     = $demo['age'] ?? '';
        $sex     = $demo['sex'] ?? '';
        $srcBlock = implode("\n", $lines);

        $message = <<<TEXT
Brief this patient. Cite source numbers inline using [[N]]phrase[[/N]] markers.

PATIENT: {$name}, {$age}y {$sex}

SOURCES:
{$srcBlock}
TEXT;

        return ['message' => $message, 'sources' => $sources];
    }

    /**
     * @param array<string,mixed> $patientData
     * @return array<string,mixed>
     */
    public function buildSnapshot(array $patientData): array
    {
        $demo = $patientData['demographics'];
        $appt = $patientData['today_appointment'];

        // Most recent result per test name. Dedup key strips punctuation and
        // case so "Cholesterol Total" and "Cholesterol, Total" collapse to one row.
        $labs = [];
        $seen = [];
        foreach (($patientData['recent_labs'] ?? []) as $lab) {
            $test = $lab['test'];
            $key  = strtolower((string) preg_replace('/[^a-z0-9]/i', '', $test));
            if ($key === '' || isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $labs[] = [
                'test'     => $test,
                'value'    => $lab['value'],
                'units'    => $lab['units'],
                'abnormal' => $lab['abnormal'] ?? '',
                'date'     => $lab['date_collected'] ?? '',
            ];
        }

        return [
            'patient' => [
                'name' => $demo['name'] ?? '',
                'age'  => $demo['age'] ?? '',
                'sex'  => $demo['sex'] ?? '',
                'dob'  => $demo['dob'] ?? '',
            ],
            'appointment' => $appt ? [
                'time'   => $appt['time'] ?? '',
                'reason' => $appt['reason'] ?? '',
            ] : null,
            'problems'    => $patientData['problems'] ?? [],
            'medications' => array_map(fn(array $m): array => [
                'drug'        => $m['drug'],
                'dosage'      => trim(($m['dosage'] ?? '') . ' ' . ($m['unit'] ?? '')),
                'note'        => $m['note'] ?? '',
                // Preserve provenance back-link so the snapshot card click →
                // SourceDrawer can render the bbox overlay on the source PDF.
                // Without this the snapshot dropped source_link silently.
                'source_link' => $m['source_link'] ?? null,
            ], $patientData['active_medications'] ?? []),
            'allergies' => $patientData['allergies'] ?? [],
            'labs'      => $labs,
            'documents' => $patientData['documents'] ?? [],
        ];
    }

    // ------------------------------------------------------------------
    // Section appenders — each adds one or more [N] entries and updates idx
    // ------------------------------------------------------------------

    /**
     * @param array<string,mixed>|null $appt
     * @param array<string, array<string,mixed>> $sources
     * @param list<string> $lines
     */
    private function appendAppointment(?array $appt, array &$sources, array &$lines, int $idx): int
    {
        $reason = $appt ? ($appt['reason'] ?: 'Not specified') : 'None on file';
        $sources[(string) $idx] = [
            'type'      => 'appointment',
            'label'     => "Today's appointment",
            'fields'    => $this->compactFields([
                ['key' => 'Date',   'value' => $appt['date'] ?? ''],
                ['key' => 'Time',   'value' => $appt['time'] ?? ''],
                ['key' => 'Reason', 'value' => $reason],
            ]),
            'scroll_to' => '#appointments_ps_expand',
        ];
        $lines[] = "[{$idx}] Today's appointment: {$reason}";
        return $idx + 1;
    }

    /**
     * @param array<string,mixed>|null $enc
     * @param array<string, array<string,mixed>> $sources
     * @param list<string> $lines
     */
    private function appendLastEncounter(?array $enc, array &$sources, array &$lines, int $idx): int
    {
        if ($enc === null) {
            $sources[(string) $idx] = [
                'type'      => 'encounter',
                'label'     => 'Last encounter',
                'fields'    => [['key' => 'Note', 'value' => 'No prior encounters on file']],
                'scroll_to' => '',
            ];
            $lines[] = "[{$idx}] Last encounter: none";
            return $idx + 1;
        }

        $encDate    = $enc['date'] ?? 'unknown';
        $soap       = $enc['soap'] ?? [];
        $assessment = trim($soap['assessment'] ?? '');
        $plan       = trim($soap['plan'] ?? '');
        $subjective = trim($soap['subjective'] ?? '');

        $sources[(string) $idx] = [
            'type'      => 'encounter',
            'label'     => "Encounter {$encDate}",
            'fields'    => $this->compactFields([
                ['key' => 'Date',        'value' => $encDate],
                ['key' => 'Reason',      'value' => $enc['reason'] ?? ''],
                ['key' => 'Subjective',  'value' => $subjective],
                ['key' => 'Assessment',  'value' => $assessment],
                ['key' => 'Plan',        'value' => $plan],
            ]),
            'scroll_to' => '#appointments_ps_expand',
        ];
        $lines[] = "[{$idx}] Last encounter ({$encDate}): " . ($assessment ?: 'No assessment');
        return $idx + 1;
    }

    /**
     * @param list<array<string,mixed>> $meds
     * @param array<string, array<string,mixed>> $sources
     * @param list<string> $lines
     */
    private function appendMedications(array $meds, array &$sources, array &$lines, int $idx): int
    {
        if (empty($meds)) {
            $sources[(string) $idx] = [
                'type'      => 'medication',
                'label'     => 'Active medications',
                'fields'    => [['key' => 'Note', 'value' => 'None documented']],
                'scroll_to' => '#prescriptions_ps_expand',
            ];
            $lines[] = "[{$idx}] Medications: none documented";
            return $idx + 1;
        }

        foreach ($meds as $med) {
            $label = trim("{$med['drug']} {$med['dosage']} {$med['unit']}");
            $sources[(string) $idx] = $this->withSourceLink([
                'type'      => 'medication',
                'label'     => $label,
                'fields'    => $this->compactFields([
                    ['key' => 'Drug',      'value' => $med['drug'] ?? ''],
                    ['key' => 'Dose',      'value' => trim(($med['dosage'] ?? '') . ' ' . ($med['unit'] ?? ''))],
                    ['key' => 'Route',     'value' => $med['route'] ?? ''],
                    ['key' => 'Frequency', 'value' => $med['interval'] ?? ''],
                    ['key' => 'Notes',     'value' => $med['note'] ?? ''],
                ]),
                'scroll_to' => '#prescriptions_ps_expand',
            ], $med['source_link'] ?? null);
            $lines[] = "[{$idx}] Medication: {$label}" . ($med['interval'] ? " ({$med['interval']})" : '');
            $idx++;
        }
        return $idx;
    }

    /**
     * @param list<array<string,mixed>> $labs
     * @param array<string, array<string,mixed>> $sources
     * @param list<string> $lines
     */
    private function appendLabs(array $labs, array &$sources, array &$lines, int $idx): int
    {
        if (empty($labs)) {
            $sources[(string) $idx] = [
                'type'      => 'lab',
                'label'     => 'Recent labs',
                'fields'    => [['key' => 'Note', 'value' => 'None on file']],
                'scroll_to' => '#labdata_ps_expand',
            ];
            $lines[] = "[{$idx}] Labs: none on file";
            return $idx + 1;
        }

        foreach ($labs as $lab) {
            $result = trim(($lab['value'] ?? '') . ' ' . ($lab['units'] ?? ''));
            $status = $lab['abnormal'] ? "ABNORMAL ({$lab['abnormal']})" : 'Within range';
            $label  = "{$lab['test']}: {$result}";
            $sources[(string) $idx] = [
                'type'     => 'lab',
                'label'    => $label,
                'fields'   => $this->compactFields([
                    ['key' => 'Test',      'value' => $lab['test'] ?? ''],
                    ['key' => 'Result',    'value' => $result],
                    ['key' => 'Reference', 'value' => $lab['range'] ?? ''],
                    ['key' => 'Status',    'value' => $status],
                    ['key' => 'Collected', 'value' => $lab['date_collected'] ?? ''],
                ]),
                'scroll_to' => '#labdata_ps_expand',
            ];
            $flag    = $lab['abnormal'] ? " [ABNORMAL: {$lab['abnormal']}]" : '';
            $lines[] = "[{$idx}] Lab: {$label}{$flag}" . ($lab['date_collected'] ? " — {$lab['date_collected']}" : '');
            $idx++;
        }
        return $idx;
    }

    /**
     * @param list<array<string,mixed>> $problems
     * @param array<string, array<string,mixed>> $sources
     * @param list<string> $lines
     */
    private function appendProblems(array $problems, array &$sources, array &$lines, int $idx): int
    {
        if (empty($problems)) {
            $sources[(string) $idx] = [
                'type'      => 'problem',
                'label'     => 'Active problems',
                'fields'    => [['key' => 'Note', 'value' => 'None documented']],
                'scroll_to' => '#medical_problem_ps_expand',
            ];
            $lines[] = "[{$idx}] Problems: none documented";
            return $idx + 1;
        }

        foreach ($problems as $prob) {
            $label = $prob['title'] . ($prob['icd10'] ? " ({$prob['icd10']})" : '');
            $sources[(string) $idx] = $this->withSourceLink([
                'type'      => 'problem',
                'label'     => $prob['title'],
                'fields'    => $this->compactFields([
                    ['key' => 'Diagnosis', 'value' => $prob['title']],
                    ['key' => 'ICD-10',    'value' => $prob['icd10']],
                    ['key' => 'Since',     'value' => $prob['since']],
                ]),
                'scroll_to' => '#medical_problem_ps_expand',
            ], $prob['source_link'] ?? null);
            $lines[] = "[{$idx}] Problem: {$label}";
            $idx++;
        }
        return $idx;
    }

    /**
     * @param list<array<string,mixed>> $allergies
     * @param array<string, array<string,mixed>> $sources
     * @param list<string> $lines
     */
    private function appendAllergies(array $allergies, array &$sources, array &$lines, int $idx): int
    {
        if (empty($allergies)) {
            $sources[(string) $idx] = [
                'type'      => 'allergy',
                'label'     => 'Allergies',
                'fields'    => [['key' => 'Note', 'value' => 'None documented']],
                'scroll_to' => '#allergy_ps_expand',
            ];
            $lines[] = "[{$idx}] Allergies: none documented";
            return $idx + 1;
        }

        foreach ($allergies as $allergy) {
            $sources[(string) $idx] = $this->withSourceLink([
                'type'      => 'allergy',
                'label'     => $allergy['title'],
                'fields'    => $this->compactFields([
                    ['key' => 'Allergen', 'value' => $allergy['title']],
                    ['key' => 'Reaction', 'value' => $allergy['reaction'] ?? ''],
                    ['key' => 'Severity', 'value' => $allergy['severity'] ?? ''],
                ]),
                'scroll_to' => '#allergy_ps_expand',
            ], $allergy['source_link'] ?? null);
            $lines[] = "[{$idx}] Allergy: {$allergy['title']}"
                . (!empty($allergy['reaction']) ? " → {$allergy['reaction']}" : '');
            $idx++;
        }
        return $idx;
    }

    /**
     * Attach a source_link + openemr_doc_id to an entry when the underlying
     * chart row has provenance back to a source intake/lab document. The
     * UI's source drawer keys off both — `openemr_doc_id` to build the
     * `/agent-page.php` image URL, `source_link.bbox` to draw the overlay.
     *
     * @param array<string,mixed>      $entry
     * @param array<string,mixed>|null $link
     * @return array<string,mixed>
     */
    private function withSourceLink(array $entry, ?array $link): array
    {
        if (!is_array($link) || empty($link['doc_id'])) {
            return $entry;
        }
        $entry['source_link']    = $link;
        $entry['openemr_doc_id'] = (int) $link['doc_id'];
        return $entry;
    }

    /**
     * @param list<array<string,mixed>> $documents
     * @param array<string,mixed> $sources
     * @param list<string> $lines
     */
    private function appendDocuments(array $documents, array &$sources, array &$lines, int $idx): int
    {
        foreach ($documents as $doc) {
            $name = (string) ($doc['name'] ?? 'Document');
            $date = (string) ($doc['date'] ?? '');
            $docId = (int) ($doc['id'] ?? 0);

            // Each document line in the LLM prompt needs a matching entry
            // in $sources, otherwise the LLM cites [[N]] and the UI renders
            // a clickable button that lookups undefined and does nothing.
            $sources[(string) $idx] = [
                'type'   => 'document',
                'label'  => $name,
                'fields' => $this->compactFields([
                    ['key' => 'Filename', 'value' => $name],
                    ['key' => 'Date',     'value' => $date],
                ]),
                'openemr_doc_id' => $docId > 0 ? $docId : null,
            ];

            $lines[] = "[{$idx}] Document on file: {$name}"
                . ($date !== '' ? " ({$date})" : '');
            $idx++;
        }
        return $idx;
    }

    /**
     * Drop entries whose value is blank — keeps the LLM prompt and the UI source card tidy.
     *
     * @param list<array{key: string, value: string}> $fields
     * @return list<array{key: string, value: string}>
     */
    private function compactFields(array $fields): array
    {
        return array_values(
            array_filter($fields, fn(array $f): bool => trim($f['value']) !== '')
        );
    }
}
