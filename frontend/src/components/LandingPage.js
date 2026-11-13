import React, { useState } from "react";
import { ArrowRight, BookOpen, BrainCircuit, CheckCircle2, Clock3, FileQuestion, ShieldCheck, Sparkles } from "lucide-react";
import { hasAnalyticsConsent, isAnalyticsConfigured, setAnalyticsConsent, trackEvent } from "../services/analytics";
import "./LandingPage.css";

function LandingPage({ onGetStarted, onSignIn, onOpenLegal }) {
  const [analyticsChoiceMade, setAnalyticsChoiceMade] = useState(() => hasAnalyticsConsent() || localStorage.getItem("planify:analytics-consent") === "denied");
  const startRegistration = () => {
    trackEvent("planify_begin_sign_up", { placement: "landing_page" });
    onGetStarted();
  };
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Primary navigation">
        <button className="landing-brand" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Planify home">
          <BookOpen size={25} /> <span>Planify</span>
        </button>
        <div className="landing-nav-actions">
          <button className="landing-login" type="button" onClick={onSignIn}>Sign in</button>
          <button className="landing-nav-cta" type="button" onClick={startRegistration}>Create free account</button>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow"><Sparkles size={15} /> AI study planning that starts with your real syllabus</p>
          <h1>Plan what matters.<br /><em>Study with direction.</em></h1>
          <p className="landing-lead">Planify turns your subjects, complete syllabus and previous-year papers into a practical weekly study plan—built around your exam dates and sleep schedule.</p>
          <div className="landing-hero-actions">
            <button className="landing-primary-cta" type="button" onClick={startRegistration}>Build my study plan <ArrowRight size={18} /></button>
            <a className="landing-secondary-cta" href="#how-it-works">See how it works</a>
          </div>
          <p className="landing-reassurance"><CheckCircle2 size={15} /> Start free · Keep control of every subject and topic</p>
        </div>
        <div className="landing-preview" aria-label="Planify feature preview">
          <div className="landing-preview-top"><span className="landing-live-dot" /> Your study week <span>Today</span></div>
          <div className="landing-preview-score"><div><small>Weekly focus</small><strong>Balanced plan</strong></div><span>7 days</span></div>
          <div className="landing-preview-task high"><span>PYQ priority</span><b>Current Electricity</b><small>High-frequency topic from your papers</small></div>
          <div className="landing-preview-task"><span>Focus block</span><b>Data Structures</b><small>Phase 2 · 50 min deep work</small></div>
          <div className="landing-preview-bottom"><Clock3 size={16} /> Sleep-aware planning keeps your workload realistic.</div>
        </div>
      </section>

      <section className="landing-proof" aria-label="Core capabilities">
        <span><ShieldCheck size={17} /> Your entered topics always stay in your control</span>
        <span><FileQuestion size={17} /> PYQs influence priority—not your entire timetable</span>
        <span><Clock3 size={17} /> Sleep hours are required before planning</span>
      </section>

      <section className="landing-section" id="how-it-works">
        <div className="landing-section-heading">
          <p className="landing-eyebrow">A plan you can trust</p>
          <h2>More than a generic timetable</h2>
          <p>Planify keeps the student in control while using AI only where it adds genuine academic value.</p>
        </div>
        <div className="landing-feature-grid">
          <article className="landing-feature-card"><div className="landing-feature-icon"><BookOpen size={23} /></div><h3>Your syllabus, structured</h3><p>Upload the complete syllabus. Planify extracts subjects, units and topics, then asks you to review before using it.</p></article>
          <article className="landing-feature-card"><div className="landing-feature-icon"><FileQuestion size={23} /></div><h3>PYQs with boundaries</h3><p>Previous-year questions add a capped priority signal only for topics confirmed in your syllabus.</p></article>
          <article className="landing-feature-card"><div className="landing-feature-icon"><BrainCircuit size={23} /></div><h3>Adaptive daily focus</h3><p>Difficulty, exam urgency and available hours work together to create a schedule that stays realistic.</p></article>
        </div>
      </section>

      <section className="landing-steps">
        <div className="landing-section-heading"><p className="landing-eyebrow">Simple by design</p><h2>From syllabus to study session</h2></div>
        <ol>
          <li><span>01</span><div><h3>Add subjects and topics</h3><p>Keep your existing curriculum inputs exactly as you know them.</p></div></li>
          <li><span>02</span><div><h3>Review syllabus and PYQ insights</h3><p>Confirm what AI extracts; remove any paper that should not affect your plan.</p></div></li>
          <li><span>03</span><div><h3>Follow your weekly plan</h3><p>Generate focus blocks, track progress, revise, and adjust as your exam approaches.</p></div></li>
        </ol>
      </section>

      <section className="landing-final-cta">
        <p className="landing-eyebrow">Start with the subjects you already have</p>
        <h2>Make your next study session count.</h2>
        <p>Create your Planify account and build a plan that reflects your real academic workload.</p>
        <button className="landing-primary-cta" type="button" onClick={startRegistration}>Create free account <ArrowRight size={18} /></button>
      </section>

      <footer className="landing-footer">
        <span><BookOpen size={17} /> Planify</span><span>AI study planning for focused learners.</span>
        <span className="landing-legal-links"><button type="button" onClick={() => onOpenLegal("privacy")}>Privacy</button><button type="button" onClick={() => onOpenLegal("terms")}>Terms</button></span>
        {isAnalyticsConfigured() && !analyticsChoiceMade && <span className="analytics-consent">Help us improve Planify with anonymous usage analytics? <button onClick={() => { setAnalyticsConsent(true); setAnalyticsChoiceMade(true); }}>Allow</button><button onClick={() => { setAnalyticsConsent(false); setAnalyticsChoiceMade(true); }}>No thanks</button></span>}
      </footer>
    </main>
  );
}

export default LandingPage;
