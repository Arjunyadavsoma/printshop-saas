'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { CardSkeleton } from '@/components/shared/loading-skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  RefreshCw,
  ShieldCheck,
  Check,
  Minus,
  Mail,
  Crown,
  Lock,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';

/**
 * Staff & Permissions page.
 *
 * This is an INFORMATIONAL page for now — there is no backend staff API
 * yet. A single owner runs most PrintShop shops, so we surface:
 *
 *   1. The current owner's account (from the auth context + shop profile).
 *   2. A permission matrix describing what each role (Owner, Manager,
 *      Operator, Cashier) WILL be able to do once multi-staff ships.
 *   3. A clear note that inviting staff requires a higher subscription
 *      tier, with a link to upgrade via settings.
 *
 * When the staff API lands, this page becomes the launch point for
 * inviting teammates and assigning roles — the matrix below is the
 * contract those roles will implement.
 */

interface ShopInfo {
  id: string;
  name: string;
  slug: string;
  phone: string;
  isActive: boolean;
}

type Role = 'owner' | 'manager' | 'operator' | 'cashier';

interface PermissionRow {
  /** Stable key for React + future backend wiring. */
  key: string;
  label: string;
  description: string;
  /** Which roles can perform this action. */
  roles: Record<Role, boolean>;
}

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  operator: 'Operator',
  cashier: 'Cashier',
};

const ROLE_ORDER: Role[] = ['owner', 'manager', 'operator', 'cashier'];

const PERMISSIONS: PermissionRow[] = [
  {
    key: 'view_dashboard',
    label: 'View dashboard & reports',
    description: 'See the shop overview, sales metrics, and reports.',
    roles: { owner: true, manager: true, operator: true, cashier: true },
  },
  {
    key: 'view_orders',
    label: 'View orders',
    description: 'See all orders and open individual order details.',
    roles: { owner: true, manager: true, operator: true, cashier: true },
  },
  {
    key: 'accept_orders',
    label: 'Accept new orders',
    description: 'Receive incoming customer orders into the queue.',
    roles: { owner: true, manager: true, operator: true, cashier: false },
  },
  {
    key: 'verify_payments',
    label: 'Verify payments',
    description: 'Confirm a customer\'s UPI payment and mark an order paid.',
    roles: { owner: true, manager: true, operator: false, cashier: true },
  },
  {
    key: 'mark_ready_collected',
    label: 'Mark ready & collected',
    description: 'Advance an order to "ready for pickup" and "collected".',
    roles: { owner: true, manager: true, operator: true, cashier: true },
  },
  {
    key: 'cancel_refund',
    label: 'Cancel & refund orders',
    description: 'Cancel an order or issue a refund.',
    roles: { owner: true, manager: true, operator: false, cashier: false },
  },
  {
    key: 'manage_pricing',
    label: 'Manage pricing & services',
    description: 'Edit per-page rates, discounts, and bulk rules.',
    roles: { owner: true, manager: true, operator: false, cashier: false },
  },
  {
    key: 'manage_settings',
    label: 'Manage shop settings',
    description: 'Edit shop profile, UPI ID, QR code, and business hours.',
    roles: { owner: true, manager: false, operator: false, cashier: false },
  },
  {
    key: 'manage_staff',
    label: 'Invite & manage staff',
    description: 'Invite teammates, assign roles, and revoke access.',
    roles: { owner: true, manager: false, operator: false, cashier: false },
  },
];

export default function ShopStaffPage() {
  const api = useApiClient();
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Staff & Permissions · PrintShop SaaS';
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const r = await api.request<{
          data?: ShopInfo;
          error?: { message?: string };
        }>('GET', '/api/v1/shops/me');
        if (r.status === 200 && r.data?.data) {
          setShop(r.data.data);
        } else if (r.status === 401) {
          setError('Session expired. Please log in again.');
        } else {
          setError(r.data?.error?.message ?? 'Could not load shop profile.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // ── Render: loading ──
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Staff & Permissions"
          description="See who has access to your shop and what each role can do."
        />
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  // ── Render: hard error (no shop loaded) ──
  if (error && !shop) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Staff & Permissions"
          description="See who has access to your shop and what each role can do."
        />
        <Card className="border-danger/30 bg-danger-soft">
          <CardHeader>
            <CardTitle className="text-base text-danger">
              Couldn&apos;t load staff information
            </CardTitle>
            <CardDescription className="text-danger">{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => void load()}
              variant="outline"
              size="sm"
              className="min-h-[44px] gap-1.5"
            >
              <RefreshCw className="size-4" /> Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff & Permissions"
        description="See who has access to your shop and what each role can do."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="min-h-[44px] gap-1.5"
            aria-label="Refresh staff information"
          >
            {refreshing ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        }
      />

      {error && (
        <Card className="border-warning/30 bg-warning-soft">
          <CardContent className="p-4 text-sm text-warning-foreground">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Upgrade notice — staff management requires a higher tier */}
      <Card className="border-brand/30 bg-brand-soft">
        <CardContent className="flex flex-col gap-4 p-4 sm:p-5 sm:flex-row sm:items-start">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Lock className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                Staff management requires a higher subscription tier
              </h2>
              <Badge variant="outline" className="border-brand/30 bg-brand-soft text-brand text-xs">
                Upgrade required
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Inviting teammates, assigning roles, and revoking access are
              available on the Growth and Pro plans. On the Free plan your shop
              runs with a single owner account. Upgrade to add managers,
              operators, and cashiers as your shop grows.
            </p>
            <Button
              asChild
              size="sm"
              className="mt-3 min-h-[44px] gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90"
            >
              <Link href="/shop/settings">
                View plans &amp; upgrade
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Current staff list — only the owner is shown until the staff API
          ships. We render the owner from the auth context (email + role) +
          the shop profile (name + phone). */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck className="size-4 text-brand" aria-hidden="true" />
            Current staff
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Everyone with access to this shop. On the Free plan, that&apos;s just
            you — the owner.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Shop</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="pr-4 text-right">Access</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="pl-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        <Crown
                          className="size-3.5 text-warning-foreground"
                          aria-hidden="true"
                        />
                        {api.email ?? 'Owner account'}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Mail className="size-3" aria-hidden="true" />
                        {api.email ?? 'No email on file'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="gap-1.5 border-warning/30 bg-warning-soft text-warning-foreground"
                    >
                      <Crown className="size-3.5" aria-hidden="true" />
                      Owner
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                    {shop?.name ?? '—'}
                    {shop?.slug ? (
                      <span className="ml-1 font-mono text-xs">({shop.slug})</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge
                      variant="outline"
                      className="gap-1.5 border-success/30 bg-success-soft text-success"
                    >
                      <span
                        className="inline-block size-1.5 rounded-full bg-success"
                        aria-hidden="true"
                      />
                      Active
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-4 text-right text-xs text-muted-foreground">
                    Full access
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <Separator />
          <div className="flex flex-col gap-2 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-1.5">
              <AlertCircle className="size-3.5" aria-hidden="true" />
              {shop
                ? `${shop.name} currently has 1 staff member (the owner).`
                : 'This shop currently has 1 staff member (the owner).'}
            </span>
            <span>
              Need more seats? Upgrade your plan to invite teammates.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Permission matrix */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck className="size-4 text-brand" aria-hidden="true" />
            Permission matrix
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            What each role will be able to do once multi-staff access is enabled
            on your plan. The owner always has full access.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Permission</TableHead>
                  {ROLE_ORDER.map((role) => (
                    <TableHead key={role} className="text-center">
                      {ROLE_LABEL[role]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {PERMISSIONS.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell className="pl-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">
                          {p.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {p.description}
                        </span>
                      </div>
                    </TableCell>
                    {ROLE_ORDER.map((role) => (
                      <TableCell key={role} className="text-center">
                        <PermissionCell allowed={p.roles[role]} role={role} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Role descriptions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <RoleCard
          title="Owner"
          description="Full control. Manages settings, staff, and money. There is exactly one owner per shop."
          icon={<Crown className="size-4" aria-hidden="true" />}
        />
        <RoleCard
          title="Manager"
          description="Runs day-to-day operations: orders, payments, refunds, and pricing. Cannot change shop settings or invite staff."
          icon={<ShieldCheck className="size-4" aria-hidden="true" />}
        />
        <RoleCard
          title="Operator"
          description="Handles the print floor: accepts orders and marks them ready or collected. No payment or refund access."
          icon={<Check className="size-4" aria-hidden="true" />}
        />
        <RoleCard
          title="Cashier"
          description="Focused on the counter: verifies payments and hands over printed orders. Does not accept new orders."
          icon={<Check className="size-4" aria-hidden="true" />}
        />
      </div>

      {/* Empty-state CTA in case the shop has no profile yet */}
      {!shop && (
        <Card className="bg-surface">
          <CardContent className="p-0">
            <EmptyState
              className="px-4 py-10"
              icon={<ShieldCheck className="size-6" />}
              title="Shop profile not loaded"
              description="We couldn't load your shop profile, so some details are missing. Try refreshing, or complete your shop profile in settings."
              action={
                <Button asChild variant="outline" size="sm" className="mt-2 min-h-[44px] gap-1.5">
                  <Link href="/shop/settings">
                    Open settings
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ── Local UI helpers ────────────────────────────────────────────────── */

function PermissionCell({ allowed, role }: { allowed: boolean; role: Role }) {
  if (allowed) {
    return (
      <span
        className="inline-flex size-6 items-center justify-center rounded-full bg-success-soft text-success"
        role="img"
        aria-label={`${ROLE_LABEL[role]}: allowed`}
      >
        <Check className="size-3.5" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground"
      role="img"
      aria-label={`${ROLE_LABEL[role]}: not allowed`}
    >
      <Minus className="size-3.5" aria-hidden="true" />
    </span>
  );
}

function RoleCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="bg-surface">
      <CardContent className="flex flex-col gap-2 p-5">
        <div className="flex size-8 items-center justify-center rounded-md bg-brand-soft text-brand">
          {icon}
        </div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
