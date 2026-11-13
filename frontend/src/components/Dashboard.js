import React from "react";
import { Edit2, X, Clock } from "lucide-react";
import "./Dashboard.css";

function Dashboard({ plan, subjects, onRemove, onEdit }) {
  const removeSub = (idx) => {
    if (window.confirm("Permanent delete?")) {
      onRemove?.(idx);
    }
  };

  const calcHours = (name) => plan
    .filter(p => p.name.startsWith(name))
    .reduce((sum, p) => sum + (p.hours || 0), 0)
    .toFixed(1);

  const getDaysLeft = (dateStr) => {
    if (!dateStr) return null;
    const diff = new Date(dateStr) - new Date();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days;
  };

  const getDifficultyColor = (difficulty) => {
    if (difficulty === "Hard") return "var(--color-danger)";
    if (difficulty === "Medium") return "var(--color-warning)";
    return "var(--color-success)"; // Easy
  };

  return (
    <div>
      <h3 className="dash-heading">Active Subjects</h3>
      {subjects.length === 0 ? (
        <div className="dash-empty">
          Your curriculum is empty. Start adding subjects from the sidebar.
        </div>
      ) : (
        <div className="dash-list">
          {subjects.map((sub, i) => (
            <div 
              key={i} 
              className={`dash-row hover-scale stagger-${(i % 5) + 1}`} 
              style={{ borderLeftColor: getDifficultyColor(sub.difficulty) }}
            >
              <div className="dash-info">
                <h4 className="dash-name">{sub.name}</h4>
                <div className="dash-meta">
                  <span className="diff-badge" style={{ color: getDifficultyColor(sub.difficulty), background: `${getDifficultyColor(sub.difficulty)}15` }}>
                    {sub.difficulty}
                  </span>
                  <span className="meta-dot">•</span>
                  <span>Deadline: {sub.examDate}</span>
                  {getDaysLeft(sub.examDate) !== null && (
                    <span className={`days-pill ${getDaysLeft(sub.examDate) <= 3 ? 'urgent' : getDaysLeft(sub.examDate) <= 7 ? 'warning' : 'safe'}`}>
                      <Clock size={12} /> {getDaysLeft(sub.examDate) < 0 ? 'Exam Passed' : getDaysLeft(sub.examDate) === 0 ? 'Exam Today' : getDaysLeft(sub.examDate) === 1 ? '1 Day Left' : `${getDaysLeft(sub.examDate)} Days Left`}
                    </span>
                  )}
                </div>
                
                {sub.topics && sub.topics.length > 0 && (
                  <div className="dash-topics">
                    {sub.topics.slice(0, 3).map((t, tidx) => (
                      <span key={tidx} className="topic-tag">{t.name}</span>
                    ))}
                    {sub.topics.length > 3 && <span className="topic-tag extra">+{sub.topics.length - 3} more</span>}
                  </div>
                )}
              </div>
              <div className="dash-actions">
                <div className="hour-badge">{calcHours(sub.name)}h Allocation</div>
                <button onClick={() => onEdit(sub, i)} className="action-btn edit-btn" aria-label="Edit Subject">
                  <Edit2 size={16} />
                </button>
                <button onClick={() => removeSub(i)} className="action-btn del-btn" aria-label="Delete Subject">
                  <X size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Dashboard;
