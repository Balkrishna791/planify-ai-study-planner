import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";/*useState -Data store karne ke liye.
useEffect -Automatic code chalane ke liye. 
useCallback-Function ko unnecessary recreate hone se bachata.
useMemo -Heavy calculation optimize karta.
*/
import { useReactToPrint } from "react-to-print";
import { BookOpen, LogOut, Moon, Sun, Clock, Trash2, Menu, Download, BarChart2, Brain, Star, User, Play, Zap } from "lucide-react";

import Login from "./components/Login";
import LandingPage from "./components/LandingPage";
import LegalPage from "./components/LegalPage";
import AddSubject from "./components/AddSubject";
import Dashboard from "./components/Dashboard";
import WeeklyPlan, { buildSchedule } from "./components/WeeklyPlan";
import ChartBox from "./components/ChartBox";
import FocusMode from "./components/FocusMode";
import EditModal from "./components/EditModal";
import SmartTips from "./components/SmartTips";
import SpacedRepetition from "./components/SpacedRepetition";
import DailyQuiz from "./components/DailyQuiz";
import Profile from "./components/Profile";
import Analytics from "./components/Analytics";
import SyllabusIntelligence from "./components/SyllabusIntelligence";
import FirstPlanGuide from "./components/FirstPlanGuide";
import { startAnalytics, trackEvent } from "./services/analytics";
import "./App.css";
import "./animations.css";

function isValidSleepHours(value) {
  if (typeof value === "string" && !value.trim()) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 24;
}

function publicScreenFromPath(pathname = window.location.pathname) {
  if (pathname === "/privacy") return "privacy";
  if (pathname === "/terms") return "terms";
  return "landing";
}

// Custom hook for theme management
function useTheme() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem("theme");
    return saved === "dark" ? true : false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
    }
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(prev => !prev);
  return { isDarkMode, toggleTheme };
}

function App() {
  useEffect(() => { startAnalytics(); }, []);
  const [user, setUser]/*Array Destructuring*/ = useState(() => {
    const saved = localStorage.getItem("user");/*save reh sakta even refresh ke baad.*/
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch (_error) {
      localStorage.removeItem("user");
      return null;
    }
  });

  const [isLoggedIn, setIsLoggedIn] = useState(!!user);
  const [isSessionChecking, setIsSessionChecking] = useState(!!user);
  const [publicScreen, setPublicScreen] = useState(() => publicScreenFromPath());
  const { isDarkMode, toggleTheme } = useTheme();
  
  const [sidebarCollapsed, setSidebarCollapsed] = useState(window.innerWidth < 768);
  const [subjects, setSubjects] = useState([]);
  const [plan, setPlan] = useState([]);
  const [activeSchedule, setActiveSchedule] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [completedTasks, setCompletedTasks] = useState({});
  const [skippedTasks, setSkippedTasks] = useState([]);
  const [showChart, setShowChart] = useState(false);
  // Sleep hours are required before generating plans or quizzes and persist per user.
  const sleepStorageKey = user ? `planify:sleepHours:${user.email.toLowerCase()}` : null;
  const [sleepHours, setSleepHours] = useState(() => {
    const saved = user ? localStorage.getItem(`planify:sleepHours:${user.email.toLowerCase()}`) : null;
    return saved ?? "";
  });
  const [editingSub, setEditingSub] = useState(null);
  const [activeFocusTask, setActiveFocusTask] = useState(() => {
    try {
      const saved = sessionStorage.getItem("planify:activeFocusTaskData");
      if (saved) return JSON.parse(saved);
    } catch (_e) {}
    return null;
  });
  const [totalTasks, setTotalTasks] = useState(0);
  const [showSpacedRepetition, setShowSpacedRepetition] = useState(false);
  const [showDailyQuiz, setShowDailyQuiz] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const onboardingStorageKey = user ? `planify:onboarding-dismissed:${user.email.toLowerCase()}` : null;
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => user ? localStorage.getItem(`planify:onboarding-dismissed:${user.email.toLowerCase()}`) === "true" : false);
  const [xp, setXp] = useState(0);
  const [level, setLevel] = useState(1);

  useEffect(() => {
    if (!sleepStorageKey) {
      setSleepHours("");
      return;
    }
    const saved = localStorage.getItem(sleepStorageKey);
    setSleepHours(saved ?? "");
  }, [sleepStorageKey]);

  useEffect(() => {
    if (sleepStorageKey && sleepHours !== "") {
      localStorage.setItem(sleepStorageKey, String(sleepHours));
    }
  }, [sleepStorageKey, sleepHours]);

  useEffect(() => {
    setOnboardingDismissed(onboardingStorageKey ? localStorage.getItem(onboardingStorageKey) === "true" : false);
  }, [onboardingStorageKey]);

  useEffect(() => {
    const syncPublicPage = () => setPublicScreen(publicScreenFromPath());
    window.addEventListener("popstate", syncPublicPage);
    return () => window.removeEventListener("popstate", syncPublicPage);
  }, []);

  const navigatePublic = useCallback((screen) => {
    const path = screen === "privacy" ? "/privacy" : screen === "terms" ? "/terms" : "/";
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setPublicScreen(screen);
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      localStorage.removeItem("user");
      setUser(null);
      setIsLoggedIn(false);
      setIsSessionChecking(false);
    };
    window.addEventListener("planify:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("planify:unauthorized", handleUnauthorized);
  }, []);

  useEffect(() => {
    if (!user?.token) {
      if (user) {
        localStorage.removeItem("user");
        setUser(null);
        setIsLoggedIn(false);
      }
      setIsSessionChecking(false);
      return;
    }
    let active = true;
    const verifySession = async () => {
      try {
        const response = await fetch("/me");
        if (!response.ok) throw new Error("Session is not valid");
        const profile = await response.json();
        if (active) {
          const verifiedUser = { ...user, ...profile };
          localStorage.setItem("user", JSON.stringify(verifiedUser));
          setUser(verifiedUser);
        }
      } catch (_error) {
        if (active) {
          localStorage.removeItem("user");
          setUser(null);
          setIsLoggedIn(false);
        }
      } finally {
        if (active) setIsSessionChecking(false);
      }
    };
    verifySession();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token]);

  const componentRef = useRef();

  // Listen to window resize to auto-collapse sidebar on mobile
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarCollapsed(true);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const fetchHistory = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`/get-history/${user.email}`);/*fetch()-Internet/API request.*/
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data)) throw new Error(data?.error || "Unable to load history");
      setHistory(data);
    } catch (e) { console.error("History error", e); }
  }, [user]);

  const fetchProgress = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`/get-progress/${user.email}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data !== "object") throw new Error(data?.error || "Unable to load progress");
      setCompletedTasks(data.completedTasks || {});
      setSkippedTasks(data.skippedTasks || []);
      if (data.totalTasks) setTotalTasks(data.totalTasks);
    } catch (e) { console.error("Progress fetch error", e); }
  }, [user]);

  const fetchStats = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`/get-stats/${user.email}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data !== "object") throw new Error(data?.error || "Unable to load stats");
      if (data.xp !== undefined) {
        setXp(data.xp);
        setLevel(data.level);
      }
    } catch (e) { console.error("Stats fetch error", e); }
  }, [user]);

  const fetchActiveSchedule = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch(`/get-active-schedule/${user.email}`);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.schedule || !Array.isArray(data.schedule.week)) {
        throw new Error(data?.error || "Unable to load the active schedule.");
      }
      setActiveSchedule(data.schedule.week.length ? data.schedule : null);
      setCompletedTasks(data.completedTasks || {});
      setSkippedTasks(data.skippedTasks || []);
      if (isValidSleepHours(data.sleepHours)) {
        setSleepHours(current => isValidSleepHours(current) ? current : String(data.sleepHours));
      }
      if (data.schedule.total_tasks !== undefined) setTotalTasks(data.schedule.total_tasks);
    } catch (error) {
      console.error("Active schedule fetch error:", error);
    }
  }, [user]);

  useEffect(() => { /*Page load hote hi automatic code chalao*/
    if (user) {
      fetch(`/get-subjects/${user.email}`)/*subjects fetch*/
        .then(async res => {
          const data = await res.json().catch(() => null);
          if (!res.ok || !Array.isArray(data)) throw new Error(data?.error || "Unable to load subjects");
          setSubjects(data);
        })
        .catch(error => console.error("Subjects fetch error:", error));

      fetch(`/get-plan/${user.email}`)/*plan fetch*/
        .then(async res => {
          const data = await res.json().catch(() => null);
          if (!res.ok || !Array.isArray(data)) throw new Error(data?.error || "Unable to load plan");
          setPlan(data);
        })
        .catch(error => console.error("Plan fetch error:", error));

      fetchHistory();/*history fetch*/
      fetchProgress();/*progress fetch*/
      fetchStats();/*gamification fetch*/
      fetchActiveSchedule();
    }
  }, [isLoggedIn, user, fetchHistory, fetchProgress, fetchStats, fetchActiveSchedule]);

  useEffect(() => {
    if (showHistory) fetchHistory();
  }, [showHistory, fetchHistory]);

  const syncSubjects = async (updatedList) => {
    if (!user) return false;
    try {
      const response = await fetch("/save-subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, subjects: updatedList })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Unable to save subjects.");
      setSubjects(updatedList);
      return true;
    } catch (e) {
      console.error("Sync error:", e);
      alert(e.message || "Unable to save subjects. Your current list was not changed.");
      return false;
    }
  };

  const addSubject = async (newSub) => {
    const updated = [...subjects, newSub];
    return syncSubjects(updated);
  };

  const saveEdit = async (updatedSub) => {
    const updatedList = subjects.map((s, i) => i === editingSub.index ? updatedSub : s);
    return syncSubjects(updatedList);
  };

  const removeSubject = async (index) => syncSubjects(subjects.filter((_, itemIndex) => itemIndex !== index));

  const generatePlan = async () => {
    if (subjects.length === 0) return alert("Add subjects first");
    if (!isValidSleepHours(sleepHours)) return alert("Enter daily sleep hours greater than 0 and less than 24 before generating a plan.");
    const newPlan = subjects.map(sub => ({
      name: sub.name,
      difficulty: sub.difficulty,
      examDate: sub.examDate,
      hours: sub.difficulty === "Hard" ? 5 : sub.difficulty === "Medium" ? 3 : 2,
      topics: sub.topics || []
    }));

    // Backend-driven planning service call
    if (user) {
      try {
        const res = await fetch("/generate-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subjects, sleepHours: Number(sleepHours) })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Unable to generate the plan.");
        setPlan(data.plan || newPlan);
        setCompletedTasks({});
        setSkippedTasks([]);
        if (data.totalTasks !== undefined) setTotalTasks(data.totalTasks);
        if (data.schedule?.week) setActiveSchedule(data.schedule);
        if (data.syllabusWarnings?.length) {
          alert(`Plan generated. Syllabus Intelligence note:\n${data.syllabusWarnings.map(item => `• ${item.message}`).join("\n")}`);
        }
        trackEvent("planify_study_plan_generated", { subject_count: Math.min(subjects.length, 20) });
        fetchHistory(); // Refresh history list immediately
      } catch (e) {
        console.error("Generate plan error:", e);
        alert(e.message || "Unable to generate the plan. Please try again.");
      }
    }
  };

  const focusOnboardingStep = (step) => {
    if (step === "generate") {
      generatePlan();
      return;
    }
    const targetId = step === "subjects" ? "curriculum-setup" : step === "syllabus" ? "syllabus-setup" : "daily-sleep-hours";
    if (step === "subjects" || step === "syllabus") setSidebarCollapsed(false);
    window.setTimeout(() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
  };

  const dismissOnboarding = () => {
    if (onboardingStorageKey) localStorage.setItem(onboardingStorageKey, "true");
    setOnboardingDismissed(true);
  };

  const syncProgress = useCallback(async (newCompleted, newSkipped, newTotal, extraStats = {}) => {
    if (!user) return;
    try {
      await fetch("/save-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          completedTasks: newCompleted,
          skippedTasks: newSkipped,
          totalTasks: newTotal !== undefined ? newTotal : totalTasks,
          ...extraStats
        })
      });
    } catch (e) { console.error("Progress sync error:", e); }
  }, [user, totalTasks]);

  const handleProgressUpdate = useCallback((stats) => {
    setTotalTasks(stats.totalTasks);
    syncProgress(completedTasks, skippedTasks, stats.totalTasks, {
      completedHours: stats.completedHours,
      totalHours: stats.totalHours,
      percentage: stats.percentage,
      todayDate: stats.todayDate,
      todayHours: stats.todayHours,
      todayTasks: stats.todayTasks
    });
  }, [completedTasks, skippedTasks, syncProgress]);

  const toggleTask = async (taskId) => {
    const isCompleting = !completedTasks[taskId];
    if (!user) return false;
    try {
      const res = await fetch("/toggle-task", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, completed: isCompleting })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Unable to update the task.");
      setCompletedTasks(data.completedTasks || {});
      if (data.xp !== undefined) {
        setXp(data.xp);
        setLevel(data.level);
      }
      return true;
    } catch (e) {
      console.error("Toggle task error:", e);
      alert(e.message || "Unable to update the task. Please try again.");
      return false;
    }
  };

  const handleSkip = async (task, currentPhase, dayIndex) => {
    if (!isValidSleepHours(sleepHours)) {
      alert("Enter valid sleep hours before rescheduling a task.");
      return;
    }
    if (user) {
      try {
        const response = await fetch("/skip-task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: task.id,
            sleepHours: Number(sleepHours)
          })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "Unable to reschedule the task.");
        setSkippedTasks(data.skippedTasks || []);
        if (data.schedule?.week) setActiveSchedule(data.schedule);
      } catch (e) {
        console.error("Skip task error:", e);
        alert(e.message || "Unable to reschedule the task. Please try again.");
      }
    }
  };

  // ✅ BUG FIX: Calculate progress based on actual generated tasks, not an arbitrary formula
  const progressPercent = useMemo(() => {
    if (!plan.length || totalTasks === 0) return 0;
    const finished = Object.values(completedTasks).filter(v => v).length;
    if (finished === 0) return 0;
    return Math.min(100, Math.round((finished / totalTasks) * 100));
  }, [completedTasks, plan, totalTasks]);

  const streak = useMemo(() => {
    if (!history.length) return 0;
    // Extract unique dates and sort them
    const dates = [...new Set(history.map(h => h.created_at.split(" ")[0]))].sort().reverse();
    
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    
    // If no activity today or yesterday, streak is broken
    if (dates[0] !== today && dates[0] !== yesterday) return 0;
    
    let count = 0;
    let checkDate = new Date(dates[0]);
    
    for (let i = 0; i < dates.length; i++) {
      const d = new Date(dates[i]);
      const diff = Math.floor((checkDate - d) / (1000 * 60 * 60 * 24));
      
      if (diff === i) {
        count++;
      } else break;
    }
    return count;
  }, [history]);

  const startFocusSession = (task) => {
    if (!task || !task.id || !Number.isFinite(Number(task.durationMins)) || Number(task.durationMins) <= 0 || completedTasks[task.id]) return;
    setActiveFocusTask(task);
    try {
      sessionStorage.setItem("planify:activeFocusTaskData", JSON.stringify(task));
    } catch (_e) {}
  };

  const handleFocusComplete = async (taskId) => {
    return toggleTask(taskId);
  };

  const handleFocusExit = () => {
    setActiveFocusTask(null);
    try {
      sessionStorage.removeItem("planify:activeFocusSession");
      sessionStorage.removeItem("planify:activeFocusTaskData");
    } catch (_e) {}
  };

  const todaySchedule = useMemo(() => {
    if (!plan.length) return null;
    const { week } = activeSchedule?.week ? activeSchedule : buildSchedule(plan, sleepHours === "" ? 0 : Number(sleepHours), skippedTasks);
    return week && week.length > 0 ? week[0] : null;
  }, [activeSchedule, plan, sleepHours, skippedTasks]);

  const currentFocusTask = useMemo(() => {
    if (!todaySchedule) return null;
    for (let pIdx = 0; pIdx < todaySchedule.phases.length; pIdx++) {
      const phase = todaySchedule.phases[pIdx];
      for (const task of phase.tasks) {
        if (!completedTasks[task.id]) {
          return { ...task, originalPhase: pIdx };
        }
      }
    }
    return null;
  }, [todaySchedule, completedTasks]);

  const resetDashboard = async () => {
    if (window.confirm("Are you sure you want to clear all subjects and the current plan?")) {
      try {
        const response = await fetch("/reset-dashboard", { method: "POST" });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "Unable to reset the dashboard.");
        setSubjects([]);
        setPlan([]);
        setActiveSchedule(null);
        setSleepHours("");
        setCompletedTasks({});
        setSkippedTasks([]);
        setTotalTasks(0);
        setShowChart(false);
        setShowHistory(false);
        setActiveFocusTask(null);
        try {
          sessionStorage.removeItem("planify:activeFocusSession");
          sessionStorage.removeItem("planify:activeFocusTaskData");
        } catch (_e) {}
      } catch (e) {
        console.error("Dashboard reset error:", e);
        alert(e.message || "Unable to reset the dashboard. Please try again.");
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("user");
    setUser(null);
    setIsLoggedIn(false);
    setSubjects([]);
    setPlan([]);
    setActiveSchedule(null);
    setHistory([]);
    setCompletedTasks({});
    setSkippedTasks([]);
    setActiveFocusTask(null);
    try {
      sessionStorage.removeItem("planify:activeFocusSession");
      sessionStorage.removeItem("planify:activeFocusTaskData");
    } catch (_e) {}
  };

  const handleAccountDeleted = () => {
    setShowProfile(false);
    handleLogout();
  };

  // ✅ React-to-print setup for professional PDF export
  const handlePrint = useReactToPrint({
    content: () => componentRef.current,
    documentTitle: 'Planify_Schedule',
    pageStyle: `
      @page { size: auto; margin: 10mm; }
      @media print { body { -webkit-print-color-adjust: exact; } }
    `,
  });

  if (isSessionChecking) return <div className="app-loading">Checking your secure session…</div>;
  if (!isLoggedIn) {
    if (publicScreen === "landing") {
      return <LandingPage
        onGetStarted={() => navigatePublic("register")}
        onSignIn={() => navigatePublic("login")}
        onOpenLegal={navigatePublic}
      />;
    }
    if (publicScreen === "privacy" || publicScreen === "terms") {
      return <LegalPage
        page={publicScreen}
        onBack={() => navigatePublic("landing")}
        onGetStarted={() => navigatePublic("register")}
      />;
    }
    return <Login
      initialMode={publicScreen}
      onBack={() => navigatePublic("landing")}
      onLogin={data => { setUser(data); setIsLoggedIn(true); setIsSessionChecking(false); }}
    />;
  }

  return (
    <div className="app-wrapper">
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-brand">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            {!sidebarCollapsed && (
              <div>
                <h2 style={{ fontSize: "32px", fontWeight: "900", margin: 0, color: "var(--color-accent)" }}>
                  <BookOpen size={28} style={{ verticalAlign: "middle", marginRight: "8px" }}/> 
                  Planify
                </h2>
                <p style={{ fontSize: "14px", opacity: 0.6, margin: "4px 0 0" }}>AI Study Ecosystem</p>
              </div>
            )}
            {sidebarCollapsed && (
              <BookOpen size={32} color="var(--color-accent)" style={{ margin: "0 auto" }}/>
            )}
          </div>
        </div>
        
        <div className="sidebar-scrollable">
          <AddSubject onAdd={addSubject} subjects={subjects} />
          <SyllabusIntelligence refreshKey={subjects.map(subject => `${subject.name}:${(subject.topics || []).map(topic => topic.name).join(",")}`).join("|")} />
          <div style={{ marginTop: "25px" }}>
            <h3 style={{ fontSize: "11px", fontWeight: "800", textTransform: "uppercase", opacity: 0.5, letterSpacing: "1px", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
              <Zap size={14} color="var(--color-accent)" /> Focus Session
            </h3>
            {activeFocusTask ? (
              <div style={{
                background: "rgba(56, 189, 248, 0.08)",
                border: "1px solid rgba(56, 189, 248, 0.25)",
                borderRadius: "var(--radius-lg)",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                gap: "8px"
              }}>
                <div style={{ fontSize: "11px", fontWeight: "800", color: "var(--color-accent)", textTransform: "uppercase" }}>
                  Active Focus
                </div>
                <div style={{ fontSize: "13px", fontWeight: "700", color: "white", wordBreak: "break-word" }}>
                  {activeFocusTask.name}
                </div>
                <button
                  onClick={() => setActiveFocusTask(activeFocusTask)}
                  style={{
                    background: "var(--color-accent)",
                    color: "#0f172a",
                    border: "none",
                    borderRadius: "10px",
                    padding: "8px 12px",
                    fontSize: "12px",
                    fontWeight: "800",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px"
                  }}
                  className="hover-scale"
                >
                  <Play size={12} fill="currentColor" /> Open Focus Screen
                </button>
              </div>
            ) : currentFocusTask ? (
              <div style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "var(--radius-lg)",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                gap: "8px"
              }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--color-subtext)" }}>
                  Next Study Task ({currentFocusTask.durationMins}m)
                </div>
                <div style={{ fontSize: "13px", fontWeight: "700", color: "white", wordBreak: "break-word" }}>
                  {currentFocusTask.name}
                </div>
                <button
                  onClick={() => startFocusSession(currentFocusTask)}
                  style={{
                    background: "rgba(56, 189, 248, 0.15)",
                    color: "var(--color-accent)",
                    border: "1px solid rgba(56, 189, 248, 0.3)",
                    borderRadius: "10px",
                    padding: "8px 12px",
                    fontSize: "12px",
                    fontWeight: "800",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px"
                  }}
                  className="hover-scale"
                >
                  <Play size={12} fill="currentColor" /> Start Focus
                </button>
              </div>
            ) : (
              <div style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                borderRadius: "var(--radius-lg)",
                padding: "14px",
                fontSize: "12px",
                color: "var(--color-subtext)",
                lineHeight: "1.4"
              }}>
                Select any task in your timetable and click <strong>Focus</strong> to start your session.
              </div>
            )}
          </div>
        </div>

        {/* Mobile Sidebar Toggle Button */}
        <button 
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          style={{
            background: "rgba(255,255,255,0.05)", border: "none", color: "white", padding: "15px",
            cursor: "pointer", borderTop: "1px solid rgba(255,255,255,0.05)",
            display: "flex", justifyContent: "center", alignItems: "center"
          }}
        >
          <Menu size={24} />
        </button>
      </aside>

      <main className={`main-area ${sidebarCollapsed ? 'expanded' : ''}`}>
        <header className="top-nav">
          <div className="header-left">
            <h1 style={{ fontSize: "38px", fontWeight: "900", margin: 0, letterSpacing: "-1px", color: "var(--color-hero-text)" }}>Study Dashboard</h1>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <p style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-subtext)" }}>Welcome back, {user.name}</p>
              {streak > 0 && (
                <div style={{
                  background: "linear-gradient(135deg, #f59e0b, #ef4444)", 
                  color: "white", 
                  padding: "4px 12px", 
                  borderRadius: "20px", 
                  fontSize: "12px", 
                  fontWeight: "900",
                  boxShadow: "0 4px 12px rgba(245, 158, 11, 0.3)"
                }}>
                  🔥 {streak} DAY STREAK
                </div>
              )}
            </div>
          </div>
          <div className="header-right">
            {/* PRO GAMIFICATION WIDGET */}
            <div style={{
              display: "flex", alignItems: "center", gap: "12px",
              background: "linear-gradient(to right, var(--color-card-bg), var(--color-bg))", 
              padding: "8px 16px",
              borderRadius: "100px", 
              border: "1px solid rgba(139, 92, 246, 0.3)",
              boxShadow: "0 4px 15px rgba(139, 92, 246, 0.1)",
              marginRight: "15px"
            }}>
              <div style={{
                background: "linear-gradient(135deg, #8b5cf6, #3b82f6)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                fontWeight: "900",
                fontSize: "16px",
                display: "flex", alignItems: "center", gap: "4px"
              }}>
                <span style={{ fontSize: "12px", WebkitTextFillColor: "var(--color-subtext)" }}>LVL</span>
                {level}
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "80px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", fontWeight: "800", color: "var(--color-subtext)" }}>
                  <span>{xp} XP</span>
                  <span>500</span>
                </div>
                <div style={{ width: "100%", height: "6px", background: "rgba(139, 92, 246, 0.1)", borderRadius: "3px", overflow: "hidden", position: "relative" }}>
                  <div style={{ 
                    position: "absolute", left: 0, top: 0, bottom: 0, 
                    width: `${(xp % 500) / 500 * 100}%`, 
                    background: "linear-gradient(90deg, #8b5cf6, #d946ef)",
                    boxShadow: "0 0 10px rgba(139, 92, 246, 0.5)",
                    transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)"
                  }}></div>
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setShowSpacedRepetition(!showSpacedRepetition);
                setShowHistory(false);
                setShowProfile(false);
                setShowAnalytics(false);
              }}
              className="icon-btn hover-scale"
              style={{ color: showSpacedRepetition ? "var(--color-accent)" : "var(--color-text)", borderColor: showSpacedRepetition ? "var(--color-accent)" : "var(--color-border)" }}
              title="Spaced Repetition (Flashcards)"
            >
              <Brain size={20} />
            </button>
            <button
              onClick={() => {
                if (!showDailyQuiz && !isValidSleepHours(sleepHours)) {
                  alert("Enter daily sleep hours greater than 0 and less than 24 before generating a quiz.");
                  return;
                }
                setShowDailyQuiz(!showDailyQuiz);
                setShowSpacedRepetition(false);
                setShowHistory(false);
                setShowProfile(false);
                setShowAnalytics(false);
              }}
              className="icon-btn hover-scale"
              style={{ color: showDailyQuiz ? "#f59e0b" : "var(--color-text)", borderColor: showDailyQuiz ? "#f59e0b" : "var(--color-border)" }}
              title="Daily AI Quiz"
            >
              <Star size={20} />
            </button>
            <button
              onClick={resetDashboard}
              className="icon-btn hover-scale"
              style={{ color: "var(--color-warning)", borderColor: "var(--color-warning-bg)" }}
              title="Clear All (Reset Dashboard)"
              aria-label="Clear Dashboard"
            >
              <Trash2 size={20} />
            </button>

            <button
              onClick={() => {
                setShowProfile(!showProfile);
                setShowDailyQuiz(false);
                setShowSpacedRepetition(false);
                setShowHistory(false);
                setShowAnalytics(false);
              }}
              className="icon-btn hover-scale"
              style={{ color: showProfile ? "var(--color-accent)" : "var(--color-text)", borderColor: showProfile ? "var(--color-accent)" : "var(--color-border)" }}
              title="My Profile"
            >
              <User size={20} />
            </button>

            <button
              onClick={() => {
                setShowAnalytics(!showAnalytics);
                setShowProfile(false);
                setShowDailyQuiz(false);
                setShowSpacedRepetition(false);
                setShowHistory(false);
              }}
              className="icon-btn hover-scale"
              style={{ color: showAnalytics ? "var(--color-accent)" : "var(--color-text)", borderColor: showAnalytics ? "var(--color-accent)" : "var(--color-border)" }}
              title="Analytics"
            >
              <BarChart2 size={20} />
            </button>

            <button
              onClick={() => {
                setShowHistory(!showHistory);
                setShowAnalytics(false);
              }}
              className="icon-btn hover-scale"
              title="View History"
              aria-label="View History"
            >
              <Clock size={20} />
            </button>

            <button
              onClick={toggleTheme}
              className="icon-btn hover-scale"
              title="Toggle Theme"
              aria-label="Toggle Theme"
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>

            <button
              onClick={handleLogout}
              className="icon-btn hover-scale"
              style={{ color: "var(--color-danger)", borderColor: "var(--color-danger-bg)" }}
              title="Sign Out"
              aria-label="Sign Out"
            >
              <LogOut size={20} />
            </button>
          </div>
        </header>

        <div ref={componentRef} className="printable-plan">
          {showAnalytics ? (
            <Analytics user={user} />
          ) : showProfile ? (
            <Profile user={user} setUser={setUser} onAccountDeleted={handleAccountDeleted} />
          ) : showDailyQuiz ? (
            <DailyQuiz 
              user={user} 
              todaySubjects={subjects.length > 0 ? subjects.map(s => s.name) : plan.map(p => p.name)} 
              sleepHours={sleepHours}
              onComplete={fetchStats}
              onExit={() => setShowDailyQuiz(false)} 
            />
          ) : showSpacedRepetition ? (
            <SpacedRepetition user={user} />
          ) : showHistory ? (
            <div className="fade-in card">
              <h2 style={{ fontSize: "32px", fontWeight: "900" }}>Plan History</h2>
              <p style={{ color: "var(--color-subtext)", marginBottom: "30px" }}>Review your previously generated study schedules.</p>
              {history.length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", background: "var(--color-focus-bg)", borderRadius: "var(--radius-xl)" }}>
                  <p style={{ color: "var(--color-subtext)" }}>No history found yet.</p>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "20px" }}>
                  {history.map((h, i) => (
                    <div key={i} className="card hover-scale" style={{ display: "flex", flexDirection: "column", gap: "15px", padding: "25px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h4 style={{ margin: 0 }}>Plan #{history.length - i}</h4>
                        <span style={{ fontSize: "12px", color: "var(--color-subtext)" }}>{new Date(h.created_at).toLocaleDateString()}</span>
                      </div>
                      <button
                        onClick={() => { setPlan(JSON.parse(h.data)); setShowHistory(false); }}
                        style={{ padding: "12px", background: "rgba(56, 189, 248, 0.1)", color: "var(--color-accent)", border: "none", borderRadius: "12px", fontWeight: "800", cursor: "pointer", fontSize: "13px" }}
                      >
                        Restore this Plan 🔄
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="card progress-card" style={{ marginBottom: "30px", padding: "25px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--color-subtext)" }}>Overall Academic Completion</span>
                  <span style={{ fontSize: "13px", fontWeight: "800", color: "var(--color-accent)" }}>{progressPercent}%</span>
                </div>
                <div style={{ height: "12px", borderRadius: "20px", overflow: "hidden", background: "var(--color-bar-bg)" }}>
                  <div style={{ height: "100%", width: `${progressPercent}%`, background: "linear-gradient(90deg, #38bdf8, #818cf8)", transition: "width 0.6s cubic-bezier(0.4, 0, 0.2, 1)" }}></div>
                </div>
              </div>

              {!onboardingDismissed && plan.length === 0 && (
                <FirstPlanGuide
                  hasSubjects={subjects.length > 0}
                  hasSleepHours={isValidSleepHours(sleepHours)}
                  onChooseStep={focusOnboardingStep}
                  onDismiss={dismissOnboarding}
                />
              )}

              {plan.length > 0 && (
                <SmartTips 
                  subjects={subjects} 
                  completedTasks={completedTasks} 
                  plan={plan} 
                  streak={streak} 
                />
              )}

              <div className="action-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px", gap: "20px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: "15px", alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "700", opacity: 0.5 }}>DAILY SLEEP (HRS)</span>
                    <input 
                      id="daily-sleep-hours"
                      type="number" 
                      value={sleepHours} 
                      min="0" max="23" 
                      onChange={e => setSleepHours(e.target.value)} 
                      required
                      aria-label="Daily sleep hours"
                      style={{ padding: "12px 15px", borderRadius: "12px", border: "1px solid var(--color-border)", width: "100px", fontSize: "16px", fontWeight: "800", background: "var(--color-card-bg)", color: "var(--color-text)" }} 
                    />
                  </div>
                  <button onClick={generatePlan} className="hover-scale" style={{ padding: "16px 30px", background: "linear-gradient(135deg, #f97316, #ea580c)", color: "white", border: "none", borderRadius: "16px", fontWeight: "900", cursor: "pointer", boxShadow: "0 10px 15px -3px rgba(249, 115, 22, 0.3)" }}>
                    🚀 Generate Plan
                  </button>
                </div>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <button onClick={handlePrint} disabled={plan.length === 0} className="hover-scale" style={{ padding: "12px 20px", background: "#10b981", color: "white", border: "none", borderRadius: "14px", fontWeight: "700", cursor: plan.length === 0 ? "not-allowed" : "pointer", fontSize: "14px", opacity: plan.length === 0 ? 0.4 : 1, display: "flex", alignItems: "center", gap: "8px" }}>
                    <Download size={18}/> PDF Export
                  </button>
                </div>
              </div>

              {showSpacedRepetition ? (
                <SpacedRepetition user={user} />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>
                  <div className="card fade-in">
                    <Dashboard plan={plan} subjects={subjects} onRemove={removeSubject} onEdit={(sub, index) => setEditingSub({ ...sub, index })} />
                  </div>
                  {showChart && <div className="card slide-up chart-box"><ChartBox plan={plan} /></div>}
                  {plan.length > 0 && currentFocusTask && (
                    <div className="card slide-up" style={{
                      background: "linear-gradient(135deg, rgba(56, 189, 248, 0.08), rgba(129, 140, 248, 0.08))",
                      border: "1px solid rgba(56, 189, 248, 0.25)",
                      padding: "20px 24px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "16px"
                    }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "11px", fontWeight: "900", textTransform: "uppercase", color: "var(--color-accent)", letterSpacing: "1px" }}>
                            Current Study Task
                          </span>
                          <span style={{ fontSize: "11px", fontWeight: "700", opacity: 0.7, background: "rgba(255,255,255,0.08)", padding: "2px 8px", borderRadius: "10px" }}>
                            Phase {currentFocusTask.originalPhase + 1}
                          </span>
                        </div>
                        <div style={{ fontSize: "18px", fontWeight: "800", color: "var(--color-hero-text)" }}>
                          {currentFocusTask.name}
                        </div>
                        <div style={{ fontSize: "13px", color: "var(--color-subtext)", display: "flex", alignItems: "center", gap: "6px" }}>
                          <Clock size={13} /> Allocated Time: <strong>{currentFocusTask.durationMins} Minutes</strong>
                        </div>
                      </div>
                      <button
                        onClick={() => startFocusSession(currentFocusTask)}
                        className="hover-scale"
                        style={{
                          background: "linear-gradient(135deg, #0284c7, #38bdf8)",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "14px",
                          padding: "12px 24px",
                          fontSize: "14px",
                          fontWeight: "900",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          boxShadow: "0 4px 15px rgba(56, 189, 248, 0.3)"
                        }}
                      >
                        <Play size={16} fill="currentColor" /> Start Focus
                      </button>
                    </div>
                  )}
                  {plan.length > 0 && (
                    <div className="fade-in">
                      <WeeklyPlan
                        plan={plan}
                        schedule={activeSchedule}
                        sleepHours={sleepHours === "" ? 0 : Number(sleepHours)}
                        completedTasks={completedTasks}
                        handleComplete={toggleTask}
                        handleSkip={handleSkip}
                        skippedTasks={skippedTasks}
                        onProgressUpdate={handleProgressUpdate}
                        onStartFocus={startFocusSession}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {editingSub && <EditModal subject={editingSub} subjects={subjects} onSave={saveEdit} onCancel={() => setEditingSub(null)} />}
        {activeFocusTask && (
          <FocusMode
            task={activeFocusTask}
            onComplete={handleFocusComplete}
            onExit={handleFocusExit}
            isTaskCompleted={!!completedTasks[activeFocusTask.id]}
          />
        )}
      </main>
    </div>
  );
}

export default App;
