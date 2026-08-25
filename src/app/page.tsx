import { AppShell } from '@/components/app/AppShell';

/**
 * The whole app is one client-rendered screen.
 *
 * There is no server component work to do: the workbook is parsed in the
 * browser, the boundaries are static assets, and nothing is fetched from an
 * origin we control. Per CLAUDE.md, no data round-trips a server.
 */
export default function HomePage() {
  return <AppShell />;
}
