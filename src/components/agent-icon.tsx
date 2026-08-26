import {
  BookOpenText,
  Bot,
  Clapperboard,
  Gauge,
  ImagePlus,
  LineChart,
  Mic,
  PenLine,
  Radar,
  Scale,
  Send,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Radar,
  Scale,
  BookOpenText,
  PenLine,
  ShieldCheck,
  Clapperboard,
  Mic,
  ImagePlus,
  Gauge,
  Send,
  LineChart,
};

export function AgentIcon({ icon, className }: { icon: string; className?: string }) {
  const Cmp = ICONS[icon] ?? Bot;
  return <Cmp className={className} />;
}
