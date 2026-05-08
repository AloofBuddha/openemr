<?php

/**
 * Clinical Co-Pilot agent page-image proxy — fetches a rendered PDF page
 * from the Python sidecar so the UI can render bounding-box overlays.
 *
 * GET params:
 *   doc_id  (int)   — OpenEMR document id
 *   page    (int)   — 1-indexed page number
 *
 * Returns the PNG bytes (image/png) or 404.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once dirname(__FILE__, 5) . '/globals.php';
require_once __DIR__ . '/_bootstrap.php';

use OpenEMR\Common\Session\SessionTracker;
use OpenEMR\Common\Session\SessionWrapperFactory;

// Auth — same gate as the rest of the module.
$session     = SessionWrapperFactory::getInstance()->getActiveSession();
$physicianId = (int) $session->get('authUserID');
if ($physicianId <= 0 || SessionTracker::isSessionExpired()) {
    http_response_code(401);
    exit('Unauthorized');
}

$docId = filter_input(INPUT_GET, 'doc_id', FILTER_VALIDATE_INT);
$page  = filter_input(INPUT_GET, 'page', FILTER_VALIDATE_INT);
if ($docId === false || $docId === null || $docId <= 0
        || $page === false || $page === null || $page <= 0 || $page > 50) {
    http_response_code(400);
    exit('Invalid doc_id or page');
}

// Optional bbox crop params. When all six are present, the sidecar returns a
// cropped + highlighted region instead of the full page — much more legible
// at the drawer's typical width and removes the need for client-side overlay.
$cropParams = [];
foreach (['x0', 'y0', 'x1', 'y1', 'pw', 'ph'] as $key) {
    $val = filter_input(INPUT_GET, $key, FILTER_VALIDATE_FLOAT);
    if ($val === false || $val === null) {
        $cropParams = [];
        break;
    }
    $cropParams[$key] = $val;
}

$sidecarHost = getenv('COPILOT_SIDECAR_HOST') ?: '127.0.0.1';
$sidecarUrl  = "http://{$sidecarHost}:8400/docs/{$docId}/page/{$page}";
if (!empty($cropParams)) {
    $sidecarUrl .= '?' . http_build_query($cropParams);
}

$ch = curl_init($sidecarUrl);
if ($ch === false) {
    http_response_code(502);
    exit('Sidecar unavailable');
}

curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_CONNECTTIMEOUT => 5,
]);

$body     = curl_exec($ch);
$httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($body === false || $httpCode === 404) {
    http_response_code(404);
    exit('Page image not found');
}
if ($httpCode !== 200) {
    http_response_code(502);
    exit('Sidecar error');
}

header('Content-Type: image/png');
header('Cache-Control: private, max-age=300');
echo $body;
