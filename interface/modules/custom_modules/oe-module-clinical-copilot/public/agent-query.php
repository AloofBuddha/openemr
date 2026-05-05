<?php

/**
 * Clinical Co-Pilot agent query endpoint — proxies to Python sidecar.
 *
 * POST params:
 *   pid              (int)    — patient ID
 *   csrf_token_form  (string) — CSRF token
 *   query            (string) — physician's question
 *   patient_context  (string) — pre-built context string (optional, from session)
 *   doc_ids          (string) — JSON array of openemr_doc_ids (optional)
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

// Boot OpenEMR — depth 5 from public/ up through interface/
require_once dirname(__FILE__, 5) . '/globals.php';

use OpenEMR\Common\Csrf\CsrfUtils;
use OpenEMR\Common\Session\SessionTracker;
use OpenEMR\Common\Session\SessionWrapperFactory;
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

// --- Auth ---
$session     = SessionWrapperFactory::getInstance()->getActiveSession();
$physicianId = (int) $session->get('authUserID');
if ($physicianId <= 0 || SessionTracker::isSessionExpired()) {
    http_response_code(401);
    exit('Unauthorized');
}

try {
    CsrfUtils::checkCsrfInput(INPUT_POST);
} catch (\Throwable) {
    http_response_code(403);
    exit('CSRF check failed');
}

$pid = filter_input(INPUT_POST, 'pid', FILTER_VALIDATE_INT);
if ($pid === false || $pid === null || $pid <= 0) {
    http_response_code(400);
    exit('Invalid pid');
}

$auditLogger = new AgentAuditLogger();
$guard       = new PatientAccessGuard();

try {
    $guard->assertAccess($physicianId, $pid);
} catch (UnauthorizedPatientAccessException) {
    $auditLogger->logDenied($physicianId, $pid, 'agent-query');
    http_response_code(403);
    exit('Forbidden');
}

// --- Input ---
$queryRaw = filter_input(INPUT_POST, 'query', FILTER_DEFAULT) ?? '';
$query    = substr(trim((string) $queryRaw), 0, 500);
if ($query === '') {
    http_response_code(400);
    exit('query is required');
}

// doc_ids: JSON array of ints, default []
$docIds    = [];
$docIdsRaw = filter_input(INPUT_POST, 'doc_ids', FILTER_DEFAULT) ?? '';
if ($docIdsRaw !== '') {
    $decoded = json_decode((string) $docIdsRaw, true);
    if (is_array($decoded)) {
        foreach ($decoded as $docId) {
            if (is_int($docId) && $docId > 0) {
                $docIds[] = $docId;
            }
        }
    }
}

// Patient context from session (pre-built by the snapshot endpoint)
$today         = date('Y-m-d');
$ctxKey        = "copilot_ctx_{$pid}_{$physicianId}_{$today}";
$patientContext = (string) ($session->get($ctxKey) ?? '');

// --- SSE headers ---
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('X-Accel-Buffering: no');
header('Connection: keep-alive');

while (ob_get_level() > 0) {
    ob_end_clean();
}

// Helper: emit a single SSE event
function sseEmit(string $event, string $data): void
{
    echo "event: {$event}\n";
    echo 'data: ' . $data . "\n\n";
    flush();
}

// --- Proxy to Python sidecar ---
$sidecarUrl = 'http://127.0.0.1:8400/query';
$payload    = json_encode([
    'patient_id'      => $pid,
    'query'           => $query,
    'patient_context' => $patientContext,
    'doc_ids'         => $docIds,
]);

$ch = curl_init($sidecarUrl);
if ($ch === false) {
    error_log('[CopilotAgentQuery] curl_init failed');
    sseEmit('error', json_encode(['message' => 'Sidecar unavailable']));
    exit;
}

// Buffer for the streaming write callback — we emit SSE chunks as they arrive.
curl_setopt_array($ch, [
    CURLOPT_POST            => true,
    CURLOPT_POSTFIELDS      => $payload,
    CURLOPT_HTTPHEADER      => ['Content-Type: application/json'],
    CURLOPT_RETURNTRANSFER  => false,
    CURLOPT_TIMEOUT         => 120,
    CURLOPT_CONNECTTIMEOUT  => 5,
    CURLOPT_WRITEFUNCTION   => static function ($ch, string $chunk): int {
        echo $chunk;
        flush();
        return strlen($chunk);
    },
]);

$ok        = curl_exec($ch);
$httpCode  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError !== '') {
    error_log('[CopilotAgentQuery] Sidecar curl error: ' . $curlError);
    sseEmit('error', json_encode(['message' => 'Sidecar connection error']));
} elseif ($ok === false || ($httpCode !== 0 && $httpCode !== 200)) {
    error_log('[CopilotAgentQuery] Sidecar returned HTTP ' . $httpCode);
    sseEmit('error', json_encode(['message' => 'Sidecar error', 'http_code' => $httpCode]));
}
