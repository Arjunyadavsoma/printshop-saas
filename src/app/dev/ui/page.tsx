import { ClearGallery } from '@/components/clear/gallery';

export const metadata = {
  title: 'Clear Design System Gallery',
  description: 'Dev-only gallery showing every Clear component.',
  robots: { index: false, follow: false },
};

/**
 * AUDIT P1-7: this page was publicly reachable on production. Fail closed —
 * same rule as requireDev(): anything that is not an explicit development
 * environment gets a 404.
 */
export default function DevUIPage() {
  return <ClearGallery />;
}
