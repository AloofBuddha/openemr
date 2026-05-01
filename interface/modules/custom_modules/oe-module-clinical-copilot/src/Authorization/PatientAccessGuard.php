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

class UnauthorizedPatientAccessException extends \RuntimeException {}

class PatientAccessGuard
{
    // Frozen for demo — matches demo data loaded for this date
    private const DEMO_DATE = '2026-04-28';

    /**
     * Assert the physician has a legitimate care relationship with this patient.
     * Checks: (1) prior encounter, OR (2) on today's schedule.
     * Throws UnauthorizedPatientAccessException if neither is true.
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
        $result = sqlQuery(
            "SELECT 1 FROM form_encounter WHERE pid = ? AND provider_id = ? LIMIT 1",
            [$patientId, $physicianId]
        );
        return !empty($result);
    }

    private function isOnTodaySchedule(int $physicianId, int $patientId): bool
    {
        $result = sqlQuery(
            "SELECT 1 FROM openemr_postcalendar_events
             WHERE pc_pid = ? AND pc_aid = ? AND pc_eventDate = ? LIMIT 1",
            [$patientId, $physicianId, self::DEMO_DATE]
        );
        return !empty($result);
    }
}
