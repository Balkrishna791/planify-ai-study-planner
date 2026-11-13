import React from "react";
import { ArrowLeft, BookOpen } from "lucide-react";
import "./LegalPage.css";

function PrivacyPolicy() {
  return <>
    <h1>Privacy Policy</h1>
    <p className="legal-updated">Last updated: 1 October 2026</p>
    <p>Planify is an AI study-planning tool. This policy explains what Planify stores when you create an account and how you can control that data.</p>
    <h2>Information you provide</h2>
    <p>Planify stores your name, email address, password hash, education level, subjects, topics, exam dates, study plans, progress, revision queue, and optional syllabus and previous-year-paper analysis results.</p>
    <h2>Syllabus and previous-year papers</h2>
    <p>Uploaded syllabus and PYQ files are analysed in memory. Planify stores the reviewed structured results and paper metadata needed to create your plan; it does not publish your uploaded files.</p>
    <h2>Analytics</h2>
    <p>Analytics are off unless you choose Allow on the public site. When enabled, Planify sends only limited product events such as a landing-page signup click or a plan-generation event. It does not send your name, email, subjects, topics, uploaded file contents, or quiz answers through these events.</p>
    <h2>Your choices</h2>
    <p>From Profile, you can download your stored account data or permanently delete your account. Deletion removes your profile and associated study data from Planify’s active database. Account deletion requires your current password and an explicit confirmation.</p>
    <h2>Security</h2>
    <p>Planify uses access controls and password hashing, but no internet service can promise absolute security. Keep your password private and do not upload material you are not allowed to share.</p>
  </>;
}

function TermsOfUse() {
  return <>
    <h1>Terms of Use</h1>
    <p className="legal-updated">Last updated: 1 October 2026</p>
    <p>By using Planify, you agree to use it responsibly as a study-support tool.</p>
    <h2>Study assistance, not a guarantee</h2>
    <p>Planify uses your inputs and AI-assisted analysis to suggest study plans, syllabus structure, priorities, and quizzes. These outputs can be incomplete or incorrect. Review every plan against your official syllabus, timetable, institution guidance, and exam requirements.</p>
    <h2>Your content</h2>
    <p>You are responsible for the information and files you add. Upload only material you are permitted to use and share. Do not submit harmful, illegal, or someone else’s private information.</p>
    <h2>Your account</h2>
    <p>Keep your password confidential and provide accurate account details. You are responsible for activity completed through your account.</p>
    <h2>Availability and changes</h2>
    <p>Planify may change, improve, pause, or remove features as the product develops. We will update these terms when material changes are made.</p>
    <h2>Ending use</h2>
    <p>You may stop using Planify at any time. Use the Profile page to download your data or permanently delete your account.</p>
  </>;
}

function LegalPage({ page, onBack, onGetStarted }) {
  const isPrivacy = page === "privacy";
  return (
    <main className="legal-page">
      <nav className="legal-nav">
        <button className="legal-brand" type="button" onClick={onBack}><BookOpen size={23} /> Planify</button>
        <button className="legal-start" type="button" onClick={onGetStarted}>Create free account</button>
      </nav>
      <article className="legal-card">
        <button className="legal-back" type="button" onClick={onBack}><ArrowLeft size={17} /> Back to Planify</button>
        {isPrivacy ? <PrivacyPolicy /> : <TermsOfUse />}
      </article>
    </main>
  );
}

export default LegalPage;
