import React from "react";
import { BookOpen, CheckCircle2, ChevronRight, Clock3, Sparkles, X } from "lucide-react";
import "./FirstPlanGuide.css";

function FirstPlanGuide({ hasSubjects, hasSleepHours, onChooseStep, onDismiss }) {
  const steps = [
    {
      id: "subjects", icon: BookOpen, title: "Add your first subject", description: "Add its exam date, difficulty, and at least one topic.", complete: hasSubjects,
    },
    {
      id: "syllabus", icon: Sparkles, title: "Optionally analyse your syllabus", description: "Upload the complete syllabus to review AI-extracted units and topics.", optional: true,
    },
    {
      id: "sleep", icon: Clock3, title: "Set daily sleep hours", description: "Required so Planify can make a realistic timetable.", complete: hasSleepHours,
    },
  ];
  const canGenerate = hasSubjects && hasSleepHours;

  return (
    <section className="first-plan-guide card" aria-labelledby="first-plan-guide-title">
      <div className="first-plan-guide-heading">
        <div><p>GET STARTED</p><h2 id="first-plan-guide-title">Build your first study plan</h2><span>Three quick steps. Your inputs stay editable at every stage.</span></div>
        <button type="button" onClick={onDismiss} className="first-plan-guide-dismiss" aria-label="Hide getting started guide"><X size={18} /></button>
      </div>
      <div className="first-plan-guide-steps">
        {steps.map(({ id, icon: Icon, title, description, complete, optional }) => (
          <button type="button" className={`first-plan-guide-step ${complete ? "complete" : ""}`} key={id} onClick={() => onChooseStep(id)}>
            <span className="first-plan-guide-icon">{complete ? <CheckCircle2 size={21} /> : <Icon size={21} />}</span>
            <span className="first-plan-guide-copy"><strong>{title} {optional && <em>Optional</em>}</strong><small>{description}</small></span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ))}
      </div>
      <button type="button" className="first-plan-guide-cta" onClick={() => onChooseStep(canGenerate ? "generate" : (!hasSubjects ? "subjects" : "sleep"))}>
        {canGenerate ? "Generate my first plan" : "Continue setup"}<ChevronRight size={18} />
      </button>
    </section>
  );
}

export default FirstPlanGuide;
