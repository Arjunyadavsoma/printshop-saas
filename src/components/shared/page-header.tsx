import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/**
 * Phase 8: Shared page header with title, description, actions, breadcrumbs.
 * Uses correct heading semantics (h1 for page title).
 */

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
  className?: string;
}

export function PageHeader({
  title, description, actions, breadcrumbs, className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-2 pb-6', className)}>
      {breadcrumbs && (
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          {breadcrumbs}
        </nav>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
