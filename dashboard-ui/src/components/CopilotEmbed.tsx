import { config } from '@/config';

const COPILOT_EMBED_PATH =
  '/interface/modules/custom_modules/oe-module-clinical-copilot/public/embed.php';

interface Props {
  patientId: string;
}

// Iframes the existing PHP-rendered copilot widget. The dashboard's OAuth
// flow logs the user into OpenEMR via the same provider login form, which
// also creates a PHP session cookie. Same-origin iframe inherits that
// cookie, so the copilot authenticates without OAuth re-plumbing.
//
// The iframe is sized for the copilot's typical content; the panel itself
// scrolls internally if the conversation grows.
export function CopilotEmbed({ patientId }: Props) {
  const origin = new URL(config.fhirBase).origin;
  const src = `${origin}${COPILOT_EMBED_PATH}?pid=${encodeURIComponent(patientId)}`;
  return (
    <iframe
      src={src}
      title="Clinical Co-Pilot"
      className="w-full h-[520px] rounded-lg border bg-white shadow-sm"
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
    />
  );
}
