<?php

/**
 * Clinical Co-Pilot intake processing endpoint.
 *
 * Called at copilot startup: retrieves any intake forms uploaded (e.g. by
 * front desk) that have not yet been processed by the agent, returns their
 * extractions, and marks them processed so they are not returned again.
 *
 * POST params:
 *   pid              (int)    — patient ID
 *   csrf_token_form  (string) — CSRF token
 *
 * Returns JSON: { processed: [{doc_id, doc_name, extraction}] }
 *              or { processed: [] } on any error (non-fatal, copilot continues)
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

$ignoreAuth = true;
require_once dirname(__FILE__, 5) . '/globals.php';
require_once __DIR__ . '/_bootstrap.php';

ob_start();

use OpenEMR\Common\Csrf\CsrfUtils;
use OpenEMR\Common\Session\SessionTracker;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Modules\ClinicalCopilot\Authorization\PatientAccessGuard;
use OpenEMR\Modules\ClinicalCopilot\Authorization\UnauthorizedPatientAccessException;

header('Content-Type: application/json');

function intakeProcError(string $msg, int $code = 400): never
{
    ob_end_clean();
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode(['error' => $msg, 'processed' => []]);
    exit;
}

$session     = SessionWrapperFactory::getInstance()->getActiveSession();
$physicianId = (int) $session->get('authUserID');
if ($physicianId <= 0 || SessionTracker::isSessionExpired()) {
    intakeProcError('Session expired', 401);
}

try {
    CsrfUtils::checkCsrfInput(INPUT_POST);
} catch (\Throwable) {
    intakeProcError('CSRF check failed', 403);
}

$pid = filter_input(INPUT_POST, 'pid', FILTER_VALIDATE_INT);
if (!$pid || $pid <= 0) {
    intakeProcError('Invalid pid');
}

$guard = new PatientAccessGuard();
try {
    $guard->assertAccess($physicianId, $pid);
} catch (UnauthorizedPatientAccessException) {
    intakeProcError('Access denied', 403);
}

ob_end_clean();

$sidecarHost = getenv('COPILOT_SIDECAR_HOST') ?: '127.0.0.1';
$sidecarUrl  = "http://{$sidecarHost}:8400/patients/{$pid}/intakes/process-pending";

$ch = curl_init($sidecarUrl);
if ($ch === false) {
    echo json_encode(['processed' => []]);
    exit;
}

curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => '{}',
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_CONNECTTIMEOUT => 5,
]);

$body      = curl_exec($ch);
$httpCode  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError !== '' || $httpCode !== 200 || !is_string($body)) {
    error_log("[CopilotIntakeProcess] Sidecar error: {$curlError}, HTTP {$httpCode}");
    echo json_encode(['processed' => []]);
    exit;
}

echo $body;
