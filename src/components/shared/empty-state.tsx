import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/**
 * Phase 8: Reusable empty state with explanation, icon, and optional action.
 */

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title, description, icon, action, className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-12 text-center', className)}>
      {icon && (
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
