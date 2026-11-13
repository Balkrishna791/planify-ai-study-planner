import React, { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, CheckCircle, X, Clock, Award, Sparkles } from "lucide-react";
import "./FocusMode.css";

const STORAGE_KEY = "planify:activeFocusSession";

function formatDuration(totalSeconds) {
  const safeSecs = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safeSecs / 3600);
  const mins = Math.floor((safeSecs % 3600) / 60);
  const secs = safeSecs % 60;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatAllocatedLabel(durationMins) {
  const mins = Number(durationMins) || 0;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m (${mins} mins)`;
  if (h > 0) return `${h} Hour${h > 1 ? "s" : ""} (${mins} mins)`;
  return `${mins} Minutes`;
}

function getPhaseLabel(phaseIndex) {
  const p = Number(phaseIndex);
  if (p === 3) return "Revision & Recovery";
  return `Phase ${p + 1}`;
}

function parseTaskDetails(task) {
  if (!task) return { subject: "General Study", topic: "Focus Session" };
  const rawName = task.name || "";
  if (rawName.startsWith("Revision: ")) {
    const inner = rawName.replace("Revision: ", "");
    const parts = inner.split(":");
    return {
      subject: task.subjectName || parts[0]?.trim() || "Revision",
      topic: parts.length > 1 ? parts.slice(1).join(":").trim() : inner
    };
  }
  if (rawName.startsWith("↩️ Rescheduled: ")) {
    const inner = rawName.replace("↩️ Rescheduled: ", "");
    const parts = inner.split(":");
    return {
      subject: task.subjectName || parts[0]?.trim() || "Rescheduled",
      topic: parts.length > 1 ? parts.slice(1).join(":").trim() : inner
    };
  }
  const parts = rawName.split(":");
  if (parts.length > 1) {
    return {
      subject: task.subjectName || parts[0].trim(),
      topic: parts.slice(1).join(":").trim()
    };
  }
  return {
    subject: task.subjectName || "Subject",
    topic: rawName || "Study Task"
  };
}

function FocusMode({ task, onComplete, onExit, isTaskCompleted = false }) {
  const durationMins = Number(task?.durationMins);
  const hasValidTask = Boolean(task?.id) && Number.isFinite(durationMins) && durationMins > 0;
  const allocatedSeconds = hasValidTask ? Math.round(durationMins * 60) : 0;

  // Initialize state from sessionStorage or fresh task allocation
  const [session, setSession] = useState(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.taskId === task?.id) {
          let rem = parsed.remainingSeconds;
          if (parsed.status === "running" && parsed.endTimestamp) {
            rem = Math.max(0, Math.ceil((parsed.endTimestamp - Date.now()) / 1000));
          }
          return {
            taskId: task.id,
            allocatedSeconds,
            remainingSeconds: rem,
            status: rem <= 0 ? "finished" : parsed.status,
            endTimestamp: parsed.status === "running" && rem > 0 ? parsed.endTimestamp : null
          };
        }
      }
    } catch (_e) {}

    return {
      taskId: task?.id,
      allocatedSeconds,
      remainingSeconds: allocatedSeconds,
      status: !hasValidTask || isTaskCompleted ? "finished" : "running",
      endTimestamp: !hasValidTask || isTaskCompleted ? null : Date.now() + allocatedSeconds * 1000
    };
  });

  const [completedLocally, setCompletedLocally] = useState(isTaskCompleted);
  const endTimestampRef = useRef(session.endTimestamp);
  endTimestampRef.current = session.endTimestamp;

  // Sync session state to sessionStorage
  useEffect(() => {
    try {
      if (session.taskId) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
          taskId: session.taskId,
          allocatedSeconds: session.allocatedSeconds,
          remainingSeconds: session.remainingSeconds,
          status: session.status,
          endTimestamp: session.endTimestamp,
          updatedAt: Date.now()
        }));
      }
    } catch (_e) {}
  }, [session]);

  // High-accuracy countdown timer (prevents drift from tab backgrounding/throttling)
  useEffect(() => {
    if (session.status !== "running") return;

    const tick = () => {
      const target = endTimestampRef.current;
      if (!target) return;
      const left = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      if (left <= 0) {
        setSession(prev => ({
          ...prev,
          remainingSeconds: 0,
          status: "finished",
          endTimestamp: null
        }));
      } else {
        setSession(prev => ({
          ...prev,
          remainingSeconds: left
        }));
      }
    };

    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [session.status]);

  const handlePause = useCallback(() => {
    setSession(prev => ({
      ...prev,
      status: "paused",
      endTimestamp: null
    }));
  }, []);

  const handleResume = useCallback(() => {
    setSession(prev => {
      const newEnd = Date.now() + prev.remainingSeconds * 1000;
      return {
        ...prev,
        status: "running",
        endTimestamp: newEnd
      };
    });
  }, []);

  const handleMarkComplete = useCallback(async () => {
    if (!hasValidTask || completedLocally) return;
    try {
      const wasCompleted = await onComplete?.(task.id);
      if (wasCompleted === false) throw new Error("Task completion was not saved.");
      setCompletedLocally(true);
      setSession(prev => ({ ...prev, status: "finished" }));
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch (_e) {}
    } catch (err) {
      console.error("Failed to complete task:", err);
    }
  }, [hasValidTask, task?.id, completedLocally, onComplete]);

  const handleExit = useCallback(() => {
    if (session.status !== "finished" && !completedLocally) {
      const confirmed = window.confirm(
        "Your focus session is still in progress.\n\nAre you sure you want to exit? The task will NOT be marked as completed."
      );
      if (!confirmed) return;
    }
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (_e) {}
    onExit?.();
  }, [session.status, completedLocally, onExit]);

  // Visual circular progress calculation
  const total = session.allocatedSeconds || allocatedSeconds;
  const elapsed = Math.max(0, total - session.remainingSeconds);
  const progressPercent = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
  const radius = 100;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  const { subject, topic } = parseTaskDetails(task);
  const phaseName = getPhaseLabel(task?.originalPhase ?? 0);

  if (!hasValidTask) {
    return (
      <div className="focus-overlay fade-in" role="dialog" aria-label="Focus Mode Session">
        <div className="focus-container focus-invalid-task">
          <h2>This task cannot start Focus Mode.</h2>
          <p>It does not have a valid scheduled duration. Return to the study plan and generate a valid task.</p>
          <button onClick={onExit} className="focus-btn exit-btn">Return to Plan</button>
        </div>
      </div>
    );
  }

  return (
    <div className="focus-overlay fade-in" role="dialog" aria-label="Focus Mode Session">
      <div className="focus-container">
        {/* Top Header */}
        <div className="focus-header">
          <div className="focus-header-meta">
            <span className="focus-pill phase-pill">{phaseName}</span>
            <span className={`focus-pill diff-pill ${task?.difficulty?.toLowerCase() || 'medium'}`}>
              {task?.difficulty || "Medium"}
            </span>
            {task?.isCritical && <span className="focus-pill critical-pill">High Priority</span>}
          </div>
          <button 
            onClick={handleExit} 
            className="focus-exit-btn hover-scale"
            title="Exit Focus Mode"
            aria-label="Exit Focus Mode"
          >
            <X size={20} />
          </button>
        </div>

        {/* Task Details */}
        <div className="focus-task-info">
          <h3 className="focus-subject-label">{subject}</h3>
          <h2 className="focus-topic-title">{topic}</h2>
          <div className="focus-allocated-badge">
            <Clock size={14} />
            <span>Allocated Study Time: <strong>{formatAllocatedLabel(task?.durationMins)}</strong></span>
          </div>
        </div>

        {/* Main Countdown Display with Circular Progress */}
        <div className="focus-timer-display">
          <div className={`focus-ring-wrapper ${session.status === 'running' ? 'active-glow' : ''}`}>
            <svg className="focus-svg" viewBox="0 0 240 240">
              <circle className="focus-bg-circle" cx="120" cy="120" r={radius} />
              <circle
                className="focus-progress-circle"
                cx="120"
                cy="120"
                r={radius}
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
              />
            </svg>
            <div className="focus-timer-text-container">
              <span className="focus-digital-timer">{formatDuration(session.remainingSeconds)}</span>
              <span className="focus-status-text">
                {session.status === "finished" ? (
                  <span className="status-finished">Session Finished 🎉</span>
                ) : session.status === "paused" ? (
                  <span className="status-paused">Paused ⏸️</span>
                ) : (
                  <span className="status-running">Deep Focus ⚡</span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Status Message when Finished */}
        {session.status === "finished" && !completedLocally && (
          <div className="focus-finished-banner slide-up">
            <Sparkles size={20} color="#f59e0b" />
            <span>Allocated study time completed! Mark this task complete to record progress and earn XP.</span>
          </div>
        )}

        {completedLocally && (
          <div className="focus-completed-banner slide-up">
            <Award size={20} color="#10b981" />
            <span>Task marked complete! +10 XP awarded. Great work!</span>
          </div>
        )}

        {/* Control Actions */}
        <div className="focus-actions">
          {session.status === "running" && (
            <button 
              onClick={handlePause} 
              className="focus-btn pause-btn hover-scale"
              aria-label="Pause Timer"
            >
              <Pause size={18} />
              <span>Pause</span>
            </button>
          )}

          {session.status === "paused" && (
            <button 
              onClick={handleResume} 
              className="focus-btn resume-btn hover-scale"
              aria-label="Resume Timer"
            >
              <Play size={18} />
              <span>Resume</span>
            </button>
          )}

          <button
            onClick={handleMarkComplete}
            disabled={completedLocally}
            className={`focus-btn complete-btn hover-scale ${completedLocally ? 'completed' : ''}`}
            aria-label="Mark Task Complete"
          >
            <CheckCircle size={18} />
            <span>{completedLocally ? "Completed ✓" : "Complete Task"}</span>
          </button>

          <button 
            onClick={handleExit} 
            className="focus-btn exit-btn hover-scale"
            aria-label="Exit Session"
          >
            <span>Exit</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default FocusMode;
