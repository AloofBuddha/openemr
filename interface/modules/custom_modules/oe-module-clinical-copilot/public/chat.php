<?php

/**
 * Clinical Co-Pilot SSE streaming endpoint.
 *
 * POST params:
 *   pid              (int)    — patient ID
 *   csrf_token_form  (string) — CSRF token
 *   messages         (string) — JSON array of {role, content} objects
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
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Modules\ClinicalCopilot\Agent\Orchestrator;
use OpenEMR\Modules\ClinicalCopilot\Agent\Tools\PatientBriefTool;
use OpenEMR\Modules\ClinicalCopilot\Authorization\PatientAccessGuard;
use OpenEMR\Modules\ClinicalCopilot\Authorization\UnauthorizedPatientAccessException;
use OpenEMR\Modules\ClinicalCopilot\Observability\AgentAuditLogger;

// Register module namespace
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

$session     = SessionWrapperFactory::getInstance()->getActiveSession();
$physicianId = (int) $session->get('authUserID');
if ($physicianId <= 0) {
    http_response_code(401);
    exit('Unauthorized');
}

CsrfUtils::checkCsrfInput(INPUT_POST, dieOnFail: true);

$pid = filter_input(INPUT_POST, 'pid', FILTER_VALIDATE_INT);
if ($pid === false || $pid === null || $pid <= 0) {
    http_response_code(400);
    exit('Invalid pid');
}

// Parse optional messages array
$messagesRaw = $_POST['messages'] ?? null;
$messages    = null;
if ($messagesRaw !== null) {
    $decoded = json_decode($messagesRaw, true);
    if (is_array($decoded) && !empty($decoded)) {
        // Validate each message has role + content strings
        $valid = true;
        foreach ($decoded as $msg) {
            if (!isset($msg['role'], $msg['content'])
                || !in_array($msg['role'], ['user', 'assistant'], true)
                || !is_string($msg['content'])
            ) {
                $valid = false;
                break;
            }
        }
        $messages = $valid ? $decoded : null;
    }
}

$auditLogger = new AgentAuditLogger();
$guard = new PatientAccessGuard();

try {
    $guard->assertAccess($physicianId, $pid);
} catch (UnauthorizedPatientAccessException $e) {
    $auditLogger->logDenied($physicianId, $pid, 'chat');
    http_response_code(403);
    exit('Forbidden');
}

header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('X-Accel-Buffering: no');
header('Connection: keep-alive');

while (ob_get_level() > 0) {
    ob_end_clean();
}

$orchestrator = new Orchestrator(
    new PatientBriefTool($guard),
    $auditLogger,
    $guard,
);

$orchestrator->streamChat(
    $pid,
    $physicianId,
    $messages ?? [['role' => 'user', 'content' => 'Brief me on this patient.']],
);
