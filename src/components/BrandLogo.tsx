type Props = {
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
  force?: "light" | "dark";
};

/**
 * Logo Opción C: monograma + Montserrat (la más cercana al wordmark original:
 * geométrica tipo Gotham / Futura Bold).
 */
export function BrandLogo({ size = "md", className = "", force }: Props) {
  const sizes = { sm: "logo-sm", md: "logo-md", lg: "logo-lg", hero: "logo-hero" };
  const forceClass = force === "dark" ? "logo-force-dark" : force === "light" ? "logo-force-light" : "";

  return (
    <div
      className={`logo-brand logo-svg ${sizes[size]} ${forceClass} ${className}`.trim()}
      role="img"
      aria-label="TuSalud Ensurance Agency"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 603 646"
        fill="none"
        aria-hidden="true"
        textRendering="geometricPrecision"
        shapeRendering="geometricPrecision"
      >
        <path
          className="logo-slate"
          fillRule="evenodd"
          d="M154,0L154,105L249,105L250,208L285,220L285,71L190,71L189,37L411,37L410,71L315,71L315,225L411,259L410,318L299,384L189,317L189,272L154,260L154,338L300,425L445,338L445,234L349,200L350,105L445,105L445,0Z"
        />
        <path className="logo-slate" fillRule="evenodd" d="M250,281L250,328L285,349L285,292Z" />
        <path
          className="logo-teal"
          d="M155,153L156,232L313,286L315,288L315,348L349,327L348,263L191,209L188,206L189,172L202,162L232,162L232,128L192,128Z"
        />
        <path
          className="logo-teal"
          d="M368,128L368,162L397,162L411,172L411,196L445,208L445,154L407,128Z"
        />

        <text
          className="logo-wordmark"
          x="301.5"
          y="526"
          textAnchor="middle"
          fontFamily="Montserrat, 'Plus Jakarta Sans', system-ui, sans-serif"
          fontWeight="800"
          fontSize="80"
          letterSpacing="0.04em"
        >
          <tspan className="logo-ink">TU</tspan>
          <tspan className="logo-teal">SALU</tspan>
          <tspan className="logo-ink">D</tspan>
        </text>

        <text
          className="logo-ink logo-subtitle"
          x="301.5"
          y="594"
          textAnchor="middle"
          fontFamily="Montserrat, 'Plus Jakarta Sans', system-ui, sans-serif"
          fontWeight="500"
          fontSize="17"
          letterSpacing="0.38em"
        >
          ENSURANCE AGENCY
        </text>

        <rect className="logo-teal" x="168" y="636" width="267" height="5" rx="0.5" />
      </svg>
    </div>
  );
}
