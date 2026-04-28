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

        $session    = SessionWrapperFactory::getInstance()->getActiveSession();
        $csrfToken  = CsrfUtils::collectCsrfToken($session);
        $webRoot    = OEGlobalsBag::getInstance()->getWebRoot();
        $publicUrl  = $webRoot . self::MODULE_INSTALLATION_PATH . '/public';
        $pid        = (int) $pid;

        echo <<<HTML
        <div id="copilot-widget" style="display:none;">
            <div class="copilot-header">
                <span><strong>&#129302; Clinical Co-Pilot</strong></span>
                <div class="copilot-header-actions">
                    <span id="copilot-status-badge" class="copilot-badge copilot-badge-loading">Loading...</span>
                    <button id="copilot-refresh-btn" onclick="copilotRefresh()" title="Refresh brief" class="copilot-btn-icon">&#8635;</button>
                    <button id="copilot-toggle-btn" onclick="copilotToggle()" title="Collapse" class="copilot-btn-icon">&#9650;</button>
                </div>
            </div>
            <div id="copilot-panel-body" class="copilot-body">
                <div id="copilot-content" class="copilot-content"></div>
                <div id="copilot-footer" class="copilot-footer" style="display:none;">
                    <span class="copilot-disclaimer">Brief reflects EHR data only. Undocumented conditions will not appear.</span>
                </div>
            </div>
        </div>
        <script src="{$publicUrl}/js/copilot-bundle.js"></script>
        <script>
        (function() {
            copilotInit({$pid}, '{$publicUrl}/chat.php', '{$csrfToken}');
        })();
        </script>
        HTML;
    }
}
