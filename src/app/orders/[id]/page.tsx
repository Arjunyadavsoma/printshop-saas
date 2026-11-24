import { redirect } from 'next/navigation';

/** Old route — redirect to the new location. */
export default async function OldRouteRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id) redirect(`/shop/orders/${id}`);
  redirect('/');
}
