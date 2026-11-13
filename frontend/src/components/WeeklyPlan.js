import React, { useMemo, useState } from "react";
//useMemo Ye React Hook hai. : expensive calculation ko optimize karna
import { Calendar, CheckCircle, Circle, ArrowRight, Lock, Play } from "lucide-react";
import "./WeeklyPlan.css";

// Formats integer minutes to a readable string like "2 hr 36 min" or "40 min"
const formatTime = (mins) => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h > 0 && m > 0) return `${h} hr ${m} min`;
  if (h > 0) return `${h} hr`;
  return `${m} min`;
};

// Generates an array of 7 days starting from TODAY
function getRollingWeek() {
  const now = new Date();
  const daysArray = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    return {
      day: daysArray[d.getDay()],
      date: d.toISOString().split("T")[0] // YYYY-MM-DD
    };
  });
}

function getSubjectPriority(subject, todayDateStr) {
  const difficultyWeight = { Easy: 1, Medium: 3, Hard: 5 };
  let urgency = 0;
  if (subject.examDate) {
    const examTime = Date.parse(`${subject.examDate}T00:00:00`);
    const todayTime = Date.parse(`${todayDateStr}T00:00:00`);
    if (Number.isFinite(examTime) && Number.isFinite(todayTime)) {
      const daysUntilExam = Math.ceil((examTime - todayTime) / 86400000);
      if (daysUntilExam <= 3) urgency = 6;
      else if (daysUntilExam <= 7) urgency = 4;
      else if (daysUntilExam <= 14) urgency = 2;
    }
  }
  return (difficultyWeight[subject.difficulty] || 1) + urgency;
}

function buildSchedule(plan, sleepHours, skippedTasks) {
  const numericSleep = Number(sleepHours);
  const safeSleep = Number.isFinite(numericSleep) && numericSleep >= 0 && numericSleep < 24 ? numericSleep : 0;
  // Calculate available time in MINUTES
  const availableMins = (24 - safeSleep) * 60;
  const baseMins = availableMins / 4;

  const roundTo10 = (num) => Math.round(num / 10) * 10;

  // Calculate phase limits in MINUTES (Rounded to nearest 10)
  const limits = [
    roundTo10(baseMins * 0.65), // Phase 1
    roundTo10(baseMins * 0.70), // Phase 2
    roundTo10(baseMins * 0.65), // Phase 3
    roundTo10(baseMins * 0.70), // Phase 4
  ];

  const weekData = getRollingWeek();

  const week = weekData.map(({ day, date }) => ({
    day,
    date,
    totalLimit: limits.reduce((a, b) => a + b, 0),
    phases: limits.map((limit) => ({ limit, tasks: [] })),
  }));

  if (!plan || plan.length === 0) return { week };

  // Two-Pass Architecture for Stable Schedules
  let poolPtr = 0;

  for (let d = 0; d < 7; d++) {
    let tasksStudiedToday = [];
    let dayUsedMins = 0;
    const todayDateStr = week[d].date;

    // Filter plan to only include subjects whose exam has NOT passed/today
    const activePlan = plan
      .filter(sub => !sub.examDate || todayDateStr < sub.examDate)
      .sort((a, b) => getSubjectPriority(b, todayDateStr) - getSubjectPriority(a, todayDateStr));

    // Build the weighted pool of topics for this specific day
    let dayWeightedPool = [];
    activePlan.forEach((sub) => {
      const weight =
        sub.difficulty === "Hard" ? 5 : sub.difficulty === "Medium" ? 3 : 1;
      const subTopics =
        sub.topics && sub.topics.length > 0
          ? sub.topics.map((t) => ({
              name: `${sub.name}: ${t.name}`,
              difficulty: sub.difficulty,
              prioritySignal: Number(t.prioritySignal) || 0,
            }))
          : [{ name: sub.name, difficulty: sub.difficulty, prioritySignal: 0 }];

      for (let i = 0; i < weight; i++) {
        subTopics.forEach((topic) => {
          // Mirror the backend fallback behaviour without turning raw PYQ
          // counts into excessive study time. The backend remains canonical.
          const repetitions = 1 + Math.max(0, Math.min(2, Math.round(topic.prioritySignal)));
          for (let occurrence = 0; occurrence < repetitions; occurrence++) {
            dayWeightedPool.push(topic);
          }
        });
      }
    });

    if (dayWeightedPool.length > 0) {
      // Phases 1, 2, 3
      for (let p = 0; p < 3; p++) {
        let phaseTasks = [];
        let used = 0; // tracking in minutes
        let cap = limits[p];
        let attempts = 0;

        while (used < cap && attempts < dayWeightedPool.length) {
          const top = dayWeightedPool[poolPtr % dayWeightedPool.length];
          const isDuplicateToday = tasksStudiedToday.some((t) => t.name === top.name);

          if (!isDuplicateToday) {
            // durations in integer minutes (Increased for better study blocks)
            const baseDuration = top.difficulty === "Hard" ? 70 : top.difficulty === "Medium" ? 60 : 45;
            const remaining = cap - used;

            let duration = 0;
            if (baseDuration <= remaining) {
              duration = baseDuration;
            } else if (remaining >= 20) {
              duration = remaining;
            }

            if (duration > 0) {
              phaseTasks.push({
                id: `t-${todayDateStr}-p${p}-${poolPtr}`,
                name: top.name,
                durationMins: duration,
                difficulty: top.difficulty,
                originalPhase: p
              });
              used += duration;
              dayUsedMins += duration;
              tasksStudiedToday.push({
                name: top.name,
                difficulty: top.difficulty,
              });
              poolPtr++;
            } else {
              break;
            }
          } else {
            poolPtr++;
          }
          attempts++;
        }
        week[d].phases[p].tasks = phaseTasks;
      }
    }

    // Phase 4: Revision
    let revTasks = [];
    let revUsed = 0; // minutes
    let revCap = limits[3];

    // Sort tasksStudiedToday by difficulty (Hard > Medium > Easy) to avoid chronological bias
    const sortedForRevision = [...tasksStudiedToday].sort((a, b) => {
      const getVal = (diff) => diff === "Hard" ? 3 : diff === "Medium" ? 2 : 1;
      return getVal(b.difficulty) - getVal(a.difficulty);
    });

    sortedForRevision.forEach((t, i) => {
      const revDuration = 30; // 30 mins for revision block
      if (revUsed + revDuration <= revCap) {
        revTasks.push({
          id: `rev-${todayDateStr}-${i}`,
          name: `Revision: ${t.name}`,
          durationMins: revDuration,
          isCritical: t.difficulty === "Hard",
          difficulty: t.difficulty,
          originalPhase: 3
        });
        revUsed += revDuration;
        dayUsedMins += revDuration;
      }
    });
    week[d].phases[3].tasks = revTasks;
    week[d].usedHours = dayUsedMins; // Keep property name "usedHours" to avoid breaking if referenced, but it stores minutes
  }

  // PASS 2: Apply skipped tasks as explicit overrides.
  (skippedTasks || []).forEach((task) => {
    const dayIdx = typeof task.day === "number" ? task.day : 0;
    const fromP = task.fromPhase || 0;
    // A skipped task may move through Phase 1 → 2 → 3 → Revision & Recovery.
    const targetP = typeof task.targetPhase === "number" ? Math.min(Math.max(task.targetPhase, 0), 3) : Math.min(fromP + 1, 3);

    if (week[dayIdx]) {
      const fromTasks = week[dayIdx].phases[fromP].tasks;
      const tIdx = fromTasks.findIndex(t => t.name === task.name);
      
      let removedMins = 45; // default
      let difficulty = "Medium";
      if (tIdx !== -1) {
        removedMins = fromTasks[tIdx].durationMins || 45;
        difficulty = fromTasks[tIdx].difficulty;
        fromTasks.splice(tIdx, 1);
      }

      const alreadyExists = week[dayIdx].phases[targetP].tasks.some(t => t.name === `↩️ Rescheduled: ${task.name}`);
      
      if (!alreadyExists) {
        // Find the next phase/day with enough capacity; never silently drop skipped work.
        let placed = false;
        for (let candidateDay = dayIdx; candidateDay < week.length && !placed; candidateDay++) {
          const firstPhase = candidateDay === dayIdx ? targetP : 0;
          for (let candidatePhaseIndex = firstPhase; candidatePhaseIndex < week[candidateDay].phases.length; candidatePhaseIndex++) {
            const candidatePhase = week[candidateDay].phases[candidatePhaseIndex];
            const usedInPhase = candidatePhase.tasks.reduce((sum, item) => sum + (item.durationMins || 0), 0);
            if (candidatePhase.limit - usedInPhase >= removedMins) {
              const candDateStr = week[candidateDay].date;
              candidatePhase.tasks.unshift({
                id: `s-${candDateStr}-p${candidatePhaseIndex}-${task.name}`,
                name: `↩️ Rescheduled: ${task.name}`,
                durationMins: removedMins,
                difficulty: difficulty,
                isSkipped: true,
              });
              week[candidateDay].usedHours += removedMins;
              placed = true;
              break;
            }
          }
        }
      }
    }
  });

  return { week };
}

function WeeklyPlan({
  plan,
  schedule,
  sleepHours,
  completedTasks,
  handleComplete,
  handleSkip,
  skippedTasks,
  onProgressUpdate,
  onStartFocus
}) {
  const { week } = useMemo(() => {
    if (schedule?.week) return schedule;
    return buildSchedule(plan, sleepHours, skippedTasks);
  }, [schedule, plan, sleepHours, skippedTasks]);

  // Set default selected day to the FIRST day in the rolling week (Today)
  const [selectedDay, setSelectedDay] = useState(() => week.length > 0 ? week[0].day : "Mon");

  const [toast, setToast] = useState(null);
  const [shakingTaskId, setShakingTaskId] = useState(null);

  const isDayLocked = (dayIdx) => {
    if (dayIdx <= 0) return false;
    for (let d = 0; d < dayIdx; d++) {
      const prevDay = week[d];
      if (!prevDay) continue;
      for (const phase of prevDay.phases) {
        for (const task of phase.tasks) {
          if (!completedTasks?.[task.id]) {
            return true;
          }
        }
      }
    }
    return false;
  };

  const handleLockedTaskClick = (taskId) => {
    setShakingTaskId(taskId);
    setToast("Resolve previous days' tasks (Complete or Skip) to unlock this day!");
    
    // Clear shake animation
    setTimeout(() => {
      setShakingTaskId(null);
    }, 500);

    // Clear toast
    setTimeout(() => {
      setToast(null);
    }, 3000);
  };

  React.useEffect(() => {
    let totalTasksCount = 0;
    let completedTasksCount = 0;
    let totalMins = 0;
    let completedMins = 0;

    // Today's details (week[0])
    let todayDate = week.length > 0 ? week[0].date : "";
    let todayCompletedMins = 0;
    let todayCompletedTasks = 0;

    week.forEach((day, dayIdx) => {
      day.phases.forEach(phase => {
        phase.tasks.forEach(task => {
          totalTasksCount++;
          totalMins += task.durationMins || 0;
          
          const isDone = !!completedTasks?.[task.id];
          if (isDone) {
            completedTasksCount++;
            completedMins += task.durationMins || 0;
          }

          if (dayIdx === 0) {
            if (isDone) {
              todayCompletedTasks++;
              todayCompletedMins += task.durationMins || 0;
            }
          }
        });
      });
    });

    const totalHours = Number((totalMins / 60).toFixed(2));
    const completedHours = Number((completedMins / 60).toFixed(2));
    const percentage = totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 0;

    const todayHours = Number((todayCompletedMins / 60).toFixed(2));

    if (onProgressUpdate) {
      onProgressUpdate({
        totalTasks: totalTasksCount,
        totalHours,
        completedHours,
        percentage,
        todayDate,
        todayHours,
        todayTasks: todayCompletedTasks
      });
    }
  }, [week, completedTasks, onProgressUpdate]);

  const getDifficultyColor = (difficulty) => {
    if (difficulty === "Hard") return "var(--color-danger)";
    if (difficulty === "Medium") return "var(--color-warning)";
    return "var(--color-success)"; // Easy
  };

  const getPhaseName = (index) => index === 3 ? "Revision & Recovery" : `Phase ${index + 1}`;
  const getPhaseColor = (index) => {
    if (index === 0) return "#38bdf8";
    if (index === 1) return "#818cf8";
    if (index === 2) return "#fbbf24";
    return "#f43f5e";
  };

  // Helper to format date labels for the tabs (e.g., "May 27")
  const formatDateLabel = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Active day plan object
  const activeDayPlan = useMemo(() => {
    return week.find(d => d.day === selectedDay) || week[0];
  }, [week, selectedDay]);

  const activeDayIndex = useMemo(() => {
    return week.findIndex(d => d.day === selectedDay);
  }, [week, selectedDay]);

  if (!activeDayPlan) return null;

  return (
    <div className="weekly-container">
      {/* Header */}
      <div className="weekly-header">
        <h2 className="weekly-title">
          <Calendar size={28} style={{ verticalAlign: 'middle', marginRight: '10px' }} />
          Adaptive Study Planner
        </h2>
        <p className="weekly-subtitle">
          Intelligent phase-wise unique allocation automatically filtered by exam deadlines.
        </p>
      </div>

      {/* Premium Day Switcher Tabs */}
      <div className="weekly-tabs">
        {week.map((day, dayIdx) => {
          const isActive = day.day === selectedDay;
          const locked = isDayLocked(dayIdx);
          return (
            <button
              key={day.date} // changed to date since days can repeat if rolling over >7 days (though it's 7 days exactly here)
              className={`weekly-tab-btn hover-scale ${isActive ? "active" : ""} ${locked ? "locked" : ""}`}
              onClick={() => setSelectedDay(day.day)}
            >
              <span className="weekly-tab-name">
                {day.day}
                {locked && <Lock size={12} style={{ marginLeft: "6px", verticalAlign: "middle" }} />}
              </span>
              <span className="weekly-tab-date">{formatDateLabel(day.date)}</span>
            </button>
          );
        })}
      </div>

      {/* Selected Day Card Rendered with smooth animation wrapper */}
      <div key={activeDayPlan.day} className="day-card slide-up">
        <div className="day-head">
          <h3 className="day-title">
            {activeDayPlan.day} Plan <span style={{ fontSize: "14px", fontWeight: "600", opacity: 0.6 }}>({formatDateLabel(activeDayPlan.date)})</span>
          </h3>
          
          {/* Capacity Bar Visual */}
          <div className="day-capacity-container">
            <span className="day-capacity-text">{formatTime(activeDayPlan.usedHours)} / {formatTime(activeDayPlan.totalLimit)} Assigned</span>
            <div className="day-capacity-bar-bg">
              <div 
                className="day-capacity-bar-fill" 
                style={{ width: `${Math.min(100, (activeDayPlan.usedHours / activeDayPlan.totalLimit) * 100)}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Phase Grid */}
        <div className="phase-grid">
          {activeDayPlan.phases.map((phase, i) => (
            <div key={i} className="phase-card">
              <h4 className="phase-label" style={{ color: getPhaseColor(i) }}>
                {getPhaseName(i)}
                <span className="phase-limit">({formatTime(phase.limit)})</span>
              </h4>
              
              <div className="task-list">
                {phase.tasks.length === 0 ? (
                  <p className="task-empty-state">Focus time</p>
                ) : (
                  phase.tasks.map((task) => {
                    const isComplete = !!completedTasks?.[task.id];
                    const isLocked = isDayLocked(activeDayIndex);
                    const isShaking = shakingTaskId === task.id;
                    return (
                      <div
                        key={task.id}
                        className={`task-card hover-scale ${isComplete ? 'completed' : ''} ${isLocked ? 'locked' : ''} ${isShaking ? 'shake' : ''}`}
                        style={{ borderLeftColor: getDifficultyColor(task.difficulty) }}
                      >
                        <div 
                          className="task-check" 
                          onClick={isLocked ? () => handleLockedTaskClick(task.id) : () => handleComplete?.(task.id)}
                        >
                          {isLocked ? (
                            <Lock size={16} color="var(--color-subtext)" style={{ opacity: 0.8 }} />
                          ) : isComplete ? (
                            <CheckCircle size={18} color="var(--color-success)" />
                          ) : (
                            <Circle size={18} color="var(--color-subtext)" />
                          )}
                        </div>
                        
                        <div className="task-content">
                          <div className="task-main">
                            <span className="task-name">{task.name}</span>
                            <span className="task-meta">
                              {formatTime(task.durationMins)} {task.isCritical && "• High Priority"}
                            </span>
                          </div>
                          
                          <div className="task-actions">
                            {!isComplete && !isLocked && (
                              <button
                                onClick={() => onStartFocus?.({ ...task, originalPhase: i })}
                                className="focus-task-btn hover-scale"
                                title={`Start Focus Mode (${task.durationMins}m)`}
                              >
                                <Play size={11} fill="currentColor" /> Focus
                              </button>
                            )}

                            {!isComplete && !task.isSkipped && !task.isCritical && !isLocked && (
                              <button
                                onClick={() => handleSkip(task, i, activeDayIndex)}
                                className="skip-btn"
                                title="Reschedule to next phase"
                              >
                                Skip <ArrowRight size={12}/>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {toast && (
        <div className="toast-notification">
          <Lock size={16} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

export default WeeklyPlan;
export { buildSchedule, getSubjectPriority };
