import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app')({
  component: AppLayout,
});

const tab = 'inline-flex h-12 shrink-0 items-center border-b-2 border-transparent px-3 text-sm text-primary-foreground/75 transition-colors hover:text-primary-foreground [&.active]:border-primary-foreground [&.active]:font-medium [&.active]:text-primary-foreground';

function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-30 flex items-center gap-1 overflow-x-auto bg-primary px-4 font-[family-name:var(--font-body)] sm:px-8">
        <span className="mr-4 shrink-0 text-sm font-semibold tracking-tight text-primary-foreground">Jackadder International</span>
        <Link to="/" activeOptions={{ exact: true }} className={tab}>Home</Link>
        <Link to="/report" className={tab}>Monthly Reporting</Link>
        <Link to="/harvest" className={tab}>Harvest Monthly Data Upload</Link>
      </nav>
      <Outlet />
    </div>
  );
}
