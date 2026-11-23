'use client';
import dynamic from 'next/dynamic';
import { SkeletonBox } from '@/components/clear/skeleton';

const CustomerOrderFlowV2 = dynamic(
  () => import('./CustomerOrderFlowV2').then(m => m.CustomerOrderFlowV2),
  {
    loading: () => (
      <div className="p-5 space-y-4">
        <SkeletonBox height={48} width="100%" />
        <SkeletonBox height={200} width="100%" />
        <SkeletonBox height={48} width="100%" />
      </div>
    ),
    ssr: false,
  }
);

export function CustomerOrderFlowV2Lazy(props: any) {
  return <CustomerOrderFlowV2 {...props} />;
}
