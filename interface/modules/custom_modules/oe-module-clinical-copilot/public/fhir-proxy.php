<?php

/**
 * FHIR proxy for the React patient-dashboard bundle.
 *
 * Thin server-side wrapper around OpenEMR's existing FHIR REST
 * controllers. The bundle ships in the same browser session that
 * authenticated against OpenEMR, so we authorize on session +
 * CSRF instead of doing a second OAuth round-trip in the browser.
 * The data layer is still FHIR — `OpenEMR\RestControllers\FHIR\*`
 * is the same code path the public `/apis/default/fhir/*` endpoints
 * run.
 *
 * Query params:
 *   path        (string) — FHIR resource path (e.g. "Patient/20",
 *                          "AllergyIntolerance?patient=20").
 *   csrf_token  (string) — CSRF token from the rendering PHP page.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once dirname(__FILE__, 5) . '/globals.php';

use OpenEMR\Common\Acl\AclMain;
use OpenEMR\Common\Csrf\CsrfUtils;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\RestControllers\FHIR\FhirPatientRestController;
use OpenEMR\RestControllers\FHIR\FhirAllergyIntoleranceRestController;
use OpenEMR\RestControllers\FHIR\FhirConditionRestController;
use OpenEMR\RestControllers\FHIR\FhirMedicationRequestRestController;
use OpenEMR\RestControllers\FHIR\FhirCareTeamRestController;
use OpenEMR\RestControllers\FHIR\FhirEncounterRestController;
use Psr\Http\Message\ResponseInterface;

/** Resolve an integer OpenEMR pid to the FHIR-shaped patient UUID. */
function resolvePuuid(string $pid): ?string
{
    if (!ctype_digit($pid)) {
        return $pid; // already a uuid string
    }
    $row = sqlQuery('SELECT uuid FROM patient_data WHERE pid = ? LIMIT 1', [(int) $pid]);
    if (empty($row['uuid'])) {
        return null;
    }
    return UuidRegistry::uuidToString($row['uuid']);
}

header('Content-Type: application/json');

$session = SessionWrapperFactory::getInstance()->getActiveSession();
$userId = (int) $session->get('authUserID');
if ($userId <= 0) {
    http_response_code(401);
    echo json_encode(['error' => 'not_authenticated']);
    exit;
}

if (!CsrfUtils::verifyCsrfToken((string) ($_GET['csrf_token'] ?? ''))) {
    http_response_code(403);
    echo json_encode(['error' => 'csrf_invalid']);
    exit;
}

if (!AclMain::aclCheckCore('patients', 'med')) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

$path = (string) ($_GET['path'] ?? '');
if ($path === '') {
    http_response_code(400);
    echo json_encode(['error' => 'missing_path']);
    exit;
}

[$pathOnly, $queryString] = array_pad(explode('?', $path, 2), 2, '');
$segments = array_values(array_filter(explode('/', $pathOnly), fn ($s) => $s !== ''));
parse_str($queryString, $searchParams);

$resource = $segments[0] ?? '';
$resourceId = $segments[1] ?? null;

// Translate `patient=<pid>` (integer) to `patient=<uuid>` since the
// FHIR services compare against the UUID column. Also translate the
// path component for Patient/{id} when the id is numeric.
if (isset($searchParams['patient'])) {
    $resolved = resolvePuuid((string) $searchParams['patient']);
    if ($resolved === null) {
        http_response_code(404);
        echo json_encode(['error' => 'patient_not_found']);
        exit;
    }
    $searchParams['patient'] = $resolved;
}
if ($resource === 'Patient' && $resourceId !== null) {
    $resolved = resolvePuuid($resourceId);
    if ($resolved === null) {
        http_response_code(404);
        echo json_encode(['error' => 'patient_not_found']);
        exit;
    }
    $resourceId = $resolved;
}

$controllers = [
    'Patient' => FhirPatientRestController::class,
    'AllergyIntolerance' => FhirAllergyIntoleranceRestController::class,
    'Condition' => FhirConditionRestController::class,
    'MedicationRequest' => FhirMedicationRequestRestController::class,
    'CareTeam' => FhirCareTeamRestController::class,
    'Encounter' => FhirEncounterRestController::class,
];
if (!isset($controllers[$resource])) {
    http_response_code(404);
    echo json_encode(['error' => 'unsupported_resource', 'resource' => $resource]);
    exit;
}

try {
    /** @var object $controller */
    $controller = new $controllers[$resource]();
    $response = $resourceId !== null
        ? $controller->getOne($resourceId)
        : $controller->getAll($searchParams, null);

    // OpenEMR's controllers can return either a PSR-7 ResponseInterface
    // or an associative array depending on the resource — normalize to
    // a JSON body + status code.
    if ($response instanceof ResponseInterface) {
        http_response_code($response->getStatusCode());
        echo (string) $response->getBody();
    } else {
        echo json_encode($response);
    }
} catch (\Throwable $e) {
    http_response_code(500);
    error_log('fhir-proxy: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    // Verbose error during development. Strip class FQNs from message
    // so we don't leak too much, but include enough to debug controller
    // signature mismatches.
    echo json_encode([
        'error' => 'server_error',
        'detail' => $e->getMessage(),
        'where' => basename($e->getFile()) . ':' . $e->getLine(),
    ]);
}
