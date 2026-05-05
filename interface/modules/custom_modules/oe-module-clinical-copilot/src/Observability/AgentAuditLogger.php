<?php

/**
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\ClinicalCopilot\Observability;

class AgentAuditLogger
{
    /**
     * @param list<array{name:string,duration_ms:int,success:bool,result_size:int}> $toolsCalled
     */
    public function log(
        int $physicianId,
        int $patientId,
        string $queryText,
        array $toolsCalled,
        string $model,
        int $inputTokens,
        int $outputTokens,
        int $totalMs,
        bool $verified,
        int $flaggedClaims = 0
    ): void {
        $sessionId = session_id() ?: '';
        sqlStatement(
            "INSERT INTO copilot_audit_log
                (session_id, physician_id, patient_uuid, query_text, tools_called,
                 llm_model, input_tokens, output_tokens, total_ms, verified,
                 flagged_claims, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())",
            [
                $sessionId,
                $physicianId,
                $this->resolvePatientUuid($patientId),
                $queryText,
                json_encode($toolsCalled),
                $model,
                $inputTokens,
                $outputTokens,
                $totalMs,
                (int) $verified,
                $flaggedClaims,
            ]
        );
    }

    public function logDenied(int $physicianId, int $patientId, string $context): void
    {
        $sessionId = session_id() ?: '';
        sqlStatement(
            "INSERT INTO copilot_audit_log
                (session_id, physician_id, patient_uuid, query_text, tools_called,
                 llm_model, input_tokens, output_tokens, total_ms, verified,
                 flagged_claims, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())",
            [
                $sessionId,
                $physicianId,
                $this->resolvePatientUuid($patientId),
                "AUTH_DENIED:{$context}",
                '[]',
                '',
                0,
                0,
                0,
                0,
                0,
            ]
        );
    }

    public function logUpload(int $physicianId, int $patientId, int $docId, string $filename, int $totalMs): void
    {
        $sessionId = session_id() ?: '';
        sqlStatement(
            "INSERT INTO copilot_audit_log
                (session_id, physician_id, patient_uuid, query_text, tools_called,
                 llm_model, input_tokens, output_tokens, total_ms, verified,
                 flagged_claims, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())",
            [
                $sessionId,
                $physicianId,
                $this->resolvePatientUuid($patientId),
                "DOCUMENT_UPLOAD:doc_id={$docId};name={$filename}",
                '[]',
                '',
                0,
                0,
                $totalMs,
                1,
                0,
            ]
        );
    }

    private function resolvePatientUuid(int $patientId): string
    {
        $row = sqlQuery(
            "SELECT uuid FROM patient_data WHERE pid = ? LIMIT 1",
            [$patientId]
        );
        if (!empty($row['uuid'])) {
            return $row['uuid'];
        }
        return (string) $patientId;
    }
}
