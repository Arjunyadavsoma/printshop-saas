import { redirect } from 'next/navigation';

/** Old route — redirect to the new location. */
export default function OldRouteRedirect({ params }: { params: Promise<{ slug?: string; id?: string }> }) {
  const { slug, id } = params instanceof Promise ? {} as { slug?: string; id?: string } : params;
  if (slug) redirect(`/s/${slug}`);
  if (id) redirect(`/shop/orders/${id}`);
  // AUDIT P1-1: bare visits landed on the PUBLIC home page — a dead target
  // for a shopkeeper URL. The print queue lives at /shop/orders.
  redirect('/shop/orders');
}
