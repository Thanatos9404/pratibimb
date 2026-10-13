import { BlurWords, Reveal } from "@/components/motion/primitives";
import { cn } from "@/lib/utils";

/** OBLIQ section anatomy: eyebrow → two-line H2 (second line softer) → short paragraph. */
export function SectionHead({
  eyebrow,
  line1,
  line2,
  children,
  align = "center",
  className,
}: {
  eyebrow: string;
  line1: string;
  line2?: string;
  children?: React.ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div className={cn(align === "center" ? "mx-auto max-w-[760px] text-center" : "max-w-[560px]", className)}>
      <Reveal y={10}>
        <div className="eyebrow">{eyebrow}</div>
      </Reveal>
      <h2 className="h-section mt-4 text-[clamp(32px,4.4vw,52px)]">
        <BlurWords text={line1} className="block" inView />
        {line2 && <BlurWords text={line2} className="block text-[#8f8986]" inView delay={0.15} />}
      </h2>
      {children && (
        <Reveal delay={0.2}>
          <div className={cn("mt-5 text-[17px] leading-[1.6] text-body", align === "center" && "mx-auto max-w-[620px]")}>{children}</div>
        </Reveal>
      )}
    </div>
  );
}
