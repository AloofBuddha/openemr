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
                (string) $patientId,
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
}
