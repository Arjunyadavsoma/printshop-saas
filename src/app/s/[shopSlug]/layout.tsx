import type { Metadata } from 'next';

/**
 * /s/[shopSlug] segment layout — the customer flow page is a heavy client
 * component, so its metadata lives here. generateMetadata resolves the SHOP
 * NAME (public data) for a useful tab title + link preview; on lookup
 * failure it falls back to a generic title. No customer/personal data is
 * ever exposed in these previews (audit P1-5).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}): Promise<Metadata> {
  const { shopSlug } = await params;
  let shopName = 'Print shop';
  try {
    const { getContainer } = await import('@/lib/container');
    const shop = await getContainer().db.findOne<{ name: string }>('shop', { slug: shopSlug });
    if (shop?.name) shopName = shop.name;
  } catch {
    // lookup is best-effort — the generic title is fine
  }
  const description = `Order prints from ${shopName}: upload files, choose print options, pay by UPI directly, and track until pickup. 0% commission.`;
  return {
    title: shopName,
    description,
    alternates: { canonical: `/s/${shopSlug}` },
    openGraph: {
      title: `${shopName} · Printelyx`,
      description,
      images: ['/og.png'],
    },
  };
}

export default function ShopSlugLayout({ children }: { children: React.ReactNode }) {
  return children;
}
