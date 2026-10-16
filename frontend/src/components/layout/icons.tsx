import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const HomeIcon = () => (
  <Svg>
    <path d="M4 11.5L12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1v-7.5Z" />
  </Svg>
);
export const InvoiceIcon = () => (
  <Svg>
    <path d="M6 3h9l3 3v15H6V3Z" />
    <path d="M9 10h6M9 14h6M9 18h3" />
  </Svg>
);
export const CustomersIcon = () => (
  <Svg>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
    <path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 14.6c1.8.5 2.8 2 3 4.4" />
  </Svg>
);
export const MoreIcon = () => (
  <Svg>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
  </Svg>
);
export const BackIcon = () => (
  <Svg>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);
