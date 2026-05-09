<?php

/**
 * Standalone embed page for the Clinical Co-Pilot widget.
 *
 * Loads the same JS bundle Bootstrap.php uses, but renders only the
 * copilot widget — no OpenEMR chrome. Designed to be iframed by the
 * React dashboard (`dashboard-ui/`) at `/dashboard/patient/{pid}`,
 * which authenticates via OAuth2 but inherits the PHP session cookie
 * from the OAuth login (same browser, same origin), so this page
 * authorizes via the standard session flow.
 *
 * Query params:
 *   pid (int) — patient ID. Required.
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

use OpenEMR\Common\Csrf\CsrfUtils;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Common\Acl\AclMain;

$pid = isset($_GET['pid']) ? (int) $_GET['pid'] : 0;
if ($pid <= 0) {
    http_response_code(400);
    echo 'Missing pid';
    exit;
}

$session = SessionWrapperFactory::getInstance()->getActiveSession();
$physicianId = (int) $session->get('authUserID');
if ($physicianId <= 0) {
    http_response_code(401);
    echo 'Not authenticated';
    exit;
}

if (!AclMain::aclCheckCore('patients', 'med')) {
    http_response_code(403);
    echo 'Forbidden';
    exit;
}

$csrfToken  = CsrfUtils::collectCsrfToken($session);
$webRoot    = OEGlobalsBag::getInstance()->getWebRoot();
$publicUrl  = $webRoot . '/interface/modules/custom_modules/oe-module-clinical-copilot/public';
$bundlePath = __DIR__ . '/js/copilot-bundle.js';
$bundleVer  = file_exists($bundlePath) ? filemtime($bundlePath) : 0;

$catRows = sqlStatement('SELECT id, name FROM categories WHERE parent = 1 ORDER BY name ASC');
$categories = [['id' => 1, 'name' => 'General']];
while ($row = sqlFetchArray($catRows)) {
    $categories[] = ['id' => (int) $row['id'], 'name' => $row['name']];
}
$categoriesJson = json_encode($categories, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT);
$webRootJs = addslashes($webRoot);

// Allow same-origin iframing from the React dashboard. OpenEMR doesn't
// set X-Frame-Options globally, but we set it explicitly here so the
// embed contract is clear.
header('X-Frame-Options: SAMEORIGIN');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Clinical Co-Pilot</title>
    <link rel="stylesheet" href="<?php echo htmlspecialchars($publicUrl, ENT_QUOTES); ?>/js/copilot-bundle.css?v=<?php echo $bundleVer; ?>">
    <style>
        html, body { margin: 0; padding: 0; height: 100%; background: #fff; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        #copilot-widget { display: block; }
    </style>
</head>
<body>
    <div id="copilot-widget"><div id="copilot-root"></div></div>
    <script src="<?php echo htmlspecialchars($publicUrl, ENT_QUOTES); ?>/js/copilot-bundle.js?v=<?php echo $bundleVer; ?>"></script>
    <script>
        (function () {
            window.copilotInit(
                <?php echo $pid; ?>,
                <?php echo json_encode($publicUrl . '/chat.php'); ?>,
                <?php echo json_encode($csrfToken); ?>,
                <?php echo $physicianId; ?>,
                '<?php echo $webRootJs; ?>',
                <?php echo $categoriesJson; ?>
            );
        })();
    </script>
</body>
</html>
