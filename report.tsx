import { createFileRoute } from '@tanstack/react-router';
import App from '@generated/App';

// Optional ?ticket=<item id>&board=request|incident opens the single-ticket Harvest sync.
export const Route = createFileRoute('/_app/report')({
  validateSearch: (search: Record<string, unknown>): { ticket?: string; board?: 'request' | 'incident' } => ({
    ticket: typeof search.ticket === 'string' || typeof search.ticket === 'number' ? String(search.ticket) : undefined,
    board: search.board === 'incident' ? 'incident' : search.board === 'request' ? 'request' : undefined,
  }),
  component: App,
});
