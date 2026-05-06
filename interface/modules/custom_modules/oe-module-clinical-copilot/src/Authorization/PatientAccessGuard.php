<?php

/**
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\ClinicalCopilot\Authorization;

use OpenEMR\Common\Database\QueryUtils;

/**
 * Gatekeeper for the Clinical Co-Pilot's PHI access.
 *
 * Trust model — a physician may view a patient's data only if AT LEAST ONE
 * of the following holds:
 *
 *   1. Prior encounter — there is a row in `form_encounter` that names the
 *      physician as `provider_id` for this patient. Captures established
 *      care relationships.
 *
 *   2. Today's schedule — there is a calendar event today that names the
 *      physician as `pc_aid` for this patient. Captures upcoming visits
 *      where the encounter has not yet been created.
 *
 * Limitations (acceptable for demo, not for production):
 *
 *   - Only matches the primary `provider_id` on an encounter. Consulting,
 *     supervising, or covering physicians are not modelled.
 *   - The "today" check uses the server's clock; assumes the deployment
 *     runs in a single timezone.
 *
 * Defence in depth: this guard is invoked at every public endpoint AND
 * inside the agent layer (Orchestrator, PatientBriefTool). A direct caller
 * bypassing the endpoint still hits the check.
 */
final class PatientAccessGuard
{
    /**
     * Throw UnauthorizedPatientAccessException unless the physician has a
     * legitimate care relationship with the patient.
     */
    public function assertAccess(int $physicianId, int $patientId): void
    {
        if (!$this->hasEncounterRelationship($physicianId, $patientId)
            && !$this->isOnTodaySchedule($physicianId, $patientId)
        ) {
            throw new UnauthorizedPatientAccessException(
                "Physician {$physicianId} has no care relationship with patient {$patientId}"
            );
        }
    }

    private function hasEncounterRelationship(int $physicianId, int $patientId): bool
    {
        $value = QueryUtils::fetchSingleValue(
            'SELECT 1 FROM form_encounter WHERE pid = ? AND provider_id = ? LIMIT 1',
            '1',
            [$patientId, $physicianId]
        );
        return $value !== null;
    }

    private function isOnTodaySchedule(int $physicianId, int $patientId): bool
    {
        $value = QueryUtils::fetchSingleValue(
            'SELECT 1 FROM openemr_postcalendar_events
             WHERE pc_pid = ? AND pc_aid = ? AND pc_eventDate = ? LIMIT 1',
            '1',
            [$patientId, $physicianId, date('Y-m-d')]
        );
        return $value !== null;
    }
}
