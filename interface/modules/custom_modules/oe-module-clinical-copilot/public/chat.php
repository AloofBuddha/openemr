<?php

/**
 * Clinical Co-Pilot SSE streaming endpoint.
 * Accepts POST: pid (int), refresh (bool optional)
 * Returns: text/event-stream SSE
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

// Boot OpenEMR — depth 5 from interface/
require_once dirname(__FILE__, 5) . '/globals.php';

use OpenEMR\Common\Csrf\CsrfUtils;
use OpenEMR\Modules\ClinicalCopilot\Agent\Orchestrator;
use OpenEMR\Modules\ClinicalCopilot\Agent\Tools\PatientBriefTool;
use OpenEMR\Modules\ClinicalCopilot\Authorization\PatientAccessGuard;
use OpenEMR\Modules\ClinicalCopilot\Authorization\UnauthorizedPatientAccessException;
use OpenEMR\Modules\ClinicalCopilot\Observability\AgentAuditLogger;

// Register our module namespace (not loaded via bootstrap in a direct PHP hit)
spl_autoload_register(function (string $class): void {
    $prefix = 'OpenEMR\\Modules\\ClinicalCopilot\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
    $file = dirname(__DIR__) . '/src/' . $relative . '.php';
    if (file_exists($file)) {
        require_once $file;
    }
});

// Session auth: must be logged in
if (empty($_SESSION['authUserID'])) {
    http_response_code(401);
    exit('Unauthorized');
}

// CSRF check
CsrfUtils::checkCsrfInput(INPUT_POST, dieOnFail: true);

// Validate input
$pid = filter_input(INPUT_POST, 'pid', FILTER_VALIDATE_INT);
if ($pid === false || $pid === null || $pid <= 0) {
    http_response_code(400);
    exit('Invalid pid');
}

$forceRefresh = filter_input(INPUT_POST, 'refresh', FILTER_VALIDATE_BOOLEAN) === true;
$physicianId  = (int) $_SESSION['authUserID'];

// Authorization
try {
    (new PatientAccessGuard())->assertAccess($physicianId, $pid);
} catch (UnauthorizedPatientAccessException $e) {
    http_response_code(403);
    exit('Forbidden');
}

// SSE headers
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('X-Accel-Buffering: no');
header('Connection: keep-alive');

// Kill output buffering so events reach the browser immediately
while (ob_get_level() > 0) {
    ob_end_clean();
}

$orchestrator = new Orchestrator(
    new PatientBriefTool(),
    new AgentAuditLogger(),
);

$orchestrator->streamBrief($pid, $physicianId, $forceRefresh);
