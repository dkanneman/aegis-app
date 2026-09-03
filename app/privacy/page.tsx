import type { Metadata } from "next";
import Link from "next/link";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Privacy · Pepper",
  description: "Privacy information for the Pepper family concierge beta.",
};

const sections = [
  {
    title: "Information Pepper uses",
    body: [
      "Pepper stores information that household members provide, including names, schedules, tasks, chores, transportation assignments, meal plans, grocery items, goals, and preferences.",
      "When a household chooses to connect an outside service, Pepper may process calendar events, relevant email content, or Apple Health summaries needed to provide the requested family-planning features. Connections are optional.",
    ],
  },
  {
    title: "How information is used",
    body: [
      "Pepper uses household information to organize daily plans, show member-specific views, assign responsibility, identify schedule conflicts, prepare briefings, and keep shared changes synchronized.",
      "Pepper does not sell personal information, use it for advertising, or create advertising profiles.",
    ],
  },
  {
    title: "Sharing and service providers",
    body: [
      "Information is shared within a household only as permitted by the product's household and privacy controls. Private items remain limited to the appropriate member or authorized adult.",
      "Pepper relies on infrastructure providers, including Supabase and Vercel, to operate the beta. Apple and Google process information according to their own terms when their services are connected or used to install Pepper.",
    ],
  },
  {
    title: "Security and retention",
    body: [
      "Pepper uses access controls, scoped household sessions, and encrypted network connections. No online service can guarantee absolute security.",
      "Beta information is retained while the household account is active or as needed to operate and protect the service. Household members can edit or remove supported items and delete their Pepper account from the Connections screen.",
    ],
  },
  {
    title: "Children and family accounts",
    body: [
      "Pepper is a private family beta used under the direction of a parent or household administrator. It does not offer public account creation for children. Adult household administrators control family setup and shared permissions.",
    ],
  },
  {
    title: "Your choices",
    body: [
      "Households may choose whether to connect calendars, email, or health information. Connected services can be disconnected, and device access can be removed by signing out or deleting Pepper from the device.",
      "For privacy questions, correction requests, or help with household-wide deletion during the beta, contact the Pepper team through the Feedback option in TestFlight.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/pepper" aria-label="Return to Pepper">
            <span className={styles.mark}>P</span>
            <span>Pepper</span>
          </Link>
          <p>Private family beta</p>
        </div>
      </header>

      <article className={styles.article}>
        <p className={styles.eyebrow}>Privacy</p>
        <h1>Your family information stays in service of your family.</h1>
        <p className={styles.intro}>
          This notice explains how the Pepper family concierge beta handles information.
          Pepper is the visible product; Aegis is the underlying system that organizes and
          acts on household state.
        </p>
        <p className={styles.effective}>Effective September 3, 2026</p>

        <div className={styles.rule} />

        {sections.map((section) => (
          <section className={styles.section} key={section.title}>
            <h2>{section.title}</h2>
            <div>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </section>
        ))}

        <footer className={styles.footer}>
          <p>This notice may be updated as the beta and its connections evolve.</p>
          <Link href="/pepper">Return to Pepper</Link>
        </footer>
      </article>
    </main>
  );
}
