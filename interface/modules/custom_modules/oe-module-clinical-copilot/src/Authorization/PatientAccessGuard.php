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

use OpenEMR\Common\Acl\AclMain;
use OpenEMR\Common\Database\QueryUtils;

/**
 * Gatekeeper for the Clinical Co-Pilot's PHI access.
 *
 * Trust model — a physician may view a patient's data only if AT LEAST ONE
 * of the following holds:
 *
 *   1. System admin — the physician is an OpenEMR superuser (admin > super).
 *      Allows admin accounts to access any patient for demo/oversight purposes.
 *
 *   2. Prior encounter — there is a row in `form_encounter` that names the
 *      physician as `provider_id` for this patient. Captures established
 *      care relationships.
 *
 *   3. Any scheduled appointment — there is a calendar event (past or
 *      future) that names the physician as `pc_aid` for this patient.
 *      Not restricted to today so physicians can review charts before
 *      or after the scheduled visit date.
 *
 * Limitations (acceptable for demo, not for production):
 *
 *   - Only matches the primary `provider_id` on an encounter. Consulting,
 *     supervising, or covering physicians are not modelled.
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
        if (!$this->isSystemAdmin($physicianId)
            && !$this->hasEncounterRelationship($physicianId, $patientId)
            && !$this->isOnTodaySchedule($physicianId, $patientId)
        ) {
            throw new UnauthorizedPatientAccessException(
                "Physician {$physicianId} has no care relationship with patient {$patientId}"
            );
        }
    }

    private function isSystemAdmin(int $physicianId): bool
    {
        $username = QueryUtils::fetchSingleValue(
            'SELECT username FROM users WHERE id = ? LIMIT 1',
            'username',
            [$physicianId]
        );
        if ($username === null || $username === '') {
            return false;
        }
        return AclMain::aclCheckCore('admin', 'super', $username);
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
        // Any appointment (past or future) counts — not restricted to today so
        // physicians can review charts before or after the scheduled visit date.
        $value = QueryUtils::fetchSingleValue(
            'SELECT 1 FROM openemr_postcalendar_events
             WHERE pc_pid = ? AND pc_aid = ? LIMIT 1',
            '1',
            [$patientId, $physicianId]
        );
        return $value !== null;
    }
}
