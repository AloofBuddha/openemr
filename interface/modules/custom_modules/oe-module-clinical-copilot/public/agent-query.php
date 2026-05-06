<?php

/**
 * Clinical Co-Pilot agent query endpoint — proxies to Python sidecar.
 *
 * POST params:
 *   pid              (int)    — patient ID
 *   csrf_token_form  (string) — CSRF token
 *   query            (string) — physician's question (max 500 chars)
 *   patient_context  (string) — plain-text patient summary (preferred over session)
 *   doc_ids          (string) — JSON array of openemr_doc_ids (optional)
 *
 * Emits SSE events in the UI's expected format:
 *   sources, delta, suggestions, done, error
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

require_once dirname(__FILE__, 5) . '/globals.php';

use OpenEMR\Common\Csrf\CsrfUtils;
use OpenEMR\Common\Session\SessionTracker;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Modules\ClinicalCopilot\Authorization\PatientAccessGuard;
use OpenEMR\Modules\ClinicalCopilot\Authorization\UnauthorizedPatientAccessException;
use OpenEMR\Modules\ClinicalCopilot\Observability\AgentAuditLogger;

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

// Patient context: prefer POST field (built client-side from snapshot), fall back to session
$patientContextPost = trim((string) (filter_input(INPUT_POST, 'patient_context', FILTER_DEFAULT) ?? ''));
if ($patientContextPost !== '') {
    $patientContext = $patientContextPost;
} else {
    $today          = date('Y-m-d');
    $ctxKey         = "copilot_ctx_{$pid}_{$physicianId}_{$today}";
    $patientContext = (string) ($session->get($ctxKey) ?? '');
}

// --- SSE headers ---
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('X-Accel-Buffering: no');
header('Connection: keep-alive');

while (ob_get_level() > 0) {
    ob_end_clean();
}

function sseEmit(string $event, string $data): void
{
    echo "event: {$event}\n";
    echo 'data: ' . $data . "\n\n";
    flush();
}

// --- Build sources map from citations array ---
function buildSourcesMap(array $citations, int $pid): array
{
    $sources = [];
    foreach ($citations as $cit) {
        $ref = (string) ($cit['ref'] ?? '');
        if ($ref === '') {
            continue;
        }
        if (str_starts_with($ref, 'G')) {
            $sources[$ref] = [
                'type'   => 'guideline',
                'label'  => (string) ($cit['source_ref'] ?? "Guideline $ref"),
                'fields' => array_values(array_filter([
                    ['key' => 'Source',  'value' => (string) ($cit['source_ref'] ?? '')],
                    ['key' => 'Excerpt', 'value' => substr((string) ($cit['text'] ?? ''), 0, 250)],
                ], static fn(array $f): bool => $f['value'] !== '')),
            ];
        } elseif (str_starts_with($ref, 'P')) {
            // Patient document citation (extracted lab/intake doc)
            $docId  = isset($cit['openemr_doc_id']) ? (int) $cit['openemr_doc_id'] : 0;
            $docUrl = $docId > 0
                ? "/controller.php?document&retrieve&patient_id={$pid}&document_id={$docId}&as_file=false"
                : '';
            $sources[$ref] = [
                'type'    => 'document',
                'label'   => ucfirst(str_replace('_', ' ', (string) ($cit['source_type'] ?? 'document'))),
                'doc_url' => $docUrl,
                'fields'  => array_values(array_filter([
                    ['key' => 'Type',   'value' => (string) ($cit['source_type'] ?? 'document')],
                    ['key' => 'Doc ID', 'value' => $docId > 0 ? (string) $docId : ''],
                ], static fn(array $f): bool => $f['value'] !== '')),
            ];
        }
    }
    return $sources;
}

// --- Stream from Python sidecar, forwarding SSE events in real time ---
$sidecarHost = getenv('COPILOT_SIDECAR_HOST') ?: '127.0.0.1';
$sidecarUrl  = "http://{$sidecarHost}:8400/query";
$payload     = json_encode([
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

// State shared with the write callback via references
$lineBuffer     = '';
$evtType        = '';
$sourcesEmitted = false;
$doneEmitted    = false;
$gotAnyData     = false;

$writeCallback = function (mixed $ch, string $data) use (
    &$lineBuffer, &$evtType, &$sourcesEmitted, &$doneEmitted, &$gotAnyData, $pid
): int {
    $gotAnyData = true;
    $lineBuffer .= $data;

    while (($pos = strpos($lineBuffer, "\n")) !== false) {
        $line       = rtrim(substr($lineBuffer, 0, $pos), "\r");
        $lineBuffer = substr($lineBuffer, $pos + 1);

        if ($line === '') {
            $evtType = '';
            continue;
        }

        if (str_starts_with($line, 'event: ')) {
            $evtType = substr($line, 7);
        } elseif (str_starts_with($line, 'data: ') && $evtType !== '') {
            $payload = substr($line, 6);

            if ($evtType === 'status') {
                sseEmit('status', $payload);

            } elseif ($evtType === 'citations' && !$sourcesEmitted) {
                $parsed  = json_decode($payload, true);
                $citList = is_array($parsed) ? (array) ($parsed['citations'] ?? []) : [];
                $srcMap  = buildSourcesMap($citList, $pid);
                if ($srcMap !== []) {
                    sseEmit('sources', json_encode(['sources' => $srcMap]));
                }
                $sourcesEmitted = true;

            } elseif ($evtType === 'delta') {
                // Forward chunk directly — already JSON {text: "..."}
                sseEmit('delta', $payload);

            } elseif ($evtType === 'done' && !$doneEmitted) {
                sseEmit('suggestions', json_encode(['suggestions' => [
                    'What are the treatment recommendations?',
                    'Check for drug interactions',
                    'What follow-up is needed?',
                ]]));
                sseEmit('done', '{}');
                $doneEmitted = true;
            }
        }
    }

    return strlen($data);
};

curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_WRITEFUNCTION  => $writeCallback,
    CURLOPT_TIMEOUT        => 120,
    CURLOPT_CONNECTTIMEOUT => 5,
]);

$ok        = curl_exec($ch);
$curlError = curl_error($ch);
$httpCode  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if (!$ok || $curlError !== '') {
    error_log('[CopilotAgentQuery] Sidecar curl error: ' . $curlError);
    if (!$doneEmitted) {
        sseEmit('error', json_encode(['message' => 'Sidecar connection error. Is the agent service running?']));
    }
    exit;
}
if ($httpCode !== 200) {
    error_log('[CopilotAgentQuery] Sidecar returned HTTP ' . $httpCode);
    if (!$doneEmitted) {
        sseEmit('error', json_encode(['message' => 'Sidecar error (HTTP ' . $httpCode . ')']));
    }
    exit;
}
if (!$doneEmitted) {
    error_log('[CopilotAgentQuery] Stream ended without done event');
    sseEmit('error', json_encode(['message' => 'Agent response incomplete']));
}
