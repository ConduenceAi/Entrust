import { useEffect, useState } from "react";
import { Bot, CalendarDays, Check, Code2, FileText, KeyRound, ShieldCheck, Users } from "lucide-react";

const FEATURES = [
  {
    title: "Engineering renews subscriptions",
    description: "Approved vendors get paid within their limits. New vendors go to the owner for review.",
    steps: [
      { icon: Code2, label: "Request", text: "Renew Newsliquid", detail: "8 NEAR" },
      { icon: ShieldCheck, label: "Check", text: "Vendor and budget verified", detail: "Approved" },
      { icon: Check, label: "Pay", text: "Subscription renewed", detail: "8 NEAR sent" },
    ],
  },
  {
    title: "HR runs payroll",
    description: "Approve a new employee’s wallet once, then pay them on their weekly or monthly schedule.",
    steps: [
      { icon: Users, label: "New hire", text: "Add Jordan Lee", detail: "jordan-lee.near" },
      { icon: KeyRound, label: "Review", text: "Owner approves wallet", detail: "Verified" },
      { icon: CalendarDays, label: "Schedule", text: "Weekly payroll scheduled", detail: "40 NEAR" },
    ],
  },
  {
    title: "Agents buy from agents",
    description: "Agents buy data and API access over x402 in USDC, within the owner’s seller limits.",
    steps: [
      { icon: Bot, label: "Request", text: "Fetch research data", detail: "Paid API" },
      { icon: ShieldCheck, label: "Check", text: "Price is within the seller limit", detail: "0.05 USDC" },
      { icon: FileText, label: "Result", text: "Research data delivered", detail: "0.05 USDC paid" },
    ],
  },
];

function PaymentFeatureCard({ feature }: { feature: typeof FEATURES[number] }) {
  const [step, setStep] = useState(0);
  const [manual, setManual] = useState(false);
  const [paused, setPaused] = useState(false);
  const current = feature.steps[step];
  const Icon = current.icon;

  useEffect(() => {
    if (manual || paused) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = window.setTimeout(() => {
      if (!motion.matches) setStep((index) => (index + 1) % feature.steps.length);
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [step, manual, paused, feature]);

  return (
    <article>
      <div className="feature-preview" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div aria-live={manual ? "polite" : "off"}>
          <div className="feature-preview-result" key={step}>
            <Icon size={18} aria-hidden="true" />
            <strong>{current.text}</strong>
            <span>{current.detail}</span>
          </div>
        </div>
        <div className="feature-preview-steps" role="group" aria-label={feature.title + " steps"} onFocus={() => setManual(true)}>
          {feature.steps.map(({ icon: StepIcon, label }, index) => (
            <button key={label} type="button" aria-pressed={index === step} onClick={() => { setManual(true); setStep(index); }}>
              <span><StepIcon size={19} aria-hidden="true" /></span>
              {label}
            </button>
          ))}
        </div>
      </div>
      <h3>{feature.title}</h3>
      <p>{feature.description}</p>
    </article>
  );
}

export function PaymentFeatureCards() {
  return <div className="department-grid">{FEATURES.map((feature) => <PaymentFeatureCard key={feature.title} feature={feature} />)}</div>;
}
