<?php

/**
 * Clinical Co-Pilot document upload endpoint.
 *
 * POST (multipart/form-data):
 *   pid              (int)    — patient ID
 *   csrf_token_form  (string) — CSRF token
 *   file             (file)   — file to upload (PDF, PNG, JPG — max 10 MB)
 *
 * Returns JSON: { id, name, date }  or  { error: "..." }
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

// Suppress PHP notices/warnings from leaking into the JSON response body.
ini_set('display_errors', '0');

// Skip auth.inc.php — it prints an HTML <script> redirect and exits, which would
// land in the JSON response body as a 200 OK. We check the session ourselves below
// and respond with a proper 401 JSON when it has expired.
$ignoreAuth = true;
require_once dirname(__FILE__, 5) . '/globals.php';

// Catch any output so stray PHP warnings don't corrupt the JSON response.
ob_start();

$startMs = (int) (microtime(true) * 1000);

use OpenEMR\Common\Csrf\CsrfUtils;
use OpenEMR\Common\Database\QueryUtils;
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

header('Content-Type: application/json');

function jsonError(string $msg, int $code = 400): never
{
    $leaked = ob_get_clean() ?: '';
    if ($leaked !== '') {
        error_log('[CopilotUpload] Unexpected output before response: ' . substr($leaked, 0, 200));
    }
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode(['error' => $msg]);
    exit;
}

$session     = SessionWrapperFactory::getInstance()->getActiveSession();
$physicianId = (int) $session->get('authUserID');
if ($physicianId <= 0 || SessionTracker::isSessionExpired()) {
    jsonError('Session expired. Please refresh the page.', 401);
}

try {
    CsrfUtils::checkCsrfInput(INPUT_POST);
} catch (\Throwable $e) {
    jsonError('CSRF check failed', 403);
}

$pid = filter_input(INPUT_POST, 'pid', FILTER_VALIDATE_INT);
if (!$pid || $pid <= 0) {
    jsonError('Invalid pid');
}

$auditLogger = new AgentAuditLogger();
$guard = new PatientAccessGuard();

try {
    $guard->assertAccess($physicianId, $pid);
} catch (UnauthorizedPatientAccessException) {
    $auditLogger->logDenied($physicianId, $pid, 'upload');
    jsonError('Access denied', 403);
}

// Validate upload
if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    $errCode = $_FILES['file']['error'] ?? -1;
    jsonError("Upload error code: {$errCode}");
}

$file      = $_FILES['file'];
$maxBytes  = 10 * 1024 * 1024; // 10 MB
if ($file['size'] > $maxBytes) {
    jsonError('File exceeds 10 MB limit');
}

$allowed = ['application/pdf', 'image/png', 'image/jpeg'];
$mime    = mime_content_type($file['tmp_name']);
if (!in_array($mime, $allowed, true)) {
    jsonError("Unsupported file type: {$mime}");
}

$ext = match ($mime) {
    'application/pdf' => 'pdf',
    'image/png'       => 'png',
    default           => 'jpg',
};

// Store file
$siteDocs  = $GLOBALS['OE_SITE_DIR'] . '/documents';
$patientDir = $siteDocs . '/' . $pid;
if (!is_dir($patientDir)) {
    mkdir($patientDir, 0755, true);
}

$safeName  = preg_replace('/[^a-zA-Z0-9._-]/', '_', basename($file['name']));
$unique    = date('Ymd_His') . '_' . bin2hex(random_bytes(4));
$filename  = $unique . '_' . $safeName;
$destPath  = $patientDir . '/' . $filename;

if (!move_uploaded_file($file['tmp_name'], $destPath)) {
    jsonError('Failed to save file', 500);
}

$relUrl = 'sites/default/documents/' . $pid . '/' . $filename;
$now    = date('Y-m-d H:i:s');

// documents.id is NOT auto-increment in OpenEMR — IDs come from the `sequences` table.
$newId = QueryUtils::generateId();
try {
    QueryUtils::sqlStatementThrowException(
        "INSERT INTO documents (id, type, size, date, url, mimetype, owner, foreign_id, name, deleted)
         VALUES (?, 'file_url', ?, ?, ?, ?, ?, ?, ?, 0)",
        [$newId, $file['size'], $now, $relUrl, $mime, $physicianId, $pid, $safeName]
    );
    $categoryId = filter_input(INPUT_POST, 'category_id', FILTER_VALIDATE_INT) ?: 1;
    QueryUtils::sqlStatementThrowException(
        "INSERT INTO categories_to_documents (category_id, document_id) VALUES (?, ?)",
        [$categoryId, $newId]
    );
    $totalMs = (int) (microtime(true) * 1000) - $startMs;
    $auditLogger->logUpload($physicianId, (int) $pid, $newId, $safeName, $totalMs);
} catch (\Throwable $e) {
    error_log('[CopilotUpload] DB insert failed: ' . $e->getMessage());
    jsonError('Database error: could not record document', 500);
}

$leaked = ob_get_clean() ?: '';
if ($leaked !== '') {
    error_log('[CopilotUpload] Unexpected output before success JSON: ' . substr($leaked, 0, 200));
}

// Detect doc_type — caller may pass explicitly; otherwise default based on mime.
$docTypeRaw    = filter_input(INPUT_POST, 'doc_type', FILTER_SANITIZE_SPECIAL_CHARS) ?: '';
$allowedTypes  = ['lab_pdf', 'intake_form'];
$docType       = in_array($docTypeRaw, $allowedTypes, true) ? $docTypeRaw : 'lab_pdf';

// Forward the stored file to the Python sidecar for text extraction.
$extractionResult = null;
$sidecarUrl = 'http://127.0.0.1:8400/ingest';
$payload = json_encode([
    'patient_id'      => $pid,
    'openemr_doc_id'  => $newId,
    'doc_type'        => $docType,
    'file_bytes_b64'  => base64_encode((string) file_get_contents($destPath)),
    'mimetype'        => $mime,
]);

$ch = curl_init($sidecarUrl);
if ($ch !== false) {
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);

    $sidecarBody = curl_exec($ch);
    $httpCode    = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError   = curl_error($ch);
    curl_close($ch);

    if ($curlError !== '') {
        error_log('[CopilotUpload] Sidecar curl error: ' . $curlError);
    } elseif ($httpCode === 200 && is_string($sidecarBody)) {
        $decoded = json_decode($sidecarBody, true);
        if (is_array($decoded)) {
            $extractionResult = $decoded;
        } else {
            error_log('[CopilotUpload] Sidecar returned non-JSON body (HTTP 200)');
        }
    } else {
        error_log('[CopilotUpload] Sidecar returned HTTP ' . $httpCode);
    }
} else {
    error_log('[CopilotUpload] curl_init failed for sidecar');
}

echo json_encode([
    'id'         => $newId,
    'name'       => $safeName,
    'date'       => $now,
    'extraction' => $extractionResult,
]);
