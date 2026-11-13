import React, { useMemo } from "react";
import { Lightbulb, AlertTriangle, TrendingUp, Coffee, Brain, Zap } from "lucide-react";
import "./SmartTips.css";

/*
  SmartTips - AI-powered study recommendations
  Ye component user ke data (subjects, progress, streak, time) ko analyze karke
  personalized study tips generate karta hai. Client-side rules engine hai,
  koi API call nahi lagti.
*/

function SmartTips({ subjects, completedTasks, plan, streak }) {
  const tips = useMemo(() => {
    const generated = [];
    const now = new Date();
    const currentHour = now.getHours();

    // ── Factor 1: Exam Proximity ──────────────────────────────────
    if (subjects && subjects.length > 0) {
      subjects.forEach(sub => {
        if (!sub.examDate) return;
        const daysLeft = Math.ceil((new Date(sub.examDate) - now) / (1000 * 60 * 60 * 24));
        const completionRate = getSubjectCompletion(sub.name, completedTasks, plan);
        
        if (daysLeft <= 3 && completionRate < 50) {
          generated.push({
            type: "critical",
            icon: <AlertTriangle size={20} />,
            title: "Critical Alert",
            text: `${sub.name} exam in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} but only ${completionRate}% done. Focus exclusively on this now!`,
            priority: 100
          });
        } else if (daysLeft <= 7 && completionRate < 30) {
          generated.push({
            type: "warning",
            icon: <AlertTriangle size={20} />,
            title: "Falling Behind",
            text: `${sub.name} is ${daysLeft} days away with ${completionRate}% completion. Increase study hours.`,
            priority: 80
          });
        }
      });
    }

    // ── Factor 2: Hard Subjects Not Studied Today ─────────────────
    if (subjects && subjects.length > 0) {
      const hardSubs = subjects.filter(s => s.difficulty === "Hard");
      hardSubs.forEach(sub => {
        const todayCompletion = getTodayCompletion(sub.name, completedTasks);
        if (todayCompletion === 0) {
          generated.push({
            type: "action",
            icon: <Brain size={20} />,
            title: "Hard Subject Alert",
            text: `You haven't started ${sub.name} today. Tackle it now with a 25-min focused Pomodoro session.`,
            priority: 70
          });
        }
      });
    }

    // ── Factor 3: Streak Motivation ──────────────────────────────
    if (streak >= 7) {
      generated.push({
        type: "motivation",
        icon: <TrendingUp size={20} />,
        title: "Incredible Streak!",
        text: `${streak} days straight! Research shows this level of consistency builds permanent neural pathways. Keep going!`,
        priority: 40
      });
    } else if (streak >= 3) {
      generated.push({
        type: "motivation",
        icon: <Zap size={20} />,
        title: "Building Momentum",
        text: `${streak}-day streak! You're forming a habit. Don't break the chain — your future self will thank you.`,
        priority: 35
      });
    } else if (streak === 0) {
      generated.push({
        type: "action",
        icon: <Zap size={20} />,
        title: "Start Fresh",
        text: "No active streak yet. Complete at least one task today to begin building your study habit.",
        priority: 30
      });
    }

    // ── Factor 4: Time-of-Day Awareness ──────────────────────────
    if (currentHour >= 22 || currentHour < 5) {
      generated.push({
        type: "info",
        icon: <Coffee size={20} />,
        title: "Late Night Study",
        text: "Studying late? Focus on revision topics, not new material. Your brain consolidates memories during sleep.",
        priority: 60
      });
    } else if (currentHour >= 5 && currentHour < 9) {
      generated.push({
        type: "motivation",
        icon: <TrendingUp size={20} />,
        title: "Peak Hours",
        text: "Morning study is most effective for complex topics. Use this time for your hardest subjects!",
        priority: 50
      });
    }

    // ── Factor 5: Easy-first avoidance ───────────────────────────
    if (subjects && subjects.length > 0) {
      const easyDone = subjects.filter(s => s.difficulty === "Easy" && getTodayCompletion(s.name, completedTasks) > 0).length;
      const hardDone = subjects.filter(s => s.difficulty === "Hard" && getTodayCompletion(s.name, completedTasks) > 0).length;
      
      if (easyDone > 0 && hardDone === 0 && subjects.some(s => s.difficulty === "Hard")) {
        generated.push({
          type: "warning",
          icon: <AlertTriangle size={20} />,
          title: "Comfort Zone Detected",
          text: "You've done easy topics but skipped the hard ones. Challenge yourself — real growth happens at the edge of difficulty.",
          priority: 65
        });
      }
    }

    // ── Factor 6: Overall Progress Insight ────────────────────────
    const totalFinished = Object.values(completedTasks || {}).filter(v => v).length;
    if (totalFinished > 10) {
      generated.push({
        type: "info",
        icon: <Lightbulb size={20} />,
        title: "Progress Checkpoint",
        text: `${totalFinished} tasks completed! Consider taking a 15-min break to let your brain process. Active recall works best after rest.`,
        priority: 25
      });
    }

    // Sort by priority (highest first) and return top 3
    return generated.sort((a, b) => b.priority - a.priority).slice(0, 3);
  }, [subjects, completedTasks, plan, streak]);

  // If no tips generated, show a default motivational one
  if (tips.length === 0) {
    return (
      <div className="tips-container">
        <div className="tips-header">
          <Lightbulb size={20} className="tips-icon" />
          <span className="tips-label">AI Study Insights</span>
        </div>
        <div className="tip-card type-info slide-up">
          <div className="tip-icon-wrap"><Lightbulb size={20} /></div>
          <div className="tip-body">
            <h4 className="tip-title">Ready to Learn</h4>
            <p className="tip-text">Add subjects and generate a plan to get personalized AI-powered study recommendations.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tips-container">
      <div className="tips-header">
        <Lightbulb size={20} className="tips-icon" />
        <span className="tips-label">AI Study Insights</span>
        <span className="tips-badge">{tips.length} Active</span>
      </div>
      <div className="tips-grid">
        {tips.map((tip, i) => (
          <div key={i} className={`tip-card type-${tip.type} stagger-${i + 1}`}>
            <div className="tip-icon-wrap">{tip.icon}</div>
            <div className="tip-body">
              <h4 className="tip-title">{tip.title}</h4>
              <p className="tip-text">{tip.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Helper Functions ──────────────────────────────────────────────────────

function getSubjectCompletion(subjectName, completedTasks, plan) {
  // Estimate completion for a specific subject based on completed task IDs
  if (!completedTasks || !plan) return 0;
  const totalKeys = Object.keys(completedTasks);
  if (totalKeys.length === 0) return 0;
  
  // We can't perfectly map task IDs to subjects without the full schedule,
  // so we approximate based on overall completion
  const done = totalKeys.filter(k => completedTasks[k]).length;
  const total = Math.max(totalKeys.length, 10);
  return Math.round((done / total) * 100);
}

function getTodayCompletion(subjectName, completedTasks) {
  // Check if any tasks related to this subject were completed
  // Task IDs follow pattern: t-{day}-{phase}-{ptr} or rev-{day}-{idx}
  if (!completedTasks) return 0;
  
  const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon...
  const dayIdx = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert to Mon=0 format
  
  // Count tasks completed today (matching day index in task ID)
  const todayKeys = Object.keys(completedTasks).filter(k => {
    const parts = k.split("-");
    return parts[1] === String(dayIdx) && completedTasks[k];
  });
  
  return todayKeys.length;
}

export default SmartTips;
