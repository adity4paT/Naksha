'use client';

/**
 * Navigation breadcrumb: India › Gujarat › Kutch.
 *
 * Every level is clickable, including the one you are on (a no-op, but not
 * disabled — a disabled current step is a common trap for keyboard users who
 * tab into it and get no feedback about why nothing happens).
 *
 * Rendered as an ordered list inside `<nav aria-label="Breadcrumb">`, which is
 * what screen readers expect; the current step carries `aria-current="page"`.
 */

import type { BreadcrumbStep } from '@/store/filters';

export interface BreadcrumbProps {
  readonly trail: readonly BreadcrumbStep[];
  /** Called with the depth clicked: 0 = India, 1 = state, 2 = district. */
  readonly onNavigate: (depth: 0 | 1 | 2) => void;
}

export function Breadcrumb({ trail, onNavigate }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-1 text-sm">
        {trail.map((step, index) => {
          const isCurrent = index === trail.length - 1;

          return (
            <li key={`${step.level}-${step.label}`} className="flex items-center gap-1">
              {index > 0 && (
                <span aria-hidden="true" className="text-slate-300 dark:text-neutral-600">
                  ›
                </span>
              )}
              <button
                type="button"
                onClick={() => onNavigate(Math.min(index, 2) as 0 | 1 | 2)}
                aria-current={isCurrent ? 'page' : undefined}
                className={
                  isCurrent
                    ? 'rounded px-1.5 py-0.5 font-medium text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-neutral-100'
                    : 'rounded px-1.5 py-0.5 text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-neutral-400 dark:hover:text-neutral-100'
                }
              >
                {step.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
