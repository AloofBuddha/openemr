<?php

/**
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Benjamin Cohen <bac1087@gmail.com>
 * @copyright Copyright (c) 2026 Benjamin Cohen
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\ClinicalCopilot;

use OpenEMR\Common\Csrf\CsrfUtils;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Core\OEGlobalsBag;
use OpenEMR\Events\PatientDemographics\RenderEvent;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;

class Bootstrap
{
    const MODULE_INSTALLATION_PATH = '/interface/modules/custom_modules/oe-module-clinical-copilot';

    public function __construct(
        private readonly EventDispatcherInterface $eventDispatcher
    ) {}

    public function subscribeToEvents(): void
    {
        $this->eventDispatcher->addListener(
            RenderEvent::EVENT_SECTION_LIST_RENDER_BEFORE,
            $this->renderCopilotWidget(...)
        );
    }

    public function renderCopilotWidget(RenderEvent $event): void
    {
        $pid = $event->getPid();
        if (empty($pid)) {
            return;
        }

        $session     = SessionWrapperFactory::getInstance()->getActiveSession();
        $csrfToken   = CsrfUtils::collectCsrfToken($session);
        $physicianId = (int) $session->get('authUserID');
        $webRoot     = OEGlobalsBag::getInstance()->getWebRoot();
        $publicUrl   = $webRoot . self::MODULE_INSTALLATION_PATH . '/public';
        $pid         = (int) $pid;
        $bundlePath  = dirname(__DIR__) . '/public/js/copilot-bundle.js';
        $bundleVer   = file_exists($bundlePath) ? filemtime($bundlePath) : 0;

        // Fetch document categories for the upload modal dropdown.
        // id=1 is the root "Categories" node — files uploaded there appear at top level
        // in the patient documents tree, so we surface it first as "General".
        $catRows = sqlStatement(
            "SELECT id, name FROM categories WHERE parent = 1 ORDER BY name ASC"
        );
        $categories = [['id' => 1, 'name' => 'General']];
        while ($row = sqlFetchArray($catRows)) {
            $categories[] = ['id' => (int) $row['id'], 'name' => $row['name']];
        }
        $categoriesJson = json_encode($categories, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT);
        $webRootJs = addslashes($webRoot);

        echo <<<HTML
        <div id="copilot-widget" style="display:none;"><div id="copilot-root"></div></div>
        <script src="{$publicUrl}/js/copilot-bundle.js?v={$bundleVer}"></script>
        <script>
        (function() {
            copilotInit({$pid}, '{$publicUrl}/chat.php', '{$csrfToken}', {$physicianId}, '{$webRootJs}', {$categoriesJson});
        })();
        </script>
        HTML;
    }
}
