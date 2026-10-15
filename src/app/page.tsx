import { Hero } from '@/components/phase1/hero';
import { ArchitectureExplorer } from '@/components/phase1/architecture-explorer';
import { PricingCalculator } from '@/components/phase1/pricing-calculator';
import { AdapterMatrix } from '@/components/phase1/adapter-matrix';
import { Deliverables } from '@/components/phase1/deliverables';
import { Roadmap } from '@/components/phase1/roadmap';
import { SiteFooter } from '@/components/phase1/site-footer';
import { BackendExplorer } from '@/components/phase2/backend-explorer';
import { PaymentsExplorer } from '@/components/phase3/payments-explorer';
import { CustomerApp } from '@/components/phase4/customer-app';
import { ShopDashboard } from '@/components/phase5/shop-dashboard';
import { ObservabilityDeploy } from '@/components/phase7/observability-deploy';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Hero />
      <main className="flex-1">
        <CustomerApp />
        <ShopDashboard />
        <PaymentsExplorer />
        <BackendExplorer />
        <ObservabilityDeploy />
        <PricingCalculator />
        <ArchitectureExplorer />
        <AdapterMatrix />
        <Deliverables />
        <Roadmap />
      </main>
      <SiteFooter />
    </div>
  );
}
