import { ArrowRight, Code2, KeyRound, Users, Wallet } from "lucide-react";
import { PaymentFeatureCards } from "../components/PaymentFeatureCards.tsx";
import { PaymentDemo } from "../components/PaymentDemo.tsx";
import { PaymentPolicyPreview } from "../components/PaymentPolicyPreview.tsx";
import { WalletEntry } from "../components/WalletEntry.tsx";
import { Brand } from "../components/Brand.tsx";
import { WaitlistFooter } from "../components/WaitlistFooter.tsx";
import { href } from "../router.ts";
import { featuredPlatforms } from "../platforms.ts";

export function Landing() {
  return (
    <div className="landing">
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-art" aria-hidden="true" />
          <header className="header-inner landing-hero-header">
            <Brand />
            <div className="top-actions">
              <WalletEntry placement="header" />
            </div>
          </header>
          <div className="hero-inner">
            <div className="hero-copy">
              <h1 id="hero-title">Let agents pay.<br /><span>Keep the keys.</span></h1>
              <p className="lead">Give agents a budget from your existing NEAR account. You choose who they can pay and how much.</p>
              <div className="cta-row">
                <WalletEntry placement="landing" />
                <a className="text-link" href={href("/docs")}>Read the docs <ArrowRight size={15} /></a>
              </div>
            </div>

            <PaymentPolicyPreview />
          </div>
          <div className="landing-compatible" aria-label="Compatible with these local MCP clients">
            <span>Works with</span>
            <ul>
              {featuredPlatforms.map((platform) => (
                <li key={platform.id}>
                  {platform.icon && <img className="integration-icon" data-client={platform.id} src={"/integrations/" + platform.icon} width={21} height={21} alt="" />}
                  {platform.name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <PaymentDemo />
        <section className="landing-section department-section" id="how-it-works" aria-labelledby="departments-title">
          <header className="section-intro">
            <h2 id="departments-title">Who can agents pay from your wallet?</h2>
            <p className="lead">Signing every subscription and paycheck slows teams down. With one NEAR wallet and a restricted key per agent, the owner can delegate routine payments and review new payees.</p>
          </header>
          <ol className="problem-strip" aria-label="Three ways to let agents pay">
            <li data-tone="bad"><strong>The owner signs everything</strong><span>Every team waits on one person.</span></li>
            <li data-tone="bad"><strong>The agent holds the wallet key</strong><span>One bad prompt can spend it all.</span></li>
            <li data-tone="good"><strong>Entrust</strong><span>Agents pay within your rules. The chain enforces them.</span></li>
          </ol>
          <figure className="company-map" aria-label="One company wallet delegates payments to two departments">
              <div className="company-wallet">
                <Wallet size={21} aria-hidden="true" />
                <div><strong>Company wallet</strong><code>company.near</code></div>
              </div>
              <div className="company-branches">
                <div><Code2 size={19} aria-hidden="true" /><strong>Engineering</strong><code>engineering.company.near</code><small>Approved subscriptions</small></div>
                <div><Users size={19} aria-hidden="true" /><strong>HR</strong><code>hr.company.near</code><small>Weekly and monthly payroll</small></div>
              </div>
              <figcaption><KeyRound size={15} aria-hidden="true" /> Each agent gets a restricted key.</figcaption>
            </figure>
          <PaymentFeatureCards />
        </section>

      </main>
      <WaitlistFooter />
    </div>
  );
}
