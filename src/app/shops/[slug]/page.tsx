import { redirect } from 'next/navigation';

/** Old route — redirect to the new location. */
export default async function OldRouteRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug) redirect(`/s/${slug}`);
  redirect('/');
}
