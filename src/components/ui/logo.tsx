import React from "react";

interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "horizontal" | "icon" | "stacked";
  size?: "sm" | "md" | "lg" | "xl";
  showDirectorate?: boolean;
}

export const LogoIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
  className = "w-8 h-8",
  ...props
}) => (
  <svg
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`shrink-0 select-none ${className}`}
    {...props}
  >
    <defs>
      <linearGradient id="rm-ico-primary" x1="16" y1="16" x2="104" y2="104" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#1E3A8A" />
        <stop offset="45%" stopColor="#2563EB" />
        <stop offset="100%" stopColor="#0284C7" />
      </linearGradient>
      <linearGradient id="rm-ico-accent" x1="42" y1="52" x2="96" y2="104" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0284C7" />
        <stop offset="50%" stopColor="#0D9488" />
        <stop offset="100%" stopColor="#10B981" />
      </linearGradient>
      <linearGradient id="rm-ico-node" x1="40" y1="50" x2="60" y2="70" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#34D399" />
        <stop offset="100%" stopColor="#059669" />
      </linearGradient>
    </defs>

    {/* Squircle Container */}
    <rect x="6" y="6" width="108" height="108" rx="28" fill="#0F172A" stroke="#334155" strokeWidth="1.5" />

    {/* Data Matrix Grid Lines */}
    <path d="M6 36 H114 M6 60 H114 M6 84 H114" stroke="#334155" strokeWidth="1" strokeDasharray="2 4" strokeOpacity="0.45" />
    <path d="M36 6 V114 M60 6 V114 M84 6 V114" stroke="#334155" strokeWidth="1" strokeDasharray="2 4" strokeOpacity="0.45" />

    {/* Master Reference Pillar (Sampling Frame) */}
    <rect x="26" y="24" width="16" height="72" rx="8" fill="url(#rm-ico-primary)" />
    <rect x="30" y="38" width="8" height="2" rx="1" fill="#93C5FD" fillOpacity="0.8" />
    <rect x="30" y="58" width="8" height="2" rx="1" fill="#93C5FD" fillOpacity="0.8" />
    <rect x="30" y="78" width="8" height="2" rx="1" fill="#93C5FD" fillOpacity="0.8" />

    {/* Reconcile Loop ('R' Upper Arch / Input Stream) */}
    <path
      d="M36 24 H64 C79.464 24 92 33.8497 92 46 C92 58.1503 79.464 68 64 68 H42"
      stroke="url(#rm-ico-primary)"
      strokeWidth="14"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    {/* Matching Diagonal Leg */}
    <path d="M50 62 L78 96" stroke="url(#rm-ico-accent)" strokeWidth="14" strokeLinecap="round" />

    {/* Center Match Point (Exact Match Reconciliation Node) */}
    <circle cx="50" cy="62" r="7.5" fill="#0F172A" />
    <circle cx="50" cy="62" r="5" fill="url(#rm-ico-node)" />
    <circle cx="50" cy="62" r="2" fill="#ECFDF5" />

    {/* Target Link Nodes */}
    <circle cx="89" cy="46" r="3.5" fill="#38BDF8" />
    <circle cx="78" cy="96" r="3.5" fill="#34D399" />
  </svg>
);

export const Logo: React.FC<LogoProps> = ({
  variant = "horizontal",
  size = "md",
  showDirectorate = true,
  className = "",
  ...props
}) => {
  if (variant === "icon") {
    const sizeMap = {
      sm: "w-6 h-6",
      md: "w-8 h-8",
      lg: "w-10 h-10",
      xl: "w-14 h-14",
    };
    return <LogoIcon className={`${sizeMap[size]} ${className}`} />;
  }

  const iconSizes = {
    sm: "w-7 h-7",
    md: "w-9 h-9",
    lg: "w-12 h-12",
    xl: "w-16 h-16",
  };

  const titleSizes = {
    sm: "text-sm",
    md: "text-lg",
    lg: "text-2xl",
    xl: "text-3xl",
  };

  const subSizes = {
    sm: "text-[10px]",
    md: "text-xs",
    lg: "text-sm",
    xl: "text-base",
  };

  const directorateSizes = {
    sm: "text-[8.5px]",
    md: "text-[10px]",
    lg: "text-xs",
    xl: "text-xs",
  };

  if (variant === "stacked") {
    return (
      <div className={`flex flex-col items-center text-center gap-2 select-none ${className}`} {...props}>
        <LogoIcon className={iconSizes[size]} />
        <div className="flex flex-col items-center">
          <span className={`font-extrabold tracking-tight text-foreground ${titleSizes[size]}`}>
            RE-
            <span className="bg-gradient-to-r from-blue-600 via-sky-600 to-emerald-600 bg-clip-text text-transparent">
              MATCH
            </span>
          </span>
          <span className={`font-semibold tracking-wide text-blue-600 dark:text-blue-400 mt-0.5 ${subSizes[size]}`}>
            Sistem Matching Data
          </span>
          {showDirectorate && (
            <span className={`font-medium text-muted-foreground mt-0.5 max-w-sm ${directorateSizes[size]}`}>
              Direktorat Statistik Sumber Daya Mineral dan Konstruksi
            </span>
          )}
        </div>
      </div>
    );
  }

  // Horizontal variant (default)
  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`} {...props}>
      <LogoIcon className={iconSizes[size]} />
      <div className="flex flex-col min-w-0 leading-tight">
        <div className="flex items-center gap-1.5">
          <span className={`font-extrabold tracking-tight text-foreground ${titleSizes[size]}`}>
            RE-
            <span className="bg-gradient-to-r from-blue-600 via-sky-600 to-emerald-600 bg-clip-text text-transparent">
              MATCH
            </span>
          </span>
        </div>
        <span className={`font-semibold tracking-wide text-blue-600 dark:text-blue-400 mt-0.5 truncate ${subSizes[size]}`}>
          Sistem Matching Data
        </span>
        {showDirectorate && (
          <span className={`font-medium text-muted-foreground truncate mt-0.5 ${directorateSizes[size]}`}>
            Direktorat Statistik Sumber Daya Mineral dan Konstruksi
          </span>
        )}
      </div>
    </div>
  );
};

export default Logo;
