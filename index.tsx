import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, FileBarChart2, UploadCloud } from 'lucide-react';

export const Route = createFileRoute('/_app/')({ component: Start });

function Start() {
  const card = 'group flex min-h-[220px] flex-col justify-between rounded-lg border border-border bg-card p-6 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <div className="px-4 py-14 font-[family-name:var(--font-body)] text-foreground sm:px-8 sm:py-20">
      <div className="mx-auto max-w-[1000px]">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Jackadder International · Managed Services</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Service Desk Administration</h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground">Please select the function you wish to perform.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Link to="/report" className={card}>
            <div>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-accent text-accent-foreground"><FileBarChart2 className="h-5 w-5" /></span>
              <h2 className="mt-5 text-xl font-semibold">Monthly Reporting</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">Prepare the client Service Desk Report, record the draft balances and finalise the reporting month.</p>
            </div>
            <span className="mt-6 inline-flex w-fit items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Proceed to Reporting <ArrowRight className="h-4 w-4" /></span>
          </Link>
          <Link to="/harvest" className={card}>
            <div>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-accent text-accent-foreground"><UploadCloud className="h-5 w-5" /></span>
              <h2 className="mt-5 text-xl font-semibold">Harvest Monthly Data Upload</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">Retrieve completed, closed and resolved tickets for the selected period and submit them as time entries in Harvest.</p>
            </div>
            <span className="mt-6 inline-flex w-fit items-center gap-1.5 rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary">Proceed to Harvest Upload <ArrowRight className="h-4 w-4" /></span>
          </Link>
        </div>
      </div>
    </div>
  );
}
